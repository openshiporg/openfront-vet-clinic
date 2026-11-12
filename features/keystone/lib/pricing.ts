import type { Tx } from './db'
import { DomainError, Codes } from './errors'
import { extend, adjustBps, taxOn, type TaxRules } from '../domain/billing'
import { resolvePolicy } from '../domain/policy'

/*
 * Prices come from the published fee schedule version in force. A charge, an estimate line and a plan
 * item all copy the price at the moment they are made, so a later fee change never rewrites them.
 */

export const STANDARD_SCHEDULE = 'standard'

/** The published version of the practice's standard fee schedule. */
export async function activeFeeVersion(tx: Tx) {
  const version = await tx.feeScheduleVersion.findFirst({ where: { status: 'published', schedule: { code: STANDARD_SCHEDULE } }, orderBy: { versionNo: 'desc' }, select: { id: true, versionNo: true } })
  if (!version) throw new DomainError(Codes.GUARD_FAILED, 'No fee schedule is published yet. Publish one before pricing work.', { reason: 'no_fee_schedule' })
  return version
}

export type FeeMatch = { drugId?: string | null; vaccineId?: string | null; orderKind?: string | null; code?: string | null; category?: string | null }

export async function feeItemFor(tx: Tx, versionId: string, match: FeeMatch) {
  const where = match.drugId ? { drugId: match.drugId } : match.vaccineId ? { vaccineId: match.vaccineId } : match.code ? { code: match.code } : match.orderKind ? { orderKind: match.orderKind } : match.category ? { category: match.category } : null
  if (!where) return null
  return tx.feeItem.findFirst({ where: { versionId, active: true, ...where }, orderBy: { code: 'asc' } })
}

/** Surcharge rules in the version that apply to this visit (emergency, after hours, ...). */
export async function surchargeBps(tx: Tx, versionId: string, ctx: { emergency: boolean }) {
  const rules = await tx.priceRule.findMany({ where: { versionId }, select: { kind: true, adjustmentBps: true } })
  return rules.filter(r => (r.kind === 'emergency' ? ctx.emergency : false)).reduce((n, r) => n + r.adjustmentBps, 0)
}

export async function taxRulesFor(tx: Tx, locationId: string, on: string): Promise<TaxRules> {
  const policy = await resolvePolicy(tx, 'sales_tax', { locationId, on })
  return policy.rules as TaxRules
}

type FeeRow = { unitPriceMinor?: bigint; priceMinor: bigint; minimumChargeMinor: bigint | null; dispensingFeeMinor: bigint | null; injectionFeeMinor: bigint | null; taxCategory: string }

/** What one charge costs: quantity × unit price (minimum charge, surcharge), plus the dispensing or injection fee, and its tax. */
export function priceCharge(fee: FeeRow, qty: string, opts: { surchargeBps?: number; dispensing?: boolean; injection?: boolean; discountBps?: number; taxRules: TaxRules }) {
  let extended = extend(qty, fee.priceMinor, fee.minimumChargeMinor)
  if (opts.dispensing && fee.dispensingFeeMinor) extended += fee.dispensingFeeMinor
  if (opts.injection && fee.injectionFeeMinor) extended += fee.injectionFeeMinor
  if (opts.surchargeBps) extended += adjustBps(extended, opts.surchargeBps)
  const discount = opts.discountBps ? -adjustBps(extended, -opts.discountBps) : 0n
  const tax = taxOn(opts.taxRules, fee.taxCategory, extended - discount)
  return { extendedMinor: extended, discountMinor: discount, taxMinor: tax }
}
