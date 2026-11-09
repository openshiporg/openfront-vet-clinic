import { randomUUID } from 'node:crypto'
import type { Db } from '../lib/db'
import { systemActor } from '../lib/actor'
import { runInTransaction } from '../lib/unitOfWork'
import { acquireLease, releaseLease } from '../lib/lease'
import { seedClinic } from '../seed/clinic'
import { runClinicalJobs } from './clinical'
import { runCommsWorker } from './comms'

/*
 * In-app scheduler (M1) and release-time reference data (M6), started once per server process from
 * instrumentation.ts. Every tick goes through the same fenced leases the HTTP job routes use, so any
 * number of replicas, plus an external cron hitting /api/jobs/*, never run the same job twice.
 *
 *   - clinical clocks every VC_CLINICAL_TICK_MINUTES (default 5): treatment sheets, unsigned records,
 *     daily reminders;
 *   - comms worker every VC_COMMS_TICK_MINUTES (default 1): outbox (document.render, reminders) → send;
 *   - on boot, if the practice spine exists, `seedClinic` (idempotent) loads any Phase 2 reference data
 *     the deploy has not loaded yet (cages, formulary, dose ranges, vaccines, reminder protocols).
 *
 * VC_SCHEDULER=off disables it (tests, one-off scripts). Never runs during `next build`.
 */

type Started = { stop: () => void }
const KEY = Symbol.for('vc.scheduler')

export function schedulerEnabled(env = process.env) {
  if (env.VC_SCHEDULER === 'off') return false
  if (env.NEXT_PHASE === 'phase-production-build') return false
  return env.NODE_ENV === 'production' || env.VC_SCHEDULER === 'on'
}

const minutes = (value: string | undefined, fallback: number) => {
  const n = value && /^\d{1,2}$/.test(value) ? parseInt(value, 10) : NaN
  return n >= 1 && n <= 60 ? n : fallback
}

/** Load the clinic reference data once per release (lease-guarded; the seed itself is idempotent). */
export async function ensureClinicSetup(db: Db) {
  const lease = await acquireLease(db, 'release:clinic-setup', `release-${randomUUID()}`, 10 * 60_000, new Date())
  if (!lease) return { ran: false as const }
  try {
    const spine = await db.location.findUnique({ where: { id: 'seed_loc_main' }, select: { id: true } })
    if (!spine) return { ran: false as const, reason: 'practice not loaded' }
    const created = await runInTransaction(db, uow => seedClinic(uow, systemActor('release:clinic-setup')))
    return { ran: true as const, created }
  } finally {
    await releaseLease(db, lease, new Date())
  }
}

/** Prefix of the heartbeat rows /api/health reads: one ScheduledJob row per scheduler loop. */
export const TICK_PREFIX = 'scheduler.'

/** Each tick leaves a heartbeat (ScheduledJob kind scheduler.<loop>), so health can say the loops run. */
async function recordTick(db: Db, name: string, ms: number, error: string | null, at = new Date()) {
  const kind = `${TICK_PREFIX}${name}`
  const data = { intervalSeconds: Math.round(ms / 1000), lastRunAt: at, nextRunAt: new Date(at.getTime() + ms), status: error ? 'failed' : 'idle', leaseKey: '', lastError: error ?? '' }
  await db.scheduledJob.upsert({ where: { kind }, create: { kind, ...data }, update: data }).catch(() => undefined)
}

export function startScheduler(db: Db, log: (line: string) => void = line => console.log(line)): Started {
  const g = globalThis as Record<symbol, Started | undefined>
  if (g[KEY]) return g[KEY]!
  const timers: NodeJS.Timeout[] = []
  const busy = new Set<string>()
  const every = (name: string, ms: number, run: () => Promise<unknown>) => {
    const tick = async () => {
      if (busy.has(name)) return
      busy.add(name)
      try {
        const result = await run()
        await recordTick(db, name, ms, null)
        if (process.env.VC_SCHEDULER_LOG === 'verbose') log(`[scheduler] ${name} ${JSON.stringify(result).slice(0, 400)}`)
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').pop()!.slice(0, 200) : 'error'
        await recordTick(db, name, ms, message)
        log(`[scheduler] ${name} failed: ${message}`)
      } finally {
        busy.delete(name)
      }
    }
    // First run shortly after boot (staggered), then on the interval.
    timers.push(setTimeout(tick, 15_000 + timers.length * 5_000))
    timers.push(setInterval(tick, ms))
  }
  ensureClinicSetup(db).then(r => log(`[scheduler] clinic setup ${r.ran ? `loaded ${JSON.stringify((r as { created?: unknown }).created)}` : 'skipped'}`)).catch(error => log(`[scheduler] clinic setup failed: ${error instanceof Error ? error.message.slice(0, 200) : 'error'}`))
  const clinicalMinutes = minutes(process.env.VC_CLINICAL_TICK_MINUTES, 5)
  every('clinical', clinicalMinutes * 60_000, async () => {
    const results = await runClinicalJobs(db, { intervalSeconds: clinicalMinutes * 60 })
    const failed = results.filter(r => r.error)
    if (failed.length) log(`[scheduler] clinical: ${failed.map(f => `${f.job}: ${f.error}`).join('; ').slice(0, 400)}`)
    // One line per tick: which jobs ran and what they changed (M1: the run is visible in the deploy log).
    const ran = results.filter(r => r.ran && !r.error)
    if (ran.length) log(`[scheduler] clinical ran ${ran.map(r => `${r.job}${r.result && typeof r.result === 'object' ? ` ${JSON.stringify(r.result)}` : ''}`).join('; ').slice(0, 600)}`)
    return results
  })
  every('comms', minutes(process.env.VC_COMMS_TICK_MINUTES, 1) * 60_000, async () => {
    const r = await runCommsWorker(db, { workerId: `scheduler-${process.pid}` })
    return { drained: r.drained, sent: r.sent.length }
  })
  const started = { stop: () => { timers.forEach(t => clearInterval(t)); g[KEY] = undefined } }
  g[KEY] = started
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => started.stop())
  log('[scheduler] started')
  return started
}
