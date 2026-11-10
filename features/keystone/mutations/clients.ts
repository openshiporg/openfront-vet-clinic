import { command } from '../lib/command'
import { auditCreate, transition } from '../lib/cas'
import { actorAgentId, actorUserId, type Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { dec, toKg, toScale } from '../lib/decimal'
import { nextSerial, publicCode } from '../lib/sequence'
import { contactHash, microchipStandard, normaliseContact, type ContactKind } from '../domain/contact'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'

/**
 * Clients and patients (SCHEMA §2, STATE-MACHINES §1-§2). Every write is one idempotent command:
 * the rows, and their audit events commit together. Duplicate detection runs on
 * contact hashes and microchip numbers before anything is created.
 */

type Ctx = { session: unknown; prisma: any }

const text = (value: unknown, field: string, max = 200, required = true) => {
  const out = String(value ?? '').trim()
  if (required && !out) throw new DomainError(Codes.INVALID_INPUT, `${field} is required.`, { field })
  if (out.length > max) throw new DomainError(Codes.INVALID_INPUT, `${field} is too long.`, { field })
  return out
}

export type ContactInput = { kind: ContactKind; value: string; canText?: boolean | null }
export type PersonInput = { firstName: string; lastName: string; relationship?: string | null; contacts: ContactInput[] }
export type PatientInput = { name: string; speciesCode: string; breedName?: string | null; sex?: string | null; reproductiveStatus?: string | null; dateOfBirth?: string | null; dobEstimated?: boolean | null; microchip?: string | null }

/** Contacts already on file, by hash: the duplicate check (I-C1). */
async function existingContacts(uow: UnitOfWork, contacts: ContactInput[]) {
  const hashes = contacts.map(c => contactHash(normaliseContact(c.kind, c.value)))
  if (!hashes.length) return []
  return uow.tx.contactPoint.findMany({ where: { valueHash: { in: hashes }, status: 'active' }, select: { id: true, person: { select: { clientId: true } } } })
}

async function createPerson(uow: UnitOfWork, actor: Actor, clientId: string, person: PersonInput, isPrimary: boolean, source: string) {
  const row = await uow.tx.clientPerson.create({
    data: {
      clientId, firstName: text(person.firstName, 'firstName', 80), lastName: text(person.lastName, 'lastName', 80), relationship: person.relationship ?? 'owner', isPrimary,
      canBook: true, canApproveTreatment: isPrimary, canReceiveRecords: isPrimary, canPay: true, canAuthoriseEuthanasia: isPrimary,
    },
  })
  auditCreate(uow, actor, 'ClientPerson', row.id, 'client_person.created', { clientId, isPrimary, relationship: row.relationship, source })
  const seenKinds = new Set<string>()
  for (const contact of person.contacts) {
    const value = normaliseContact(contact.kind, contact.value)
    const primary = !seenKinds.has(contact.kind)
    seenKinds.add(contact.kind)
    const cp = await uow.tx.contactPoint.create({ data: { personId: row.id, kind: contact.kind, value, valueHash: contactHash(value), isPrimary: primary, canText: contact.kind === 'mobile' && contact.canText !== false, status: 'active' } })
    auditCreate(uow, actor, 'ContactPoint', cp.id, 'contact_point.created', { personId: row.id, kind: contact.kind, isPrimary: primary })
    // Care and transactional messages are implied by giving a number (contact pack); recording the
    // basis keeps the consent history complete from the first contact.
    await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: 'transactional', action: 'grant', method: source === 'ai_voice' ? 'verbal_recorded' : 'staff_entry', capturedByUserId: actorUserId(actor), capturedByAgentId: actorAgentId(actor), at: uow.now } })
  }
  return row
}

