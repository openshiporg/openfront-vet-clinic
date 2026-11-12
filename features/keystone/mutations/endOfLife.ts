import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { requireLicence } from '../domain/licensure'
import { serviceItemCharge } from './serviceCharge'
import { addDays } from '../domain/wellness'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { clientOfPatient } from './billing'
import { deceasePatient } from './clients'
import { cancelEnrollmentByDeath } from './wellnessDeath'
import { locationDay, staffOf, text, type Ctx } from './clinical'
import { pick } from './billingInput'

/*
 * End of life (BUILD-PLAN P5, SM§16-17). Nothing here is offered to agents: euthanasia, consent and aftercare are human acts and the
 * names say so (tests/mcp-registry.test.ts). A death is ONE transaction: if any part fails, the patient is not marked deceased.
 */

const AFTERCARE = ['private_cremation', 'communal_cremation', 'home_burial', 'rabies_testing'] as const

/** What a death sets in motion beyond the patient record: plans end, boardings and grooms stop, reminders go quiet, estimates close. */
export async function deathEffects(uow: UnitOfWork, actor: Actor, patientId: string) {
  const counts = { plansEnded: 0, boardingsCancelled: 0, groomsCancelled: 0, remindersSuppressed: 0, estimatesClosed: 0 }
  const enrolments = await uow.tx.enrollment.findMany({ where: { patientId, status: { in: ['pending_payment', 'active', 'cancelling', 'suspended'] } }, select: { id: true } })
  for (const e of enrolments) { await cancelEnrollmentByDeath(uow, actor, e.id); counts.plansEnded += 1 }
  const stays = await uow.tx.boardingStay.findMany({ where: { patientId, status: 'in_house' }, select: { id: true } })
  if (stays.length) throw new DomainError(Codes.GUARD_FAILED, 'This patient is boarding with us. Check them out before recording a death.', { reason: 'in_house' })
  const reservations = await uow.tx.boardingReservation.findMany({ where: { patientId, status: { in: ['requested', 'confirmed'] } }, select: { id: true, runTypeId: true, checkInOn: true, checkOutOn: true } })
  for (const r of reservations) {
    await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['requested', 'confirmed'], to: 'cancelled', actor, eventType: 'boarding.cancelled', reason: 'deceased', data: { cancelReason: 'The patient died' } })
    const nights: Date[] = []
    for (let d = r.checkInOn.toISOString().slice(0, 10); d < r.checkOutOn.toISOString().slice(0, 10); d = addDays(d, 1)) nights.push(new Date(`${d}T00:00:00Z`))
    await uow.tx.nightlyRunInventory.updateMany({ where: { runTypeId: r.runTypeId, night: { in: nights }, sold: { gt: 0 } }, data: { sold: { decrement: 1 } } })
    counts.boardingsCancelled += 1
  }
  const grooms = await uow.tx.groomAppointment.findMany({ where: { patientId, status: { in: ['booked', 'checked_in'] } }, select: { id: true } })
  for (const g of grooms) {
    await transition(uow, { model: 'GroomAppointment', id: g.id, from: ['booked', 'checked_in'], to: 'cancelled', actor, eventType: 'groom.cancelled', reason: 'deceased', data: { cancelReason: 'The patient died' } })
    counts.groomsCancelled += 1
  }
  counts.remindersSuppressed = (await uow.tx.patientReminder.updateMany({ where: { patientId, status: { in: ['scheduled', 'due', 'overdue'] } }, data: { status: 'suppressed' } })).count
  counts.estimatesClosed = (await uow.tx.estimate.updateMany({ where: { patientId, status: 'open' }, data: { status: 'closed' } })).count
  return counts
}

// ── Consent ─────────────────────────────────────────────────────────────────────────────────

/**
 * The euthanasia consent. Only a person the client has marked as allowed to authorise euthanasia can sign it (or a named legal authority,
 * written down). The bite history and the aftercare choice are required, and a bite in the last ten days sends the body to rabies testing.
 */
