import DecimalJs from 'decimal.js'

/**
 * The only decimal type in server code (SCHEMA G3). A private clone so no other module's
 * configuration can change ours: 60 significant digits, half-even rounding, no exponent notation
 * in the ranges we store.
 */
export const Decimal = DecimalJs.clone({
  precision: 60,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 60,
})
export type Decimal = InstanceType<typeof Decimal>
export type DecimalInput = Decimal | string | bigint | number | { toString(): string }

/** Database column scales (SCHEMA G3). */
export const Scale = { qty: 6, rate: 6, wt: 4, geo: 6 } as const
export type ScaleName = keyof typeof Scale

const DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/**
 * Parse an exact decimal. Strings and bigints are exact. A JS number is accepted only when it is a
 * safe integer (counts, bps); a fractional number is refused because it is already a float.
 */
export function dec(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value
  if (typeof value === 'bigint') return new Decimal(value.toString())
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`Refusing float ${value}: pass the exact decimal as a string`)
    return new Decimal(value)
  }
  const text = String(value).trim()
  if (!DECIMAL_TEXT.test(text)) throw new Error(`Not a decimal number: ${JSON.stringify(text).slice(0, 40)}`)
  return new Decimal(text)
}

/** Parse, or null when missing or malformed. */
export function decOrNull(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') return null
  try { return dec(value as DecimalInput) } catch { return null }
}

/** Round to a column scale with half-even (the posting rule), returning the exact string to store. */
export function toScale(value: DecimalInput, scale: ScaleName | number, rounding: DecimalJs.Rounding = Decimal.ROUND_HALF_EVEN): string {
  const places = typeof scale === 'number' ? scale : Scale[scale]
  return dec(value).toDecimalPlaces(places, rounding).toFixed(places)
}

/** Plain string with trailing zeros removed ("12.5000" → "12.5"). */
export const plain = (value: DecimalInput) => dec(value).toFixed()

export const ZERO = new Decimal(0)
export const ONE = new Decimal(1)
export const BPS = new Decimal(10_000)

/** value × bps / 10 000. */
export const applyBps = (value: DecimalInput, bps: number) => dec(value).times(dec(bps)).div(BPS)

/** A fraction (0.0123) as whole basis points (123), half-even. Exact: parsed from the integer text, never via a float. */
export function toBpsInt(fraction: DecimalInput): number {
  const text = dec(fraction).times(BPS).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0)
  const n = Number.parseInt(text, 10)
  if (!Number.isSafeInteger(n)) throw new RangeError(`Basis points out of range: ${text}`)
  return n
}

export const decMin = (...values: DecimalInput[]) => values.map(dec).reduce((a, b) => (b.lt(a) ? b : a))
export const decMax = (...values: DecimalInput[]) => values.map(dec).reduce((a, b) => (b.gt(a) ? b : a))
export const decSum = (values: DecimalInput[]) => values.map(dec).reduce((a, b) => a.plus(b), ZERO)

/** Exact pound → kilogram factor (international avoirdupois pound, D§4.3). */
export const KG_PER_LB = new Decimal('0.45359237')

/** Convert a weight to kilograms exactly, then round to the `wt` column scale. */
export function toKg(value: DecimalInput, unit: 'kg' | 'lb' | 'g'): Decimal {
  const v = dec(value)
  if (v.isNegative()) throw new RangeError('A weight cannot be negative')
  const kg = unit === 'kg' ? v : unit === 'lb' ? v.times(KG_PER_LB) : v.div(1000)
  return kg.toDecimalPlaces(Scale.wt, Decimal.ROUND_HALF_EVEN)
}
