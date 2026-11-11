import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { actorUserId } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { advisoryLock } from '../lib/db'
import { dec, toScale } from '../lib/decimal'
import { toJsonValue } from '../lib/canonical'
import { appendCsEntry, containerBalance } from '../lib/csRegister'
import { requireLicence } from '../domain/licensure'
import { resolvePolicy } from '../domain/policy'
import { administrationQtyProblem, blockingWarnings, calculateDose, quantityToGive, DOSE_PERS, HARD_BLOCKS, DOSE_UNITS, type DoseInput, type DoseUnit, type DosePer } from '../domain/dose'
import { dueTimes, sheetFrequency, taskStatusAt, taskWindowProblem } from '../domain/treatment'
import { ROUTES } from '../models/treatment'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { lotToDraw, returnToLot, takeFromLot } from './inventory'
import { renderDischargeDocument } from '../lib/documents'
import { activePatient, chartableEncounter, day, decimalText, latestWeight, locationDay, markInProgress, practiceSettings, staffById, staffOf, text, witnessFor, type Ctx, type StaffRow } from './clinical'

/*
 * Orders, administrations, hospital stays, the treatment sheet and anaesthesia (SM§6–§7,
 * DOMAIN I-O1–I-O4). All human-only. A medication order carries an immutable DoseCalculation; an
 * administration names its order and lot (or CS container) and, for a controlled drug, appends the
 * register entry in the same transaction (I-CS1).
 */

const ORDER_KINDS = ['medication', 'procedure', 'treatment', 'lab', 'imaging', 'vaccine', 'fluid', 'diet', 'nursing'] as const
const LICENSED_ORDER: Record<string, string> = { medication: 'prescribe', procedure: 'diagnose', euthanasia: 'authorise_euthanasia' }

type DoseArgs = { doseAmount: string; doseUnit: DoseUnit; dosePer: DosePer; weightId?: string | null; context?: 'outpatient' | 'inpatient' | 'anaesthesia' | null; manualOverrideQty?: string | null; overrideReason?: string | null }

/** The basis and unit are closed lists: an unknown basis ("lb") is refused, never read as per animal. */
export function checkDoseArgs(args: { doseUnit: unknown; dosePer: unknown }) {
  if (!(DOSE_PERS as readonly unknown[]).includes(args.dosePer)) throw new DomainError(Codes.INVALID_INPUT, 'Dose per kg, per m² or per animal. For a per-lb dose, multiply by 2.2046 to get per kg.', { field: 'dosePer' })
  if (!(DOSE_UNITS as readonly unknown[]).includes(args.doseUnit)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the dose unit.', { field: 'doseUnit' })
}

async function doseFor(uow: UnitOfWork, patientId: string, drugId: string, args: DoseArgs, staff: StaffRow) {
  checkDoseArgs(args)
  const patient = await activePatient(uow, patientId)
  const drug = await uow.tx.drugProduct.findUnique({ where: { id: drugId } })
  if (!drug || !drug.active) throw new DomainError(Codes.NOT_FOUND, 'Drug not found.')
  const weight = args.weightId
    ? await uow.tx.weightMeasurement.findFirst({ where: { id: args.weightId, patientId }, select: { id: true, valueKg: true, measuredAt: true } }).then(w => w && { id: w.id, valueKg: w.valueKg.toString(), measuredAt: w.measuredAt, ageHours: Math.floor((uow.now.getTime() - w.measuredAt.getTime()) / 3_600_000) })
    : await latestWeight(uow, patientId)
  if (!weight) throw new DomainError(Codes.GUARD_FAILED, 'Weigh the patient first: every dose is calculated from a recorded weight (I-C4).', { reason: 'no_weight' })
  const settings = await practiceSettings(uow)
  const sensitivities = (await uow.tx.patientAlert.findMany({ where: { patientId, active: true, kind: { in: ['allergy', 'drug_sensitivity'] } }, select: { text: true } })).map(a => a.text)
  const geneticFlags = Object.entries((patient.breed?.geneticFlags as Record<string, boolean> | null) ?? {}).filter(([, v]) => v).map(([k]) => k)
  const input: DoseInput = {
    weightKg: weight.valueKg, weightAgeHours: weight.ageHours, maxWeightAgeHours: settings.weightMaxAgeHours[args.context ?? 'outpatient'] ?? null,
    doseAmount: decimalText(args.doseAmount, 'doseAmount'), doseUnit: args.doseUnit, dosePer: args.dosePer, species: patient.species?.code ?? 'unknown',
    product: { id: drug.id, genericName: drug.genericName, form: drug.form, strength: drug.strength?.toString() ?? null, strengthUnit: drug.strengthUnit, per: drug.per, concentration: drug.concentration?.toString() ?? null, concentrationUnit: drug.concentrationUnit, measurableIncrement: drug.measurableIncrement?.toString() ?? null, doseRanges: drug.doseRanges as never, cautionFlags: (drug.cautionFlags as string[] | null) ?? [] },
    geneticFlags, sensitivities, manualOverrideQty: args.manualOverrideQty || null, overrideReason: args.overrideReason ?? null,
  }
  let result
  try { result = calculateDose(input) } catch (error) { throw new DomainError(Codes.INVALID_INPUT, (error as Error).message, { field: 'doseAmount' }) }
  const blocks = blockingWarnings(result.warnings)
  const hard = blocks.filter(b => HARD_BLOCKS.includes(b.code))
  if (hard.length) throw new DomainError(Codes.GUARD_FAILED, `${hard.map(b => b.message).join(' ')} Outside the formulary range a dose is not given; change the dose, or change the formulary range.`, { reason: 'dose_refused', problems: result.warnings })
  if (blocks.length && !(args.overrideReason && args.overrideReason.trim().length >= 8)) {
    throw new DomainError(Codes.GUARD_FAILED, `${blocks.map(b => b.message).join(' ')} To go ahead, a veterinarian records an override reason.`, { reason: 'dose_blocked', problems: result.warnings })
  }
  if (blocks.length && staff.kind !== 'dvm') throw new DomainError(Codes.GUARD_FAILED, `${blocks.map(b => b.message).join(' ')} Only a veterinarian can override this.`, { reason: 'dose_blocked', problems: result.warnings })
  const row = await uow.tx.doseCalculation.create({
    data: {
      patientId, weightId: weight.id, weightKg: result.weightKg, weightAgeHours: weight.ageHours, doseAmount: result.doseAmount, doseUnit: result.doseUnit, dosePer: result.dosePer,
      bsaM2: result.bsaM2, bsaConstant: result.bsaConstant, totalAmount: result.totalAmount, totalUnit: result.totalUnit, productId: drug.id, concentration: result.concentration,
      concentrationUnit: result.concentrationUnit ?? '', computedQty: result.computedQty, computedUnit: result.computedUnit ?? '', roundingRule: toJsonValue(result.roundingRule) as never,
      roundedQty: result.roundedQty, deliveredAmount: result.deliveredAmount, deviationBps: result.deviationBps, manualOverrideQty: result.manualOverrideQty, overrideReason: result.overrideReason,
      warnings: toJsonValue(result.warnings) as never, calcVersion: result.calcVersion, hash: result.hash, byId: staff.id, at: uow.now,
    },
  })
  return { row, result, drug, input }
}

/** Preview a dose without saving (the order form shows it live). */
export async function previewDose(_root: unknown, args: DoseArgs & { patientId: string; drugId: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder', 'canReadClinical'], tool: 'dose.preview', humanOnly: true }, args, async () => {
    checkDoseArgs(args)
    const prisma = context.prisma
    const patient = await prisma.patient.findUnique({ where: { id: args.patientId }, select: { species: { select: { code: true } }, breed: { select: { geneticFlags: true } } } })
    const drug = await prisma.drugProduct.findUnique({ where: { id: args.drugId } })
    const w = await prisma.weightMeasurement.findFirst({ where: { patientId: args.patientId, ...(args.weightId ? { id: args.weightId } : {}) }, orderBy: { measuredAt: 'desc' }, select: { valueKg: true, measuredAt: true } })
    if (!patient || !drug) throw new DomainError(Codes.NOT_FOUND, 'Patient or drug not found.')
    if (!w) throw new DomainError(Codes.GUARD_FAILED, 'Weigh the patient first.', { reason: 'no_weight' })
    const settings = await prisma.practiceSettings.findUnique({ where: { id: 1 }, select: { weightMaxAgeHours: true } })
    const sensitivities = (await prisma.patientAlert.findMany({ where: { patientId: args.patientId, active: true, kind: { in: ['allergy', 'drug_sensitivity'] } }, select: { text: true } })).map((a: { text: string }) => a.text)
    try {
      return calculateDose({
        weightKg: w.valueKg.toString(), weightAgeHours: Math.floor((Date.now() - w.measuredAt.getTime()) / 3_600_000), maxWeightAgeHours: (settings?.weightMaxAgeHours as Record<string, number> | null)?.[args.context ?? 'outpatient'] ?? null,
        doseAmount: decimalText(args.doseAmount, 'doseAmount'), doseUnit: args.doseUnit, dosePer: args.dosePer, species: patient.species?.code ?? 'unknown',
        product: { genericName: drug.genericName, form: drug.form, strength: drug.strength?.toString() ?? null, strengthUnit: drug.strengthUnit, per: drug.per, concentration: drug.concentration?.toString() ?? null, concentrationUnit: drug.concentrationUnit, measurableIncrement: drug.measurableIncrement?.toString() ?? null, doseRanges: drug.doseRanges, cautionFlags: drug.cautionFlags ?? [] },
        geneticFlags: Object.entries((patient.breed?.geneticFlags as Record<string, boolean> | null) ?? {}).filter(([, v]) => v).map(([k]) => k), sensitivities,
        manualOverrideQty: args.manualOverrideQty || null, overrideReason: args.overrideReason ?? null,
      })
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError(Codes.INVALID_INPUT, (error as Error).message)
    }
  })
}