async function createPatient(uow: UnitOfWork, actor: Actor, clientId: string, input: PatientInput, status: 'pending' | 'active') {
  const species = await uow.tx.species.findUnique({ where: { code: text(input.speciesCode, 'speciesCode', 40) } })
  if (!species || !species.active) throw new DomainError(Codes.INVALID_INPUT, `Unknown species ${input.speciesCode}.`, { field: 'speciesCode' })
  const breed = input.breedName ? await uow.tx.breed.findFirst({ where: { speciesId: species.id, name: { equals: input.breedName.trim(), mode: 'insensitive' } } }) : null
  if (input.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) throw new DomainError(Codes.INVALID_INPUT, 'dateOfBirth is YYYY-MM-DD.', { field: 'dateOfBirth' })
  if (input.dateOfBirth && input.dateOfBirth > uow.now.toISOString().slice(0, 10)) throw new DomainError(Codes.INVALID_INPUT, 'dateOfBirth is in the future.', { field: 'dateOfBirth' })
  let chip: { number: string; standard: string } | null = null
  if (input.microchip) {
    const number = input.microchip.replace(/[\s-]/g, '').toUpperCase()
    chip = { number, standard: microchipStandard(number) }
    const clash = await uow.tx.microchip.findFirst({ where: { number, active: true }, select: { patient: { select: { ref: true } } } })
    if (clash) throw new DomainError(Codes.DUPLICATE_SUSPECTED, `That microchip is already on file (${clash.patient?.ref ?? 'another patient'}).`, { field: 'microchip' })
  }
  const ref = await nextSerial(uow.tx, 'P')
  const patient = await uow.tx.patient.create({
    data: {
      ref, name: text(input.name, 'name', 80), kind: 'individual', speciesId: species.id, breedId: breed?.id ?? null, sex: input.sex ?? 'unknown',
      reproductiveStatus: input.reproductiveStatus ?? 'unknown', dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null, dobEstimated: input.dobEstimated === true,
      status, codeStatus: 'unspecified',
    },
  })
  await uow.tx.patientOwnership.create({ data: { patientId: patient.id, clientId, role: 'primary', effectiveFrom: uow.now, basis: 'registration', recordedById: actorUserId(actor) } })
  if (chip) await uow.tx.microchip.create({ data: { patientId: patient.id, number: chip.number, standard: chip.standard, active: true } })
  auditCreate(uow, actor, 'Patient', patient.id, 'patient.registered', { ref, clientId, species: species.code, status, microchip: chip?.number ?? null })
  return patient
}

