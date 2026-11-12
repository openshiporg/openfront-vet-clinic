import { dec, toScale } from '../lib/decimal'

/*
 * Pure billing arithmetic. Money is bigint minor units; quantities are exact decimals; a rate is a
 * decimal string. Nothing here touches a float, a clock or the database.
 */

export type TaxRules = { baseRate: string; taxableCategories: string[]; exemptCategories: string[] }

/** A Decimal already rounded to whole minor units → bigint, with no float on the way. */
function wholeMinor(d: ReturnType<typeof dec>): bigint {
  return BigInt(d.toString().split('.')[0] || '0')
}

/**
 * Sales tax on one line (STATE-MACHINES §11, the `sales_tax` pack). A category the pack lists as taxable
 * pays the base rate on the price after discount; an exempt one pays nothing; one the pack does not list
 * is refused, because guessing a tax treatment is worse than stopping.
 *   Rx animal drugs are exempt (verify CDTFA Reg. 1591.1 for animal medicines).
 */
export function taxOn(rules: TaxRules, taxCategory: string, netMinor: bigint): bigint {
  if (rules.exemptCategories.includes(taxCategory)) return 0n
  if (!rules.taxableCategories.includes(taxCategory)) throw new Error(`No sales tax treatment for ${taxCategory}`)
  if (netMinor <= 0n) return 0n
  return wholeMinor(dec(netMinor.toString()).times(dec(rules.baseRate)).toDecimalPlaces(0, 6))
}

/** unit price × quantity, half-even to a minor unit, never below a minimum charge. */
export function extend(qty: string, unitPriceMinor: bigint, minimumChargeMinor: bigint | null = null): bigint {
  const raw = wholeMinor(dec(qty).times(dec(unitPriceMinor.toString())).toDecimalPlaces(0, 6))
  return minimumChargeMinor !== null && raw > 0n && raw < minimumChargeMinor ? minimumChargeMinor : raw
}

/** A basis-point adjustment (negative = discount), half-even. */
export function adjustBps(amountMinor: bigint, bps: number): bigint {
  return wholeMinor(dec(amountMinor.toString()).times(dec(bps)).div(10_000).toDecimalPlaces(0, 6))
}

export type EstimateLineInput = { qtyLow: string; qtyHigh: string; unitPriceMinor: bigint; optional?: boolean }

export function estimateLineRange(line: EstimateLineInput) {
  if (dec(line.qtyLow).lt(0) || dec(line.qtyLow).gt(dec(line.qtyHigh))) throw new Error('The low quantity cannot be more than the high quantity')
  return { lowMinor: extend(line.qtyLow, line.unitPriceMinor), highMinor: extend(line.qtyHigh, line.unitPriceMinor) }
}

/** An option's range: optional lines count to the high end only. */
export function optionTotals(lines: { lowMinor: bigint; highMinor: bigint; optional?: boolean }[]) {
  let low = 0n
  let high = 0n
  for (const l of lines) {
    if (!l.optional) low += l.lowMinor
    high += l.highMinor
  }
  return { lowTotalMinor: low, highTotalMinor: high }
}

export const DEPOSIT_BASES = ['low', 'high'] as const
/** The deposit for elective work: the practice's fraction of the low (or high) end, rounded half-even. */
export function depositFor(totals: { lowTotalMinor: bigint; highTotalMinor: bigint }, fraction: string, basis: string): bigint {
  const base = basis === 'high' ? totals.highTotalMinor : totals.lowTotalMinor
  return wholeMinor(dec(base.toString()).times(dec(fraction)).toDecimalPlaces(0, 6))
}

/** Will adding `addMinor` to what a plan has used stay within the ceiling the client accepted? */
export const withinCeiling = (usedMinor: bigint, addMinor: bigint, acceptedHighMinor: bigint) => usedMinor + addMinor <= acceptedHighMinor

export const AGE_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

/** Whole days from `dueOn` to `asOf` (YYYY-MM-DD) → ageing bucket. Posted day is the due day: balances are due on receipt. */
export function ageBucket(postedOn: string, asOf: string): AgeBucket {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${postedOn}T00:00:00Z`)) / 86_400_000)
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}

/** Split a payment across open invoices oldest first; what is left over stays unallocated (client credit). */
export function allocateOldestFirst(amountMinor: bigint, open: { id: string; balanceMinor: bigint }[]) {
  let left = amountMinor
  const out: { id: string; amountMinor: bigint }[] = []
  for (const inv of open) {
    if (left <= 0n) break
    const take = inv.balanceMinor < left ? inv.balanceMinor : left
    if (take > 0n) { out.push({ id: inv.id, amountMinor: take }); left -= take }
  }
  return { allocations: out, remainderMinor: left }
}

export const quantityText = (v: string) => toScale(dec(v), 'qty')
