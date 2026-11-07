import { describe, expect, it } from 'vitest'
import { mergeLayers, POLICY_KIND_NAMES, POLICY_SCHEMAS, selectAndMerge, validateLayer, type CandidateVersion } from './policy'
import { isValidDeaNumber } from './licensure'
import { POLICY_PACKS } from '../seed/policies'
import { DEA_REGISTRATIONS } from '../seed/practice'

const v = (over: Partial<CandidateVersion>): CandidateVersion => ({
  id: 'v', packCode: 'US/vcpr', layer: 'federal', status: 'published', effectiveFrom: '2026-01-01', effectiveTo: null,
  rules: {}, verified: true, unverifiedRules: [], ...over,
})

const FED_VCPR = { establishment: 'in_person_only', level: 'dvm', requiredFor: ['prescription'] }
const CA_VCPR = { establishment: 'in_person_or_telehealth', durationMonths: 12, level: 'practice' }

describe('policy resolution fails closed', () => {
  it('merges federal → state → local, objects deep, arrays and scalars whole', () => {
    expect(mergeLayers([{ a: 1, o: { x: 1, y: 2 }, l: [1, 2] }, { a: 2, o: { y: 3 }, l: [9] }])).toEqual({ a: 2, o: { x: 1, y: 3 }, l: [9] })
    const r = selectAndMerge('vcpr', '2026-06-01', ['US-CA/vcpr', 'US/vcpr'], [
      v({ id: 'ca', packCode: 'US-CA/vcpr', layer: 'state', rules: CA_VCPR, verified: false, unverifiedRules: ['durationMonths'] }),
      v({ id: 'fed', rules: FED_VCPR }),
    ])
    expect(r.rules).toMatchObject({ establishment: 'in_person_or_telehealth', durationMonths: 12, level: 'practice', requiredFor: ['prescription'] })
    expect(r.versions.map(x => x.id)).toEqual(['fed', 'ca'])
    expect(r.verified).toBe(false)
    expect(r.unverifiedRules).toEqual(['US-CA/vcpr:durationMonths'])
  })

  it('refuses when nothing is bound, nothing is in force, two versions overlap, or the merge is incomplete', () => {
    expect(() => selectAndMerge('vcpr', '2026-06-01', [], [])).toThrow(expect.objectContaining({ code: 'POLICY_UNRESOLVED' }))
    expect(() => selectAndMerge('vcpr', '2025-06-01', ['US/vcpr'], [v({ rules: { ...FED_VCPR, durationMonths: 12 } })])).toThrow(expect.objectContaining({ code: 'POLICY_UNRESOLVED' }))
    expect(() => selectAndMerge('vcpr', '2026-06-01', ['US/vcpr'], [v({ rules: { ...FED_VCPR, durationMonths: 12 }, status: 'draft' })])).toThrow(expect.objectContaining({ code: 'POLICY_UNRESOLVED' }))
    expect(() => selectAndMerge('vcpr', '2026-06-01', ['US/vcpr'], [v({ id: 'a', rules: { ...FED_VCPR, durationMonths: 12 } }), v({ id: 'b', rules: { ...FED_VCPR, durationMonths: 12 }, effectiveFrom: '2026-03-01' })])).toThrow(expect.objectContaining({ code: 'POLICY_AMBIGUOUS' }))
    // Federal alone lacks durationMonths: an incomplete policy never resolves to a guess.
    expect(() => selectAndMerge('vcpr', '2026-06-01', ['US/vcpr'], [v({ rules: FED_VCPR })])).toThrow(expect.objectContaining({ code: 'POLICY_UNRESOLVED' }))
    expect(() => selectAndMerge('vcpr', '2026-6-1', ['US/vcpr'], [])).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('effectiveTo is exclusive: the next version takes over that day', () => {
    const rules = { ...FED_VCPR, durationMonths: 12 }
    const cands = [v({ id: 'old', rules, effectiveTo: '2026-07-01' }), v({ id: 'new', rules: { ...rules, durationMonths: 24 }, effectiveFrom: '2026-07-01' })]
    expect(selectAndMerge('vcpr', '2026-06-30', ['US/vcpr'], cands).versions[0].id).toBe('old')
    expect(selectAndMerge('vcpr', '2026-07-01', ['US/vcpr'], cands).rules.durationMonths).toBe(24)
  })

  it('rejects unknown keys and wrong shapes in a layer before it is stored', () => {
    expect(() => validateLayer('vcpr', { establishment: 'whenever' })).toThrow(/not valid/)
    expect(() => validateLayer('vcpr', { surprise: true })).toThrow(/not valid/)
    expect(validateLayer('vcpr', { durationMonths: 12 })).toEqual({ durationMonths: 12 })
  })

  it('every seeded pack is valid for its kind, cites sources, and the seed covers every kind at the California locations', () => {
    for (const pack of POLICY_PACKS) {
      expect(() => validateLayer(pack.kind, pack.rules), pack.code).not.toThrow()
      expect(pack.sourceRefs.length, pack.code).toBeGreaterThan(0)
      if (pack.unverified.length) expect(pack.verifiedAt === null || pack.unverified.length > 0).toBe(true)
    }
    const kinds = new Set(POLICY_PACKS.map(p => p.kind))
    for (const kind of POLICY_KIND_NAMES) expect(kinds.has(kind), kind).toBe(true)
    // Each kind's layers, merged as the California locations see them, pass the full schema.
    for (const kind of POLICY_KIND_NAMES) {
      const layers = POLICY_PACKS.filter(p => p.kind === kind && (p.bind === 'practice' || p.jurisdiction === 'US-CA')).sort((a, b) => ['federal', 'state', 'local'].indexOf(a.layer) - ['federal', 'state', 'local'].indexOf(b.layer))
      const merged = mergeLayers(layers.map(l => l.rules))
      const parsed = POLICY_SCHEMAS[kind].safeParse(merged)
      expect(parsed.success, `${kind}: ${parsed.success ? '' : parsed.error.issues.map(i => i.path.join('.')).join(', ')}`).toBe(true)
    }
  })

  it('CII prescriptions can never carry refills under the federal pack', () => {
    const fed = POLICY_PACKS.find(p => p.code === 'US/prescription')!.rules as { refillLimits: Record<string, { maxRefills: number }> }
    expect(fed.refillLimits.CII.maxRefills).toBe(0)
    expect(fed.refillLimits.CIIN.maxRefills).toBe(0)
    expect(fed.refillLimits.CIII.maxRefills).toBe(5)
  })
})

describe('DEA numbers', () => {
  it('applies the check-digit rule', () => {
    expect(isValidDeaNumber('AB1234563')).toBe(true)
    expect(isValidDeaNumber('AB1234564')).toBe(false)
    expect(isValidDeaNumber('A1234563')).toBe(false)
    expect(isValidDeaNumber('ab1234563')).toBe(false)
    for (const reg of DEA_REGISTRATIONS) expect(isValidDeaNumber(reg.registrationNumber), reg.registrationNumber).toBe(true)
  })
})
