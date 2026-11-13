import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ageClassOf, convertValue, flagFor, parseLabFile, pickRange, resultHash, reviewSlaHours, worstFlag, type Range } from './lab'
import { bpsOf, csvCell, money, parseRules, payrollCsv, productionBase, ruleHash, totalsByStaff } from './pay'

const range = (over: Partial<Range> = {}): Range => ({ speciesId: 'dog', ageClass: 'adult', labId: null, low: '10', high: '20', criticalLow: '5', criticalHigh: '40', unit: 'U/L', ...over })

describe('age class', () => {
  it('juvenile under a year, senior from seven', () => {
    expect(ageClassOf({ weeks: 20, months: 4 })).toBe('juvenile')
    expect(ageClassOf({ weeks: 52, months: 12 })).toBe('adult')
    expect(ageClassOf({ weeks: 400, months: 83 })).toBe('adult')
    expect(ageClassOf({ weeks: 400, months: 84 })).toBe('senior')
    expect(ageClassOf(null)).toBeNull()
  })
})

describe('reference range choice', () => {
  const ranges = [range({ ageClass: 'any', low: '1' }), range({ ageClass: 'adult', low: '2' }), range({ ageClass: 'adult', labId: 'lab1', low: '3' }), range({ speciesId: 'cat', low: '9' })]
  it('same lab and exact age class beat a general range', () => {
    expect(pickRange(ranges, 'dog', 'adult', 'lab1')?.low).toBe('3')
    expect(pickRange(ranges, 'dog', 'adult', 'lab2')?.low).toBe('2')
    expect(pickRange(ranges, 'dog', 'senior', 'lab1')?.low).toBe('1')
  })
  it('never uses another species', () => {
    expect(pickRange(ranges, 'rabbit', 'adult', null)).toBeNull()
    expect(pickRange(ranges, 'cat', 'adult', null)?.low).toBe('9')
  })
})

describe('flags', () => {
  const r = { low: '10', high: '20', criticalLow: '5', criticalHigh: '40' }
  it('compares exactly at the edges', () => {
    expect(flagFor('10', r)).toBe('normal')
    expect(flagFor('20', r)).toBe('normal')
    expect(flagFor('9.999999', r)).toBe('low')
    expect(flagFor('20.000001', r)).toBe('high')
    expect(flagFor('4.9', r)).toBe('critical_low')
    expect(flagFor('41', r)).toBe('critical_high')
    expect(flagFor(null, r)).toBe('normal')
    expect(flagFor('3', null)).toBe('normal')
  })
  it('the worst flag wins and sets the review deadline', () => {
    expect(worstFlag(['normal', 'high', 'critical_low', 'low'])).toBe('critical_low')
    expect(worstFlag([])).toBe('normal')
    expect(reviewSlaHours('high')).toBe(4)
    expect(reviewSlaHours('normal')).toBe(24)
  })
  it('property: a value inside [low, high] is normal and one outside is not', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), v => {
      const f = flagFor(String(v), { low: '10', high: '20', criticalLow: null, criticalHigh: null })
      return (v >= 10 && v <= 20) === (f === 'normal')
    }))
  })
})

describe('unit conversion', () => {
  it('factor and offset, exact', () => {
    expect(convertValue('88.5', { factor: '0.0113' })).toBe('1.000050')
    expect(convertValue('100', { factor: '0.5', offset: '2' })).toBe('52.000000')
    expect(convertValue('7.1', null)).toBe('7.100000')
  })
})

describe('lab file parsing', () => {
  it('reads a CSV with quoted cells and groups by accession', () => {
    const csv = 'Accession,Code,Value,Unit,Status\nA1,ALT,45,U/L,F\nA1,CREA,"1.2",mg/dL,F\nA2,ALT,<10,U/L,P\nA2,COMMENT,"Lipemic, mild",,F\n'
    const reports = parseLabFile(csv)
    expect(reports.map(r => [r.accession, r.status, r.lines.length])).toEqual([['A1', 'final', 2], ['A2', 'final', 2]])
    expect(reports[1].lines.find(l => l.code === 'COMMENT')?.text).toBe('Lipemic, mild')
    expect(reports[1].lines.find(l => l.code === 'ALT')?.value).toBe('10')
  })
  it('reads HL7 OBX lines', () => {
    const hl7 = 'MSH|^~\\&|LAB|X|||||ORU^R01\rOBR|1||ACC9|CBC\rOBX|1|NM|HCT^Hematocrit||38.2|%|37-55||||C\rOBX|2|NM|WBC^WBC||12|K/uL|||||C'
    const [r] = parseLabFile(hl7)
    expect(r.accession).toBe('ACC9')
    expect(r.status).toBe('corrected')
    expect(r.lines.map(l => l.code)).toEqual(['HCT', 'WBC'])
  })
  it('refuses a file it cannot read', () => {
    expect(() => parseLabFile('')).toThrow()
    expect(() => parseLabFile('a,b\n1,2')).toThrow(/accession/)
  })
  it('the same lines in another order hash the same; any change differs', () => {
    const a = [{ code: 'ALT', value: '45', unit: 'U/L' }, { code: 'CREA', value: '1.2', unit: 'mg/dL' }]
    expect(resultHash('A1', 'final', a)).toBe(resultHash('A1', 'final', [...a].reverse()))
    expect(resultHash('A1', 'final', a)).not.toBe(resultHash('A1', 'corrected', a))
    expect(resultHash('A1', 'final', a)).not.toBe(resultHash('A2', 'final', a))
  })
})

