import { GraphQLError } from 'graphql'
import { isDomainError } from '../lib/errors'

// Business-rule messages reach the caller with their stable code; database and driver detail never does.
const UNSAFE = /prisma|invocation|\bat\s+\S+\s*\(|node_modules|postgres(ql)?:\/\/|\bSQL\b|ECONN|query engine|\.ts:\d+|\.js:\d+/i
const SAFE_DETAIL_KEYS = new Set(['currentStatus', 'currentVersion', 'to', 'reason', 'field', 'problems', 'replay'])

export const op = <A, R>(fn: (root: unknown, args: A, context: any) => Promise<R>) => async (root: unknown, args: A, context: any): Promise<R> => {
  try {
    return await fn(root, args, context)
  } catch (error: any) {
    if (error instanceof GraphQLError) throw error
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