export async function signEuthanasiaConsent(_root: unknown, args: { patientId: string; signerId?: string | null; authority: string; authorityNote?: string | null; biteAttestation: string; aftercare: string; clientPresent: boolean; method: string; signatureText: string; witnessId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAuthoriseEuthanasia', 'canManagePatients'], tool: 'euthanasia.sign_consent', humanOnly: true }, args, async actor => {
    const authority = pick(args.authority, ['owner', 'animal_control', 'court_order', 'shelter_policy'] as const, 'who is authorising')
    const bite = pick(args.biteAttestation, ['no_bite', 'bite_in_last_10_days'] as const, 'bite history')
    const aftercare = pick(args.aftercare, AFTERCARE, 'aftercare')
    const method = pick(args.method, ['in_person', 'e_signature'] as const, 'how it was signed')
    if (bite === 'bite_in_last_10_days' && aftercare !== 'rabies_testing') throw new DomainError(Codes.GUARD_FAILED, 'A bite in the last 10 days means the animal goes to rabies testing. Choose rabies testing.', { reason: 'bite_testing' })
    const result = await command(context.prisma, { name: 'euthanasia.sign_consent', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const patient = await uow.tx.patient.findUnique({ where: { id: args.patientId }, select: { id: true, name: true, status: true } })
      if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
      if (patient.status !== 'active') throw new DomainError(Codes.PATIENT_DECEASED, `${patient.name} is ${patient.status}.`)
      const clientId = await clientOfPatient(uow, patient.id)
      const staff = await staffOf(uow, actor)
      let signer = null as null | { id: string }
      if (authority === 'owner') {
        if (!args.signerId) throw new DomainError(Codes.CONSENT_REQUIRED, 'Choose the owner who is signing.', { field: 'signerId' })
        const person = await uow.tx.clientPerson.findUnique({ where: { id: args.signerId }, select: { id: true, clientId: true, firstName: true, lastName: true, canAuthoriseEuthanasia: true } })
        if (!person || person.clientId !== clientId) throw new DomainError(Codes.NOT_FOUND, 'That person is not on this client.', { field: 'signerId' })
        if (!person.canAuthoriseEuthanasia) throw new DomainError(Codes.CONSENT_REQUIRED, `${person.firstName} ${person.lastName} is not marked as allowed to authorise euthanasia for this client.`, { field: 'signerId' })
        signer = person
      } else if (!(args.authorityNote ?? '').trim()) {
        throw new DomainError(Codes.INVALID_INPUT, 'Write down the case number or the name of the authority.', { field: 'authorityNote' })
      }
      const signature = text(args.signatureText, 'signature', 120)
      if (args.method === 'in_person' && !args.clientPresent) throw new DomainError(Codes.INVALID_INPUT, 'An in-person signature needs the person present.', { field: 'clientPresent' })
      const live = await uow.tx.euthanasiaConsent.findFirst({ where: { patientId: patient.id, status: { in: ['draft', 'signed'] } }, select: { id: true, ref: true } })
      if (live) throw new DomainError(Codes.GUARD_FAILED, `${live.ref} is already signed for ${patient.name}. Revoke it first to make a new one.`)
      const ref = await nextReference(uow.tx, 'EUC', uow.now)
      const row = await uow.tx.euthanasiaConsent.create({
        data: { ref, patientId: patient.id, clientId, signerId: signer?.id ?? null, authority, authorityNote: text(args.authorityNote ?? '', 'authority', 200, false), status: 'signed', biteAttestation: bite, aftercare, clientPresent: args.clientPresent === true, method, witnessId: args.witnessId || staff.id, signatureText: signature, signedAt: uow.now },
      })
      auditCreate(uow, actor, 'EuthanasiaConsent', row.id, 'euthanasia.consent_signed', { ref, authority, aftercare, bite })
      return { id: row.id, ref, status: 'signed' }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function revokeEuthanasiaConsent(_root: unknown, args: { consentId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAuthoriseEuthanasia', 'canManagePatients'], tool: 'euthanasia.revoke_consent', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 200)
    const result = await command(context.prisma, { name: 'euthanasia.revoke_consent', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'EuthanasiaConsent', id: args.consentId, from: ['signed', 'draft'], to: 'revoked', expectedVersion: args.expectedVersion, actor, eventType: 'euthanasia.consent_revoked', reason, data: { revokedReason: reason } })
      return { id: args.consentId, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── The death ───────────────────────────────────────────────────────────────────────────────

/**
 * Euthanasia and the death, in one transaction: a signed consent is required and is spent; the veterinarian must hold a licence that
 * allows it; the death record, the patient's status, plan enrolments, bookings, reminders and estimates all change together; the
 * euthanasia charge is added from the price list; and the aftercare order starts, naming the tag that follows the body.
 */
export async function recordEuthanasia(_root: unknown, args: { patientId: string; consentId: string; diedAt?: string | null; causeNote?: string | null; tagNumber: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAuthoriseEuthanasia'], tool: 'euthanasia.record', humanOnly: true }, args, async actor => {
    const tag = text(args.tagNumber, 'tag number', 40)
    const result = await command(context.prisma, { name: 'euthanasia.record', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (!staff.homeLocationId) throw new DomainError(Codes.GUARD_FAILED, 'Your staff record has no home location.')
      const locationId = staff.homeLocationId
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId, action: 'authorise_euthanasia', at: uow.now })
      const consent = await lockRow<any>(uow.tx, 'EuthanasiaConsent', args.consentId)
      if (consent.patientId !== args.patientId) throw new DomainError(Codes.GUARD_FAILED, 'That consent is for a different patient.')
      if (consent.status !== 'signed') throw new DomainError(Codes.CONSENT_REQUIRED, 'There is no signed consent for this patient.', { reason: consent.status })
      const at = args.diedAt ? new Date(args.diedAt) : uow.now
      if (Number.isNaN(at.getTime()) || at > uow.now) throw new DomainError(Codes.INVALID_INPUT, 'The time must be in the past.', { field: 'diedAt' })
      const clientId = await clientOfPatient(uow, args.patientId)
      const dead = await deceasePatient(uow, actor, args.patientId, at, args.expectedVersion)
      const record = await uow.tx.deathRecord.create({ data: { patientId: args.patientId, locationId, cause: 'euthanasia', causeNote: text(args.causeNote ?? '', 'cause', 300, false), diedAt: at, recordedById: staff.id, consentId: consent.id, effects: JSON.stringify(dead) } })
      await transition(uow, { model: 'EuthanasiaConsent', id: consent.id, from: ['signed'], to: 'used', actor, eventType: 'euthanasia.consent_used', data: { usedAt: uow.now } })
      const ref = await nextReference(uow.tx, 'AFT', uow.now)
      const order = await uow.tx.aftercareOrder.create({ data: { ref, patientId: args.patientId, clientId, locationId, deathRecordId: record.id, choice: consent.aftercare, status: 'body_tagged', tagNumber: tag, heldFrom: consent.aftercare === 'rabies_testing' ? 'testing' : '' } })
      await uow.tx.custodyEvent.create({ data: { orderId: order.id, kind: 'tagged', tagNumber: tag, place: 'Treatment room', byId: staff.id, at: uow.now } })
      const charge = await serviceItemCharge(uow, actor, 'EUTH-STANDARD', { patientId: args.patientId, clientId, locationId, sourceType: 'fee', sourceId: `euthanasia:${record.id}` })
      const aftercareCode = { private_cremation: 'AFTER-PRIVATE', communal_cremation: 'AFTER-COMMUNAL', home_burial: '', rabies_testing: '' }[consent.aftercare as string] ?? ''
      if (aftercareCode) await serviceItemCharge(uow, actor, aftercareCode, { patientId: args.patientId, clientId, locationId, sourceType: 'aftercare', sourceId: `aftercare:${order.id}` })
      auditCreate(uow, actor, 'DeathRecord', record.id, 'patient.death_recorded', { cause: 'euthanasia', ...dead, chargeId: charge.id, tag })
      return { ...dead, id: record.id, aftercareId: order.id, aftercareRef: order.ref }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Aftercare chain of custody ──────────────────────────────────────────────────────────────

const STEPS: Record<string, { from: string[]; to: string; kind: string }> = {
  store: { from: ['body_tagged'], to: 'stored', kind: 'stored' },
  pick_up: { from: ['stored'], to: 'picked_up', kind: 'picked_up' },
  return_ashes: { from: ['picked_up'], to: 'returned', kind: 'returned' },
  release_to_owner: { from: ['stored', 'body_tagged'], to: 'released_to_owner', kind: 'released' },
  hold_for_testing: { from: ['stored', 'body_tagged'], to: 'held_for_testing', kind: 'testing_hold' },
  close: { from: ['returned', 'released_to_owner', 'held_for_testing'], to: 'closed', kind: 'closed' },
}

/** Every step is a new line in the custody log and names the tag. Ashes cannot be handed back unless the crematory's number matches its manifest. */
export async function advanceAftercare(_root: unknown, args: { orderId: string; step: string; place?: string | null; crematory?: string | null; manifestRef?: string | null; crematoryRef?: string | null; receivedBy?: string | null; tagNumber: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAuthoriseEuthanasia', 'canManagePatients', 'canManageBoarding'], tool: 'aftercare.advance', humanOnly: true }, args, async actor => {
    const step = STEPS[pick(args.step, Object.keys(STEPS) as [string, ...string[]], 'step')]
    const result = await command(context.prisma, { name: 'aftercare.advance', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const o = await lockRow<any>(uow.tx, 'AftercareOrder', args.orderId)
      if (String(args.tagNumber).trim() !== o.tagNumber) throw new DomainError(Codes.GUARD_FAILED, 'The tag you entered does not match the tag on this animal. Check the tag before moving them.', { reason: 'tag_mismatch' })
      if (step.to === 'picked_up' && !(args.crematory ?? o.crematory)) throw new DomainError(Codes.INVALID_INPUT, 'Name the crematory collecting them.', { field: 'crematory' })
      if (step.to === 'picked_up' && !(args.manifestRef ?? o.manifestRef)) throw new DomainError(Codes.INVALID_INPUT, 'Write the manifest number.', { field: 'manifestRef' })
      if (step.to === 'returned') {
        const ref = (args.crematoryRef ?? '').trim()
        if (!ref) throw new DomainError(Codes.INVALID_INPUT, 'Write the number on the ashes container.', { field: 'crematoryRef' })
        if (ref !== o.manifestRef) throw new DomainError(Codes.GUARD_FAILED, 'The number on the ashes does not match the manifest. Do not hand them over until the crematory confirms.', { reason: 'manifest_mismatch' })
      }
      if (step.to === 'released_to_owner' && o.choice === 'rabies_testing') throw new DomainError(Codes.GUARD_FAILED, 'This animal is held for rabies testing and cannot be released.')
      if (step.to === 'released_to_owner' && !(args.receivedBy ?? '').trim()) throw new DomainError(Codes.INVALID_INPUT, 'Write who received the animal.', { field: 'receivedBy' })
      const staff = await staffOf(uow, actor)
      const data: Record<string, unknown> = {}
      if (args.crematory) data.crematory = text(args.crematory, 'crematory', 80)
      if (args.manifestRef) data.manifestRef = text(args.manifestRef, 'manifest', 60)
      if (step.to === 'returned') data.crematoryRef = args.crematoryRef!.trim()
      await uow.tx.custodyEvent.create({ data: { orderId: o.id, kind: step.kind, tagNumber: o.tagNumber, place: text(args.place ?? '', 'place', 80, false), crematoryRef: String(data.crematoryRef ?? ''), receivedBy: text(args.receivedBy ?? '', 'received by', 80, false), byId: staff.id, at: uow.now } })
      const row = await transition(uow, { model: 'AftercareOrder', id: o.id, from: step.from, to: step.to, expectedVersion: args.expectedVersion, actor, eventType: `aftercare.${step.kind}`, data })
      return { id: o.id, ref: o.ref, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** A keepsake (paw print, urn, fur clipping) added to an aftercare order: one charge from the price list. */
export async function addMemorialItem(_root: unknown, args: { orderId: string; kind: string; description?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAuthoriseEuthanasia', 'canManagePatients', 'canManageBoarding'], tool: 'aftercare.add_memorial', humanOnly: true }, args, async actor => {
    const kind = pick(args.kind, ['paw_print', 'clay_impression', 'fur_clipping', 'urn', 'keepsake'] as const, 'keepsake')
    const result = await command(context.prisma, { name: 'aftercare.add_memorial', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const o = await lockRow<any>(uow.tx, 'AftercareOrder', args.orderId)
      if (o.status === 'closed') throw new DomainError(Codes.GUARD_FAILED, 'This order is closed.')
      const item = await uow.tx.serviceItem.findFirst({ where: { code: `MEM-${kind.toUpperCase()}`, active: true } })
      if (!item) throw new DomainError(Codes.GUARD_FAILED, 'That keepsake has no price yet.')
      const memorial = await uow.tx.memorialItem.create({ data: { orderId: o.id, kind, description: text(args.description || item.name, 'description', 120), priceMinor: item.priceMinor } })
      const line = await serviceItemCharge(uow, actor, item.code, { patientId: o.patientId, clientId: o.clientId, locationId: o.locationId, sourceType: 'memorial', sourceId: memorial.id })
      await uow.tx.memorialItem.update({ where: { id: memorial.id }, data: { chargeLineId: line.id } })
      auditCreate(uow, actor, 'MemorialItem', memorial.id, 'aftercare.memorial_added', { kind, priceMinor: item.priceMinor.toString() })
      return { id: memorial.id, chargeId: line.id }
    })
    return { replay: result.replay, ...result.value }
  })
}
