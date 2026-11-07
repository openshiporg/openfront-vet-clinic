import { canonicalize, payloadHash, toJsonValue } from './canonical'
import { advisoryLock, type Tx } from './db'
import { DomainError, Codes } from './errors'

/**
 * Command receipts (SCHEMA §14 CommandReceipt; restaurant idempotency.ts adapted). A command runs
 * at most once per idempotency key. The receipt is written in the same transaction as the command's
 * effects, so a crash before commit leaves neither, and a retry runs the command again from scratch.
 * The key is bound to the principal and the exact request: reusing it for anything else is refused.
 */

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/

export function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !key.trim()) throw new DomainError(Codes.IDEMPOTENCY_KEY_REQUIRED, 'An idempotency key is required.')
  if (!IDEMPOTENCY_KEY.test(key)) throw new DomainError(Codes.INVALID_INPUT, 'The idempotency key must be 8 to 200 letters, digits or . _ : -')
}

export type Receipt = { replay: true; responseBody: unknown } | { replay: false }

/** Locks the key for the rest of the transaction and returns the stored response on replay. */
export async function claimReceipt(tx: Tx, input: { key: string; command: string; principalKey: string; params: unknown }): Promise<Receipt> {
  assertIdempotencyKey(input.key)
  await advisoryLock(tx, `command:${input.key}`)
  const existing = await tx.commandReceipt.findUnique({ where: { idempotencyKey: input.key } })
  if (!existing) return { replay: false }
  const requestHash = payloadHash(input.params)
  if (existing.command !== input.command || existing.principalKey !== input.principalKey || existing.requestHash !== requestHash) {
    throw new DomainError(Codes.IDEMPOTENCY_KEY_REUSED, 'This idempotency key was already used for a different request.')
  }
  return { replay: true, responseBody: existing.responseBody }
}

export async function writeReceipt(tx: Tx, input: { key: string; command: string; principalKey: string; params: unknown; response: unknown; now: Date }) {
  await tx.commandReceipt.create({
    data: {
      idempotencyKey: input.key,
      command: input.command,
      principalKey: input.principalKey,
      requestHash: payloadHash(input.params),
      requestParams: toJsonValue(canonicalize(input.params)) as never,
      responseCode: 'ok',
      responseBody: toJsonValue(input.response) as never,
      recoveryPoint: 'completed',
      completedAt: input.now,
    },
  })
}
