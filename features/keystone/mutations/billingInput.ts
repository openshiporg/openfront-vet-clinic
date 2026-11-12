import { DomainError, Codes } from '../lib/errors'

/** Input checks shared by the billing commands. Money arrives as digit text in minor units; a day as YYYY-MM-DD. */

export const dateOnly = (value: unknown, field: string) => {
  const t = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field })
  return t
}

export function minorText(value: unknown, field: string, allowZero = false): bigint {
  const t = String(value ?? '').trim()
  if (!/^\d{1,12}$/.test(t)) throw new DomainError(Codes.INVALID_INPUT, `${field} is a whole number of cents.`, { field })
  const n = BigInt(t)
  if (n === 0n && !allowZero) throw new DomainError(Codes.INVALID_INPUT, `${field} must be more than zero.`, { field })
  return n
}

export const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (!(allowed as readonly string[]).includes(String(value))) throw new DomainError(Codes.INVALID_INPUT, `Choose a valid ${field}.`, { field })
  return value as T
}

/** The money settings the billing commands read, with the defaults the schema gives. */
export async function billingSettings(uow: { tx: any }) {
  const p = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { currencyCode: true, estimateValidityDays: true, electiveDepositPct: true, depositBasis: true, refundApprovalThresholdMinor: true, discountApprovalThresholdBps: true, writeOffRequiresApproval: true } })
  return {
    currencyCode: (p?.currencyCode as string | undefined) || 'USD',
    estimateValidityDays: (p?.estimateValidityDays as number | null | undefined) ?? 30,
    electiveDepositPct: p?.electiveDepositPct ? p.electiveDepositPct.toString() : null,
    depositBasis: (p?.depositBasis as string | undefined) ?? 'low',
    refundApprovalThresholdMinor: (p?.refundApprovalThresholdMinor as bigint | undefined) ?? 25_000n,
    discountApprovalThresholdBps: (p?.discountApprovalThresholdBps as number | null | undefined) ?? 1_000,
    writeOffRequiresApproval: p?.writeOffRequiresApproval !== false,
  }
}
