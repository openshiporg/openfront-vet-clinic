import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { canonicalJson, sha256, toJsonValue } from './canonical'
import { advisoryLock, type Db, type Tx } from './db'

/**
 * Hash-chained audit log (SCHEMA §14, I-G4). Each event's hash covers the previous hash and the
 * canonical form of every stored column, so editing, deleting or reordering any row breaks
 * verification from that row on. Appends are serialised by one advisory lock and happen as the last
 * step of a transaction (see runInTransaction), so the chain order is the commit order.
 */

export const GENESIS_HASH = '0'.repeat(64)

export type AuditInput = {
  eventType: string
  entityType: string
  entityId: string
  actorUserId?: string | null
  actorAgentId?: string | null
  approverId?: string | null
  reason?: string | null
  before?: unknown
  after?: unknown
  metadata?: unknown
  requestId?: string | null
  eventKey?: string
}

type StoredAudit = {
  seq: number
  eventKey: string
  eventType: string
  entityType: string
  entityId: string
  actorUserId: string | null
  actorAgentId: string | null
  approverId: string | null
  reason: string | null
  before: unknown
  after: unknown
  metadata: unknown
  requestId: string | null
  prevHash: string
  at: Date
}

/** The exact content a hash covers. Every field comes back identically from the database. */
export function auditHashBody(row: StoredAudit) {
  return {
    seq: row.seq,
    eventKey: row.eventKey,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    actorUserId: row.actorUserId ?? null,
    actorAgentId: row.actorAgentId ?? null,
    approverId: row.approverId ?? null,
    reason: row.reason || null,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? null,
    requestId: row.requestId || null,
    at: row.at.toISOString(),
  }
}

export const auditHash = (prevHash: string, row: StoredAudit) => sha256(`${prevHash}\n${canonicalJson(auditHashBody(row))}`)

/** Appends events in order. Call once per transaction, after every other write. */
export async function appendAuditEvents(tx: Tx, events: AuditInput[], now = new Date()) {
  if (!events.length) return []
  await advisoryLock(tx, 'audit:chain')
  const last = await tx.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } })
  let seq = last?.seq ?? 0
  let prevHash = last?.hash ?? GENESIS_HASH
  const written: { seq: number; hash: string }[] = []
  const rows: Prisma.AuditEventCreateManyInput[] = []
  for (const event of events) {
    seq += 1
    const row: StoredAudit = {
      seq,
      eventKey: event.eventKey ?? randomUUID(),
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      actorUserId: event.actorUserId ?? null,
      actorAgentId: event.actorAgentId ?? null,
      approverId: event.approverId ?? null,
      reason: event.reason ? event.reason.slice(0, 2000) : null,
      before: event.before === undefined ? null : toJsonValue(event.before),
      after: event.after === undefined ? null : toJsonValue(event.after),
      metadata: event.metadata === undefined ? null : toJsonValue(event.metadata),
      requestId: event.requestId ?? null,
      prevHash,
      at: now,
    }
    const hash = auditHash(prevHash, row)
    rows.push({
      seq: row.seq,
      eventKey: row.eventKey,
      eventType: row.eventType,
      entityType: row.entityType,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      actorAgentId: row.actorAgentId,
      approverId: row.approverId,
      reason: row.reason ?? '',
      // Nullable json columns: omit null (stored as SQL NULL, read back as null).
      ...(row.before === null ? {} : { before: row.before as never }),
      ...(row.after === null ? {} : { after: row.after as never }),
      ...(row.metadata === null ? {} : { metadata: row.metadata as never }),
      requestId: row.requestId ?? '',
      prevHash,
      hash,
      at: row.at,
    })
    written.push({ seq, hash })
    prevHash = hash
  }
  // One statement for the whole batch: the chain is computed above, under the chain lock.
  await tx.auditEvent.createMany({ data: rows })
  return written
}

export type ChainVerification = { ok: boolean; count: number; lastSeq: number; lastHash: string; brokenAtSeq?: number; problem?: string }

/** Recomputes the whole chain in seq order. */
export async function verifyAuditChain(db: Db | Tx, batchSize = 1000): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH
  let expectedSeq = 1
  let count = 0
  for (;;) {
    const rows = await db.auditEvent.findMany({ where: { seq: { gte: expectedSeq } }, orderBy: { seq: 'asc' }, take: batchSize })
    if (!rows.length) break
    for (const row of rows) {
      if (row.seq !== expectedSeq) return { ok: false, count, lastSeq: expectedSeq - 1, lastHash: prevHash, brokenAtSeq: expectedSeq, problem: 'missing event' }
      if (row.prevHash !== prevHash) return { ok: false, count, lastSeq: row.seq - 1, lastHash: prevHash, brokenAtSeq: row.seq, problem: 'previous hash does not match' }
      const hash = auditHash(prevHash, {
        ...row,
        reason: row.reason || null,
        requestId: row.requestId || null,
        actorUserId: row.actorUserId ?? null,
        actorAgentId: row.actorAgentId ?? null,
        approverId: row.approverId ?? null,
      } as StoredAudit)
      if (hash !== row.hash) return { ok: false, count, lastSeq: row.seq - 1, lastHash: prevHash, brokenAtSeq: row.seq, problem: 'content does not match its hash' }
      prevHash = row.hash
      expectedSeq += 1
      count += 1
    }
  }
  return { ok: true, count, lastSeq: expectedSeq - 1, lastHash: prevHash }
}
