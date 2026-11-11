import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { dec, toScale } from '../lib/decimal'
import { sha256, canonicalJson } from '../lib/canonical'
import { appendCsEntry, containerBalance } from '../lib/csRegister'
import { buildAsapFile, type AsapDispense } from '../lib/asap'
import { orderFormExpiry } from '../domain/discrepancy'
import { requireDeaRegistration, type CsSchedule } from '../domain/licensure'
import { gated } from './agentGuard'
import { decimalText, locationDay, staffOf, text, witnessFor, type Ctx } from './clinical'

/*
 * The rest of the controlled-substance register and the pharmacy paperwork (BUILD-PLAN P3): order forms,
 * transfers between registrations, cabinet access, the PDMP file, printed labels, outside-pharmacy fills and
 * written prescriptions. As in pharmacy.ts: one transaction per command, human staff only, no timers.
 */

const ymd = (value: string, field: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field })
  return value
}
const asDate = (v: string) => new Date(`${v}T00:00:00Z`)

/** Record a DEA Form 222 / CSOS order for Schedule I-II. Valid for 60 days from issue; the database holds the same rule. */
export async function issueOrderForm(_root: unknown, args: { supplierId: string; locationId: string; formNumber: string; kind: string; issuedOn: string; lines: { productId: string; packages: number }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled', 'canReceiveControlled'], tool: 'cs.order_form', humanOnly: true }, args, async actor => {
    const formNumber = text(args.formNumber, 'formNumber', 40)
    const issuedOn = ymd(args.issuedOn, 'Issued')
    if (!['form_222', 'csos'].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose Form 222 or CSOS.', { field: 'kind' })
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 20) throw new DomainError(Codes.INVALID_INPUT, 'A form lists between one and twenty drugs.', { field: 'lines' })
    const result = await command(context.prisma, { name: 'cs.order_form', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const { on } = await locationDay(uow, args.locationId, uow.now)
      if (issuedOn > on) throw new DomainError(Codes.GUARD_FAILED, 'A form cannot be issued in the future.')
      const supplier = await uow.tx.supplier.findFirst({ where: { id: args.supplierId, active: true }, select: { id: true } })
      if (!supplier) throw new DomainError(Codes.NOT_FOUND, 'Supplier not found.')
      for (const l of args.lines) {
        if (!Number.isInteger(l.packages) || l.packages < 1 || l.packages > 1000) throw new DomainError(Codes.INVALID_INPUT, 'Packages: a whole number from 1 to 1000.', { field: 'packages' })
        const p = await uow.tx.drugProduct.findUnique({ where: { id: l.productId }, select: { csSchedule: true } })
        if (!p || (p.csSchedule !== 'CII' && p.csSchedule !== 'CIIN')) throw new DomainError(Codes.GUARD_FAILED, 'Only Schedule II drugs are ordered on a Form 222 or CSOS.')
        await requireDeaRegistration(uow.tx, { locationId: args.locationId, schedule: p.csSchedule as CsSchedule, at: uow.now, action: 'order_controlled', actorStaffMemberId: staff.id })
      }
      if (await uow.tx.csOrderForm.findFirst({ where: { supplierId: args.supplierId, formNumber }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `Form ${formNumber} has already been recorded for that supplier.`)
      const ref = await nextReference(uow.tx, 'OF', uow.now)
      const row = await uow.tx.csOrderForm.create({
        data: { ref, formNumber, kind: args.kind as never, locationId: args.locationId, supplierId: args.supplierId, issuedOn: asDate(issuedOn), expiresOn: asDate(orderFormExpiry(issuedOn)), status: 'open', signedById: staff.id, lines: { create: args.lines.map(l => ({ productId: l.productId, packages: l.packages, packagesReceived: 0 })) } },
      })
      auditCreate(uow, actor, 'CsOrderForm', row.id, 'cs.order_form_issued', { ref, formNumber, expiresOn: orderFormExpiry(issuedOn) })
      return { id: row.id, ref, status: 'open', version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Receive one package against an open order form line: it creates the container (a Schedule II receipt needs a
 * form), counts the package against the form, and refuses an expired or fully received form.
 */
export async function receiveOnOrderForm(_root: unknown, args: { lineId: string; lotNumber: string; lotExpiresOn: string; labelQty: string; labelUnit: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveControlled'], tool: 'cs.receive_on_form', humanOnly: true }, args, async actor => {
    const lotNumber = text(args.lotNumber, 'lotNumber', 60)
    const lotExpiresOn = ymd(args.lotExpiresOn, 'Expires')
    const labelQty = decimalText(args.labelQty, 'labelQty')
    if (!dec(labelQty).gt(0)) throw new DomainError(Codes.INVALID_INPUT, 'Quantity must be more than zero.', { field: 'labelQty' })
    const result = await command(context.prisma, { name: 'cs.receive_on_form', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const line = await lockRow<{ id: string; orderFormId: string; productId: string; packages: number; packagesReceived: number }>(uow.tx, 'CsOrderFormLine', args.lineId)
      const form = await uow.tx.csOrderForm.findUnique({ where: { id: line.orderFormId }, select: { id: true, ref: true, formNumber: true, status: true, locationId: true, expiresOn: true, version: true } })
      if (!form || !['open', 'partially_filled'].includes(form.status)) throw new DomainError(Codes.GUARD_FAILED, `That order form is ${form?.status.replaceAll('_', ' ') ?? 'missing'}.`)
      const { on } = await locationDay(uow, form.locationId!, uow.now)
      if (form.expiresOn.toISOString().slice(0, 10) < on) throw new DomainError(Codes.GUARD_FAILED, `Form ${form.formNumber} expired on ${form.expiresOn.toISOString().slice(0, 10)}; it is valid for 60 days.`)
      if (line.packagesReceived >= line.packages) throw new DomainError(Codes.GUARD_FAILED, 'Every package on that line has arrived.')
      const product = await uow.tx.drugProduct.findUniqueOrThrow({ where: { id: line.productId }, select: { id: true, csSchedule: true } })
      const reg = await requireDeaRegistration(uow.tx, { locationId: form.locationId!, schedule: product.csSchedule as CsSchedule, at: uow.now, action: 'receive_controlled', actorStaffMemberId: staff.id })
      const loc = await uow.tx.location.findUniqueOrThrow({ where: { id: form.locationId! }, select: { code: true } })
      const ref = `CSC-${loc.code.toUpperCase()}-${(await nextReference(uow.tx, 'CSB', uow.now)).slice(-6)}`
      const container = await uow.tx.csContainer.create({ data: { ref, productId: product.id, locationId: form.locationId!, deaRegistrationId: reg.deaRegistrationId, lotNumber, lotExpiresOn: asDate(lotExpiresOn), status: 'sealed', labelQty: toScale(dec(labelQty), 'qty'), labelUnit: args.labelUnit as never } })
      const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: 'receive', qtySigned: labelQty, unit: args.labelUnit, occurredAt: uow.now, actorId: staff.id, reason: `Received on order ${form.formNumber}` }, uow.now)
      await uow.tx.csOrderFormLine.update({ where: { id: line.id }, data: { packagesReceived: { increment: 1 } } })
      const lines = await uow.tx.csOrderFormLine.findMany({ where: { orderFormId: form.id }, select: { packages: true, packagesReceived: true } })
      const done = lines.every(l => l.packagesReceived >= l.packages)
      await transition(uow, { model: 'CsOrderForm', id: form.id, from: ['open', 'partially_filled'], to: done ? 'filled' : 'partially_filled', actor, eventType: 'cs.order_form_received' })
      auditCreate(uow, actor, 'CsContainer', container.id, 'cs.received', { ref, form: form.formNumber, entry: entry.ref })
      return { id: container.id, ref, status: done ? 'filled' : 'partially_filled' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Send controlled stock to another registrant (a reverse distributor or another clinic): a witnessed transfer-out entry. */
export async function transferControlled(_root: unknown, args: { containerId: string; qty: string; toRegistrationId: string; witnessId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled', 'canReceiveControlled'], tool: 'cs.transfer', humanOnly: true }, args, async actor => {
    const qty = decimalText(args.qty, 'qty')
    if (!dec(qty).gt(0)) throw new DomainError(Codes.INVALID_INPUT, 'Quantity must be more than zero.', { field: 'qty' })
    const result = await command(context.prisma, { name: 'cs.transfer', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const witness = await witnessFor(uow, args.witnessId, staff.id)
      const c = await lockRow<{ id: string; ref: string; status: string; labelUnit: string; deaRegistrationId: string | null }>(uow.tx, 'CsContainer', args.containerId)
      if (c.status !== 'open' && c.status !== 'sealed') throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`)
      if (args.toRegistrationId === c.deaRegistrationId) throw new DomainError(Codes.GUARD_FAILED, 'Choose a different registrant to send it to.')
      const to = await uow.tx.deaRegistration.findUnique({ where: { id: args.toRegistrationId }, select: { id: true, status: true, registrantName: true, expiresOn: true } })
      if (!to || to.status !== 'active' || to.expiresOn < uow.now) throw new DomainError(Codes.GUARD_FAILED, 'The receiving registration is not current.')
      const balance = await containerBalance(uow.tx, c.id)
      if (balance.lt(dec(qty))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${balance.toString()} ${c.labelUnit} left; that is not enough.`)
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: 'transfer_out', qtySigned: dec(qty).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `Sent to ${to.registrantName}` }, uow.now)
      await uow.tx.csWitness.create({ data: { entryId: entry.id, witnessId: witness.id, attestedAt: uow.now } })
      const ref = await nextReference(uow.tx, 'CST', uow.now)
      const row = await uow.tx.csTransfer.create({ data: { ref, fromContainerId: c.id, toRegistrationId: to.id, qty: toScale(dec(qty), 'qty'), unit: c.labelUnit as never, status: 'sent', outEntryId: entry.id, sentById: staff.id, witnessId: witness.id, sentAt: uow.now } })
      auditCreate(uow, actor, 'CsTransfer', row.id, 'cs.transferred', { ref, container: c.ref, qty, to: to.registrantName, witness: witness.displayName })
      return { id: row.id, ref, status: 'sent', version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** The other registrant has acknowledged the transfer. */
export async function confirmTransfer(_root: unknown, args: { transferId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled'], tool: 'cs.transfer_confirm', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'cs.transfer_confirm', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'CsTransfer', id: args.transferId, from: ['sent'], to: 'received', expectedVersion: args.expectedVersion, actor, eventType: 'cs.transfer_received', data: { receivedAt: uow.now } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Who opened or closed the controlled cabinet, and failed attempts. */
export async function logCabinetAccess(_root: unknown, args: { locationId: string; kind: string; note?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdministerControlled', 'canManageControlled', 'canCountControlled'], tool: 'cs.cabinet', humanOnly: true }, args, async actor => {
    if (!['opened', 'closed', 'failed_attempt'].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose opened, closed or failed attempt.', { field: 'kind' })
    const result = await command(context.prisma, { name: 'cs.cabinet', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      await locationDay(uow, args.locationId, uow.now)
      const row = await uow.tx.cabinetAccessEvent.create({ data: { locationId: args.locationId, staffId: staff.id, kind: args.kind as never, note: String(args.note ?? '').slice(0, 200), occurredAt: uow.now } })
      return { id: row.id, status: args.kind }
    })
    return { replay: result.replay, ...result.value }
  })
}

const lastName = (full: string) => full.trim().split(/\s+/).slice(-1)[0] ?? ''
const firstName = (full: string) => full.trim().split(/\s+/).slice(0, -1).join(' ')

/**
 * Build the ASAP 4.2B file for a location from its pending PDMP reports, keep the exact bytes and their hash,
 * and link the reports. Staff upload the file to the state programme and then mark each report submitted.
 */
export async function generatePdmpFile(_root: unknown, args: { locationId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageControlled', 'canCountControlled'], tool: 'cs.pdmp_file', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'cs.pdmp_file', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const location = await uow.tx.location.findUnique({ where: { id: args.locationId }, select: { id: true, name: true, addressLine1: true, city: true, stateCode: true, postalCode: true } })
      if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
      const reports = await uow.tx.pdmpReport.findMany({ where: { locationId: location.id, status: 'pending', submissionId: null }, orderBy: { createdAt: 'asc' }, take: 500, select: { id: true, ref: true, dispenseId: true } })
      if (!reports.length) throw new DomainError(Codes.GUARD_FAILED, 'Nothing is waiting to be reported.')
      const reg = await uow.tx.deaRegistration.findFirst({ where: { locationId: location.id, status: 'active' }, select: { registrationNumber: true } })
      const rows: AsapDispense[] = []
      for (const r of reports) {
        const d = await uow.tx.dispense.findUnique({
          where: { id: r.dispenseId! },
          select: { ref: true, quantity: true, refillNumber: true, dispensedAt: true, product: { select: { ndc: true, csSchedule: true } }, client: { select: { displayName: true, addressLine1: true, city: true, stateCode: true, postalCode: true } }, patient: { select: { name: true, species: { select: { code: true } } } }, prescription: { select: { ref: true, issuedAt: true, prescriber: { select: { displayName: true } }, deaRegistration: { select: { registrationNumber: true } } } }, line: { select: { refillsAuthorised: true } } },
        })
        if (!d) continue
        rows.push({
          rxNumber: d.prescription?.ref ?? d.ref, dateWritten: d.prescription?.issuedAt.toISOString() ?? d.dispensedAt.toISOString(), refillsAuthorised: d.line?.refillsAuthorised ?? 0, dateFilled: d.dispensedAt.toISOString(), refillNumber: d.refillNumber,
          ndc: d.product?.ndc ?? '', quantity: d.quantity.toString(), daysSupply: 0, schedule: d.product?.csSchedule ?? '',
          ownerLastName: lastName(d.client?.displayName ?? ''), ownerFirstName: firstName(d.client?.displayName ?? ''), ownerAddress: d.client?.addressLine1 ?? '', ownerCity: d.client?.city ?? '', ownerState: d.client?.stateCode ?? '', ownerPostal: d.client?.postalCode ?? '',
          species: d.patient?.species?.code ?? 'other', animalName: d.patient?.name ?? '', prescriberDea: d.prescription?.deaRegistration?.registrationNumber ?? '', prescriberLastName: lastName(d.prescription?.prescriber?.displayName ?? ''), prescriberFirstName: firstName(d.prescription?.prescriber?.displayName ?? ''),
        })
      }
      const ref = await nextReference(uow.tx, 'PDS', uow.now)
      const iso = uow.now.toISOString()
      const body = buildAsapFile({ controlNumber: ref, createdDate: iso.slice(0, 10).replaceAll('-', ''), createdTime: iso.slice(11, 19).replaceAll(':', ''), senderDea: reg?.registrationNumber ?? '', senderName: location.name, pharmacyDea: reg?.registrationNumber ?? '', pharmacyName: location.name, pharmacyAddress: location.addressLine1, pharmacyCity: location.city, pharmacyState: location.stateCode, pharmacyPostal: location.postalCode, dispenses: rows })
      const sub = await uow.tx.pdmpSubmission.create({ data: { ref, locationId: location.id, format: 'ASAP 4.2B', reportCount: reports.length, fileSha256: sha256(body), fileBody: { text: body } as never, generatedById: staff.id, generatedAt: uow.now } })
      await uow.tx.pdmpReport.updateMany({ where: { id: { in: reports.map(r => r.id) } }, data: { submissionId: sub.id } })
      auditCreate(uow, actor, 'PdmpSubmission', sub.id, 'cs.pdmp_file_generated', { ref, reports: reports.length, sha256: sha256(body) })
      return { id: sub.id, ref, status: 'generated', reports: reports.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Print (and keep) the label for a dispense exactly as it was printed. */
export async function printDispenseLabel(_root: unknown, args: { dispenseId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canDispense', 'canFulfilRefill'], tool: 'rx.print_label', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'rx.print_label', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const d = await uow.tx.dispense.findUnique({ where: { id: args.dispenseId }, select: { id: true, ref: true, label: true } })
      if (!d) throw new DomainError(Codes.NOT_FOUND, 'Dispense not found.')
      const row = await uow.tx.dispenseLabel.create({ data: { dispenseId: d.id, fields: (d.label ?? {}) as never, printedById: staff.id, printedAt: uow.now } })
      return { id: row.id, status: 'printed' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** An online or outside pharmacy will fill this prescription: record the request, then the decision. */
export async function requestExternalFill(_root: unknown, args: { prescriptionId: string; pharmacyName: string; orderReference?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canFulfilRefill', 'canDispense'], tool: 'rx.external_request', humanOnly: true }, args, async actor => {
    const pharmacyName = text(args.pharmacyName, 'pharmacyName', 100)
    const result = await command(context.prisma, { name: 'rx.external_request', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const rx = await uow.tx.prescription.findUnique({ where: { id: args.prescriptionId }, select: { id: true, status: true, patientId: true, lines: { select: { csSchedule: true } } } })
      if (!rx || rx.status === 'void') throw new DomainError(Codes.NOT_FOUND, 'Prescription not found.')
      if (rx.lines.some(l => l.csSchedule !== 'none')) throw new DomainError(Codes.GUARD_FAILED, 'A controlled prescription is not sent to an outside pharmacy from here.')
      const ref = await nextReference(uow.tx, 'EXT', uow.now)
      const row = await uow.tx.externalDispense.create({ data: { ref, prescriptionId: rx.id, patientId: rx.patientId, pharmacyName, orderReference: String(args.orderReference ?? '').slice(0, 60), status: 'requested' } })
      auditCreate(uow, actor, 'ExternalDispense', row.id, 'rx.external_requested', { ref, pharmacyName })
      return { id: row.id, ref, status: 'requested', version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function decideExternalFill(_root: unknown, args: { externalId: string; status: string; note?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageRefills', 'canFulfilRefill'], tool: 'rx.external_decide', humanOnly: true }, args, async actor => {
    if (!['approved', 'declined', 'filled'].includes(args.status)) throw new DomainError(Codes.INVALID_INPUT, 'Choose approved, declined or filled.', { field: 'status' })
    const result = await command(context.prisma, { name: 'rx.external_decide', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const from = args.status === 'filled' ? ['approved'] : ['requested']
      const row = await transition(uow, { model: 'ExternalDispense', id: args.externalId, from, to: args.status, expectedVersion: args.expectedVersion, actor, eventType: 'rx.external_decided', reason: String(args.note ?? '').slice(0, 200) || null, data: { decidedById: staff.id, decidedAt: uow.now, note: String(args.note ?? '').slice(0, 200) } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Export a written prescription for the client to take elsewhere. Each distinct content is kept once with its hash. */
export async function exportWrittenRx(_root: unknown, args: { prescriptionId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canPrescribe', 'canDispense'], tool: 'rx.export_written', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'rx.export_written', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const rx = await uow.tx.prescription.findUnique({ where: { id: args.prescriptionId }, select: { id: true, ref: true, status: true, issuedAt: true, patient: { select: { name: true } }, prescriber: { select: { displayName: true } }, lines: { select: { directions: true, quantity: true, refillsAuthorised: true, product: { select: { displayName: true, csSchedule: true } } } } } })
      if (!rx || rx.status === 'void') throw new DomainError(Codes.NOT_FOUND, 'Prescription not found.')
      if (rx.lines.some(l => l.product?.csSchedule && l.product.csSchedule !== 'none')) throw new DomainError(Codes.GUARD_FAILED, 'A controlled prescription cannot be handed over on paper from here.')
      const hash = sha256(canonicalJson({ ref: rx.ref, lines: rx.lines.map(l => [l.product?.displayName, l.directions, l.quantity.toString(), l.refillsAuthorised]) }))
      const existing = await uow.tx.writtenRxExport.findFirst({ where: { prescriptionId: rx.id, contentSha256: hash }, select: { id: true, ref: true } })
      if (existing) return { id: existing.id, ref: existing.ref, status: 'exported' }
      const ref = await nextReference(uow.tx, 'WRX', uow.now)
      const row = await uow.tx.writtenRxExport.create({ data: { ref, prescriptionId: rx.id, exportedById: staff.id, exportedAt: uow.now, contentSha256: hash } })
      auditCreate(uow, actor, 'WrittenRxExport', row.id, 'rx.written_exported', { ref, prescription: rx.ref })
      return { id: row.id, ref, status: 'exported' }
    })
    return { replay: result.replay, ...result.value }
  })
}
