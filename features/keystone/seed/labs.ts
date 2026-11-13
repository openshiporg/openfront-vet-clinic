import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { auditCreate } from '../lib/cas'

import { ANALYTES, IN_HOUSE, RANGES, TESTS } from './labCatalog'

/**
 * The in-house analyser catalog on its own, for a practice that sets up its own labs (no fictional reference lab, no demo data).
 * Record by record: the in-house lab (code INHOUSE), each analyte (by code), each test of that lab (by code), each of its result-code
 * maps (by code) and each dog/cat range with no lab (by analyte and species) is added only when missing. Nothing that exists is changed,
 * so a lab the practice already set up by hand keeps its own tests, prices and ranges.
 */
export async function seedInHouseLabCatalog(uow: UnitOfWork, actor: Actor) {
  const { tx } = uow
  const created = { laboratories: 0, analytes: 0, labTests: 0, labAnalyteMaps: 0, referenceRanges: 0 }
  const spec = IN_HOUSE
  let lab = await tx.laboratory.findUnique({ where: { code: spec.code }, select: { id: true } })
  if (!lab) {
    lab = await tx.laboratory.create({ data: { code: spec.code, name: spec.name, kind: spec.kind, intake: spec.intake, accountNumber: '', status: 'active' }, select: { id: true } })
    created.laboratories += 1
  }
  const labId = lab.id
  const analyteIds = new Map<string, string>()
  for (const a of ANALYTES) {
    let row = await tx.analyte.findUnique({ where: { code: a.code }, select: { id: true } })
    if (!row) { row = await tx.analyte.create({ data: { code: a.code, name: a.name, canonicalUnit: a.unit }, select: { id: true } }); created.analytes += 1 }
    analyteIds.set(a.code, row.id)
  }
  const fees = new Map((await tx.feeItem.findMany({ where: { code: { startsWith: 'LAB-IH-' }, version: { status: 'published' } }, select: { id: true, code: true } })).map(f => [f.code, f.id]))
  const species = (await tx.species.findMany({ where: { code: { in: ['canine', 'feline'] } }, select: { id: true, code: true } }))
  for (const [code, name, fee, hours] of TESTS) {
    if (await tx.labTest.findFirst({ where: { labId, code }, select: { id: true } })) continue
    await tx.labTest.create({ data: { labId, code, name, feeItemId: fees.get(fee) ?? null, turnaroundHours: hours, status: 'active', species: { connect: species.map(s => ({ id: s.id })) } } })
    created.labTests += 1
  }
  for (const a of ANALYTES) {
    if (await tx.labAnalyteMap.findFirst({ where: { labId, externalCode: a.code }, select: { id: true } })) continue
    await tx.labAnalyteMap.create({ data: { labId, externalCode: a.code, analyteId: analyteIds.get(a.code)! } })
    created.labAnalyteMaps += 1
  }
  const speciesId = new Map(species.map(s => [s.code, s.id]))
  for (const [a, sp, low, high, cl, ch] of RANGES) {
    const sid = speciesId.get(sp)
    if (!sid) continue
    const analyteId = analyteIds.get(a)!
    if (await tx.referenceRange.findFirst({ where: { analyteId, speciesId: sid, labId: null }, select: { id: true } })) continue
    await tx.referenceRange.create({ data: { analyteId, speciesId: sid, ageClass: 'any', labId: null, low, high, criticalLow: cl, criticalHigh: ch, unit: ANALYTES.find(x => x.code === a)!.unit, source: 'Typical adult reference interval; replace with your analyser\u2019s own.' } as never })
    created.referenceRanges += 1
  }
  if (Object.values(created).some(n => n > 0)) auditCreate(uow, actor, 'Laboratory', labId, 'lab.catalog_loaded', created)
  return created
}
