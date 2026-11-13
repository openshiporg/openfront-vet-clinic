import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { auditCreate } from '../lib/cas'

/*
 * Lab set-up the practice starts with: one reference laboratory (results keyed by hand or dropped in as a file) and the in-house
 * analysers, a few common tests priced from the standard fee list, the analytes they report, each lab's codes for them, and
 * reference ranges for dogs and cats. Ranges are typical adult published intervals; the practice edits them to its own analysers.
 */
const LABS = [
  { id: 'seed_lab_reference', code: 'REFLAB', name: 'Sacramento Veterinary Reference Laboratory', kind: 'reference', intake: 'file_drop', accountNumber: 'SVRL-20418' },
  { id: 'seed_lab_inhouse', code: 'INHOUSE', name: 'In-house analysers', kind: 'in_house', intake: 'manual', accountNumber: '' },
] as const

const ANALYTES = [
  { code: 'WBC', name: 'White blood cells', unit: '10^9/L' },
  { code: 'HCT', name: 'Haematocrit', unit: '%' },
  { code: 'PLT', name: 'Platelets', unit: '10^9/L' },
  { code: 'GLU', name: 'Glucose', unit: 'mmol/L' },
  { code: 'BUN', name: 'Urea nitrogen', unit: 'mmol/L' },
  { code: 'CREA', name: 'Creatinine', unit: 'umol/L' },
  { code: 'ALT', name: 'Alanine aminotransferase', unit: 'U/L' },
  { code: 'TP', name: 'Total protein', unit: 'g/L' },
  { code: 'T4', name: 'Total thyroxine', unit: 'nmol/L' },
  { code: 'USG', name: 'Urine specific gravity', unit: '' },
] as const

// [lab, test code, name, fee code, turnaround hours, analytes]
const TESTS = [
  ['seed_lab_reference', 'CBCCHEM', 'Complete blood count and chemistry', 'LAB-CBC-CHEM', 24, ['WBC', 'HCT', 'PLT', 'GLU', 'BUN', 'CREA', 'ALT', 'TP']],
  ['seed_lab_reference', 'T4', 'Total thyroxine (T4)', 'LAB-T4', 48, ['T4']],
  ['seed_lab_reference', 'UA', 'Urinalysis', 'LAB-UA', 24, ['USG']],
  ['seed_lab_inhouse', 'GLU', 'Blood glucose', 'LAB-IH-GLUCOSE', 1, ['GLU']],
  ['seed_lab_inhouse', 'PCVTP', 'Packed cell volume and total protein', 'LAB-IH-PCV-TP', 1, ['HCT', 'TP']],
] as const

// The reference lab reports glucose and urea in mg/dL and creatinine in mg/dL; its file codes differ from ours.
const REF_MAPS: Record<string, { ext: string; factor?: string }> = {
  WBC: { ext: 'WBC' }, HCT: { ext: 'HCT' }, PLT: { ext: 'PLT' }, GLU: { ext: 'GLUC', factor: '0.0555' }, BUN: { ext: 'BUN', factor: '0.357' },
  CREA: { ext: 'CREAT', factor: '88.4' }, ALT: { ext: 'ALT' }, TP: { ext: 'TPROT', factor: '10' }, T4: { ext: 'TT4' }, USG: { ext: 'SG' },
}

