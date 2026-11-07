/**
 * Business-day calendars (SCHEMA §19, DOMAIN §6). Dates are "YYYY-MM-DD" strings in the calendar's own
 * time zone; a date never implies a time. Unknown years fail closed: a calendar only answers inside
 * its coverage, so no legal clock is computed on a guess.
 *
 * US-FED is the federal holiday calendar (5 U.S.C. 6103, with the Saturday→Friday / Sunday→Monday
 * observance rule of Executive Order 11582 as applied by OPM). It drives the DEA "one business day"
 * theft/loss notice (21 CFR 1301.76(b)) and other federal clocks. A location calendar composes it and
 * adds its own closures. The table is generated from the statute's rules and pinned by a test.
 */

export type CalendarSpec = {
  code: string
  timeZone: string
  weekendDays: number[]
  regularOpen: string
  regularClose: string
  holidays: ReadonlySet<string>
  earlyCloses: ReadonlyMap<string, string>
  coverageThrough: string
}

const FEDERAL_HOLIDAYS = [
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24', '2027-12-31',
  '2028-01-17', '2028-02-21', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-10-09', '2028-11-10', '2028-11-23', '2028-12-25',
]

export const US_FED: CalendarSpec = {
  code: 'US-FED',
  timeZone: 'America/New_York',
  weekendDays: [0, 6],
  regularOpen: '09:00',
  regularClose: '17:00',
  holidays: new Set(FEDERAL_HOLIDAYS),
  earlyCloses: new Map(),
  coverageThrough: '2028-12-31',
}
export const US_FED_SOURCE = '5 U.S.C. 6103 federal holidays with OPM observance rules, 2026-2028'
export const US_FED_HOLIDAYS = FEDERAL_HOLIDAYS

/**
 * A location's calendar: its own zone and hours, the federal holidays plus its own closures. Coverage
 * is the federal coverage, so a location clock past it fails closed too.
 */
export function locationCalendar(input: { code: string; timeZone: string; regularOpen?: string; regularClose?: string; closures?: string[]; weekendDays?: number[] }): CalendarSpec {
  return {
    code: input.code,
    timeZone: input.timeZone,
    weekendDays: input.weekendDays ?? [0, 6],
    regularOpen: input.regularOpen ?? '08:00',
    regularClose: input.regularClose ?? '18:00',
    holidays: new Set([...FEDERAL_HOLIDAYS, ...(input.closures ?? [])]),
    earlyCloses: new Map(),
    coverageThrough: US_FED.coverageThrough,
  }
}

/** The federal holidays of a year computed from the statute (used to pin the table above). */
export function federalHolidaysFor(year: number): string[] {
  const iso = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const dow = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d)).getUTCDay()
  const nth = (m: number, weekday: number, n: number) => { let d = 1; while (dow(m, d) !== weekday) d += 1; return d + 7 * (n - 1) }
  const last = (m: number, weekday: number) => { let d = new Date(Date.UTC(year, m, 0)).getUTCDate(); while (dow(m, d) !== weekday) d -= 1; return d }
  const observed = (m: number, d: number) => {
    const t = Date.UTC(year, m - 1, d); const w = dow(m, d)
    const shift = w === 6 ? -1 : w === 0 ? 1 : 0
    return new Date(t + shift * 86_400_000).toISOString().slice(0, 10)
  }
  const out = [
    observed(1, 1), iso(1, nth(1, 1, 3)), iso(2, nth(2, 1, 3)), iso(5, last(5, 1)), observed(6, 19), observed(7, 4),
    iso(9, nth(9, 1, 1)), iso(10, nth(10, 1, 2)), observed(11, 11), iso(11, nth(11, 4, 4)), observed(12, 25),
  ]
  // New Year's Day on a Saturday is observed on the previous 31 December.
  const nextNewYear = new Date(Date.UTC(year + 1, 0, 1)).getUTCDay() === 6 ? [`${year}-12-31`] : []
  return [...out, ...nextNewYear].filter(d => d.startsWith(String(year))).sort()
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function assertDate(date: string) {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error(`Invalid date ${date}`)
}

export function addDays(date: string, days: number) {
  assertDate(date)
  const t = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

function covered(calendar: CalendarSpec, date: string) {
  if (date > calendar.coverageThrough) throw new Error(`${calendar.code} has no verified schedule for ${date}`)
}

export function isBusinessDay(calendar: CalendarSpec, date: string) {
  assertDate(date)
  covered(calendar, date)
  return !calendar.weekendDays.includes(weekday(date)) && !calendar.holidays.has(date)
}

export function nextBusinessDay(calendar: CalendarSpec, date: string) {
  let d = addDays(date, 1)
  while (!isBusinessDay(calendar, d)) d = addDays(d, 1)
  return d
}

export function previousBusinessDay(calendar: CalendarSpec, date: string) {
  let d = addDays(date, -1)
  while (!isBusinessDay(calendar, d)) d = addDays(d, -1)
  return d
}

/** A date + n business days (the DEA one-business-day notice = addBusinessDays(cal, discoveryDate, 1)). */
export function addBusinessDays(calendar: CalendarSpec, date: string, n: number) {
  let d = date
  for (let i = 0; i < Math.abs(n); i += 1) d = n > 0 ? nextBusinessDay(calendar, d) : previousBusinessDay(calendar, d)
  return d
}

/** Business days in (from, to]. */
export function businessDaysBetween(calendar: CalendarSpec, from: string, to: string) {
  let count = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isBusinessDay(calendar, d)) count += 1
  return count
}

const zoneParts = (timeZone: string, at: number) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(p => [p.type, p.value]))

/** The calendar-local date of an instant (the clinic's day, never the server's midnight). */
export function localDate(calendar: Pick<CalendarSpec, 'timeZone'>, at: Date | number) {
  const p = zoneParts(calendar.timeZone, typeof at === 'number' ? at : at.getTime())
  return `${p.year}-${p.month}-${p.day}`
}

/** The UTC instant of a local wall-clock time on a date in the calendar's zone (DST-safe). */
export function zonedInstant(timeZone: string, date: string, hhmm: string) {
  assertDate(date)
  const [h, m] = hhmm.split(':').map(x => Number.parseInt(x, 10))
  let guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
  for (let i = 0; i < 3; i += 1) {
    const p = zoneParts(timeZone, guess)
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
    const target = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m)
    const diff = target - local
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

export type Session = { date: string; businessDay: boolean; phase: 'open' | 'closed'; opensAt: Date; closesAt: Date; earlyClose: boolean }

/** The regular session containing (or on the local date of) an instant. */
export function sessionAt(calendar: CalendarSpec, at: Date | number): Session {
  const t = typeof at === 'number' ? at : at.getTime()
  const date = localDate(calendar, t)
  const businessDay = isBusinessDay(calendar, date)
  const close = calendar.earlyCloses.get(date) ?? calendar.regularClose
  const opensAt = zonedInstant(calendar.timeZone, date, calendar.regularOpen)
  const closesAt = zonedInstant(calendar.timeZone, date, close)
  const phase = businessDay && t >= opensAt.getTime() && t < closesAt.getTime() ? 'open' : 'closed'
  return { date, businessDay, phase, opensAt, closesAt, earlyClose: calendar.earlyCloses.has(date) }
}
