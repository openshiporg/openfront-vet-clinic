import { toJsonValue } from './canonical'
import { type Db } from './db'
import { principalKey, type Actor } from './actor'
import { claimReceipt, writeReceipt } from './idempotency'
import { runInTransaction, type UnitOfWork } from './unitOfWork'

/**
 * A command is one idempotent business operation. Same key + same principal + same request returns
 * the stored response without running again; the receipt commits with the effects.
 * Deadlocks are retried a few times (the whole transaction re-runs, so nothing half-applies).
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

const RETRYABLE = /deadlock detected|could not serialize|P2034|40P01|40001/i

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
      throw error
    }
  }
}
