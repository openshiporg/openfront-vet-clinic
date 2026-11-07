import { toJsonValue } from './canonical'
import { type Db } from './db'
import { principalKey, type Actor } from './actor'
import { claimReceipt, writeReceipt } from './idempotency'
import { runInTransaction, type UnitOfWork } from './unitOfWork'
import { DomainError, Codes, isDomainError } from './errors'

/**
 * The database is the last line for invariants (exclusion, check and trigger guards). Their errors
 * become stable domain codes; the constraint name is kept for the caller, never the SQL.
 */
export function invariantError(error: unknown): DomainError | null {
  if (isDomainError(error)) return null
  const message = error instanceof Error ? error.message : String(error)
  const constraint = /constraint "([A-Za-z0-9_]+)"/.exec(message)?.[1] ?? ''
  if (/23P01|exclusion constraint|_no_overlap/.test(message)) return new DomainError(Codes.SLOT_TAKEN, 'That time was just taken. Pick another slot.', { reason: constraint || 'overlap' })
  const raised = /(?:ERROR|Message): ?`?([^`\n]*(?:cannot|can't|never|must|needs|frozen|append-only)[^`\n]*)/i.exec(message)?.[1]
  if (raised) return new DomainError(Codes.GUARD_FAILED, raised.trim().slice(0, 240), { reason: 'database_guard' })
  if (/23514|check constraint/.test(message)) return new DomainError(Codes.GUARD_FAILED, `A database rule refused this change (${constraint || 'check'}).`, { reason: constraint || 'check' })
  return null
}

/**
 * A command is one idempotent business operation. Same key + same principal + same request returns
 * the stored response without running again; the receipt commits with the effects.
 * Deadlocks and transactions that could not start are retried a few times (the whole transaction re-runs, so nothing half-applies).
 */
export type CommandSpec = {
  name: string
  actor: Actor
  idempotencyKey: string
  params: unknown
  requestId?: string | null
  now?: Date
}

export type CommandResult<T> = { replay: boolean; value: T }

// P2028: the transaction never started (pool wait) or was closed by timeout: nothing applied, so a retry is safe.
const RETRYABLE = /deadlock detected|could not serialize|P2034|P2028|40P01|40001/i

export async function command<T>(db: Db, spec: CommandSpec, work: (uow: UnitOfWork) => Promise<T>): Promise<CommandResult<T>> {
  const principal = principalKey(spec.actor)
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runInTransaction(db, async uow => {
        const receipt = await claimReceipt(uow.tx, { key: spec.idempotencyKey, command: spec.name, principalKey: principal, params: spec.params })
        if (receipt.replay) return { replay: true, value: receipt.responseBody as T }
        const value = toJsonValue<T>(await work(uow))
        await writeReceipt(uow.tx, { key: spec.idempotencyKey, command: spec.name, principalKey: principal, params: spec.params, response: value, now: uow.now })
        return { replay: false, value }
      }, { requestId: spec.requestId ?? null, now: spec.now })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = (error as { code?: string })?.code ?? ''
      if (attempt < 4 && (RETRYABLE.test(message) || RETRYABLE.test(code))) continue
      throw invariantError(error) ?? error
    }
  }
}
