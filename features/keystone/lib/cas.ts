import { delegateOf, tableName, type Tx } from './db'
import { DomainError, Codes } from './errors'
import { actorAgentId, actorUserId, type Actor } from './actor'
import type { UnitOfWork } from './unitOfWork'

/**
 * The one way a governed status changes (SM§0):
 *   1. lock the row (SELECT … FOR UPDATE), so guards see a stable snapshot;
 *   2. check the caller's expected version (STALE_STATE) and the allowed from-states (INVALID_TRANSITION);
 *   3. run the guard on the locked row;
 *   4. UPDATE … WHERE id AND version = :v AND status IN (:from), bumping version;
 *   5. queue the audit event in the same transaction.
 */

export type TransitionSpec<Row extends Record<string, unknown>> = {
  model: string
  id: string
  from: readonly string[]
  to: string
  /** The version the caller last saw. Omit only for server workers that hold the row lock and a lease. */
  expectedVersion?: number | null
  actor: Actor
  eventType: string
  reason?: string | null
  approverId?: string | null
  metadata?: Record<string, unknown>
  statusField?: string
  /** Extra columns to set with the status change. */
  data?: Record<string, unknown> | ((row: Row) => Record<string, unknown> | Promise<Record<string, unknown>>)
  /** Throws a DomainError when the transition is not allowed for this row. */
  guard?: (row: Row) => void | Promise<void>
}

const COLUMN = /^[a-z][A-Za-z0-9]*$/

export async function lockRow<Row extends Record<string, unknown>>(tx: Tx, model: string, id: string): Promise<Row> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${tableName(model)} WHERE id = $1 FOR UPDATE`, id)
  if (!rows.length) throw new DomainError(Codes.NOT_FOUND, `${model} not found.`, { model, id })
  const row = await delegateOf(tx, model).findUnique({ where: { id } })
  return row as Row
}

export async function transition<Row extends Record<string, unknown>>(uow: UnitOfWork, spec: TransitionSpec<Row>): Promise<Row> {
  const statusField = spec.statusField ?? 'status'
  if (!COLUMN.test(statusField)) throw new Error('Invalid status field')
  const row = await lockRow<Row>(uow.tx, spec.model, spec.id)
  const currentStatus = String(row[statusField])
  const currentVersion = Number(row.version)
  if (spec.expectedVersion !== undefined && spec.expectedVersion !== null && spec.expectedVersion !== currentVersion) {
    throw new DomainError(Codes.STALE_STATE, `${spec.model} changed since you loaded it. Reload and try again.`, { currentStatus, currentVersion })
  }
  if (!spec.from.includes(currentStatus)) {
    throw new DomainError(Codes.INVALID_TRANSITION, `${spec.model} can't move from ${currentStatus} to ${spec.to}.`, { currentStatus, currentVersion, to: spec.to })
  }
  if (spec.guard) await spec.guard(row)
  const extra = typeof spec.data === 'function' ? await spec.data(row) : spec.data ?? {}
  const result = await delegateOf(uow.tx, spec.model).updateMany({
    where: { id: spec.id, version: currentVersion, [statusField]: { in: [...spec.from] } },
    data: { ...extra, [statusField]: spec.to, version: { increment: 1 } },
  })
  if (result.count !== 1) {
    throw new DomainError(Codes.STALE_STATE, `${spec.model} changed since you loaded it. Reload and try again.`, { currentStatus, currentVersion })
  }
  uow.audit({
    eventType: spec.eventType,
    entityType: spec.model,
    entityId: spec.id,
    actorUserId: actorUserId(spec.actor),
    actorAgentId: actorAgentId(spec.actor),
    approverId: spec.approverId ?? null,
    reason: spec.reason ?? null,
    before: { [statusField]: currentStatus, version: currentVersion },
    after: { [statusField]: spec.to, version: currentVersion + 1, ...extra },
    metadata: { ...(spec.metadata ?? {}), ...(spec.actor.kind === 'system' ? { system: spec.actor.name } : {}) },
  })
  return (await delegateOf(uow.tx, spec.model).findUnique({ where: { id: spec.id } })) as Row
}

/**
 * The same CAS update and audit as transition(), for a row the caller already holds in this
 * transaction (locked FOR UPDATE, or created here) and has just read: one statement instead of four.
 * Returns the new version.
 */
export async function casUpdate(uow: UnitOfWork, spec: { model: string; id: string; version: number; from: readonly string[]; to: string; actor: Actor; eventType: string; reason?: string | null; approverId?: string | null; metadata?: Record<string, unknown>; statusField?: string; data?: Record<string, unknown>; audit?: Record<string, unknown> }) {
  const statusField = spec.statusField ?? 'status'
  if (!COLUMN.test(statusField)) throw new Error('Invalid status field')
  const result = await delegateOf(uow.tx, spec.model).updateMany({
    where: { id: spec.id, version: spec.version, [statusField]: { in: [...spec.from] } },
    data: { ...(spec.data ?? {}), [statusField]: spec.to, version: { increment: 1 } },
  })
  if (result.count !== 1) throw new DomainError(Codes.STALE_STATE, `${spec.model} changed since you loaded it. Reload and try again.`, { currentVersion: spec.version, to: spec.to })
  uow.audit({
    eventType: spec.eventType, entityType: spec.model, entityId: spec.id,
    actorUserId: actorUserId(spec.actor), actorAgentId: actorAgentId(spec.actor), approverId: spec.approverId ?? null, reason: spec.reason ?? null,
    before: { [statusField]: spec.from.length === 1 ? spec.from[0] : spec.from, version: spec.version },
    after: { [statusField]: spec.to, version: spec.version + 1, ...(spec.audit ?? spec.data ?? {}) },
    metadata: { ...(spec.metadata ?? {}), ...(spec.actor.kind === 'system' ? { system: spec.actor.name } : {}) },
  })
  return spec.version + 1
}

/** Audit a create done by a command (so every row's origin is in the chain). */
export function auditCreate(uow: UnitOfWork, actor: Actor, model: string, id: string, eventType: string, after: unknown, extra: { reason?: string | null; metadata?: Record<string, unknown> } = {}) {
  uow.audit({
    eventType,
    entityType: model,
    entityId: id,
    actorUserId: actorUserId(actor),
    actorAgentId: actorAgentId(actor),
    reason: extra.reason ?? null,
    after,
    metadata: { ...(extra.metadata ?? {}), ...(actor.kind === 'system' ? { system: actor.name } : {}) },
  })
}
