import { createHash } from 'node:crypto'

/*
 * Production and pay (STATE-MACHINES §20). Pure arithmetic in whole minor units: a credit is a percentage, in basis points,
 * of what a charge line brought in before tax (price less discount), rounded half-even to the cent. Nothing here uses a float.
 */

export type ProductionRule = { basis: 'performed' | 'ordered'; bps: number }
export type RuleSet = Record<string, ProductionRule>

/** base × bps ÷ 10 000, half-even, for any sign. */
export function bpsOf(baseMinor: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error('Basis points must be a whole number from 0 to 10000.')
  const n = baseMinor * BigInt(bps)
  const d = 10_000n
  const neg = n < 0n
  const abs = neg ? -n : n
  let q = abs / d
  const r = abs % d
  if (r * 2n > d || (r * 2n === d && q % 2n === 1n)) q += 1n
  return neg ? -q : q
}

/** What a charge line counts for: price less discount, before tax. A reversed line counts for nothing. */
export const productionBase = (line: { extendedMinor: bigint; discountMinor: bigint; reversedAt: Date | null }) => (line.reversedAt ? 0n : line.extendedMinor - line.discountMinor)

export function parseRules(value: unknown): RuleSet {
  const out: RuleSet = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [category, raw] of Object.entries(value as Record<string, unknown>)) {
    const r = raw as { basis?: unknown; bps?: unknown }
    if ((r?.basis !== 'performed' && r?.basis !== 'ordered') || typeof r.bps !== 'number' || !Number.isInteger(r.bps) || r.bps < 0 || r.bps > 10_000) {
      throw new Error(`The production rule for "${category}" needs a basis (performed or ordered) and whole basis points from 0 to 10000.`)
    }
    out[category] = { basis: r.basis, bps: r.bps }
  }
  return out
}

export function parseCommissionRules(value: unknown): Record<string, { bps: number }> {
  const out: Record<string, { bps: number }> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [source, raw] of Object.entries(value as Record<string, unknown>)) {
    const bps = (raw as { bps?: unknown })?.bps
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`The commission rule for "${source}" needs whole basis points from 0 to 10000.`)
    out[source] = { bps }
  }
  return out
}

export const ruleHash = (rules: unknown, commissionRules: unknown) =>
  createHash('sha256').update(JSON.stringify([sortKeys(rules), sortKeys(commissionRules)])).digest('hex')

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]))
  return value
}

export type StaffTotal = { staffId: string; productionMinor: string; commissionMinor: string }

/** Sum lines per staff member. Adjustments are negative or positive lines already in the list. */
export function totalsByStaff(production: { staffId: string; amountMinor: bigint }[], commission: { staffId: string; amountMinor: bigint }[]): StaffTotal[] {
  const map = new Map<string, { p: bigint; c: bigint }>()
  for (const l of production) { const e = map.get(l.staffId) ?? { p: 0n, c: 0n }; e.p += l.amountMinor; map.set(l.staffId, e) }
  for (const l of commission) { const e = map.get(l.staffId) ?? { p: 0n, c: 0n }; e.c += l.amountMinor; map.set(l.staffId, e) }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([staffId, e]) => ({ staffId, productionMinor: e.p.toString(), commissionMinor: e.c.toString() }))
}

export const totalsHash = (totals: StaffTotal[]) => createHash('sha256').update(JSON.stringify(totals)).digest('hex')

const cell = (value: string) => {
  // A spreadsheet treats a leading = + - @ as a formula: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
export const money = (minor: bigint) => `${minor < 0n ? '-' : ''}${(minor < 0n ? -minor : minor) / 100n}.${String((minor < 0n ? -minor : minor) % 100n).padStart(2, '0')}`

/** The payroll file: one row per staff member. Lines are sorted so the same period always gives the same bytes. */
export function payrollCsv(period: { ref: string; startsOn: string; endsOn: string }, rows: { staffId: string; name: string; employeeRef: string; productionMinor: bigint; commissionMinor: bigint }[]) {
  const header = ['period', 'starts_on', 'ends_on', 'staff_id', 'employee_ref', 'name', 'production', 'commission', 'total']
  const lines = [...rows].sort((a, b) => a.staffId.localeCompare(b.staffId)).map(r =>
    [period.ref, period.startsOn, period.endsOn, r.staffId, r.employeeRef, r.name, money(r.productionMinor), money(r.commissionMinor), money(r.productionMinor + r.commissionMinor)].map(cell).join(','))
  return [header.join(','), ...lines].join('\n') + '\n'
}

export const csvHash = (csv: string) => createHash('sha256').update(csv).digest('hex')
export { cell as csvCell }
