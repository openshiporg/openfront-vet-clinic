import { GraphQLError } from 'graphql'
import { Codes, DomainError, isDomainError } from '../lib/errors'
import { invariantError } from '../lib/command'

// Business-rule messages reach the caller with their stable code; database and driver detail never does.
const UNSAFE = /prisma|invocation|\bat\s+\S+\s*\(|node_modules|postgres(ql)?:\/\/|\bSQL\b|ECONN|query engine|\.ts:\d+|\.js:\d+/i
const SAFE_DETAIL_KEYS = new Set(['currentStatus', 'currentVersion', 'to', 'reason', 'field', 'problems', 'replay'])

/**
 * M7: database and Prisma refusals become readable DomainErrors. The constraint name is kept (it is
 * ours, not a secret); SQL, hosts and stack frames never leave the server.
 */
export function prismaToDomain(error: any): DomainError | null {
  if (isDomainError(error)) return error
  const guarded = invariantError(error)
  if (guarded) return guarded
  const code = String(error?.code ?? error?.extensions?.prisma?.code ?? '')
  const meta = error?.meta ?? error?.extensions?.prisma?.meta ?? {}
  const target = Array.isArray(meta?.target) ? meta.target.join(', ') : String(meta?.target ?? '')
  switch (code) {
    case 'P2002': return new DomainError(Codes.GUARD_FAILED, `That ${target && !/[_"]/.test(target) ? target : 'value'} is already in use.`, { reason: 'unique' })
    case 'P2003': return new DomainError(Codes.NOT_FOUND, 'A linked record does not exist.', { reason: 'foreign_key' })
    case 'P2025': return new DomainError(Codes.NOT_FOUND, 'The record was not found or changed meanwhile. Reload and try again.', { reason: 'not_found' })
    case 'P2000': return new DomainError(Codes.INVALID_INPUT, 'A value is too long.', { reason: 'too_long' })
    case 'P2006': case 'P2007': case 'P2009': case 'P2012': case 'P2019': return new DomainError(Codes.INVALID_INPUT, 'A value has the wrong form.', { reason: 'invalid' })
    case 'P2034': return new DomainError(Codes.STALE_STATE, 'Someone else changed this at the same moment. Try again.', { reason: 'conflict' })
  }
  const message = String(error?.message ?? '')
  if (/23505|unique constraint/i.test(message)) return new DomainError(Codes.GUARD_FAILED, 'That value is already in use.', { reason: /constraint "([A-Za-z0-9_]+)"/.exec(message)?.[1] ?? 'unique' })
  if (/23503|foreign key/i.test(message)) return new DomainError(Codes.NOT_FOUND, 'A linked record does not exist.', { reason: 'foreign_key' })
  return null
}

export const op = <A, R>(fn: (root: unknown, args: A, context: any) => Promise<R>) => async (root: unknown, args: A, context: any): Promise<R> => {
  try {
    return await fn(root, args, context)
  } catch (raw: any) {
    if (raw instanceof GraphQLError && raw.extensions?.code !== 'KS_PRISMA_ERROR') throw raw
    const error = prismaToDomain(raw) ?? raw
    if (isDomainError(error)) {
      const details = Object.fromEntries(Object.entries(error.details).filter(([key]) => SAFE_DETAIL_KEYS.has(key)))
      throw new GraphQLError(error.message, { extensions: { code: error.code, ...details } })
    }
    const message = typeof error?.message === 'string' ? error.message : ''
    console.error('Operation failed:', message.slice(0, 300).replace(/postgres(ql)?:\/\/\S+/g, '<url>'))
    const safe = message && message.length <= 300 && !UNSAFE.test(message) && !error?.code
    throw new GraphQLError(safe ? message : 'Unable to complete the request. Please try again.', { extensions: { code: 'KS_USER_INPUT_ERROR' } })
  }
}

/** Every command takes an idempotency key from the client (a UUID per user intent). */
export const requireKey = (key: unknown) => String(key ?? '')
