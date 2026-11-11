import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { can } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { dec, plain, toScale } from '../lib/decimal'
import { appendCsEntry, containerBalance } from '../lib/csRegister'
import { addBusinessDays, addDays, locationCalendar } from '../lib/calendar'
import { requireDeaRegistration, requireLicence, type CsSchedule } from '../domain/licensure'
import { resolvePolicy } from '../domain/policy'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { activePatient, day, decimalText, locationDay, staffOf, text, witnessFor, type Ctx } from './clinical'

/*
 * Pharmacy and the controlled-substance register (SM§10, §13, §14; DOMAIN I-RX1–I-RX3, I-CS1–I-CS4).
 * Every command is idempotent and one transaction: the clinical row, the register entry, the audit
 * event and any report it creates commit together or not at all. Nothing here runs on a timer: the
 * clocks (DEA notice, Form 106, PDMP) are dates stored on the case and judged on read.
 * Agents reach none of it (humanOnly), and the register tools are barred in the MCP registry too.
 */

const CS_UNITS = new Set(['mg', 'mcg', 'g', 'mL', 'L', 'tablet', 'capsule', 'unit', 'each'])
const isCs = (s: string | null | undefined) => !!s && s !== 'none'
const addMonthsTo = (d: Date, months: number) => { const out = new Date(d.getTime()); out.setUTCMonth(out.getUTCMonth() + months); return out }
const dateOnly = (value: string, field: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field })
  return new Date(`${value}T00:00:00Z`)
}
const positiveQty = (value: unknown, field: string) => {
  const t = decimalText(value, field)
  if (!dec(t).gt(0)) throw new DomainError(Codes.INVALID_INPUT, `${field} must be more than zero.`, { field })
  return t
}

/** The location's business calendar, with its own closures on top of the federal holidays. */
async function calendarFor(uow: UnitOfWork, locationId: string) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { code: true, timeZone: true, calendar: { select: { regularOpen: true, regularClose: true, exceptions: { select: { date: true } } } } } })
  if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
  return locationCalendar({ code: location.code, timeZone: location.timeZone, regularOpen: location.calendar?.regularOpen, regularClose: location.calendar?.regularClose, closures: (location.calendar?.exceptions ?? []).map(e => day(e.date)!) })
}

async function lockedContainer(uow: UnitOfWork, id: string) {
  const c = await lockRow<{ id: string; ref: string; productId: string; locationId: string; status: string; lotNumber: string; lotExpiresOn: Date | null; budAt: Date | null; labelUnit: string; version: number }>(uow.tx, 'CsContainer', id)
  const product = await uow.tx.drugProduct.findUnique({ where: { id: c.productId }, select: { id: true, displayName: true, csSchedule: true, multiDoseBudDays: true } })
  return { ...c, product: product! }
}

// ── Prescriptions ──────────────────────────────────────────────────────────────────────────

type LineInput = { productId: string; directions: string; route?: string | null; frequency?: string | null; quantity: string; quantityUnit?: string | null; refillsAuthorised?: number | null; extralabel?: boolean | null; substitutionAllowed?: boolean | null }

