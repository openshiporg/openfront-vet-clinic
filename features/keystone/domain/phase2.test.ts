import { describe, expect, it } from 'vitest'
import { administrationQtyProblem, blockingWarnings, bodySurfaceArea, calculateDose, HARD_BLOCKS, quantityToGive, roundTo, verifyDose, type DoseInput } from './dose'
import { checkCompleteness, establishesVcpr, KNOWN_RECORD_FIELDS, revisionHash, signedContentHash, type EncounterEvidence } from './record'
import { dueTimes, longestMonitoringGapMinutes, missedAfterMinutes, taskStatusAt } from './treatment'
import { addMonths, ageInWeeks, dueDate, rabiesCertificateFields, reminderStatusOn, vaccineDuration, vaccineProblems } from './vaccines'
import { dec } from '../lib/decimal'

const meloxicam = { genericName: 'Meloxicam', form: 'injectable', concentration: '5', concentrationUnit: 'mg/mL', doseRanges: { canine: { min: '0.1', max: '0.2', unit: 'mg', per: 'kg' as const } } }
const base: DoseInput = { weightKg: '12.4', doseAmount: '0.2', doseUnit: 'mg', dosePer: 'kg', species: 'canine', product: meloxicam }

describe('dose', () => {
  it('blocks per-m² doses outside the range, using BSA from the dosing weight (N2)', () => {
    const perM2 = { ...meloxicam, doseRanges: { canine: { min: '4', max: '6', unit: 'mg', per: 'm2' as const } } }
    const otis = { ...base, weightKg: '22.4075', dosePer: 'm2' as const, product: perM2 }
    expect(bodySurfaceArea('22.4075', 'canine').m2.toFixed(4)).toBe('0.8028')
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '5' }).warnings)).toEqual([])
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '20' }).warnings).map(w => w.code)).toEqual(['above_range'])
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '2' }).warnings).map(w => w.code)).toEqual(['below_range'])
    // A per-kg range reached from an m² order: 2 mg/m² × 0.8028 m² / 22.4 kg = 0.07 mg/kg, below 0.1.
    expect(blockingWarnings(calculateDose({ ...base, weightKg: '22.4075', doseAmount: '2', dosePer: 'm2' }).warnings).map(w => w.code)).toEqual(['below_range'])
  })
  it('refuses a manual quantity that delivers a dose outside the range, whatever the reason (N2)', () => {
    // ORD-9: 0.15 mg/kg meloxicam for 22.4 kg is 0.67 mL; 20 mL is 100 mg, 4.46 mg/kg.
    const r = calculateDose({ ...base, weightKg: '22.4075', doseAmount: '0.15', manualOverrideQty: '20', overrideReason: 'Clinician chose a larger volume' })
    expect(r.warnings.map(w => w.code)).toContain('override_out_of_range')
    expect(r.warnings.filter(w => (HARD_BLOCKS as readonly string[]).includes(w.code))).toHaveLength(1)
    const ok = calculateDose({ ...base, weightKg: '22.4075', doseAmount: '0.15', manualOverrideQty: '0.7', overrideReason: 'Rounded to the syringe marking' })
    expect(ok.warnings.map(w => w.code)).not.toContain('override_out_of_range')
  })
  it('checks the amount given against the order (N1)', () => {
    expect(administrationQtyProblem('0.32', '0.32', 'mL')).toBeNull()
    expect(administrationQtyProblem('0.32', '0.35', 'mL')).toBeNull()
    expect(administrationQtyProblem('0.32', '50', 'mL')).toMatch(/0\.32/)
    expect(administrationQtyProblem('0.32', '0.2', 'mL')).not.toBeNull()
    expect(administrationQtyProblem('0.05', '0.06', 'mL')).toBeNull()
  })
  it('computes total, volume and rounds to the syringe graduation exactly', () => {
    const r = calculateDose(base)
    expect(r.totalAmount).toBe('2.480000')
    expect(r.computedQty).toBe('0.496000')
    expect(r.roundingRule).toEqual({ increment: '0.01', mode: 'half_even' })
    expect(r.roundedQty).toBe('0.500000')
    expect(r.deliveredAmount).toBe('2.500000')
    expect(r.warnings).toEqual([])
    expect(quantityToGive(r)).toBe('0.500000')
  })
  it('is deterministic and verifiable', () => {
    const a = calculateDose(base)
    expect(calculateDose(base).hash).toBe(a.hash)
    expect(verifyDose(a, base)).toBe(true)
    expect(verifyDose(a, { ...base, weightKg: '12.5' })).toBe(false)
  })
  it('checks the range after converting units and the per-basis (B1)', () => {
    // Otis 49.4 lb = 22.4 kg: 2000 mcg/kg is 2 mg/kg, ten times the 0.2 mg/kg ceiling.
    const otis = { ...base, weightKg: '22.407' }
    const mcg = calculateDose({ ...otis, doseAmount: '2000', doseUnit: 'mcg' })
    expect(blockingWarnings(mcg.warnings).map(w => w.code)).toEqual(['above_range'])
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '150', doseUnit: 'mcg' }).warnings)).toEqual([])
    // A formulary range written per lb is converted to per kg before comparing.
    const perLb = { ...meloxicam, doseRanges: { canine: { min: '0.05', max: '0.09', unit: 'mg', per: 'lb' as const } } }
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '0.18', product: perLb }).warnings)).toEqual([])
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '0.4', product: perLb }).warnings).map(w => w.code)).toEqual(['above_range'])
    // A mL-based dose converts through the concentration: 0.04 mL/kg × 5 mg/mL = 0.2 mg/kg (in range).
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '0.04', doseUnit: 'mL' }).warnings)).toEqual([])
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '0.1', doseUnit: 'mL' }).warnings).map(w => w.code)).toEqual(['above_range'])
    // Per animal: 50 mg for a 22.4 kg dog is 2.2 mg/kg.
    expect(blockingWarnings(calculateDose({ ...otis, doseAmount: '50', dosePer: 'animal' }).warnings).map(w => w.code)).toEqual(['above_range'])
  })
  it('refuses an unknown per-basis or unit', () => {
    expect(() => calculateDose({ ...base, dosePer: 'lb' as never })).toThrow(/2\.2046/)
    expect(() => calculateDose({ ...base, dosePer: 'cow' as never })).toThrow(RangeError)
    expect(() => calculateDose({ ...base, doseUnit: 'grain' as never })).toThrow(RangeError)
  })
  it('converts mcg doses against a mg/mL concentration', () => {
    const r = calculateDose({ ...base, doseAmount: '200', doseUnit: 'mcg', product: { ...meloxicam, doseRanges: null } })
    expect(r.computedQty).toBe('0.496000')
  })
  it('blocks above the formulary maximum and warns below', () => {
    expect(blockingWarnings(calculateDose({ ...base, doseAmount: '0.3' }).warnings).map(w => w.code)).toEqual(['above_range'])
    expect(blockingWarnings(calculateDose({ ...base, doseAmount: '0.05' }).warnings).map(w => w.code)).toEqual(['below_range'])
  })
  it('blocks MDR1 breeds and recorded sensitivities', () => {
    const ivermectin = { genericName: 'Ivermectin', form: 'tablet', strength: '68', strengthUnit: 'mcg', per: 'tablet', cautionFlags: ['mdr1'] }
    const r = calculateDose({ ...base, doseAmount: '6', doseUnit: 'mcg', product: ivermectin, geneticFlags: ['mdr1'], sensitivities: ['ivermectin'] })
    expect(blockingWarnings(r.warnings).map(w => w.code).sort()).toEqual(['genetic_caution', 'patient_sensitivity'])
  })
  it('rounds tablets to quarters with HALF_EVEN and reports the deviation', () => {
    const tab = { genericName: 'Carprofen', form: 'tablet', strength: '25', strengthUnit: 'mg', per: 'tablet' }
    const r = calculateDose({ ...base, weightKg: '5', doseAmount: '2.2', product: tab })
    expect(r.computedQty).toBe('0.440000')
    expect(r.roundedQty).toBe('0.500000')
    expect(r.deviationBps).toBe(1364)
    expect(r.warnings.map(w => w.code)).toContain('rounding_deviation')
  })
  it('flags a dose below the measurable amount', () => {
    const r = calculateDose({ ...base, weightKg: '0.02', product: { ...meloxicam, doseRanges: null } })
    expect(blockingWarnings(r.warnings).map(w => w.code)).toEqual(['below_measurable'])
  })
  it('flags a stale weight and requires an override reason', () => {
    expect(blockingWarnings(calculateDose({ ...base, weightAgeHours: 30, maxWeightAgeHours: 24 }).warnings)[0].code).toBe('weight_stale')
    expect(() => calculateDose({ ...base, manualOverrideQty: '0.4', overrideReason: 'short' })).toThrow(/reason/)
    expect(quantityToGive(calculateDose({ ...base, manualOverrideQty: '0.4', overrideReason: 'Patient obese; lean-weight dose' }))).toBe('0.400000')
  })
  it('computes body surface area per Meeh', () => {
    expect(bodySurfaceArea('10', 'canine').m2.toString()).toBe('0.4688')
    expect(() => bodySurfaceArea('10', 'rabbit')).toThrow()
  })
  it('rounds half-even', () => {
    expect(roundTo(dec('0.125'), '0.25').toString()).toBe('0')
    expect(roundTo(dec('0.375'), '0.25').toString()).toBe('0.5')
  })
})

