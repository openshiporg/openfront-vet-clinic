import { createHash } from 'node:crypto'

/*
 * Wellness plan rules that need no database: month arithmetic, the period a charge belongs to, the
 * California auto-renewal disclosure the cardholder agrees to, and the entitlement list of a plan.
 */

export type Entitlement = { code: string; label: string; qty: number; retailValueMinor: bigint }

/** `2026-11-12` plus whole months, clamped to the end of a short month (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export const monthOf = (date: string) => date.slice(0, 7)

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** The months a term is billed for: from the month it starts to the month of its last day. */
export function termMonthsOf(startsOn: string, endsOn: string): string[] {
  const out: string[] = []
  const last = monthOf(addDays(endsOn, -1))
  for (let m = monthOf(startsOn); m <= last; m = monthOf(addMonths(`${m}-01`, 1))) out.push(m)
  return out
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const periodLabel = (key: string) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const dollars = (minor: bigint) => `$${(minor / 100n).toLocaleString('en-US')}.${String(minor % 100n).padStart(2, '0')}`

/**
 * What the person agrees to when they enrol (California Business & Professions Code §17600 and following): the price,
 * that it renews by itself, how to stop it, and when they will be told before it renews. The exact text is stored with
 * the consent and its hash; a change to the plan makes a new version, never a changed disclosure.
 */
export function disclosureText(input: { planName: string; monthlyPriceMinor: bigint; termMonths: number; renewalNoticeDays: number; practiceName: string; cancelNote?: string }): string {
  const price = dollars(input.monthlyPriceMinor)
  const total = dollars(input.monthlyPriceMinor * BigInt(input.termMonths))
  return [
    `${input.planName} is a ${input.termMonths}-month wellness plan from ${input.practiceName}. It costs ${price} a month (${total} over the term), charged to the card you save today.`,
    `The plan renews automatically at the end of each ${input.termMonths}-month term at the price then in force, and your card is charged each month, until you cancel.`,
    `We will write to you at least ${input.renewalNoticeDays} days before a term renews, with the price and how to cancel.`,
    `You can cancel at any time online in your client portal or at the front desk. Cancelling stops future monthly charges. If you have used more included care than you have paid for, you owe the difference at the usual prices (shown to you before you cancel).`,
    input.cancelNote ? input.cancelNote : '',
    'By saving your card and ticking the box you agree to these terms and allow the monthly charges.',
  ].filter(Boolean).join('\n\n')
}

export const disclosureHash = (text: string) => createHash('sha256').update(text).digest('hex')

export function parseEntitlements(value: unknown): Entitlement[] {
  if (!Array.isArray(value)) return []
  const out: Entitlement[] = []
  for (const raw of value) {
    const r = raw as Record<string, unknown>
    const code = String(r?.code ?? '').trim()
    const qty = Number.parseInt(String(r?.qty), 10)
    if (!code || !Number.isInteger(qty) || qty < 0) continue
    out.push({ code, label: String(r.label ?? code), qty, retailValueMinor: BigInt(String(r.retailValueMinor ?? '0').replace(/\D/g, '') || '0') })
  }
  return out
}

/** Whole weeks and months of age on a given day. */
export function ageOn(dob: Date | null, on: string) {
  if (!dob) return null
  const born = dob.toISOString().slice(0, 10)
  const weeks = Math.floor((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${born}T00:00:00Z`)) / (7 * 86_400_000))
  const [by, bm, bd] = born.split('-').map(Number)
  const [oy, om, od] = on.split('-').map(Number)
  const months = (oy - by) * 12 + (om - bm) - (od < bd ? 1 : 0)
  return { weeks, months }
}