/**
 * Place an order [L for medications and procedures]. A medication order computes and freezes its
 * dose; an inpatient schedule becomes a treatment-sheet order with tasks for the next 24 hours.
 */
export async function placeOrder(_root: unknown, args: {
  encounterId: string; kind: string; description?: string | null; drugId?: string | null; route?: string | null; frequency?: string | null; quantity?: string | null; quantityUnit?: string | null;
  dose?: DoseArgs | null; extralabel?: boolean | null; sheet?: { stayId: string; frequency: string; startAt?: string | null; durationHours?: number | null; instructions?: string | null } | null; idempotencyKey: string
}, context: Ctx) {
  return gated(context, { permissions: ['canOrder'], tool: 'order.place', humanOnly: true }, args, async actor => {
    if (!(ORDER_KINDS as readonly string[]).includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the kind of order.', { field: 'kind' })
    if (args.route && !(ROUTES as readonly string[]).includes(args.route)) throw new DomainError(Codes.INVALID_INPUT, 'Unknown route.', { field: 'route' })
    const result = await command(context.prisma, { name: 'order.place', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      await activePatient(uow, enc.patientId!)
      const licensedAction = LICENSED_ORDER[args.kind]
      const licence = licensedAction ? await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: enc.locationId!, action: licensedAction, at: uow.now }) : null
      let doseId: string | null = null
      let description = text(args.description ?? '', 'description', 300, args.kind !== 'medication')
      let warnings: unknown[] = []
      let drug: { id: string; displayName: string; csSchedule: string } | null = null
      if (args.kind === 'medication') {
        if (!args.drugId || !args.dose) throw new DomainError(Codes.INVALID_INPUT, 'A medication order needs the drug and the dose.', { field: 'dose' })
        if (!args.route || !args.frequency) throw new DomainError(Codes.INVALID_INPUT, 'A medication order needs the route and frequency.', { field: 'route' })
        const { on } = await locationDay(uow, enc.locationId!, uow.now)
        if (args.extralabel) {
          const vcpr = await resolvePolicy(uow.tx, 'vcpr', { locationId: enc.locationId!, on })
          if (vcpr.rules.requiredFor.includes('extralabel')) {
            const active = await uow.tx.vcprRecord.findFirst({ where: { patientId: enc.patientId, status: 'active', expiresAt: { gt: uow.now }, OR: [{ scope: 'practice' }, { dvmId: staff.id }] }, select: { id: true } })
            if (!active && !['outpatient', 'inpatient_day', 'surgery', 'dental', 'emergency'].includes(enc.kind)) throw new DomainError(Codes.VCPR_REQUIRED, 'Extralabel use needs an active veterinarian-client-patient relationship.')
          }
        }
        const dose = await doseFor(uow, enc.patientId!, args.drugId, { ...args.dose, context: args.dose.context ?? (enc.stayId || args.sheet ? 'inpatient' : 'outpatient') }, staff)
        doseId = dose.row.id
        warnings = dose.result.warnings
        drug = { id: dose.drug.id, displayName: dose.drug.displayName, csSchedule: dose.drug.csSchedule }
        description ||= `${dose.drug.displayName}: ${dose.result.doseAmount.replace(/\.?0+$/, '')} ${args.dose.doseUnit}/${args.dose.dosePer} = ${quantityToGive(dose.result)?.replace(/\.?0+$/, '')} ${dose.result.computedUnit ?? ''}`.trim()
      }
      const ref = await nextReference(uow.tx, 'ORD', uow.now)
      const order = await uow.tx.clinicalOrder.create({
        data: {
          ref, encounterId: enc.id, patientId: enc.patientId, locationId: enc.locationId, kind: args.kind, description, drugId: drug?.id ?? null, status: 'ordered', orderedById: staff.id,
          licenseEvaluationId: licence?.evaluationId ?? null, doseId, frequency: args.frequency ?? '', route: args.route ?? 'other', quantity: args.quantity ? decimalText(args.quantity, 'quantity') : null,
          quantityUnit: args.quantityUnit ?? '', extralabel: args.extralabel === true, warnings: toJsonValue(warnings) as never, overrideReason: args.dose?.overrideReason ?? '',
          schedule: args.sheet ? (toJsonValue({ frequency: args.sheet.frequency, startAt: args.sheet.startAt ?? uow.now, durationHours: args.sheet.durationHours ?? null }) as never) : undefined,
        },
      })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'ClinicalOrder', order.id, 'order.placed', { ref, kind: args.kind, encounterId: enc.id, drugId: drug?.id ?? null, doseId, csSchedule: drug?.csSchedule ?? null, warnings: (warnings as { code: string }[]).map(w => w.code) })
      let sheetOrderId: string | null = null
      let tasks = 0
      if (args.sheet) {
        const created = await addSheetOrder(uow, { orderId: order.id, stayId: args.sheet.stayId, patientId: enc.patientId!, frequency: args.sheet.frequency, startAt: args.sheet.startAt ? new Date(args.sheet.startAt) : uow.now, durationHours: args.sheet.durationHours ?? null, instructions: args.sheet.instructions ?? '' })
        sheetOrderId = created.id
        tasks = created.tasks
      }
      return { id: order.id, ref, description, doseId, warnings, sheetOrderId, tasks }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function cancelOrder(_root: unknown, args: { orderId: string; expectedVersion: number; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder'], tool: 'order.cancel', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'order.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const given = await uow.tx.administration.count({ where: { orderId: args.orderId, reverses: null } })
      if (given) throw new DomainError(Codes.GUARD_FAILED, 'Doses were already given on this order; reverse them instead of cancelling.')
      const row = await transition(uow, { model: 'ClinicalOrder', id: args.orderId, from: ['ordered', 'in_progress'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'order.cancelled', reason, data: { cancelReason: reason } })
      const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { orderId: args.orderId, active: true }, select: { id: true } })
      for (const s of sheets) {
        await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } })
        await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ['scheduled', 'due', 'overdue'] }, dueAt: { gte: uow.now } }, data: { status: 'skipped', skipReason: `Order cancelled: ${reason}`, version: { increment: 1 } } })
      }
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Administer (I-O1): one source order; lot (non-controlled) or CS container (controlled) with the
 * register entry in the same transaction; a witness where the product or pack requires one.
 */
