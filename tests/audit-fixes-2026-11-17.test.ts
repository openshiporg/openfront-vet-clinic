import { describe, expect, it } from 'vitest'
import { nightsStayed } from '../features/keystone/domain/boarding'
import { creditReturnedByRefund, depositHeld, periodHasEnded } from '../features/keystone/domain/billing'
import { localDate } from '../features/keystone/lib/calendar'

describe('boarding nights charged at check-out', () => {
  it('an evening check-in is charged from the clinic\'s day, not the UTC date', () => {
    // 2026-11-10 17:30 Pacific is 2026-11-11 01:30 UTC.
    const arrived = localDate({ timeZone: 'America/Los_Angeles' }, new Date('2026-11-11T01:30:00Z'))
    expect(arrived).toBe('2026-11-10')
    expect(nightsStayed(arrived, '2026-11-10', '2026-11-13', '2026-11-13')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })
  it('keeps the existing rules: early pick-up, same-day pick-up, early arrival', () => {
    expect(nightsStayed('2026-11-10', '2026-11-10', '2026-11-13', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11'])
    expect(nightsStayed('2026-11-10', '2026-11-10', '2026-11-13', '2026-11-10')).toEqual(['2026-11-10'])
    expect(nightsStayed('2026-11-09', '2026-11-10', '2026-11-12', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11'])
  })
})

describe('refund after a credit note', () => {
  it('a fully credited, fully refunded invoice is not owed again', () => {
    // $100 paid, $100 credit note (held on account), $100 refund: all of the refund is that credit.
    expect(creditReturnedByRefund(10000n, 10000n, 10000n)).toBe(10000n)
  })
  it('only the credited part comes off the account; the rest is owed on the invoice', () => {
    expect(creditReturnedByRefund(10000n, 3000n, 3000n)).toBe(3000n)
    expect(creditReturnedByRefund(2000n, 3000n, 3000n)).toBe(2000n)
  })
  it('never takes more than the account holds, and nothing when there was no credit note', () => {
    expect(creditReturnedByRefund(10000n, 3000n, 1000n)).toBe(1000n)
    expect(creditReturnedByRefund(10000n, 0n, 5000n)).toBe(0n)
    expect(creditReturnedByRefund(10000n, 3000n, -1n)).toBe(0n)
  })
})

describe('closing a month', () => {
  it('is refused until its last day has passed', () => {
    expect(periodHasEnded('2026-11-30', '2026-11-17')).toBe(false)
    expect(periodHasEnded('2026-11-30', '2026-11-30')).toBe(false)
    expect(periodHasEnded('2026-11-30', '2026-12-01')).toBe(true)
  })
})

describe('a refunded deposit', () => {
  it('holds nothing once it is refunded in full, so check-out does not apply it', () => {
    expect(depositHeld(5000n, 5000n)).toBe(0n)
    expect(depositHeld(5000n, 6000n)).toBe(0n)
  })
  it('holds the rest after a part refund, and all of it with no refund', () => {
    expect(depositHeld(5000n, 2000n)).toBe(3000n)
    expect(depositHeld(5000n, 0n)).toBe(5000n)
  })
})
