import { createHash } from 'node:crypto'
import { plain } from './decimal'

/**
 * Canonical JSON: object keys sorted, undefined dropped, bigint and Decimal-like values as strings,
 * dates as ISO-8601. The same logical value always hashes the same, whatever the key order.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot hold a non-finite number')
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    // decimal.js and Prisma.Decimal both expose toFixed(); keep the exact text, never a float.
    const decimalLike = value as { isFinite?: () => boolean; isNaN?: () => boolean; toString(): string }
    if (typeof decimalLike.isFinite === 'function' && typeof decimalLike.isNaN === 'function') return plain(decimalLike.toString())
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  throw new Error(`Canonical JSON cannot hold a ${typeof value}`)
}

export const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value))

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Hash of the canonical form: binds approvals and idempotency keys to an exact payload. */
export const payloadHash = (value: unknown) => sha256(canonicalJson(value))

/** JSON-safe copy for json() fields (bigint and Decimal become strings). */
export const toJsonValue = <T = unknown>(value: unknown) => canonicalize(value) as T