/** Staff registration: an active household with its people, contacts and pets. */
export async function registerClient(_root: unknown, args: { input: { displayName?: string | null; kind?: string | null; locationId: string; people: PersonInput[]; patients?: PatientInput[]; addressLine1?: string | null; city?: string | null; postalCode?: string | null; allowDuplicate?: boolean | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageClients'], tool: 'client.register', humanOnly: true }, args, async actor => {
    const input = args.input
    if (!input.people?.length) throw new DomainError(Codes.INVALID_INPUT, 'Add at least one person.', { field: 'people' })
    const result = await command(context.prisma, { name: 'client.register', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, stateCode: true } })
      if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
      const contacts = input.people.flatMap(p => p.contacts ?? [])
      const dupes = await existingContacts(uow, contacts)
      if (dupes.length && !input.allowDuplicate) {
        throw new DomainError(Codes.DUPLICATE_SUSPECTED, 'A household with this phone or email is already on file. Open it, or confirm this is a different household.', { reason: 'contact_match' })
      }
      const primary = input.people[0]
      const ref = await nextSerial(uow.tx, 'C')
      const client = await uow.tx.client.create({
        data: {
          ref, publicCode: publicCode('CL'), displayName: text(input.displayName || `${primary.lastName} household`, 'displayName', 120), kind: input.kind ?? 'household', status: 'active',
          primaryLocationId: location.id, addressLine1: input.addressLine1 ?? '', city: input.city ?? '', stateCode: location.stateCode, postalCode: input.postalCode ?? '', source: 'csr', accountFlags: {},
        },
      })
      auditCreate(uow, actor, 'Client', client.id, 'client.registered', { ref, kind: client.kind, source: 'csr', duplicateOverride: dupes.length > 0 })
      for (const [i, person] of input.people.entries()) await createPerson(uow, actor, client.id, person, i === 0, 'csr')
      const patients = []
      for (const p of input.patients ?? []) patients.push(await createPatient(uow, actor, client.id, p, 'active'))
      return { id: client.id, ref, patients: patients.map(p => ({ id: p.id, ref: p.ref, name: p.name })) }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * New caller (AI receptionist or portal): a pending household and pending pets. Staff confirm it
 * (confirmRegistration); until then nothing clinical is attached and duplicates are flagged.
 */
export async function registerPendingClient(_root: unknown, args: { input: { firstName: string; lastName: string; phone: string; email?: string | null; locationId: string; pet: PatientInput; callRecordId?: string | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageClients', 'canBook'], scope: 'reception.register', tool: 'client.register_pending' }, args, async actor => {
    const input = args.input
    const result = await command(context.prisma, { name: 'client.register_pending', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, stateCode: true } })
      if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
      const contacts: ContactInput[] = [{ kind: 'mobile', value: input.phone }, ...(input.email ? [{ kind: 'email' as const, value: input.email }] : [])]
      const dupes = await existingContacts(uow, contacts)
      const ref = await nextSerial(uow.tx, 'C')
      const source = actor.kind === 'agent' ? 'ai_voice' : 'csr'
      const client = await uow.tx.client.create({
        data: { ref, publicCode: publicCode('CL'), displayName: `${text(input.lastName, 'lastName', 80)} household`, kind: 'household', status: 'prospect', primaryLocationId: location.id, stateCode: location.stateCode, source, accountFlags: dupes.length ? { possibleDuplicate: true } : {} },
      })
      auditCreate(uow, actor, 'Client', client.id, 'client.registered_pending', { ref, source, possibleDuplicate: dupes.length > 0 })
      await createPerson(uow, actor, client.id, { firstName: input.firstName, lastName: input.lastName, relationship: 'owner', contacts }, true, source)
      const patient = await createPatient(uow, actor, client.id, input.pet, 'pending')
      const task = await uow.tx.task.create({
        data: { kind: 'registration_review', title: `Confirm new client ${ref}${dupes.length ? ' (possible duplicate)' : ''}`, subjectType: 'Client', subjectId: client.id, locationId: location.id, priority: dupes.length ? 'high' : 'normal', status: 'open', dueAt: new Date(uow.now.getTime() + 24 * 3_600_000), createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) },
      })
      auditCreate(uow, actor, 'Task', task.id, 'task.created', { kind: 'registration_review', clientId: client.id })
      return { clientId: client.id, clientRef: ref, patientId: patient.id, patientRef: patient.ref, possibleDuplicate: dupes.length > 0 }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Staff confirm a pending registration (SM§1: prospect → active; pending pets → active). */
export async function confirmRegistration(_root: unknown, args: { clientId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageClients'], tool: 'client.confirm', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'client.confirm', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'Client', id: args.clientId, from: ['prospect'], to: 'active', expectedVersion: args.expectedVersion, actor, eventType: 'client.confirmed' })
      const pets = await uow.tx.patient.findMany({ where: { status: 'pending', ownerships: { some: { clientId: args.clientId, effectiveTo: null } } }, select: { id: true, version: true } })
      for (const p of pets) await transition(uow, { model: 'Patient', id: p.id, from: ['pending'], to: 'active', actor, eventType: 'patient.confirmed' })
      await uow.tx.task.updateMany({ where: { subjectType: 'Client', subjectId: args.clientId, kind: 'registration_review', status: { in: ['open', 'in_progress'] } }, data: { status: 'done', completedAt: uow.now, version: { increment: 1 } } })
      return { id: row.id, status: row.status, patientsConfirmed: pets.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addPatient(_root: unknown, args: { clientId: string; input: PatientInput; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePatients', 'canManageClients'], scope: 'reception.register', tool: 'patient.register_pending' }, args, async actor => {
    const result = await command(context.prisma, { name: 'patient.add', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const client = await uow.tx.client.findUnique({ where: { id: args.clientId }, select: { status: true } })
      if (!client) throw new DomainError(Codes.NOT_FOUND, 'Client not found.')
      if (['merged', 'closed'].includes(client.status)) throw new DomainError(Codes.GUARD_FAILED, `The client is ${client.status}.`)
      const patient = await createPatient(uow, actor, args.clientId, args.input, actor.kind === 'agent' ? 'pending' : 'active')
      return { id: patient.id, ref: patient.ref, status: patient.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Weight entry (I-C4): stored as entered plus the exact kilogram value; never edited. */
/** A matching reading inside this window is treated as the same weighing. */
export const DUPLICATE_WEIGHT_WINDOW_MS = 10 * 60 * 1000

export async function recordWeight(_root: unknown, args: { patientId: string; value: string; unit: 'kg' | 'lb' | 'g'; method?: string | null; bodyConditionScore?: number | null; appointmentId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCheckIn', 'canWriteRecord'], tool: 'patient.weight', humanOnly: true }, args, async actor => {
    if (!['kg', 'lb', 'g'].includes(args.unit)) throw new DomainError(Codes.INVALID_INPUT, 'Unit is kg, lb or g.', { field: 'unit' })
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(String(args.value))) throw new DomainError(Codes.INVALID_INPUT, 'Weight is a positive number with up to 4 decimals.', { field: 'value' })
    const value = dec(args.value)
    if (value.lte(0)) throw new DomainError(Codes.INVALID_INPUT, 'Weight must be above zero.', { field: 'value' })
    const result = await command(context.prisma, { name: 'patient.weight', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const patient = await uow.tx.patient.findUnique({ where: { id: args.patientId }, select: { status: true } })
      if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
      if (patient.status === 'deceased' || patient.status === 'merged') throw new DomainError(Codes.PATIENT_DECEASED, `The patient is ${patient.status}.`)
      const staff = actor.kind === 'user' ? await uow.tx.staffMember.findFirst({ where: { userId: actor.userId }, select: { id: true } }) : null
      // The same reading entered twice within a few minutes is a double submit, not a second weighing:
      // return the reading already on file so the chart and the trend are not distorted.
      const recent = await uow.tx.weightMeasurement.findFirst({
        where: { patientId: args.patientId, unit: args.unit, value: toScale(value, 'wt'), measuredAt: { gte: new Date(uow.now.getTime() - DUPLICATE_WEIGHT_WINDOW_MS) } },
        orderBy: { measuredAt: 'desc' }, select: { id: true, valueKg: true },
      })
      if (recent) return { id: recent.id, valueKg: recent.valueKg.toString(), duplicate: true }
      const row = await uow.tx.weightMeasurement.create({
        data: {
          patientId: args.patientId, value: toScale(value, 'wt'), unit: args.unit, valueKg: toScale(toKg(value, args.unit), 'wt'), method: args.method ?? 'scale',
          bodyConditionScore: args.bodyConditionScore ?? null, measuredAt: uow.now, measuredById: staff?.id ?? null, appointmentId: args.appointmentId ?? null,
        },
      })
      auditCreate(uow, actor, 'WeightMeasurement', row.id, 'patient.weight_recorded', { patientId: args.patientId, value: row.value.toString(), unit: row.unit, valueKg: row.valueKg.toString() })
      return { id: row.id, valueKg: row.valueKg.toString(), duplicate: false }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addPatientAlert(_root: unknown, args: { patientId: string; kind: string; severity: 'info' | 'warn' | 'block'; text: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePatients', 'canWriteRecord'], tool: 'patient.alert', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'patient.alert.add', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await uow.tx.patientAlert.create({ data: { patientId: args.patientId, kind: args.kind, severity: args.severity, text: text(args.text, 'text', 500), active: true, createdById: actorUserId(actor) } })
      auditCreate(uow, actor, 'PatientAlert', row.id, 'patient.alert_added', { patientId: args.patientId, kind: args.kind, severity: args.severity })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Consent grant or revoke on a contact point (I-G2). A revoke always wins and is written first; a
 * grant for marketing or ai_voice needs evidence (document, call, keyword or portal).
 */
export async function recordConsent(_root: unknown, args: { contactPointId: string; purpose: string; action: 'grant' | 'revoke'; method: string; callRecordId?: string | null; keyword?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageClients', 'canMessageClients'], tool: 'consent.record', humanOnly: true }, args, async actor => {
    if (!['care', 'transactional', 'marketing', 'ai_voice', 'recording'].includes(args.purpose)) throw new DomainError(Codes.INVALID_INPUT, 'Unknown consent purpose.', { field: 'purpose' })
    if (!['grant', 'revoke'].includes(args.action)) throw new DomainError(Codes.INVALID_INPUT, 'Action is grant or revoke.', { field: 'action' })
    if (args.action === 'grant' && ['marketing', 'ai_voice'].includes(args.purpose) && !['web_form', 'sms_keyword', 'verbal_recorded', 'paper', 'portal'].includes(args.method)) {
      throw new DomainError(Codes.CONSENT_REQUIRED, `${args.purpose} consent needs written or recorded evidence.`, { field: 'method' })
    }
    const result = await command(context.prisma, { name: 'consent.record', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await uow.tx.consentRecord.create({ data: { contactPointId: args.contactPointId, purpose: args.purpose, action: args.action, method: args.method, callRecordId: args.callRecordId ?? null, keyword: args.keyword ?? '', capturedByUserId: actorUserId(actor), at: uow.now } })
      auditCreate(uow, actor, 'ConsentRecord', row.id, `consent.${args.action}`, { contactPointId: args.contactPointId, purpose: args.purpose, method: args.method })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Record a death (the communications part of SM§2.2; the clinical and billing effects arrive with
 * the end-of-life module): status deceased, a patient suppression so no reminder or marketing message
 * reaches the family, future appointments cancelled with reason "deceased".
 */
export async function recordPatientDeath(_root: unknown, args: { patientId: string; diedAt?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePatients'], tool: 'patient.record_death', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'patient.record_death', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const at = args.diedAt ? new Date(args.diedAt) : uow.now
      if (Number.isNaN(at.getTime()) || at > uow.now) throw new DomainError(Codes.INVALID_INPUT, 'diedAt must be a past time.', { field: 'diedAt' })
      await transition(uow, { model: 'Patient', id: args.patientId, from: ['active', 'pending', 'inactive'], to: 'deceased', expectedVersion: args.expectedVersion, actor, eventType: 'patient.deceased', data: { deceasedAt: at } })
      await uow.tx.suppression.create({ data: { patientId: args.patientId, reason: 'deceased', active: true } })
      const future = await uow.tx.appointmentPatient.findMany({ where: { patientId: args.patientId, appointment: { startsAt: { gt: uow.now }, status: { in: ['requested', 'booked', 'confirmed'] } } }, select: { appointmentId: true } })
      let cancelled = 0
      for (const { appointmentId } of future) {
        const others = await uow.tx.appointmentPatient.count({ where: { appointmentId, patientId: { not: args.patientId }, status: { notIn: ['cancelled'] } } })
        if (others === 0 && appointmentId) {
          await transition(uow, { model: 'Appointment', id: appointmentId, from: ['requested', 'booked', 'confirmed'], to: 'cancelled', actor, eventType: 'appointment.cancelled', reason: 'deceased', data: { cancelReason: 'deceased', cancelledAt: uow.now } })
          await uow.tx.resourceReservation.updateMany({ where: { appointmentId, status: { not: 'released' } }, data: { status: 'released' } })
          await uow.tx.providerReservation.updateMany({ where: { appointmentId, status: { not: 'released' } }, data: { status: 'released' } })
          cancelled += 1
        }
      }
      return { id: args.patientId, status: 'deceased', appointmentsCancelled: cancelled }
    })
    return { replay: result.replay, ...result.value }
  })
}