const evidence = (over: Partial<EncounterEvidence> = {}): EncounterEvidence => ({
  kind: 'outpatient', startedAt: new Date('2026-11-07T17:00:00Z'), client: { name: 'Maya Torres', address: '12 Oak St', phone: '+19165550142' },
  patient: { name: 'Biscuit', species: 'dog', breed: 'Beagle', ageKnown: true, sex: 'female', colour: 'tricolour' },
  sections: [{ kind: 'history', ordinal: 1, body: 'Limping 2 days.' }, { kind: 'objective', ordinal: 1, body: 'Lame RF.' }, { kind: 'assessment', ordinal: 1, body: 'Soft-tissue injury; good prognosis.' }, { kind: 'plan', ordinal: 1, body: 'Meloxicam 5 days.' }],
  vitalsCount: 1, findingsCount: 2, diagnosesCount: 1, medications: [{ description: 'Meloxicam', dose: '0.5 mL', route: 'sc', frequency: 'sid', quantity: null }], vaccines: [],
  anaesthesiaGiven: false, anaesthesiaRecordClosed: true, surgeryPerformed: false, surgeryReportPresent: false, signerIsDvm: true, ...over,
})

describe('record', () => {
  const CA = ['client_name_address_phone', 'patient_name_species_breed_age_sex_colour', 'date_of_visit', 'history', 'physical_exam', 'diagnosis_or_assessment', 'treatment_plan', 'medications_dose_route_frequency', 'anaesthesia_record', 'surgery_record', 'prognosis', 'author_identity']
  it('knows every California required field', () => expect(CA.every(f => KNOWN_RECORD_FIELDS.includes(f))).toBe(true))
  it('passes a complete record', () => expect(checkCompleteness(CA, evidence())).toEqual({ complete: true, missing: [] }))
  it('lists what is missing', () => {
    const r = checkCompleteness(CA, evidence({ sections: [], findingsCount: 0, vitalsCount: 0, diagnosesCount: 0, signerIsDvm: false }))
    expect(r.missing.map(m => m.field)).toEqual(['history', 'physical_exam', 'diagnosis_or_assessment', 'treatment_plan', 'prognosis', 'author_identity'])
  })
  it('needs dose, route and frequency on medications and lots on vaccines', () => {
    expect(checkCompleteness(CA, evidence({ medications: [{ description: 'Cefpodoxime', dose: null, route: 'po', frequency: 'sid', quantity: null }] })).missing[0].field).toBe('medications_dose_route_frequency')
    expect(checkCompleteness(CA, evidence({ vaccines: [{ lotNumber: '', lotExpiresOn: null }] })).complete).toBe(false)
  })
  it('requires closed anaesthesia and a surgery report', () => {
    expect(checkCompleteness(CA, evidence({ anaesthesiaGiven: true, anaesthesiaRecordClosed: false })).missing[0].field).toBe('anaesthesia_record')
    expect(checkCompleteness(CA, evidence({ kind: 'surgery', surgeryPerformed: true })).missing[0].field).toBe('surgery_record')
  })
  it('skips exam fields for phone consults and fails closed on unknown fields', () => {
    expect(checkCompleteness(['physical_exam'], evidence({ kind: 'phone_consult', findingsCount: 0, vitalsCount: 0, sections: [] })).complete).toBe(true)
    expect(checkCompleteness(['radiograph_log'], evidence()).complete).toBe(false)
  })
  it('hashes canonically', () => {
    expect(signedContentHash({ b: 1, a: 2 })).toBe(signedContentHash({ a: 2, b: 1 }))
    expect(revisionHash({ kind: 'plan', ordinal: 1, body: 'x', source: 'typed', author: 's' })).toMatch(/^[0-9a-f]{64}$/)
  })
  it('establishes a VCPR only from in-person kinds (telehealth where allowed)', () => {
    expect(establishesVcpr('outpatient', 'in_person_only')).toBe(true)
    expect(establishesVcpr('telehealth', 'in_person_only')).toBe(false)
    expect(establishesVcpr('telehealth', 'in_person_or_telehealth')).toBe(true)
    expect(establishesVcpr('phone_consult', 'in_person_or_telehealth')).toBe(false)
  })
})

