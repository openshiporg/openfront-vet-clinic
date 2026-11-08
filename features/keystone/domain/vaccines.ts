import { addDays } from '../lib/calendar'

/*
 * Vaccine and reminder rules (DOMAIN I-V1–I-V3, STATE-MACHINES §18). Pure functions over dates
 * (YYYY-MM-DD, the location's calendar day) so the job and the command agree to the day.
 */

/** Add calendar months; the 31st rolls back to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export function ageInWeeks(dateOfBirth: string, on: string): number {
  const ms = Date.parse(`${on}T00:00:00Z`) - Date.parse(`${dateOfBirth}T00:00:00Z`)
  return Math.floor(ms / (7 * 86_400_000))
}

export type VaccineGuardInput = {
  product: { name: string; isRabies: boolean; minAgeWeeks: number; speciesCodes: string[]; active: boolean }
  lot: { lotNumber: string; expiresOn: string; status: string } | null
  patient: { speciesCode: string | null; dateOfBirth: string | null; status: string }
  on: string
  rabiesPolicy: { firstDoseMinAgeWeeks: number } | null
  giverKind: string | null
  supervisingDvmPresent: boolean
}

/** The guard list from SM§18. Returns problems; empty means the vaccine may be given. */
export function vaccineProblems(input: VaccineGuardInput): string[] {
  const problems: string[] = []
  if (input.patient.status !== 'active') problems.push(`The patient is ${input.patient.status}.`)
  if (!input.product.active) problems.push(`${input.product.name} is not an active product.`)
  if (!input.lot) problems.push('Choose the lot the dose came from.')
  else {
    if (input.lot.status !== 'available') problems.push(`Lot ${input.lot.lotNumber} is ${input.lot.status}.`)
    if (input.lot.expiresOn < input.on) problems.push(`Lot ${input.lot.lotNumber} expired on ${input.lot.expiresOn}.`)
  }
  if (input.product.speciesCodes.length && (!input.patient.speciesCode || !input.product.speciesCodes.includes(input.patient.speciesCode))) {
    problems.push(`${input.product.name} is not labelled for this species.`)
  }
  const minWeeks = Math.max(input.product.minAgeWeeks, input.product.isRabies && input.rabiesPolicy ? input.rabiesPolicy.firstDoseMinAgeWeeks : 0)
  if (input.patient.dateOfBirth && ageInWeeks(input.patient.dateOfBirth, input.on) < minWeeks) {
    problems.push(`The patient is under the minimum age (${minWeeks} weeks) for ${input.product.name}.`)
  }
  if (input.product.isRabies && input.giverKind !== 'dvm' && !input.supervisingDvmPresent) {
    problems.push('A rabies vaccine is given by a veterinarian or under a supervising veterinarian; name the supervising veterinarian.')
  }
  if (input.product.isRabies && !input.rabiesPolicy) problems.push('No rabies policy is in force for this location.')
  return problems
}

/**
 * I-V2: duration of immunity is the product label capped by the jurisdiction; the first rabies dose
 * (no prior rabies on record) is always boosted at the pack's `boosterAfterFirstMonths` (1 year).
 */
export function vaccineDuration(input: { labelMonths: number; isRabies: boolean; priorRabiesDoses: number; rabiesPolicy: { maxDurationMonths: number; boosterAfterFirstMonths: number } | null; seriesIntervalWeeks?: number | null }) {
  if (input.seriesIntervalWeeks) return { months: 0, weeks: input.seriesIntervalWeeks, reason: 'initial_series' as const }
  if (input.isRabies && input.rabiesPolicy) {
    if (input.priorRabiesDoses === 0) return { months: Math.min(input.labelMonths, input.rabiesPolicy.boosterAfterFirstMonths), weeks: 0, reason: 'first_rabies_dose' as const }
    return { months: Math.min(input.labelMonths, input.rabiesPolicy.maxDurationMonths), weeks: 0, reason: 'label_capped' as const }
  }
  return { months: input.labelMonths, weeks: 0, reason: 'label' as const }
}

export function dueDate(on: string, duration: { months: number; weeks: number }) {
  return duration.weeks ? addDays(on, duration.weeks * 7) : addMonths(on, duration.months)
}

/** Is this a dose in the puppy/kitten initial series (under the rule's untilAgeWeeks)? */
export function inInitialSeries(schedule: { initialSeries?: { doses: number; intervalWeeks: number; untilAgeWeeks: number } } | null, dateOfBirth: string | null, on: string) {
  const s = schedule?.initialSeries
  if (!s || !dateOfBirth) return null
  return ageInWeeks(dateOfBirth, on) < s.untilAgeWeeks ? s : null
}

/** Reminder state on a date (SM§18): scheduled → due → overdue → lapsed. Terminal states stay. */
export function reminderStatusOn(r: { dueOn: string; status: string }, rule: { leadDays: number; graceDays: number; lapseDays: number }, on: string) {
  if (['satisfied', 'suppressed'].includes(r.status)) return r.status
  if (on >= addDays(r.dueOn, rule.lapseDays)) return 'lapsed'
  if (on >= addDays(r.dueOn, rule.graceDays)) return 'overdue'
  if (on >= addDays(r.dueOn, -rule.leadDays)) return 'due'
  return 'scheduled'
}

/** Certificate fields from the rabies policy, filled from the administration snapshot; missing listed. */
export function rabiesCertificateFields(required: string[], snapshot: Record<string, string | null | undefined>) {
  const fields: Record<string, string> = {}
  const missing: string[] = []
  for (const name of required) {
    const value = snapshot[name]
    if (value && String(value).trim()) fields[name] = String(value)
    else missing.push(name)
  }
  return { fields, missing }
}

/** A calendar day as people read it ("Dec 1, 2026"); date-only values never shift with time zone. */
export function calendarDayText(isoDay: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay ?? '')
  if (!m) return isoDay ?? ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
}
