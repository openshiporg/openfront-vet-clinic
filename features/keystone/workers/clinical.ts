import { randomUUID } from 'node:crypto'
import type { Db } from '../lib/db'
import { acquireLease, assertFence, releaseLease, type LeaseGrant } from '../lib/lease'
import { runInTransaction, type UnitOfWork } from '../lib/unitOfWork'
import { localDate } from '../lib/calendar'
import { runUnsignedRecordClock } from '../mutations/record'
import { runTreatmentSheetJob } from '../mutations/treatment'
import { runReminderJob } from '../mutations/vaccines'

/*
 * The clinical clocks, run by the scheduler (POST /api/jobs/clinical every 5–15 minutes):
 *   - treatment sheets: materialise 24 h ahead, move tasks to due/overdue (lease `treatment-sheets`);
 *   - unsigned records: task at 24 h, escalate at 72 h (lease `record-clock`);
 *   - reminders: once per location per local day (lease `reminders:{location}:{date}`, kept for the
 *     day after a successful run; the outbox dedupe key backs it up).
 * Every job writes under a fenced lease: the transaction asserts the fencing token first, so two
 * schedulers never run the same job at once and a worker that stalled past its lease cannot commit.
 */

export type JobResult = { job: string; ran: boolean; result?: unknown; error?: string }

async function leased<T>(db: Db, key: string, ttlMs: number, now: Date, work: (uow: UnitOfWork) => Promise<T>, options: { keepOnSuccess?: boolean } = {}): Promise<JobResult> {
  const grant: LeaseGrant | null = await acquireLease(db, key, `clinical-${randomUUID()}`, ttlMs, now)
  if (!grant) return { job: key, ran: false }
  let ok = false
  try {
    const result = await runInTransaction(db, async uow => {
      await assertFence(uow.tx, grant, uow.now)
      return work(uow)
    }, { now })
    ok = true
    return { job: key, ran: true, result }
  } catch (error) {
    return { job: key, ran: true, error: error instanceof Error ? error.message.split('\n').pop()!.slice(0, 300) : 'failed' }
  } finally {
    if (!(ok && options.keepOnSuccess)) await releaseLease(db, grant, new Date())
  }
}

export async function runClinicalJobs(db: Db, options: { now?: Date; only?: string[] } = {}): Promise<JobResult[]> {
  const now = options.now ?? new Date()
  const want = (name: string) => !options.only?.length || options.only.includes(name)
  const out: JobResult[] = []
  if (want('treatment')) out.push(await leased(db, 'treatment-sheets', 10 * 60_000, now, runTreatmentSheetJob))
  if (want('records')) out.push(await leased(db, 'record-clock', 10 * 60_000, now, runUnsignedRecordClock))
  if (want('reminders')) {
    const locations = await db.location.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { id: true, timeZone: true } })
    for (const loc of locations) {
      const on = localDate({ timeZone: loc.timeZone }, now)
      out.push(await leased(db, `reminders:${loc.id}:${on}`, 26 * 3_600_000, now, uow => runReminderJob(uow, loc.id), { keepOnSuccess: true }))
    }
  }
  return out
}