describe('treatment sheet', () => {
  const start = new Date('2026-11-07T08:00:00Z')
  it('materialises q6h through a horizon, half-open', () => {
    expect(dueTimes({ frequency: 'q6h', startAt: start }, start, new Date('2026-11-08T08:00:00Z')).map(d => d.toISOString().slice(11, 13))).toEqual(['08', '14', '20', '02'])
  })
  it('continues from a later window without duplicates', () => {
    expect(dueTimes({ frequency: 'bid', startAt: start }, new Date('2026-11-07T09:00:00Z'), new Date('2026-11-08T09:00:00Z')).map(d => d.toISOString())).toEqual(['2026-11-07T20:00:00.000Z', '2026-11-08T08:00:00.000Z'])
  })
  it('respects the end time, once, PRN', () => {
    expect(dueTimes({ frequency: 'q4h', startAt: start, endAt: new Date('2026-11-07T16:00:00Z') }, start, new Date('2026-11-08T08:00:00Z'))).toHaveLength(2)
    expect(dueTimes({ frequency: 'once', startAt: start }, start, new Date('2026-11-08T08:00:00Z'))).toHaveLength(1)
    expect(dueTimes({ frequency: 'prn', startAt: start }, start, new Date('2026-11-08T08:00:00Z'))).toHaveLength(0)
  })
  it('moves tasks to due and overdue', () => {
    const t = { dueAt: start, status: 'scheduled', graceMinutes: 30 }
    expect(taskStatusAt(t, new Date('2026-11-07T06:30:00Z'))).toBe('scheduled')
    expect(taskStatusAt(t, new Date('2026-11-07T07:30:00Z'))).toBe('due')
    expect(taskStatusAt(t, new Date('2026-11-07T08:31:00Z'))).toBe('overdue')
    expect(taskStatusAt({ ...t, status: 'done' }, new Date('2026-11-07T09:00:00Z'))).toBe('done')
  })
  it('moves an undone task to missed after half its interval (M1)', () => {
    expect(missedAfterMinutes('BID', 30)).toBe(360)
    expect(missedAfterMinutes('q1h', 15)).toBe(60)
    expect(missedAfterMinutes('once', 30)).toBe(240)
    const t = { dueAt: start, status: 'overdue', graceMinutes: 30, frequency: 'BID' }
    expect(taskStatusAt(t, new Date(start.getTime() + 359 * 60_000))).toBe('overdue')
    expect(taskStatusAt(t, new Date(start.getTime() + 360 * 60_000))).toBe('missed')
    expect(taskStatusAt({ ...t, status: 'missed' }, new Date(start.getTime() + 999 * 60_000))).toBe('missed')
  })
  it('measures the longest monitoring gap', () => {
    const r = (m: number) => new Date(start.getTime() + m * 60_000)
    expect(longestMonitoringGapMinutes([r(5), r(10), r(25)], start, r(30))).toBe(15)
  })
})