/** Write and sign a prescription: licence, VCPR, refill caps and (for a controlled drug) the prescriber's DEA registration, checked before anything is written (I-RX1). */
export async function writePrescription(_root: unknown, args: { patientId: string; locationId: string; lines: LineInput[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canPrescribe'], tool: 'prescription.write', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 10) throw new DomainError(Codes.INVALID_INPUT, 'A prescription needs between one and ten lines.', { field: 'lines' })
    const result = await command(context.prisma, { name: 'prescription.write', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian can write a prescription.')
      const patient = await activePatient(uow, args.patientId)
      const { on, location } = await locationDay(uow, args.locationId, uow.now)
      const licence = await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: location.id, action: 'prescribe', at: uow.now })
      const vcprPolicy = await resolvePolicy(uow.tx, 'vcpr', { locationId: location.id, on })
      const vcpr = await uow.tx.vcprRecord.findFirst({
        where: { patientId: patient.id, status: 'active', expiresAt: { gt: uow.now }, establishedAt: { lte: uow.now }, ...(vcprPolicy.rules.level === 'dvm' ? { dvmId: staff.id } : {}) },
        orderBy: { expiresAt: 'desc' }, select: { id: true },
      })
      if (!vcpr) throw new DomainError(Codes.VCPR_REQUIRED, vcprPolicy.rules.level === 'dvm' ? 'You have no current veterinarian-client-patient relationship with this patient.' : 'This patient has no current veterinarian-client-patient relationship.')
      const rx = await resolvePolicy(uow.tx, 'prescription', { locationId: location.id, on })
      const owner = await uow.tx.patientOwnership.findFirst({ where: { patientId: patient.id, effectiveTo: null, role: 'primary' }, select: { clientId: true } })
      const products = await uow.tx.drugProduct.findMany({ where: { id: { in: args.lines.map(l => l.productId) } }, select: { id: true, displayName: true, csSchedule: true, active: true, approvalStatus: true, isHumanLabel: true } })
      const byId = new Map(products.map(p => [p.id, p]))
      let dea: { deaRegistrationId: string } | null = null
      const lines = [] as { product: (typeof products)[number]; input: LineInput; refills: number; expiresAt: Date; extralabel: boolean }[]
      for (const input of args.lines) {
        const product = byId.get(input.productId)
        if (!product || !product.active) throw new DomainError(Codes.NOT_FOUND, 'That drug is not in the formulary.', { field: 'productId' })
        text(input.directions, 'directions', 500)
        positiveQty(input.quantity, 'quantity')
        const refills = Number(input.refillsAuthorised ?? 0)
        if (!Number.isInteger(refills) || refills < 0) throw new DomainError(Codes.INVALID_INPUT, 'Refills must be a whole number, zero or more.', { field: 'refillsAuthorised' })
        const limit = rx.rules.refillLimits[product.csSchedule as CsSchedule]
        if (isCs(product.csSchedule)) {
          if (!limit) throw new DomainError(Codes.POLICY_UNRESOLVED, `The prescription policy has no refill limit for ${product.csSchedule}.`)
          if (refills > limit.maxRefills) throw new DomainError(Codes.GUARD_FAILED, limit.maxRefills === 0 ? `${product.displayName} is a Schedule II drug: no refills.` : `${product.displayName} allows at most ${limit.maxRefills} refills.`, { field: 'refillsAuthorised' })
          dea ??= await requireDeaRegistration(uow.tx, { locationId: location.id, schedule: product.csSchedule as CsSchedule, at: uow.now, action: 'prescribe_controlled', registrantStaffMemberId: staff.id, actorStaffMemberId: staff.id })
        }
        const months = Math.min(rx.rules.defaultExpiryMonths, isCs(product.csSchedule) && limit?.maxMonths ? limit.maxMonths : rx.rules.defaultExpiryMonths)
        lines.push({ product, input, refills, expiresAt: addMonthsTo(uow.now, months), extralabel: product.approvalStatus === 'human_label' || product.isHumanLabel || input.extralabel === true })
      }
      const ref = await nextReference(uow.tx, 'RX', uow.now)
      const row = await uow.tx.prescription.create({
        data: {
          ref, patientId: patient.id, clientId: owner?.clientId ?? null, locationId: location.id, prescriberId: staff.id, deaRegistrationId: dea?.deaRegistrationId ?? null, vcprId: vcpr.id,
          issuedAt: uow.now, status: 'active', signedAt: uow.now, licenseEvaluationId: licence.evaluationId, policyVersionId: rx.versions[rx.versions.length - 1]?.id ?? null,
          lines: {
            create: lines.map(l => ({
              productId: l.product.id, csSchedule: l.product.csSchedule, directions: text(l.input.directions, 'directions', 500), route: String(l.input.route ?? '').slice(0, 60), frequency: String(l.input.frequency ?? '').slice(0, 100),
              quantity: toScale(dec(decimalText(l.input.quantity, 'quantity')), 'qty'), quantityUnit: (l.input.quantityUnit as never) ?? null, refillsAuthorised: l.refills, expiresAt: l.expiresAt, extralabel: l.extralabel, substitutionAllowed: l.input.substitutionAllowed ?? true,
            })),
          },
        },
      })
      auditCreate(uow, actor, 'Prescription', row.id, 'prescription.signed', { ref, patientId: patient.id, lines: lines.map(l => ({ productId: l.product.id, refills: l.refills })) })
      return { id: row.id, ref, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

const DECISIONS = { fulfil_existing: 'fulfilled_under_existing_rx', approve_new: 'approved_new_rx', deny: 'denied', needs_exam: 'needs_exam' } as const

/** The veterinarian's decision on a refill request (I-RX2). An agent can file a request; it can never decide one. */
export async function decideRefill(_root: unknown, args: { requestId: string; decision: keyof typeof DECISIONS; reason?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageRefills'], tool: 'refill.decide', humanOnly: true }, args, async actor => {
    const to = DECISIONS[args.decision]
    if (!to) throw new DomainError(Codes.INVALID_INPUT, 'Choose a decision.', { field: 'decision' })
    const reason = String(args.reason ?? '').trim().slice(0, 300)
    if ((args.decision === 'deny' || args.decision === 'needs_exam') && reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, 'Give the reason for the client (at least 5 characters).', { field: 'reason' })
    const result = await command(context.prisma, { name: 'refill.decide', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian decides a refill.')
      const request = await uow.tx.refillRequest.findUnique({ where: { id: args.requestId }, select: { id: true, ref: true, patientId: true } })
      if (!request) throw new DomainError(Codes.NOT_FOUND, 'Refill request not found.')
      const { on, location } = await locationDay(uow, staff.homeLocationId ?? (await uow.tx.location.findFirstOrThrow({ where: { active: true }, select: { id: true } })).id, uow.now)
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: location.id, action: 'approve_refill', at: uow.now })
      if (args.decision !== 'deny') {
        const vcprPolicy = await resolvePolicy(uow.tx, 'vcpr', { locationId: location.id, on })
        const vcpr = await uow.tx.vcprRecord.findFirst({ where: { patientId: request.patientId, status: 'active', expiresAt: { gt: uow.now }, ...(vcprPolicy.rules.level === 'dvm' ? { dvmId: staff.id } : {}) }, select: { id: true } })
        if (!vcpr && args.decision !== 'needs_exam') throw new DomainError(Codes.VCPR_REQUIRED, 'There is no current veterinarian-client-patient relationship; ask for an exam instead.')
      }
      if (args.decision === 'fulfil_existing') {
        const lines = await uow.tx.prescriptionLine.findMany({ where: { prescription: { patientId: request.patientId, status: 'active' }, expiresAt: { gt: uow.now } }, select: { id: true, refillsAuthorised: true } })
        const used = await Promise.all(lines.map(async l => (await uow.tx.dispense.count({ where: { lineId: l.id } })) <= l.refillsAuthorised))
        if (!used.some(Boolean)) throw new DomainError(Codes.GUARD_FAILED, 'No active prescription has a fill left. Write a new prescription or ask for an exam.')
      }
      const row = await transition(uow, {
        model: 'RefillRequest', id: args.requestId, from: ['received', 'in_review'], to, expectedVersion: args.expectedVersion, actor, eventType: 'refill.decided', reason: reason || null,
        data: { decidedById: staff.id, decidedAt: uow.now, denialReason: args.decision === 'deny' ? reason : '', pharmacyNote: args.decision === 'needs_exam' ? reason : undefined },
      })
      await uow.tx.task.updateMany({ where: { subjectType: 'RefillRequest', subjectId: request.id, kind: 'refill_review', status: { in: ['open', 'in_progress'] } }, data: { status: 'done', completedAt: uow.now, version: { increment: 1 } } })
      return { id: row.id, ref: request.ref, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Dispense one fill of a prescription line (I-RX3): the prescription must be active and in date, the
 * fill number within the line's refills (the database refuses one more), the stock must be in date, and
 * a controlled drug leaves its container with a register entry in this same transaction. The label
 * carries every field the practice's prescription policy names.
 */
export async function dispenseFill(_root: unknown, args: { lineId: string; quantity: string; lotId?: string | null; csContainerId?: string | null; refillRequestId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canDispense', 'canFulfilRefill'], tool: 'dispense.fill', humanOnly: true }, args, async actor => {
    const qty = positiveQty(args.quantity, 'quantity')
    const result = await command(context.prisma, { name: 'dispense.fill', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const line0 = await uow.tx.prescriptionLine.findUnique({ where: { id: args.lineId }, select: { prescriptionId: true } })
      if (!line0?.prescriptionId) throw new DomainError(Codes.NOT_FOUND, 'Prescription line not found.')
      const rxRow = await lockRow<{ id: string; status: string; version: number }>(uow.tx, 'Prescription', line0.prescriptionId)
      const rx = await uow.tx.prescription.findUniqueOrThrow({ where: { id: rxRow.id }, include: { prescriber: { select: { displayName: true } }, location: { select: { id: true, name: true, addressLine1: true, city: true, stateCode: true, phone: true } }, patient: { select: { id: true, name: true, species: { select: { name: true } } } }, client: { select: { id: true, displayName: true } }, lines: { select: { id: true } } } })
      if (rx.status !== 'active') throw new DomainError(Codes.GUARD_FAILED, `This prescription is ${rx.status}.`)
      const line = await uow.tx.prescriptionLine.findUniqueOrThrow({ where: { id: args.lineId }, include: { product: true } })
      if (line.expiresAt < uow.now) throw new DomainError(Codes.GUARD_FAILED, 'This prescription line has expired.')
      if (!rx.location || !rx.patient) throw new DomainError(Codes.GUARD_FAILED, 'The prescription is missing its location or patient.')
      await activePatient(uow, rx.patient.id)
      const { on } = await locationDay(uow, rx.location.id, uow.now)
      const fills = await uow.tx.dispense.count({ where: { lineId: line.id } })
      if (fills > line.refillsAuthorised) throw new DomainError(Codes.GUARD_FAILED, 'Every fill of this prescription has been used.')
      if (dec(qty).gt(dec(line.quantity.toString()))) throw new DomainError(Codes.GUARD_FAILED, `A fill is at most ${line.quantity.toString()} ${line.quantityUnit ?? ''} (the quantity written).`.replace(/ +\./, '.'))
      if (fills > 0 || args.refillRequestId) {
        const vcprPolicy = await resolvePolicy(uow.tx, 'vcpr', { locationId: rx.location.id, on })
        if (vcprPolicy.rules.requiredFor.includes('refill')) {
          const vcpr = await uow.tx.vcprRecord.findFirst({ where: { patientId: rx.patient.id, status: 'active', expiresAt: { gt: uow.now } }, select: { id: true } })
          if (!vcpr) throw new DomainError(Codes.VCPR_REQUIRED, 'There is no current veterinarian-client-patient relationship; this refill needs an exam first.')
        }
      }
      if (args.refillRequestId) {
        const req = await uow.tx.refillRequest.findUnique({ where: { id: args.refillRequestId }, select: { status: true, patientId: true } })
        if (!req || req.patientId !== rx.patient.id) throw new DomainError(Codes.GUARD_FAILED, 'That refill request is for another patient.')
        if (req.status !== 'fulfilled_under_existing_rx') throw new DomainError(Codes.GUARD_FAILED, 'A veterinarian has not approved that refill request.')
      }
      const controlled = isCs(line.csSchedule)
      let lotId: string | null = null
      let lotNumber = ''
      let expiryOn: Date | null = null
      let containerId: string | null = null
      let csEntryId: string | null = null
      if (controlled) {
        if (!can(actor, 'canAdministerControlled')) throw new DomainError(Codes.NOT_AUTHORIZED, 'Dispensing a controlled drug needs the controlled-substance permission.')
        await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: rx.location.id, action: 'administer_controlled', at: uow.now })
        await requireDeaRegistration(uow.tx, { locationId: rx.location.id, schedule: line.csSchedule as CsSchedule, at: uow.now, action: 'dispense_controlled', actorStaffMemberId: staff.id })
        if (!args.csContainerId) throw new DomainError(Codes.INVALID_INPUT, 'Choose the container the drug comes from.', { field: 'csContainerId' })
        const c = await lockedContainer(uow, args.csContainerId)
        if (c.productId !== line.productId) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} holds a different drug.`)
        if (c.locationId !== rx.location.id) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} belongs to another location.`)
        if (c.status !== 'open') throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`)
        if (c.lotExpiresOn && day(c.lotExpiresOn)! < on) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} expired on ${day(c.lotExpiresOn)}.`)
        if (line.quantityUnit && line.quantityUnit !== c.labelUnit) throw new DomainError(Codes.GUARD_FAILED, `The prescription is in ${line.quantityUnit} but ${c.ref} is counted in ${c.labelUnit}.`)
        const balance = await containerBalance(uow.tx, c.id)
        if (balance.lt(dec(qty))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`)
        const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: 'dispense', qtySigned: dec(qty).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, patientId: rx.patient.id, clientId: rx.client?.id ?? null, reason: rx.ref }, uow.now)
        containerId = c.id; csEntryId = entry.id; lotNumber = c.lotNumber; expiryOn = c.lotExpiresOn
      } else {
        const lots = await uow.tx.inventoryLot.findMany({ where: { drugId: line.productId, locationId: rx.location.id, status: 'available', expiresOn: { gte: new Date(`${on}T00:00:00Z`) } }, orderBy: { expiresOn: 'asc' }, select: { id: true, lotNumber: true, expiresOn: true } })
        const pick = args.lotId ? lots.find(l => l.id === args.lotId) : lots[0]
        if (args.lotId && !pick) throw new DomainError(Codes.GUARD_FAILED, 'That lot is not available here (expired, quarantined or another drug).')
        if (pick) { lotId = pick.id; lotNumber = pick.lotNumber; expiryOn = pick.expiresOn }
      }
      const ref = await nextReference(uow.tx, 'DSP', uow.now)
      const policy = await resolvePolicy(uow.tx, 'prescription', { locationId: rx.location.id, on })
      const p = line.product
      if (!p) throw new DomainError(Codes.GUARD_FAILED, 'The prescription line has no drug.')
      const labelValues: Record<string, string> = {
        patient_name: rx.patient.name, species: rx.patient.species?.name ?? '', client_name: rx.client?.displayName ?? '', drug_name: p.displayName,
        strength: [p.strength?.toString(), p.strengthUnit].filter(Boolean).join(' '), quantity: `${qty} ${line.quantityUnit ?? ''}`.trim(), directions: line.directions, prescriber_name: rx.prescriber?.displayName ?? '',
        practice_name_address_phone: [rx.location.name, rx.location.addressLine1, rx.location.city, rx.location.stateCode, rx.location.phone].filter(Boolean).join(', '), date_dispensed: on,
        expiry_date: expiryOn ? day(expiryOn)! : '', cautionary_statements: line.extralabel ? 'Used in a way not on the drug label. Keep out of reach of children.' : 'Keep out of reach of children.', rx_number: rx.ref,
        lot_number: lotNumber, refills_remaining: String(Math.max(line.refillsAuthorised - fills, 0)),
      }
      const labelJson = Object.fromEntries([...policy.rules.labelFields, 'lot_number', 'refills_remaining'].map(f => [f, labelValues[f] ?? '']))
      const row = await uow.tx.dispense.create({
        data: { ref, prescriptionId: rx.id, lineId: line.id, patientId: rx.patient.id, clientId: rx.client?.id ?? null, locationId: rx.location.id, productId: line.productId, lotId, containerId, csLogEntryId: csEntryId, refillRequestId: args.refillRequestId ?? null, quantity: toScale(dec(qty), 'qty'), quantityUnit: line.quantityUnit, refillNumber: fills, dispensedById: staff.id, dispensedAt: uow.now, label: labelJson },
      })
      auditCreate(uow, actor, 'Dispense', row.id, 'dispense.filled', { ref, rx: rx.ref, lineId: line.id, refillNumber: fills, quantity: qty, containerId, lotId })
      if (controlled) {
        const cs = await resolvePolicy(uow.tx, 'controlled_substances', { locationId: rx.location.id, on })
        if (cs.rules.pdmp.required && cs.rules.pdmp.schedules.includes(line.csSchedule as CsSchedule)) {
          const prefix = await nextReference(uow.tx, 'PDM', uow.now)
          await uow.tx.pdmpReport.create({ data: { ref: prefix, locationId: rx.location.id, dispenseId: row.id, program: cs.rules.pdmp.program, format: cs.rules.pdmp.format, dueOn: dateOnly(addDays(on, cs.rules.pdmp.maxDays), 'dueOn'), status: 'pending' } })
        }
      }
      const filled = fills + 1
      const all = await uow.tx.prescriptionLine.findMany({ where: { prescriptionId: rx.id }, select: { id: true, refillsAuthorised: true } })
      const counts = await Promise.all(all.map(async l => ({ l, n: l.id === line.id ? filled : await uow.tx.dispense.count({ where: { lineId: l.id } }) })))
      if (counts.every(c => c.n > c.l.refillsAuthorised)) await transition(uow, { model: 'Prescription', id: rx.id, from: ['active'], to: 'exhausted', actor, eventType: 'prescription.exhausted' })
      return { id: row.id, ref, status: 'dispensed', refillNumber: fills, registerEntryId: csEntryId }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Inventory ──────────────────────────────────────────────────────────────────────────────

/** Receive a lot of a drug or vaccine into a location's stock. Controlled drugs are received only through the register. */
export async function receiveStockLot(_root: unknown, args: { drugId?: string | null; vaccineId?: string | null; locationId: string; lotNumber: string; expiresOn: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveStock', 'canManageInventory'], tool: 'stock.receive', humanOnly: true }, args, async actor => {
    const lotNumber = text(args.lotNumber, 'lotNumber', 60)
    const expiresOn = dateOnly(args.expiresOn, 'Expires')
    if (!args.drugId === !args.vaccineId) throw new DomainError(Codes.INVALID_INPUT, 'Choose a drug or a vaccine.')
    const result = await command(context.prisma, { name: 'stock.receive', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const { on } = await locationDay(uow, args.locationId, uow.now)
      if (day(expiresOn)! <= on) throw new DomainError(Codes.GUARD_FAILED, 'That lot is already expired.')
      if (args.drugId) {
        const drug = await uow.tx.drugProduct.findUnique({ where: { id: args.drugId }, select: { csSchedule: true, active: true } })
        if (!drug?.active) throw new DomainError(Codes.NOT_FOUND, 'Drug not found.')
        if (isCs(drug.csSchedule)) throw new DomainError(Codes.GUARD_FAILED, 'Controlled drugs are received through the controlled-substance register.')
      } else if (!(await uow.tx.vaccineProduct.findUnique({ where: { id: args.vaccineId! }, select: { id: true } }))) throw new DomainError(Codes.NOT_FOUND, 'Vaccine not found.')
      const existing = await uow.tx.inventoryLot.findFirst({ where: { locationId: args.locationId, lotNumber, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null }, select: { id: true } })
      if (existing) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already in stock here.`)
      const row = await uow.tx.inventoryLot.create({ data: { drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null, locationId: args.locationId, lotNumber, expiresOn, status: 'available' } })
      auditCreate(uow, actor, 'InventoryLot', row.id, 'stock.received', { lotNumber, expiresOn: args.expiresOn, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Put a lot in quarantine (recall, temperature, damage) or release it. Releasing is a separate permission. */
export async function setLotQuarantine(_root: unknown, args: { lotId: string; quarantine: boolean; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: args.quarantine ? ['canManageInventory', 'canReceiveStock'] : ['canReleaseQuarantine'], tool: 'stock.quarantine', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    if (reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, 'Say why (at least 5 characters).', { field: 'reason' })
    const result = await command(context.prisma, { name: 'stock.quarantine', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, {
        model: 'InventoryLot', id: args.lotId, from: args.quarantine ? ['available'] : ['quarantined'], to: args.quarantine ? 'quarantined' : 'available', expectedVersion: args.expectedVersion, actor,
        eventType: args.quarantine ? 'stock.quarantined' : 'stock.released', reason, data: { quarantineReason: args.quarantine ? reason : '' },
      })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── The controlled-substance register ─────────────────────────────────────────────────────

/** Receive a bottle of a controlled drug: a sealed container and its first register entry (Form 222 reference for Schedule II). */
export async function receiveControlled(_root: unknown, args: { productId: string; locationId: string; lotNumber: string; lotExpiresOn: string; labelQty: string; labelUnit: string; orderFormReference?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveControlled'], tool: 'cs.receive', humanOnly: true }, args, async actor => {
    const lotNumber = text(args.lotNumber, 'lotNumber', 60)
    const lotExpiresOn = dateOnly(args.lotExpiresOn, 'Expires')
    const labelQty = positiveQty(args.labelQty, 'labelQty')
    if (!CS_UNITS.has(args.labelUnit)) throw new DomainError(Codes.INVALID_INPUT, 'Choose a unit.', { field: 'labelUnit' })
    const result = await command(context.prisma, { name: 'cs.receive', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const product = await uow.tx.drugProduct.findUnique({ where: { id: args.productId }, select: { id: true, displayName: true, csSchedule: true, active: true } })
      if (!product?.active || !isCs(product.csSchedule)) throw new DomainError(Codes.NOT_FOUND, 'That is not a controlled drug in the formulary.', { field: 'productId' })
      const { on } = await locationDay(uow, args.locationId, uow.now)
      if (day(lotExpiresOn)! <= on) throw new DomainError(Codes.GUARD_FAILED, 'That bottle is already expired.')
      const reg = await requireDeaRegistration(uow.tx, { locationId: args.locationId, schedule: product.csSchedule as CsSchedule, at: uow.now, action: 'receive_controlled', actorStaffMemberId: staff.id })
      const scheduleII = product.csSchedule === 'CII' || product.csSchedule === 'CIIN'
      const form = String(args.orderFormReference ?? '').trim().slice(0, 40)
      if (scheduleII && !form) throw new DomainError(Codes.INVALID_INPUT, 'A Schedule II drug is received against a DEA Form 222 or CSOS order: enter its number.', { field: 'orderFormReference' })
      const ref = `CSC-${(await uow.tx.location.findUniqueOrThrow({ where: { id: args.locationId }, select: { code: true } })).code.toUpperCase()}-${(await nextReference(uow.tx, 'CSB', uow.now)).slice(-6)}`
      const container = await uow.tx.csContainer.create({ data: { ref, productId: product.id, locationId: args.locationId, deaRegistrationId: reg.deaRegistrationId, lotNumber, lotExpiresOn, status: 'sealed', labelQty, labelUnit: args.labelUnit as never } })
      const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: 'receive', qtySigned: labelQty, unit: args.labelUnit, occurredAt: uow.now, actorId: staff.id, reason: form ? `Received on order ${form}` : 'Received' }, uow.now)
      auditCreate(uow, actor, 'CsContainer', container.id, 'cs.received', { ref, product: product.displayName, qty: labelQty, unit: args.labelUnit, orderForm: form || null, entry: entry.ref })
      return { id: container.id, ref, status: 'sealed' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Open a sealed container for use: stamps the opening time and the beyond-use date. */
export async function openControlled(_root: unknown, args: { containerId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveControlled', 'canAdministerControlled'], tool: 'cs.open', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'cs.open', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const c = await lockedContainer(uow, args.containerId)
      const bud = new Date(uow.now.getTime() + (c.product.multiDoseBudDays ?? 28) * 86_400_000)
      const row = await transition(uow, { model: 'CsContainer', id: c.id, from: ['sealed'], to: 'open', expectedVersion: args.expectedVersion, actor, eventType: 'cs.opened', data: { openedAt: uow.now, openedById: staff.id, budAt: bud } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Waste from a container (a dose drawn and not given, a spill, an expired remainder): witnessed, in the register. */
export async function wasteControlled(_root: unknown, args: { containerId: string; qty: string; reason: string; witnessId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdministerControlled'], tool: 'cs.waste', humanOnly: true }, args, async actor => {
    const qty = positiveQty(args.qty, 'qty')
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'cs.waste', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const witness = await witnessFor(uow, args.witnessId, staff.id)
      const c = await lockedContainer(uow, args.containerId)
      if (c.status !== 'open') throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`)
      const balance = await containerBalance(uow.tx, c.id)
      if (balance.lt(dec(qty))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`)
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: 'waste', qtySigned: dec(qty).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason }, uow.now)
      auditCreate(uow, actor, 'CsLogEntry', entry.id, 'cs.wasted', { ref: entry.ref, container: c.ref, qty, witness: witness.displayName }, { reason })
      return { id: entry.id, ref: entry.ref, status: 'recorded' }
    })
    return { replay: result.replay, ...result.value }
  })
}

type CaseKind = 'count_variance' | 'theft' | 'loss'

async function openCase(uow: UnitOfWork, input: { locationId: string; containerId: string; kind: CaseKind; qty: string; unit: string; staffId: string; description: string }) {
  const { on } = await locationDay(uow, input.locationId, uow.now)
  const policy = await resolvePolicy(uow.tx, 'controlled_substances', { locationId: input.locationId, on })
  const calendar = await calendarFor(uow, input.locationId)
  const ref = await nextReference(uow.tx, 'CSD', uow.now)
  return uow.tx.csDiscrepancyCase.create({
    data: {
      ref, locationId: input.locationId, containerId: input.containerId, kind: input.kind, qty: input.qty, unit: input.unit as never, discoveredAt: uow.now, discoveredById: input.staffId, description: input.description.slice(0, 500), status: 'open',
      noticeDueOn: dateOnly(addBusinessDays(calendar, on, policy.rules.theftLossNoticeBusinessDays), 'noticeDueOn'), form106DueOn: dateOnly(addDays(on, policy.rules.form106Days), 'form106DueOn'),
    },
  })
}

/**
 * A count of every open container at a location (initial, biennial, periodic or spot), by one person with a
 * witness. Every open container must be counted. A difference writes a count-variance register entry that
 * brings the book to the count, and opens a discrepancy case with its clocks.
 */
export async function countControlled(_root: unknown, args: { locationId: string; kind: string; witnessId: string; counts: { containerId: string; countedQty: string }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCountControlled'], tool: 'cs.count', humanOnly: true }, args, async actor => {
    if (!['initial', 'biennial', 'periodic', 'spot'].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the kind of count.', { field: 'kind' })
    if (!Array.isArray(args.counts) || !args.counts.length || args.counts.length > 200) throw new DomainError(Codes.INVALID_INPUT, 'Enter the counted amount for each container.', { field: 'counts' })
    const result = await command(context.prisma, { name: 'cs.count', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const witness = await witnessFor(uow, args.witnessId, staff.id)
      await locationDay(uow, args.locationId, uow.now)
      const open = await uow.tx.csContainer.findMany({ where: { locationId: args.locationId, status: 'open' }, orderBy: { ref: 'asc' }, select: { id: true, ref: true } })
      const given = new Map(args.counts.map(c => [c.containerId, c.countedQty]))
      if (given.size !== args.counts.length) throw new DomainError(Codes.INVALID_INPUT, 'A container is counted twice.')
      const missing = open.filter(c => !given.has(c.id))
      if (missing.length) throw new DomainError(Codes.GUARD_FAILED, `Count every open container. Missing: ${missing.map(m => m.ref).join(', ')}.`)
      const stray = [...given.keys()].filter(id => !open.some(o => o.id === id))
      if (stray.length) throw new DomainError(Codes.GUARD_FAILED, 'One of those containers is not open at this location.')
      const ref = await nextReference(uow.tx, 'CSN', uow.now)
      const count = await uow.tx.csCount.create({ data: { ref, locationId: args.locationId, kind: args.kind, countedById: staff.id, witnessId: witness.id, countedAt: uow.now, status: 'closed' } })
      const lines = [] as { container: string; expected: string; counted: string; variance: string; case?: string }[]
      for (const o of open) {
        const c = await lockedContainer(uow, o.id)
        const counted = dec(decimalText(given.get(o.id), `count of ${o.ref}`))
        const expected = await containerBalance(uow.tx, o.id)
        const variance = counted.minus(expected)
        let caseId: string | null = null
        if (!variance.isZero()) {
          await appendCsEntry(uow.tx, { containerId: o.id, type: 'count_variance', qtySigned: variance, unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `Count ${ref}: counted ${plain(counted)}, book ${plain(expected)}` }, uow.now)
          const dc = await openCase(uow, { locationId: args.locationId, containerId: o.id, kind: 'count_variance', qty: plain(variance.abs()), unit: c.labelUnit, staffId: staff.id, description: `Count ${ref} found ${plain(counted)} ${c.labelUnit}; the register said ${plain(expected)}.` })
          caseId = dc.id
        }
        await uow.tx.csCountLine.create({ data: { countId: count.id, containerId: o.id, expectedQty: toScale(expected, 'qty'), countedQty: toScale(counted, 'qty'), variance: toScale(variance, 'qty'), unit: c.labelUnit as never, discrepancyCaseId: caseId } })
        lines.push({ container: o.ref, expected: plain(expected), counted: plain(counted), variance: plain(variance), ...(caseId ? { case: caseId } : {}) })
      }
      auditCreate(uow, actor, 'CsCount', count.id, 'cs.counted', { ref, kind: args.kind, lines })
      return { id: count.id, ref, status: 'closed', variances: lines.filter(l => l.case).length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Theft or loss: the register entry (witnessed) and a case whose notice and Form 106 clocks start now. */
export async function reportCsLoss(_root: unknown, args: { containerId: string; kind: 'theft' | 'loss'; qty: string; description: string; witnessId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCountControlled', 'canManageControlled'], tool: 'cs.report_loss', humanOnly: true }, args, async actor => {
    if (args.kind !== 'theft' && args.kind !== 'loss') throw new DomainError(Codes.INVALID_INPUT, 'Choose theft or loss.', { field: 'kind' })
    const qty = positiveQty(args.qty, 'qty')
    const description = text(args.description, 'description', 500)
    const result = await command(context.prisma, { name: 'cs.report_loss', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const witness = await witnessFor(uow, args.witnessId, staff.id)
      const c = await lockedContainer(uow, args.containerId)
      const balance = await containerBalance(uow.tx, c.id)
      if (balance.lt(dec(qty))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has only ${plain(balance)} ${c.labelUnit} on the register; record the count first.`)
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: 'theft_loss', qtySigned: dec(qty).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `${args.kind}: ${description}`.slice(0, 300) }, uow.now)
      const dc = await openCase(uow, { locationId: c.locationId, containerId: c.id, kind: args.kind, qty, unit: c.labelUnit, staffId: staff.id, description })
      auditCreate(uow, actor, 'CsDiscrepancyCase', dc.id, 'cs.loss_reported', { ref: dc.ref, kind: args.kind, container: c.ref, qty, entry: entry.ref, noticeDueOn: day(dc.noticeDueOn), form106DueOn: day(dc.form106DueOn) })
      return { id: dc.id, ref: dc.ref, status: 'open' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Move a discrepancy case along: DEA notice given, Form 106 filed, then closed with a resolution. Times are stamped by the server. */
export async function advanceDiscrepancy(_root: unknown, args: { caseId: string; step: 'notice' | 'form106' | 'close'; reference?: string | null; resolution?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled'], tool: 'cs.advance_case', humanOnly: true }, args, async actor => {
    if (!['notice', 'form106', 'close'].includes(args.step)) throw new DomainError(Codes.INVALID_INPUT, 'Choose a step.', { field: 'step' })
    const reference = String(args.reference ?? '').trim().slice(0, 80)
    const resolution = String(args.resolution ?? '').trim().slice(0, 500)
    if (args.step !== 'close' && !reference) throw new DomainError(Codes.INVALID_INPUT, args.step === 'notice' ? 'Enter the confirmation or case number from the DEA notice.' : 'Enter the Form 106 confirmation number.', { field: 'reference' })
    if (args.step === 'close' && resolution.length < 5) throw new DomainError(Codes.INVALID_INPUT, 'Say how this was resolved (at least 5 characters).', { field: 'resolution' })
    const result = await command(context.prisma, { name: 'cs.advance_case', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const current = await uow.tx.csDiscrepancyCase.findUnique({ where: { id: args.caseId }, select: { kind: true } })
      if (!current) throw new DomainError(Codes.NOT_FOUND, 'Case not found.')
      const spec = args.step === 'notice'
        ? { from: ['open'], to: 'notified', event: 'cs.case_notified', data: { noticeGivenAt: uow.now, noticeReference: reference } }
        : args.step === 'form106'
          ? { from: ['notified'], to: 'form_filed', event: 'cs.case_form106', data: { form106FiledAt: uow.now, form106Reference: reference } }
          : { from: current.kind === 'count_variance' ? ['open', 'notified', 'form_filed'] : ['form_filed'], to: 'closed', event: 'cs.case_closed', data: { closedAt: uow.now, resolution } }
      if (args.step === 'close' && current.kind !== 'count_variance') {
        const c = await uow.tx.csDiscrepancyCase.findUniqueOrThrow({ where: { id: args.caseId }, select: { status: true } })
        if (c.status !== 'form_filed') throw new DomainError(Codes.GUARD_FAILED, 'A theft or loss closes only after the DEA notice and Form 106 are recorded.')
      }
      const row = await transition(uow, { model: 'CsDiscrepancyCase', id: args.caseId, from: spec.from, to: spec.to, expectedVersion: args.expectedVersion, actor, eventType: spec.event, reason: reference || resolution || null, data: spec.data, metadata: { by: staff.id } } as never)
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Destroy stock (Form 41): two witnesses, each someone other than the person recording and each other. */
export async function destroyControlled(_root: unknown, args: { containerId: string; qty?: string | null; method: string; form41Reference?: string | null; witnessAId: string; witnessBId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled'], tool: 'cs.destroy', humanOnly: true }, args, async actor => {
    const method = text(args.method, 'method', 200)
    const result = await command(context.prisma, { name: 'cs.destroy', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (args.witnessAId === args.witnessBId) throw new DomainError(Codes.GUARD_FAILED, 'Destruction needs two different witnesses.')
      const a = await witnessFor(uow, args.witnessAId, staff.id)
      const b = await witnessFor(uow, args.witnessBId, staff.id)
      const c = await lockedContainer(uow, args.containerId)
      if (['disposed', 'retired'].includes(c.status)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is already ${c.status}.`)
      const balance = await containerBalance(uow.tx, c.id)
      const qty = args.qty ? dec(positiveQty(args.qty, 'qty')) : balance
      if (qty.lte(0)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has nothing left to destroy.`)
      if (qty.gt(balance)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`)
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: 'destroy', qtySigned: qty.neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: a.id, reason: `Destroyed by ${method}` }, uow.now)
      const ref = await nextReference(uow.tx, 'CSX', uow.now)
      const rec = await uow.tx.csDestructionRecord.create({ data: { ref, containerId: c.id, locationId: c.locationId, csLogEntryId: entry.id, qty: toScale(qty, 'qty'), unit: c.labelUnit as never, method, form41Reference: String(args.form41Reference ?? '').trim().slice(0, 60), recordedById: staff.id, witnessAId: a.id, witnessBId: b.id, destroyedAt: uow.now } })
      const remaining = balance.minus(qty)
      if (remaining.isZero()) await transition(uow, { model: 'CsContainer', id: c.id, from: ['sealed', 'open', 'emptied', 'quarantined'], to: 'disposed', actor, eventType: 'cs.container_disposed' })
      auditCreate(uow, actor, 'CsDestructionRecord', rec.id, 'cs.destroyed', { ref, container: c.ref, qty: plain(qty), witnesses: [a.displayName, b.displayName] })
      return { id: rec.id, ref, status: remaining.isZero() ? 'disposed' : 'recorded' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Record that a PDMP report was uploaded to the state programme (staff upload it there; this keeps the evidence and the date). */
export async function submitPdmp(_root: unknown, args: { reportId: string; confirmation: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled', 'canCountControlled'], tool: 'cs.pdmp_submit', humanOnly: true }, args, async actor => {
    const confirmation = text(args.confirmation, 'confirmation', 100)
    const result = await command(context.prisma, { name: 'cs.pdmp_submit', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const row = await transition(uow, { model: 'PdmpReport', id: args.reportId, from: ['pending'], to: 'submitted', expectedVersion: args.expectedVersion, actor, eventType: 'cs.pdmp_submitted', reason: confirmation, data: { submittedAt: uow.now, submittedById: staff.id, confirmation } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}
