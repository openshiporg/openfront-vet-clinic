/**
 * Practice-day helpers for the screens. Days are the practice's local calendar days; the bounds are
 * the UTC instants of local midnight, so a day sheet in Sacramento is right across DST changes.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

export const validDate = (value: string | undefined, fallback: string) => (value && DATE.test(value) ? value : fallback)

export function addDaysTo(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Offset (minutes) of `timeZone` at instant `at`. */
function offsetMinutes(timeZone: string, at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** The UTC instant of local midnight starting `date` in `timeZone`. */
export function localMidnight(date: string, timeZone: string) {
  const guess = new Date(`${date}T00:00:00Z`)
  const first = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60_000)
  return new Date(guess.getTime() - offsetMinutes(timeZone, first) * 60_000)
}

export const dayBounds = (date: string, timeZone: string) => ({ from: localMidnight(date, timeZone).toISOString(), to: localMidnight(addDaysTo(date, 1), timeZone).toISOString() })

/** Years/months of age from a YYYY-MM-DD date of birth. */
export function ageText(dob: string | null | undefined, today: string) {
  if (!dob) return ''
  const [y, m] = dob.slice(0, 10).split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const months = (ty - y) * 12 + (tm - m)
  if (months < 0) return ''
  return months < 24 ? `${months} mo` : `${Math.floor(months / 12)} y`
}

export const ALERT_TONE: Record<string, string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200',
}
