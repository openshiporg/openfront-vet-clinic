import { describe, expect, it } from 'vitest'
import { addBusinessDays, businessDaysBetween, federalHolidaysFor, isBusinessDay, localDate, locationCalendar, nextBusinessDay, sessionAt, US_FED, US_FED_HOLIDAYS } from './calendar'

const SAC = locationCalendar({ code: 'CCAH-MAIN', timeZone: 'America/Los_Angeles', regularOpen: '07:30', regularClose: '18:00', closures: ['2026-12-24'] })

describe('federal business-day calendar', () => {
  it('matches 5 U.S.C. 6103 with the observance rule for every covered year', () => {
    const computed = [2026, 2027, 2028].flatMap(federalHolidaysFor)
    expect([...US_FED_HOLIDAYS].sort()).toEqual(computed.sort())
    expect(federalHolidaysFor(2027)).toContain('2027-12-31') // New Year 2028 falls on a Saturday
    expect(federalHolidaysFor(2026)).toContain('2026-07-03') // Independence Day on a Saturday
  })

  it('computes the DEA one-business-day theft/loss notice over weekends and holidays', () => {
    expect(addBusinessDays(US_FED, '2026-11-25', 1)).toBe('2026-11-27') // Thanksgiving in between
    expect(addBusinessDays(US_FED, '2026-11-06', 1)).toBe('2026-11-09') // Friday → Monday
    expect(addBusinessDays(US_FED, '2026-11-10', 1)).toBe('2026-11-12') // Veterans Day
    expect(nextBusinessDay(US_FED, '2026-07-02')).toBe('2026-07-06')
    expect(businessDaysBetween(US_FED, '2026-11-20', '2026-11-30')).toBe(5)
  })

  it('fails closed past its verified coverage', () => {
    expect(() => isBusinessDay(US_FED, '2029-01-02')).toThrow(/no verified schedule/)
    expect(() => addBusinessDays(SAC, '2028-12-29', 2)).toThrow(/no verified schedule/)
  })
})

describe('location calendar', () => {
  it('composes federal holidays with its own closures', () => {
    expect(isBusinessDay(SAC, '2026-11-26')).toBe(false)
    expect(isBusinessDay(SAC, '2026-12-24')).toBe(false)
    expect(isBusinessDay(US_FED, '2026-12-24')).toBe(true)
  })

  it('opens at 07:30 Sacramento time on both sides of daylight saving', () => {
    expect(sessionAt(SAC, Date.parse('2026-10-30T18:00:00Z')).opensAt.toISOString()).toBe('2026-10-30T14:30:00.000Z')
    expect(sessionAt(SAC, Date.parse('2026-11-02T18:00:00Z')).opensAt.toISOString()).toBe('2026-11-02T15:30:00.000Z')
    expect(sessionAt(SAC, Date.parse('2026-11-02T15:29:59Z')).phase).toBe('closed')
    expect(sessionAt(SAC, Date.parse('2026-11-02T15:30:00Z')).phase).toBe('open')
  })

  it("uses the clinic's date, not UTC midnight", () => {
    expect(localDate(SAC, Date.parse('2026-11-03T05:00:00Z'))).toBe('2026-11-02')
  })
})
