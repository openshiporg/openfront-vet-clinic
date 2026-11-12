import { describe, expect, it } from 'vitest'
import { adjustBps, ageBucket, allocateOldestFirst, depositFor, estimateLineRange, extend, optionTotals, taxOn, withinCeiling } from './billing'

const CA = { baseRate: '0.0725', taxableCategories: ['retail_product', 'diet', 'otc_parasiticide', 'supplies', 'merchandise'], exemptCategories: ['professional_service', 'rx_animal_drug', 'vaccine_administered', 'boarding', 'grooming'] }

describe('tax matrix', () => {
  it('services and Rx drugs are not taxed; retail goods are, half-even', () => {
    expect(taxOn(CA, 'professional_service', 12_000n)).toBe(0n)
    expect(taxOn(CA, 'rx_animal_drug', 8_000n)).toBe(0n)
    expect(taxOn(CA, 'diet', 6_499n)).toBe(471n)
    expect(taxOn(CA, 'retail_product', 0n)).toBe(0n)
  })
  it('refuses a category the pack does not know', () => expect(() => taxOn(CA, 'mystery', 100n)).toThrow(/No sales tax/))
})

describe('estimate arithmetic', () => {
  it('a line range and an option range, optional lines on the high end only', () => {
    const a = estimateLineRange({ qtyLow: '1', qtyHigh: '1', unitPriceMinor: 28_500n })
    const b = estimateLineRange({ qtyLow: '1', qtyHigh: '2.5', unitPriceMinor: 4_000n })
    expect(b).toEqual({ lowMinor: 4_000n, highMinor: 10_000n })
    expect(optionTotals([a, { ...b, optional: true }])).toEqual({ lowTotalMinor: 28_500n, highTotalMinor: 38_500n })
  })
  it('low above high is refused', () => expect(() => estimateLineRange({ qtyLow: '3', qtyHigh: '2', unitPriceMinor: 1n })).toThrow())
  it('deposit is the practice fraction of the low end', () => expect(depositFor({ lowTotalMinor: 85_000n, highTotalMinor: 110_000n }, '0.5', 'low')).toBe(42_500n))
  it('the ceiling holds exactly at the accepted high', () => {
    expect(withinCeiling(90_000n, 20_000n, 110_000n)).toBe(true)
    expect(withinCeiling(90_000n, 20_001n, 110_000n)).toBe(false)
  })
})

describe('pricing', () => {
  it('minimum charge applies below it only', () => {
    expect(extend('0.25', 4_000n, 2_500n)).toBe(2_500n)
    expect(extend('2', 4_000n, 2_500n)).toBe(8_000n)
  })
  it('discounts and surcharges in basis points', () => {
    expect(adjustBps(10_000n, -1_000)).toBe(-1_000n)
    expect(adjustBps(10_000n, 5_000)).toBe(5_000n)
  })
})

describe('receivables', () => {
  it('ageing buckets', () => {
    expect(ageBucket('2026-11-11', '2026-11-11')).toBe('current')
    expect(ageBucket('2026-10-12', '2026-11-11')).toBe('d1_30')
    expect(ageBucket('2026-09-12', '2026-11-11')).toBe('d31_60')
    expect(ageBucket('2026-08-13', '2026-11-11')).toBe('d61_90')
    expect(ageBucket('2026-05-01', '2026-11-11')).toBe('d90_plus')
  })
  it('allocates oldest first and keeps the remainder', () => {
    const r = allocateOldestFirst(10_000n, [{ id: 'a', balanceMinor: 6_000n }, { id: 'b', balanceMinor: 3_000n }, { id: 'c', balanceMinor: 5_000n }])
    expect(r.allocations).toEqual([{ id: 'a', amountMinor: 6_000n }, { id: 'b', amountMinor: 3_000n }, { id: 'c', amountMinor: 1_000n }])
    expect(allocateOldestFirst(9_000n, [{ id: 'a', balanceMinor: 4_000n }]).remainderMinor).toBe(5_000n)
  })
})