// [analyte, species, low, high, critical low, critical high]
const RANGES = [
  ['WBC', 'seed_sp_canine', '5.5', '16.9', null, '40'], ['WBC', 'seed_sp_feline', '5.5', '19.5', null, '40'],
  ['HCT', 'seed_sp_canine', '37', '55', '20', null], ['HCT', 'seed_sp_feline', '30', '45', '15', null],
  ['PLT', 'seed_sp_canine', '175', '500', '50', null], ['PLT', 'seed_sp_feline', '175', '600', '50', null],
  ['GLU', 'seed_sp_canine', '4.1', '7.9', '3.0', '20'], ['GLU', 'seed_sp_feline', '4.0', '8.8', '3.0', '25'],
  ['BUN', 'seed_sp_canine', '2.5', '9.6', null, '30'], ['BUN', 'seed_sp_feline', '5.7', '12.9', null, '30'],
  ['CREA', 'seed_sp_canine', '44', '159', null, '500'], ['CREA', 'seed_sp_feline', '71', '212', null, '500'],
  ['ALT', 'seed_sp_canine', '10', '125', null, '1000'], ['ALT', 'seed_sp_feline', '12', '130', null, '1000'],
  ['TP', 'seed_sp_canine', '52', '82', '35', null], ['TP', 'seed_sp_feline', '57', '89', '35', null],
  ['T4', 'seed_sp_canine', '13', '51', null, null], ['T4', 'seed_sp_feline', '10', '60', null, null],
  ['USG', 'seed_sp_canine', '1.015', '1.045', null, null], ['USG', 'seed_sp_feline', '1.035', '1.060', null, null],
] as const

export async function seedLabs(uow: UnitOfWork, actor: Actor, count: (k: string, n: number) => void) {
  const { tx } = uow
  if (await tx.laboratory.findFirst({ select: { id: true } })) return
  const species = new Set((await tx.species.findMany({ select: { id: true } })).map(s => s.id))
  await tx.laboratory.createMany({ data: LABS.map(l => ({ ...l, status: 'active' })) })
  await tx.analyte.createMany({ data: ANALYTES.map(a => ({ id: `seed_analyte_${a.code.toLowerCase()}`, code: a.code, name: a.name, canonicalUnit: a.unit })) })
  const analytes = new Map<string, string>(ANALYTES.map(a => [a.code, `seed_analyte_${a.code.toLowerCase()}`]))
  const fees = new Map((await tx.feeItem.findMany({ where: { code: { startsWith: 'LAB-' }, version: { status: 'published' } }, select: { id: true, code: true } })).map(f => [f.code, f.id]))
  const dogCat = ['seed_sp_canine', 'seed_sp_feline'].filter(id => species.has(id))
  const testId = (lab: string, code: string) => `${lab}_${code.toLowerCase()}`
  await tx.labTest.createMany({ data: TESTS.map(([labId, code, name, fee, hours]) => ({ id: testId(labId, code), labId, code, name, feeItemId: fees.get(fee) ?? null, turnaroundHours: hours, status: 'active' })) })
  // Dogs and cats only (the join table is Prisma's implicit many-to-many: A = LabTest, B = Species).
  const pairs = TESTS.flatMap(([labId, code]) => dogCat.map(sp => [testId(labId, code), sp]))
  if (pairs.length) await tx.$executeRawUnsafe(`INSERT INTO "_LabTest_species" ("A", "B") VALUES ${pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')}`, ...pairs.flat())
  // In-house analysers report our own codes and units; the reference lab's file uses its own.
  const maps = [
    ...ANALYTES.map(a => ({ labId: 'seed_lab_inhouse', externalCode: a.code, analyteId: analytes.get(a.code)!, unitConversion: undefined })),
    ...ANALYTES.map(a => ({ labId: 'seed_lab_reference', externalCode: REF_MAPS[a.code].ext, analyteId: analytes.get(a.code)!, unitConversion: REF_MAPS[a.code].factor ? { factor: REF_MAPS[a.code].factor } : undefined })),
  ]
  await tx.labAnalyteMap.createMany({ data: maps as never })
  const ranges = RANGES.filter(r => species.has(r[1])).map(([a, sp, low, high, cl, ch]) => ({
    analyteId: analytes.get(a)!, speciesId: sp, ageClass: 'any', labId: null, low, high, criticalLow: cl, criticalHigh: ch,
    unit: ANALYTES.find(x => x.code === a)!.unit, source: 'Typical adult reference interval; replace with your analyser\u2019s own.',
  }))
  await tx.referenceRange.createMany({ data: ranges as never })
  auditCreate(uow, actor, 'Laboratory', LABS[0].id, 'lab.setup_seeded', { labs: LABS.length, tests: TESTS.length, analytes: ANALYTES.length, ranges: ranges.length }, { metadata: { seed: true } })
  count('laboratories', LABS.length)
  count('labTests', TESTS.length)
}