describe('production arithmetic', () => {
  it('golden: 20% of $145.00, half-even on the half cent', () => {
    expect(bpsOf(14_500n, 2000)).toBe(2_900n)
    expect(bpsOf(5n, 5000)).toBe(2n) // 2.5 → 2 (even)
    expect(bpsOf(7n, 5000)).toBe(4n) // 3.5 → 4 (even)
    expect(bpsOf(-14_500n, 2000)).toBe(-2_900n)
    expect(bpsOf(0n, 10_000)).toBe(0n)
  })
  it('refuses basis points out of range', () => {
    expect(() => bpsOf(100n, -1)).toThrow()
    expect(() => bpsOf(100n, 10_001)).toThrow()
    expect(() => bpsOf(100n, 12.5)).toThrow()
  })
  it('property: never more than the base, never negative for a positive base, 100% returns the base', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), fc.integer({ min: 0, max: 10_000 }), (base, bps) => {
      const c = bpsOf(base, bps)
      return c >= 0n && c <= base && bpsOf(base, 10_000) === base
    }))
  })
  it('property: the credit is within half a cent of the exact share', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 1_000_000_000n }), fc.integer({ min: 0, max: 10_000 }), (base, bps) => {
      const c = bpsOf(base, bps)
      const diff = (c * 10_000n - base * BigInt(bps))
      return (diff < 0n ? -diff : diff) * 2n <= 10_000n
    }))
  })
  it('a reversed line counts for nothing; a discount lowers the base', () => {
    expect(productionBase({ extendedMinor: 10_000n, discountMinor: 1_000n, reversedAt: null })).toBe(9_000n)
    expect(productionBase({ extendedMinor: 10_000n, discountMinor: 0n, reversedAt: new Date() })).toBe(0n)
  })
  it('rules need a basis and whole basis points', () => {
    expect(parseRules({ laboratory: { basis: 'ordered', bps: 500 } }).laboratory.bps).toBe(500)
    expect(() => parseRules({ x: { basis: 'who', bps: 1 } })).toThrow()
    expect(() => parseRules({ x: { basis: 'ordered', bps: 20000 } })).toThrow()
    expect(ruleHash({ a: 1, b: 2 }, {})).toBe(ruleHash({ b: 2, a: 1 }, {}))
  })
})

describe('totals and the payroll file', () => {
  it('sums per staff member, adjustments included, in a stable order', () => {
    const t = totalsByStaff([{ staffId: 'b', amountMinor: 500n }, { staffId: 'a', amountMinor: 300n }, { staffId: 'a', amountMinor: -100n }], [{ staffId: 'b', amountMinor: 40n }])
    expect(t).toEqual([{ staffId: 'a', productionMinor: '200', commissionMinor: '0' }, { staffId: 'b', productionMinor: '500', commissionMinor: '40' }])
  })
  it('money prints whole cents with a sign', () => {
    expect(money(5n)).toBe('0.05')
    expect(money(-12_345n)).toBe('-123.45')
  })
  it('golden CSV, formula cells neutralised, same bytes every time', () => {
    const rows = [{ staffId: 's2', name: '=cmd|x', employeeRef: 'employee', productionMinor: 2_900n, commissionMinor: 0n }, { staffId: 's1', name: 'Dr. "Ann" Lee', employeeRef: 'employee', productionMinor: 100n, commissionMinor: 40n }]
    const csv = payrollCsv({ ref: 'PAY-1', startsOn: '2026-11-01', endsOn: '2026-11-15' }, rows)
    expect(csv).toBe([
      'period,starts_on,ends_on,staff_id,employee_ref,name,production,commission,total',
      'PAY-1,2026-11-01,2026-11-15,s1,employee,"Dr. ""Ann"" Lee",1.00,0.40,1.40',
      "PAY-1,2026-11-01,2026-11-15,s2,employee,'=cmd|x,29.00,0.00,29.00",
      '',
    ].join('\n'))
    expect(payrollCsv({ ref: 'PAY-1', startsOn: '2026-11-01', endsOn: '2026-11-15' }, [...rows].reverse())).toBe(csv)
    expect(csvCell('-1+1')).toBe("'-1+1")
  })
})