export async function recordAdministration(_root: unknown, args: { orderId: string; qty?: string | null; route?: string | null; site?: string | null; lotId?: string | null; csContainerId?: string | null; wasteQty?: string | null; witnessId?: string | null; supervisingDvmId?: string | null; treatmentTaskId?: string | null; qtyOverrideReason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'order.administer', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'order.administer', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      return administer(uow, actor, staff, args)
    })
    return { replay: result.replay, ...result.value }
  })
}

async function administer(uow: UnitOfWork, actor: Parameters<typeof auditCreate>[1], staff: StaffRow, args: { orderId: string; qty?: string | null; route?: string | null; site?: string | null; lotId?: string | null; csContainerId?: string | null; wasteQty?: string | null; witnessId?: string | null; supervisingDvmId?: string | null; treatmentTaskId?: string | null; qtyOverrideReason?: string | null }) {
  const order = await lockRow<{ id: string; ref: string; status: string; version: number; patientId: string; encounterId: string; locationId: string; kind: string; drugId: string | null; doseId: string | null; route: string; description: string }>(uow.tx, 'ClinicalOrder', args.orderId)
  if (!['ordered', 'in_progress'].includes(order.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${order.ref} is ${order.status}; nothing more can be given on it.`)
  await activePatient(uow, order.patientId)
  const enc = await uow.tx.encounter.findUnique({ where: { id: order.encounterId }, select: { status: true } })
  if (enc?.status === 'voided') throw new DomainError(Codes.GUARD_FAILED, 'The visit record was voided.')
  const drug = order.drugId ? await uow.tx.drugProduct.findUnique({ where: { id: order.drugId }, select: { id: true, displayName: true, csSchedule: true, requiresWitnessOnAdminister: true } }) : null
  const dose = order.doseId ? await uow.tx.doseCalculation.findUnique({ where: { id: order.doseId }, select: { roundedQty: true, computedQty: true, manualOverrideQty: true, computedUnit: true } }) : null
  const planned = dose ? quantityToGive({ manualOverrideQty: dose.manualOverrideQty?.toString() ?? null, roundedQty: dose.roundedQty?.toString() ?? null, computedQty: dose.computedQty?.toString() ?? null }) : null
  const qty = args.qty ? decimalText(args.qty, 'qty') : planned
  if (!qty || dec(qty).lte(0)) throw new DomainError(Codes.INVALID_INPUT, 'Enter the amount given.', { field: 'qty' })
  const unit = dose?.computedUnit || 'dose'
  // N1: the amount given matches the order within the tolerance, or a veterinarian records why not.
  const qtyProblem = administrationQtyProblem(planned, qty, unit)
  const qtyOverrideReason = (args.qtyOverrideReason ?? '').trim()
  if (qtyProblem) {
    if (staff.kind !== 'dvm') throw new DomainError(Codes.GUARD_FAILED, `${qtyProblem} Give the ordered amount, or ask a veterinarian to record it with a reason.`, { field: 'qty', reason: 'qty_outside_order' })
    if (qtyOverrideReason.length < 8) throw new DomainError(Codes.GUARD_FAILED, `${qtyProblem} To record it anyway, give the reason (at least 8 characters).`, { field: 'qtyOverrideReason', reason: 'qty_outside_order' })
  }
  const { on } = await locationDay(uow, order.locationId, uow.now)
  const controlled = Boolean(drug && drug.csSchedule && drug.csSchedule !== 'none')
  let licenceId: string | null = null
  let lotNumber = ''
  let lotExpiresOn: Date | null = null
  let lotId: string | null = null
  let csEntryId: string | null = null
  let wasteEntryId: string | null = null
  let witnessId: string | null = null
  let draw: Awaited<ReturnType<typeof lotToDraw>> | null = null
  if (controlled) {
    if (!args.csContainerId) throw new DomainError(Codes.INVALID_INPUT, 'Choose the controlled-substance container the dose was drawn from.', { field: 'csContainerId' })
    licenceId = (await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: order.locationId, action: 'administer_controlled', at: uow.now })).evaluationId
    const container = await lockRow<{ id: string; ref: string; productId: string; locationId: string; status: string; lotNumber: string; lotExpiresOn: Date | null; budAt: Date | null; labelUnit: string }>(uow.tx, 'CsContainer', args.csContainerId)
    if (container.productId !== drug!.id) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} holds a different drug.`)
    if (container.locationId !== order.locationId) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} belongs to another location.`)
    if (container.status !== 'open') throw new DomainError(Codes.GUARD_FAILED, `${container.ref} is ${container.status}.`)
    if (container.lotExpiresOn && day(container.lotExpiresOn)! < on) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} expired on ${day(container.lotExpiresOn)}.`)
    if (container.budAt && container.budAt < uow.now) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} is past its beyond-use date.`)
    const waste = args.wasteQty ? dec(decimalText(args.wasteQty, 'wasteQty')) : dec(0)
    const scheduleII = drug!.csSchedule === 'CII' || drug!.csSchedule === 'CIIN'
    // A witness is any second authorised person who is not the administrator (B2); it is recorded
    // on the register entry itself, not only on the administration. Who may act is checked before stock.
    if (args.witnessId) witnessId = (await witnessFor(uow, args.witnessId, staff.id)).id
    if ((drug!.requiresWitnessOnAdminister || scheduleII || waste.gt(0)) && !witnessId) {
      throw new DomainError(Codes.INVALID_INPUT, waste.gt(0) ? 'Wasting a controlled drug needs a witness.' : 'A second person must witness this controlled drug.', { field: 'witnessId' })
    }
    const balance = await containerBalance(uow.tx, container.id)
    if (balance.lt(dec(qty).plus(waste))) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} has ${balance.toString()} ${container.labelUnit} left; that is not enough.`)
    const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: 'administer', qtySigned: dec(qty).neg(), unit: container.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId, patientId: order.patientId, reason: order.ref }, uow.now)
    csEntryId = entry.id
    if (waste.gt(0)) wasteEntryId = (await appendCsEntry(uow.tx, { containerId: container.id, type: 'waste', qtySigned: waste.neg(), unit: container.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId, patientId: order.patientId, reason: `Waste on ${order.ref}` }, uow.now)).id
    lotNumber = container.lotNumber
    lotExpiresOn = container.lotExpiresOn
  } else if (args.lotId) {
    const lot = await uow.tx.inventoryLot.findUnique({ where: { id: args.lotId }, select: { id: true, lotNumber: true, expiresOn: true, status: true, drugId: true, locationId: true } })
    if (!lot) throw new DomainError(Codes.NOT_FOUND, 'Lot not found.')
    if (drug && lot.drugId !== drug.id) throw new DomainError(Codes.GUARD_FAILED, 'That lot is a different product.')
    if (lot.status !== 'available') throw new DomainError(Codes.GUARD_FAILED, `Lot ${lot.lotNumber} is ${lot.status}.`)
    if (day(lot.expiresOn)! < on) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lot.lotNumber} expired on ${day(lot.expiresOn)}.`)
    // The dose comes out of this lot's stock here (I-O1); the database refuses taking more than it holds.
    if (lot.drugId) draw = await lotToDraw(uow, { product: { drugId: lot.drugId }, productName: drug?.displayName ?? 'this drug', lotId: lot.id, locationId: order.locationId, on, qty })
    lotId = lot.id
    lotNumber = lot.lotNumber
    lotExpiresOn = lot.expiresOn
  } else if (drug) {
    throw new DomainError(Codes.INVALID_INPUT, 'Choose the lot the dose came from.', { field: 'lotId' })
  }
  const row = await uow.tx.administration.create({
    data: {
      orderId: order.id, patientId: order.patientId, encounterId: order.encounterId, treatmentTaskId: args.treatmentTaskId ?? null, lotId, lotNumber: lotNumber || (drug ? '' : 'n/a'), lotExpiresOn,
      csContainerId: controlled ? args.csContainerId : null, csLogEntryId: csEntryId, wasteLogEntryId: wasteEntryId, qty: toScale(qty, 'qty'), unit, route: args.route ?? order.route ?? 'other', site: args.site ?? '',
      givenById: staff.id, supervisingDvmId: args.supervisingDvmId ?? null, witnessId, licenseEvaluationId: licenceId, givenAt: uow.now, wasteQty: args.wasteQty ? toScale(args.wasteQty, 'qty') : null, qtyOverrideReason: qtyProblem ? text(qtyOverrideReason, 'qtyOverrideReason', 300) : '',
    },
  })
  if (draw) await takeFromLot(uow, draw, { kind: 'use', sourceType: 'administration', sourceId: row.id, actorId: staff.id })
  if (order.status === 'ordered') await uow.tx.clinicalOrder.update({ where: { id: order.id }, data: { status: 'in_progress', version: { increment: 1 } } })
  auditCreate(uow, actor, 'Administration', row.id, 'order.administered', { orderRef: order.ref, qty: row.qty.toString(), planned, unit, controlled, csLogEntryId: csEntryId, wasteLogEntryId: wasteEntryId, lotNumber, qtyOverride: Boolean(qtyProblem) }, { reason: qtyProblem ? qtyOverrideReason : null })
  return { id: row.id, qty: row.qty.toString(), unit, csLogEntryId: csEntryId, wasteLogEntryId: wasteEntryId }
}

/**
 * Reverse an administration (M5): a veterinarian, with a reason. The original row never changes; a
 * new row with a negative quantity points at it. A controlled dose gets a contra register entry
 * (type adjust, positive, reverses the original) in the same transaction. When no live dose is left
 * the order is marked reversed and its treatment-sheet tasks stop.
 */
export async function reverseAdministration(_root: unknown, args: { administrationId: string; reason: string; witnessId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder', 'canAdminister'], tool: 'order.reverse_administration', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    if (reason.length < 8) throw new DomainError(Codes.INVALID_INPUT, 'Give the reason for the reversal (at least 8 characters).', { field: 'reason' })
    const result = await command(context.prisma, { name: 'order.reverse_administration', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian can reverse an administration.')
      const original = await uow.tx.administration.findUnique({ where: { id: args.administrationId }, include: { csLogEntry: { select: { id: true, ref: true, qtySigned: true, unit: true, containerId: true } }, wasteLogEntry: { select: { ref: true } } } })
      if (!original) throw new DomainError(Codes.NOT_FOUND, 'Administration not found.')
      if (original.reversesId) throw new DomainError(Codes.GUARD_FAILED, 'That row is itself a reversal.')
      const order = await lockRow<{ id: string; ref: string; status: string; version: number }>(uow.tx, 'ClinicalOrder', original.orderId!)
      if (await uow.tx.administration.count({ where: { reversesId: original.id } })) throw new DomainError(Codes.GUARD_FAILED, 'This dose was already reversed.', { reason: 'already_reversed' })
      let contraId: string | null = null
      let witnessId: string | null = null
      if (original.csLogEntry) {
        if (args.witnessId) witnessId = (await witnessFor(uow, args.witnessId, staff.id)).id
        await lockRow(uow.tx, 'CsContainer', original.csLogEntry.containerId!)
        // The drug was not given: the register gets it back with a contra entry naming the original.
        contraId = (await appendCsEntry(uow.tx, { containerId: original.csLogEntry.containerId!, type: 'adjust', qtySigned: dec(original.csLogEntry.qtySigned.toString()).neg(), unit: original.csLogEntry.unit ?? 'mL', occurredAt: uow.now, actorId: staff.id, witnessId, patientId: original.patientId, reversesId: original.csLogEntry.id, reason: `Reversal of ${original.csLogEntry.ref} on ${order.ref}: ${reason}`.slice(0, 300) }, uow.now)).id
      }
      const row = await uow.tx.administration.create({
        data: {
          orderId: original.orderId, patientId: original.patientId, encounterId: original.encounterId, lotId: original.lotId, lotNumber: original.lotNumber, lotExpiresOn: original.lotExpiresOn,
          csContainerId: original.csContainerId, csLogEntryId: contraId, qty: toScale(dec(original.qty.toString()).neg(), 'qty'), unit: original.unit, route: original.route, site: original.site,
          givenById: staff.id, witnessId, givenAt: uow.now, reversesId: original.id, reason,
        },
      })
      await returnToLot(uow, { sourceType: 'administration', sourceId: original.id, reversalId: row.id, actorId: staff.id, reason })
      const live = await uow.tx.administration.count({ where: { orderId: order.id, reversesId: null, from_Administration_reverses: { none: {} } } })
      let orderStatus = order.status
      if (!live && ['ordered', 'in_progress'].includes(order.status)) {
        const t = await transition(uow, { model: 'ClinicalOrder', id: order.id, from: ['ordered', 'in_progress'], to: 'reversed', expectedVersion: order.version, actor, eventType: 'order.reversed', reason, data: { cancelReason: `Doses reversed: ${reason}`.slice(0, 300) } })
        orderStatus = String(t.status)
        const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { orderId: order.id, active: true }, select: { id: true } })
        for (const s of sheets) {
          await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } })
          await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ['scheduled', 'due', 'overdue'] } }, data: { status: 'skipped', skipReason: `Order reversed: ${reason}`.slice(0, 300), version: { increment: 1 } } })
        }
      }
      auditCreate(uow, actor, 'Administration', row.id, 'order.administration_reversed', { reverses: original.id, orderRef: order.ref, qty: original.qty.toString(), contraCsLogEntryId: contraId, reason, orderStatus })
      return { id: row.id, reverses: original.id, contraCsLogEntryId: contraId, orderStatus }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function completeOrder(_root: unknown, args: { orderId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder', 'canAdminister'], tool: 'order.complete', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'order.complete', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'ClinicalOrder', id: args.orderId, from: ['ordered', 'in_progress'], to: 'completed', expectedVersion: args.expectedVersion, actor, eventType: 'order.completed' })
      await uow.tx.treatmentSheetOrder.updateMany({ where: { orderId: args.orderId, active: true }, data: { active: false, endAt: uow.now, version: { increment: 1 } } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Hospital stays and the treatment sheet ─────────────────────────────────────────────────

/** M7: a cage holds one patient. Checked here (the advisory lock serialises callers) so the user gets a clear refusal; the EXCLUDE constraint CageAssignment_no_overlap still backs it. */
async function cageFree(uow: UnitOfWork, cage: { id: string; code: string }) {
  const taken = await uow.tx.cageAssignment.findFirst({ where: { cageId: cage.id, toAt: null }, select: { stay: { select: { ref: true, patient: { select: { name: true } } } } } })
  if (taken) throw new DomainError(Codes.GUARD_FAILED, `Cage ${cage.code} is occupied${taken.stay?.patient?.name ? ` by ${taken.stay.patient.name}` : ''} (${taken.stay?.ref ?? 'another stay'}). Choose a free cage.`, { reason: 'cage_occupied' })
}

export async function admitPatient(_root: unknown, args: { encounterId: string; cageId: string; codeStatus: 'full' | 'closed_chest_only' | 'dnr'; reason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder'], tool: 'stay.admit', humanOnly: true }, args, async actor => {
    if (!['full', 'closed_chest_only', 'dnr'].includes(args.codeStatus)) throw new DomainError(Codes.INVALID_INPUT, 'Record the CPR code status.', { field: 'codeStatus' })
    const result = await command(context.prisma, { name: 'stay.admit', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      await activePatient(uow, enc.patientId!)
      await advisoryLock(uow.tx, `cage:${args.cageId}`)
      const cage = await uow.tx.cage.findUnique({ where: { id: args.cageId }, select: { id: true, code: true, active: true, ward: { select: { locationId: true } } } })
      if (!cage || !cage.active) throw new DomainError(Codes.NOT_FOUND, 'Cage not found.')
      if (cage.ward?.locationId !== enc.locationId) throw new DomainError(Codes.GUARD_FAILED, 'That cage is at another location.')
      await cageFree(uow, cage)
      const live = await uow.tx.hospitalStay.findFirst({ where: { patientId: enc.patientId, status: { in: ['admitted', 'in_care', 'ready_for_discharge'] } }, select: { ref: true } })
      if (live) throw new DomainError(Codes.GUARD_FAILED, `The patient is already admitted (${live.ref}).`)
      const ref = await nextReference(uow.tx, 'STAY', uow.now)
      const stay = await uow.tx.hospitalStay.create({ data: { ref, patientId: enc.patientId, locationId: enc.locationId, encounterId: enc.id, cageId: cage.id, admittedAt: uow.now, status: 'admitted', codeStatus: args.codeStatus, attendingDvmId: enc.attendingDvmId ?? (staff.kind === 'dvm' ? staff.id : null), reason: text(args.reason ?? '', 'reason', 300, false) } })
      await uow.tx.cageAssignment.create({ data: { stayId: stay.id, cageId: cage.id, fromAt: uow.now } })
      await uow.tx.encounter.update({ where: { id: enc.id }, data: { stayId: stay.id, version: { increment: 1 } } })
      await uow.tx.patient.update({ where: { id: enc.patientId! }, data: { codeStatus: args.codeStatus, version: { increment: 1 } } })
      const board = await uow.tx.whiteboardEntry.findFirst({ where: { patientId: enc.patientId, status: { not: 'discharged' } }, select: { id: true } })
      if (board) await uow.tx.whiteboardEntry.update({ where: { id: board.id }, data: { status: 'hospitalised', since: uow.now, version: { increment: 1 } } })
      else await uow.tx.whiteboardEntry.create({ data: { locationId: enc.locationId, patientId: enc.patientId, status: 'hospitalised', since: uow.now, assignedDvmId: stay.attendingDvmId } })
      auditCreate(uow, actor, 'HospitalStay', stay.id, 'stay.admitted', { ref, cage: cage.code, codeStatus: args.codeStatus, encounterId: enc.id })
      return { id: stay.id, ref, cage: cage.code }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function moveCage(_root: unknown, args: { stayId: string; cageId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder', 'canAdminister'], tool: 'stay.move', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'stay.move', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const stay = await lockRow<{ id: string; ref: string; status: string; cageId: string; locationId: string }>(uow.tx, 'HospitalStay', args.stayId)
      if (!['admitted', 'in_care', 'ready_for_discharge'].includes(stay.status)) throw new DomainError(Codes.GUARD_FAILED, `${stay.ref} is ${stay.status}.`)
      if (stay.cageId === args.cageId) return { id: stay.id, unchanged: true }
      await advisoryLock(uow.tx, `cage:${args.cageId}`)
      const cage = await uow.tx.cage.findUnique({ where: { id: args.cageId }, select: { id: true, code: true, active: true, ward: { select: { locationId: true } } } })
      if (!cage || !cage.active || cage.ward?.locationId !== stay.locationId) throw new DomainError(Codes.NOT_FOUND, 'Cage not found at this location.')
      await cageFree(uow, cage)
      await uow.tx.cageAssignment.updateMany({ where: { stayId: stay.id, toAt: null }, data: { toAt: uow.now } })
      await uow.tx.cageAssignment.create({ data: { stayId: stay.id, cageId: cage.id, fromAt: uow.now } })
      await uow.tx.hospitalStay.update({ where: { id: stay.id }, data: { cageId: cage.id, version: { increment: 1 } } })
      auditCreate(uow, actor, 'HospitalStay', stay.id, 'stay.moved', { to: cage.code })
      return { id: stay.id, cage: cage.code }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function dischargePatient(_root: unknown, args: { stayId: string; expectedVersion: number; instructions: string; recheckOn?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrder'], tool: 'stay.discharge', humanOnly: true }, args, async actor => {
    const body = text(args.instructions, 'instructions', 10_000)
    if (args.recheckOn && !/^\d{4}-\d{2}-\d{2}$/.test(args.recheckOn)) throw new DomainError(Codes.INVALID_INPUT, 'recheckOn is YYYY-MM-DD.', { field: 'recheckOn' })
    const result = await command(context.prisma, { name: 'stay.discharge', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const row = await transition<{ id: string; ref: string; patientId: string; encounterId: string; locationId: string }>(uow, { model: 'HospitalStay', id: args.stayId, from: ['admitted', 'in_care', 'ready_for_discharge'], to: 'discharged', expectedVersion: args.expectedVersion, actor, eventType: 'stay.discharged', data: { dischargedAt: uow.now } })
      await uow.tx.cageAssignment.updateMany({ where: { stayId: row.id, toAt: null }, data: { toAt: uow.now } })
      const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { stayId: row.id, active: true }, select: { id: true } })
      for (const s of sheets) {
        await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } })
        await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ['scheduled', 'due', 'overdue'] }, dueAt: { gte: uow.now } }, data: { status: 'skipped', skipReason: 'Patient discharged', version: { increment: 1 } } })
      }
      const instr = await uow.tx.dischargeInstruction.create({ data: { encounterId: row.encounterId, stayId: row.id, patientId: row.patientId, body, recheckOn: args.recheckOn ? new Date(`${args.recheckOn}T00:00:00Z`) : null, authorId: staff.id } })
      await uow.tx.whiteboardEntry.updateMany({ where: { patientId: row.patientId, status: 'hospitalised' }, data: { status: 'ready_for_discharge', since: uow.now, version: { increment: 1 } } })
      await renderDischargeDocument(uow, instr.id)
      return { id: row.id, status: 'discharged', instructionId: instr.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Create a sheet order and materialise its tasks for the next 24 hours (idempotent on (order, dueAt)). */
export async function addSheetOrder(uow: UnitOfWork, input: { orderId: string; stayId: string; patientId: string; frequency: string; startAt: Date; durationHours: number | null; instructions: string }) {
  const frequency = sheetFrequency(input.frequency)
  if (!frequency) throw new DomainError(Codes.INVALID_INPUT, `"${input.frequency}" is not a treatment-sheet frequency: use q1h to q24h, SID, BID, TID, QID, PRN, CRI or once.`, { field: 'frequency' })
  input = { ...input, frequency }
  const stay = await uow.tx.hospitalStay.findUnique({ where: { id: input.stayId }, select: { id: true, status: true, patientId: true } })
  if (!stay || stay.patientId !== input.patientId) throw new DomainError(Codes.NOT_FOUND, 'Hospital stay not found for this patient.')
  if (!['admitted', 'in_care'].includes(stay.status)) throw new DomainError(Codes.GUARD_FAILED, `The stay is ${stay.status}.`)
  const sheet = await uow.tx.treatmentSheetOrder.create({ data: { stayId: stay.id, orderId: input.orderId, patientId: input.patientId, frequency: input.frequency, startAt: input.startAt, endAt: input.durationHours ? new Date(input.startAt.getTime() + input.durationHours * 3_600_000) : null, instructions: input.instructions, active: true } })
  if (stay.status === 'admitted') await uow.tx.hospitalStay.update({ where: { id: stay.id }, data: { status: 'in_care', version: { increment: 1 } } })
  const tasks = await materialiseSheetOrder(uow, sheet.id, new Date(uow.now.getTime() + 24 * 3_600_000))
  return { id: sheet.id, tasks }
}

/** Generate tasks through `horizon`. Re-running creates nothing new (unique (sheetOrder, dueAt)). */
export async function materialiseSheetOrder(uow: UnitOfWork, sheetOrderId: string, horizon: Date) {
  const sheet = await uow.tx.treatmentSheetOrder.findUniqueOrThrow({ where: { id: sheetOrderId }, select: { id: true, stayId: true, patientId: true, frequency: true, startAt: true, endAt: true, active: true, materialisedThrough: true } })
  if (!sheet.active) return 0
  const from = sheet.materialisedThrough ?? sheet.startAt
  const times = dueTimes({ frequency: sheet.frequency, startAt: sheet.startAt, endAt: sheet.endAt }, sheet.materialisedThrough ? from : sheet.startAt, horizon)
  let created = 0
  if (times.length) {
    const result = await uow.tx.treatmentTask.createMany({ data: times.map(dueAt => ({ sheetOrderId: sheet.id, stayId: sheet.stayId, patientId: sheet.patientId, dueAt, status: 'scheduled' })), skipDuplicates: true })
    created = result.count
  }
  if (!sheet.materialisedThrough || horizon > sheet.materialisedThrough) await uow.tx.treatmentSheetOrder.update({ where: { id: sheet.id }, data: { materialisedThrough: horizon } })
  return created
}

/** The leased job: extend every active sheet 24 hours ahead and flag due/overdue tasks. */
export async function runTreatmentSheetJob(uow: UnitOfWork) {
  const horizon = new Date(uow.now.getTime() + 24 * 3_600_000)
  const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { active: true, OR: [{ endAt: null }, { endAt: { gt: uow.now } }] }, select: { id: true, graceMinutes: true } })
  let created = 0
  for (const s of sheets) created += await materialiseSheetOrder(uow, s.id, horizon)
  const open = await uow.tx.treatmentTask.findMany({ where: { status: { in: ['scheduled', 'due', 'overdue'] }, dueAt: { lte: new Date(uow.now.getTime() + 3_600_000) } }, select: { id: true, dueAt: true, status: true, patientId: true, sheetOrder: { select: { graceMinutes: true, frequency: true, order: { select: { ref: true } } } } } })
  let due = 0
  let overdue = 0
  let missed = 0
  for (const t of open) {
    const next = taskStatusAt({ dueAt: t.dueAt, status: t.status, graceMinutes: t.sheetOrder?.graceMinutes ?? 30, frequency: t.sheetOrder?.frequency ?? null }, uow.now)
    if (next !== t.status) {
      const moved = await uow.tx.treatmentTask.updateMany({ where: { id: t.id, status: t.status }, data: { status: next, version: { increment: 1 } } })
      if (!moved.count) continue
      if (next === 'due') due++
      if (next === 'overdue') overdue++
      if (next === 'missed') {
        missed++
        // A missed treatment is a clinical event: it stays on the sheet and in the audit trail.
        uow.audit({ eventType: 'treatment.missed', entityType: 'TreatmentTask', entityId: t.id, before: { status: t.status }, after: { status: 'missed', dueAt: t.dueAt.toISOString(), orderRef: t.sheetOrder?.order?.ref ?? null, patientId: t.patientId }, metadata: { system: 'treatment-sheets' } })
      }
    }
  }
  return { sheets: sheets.length, created, due, overdue, missed }
}

export async function completeTreatmentTask(_root: unknown, args: { taskId: string; expectedVersion: number; observation?: string | null; qty?: string | null; qtyOverrideReason?: string | null; lotId?: string | null; csContainerId?: string | null; witnessId?: string | null; wasteQty?: string | null; earlyReason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'treatment.complete', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'treatment.complete', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const task = await lockRow<{ id: string; status: string; version: number; sheetOrderId: string; dueAt: Date }>(uow.tx, 'TreatmentTask', args.taskId)
      if (task.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'This task changed since you loaded it.', { currentVersion: task.version })
      if (task.status === 'missed') throw new DomainError(Codes.INVALID_TRANSITION, 'This dose was missed; it is not given late. A veterinarian can reschedule it.', { reason: 'missed' })
      if (!['scheduled', 'due', 'overdue'].includes(task.status)) throw new DomainError(Codes.INVALID_TRANSITION, `This task is already ${task.status}.`)
      // Serialise every completion on the same sheet line, so two nurses can't both give the dose.
      await lockRow(uow.tx, 'TreatmentSheetOrder', task.sheetOrderId)
      const sheet = await uow.tx.treatmentSheetOrder.findUniqueOrThrow({ where: { id: task.sheetOrderId }, select: { frequency: true, order: { select: { id: true, kind: true, drugId: true, locationId: true } } } })
      // B3: only inside the task's window; never a second dose inside the interval.
      const earlyReason = args.earlyReason?.trim() ?? ''
      if (earlyReason && staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian can give a scheduled dose early.', { field: 'earlyReason' })
      if (earlyReason && earlyReason.length < 8) throw new DomainError(Codes.INVALID_INPUT, 'Say why the dose is given early.', { field: 'earlyReason' })
      const lastDone = await uow.tx.treatmentTask.findFirst({ where: { sheetOrderId: task.sheetOrderId, status: 'done', id: { not: task.id } }, orderBy: { doneAt: 'desc' }, select: { doneAt: true } })
      const loc = sheet.order?.locationId ? await uow.tx.location.findUnique({ where: { id: sheet.order.locationId }, select: { timeZone: true } }) : null
      const problem = taskWindowProblem({ frequency: sheet.frequency, dueAt: task.dueAt, now: uow.now, lastDoneAt: lastDone?.doneAt ?? null, earlyOverride: Boolean(earlyReason), timeZone: loc?.timeZone })
      if (problem) throw new DomainError(Codes.GUARD_FAILED, problem.message, { reason: problem.code })
      let administrationId: string | null = null
      if (sheet.order?.kind === 'medication' || sheet.order?.drugId) {
        administrationId = (await administer(uow, actor, staff, { orderId: sheet.order.id, qty: args.qty, lotId: args.lotId, csContainerId: args.csContainerId, witnessId: args.witnessId, wasteQty: args.wasteQty, treatmentTaskId: task.id, qtyOverrideReason: args.qtyOverrideReason })).id
      }
      const note = args.observation ? text(args.observation, 'observation', 2000) : ''
      const observation = note || earlyReason ? ({ ...(note ? { note } : {}), ...(earlyReason ? { earlyReason, earlyBy: staff.id } : {}) } as never) : undefined
      await uow.tx.treatmentTask.update({ where: { id: task.id }, data: { status: 'done', doneById: staff.id, doneAt: uow.now, administrationId, observation, version: { increment: 1 } } })
      auditCreate(uow, actor, 'TreatmentTask', task.id, 'treatment.done', { administrationId, early: Boolean(earlyReason) }, { reason: earlyReason || null })
      return { id: task.id, status: 'done', administrationId }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function skipTreatmentTask(_root: unknown, args: { taskId: string; expectedVersion: number; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'treatment.skip', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'treatment.skip', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const row = await transition(uow, { model: 'TreatmentTask', id: args.taskId, from: ['scheduled', 'due', 'overdue'], to: 'skipped', expectedVersion: args.expectedVersion, actor, eventType: 'treatment.skipped', reason, data: { skipReason: reason, doneById: staff.id, doneAt: uow.now } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function rescheduleTreatmentTask(_root: unknown, args: { taskId: string; expectedVersion: number; dueAt: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'treatment.reschedule', humanOnly: true }, args, async actor => {
    const dueAt = new Date(args.dueAt)
    if (Number.isNaN(dueAt.getTime())) throw new DomainError(Codes.INVALID_INPUT, 'Choose the new time.', { field: 'dueAt' })
    const result = await command(context.prisma, { name: 'treatment.reschedule', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const task = await lockRow<{ id: string; sheetOrderId: string; stayId: string; patientId: string }>(uow.tx, 'TreatmentTask', args.taskId)
      const clash = await uow.tx.treatmentTask.findFirst({ where: { sheetOrderId: task.sheetOrderId, dueAt }, select: { id: true } })
      if (clash) throw new DomainError(Codes.GUARD_FAILED, 'There is already a task for that time on this order.')
      const next = await uow.tx.treatmentTask.create({ data: { sheetOrderId: task.sheetOrderId, stayId: task.stayId, patientId: task.patientId, dueAt, status: 'scheduled' } })
      const row = await transition(uow, { model: 'TreatmentTask', id: task.id, from: ['scheduled', 'due', 'overdue', 'missed'], to: 'rescheduled', expectedVersion: args.expectedVersion, actor, eventType: 'treatment.rescheduled', data: { rescheduledToId: next.id } })
      return { id: row.id, status: row.status, newTaskId: next.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Anaesthesia (SM§7) ─────────────────────────────────────────────────────────────────────

export async function openAnaesthesia(_root: unknown, args: { encounterId: string; procedure: string; asaStatus: string; fastingConfirmed: boolean; consentConfirmed: boolean; ivCatheter?: unknown; protocol?: unknown; anaesthetistId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'anaesthesia.open', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'anaesthesia.open', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      await activePatient(uow, enc.patientId!)
      if (!['I', 'II', 'III', 'IV', 'V', 'IE', 'IIE', 'IIIE', 'IVE', 'VE'].includes(args.asaStatus)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the ASA status.', { field: 'asaStatus' })
      const emergency = args.asaStatus.endsWith('E')
      if (!args.consentConfirmed) throw new DomainError(Codes.CONSENT_REQUIRED, 'Confirm the client signed the anaesthesia consent.')
      if (!args.fastingConfirmed && !emergency) throw new DomainError(Codes.GUARD_FAILED, 'Confirm fasting (or mark the ASA status as an emergency).')
      const settings = await practiceSettings(uow)
      const weight = await latestWeight(uow, enc.patientId!)
      const maxAge = settings.weightMaxAgeHours.anaesthesia ?? 24
      if (!weight || weight.ageHours > maxAge) throw new DomainError(Codes.GUARD_FAILED, `Weigh the patient: anaesthesia needs a weight from the last ${maxAge} hours.`, { reason: 'weight_stale' })
      const anaesthetist = args.anaesthetistId ? await staffById(uow, args.anaesthetistId) : staff
      const licence = await requireLicence(uow.tx, { staffMemberId: anaesthetist.id, locationId: enc.locationId!, action: 'induce_anaesthesia', at: uow.now })
      const ref = await nextReference(uow.tx, 'ANE', uow.now)
      const row = await uow.tx.anaesthesiaRecord.create({
        data: {
          ref, encounterId: enc.id, patientId: enc.patientId, procedure: text(args.procedure, 'procedure', 200), asaStatus: args.asaStatus, fastingConfirmed: args.fastingConfirmed, consentConfirmed: true,
          preWeightId: weight.id, ivCatheter: toJsonValue(args.ivCatheter ?? null) as never, protocol: toJsonValue(args.protocol ?? null) as never, checklist: toJsonValue({ asa: args.asaStatus, fasting: args.fastingConfirmed, consent: true, weightAgeHours: weight.ageHours }) as never,
          anaesthetistId: anaesthetist.id, dvmId: enc.attendingDvmId, licenseEvaluationId: licence.evaluationId, status: 'open',
        },
      })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'AnaesthesiaRecord', row.id, 'anaesthesia.opened', { ref, asa: args.asaStatus, encounterId: enc.id })
      return { id: row.id, ref }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * B4: induction → intubation → extubation, each recorded once. Extubation needs a recorded
 * intubation; a time already recorded is never overwritten (the database refuses both too).
 */
const ANAESTHESIA_STEPS: Record<string, { from: string[]; to: string; field: 'inductionAt' | 'intubatedAt' | 'extubatedAt'; needs?: 'inductionAt' | 'intubatedAt' }> = {
  induce: { from: ['open'], to: 'monitoring', field: 'inductionAt' },
  intubate: { from: ['monitoring'], to: 'monitoring', field: 'intubatedAt', needs: 'inductionAt' },
  extubate: { from: ['monitoring'], to: 'recovery', field: 'extubatedAt', needs: 'intubatedAt' },
}
const STEP_LABEL = { inductionAt: 'Induction', intubatedAt: 'Intubation', extubatedAt: 'Extubation' } as const

export async function anaesthesiaEvent(_root: unknown, args: { recordId: string; event: 'induce' | 'intubate' | 'extubate'; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'anaesthesia.event', humanOnly: true }, args, async actor => {
    const step = ANAESTHESIA_STEPS[args.event]
    if (!step) throw new DomainError(Codes.INVALID_INPUT, 'Unknown anaesthesia event.', { field: 'event' })
    const result = await command(context.prisma, { name: 'anaesthesia.event', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const rec = await lockRow<{ id: string; ref: string; inductionAt: Date | null; intubatedAt: Date | null; extubatedAt: Date | null }>(uow.tx, 'AnaesthesiaRecord', args.recordId)
      if (rec[step.field]) throw new DomainError(Codes.INVALID_TRANSITION, `${STEP_LABEL[step.field]} was already recorded on ${rec.ref}; times are never overwritten.`, { reason: 'already_recorded' })
      if (step.needs && !rec[step.needs]) throw new DomainError(Codes.INVALID_TRANSITION, `Record ${STEP_LABEL[step.needs].toLowerCase()} before ${STEP_LABEL[step.field].toLowerCase()}.`, { reason: 'out_of_order' })
      const row = await transition(uow, { model: 'AnaesthesiaRecord', id: args.recordId, from: step.from, to: step.to, expectedVersion: args.expectedVersion, actor, eventType: `anaesthesia.${args.event}`, data: { [step.field]: uow.now } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function recordMonitoring(_root: unknown, args: { recordId: string; hr?: number | null; rr?: number | null; spo2?: number | null; etco2?: number | null; sbp?: number | null; dbp?: number | null; map?: number | null; tempC?: string | null; agentPct?: string | null; o2FlowLpm?: string | null; fluidsRateMlHr?: string | null; notes?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'anaesthesia.monitor', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'anaesthesia.monitor', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const rec = await uow.tx.anaesthesiaRecord.findUnique({ where: { id: args.recordId }, select: { id: true, status: true } })
      if (!rec) throw new DomainError(Codes.NOT_FOUND, 'Anaesthesia record not found.')
      if (!['monitoring', 'recovery'].includes(rec.status)) throw new DomainError(Codes.GUARD_FAILED, `Monitoring is recorded after induction; the record is ${rec.status}.`)
      const int = (v: unknown, f: string, max: number) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : (() => { throw new DomainError(Codes.INVALID_INPUT, `${f} is out of range.`, { field: f }) })())
      const d = (v: unknown, f: string) => (v === null || v === undefined || v === '' ? null : decimalText(v, f))
      // Body temperature under anaesthesia in °C: 25–45 (the database CHECK MonitoringReading_ranges holds the same).
      const tempC = (v: unknown) => { const t = d(v, 'tempC'); if (t !== null && (dec(t).lt(25) || dec(t).gt(45))) throw new DomainError(Codes.INVALID_INPUT, `Temperature ${t} °C is out of range (25–45 °C). Was it entered in °F?`, { field: 'tempC' }); return t }
      const row = await uow.tx.monitoringReading.create({
        data: { recordId: rec.id, at: uow.now, hr: int(args.hr, 'hr', 500), rr: int(args.rr, 'rr', 300), spo2: int(args.spo2, 'spo2', 100), etco2: int(args.etco2, 'etco2', 150), sbp: int(args.sbp, 'sbp', 400), dbp: int(args.dbp, 'dbp', 300), map: int(args.map, 'map', 300), tempC: tempC(args.tempC), agentPct: d(args.agentPct, 'agentPct'), o2FlowLpm: d(args.o2FlowLpm, 'o2FlowLpm'), fluidsRateMlHr: d(args.fluidsRateMlHr, 'fluidsRateMlHr'), notes: text(args.notes ?? '', 'notes', 500, false), byId: staff.id },
      })
      auditCreate(uow, actor, 'MonitoringReading', row.id, 'anaesthesia.reading', { recordId: rec.id })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Close [L]: recovery end time and the veterinarian's sign-off. */
export async function closeAnaesthesia(_root: unknown, args: { recordId: string; expectedVersion: number; complications?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canSignRecord'], tool: 'anaesthesia.close', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'anaesthesia.close', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.LICENSE_INACTIVE, 'A veterinarian closes the anaesthesia record.')
      const rec = await uow.tx.anaesthesiaRecord.findUnique({ where: { id: args.recordId }, select: { encounter: { select: { locationId: true } } } })
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: rec!.encounter!.locationId!, action: 'sign_record', at: uow.now })
      const row = await transition(uow, { model: 'AnaesthesiaRecord', id: args.recordId, from: ['recovery'], to: 'closed', expectedVersion: args.expectedVersion, actor, eventType: 'anaesthesia.closed', data: { recoveryEndAt: uow.now, closedById: staff.id, complications: text(args.complications ?? '', 'complications', 2000, false) } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function saveSurgeryReport(_root: unknown, args: { encounterId: string; procedure: string; technique?: string | null; findings?: string | null; closure?: string | null; sutures?: string | null; specimens?: string | null; assistantId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canPerformSurgery'], tool: 'surgery.report', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'surgery.report', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: enc.locationId!, action: 'perform_surgery', at: uow.now })
      const data = { procedure: text(args.procedure, 'procedure', 200), surgeonId: staff.id, assistantId: args.assistantId ?? null, technique: text(args.technique ?? '', 'technique', 5000, false), findings: text(args.findings ?? '', 'findings', 5000, false), closure: text(args.closure ?? '', 'closure', 2000, false), sutures: text(args.sutures ?? '', 'sutures', 500, false), specimens: text(args.specimens ?? '', 'specimens', 500, false) }
      const existing = await uow.tx.surgeryReport.findFirst({ where: { encounterId: enc.id }, select: { id: true, status: true } })
      if (existing?.status === 'signed') throw new DomainError(Codes.GUARD_FAILED, 'The surgery report is signed; add an addendum.')
      const row = existing ? await uow.tx.surgeryReport.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await uow.tx.surgeryReport.create({ data: { encounterId: enc.id, status: 'draft', ...data } })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'SurgeryReport', row.id, 'surgery.report_saved', { encounterId: enc.id })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Review r4 F4: a finding is a short note, not a document; the database CHECK (vc_dental_teeth_valid) uses the same limits. */
const DENTAL_MAX_ITEMS = 50
const DENTAL_MAX_LENGTH = 500

export async function saveDentalChart(_root: unknown, args: { encounterId: string; teeth: Record<string, { findings?: string[]; procedures?: string[] }>; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'dental.chart', humanOnly: true }, args, async actor => {
    const triadan = /^[1-8](0[1-9]|1[0-1])$/
    if (!args.teeth || typeof args.teeth !== 'object' || Array.isArray(args.teeth)) throw new DomainError(Codes.INVALID_INPUT, 'Teeth must be an object keyed by Triadan tooth number.', { field: 'teeth' })
    for (const [tooth, entry] of Object.entries(args.teeth)) {
      if (!triadan.test(tooth)) throw new DomainError(Codes.INVALID_INPUT, `${tooth} is not a Triadan tooth number.`, { field: 'teeth' })
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth} must have findings and procedures.`, { field: 'teeth' })
      for (const key of ['findings', 'procedures'] as const) {
        const list = (entry as Record<string, unknown>)[key]
        if (list === undefined) continue
        if (!Array.isArray(list) || list.length > DENTAL_MAX_ITEMS) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth}: ${key} must be a list of at most ${DENTAL_MAX_ITEMS} entries.`, { field: 'teeth' })
        if (list.some(item => typeof item !== 'string' || item.length > DENTAL_MAX_LENGTH)) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth}: each of ${key} must be text of at most ${DENTAL_MAX_LENGTH} characters.`, { field: 'teeth' })
      }
    }
    const result = await command(context.prisma, { name: 'dental.chart', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const enc = await chartableEncounter(uow, args.encounterId)
      const existing = await uow.tx.dentalChart.findFirst({ where: { encounterId: enc.id }, select: { id: true } })
      const teeth = toJsonValue(args.teeth) as never
      const row = existing ? await uow.tx.dentalChart.update({ where: { id: existing.id }, data: { teeth, version: { increment: 1 } } }) : await uow.tx.dentalChart.create({ data: { encounterId: enc.id, patientId: enc.patientId, teeth } })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'DentalChart', row.id, 'dental.chart_saved', { encounterId: enc.id, teeth: Object.keys(args.teeth).length })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export const _testing = { administer, actorUserId }
