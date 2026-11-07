import type { Prisma, PrismaClient } from '@prisma/client'

export type Db = PrismaClient
export type Tx = Prisma.TransactionClient

/** Transaction-scoped advisory lock (released at commit or rollback). */
export async function advisoryLock(tx: Tx, key: string) {
  // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}

const MODEL_NAME = /^[A-Z][A-Za-z0-9]*$/

/** Guard for list names interpolated into raw SQL: only a Keystone list key is accepted. */
export function tableName(model: string) {
  if (!MODEL_NAME.test(model)) throw new Error(`Invalid model name: ${model.slice(0, 40)}`)
  return `"${model}"`
}

/** The Prisma delegate for a list key ("BrokerOrder" → tx.brokerOrder). */
export function delegateOf(tx: Tx, model: string) {
  tableName(model)
  const delegate = (tx as unknown as Record<string, unknown>)[model[0].toLowerCase() + model.slice(1)]
  if (!delegate) throw new Error(`Unknown model: ${model}`)
  return delegate as {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
}

export const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const
