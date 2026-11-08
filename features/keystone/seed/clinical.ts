import { auditCreate } from '../lib/cas'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { canonicalJson, sha256, toJsonValue } from '../lib/canonical'
import {
  CLINICAL_DRUGS, DIAGNOSIS_CODES, DOSE_FORMULARY, DRUG_LOTS, GLOSSARY, MDR1_BREEDS, RECORD_TEMPLATES, REMINDER_PROTOCOLS, REMINDER_TYPES, VACCINE_LOTS, VACCINE_PRODUCTS, WARDS,
} from './clinicalData'

const DAY = (d: string) => new Date(`${d}T00:00:00Z`)
const meta = { metadata: { seed: true } }

/**
 * Phase 2 reference data: formulary additions and dose ranges, MDR1 breed flags, vaccine products
 * and lots, reminder types and the published (unverified) reminder protocols, wards and cages,
 * practice diagnosis codes, record templates and the shorthand glossary. Idempotent per section by
 * deterministic id, like seedClinic. Clinical history (encounters, orders, vaccines) is never
 * seeded by hand-written rows: scripts/clinical-drill.ts makes it through the real commands.
 */
export async function seedClinical(uow: UnitOfWork, actor: Actor, count: (k: string, n: number) => void) {
  const { tx, now } = uow
  const species = new Map((await tx.species.findMany({ select: { id: true, code: true } })).map(s => [s.code, s.id]))

  // ── Formulary additions, dose ranges, MDR1 flags ──
  const haveDrugs = new Set((await tx.drugProduct.findMany({ where: { id: { in: CLINICAL_DRUGS.map(d => d.id) } }, select: { id: true } })).map(d => d.id))
  const newDrugs = CLINICAL_DRUGS.filter(d => !haveDrugs.has(d.id))
  if (newDrugs.length) {
    await tx.drugProduct.createMany({ data: newDrugs.map(d => ({ ...d, csSchedule: 'none', isHumanLabel: d.approvalStatus === 'human_label', requiresWitnessOnAdminister: false, active: true })) })
    count('drugProducts', newDrugs.length)
  }
  // Only drugs with no ranges yet: a range the medical director has since edited is never overwritten.
  const needsRanges = (await tx.drugProduct.findMany({ where: { id: { in: Object.keys(DOSE_FORMULARY) } }, select: { id: true, doseRanges: true } })).filter(d => d.doseRanges == null)
  for (const d of needsRanges) {
    const f = DOSE_FORMULARY[d.id]
    await tx.drugProduct.update({ where: { id: d.id }, data: { doseRanges: f.doseRanges as never, cautionFlags: (f.cautionFlags ?? []) as never, measurableIncrement: f.measurableIncrement ?? null } })
  }
  if (needsRanges.length) {
    auditCreate(uow, actor, 'DrugProduct', 'seed_formulary', 'formulary.dose_ranges_loaded', { drugs: needsRanges.map(d => d.id), verified: false }, meta)
    count('doseRanges', needsRanges.length)
  }
  const mdr1 = await tx.breed.findMany({ where: { name: { in: MDR1_BREEDS }, speciesId: species.get('canine') }, select: { id: true, geneticFlags: true } })
  for (const b of mdr1.filter(b => !(b.geneticFlags as Record<string, boolean> | null)?.MDR1_risk)) {
    await tx.breed.update({ where: { id: b.id }, data: { geneticFlags: { ...((b.geneticFlags as Record<string, boolean> | null) ?? {}), MDR1_risk: true } } })
  }

  // ── Lots for the formulary (non-controlled) ──
  const haveDrugLots = new Set((await tx.inventoryLot.findMany({ where: { id: { in: DRUG_LOTS.map(l => l.id) } }, select: { id: true } })).map(l => l.id))
  const newDrugLots = DRUG_LOTS.filter(l => !haveDrugLots.has(l.id))
  if (newDrugLots.length) {
    await tx.inventoryLot.createMany({ data: newDrugLots.map(l => ({ id: l.id, drugId: l.drug, locationId: l.location, lotNumber: l.lot, expiresOn: DAY(l.expiresOn), status: 'available' })) })
    count('drugLots', newDrugLots.length)
  }

  // ── Reminder types, vaccine products and lots ──
  const haveTypes = new Set((await tx.reminderType.findMany({ where: { id: { in: REMINDER_TYPES.map(t => t.id) } }, select: { id: true } })).map(t => t.id))
  const newTypes = REMINDER_TYPES.filter(t => !haveTypes.has(t.id))
  if (newTypes.length) {
    await tx.reminderType.createMany({ data: newTypes.map(t => ({ ...t, active: true })) })
    count('reminderTypes', newTypes.length)
  }
  const haveVx = new Set((await tx.vaccineProduct.findMany({ where: { id: { in: VACCINE_PRODUCTS.map(v => v.id) } }, select: { id: true } })).map(v => v.id))
  for (const v of VACCINE_PRODUCTS.filter(v => !haveVx.has(v.id))) {
    await tx.vaccineProduct.create({ data: { id: v.id, name: v.name, manufacturer: v.manufacturer, antigens: [...v.antigens], licensedDoiMonths: v.doi, minAgeWeeks: v.minAgeWeeks, isRabies: v.isRabies, usdaProductCode: '', defaultRoute: v.route, reminderTypeId: v.type, active: true, species: { connect: v.species.map(code => ({ id: species.get(code)! })) } } })
    auditCreate(uow, actor, 'VaccineProduct', v.id, 'vaccine_product.created', { name: v.name, doiMonths: v.doi, isRabies: v.isRabies }, meta)
    count('vaccineProducts', 1)
  }
  const haveVxLots = new Set((await tx.inventoryLot.findMany({ where: { id: { in: VACCINE_LOTS.map(l => l.id) } }, select: { id: true } })).map(l => l.id))
  const newVxLots = VACCINE_LOTS.filter(l => !haveVxLots.has(l.id))
  if (newVxLots.length) {
    await tx.inventoryLot.createMany({ data: newVxLots.map(l => ({ id: l.id, vaccineId: l.vaccine, locationId: l.location, lotNumber: l.lot, expiresOn: DAY(l.expiresOn), status: 'available' })) })
    count('vaccineLots', newVxLots.length)
  }

  // ── Reminder protocols: version 1 published, unverified until the medical director checks it ──
  for (const p of REMINDER_PROTOCOLS) {
    if (await tx.reminderProtocol.findUnique({ where: { id: p.id }, select: { id: true } })) continue
    await tx.reminderProtocol.create({ data: { id: p.id, code: p.code, name: p.name, speciesId: species.get(p.species) ?? null } })
    const content = p.rules.map(r => ({ code: r.code, satisfies: r.satisfies, vaccines: [...r.vaccines], schedule: r.schedule, leadDays: r.leadDays, graceDays: r.graceDays, lapseDays: r.lapseDays }))
    const versionId = `${p.id}_v1`
    await tx.reminderProtocolVersion.create({ data: { id: versionId, protocolId: p.id, label: 'v1 (Cedar Creek, pending medical-director review)', versionNumber: 1, sourceRefs: toJsonValue(p.sourceRefs) as never, verified: false, unverifiedRules: [...p.unverified], status: 'draft', contentHash: sha256(canonicalJson(content)) } })
    for (const r of p.rules) {
      await tx.reminderRule.create({ data: { id: `${versionId}_${r.code.toLowerCase()}`, protocolVersionId: versionId, code: r.code, satisfiesId: r.satisfies, schedule: toJsonValue(r.schedule) as never, leadDays: r.leadDays, graceDays: r.graceDays, lapseDays: r.lapseDays, triggerVaccines: { connect: r.vaccines.map(id => ({ id })) } } })
    }
    await tx.reminderProtocolVersion.update({ where: { id: versionId }, data: { status: 'published', publishedAt: now, version: { increment: 1 } } })
    auditCreate(uow, actor, 'ReminderProtocolVersion', versionId, 'reminder_protocol.published', { code: p.code, rules: p.rules.length, verified: false, unverified: p.unverified }, meta)
    count('reminderProtocols', 1)
  }

  // ── Wards and cages ──
  for (const w of WARDS) {
    if (await tx.ward.findUnique({ where: { id: w.id }, select: { id: true } })) continue
    await tx.ward.create({ data: { id: w.id, locationId: w.location, name: w.name, kind: w.kind } })
    await tx.cage.createMany({ data: w.cages.map(([code, size]) => ({ id: `seed_cage_${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`, wardId: w.id, code, size, features: {}, active: true })) })
    count('cages', w.cages.length)
  }

  // ── Diagnosis codes, templates, glossary ──
  const haveCodes = new Set((await tx.diagnosisCode.findMany({ where: { codeSystem: 'practice' }, select: { code: true } })).map(c => c.code))
  for (const [code, term, sp] of DIAGNOSIS_CODES.filter(([code]) => !haveCodes.has(code))) {
    await tx.diagnosisCode.create({ data: { codeSystem: 'practice', code, term, active: true, species: { connect: sp.map(s => species.get(s)).filter((id): id is string => !!id).map(id => ({ id })) } } })
    count('diagnosisCodes', 1)
  }
  const haveTpl = new Set((await tx.recordTemplate.findMany({ where: { id: { in: RECORD_TEMPLATES.map(t => t.id) } }, select: { id: true } })).map(t => t.id))
  const newTpl = RECORD_TEMPLATES.filter(t => !haveTpl.has(t.id))
  if (newTpl.length) {
    await tx.recordTemplate.createMany({ data: newTpl.map(t => ({ ...t, templateVersion: 1, active: true })) })
    count('recordTemplates', newTpl.length)
  }
  const haveGloss = new Set((await tx.glossary.findMany({ select: { term: true } })).map(g => g.term))
  const newGloss = GLOSSARY.filter(([term]) => !haveGloss.has(term))
  if (newGloss.length) {
    await tx.glossary.createMany({ data: newGloss.map(([term, expansion]) => ({ term, expansion })) })
    count('glossary', newGloss.length)
  }
}
