import { keystoneContext } from '@/features/keystone/context'
import { schedulerEnabled, TICK_PREFIX } from '@/features/keystone/workers/scheduler'

export const dynamic = 'force-dynamic'

/** A loop is stale when it missed two of its own intervals (plus a minute of boot stagger). */
const staleAfterMs = (intervalSeconds: number | null) => (intervalSeconds ?? 300) * 2000 + 60_000

/**
 * Health: the database answers, and the in-app scheduler's loops (clinical clocks, comms worker) and
 * the clinical jobs they run are reported from their ScheduledJob rows. Workers are reported, not
 * required, so a fresh instance can come up and serve before its first tick. No names, ids or errors
 * beyond the job kind and a short failure line.
 */
export async function GET() {
  try {
    // The app's own pool (one per process, sized by connection_limit in DATABASE_URL); never a second one.
    const prisma = (keystoneContext as any).prisma as import('@prisma/client').PrismaClient
    const now = Date.now()
    const [rows, outboxPending, oldest] = await Promise.all([
      prisma.scheduledJob.findMany({ orderBy: { kind: 'asc' }, select: { kind: true, intervalSeconds: true, lastRunAt: true, nextRunAt: true, status: true, lastError: true } }),
      prisma.outboxEvent.count({ where: { status: 'pending' } }),
      prisma.outboxEvent.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ])
    const describe = (row: (typeof rows)[number]) => {
      const age = row.lastRunAt ? now - row.lastRunAt.getTime() : null
      const state = age === null ? 'never_ran' : age > staleAfterMs(row.intervalSeconds) ? 'stale' : row.status === 'failed' ? 'failing' : 'running'
      return { kind: row.kind, state, lastRunAt: row.lastRunAt?.toISOString() ?? null, nextRunAt: row.nextRunAt?.toISOString() ?? null, intervalSeconds: row.intervalSeconds, ...(row.status === 'failed' ? { lastError: row.lastError.slice(0, 160) } : {}) }
    }
    const loops = rows.filter(r => r.kind.startsWith(TICK_PREFIX)).map(describe)
    const jobs = rows.filter(r => !r.kind.startsWith(TICK_PREFIX)).map(describe)
    const scheduler = { enabled: schedulerEnabled(), state: !loops.length ? 'never_ran' : loops.every(l => l.state === 'running') ? 'running' : loops.some(l => l.state === 'running') ? 'degraded' : loops[0].state }
    return Response.json({ status: 'ok', database: 'ok', scheduler, workers: loops, jobs, outbox: { pending: outboxPending, oldestPendingAt: oldest?.createdAt.toISOString() ?? null } })
  } catch {
    return Response.json({ status: 'unhealthy', reason: 'database_unavailable' }, { status: 503 })
  }
}
