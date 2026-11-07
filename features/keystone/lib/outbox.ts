import type { Db } from './db'

/**
 * Outbox delivery (construction outbox/worker.ts + openfront webhooks/outbox.ts, adapted).
 * Delivery is at-least-once at the transport and exactly-once in effect: every handler receives the
 * message's stable dedupe key and must be idempotent on it (venue client order ids, webhook
 * Idempotency-Key). A worker that crashes mid-delivery leaves the message leased; once the lease
 * expires another worker claims it with a higher fencing token, and the stale worker's
 * acknowledgement is refused.
 */

export type ClaimedMessage = { id: string; topic: string; aggregateType: string; aggregateId: string; dedupeKey: string; payload: unknown; attempts: number; fencingToken: number }
export type OutboxHandler = (message: ClaimedMessage) => Promise<void>
export type OutboxHandlers = Record<string, OutboxHandler>

export const retryDelayMs = (attempt: number) => Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1))

/**
 * Claim one due message (pending, failed and due, or leased with an expired lease). `partition`
 * restricts the claim to messages whose payload.partition matches (the router claims per venue
 * account, so one account's lease never blocks another's orders).
 */
export async function claimNext(db: Db, workerId: string, leaseMs: number, now = new Date(), topics?: string[], partition?: string): Promise<ClaimedMessage | null> {
  const until = new Date(now.getTime() + leaseMs)
  const topicFilter = topics?.length ? topics : null
  const partitionFilter = partition ?? null
  const rows = await db.$queryRaw<ClaimedMessage[]>`
    UPDATE "OutboxEvent" SET status = 'leased', "leaseOwner" = ${workerId}, "leaseExpiresAt" = (${until}::timestamptz AT TIME ZONE 'UTC'),
      attempts = attempts + 1, "fencingToken" = "fencingToken" + 1, "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT id FROM "OutboxEvent"
      WHERE ((status IN ('pending', 'failed') AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')) OR (status = 'leased' AND "leaseExpiresAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')))
        AND (${topicFilter}::text[] IS NULL OR topic = ANY(${topicFilter}::text[]))
        AND (${partitionFilter}::text IS NULL OR payload->>'partition' = ${partitionFilter}::text)
      ORDER BY "nextAttemptAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, topic, "aggregateType", "aggregateId", "dedupeKey", payload, attempts, "fencingToken"`
  return rows[0] ? { ...rows[0], attempts: Number(rows[0].attempts), fencingToken: Number(rows[0].fencingToken) } : null
}

/** Acknowledge only while still holding this exact lease. */
export async function markDelivered(db: Db, message: ClaimedMessage, workerId: string, now = new Date()) {
  const result = await db.outboxEvent.updateMany({
    where: { id: message.id, status: 'leased', leaseOwner: workerId, fencingToken: message.fencingToken },
    data: { status: 'delivered', deliveredAt: now, leaseOwner: '', leaseExpiresAt: null, lastError: '' },
  })
  return result.count === 1
}

export async function markFailed(db: Db, message: ClaimedMessage, workerId: string, error: unknown, maxAttempts: number, now = new Date()) {
  const dead = message.attempts >= maxAttempts
  const text = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1000) || 'Unknown delivery error'
  const result = await db.outboxEvent.updateMany({
    where: { id: message.id, status: 'leased', leaseOwner: workerId, fencingToken: message.fencingToken },
    data: { status: dead ? 'dead' : 'failed', nextAttemptAt: new Date(now.getTime() + retryDelayMs(message.attempts)), leaseOwner: '', leaseExpiresAt: null, lastError: text },
  })
  return result.count === 1
}

export type DrainResult = { claimed: number; delivered: number; failed: number; dead: number; staleAcks: number }

export async function drainOutbox(db: Db, options: { workerId: string; handlers: OutboxHandlers; leaseMs?: number; maxAttempts?: number; maxMessages?: number; topics?: string[]; now?: () => Date }): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, delivered: 0, failed: 0, dead: 0, staleAcks: 0 }
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000)
  const maxAttempts = options.maxAttempts ?? 8
  const clock = options.now ?? (() => new Date())
  for (let i = 0; i < (options.maxMessages ?? 100); i += 1) {
    const message = await claimNext(db, options.workerId, leaseMs, clock(), options.topics)
    if (!message) break
    result.claimed += 1
    const handler = options.handlers[message.topic]
    try {
      if (!handler) throw new Error(`No outbox handler for ${message.topic}`)
      await handler(message)
      if (await markDelivered(db, message, options.workerId, clock())) result.delivered += 1
      else result.staleAcks += 1
    } catch (error) {
      const acknowledged = await markFailed(db, message, options.workerId, error, maxAttempts, clock())
      if (!acknowledged) result.staleAcks += 1
      else if (message.attempts >= maxAttempts) result.dead += 1
      else result.failed += 1
    }
  }
  return result
}
