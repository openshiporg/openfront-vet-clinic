import { dec, Decimal, type DecimalInput } from './decimal'

/**
 * Money that posts to a ledger is integer minor units (bigint) plus an ISO-4217 code (SCHEMA G2).
 * Conversions between a decimal amount and minor units round half-even, and only here.
 */

const MINOR_DIGITS: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CHF: 2, CAD: 2, AUD: 2, SEK: 2, JPY: 0, KRW: 0, BHD: 3, KWD: 3 }

export const isCurrencyCode = (code: unknown): code is string => typeof code === 'string' && /^[A-Z]{3}$/.test(code)

export function minorDigits(currencyCode: string): number {
  if (!isCurrencyCode(currencyCode)) throw new Error(`Invalid currency code: ${String(currencyCode).slice(0, 8)}`)
  return MINOR_DIGITS[currencyCode] ?? 2
}

/** A decimal amount (e.g. "1234.565") to minor units, half-even: 123456n for USD. */
export function toMinor(amount: DecimalInput, currencyCode = 'USD', rounding = Decimal.ROUND_HALF_EVEN): bigint {
  const digits = minorDigits(currencyCode)
  const scaled = dec(amount).times(new Decimal(10).pow(digits)).toDecimalPlaces(0, rounding)
  return BigInt(scaled.toFixed(0))
}

/** Minor units to an exact decimal amount. */
export function fromMinor(minor: bigint, currencyCode = 'USD'): Decimal {
  return dec(minor).div(new Decimal(10).pow(minorDigits(currencyCode)))
}

/** "1,234.56" style text with an explicit currency, for screens and statements. */
export function formatMinor(minor: bigint, currencyCode = 'USD'): string {
  const digits = minorDigits(currencyCode)
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const base = 10n ** BigInt(digits)
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = digits ? '.' + (abs % base).toString().padStart(digits, '0') : ''
  const symbol = currencyCode === 'USD' ? '$' : `${currencyCode} `
  return `${negative ? '−' : ''}${symbol}${whole}${fraction}`
}

/** Parse a stored bigint column (Prisma returns bigint; GraphQL returns string). */
export function minorOf(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  throw new Error('Not an integer minor-unit amount')
}

export const sumMinor = (values: bigint[]) => values.reduce((a, b) => a + b, 0n)

/**
 * Split `total` minor units across weights with the largest-remainder method: every share is the
 * floor of its exact pro-rata amount, and the leftover units go one each to the largest
 * remainders (ties: the earlier index). The shares always sum exactly to `total`.
 */
export function allocateMinor(total: bigint, weights: DecimalInput[]): bigint[] {
  if (weights.length === 0) throw new Error('allocateMinor needs at least one weight')
  const w = weights.map(dec)
  if (w.some(x => x.isNegative())) throw new Error('allocateMinor weights must be non-negative')
  const weightSum = w.reduce((a, b) => a.plus(b), new Decimal(0))
  if (weightSum.isZero()) throw new Error('allocateMinor weights must not all be zero')
  const negative = total < 0n
  const abs = negative ? -total : total
  const exact = w.map(x => dec(abs).times(x).div(weightSum))
  const floors = exact.map(x => BigInt(x.floor().toFixed(0)))
  let leftover = abs - floors.reduce((a, b) => a + b, 0n)
  const order = exact.map((x, index) => ({ index, remainder: x.minus(x.floor()) }))
    .sort((a, b) => (b.remainder.comparedTo(a.remainder) || a.index - b.index))
  const shares = [...floors]
  for (let i = 0; leftover > 0n; i = (i + 1) % order.length, leftover -= 1n) shares[order[i].index] += 1n
  return negative ? shares.map(x => -x) : shares
}