describe('vaccines', () => {
  const rabies = { maxDurationMonths: 36, boosterAfterFirstMonths: 12, firstDoseMinAgeWeeks: 12 }
  it('adds months and clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-11-07', 36)).toBe('2029-11-07')
  })
  it('first rabies dose is boosted at one year even on a 3-year label', () => {
    expect(vaccineDuration({ labelMonths: 36, isRabies: true, priorRabiesDoses: 0, rabiesPolicy: rabies })).toMatchObject({ months: 12, reason: 'first_rabies_dose' })
    expect(vaccineDuration({ labelMonths: 36, isRabies: true, priorRabiesDoses: 1, rabiesPolicy: rabies })).toMatchObject({ months: 36, reason: 'label_capped' })
    expect(vaccineDuration({ labelMonths: 12, isRabies: false, priorRabiesDoses: 0, rabiesPolicy: null, seriesIntervalWeeks: 3 })).toMatchObject({ weeks: 3, reason: 'initial_series' })
    expect(dueDate('2026-11-07', { months: 0, weeks: 3 })).toBe('2026-11-28')
  })
  it('refuses expired lots, wrong species, under-age and unsupervised rabies', () => {
    const problems = vaccineProblems({
      product: { name: 'Rabies 3yr', isRabies: true, minAgeWeeks: 12, speciesCodes: ['dog', 'cat'], active: true },
      lot: { lotNumber: 'R123', expiresOn: '2026-11-01', status: 'available' }, patient: { speciesCode: 'rabbit', dateOfBirth: '2026-09-01', status: 'active' },
      on: '2026-11-07', rabiesPolicy: rabies, giverKind: 'assistant', supervisingDvmPresent: false,
    })
    expect(problems).toHaveLength(4)
    expect(ageInWeeks('2026-09-01', '2026-11-07')).toBe(9)
  })
  it('moves reminders through due, overdue and lapsed', () => {
    const rule = { leadDays: 30, graceDays: 30, lapseDays: 180 }
    expect(reminderStatusOn({ dueOn: '2026-12-31', status: 'scheduled' }, rule, '2026-11-07')).toBe('scheduled')
    expect(reminderStatusOn({ dueOn: '2026-12-01', status: 'scheduled' }, rule, '2026-11-07')).toBe('due')
    expect(reminderStatusOn({ dueOn: '2026-10-01', status: 'due' }, rule, '2026-11-07')).toBe('overdue')
    expect(reminderStatusOn({ dueOn: '2026-01-01', status: 'overdue' }, rule, '2026-11-07')).toBe('lapsed')
    expect(reminderStatusOn({ dueOn: '2026-01-01', status: 'satisfied' }, rule, '2026-11-07')).toBe('satisfied')
  })
  it('fills certificate fields and lists what is missing', () => {
    expect(rabiesCertificateFields(['date_given', 'tag_number'], { date_given: '2026-11-07', tag_number: '' })).toEqual({ fields: { date_given: '2026-11-07' }, missing: ['tag_number'] })
  })
})
