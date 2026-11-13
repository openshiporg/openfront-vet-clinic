import { command } from '@/features/keystone/lib/command'
import { advisoryLock } from '@/features/keystone/lib/db'
import { auditCreate, transition } from '@/features/keystone/lib/cas'
import { addDays, localDate } from '@/features/keystone/lib/calendar'
import { Codes, DomainError } from '@/features/keystone/lib/errors'
import { balanceOfInvoice } from '@/features/keystone/lib/ledger'
import { signPayLink } from '@/features/keystone/lib/payLink'
import { nextReference, nextSerial, publicCode } from '@/features/keystone/lib/sequence'
import { buildSegments, verifySlot, type SegmentTemplate } from '@/features/keystone/domain/scheduling'
import { contactHash, normaliseContact, type ContactKind } from '@/features/keystone/domain/contact'
import type { UnitOfWork } from '@/features/keystone/lib/unitOfWork'
import { clientActor, db } from './db'
import { openTimes } from './availability'
import { getSite, getVisitTypes } from './site'
import type { SignedInClient } from './session'

/*
 * What a signed-in client sees and does. Every read is filtered to the client's own household, and every write is one
 * idempotent command (rows, receipt and audit events commit together), following the staff commands step for step:
 * booking mirrors `appointment.book`, cancelling mirrors `appointment.cancel`, a refill request mirrors `refill.request`,
 * and a new household mirrors `client.register_pending`. The channel recorded is `portal`.
 */

const KEY = /^[A-Za-z0-9-]{16,64}$/
const commandKey = (personId: string, key: string) => {
  if (!KEY.test(String(key ?? ''))) throw new DomainError(Codes.INVALID_INPUT, 'Reload the page and try again.')
  return `cs:${personId}:${key}`
}

const LIVE = ['requested', 'booked', 'confirmed', 'checked_in', 'in_progress', 'ready_for_checkout']
const MAX_UPCOMING_VISITS = 10
const MAX_OPEN_REFILLS = 10

// ── Reads ────────────────────────────────────────────────────────────────────────────────

export type Pet = {
  id: string; name: string; status: string; speciesCode: string; speciesName: string; breedName: string; dateOfBirth: string | null
  /** The most pressing reminder: overdue or due now, or coming up within 30 days. */
  due: { name: string; dueOn: string; status: string } | null
}

export async function myPets(client: SignedInClient): Promise<Pet[]> {
  const p = db()
  const rows = await p.patient.findMany({
    where: { status: { in: ['active', 'pending'] }, ownerships: { some: { clientId: client.clientId, effectiveTo: null } } },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, status: true, dateOfBirth: true, species: { select: { code: true, name: true } }, breed: { select: { name: true } } },
    take: 60,
  })
  if (!rows.length) return []
  const soon = addDays(new Date().toISOString().slice(0, 10), 30)
  const reminders = await p.patientReminder.findMany({
    where: { patientId: { in: rows.map((r: { id: string }) => r.id) }, OR: [{ status: { in: ['due', 'overdue'] } }, { status: 'scheduled', dueOn: { lte: new Date(`${soon}T00:00:00Z`) } }] },
    orderBy: [{ dueOn: 'asc' }],
    select: { patientId: true, dueOn: true, status: true, type: { select: { name: true } } },
  })
  return rows.map((r: any) => {
    const first = reminders.find((x: any) => x.patientId === r.id)
    return {
      id: r.id, name: r.name, status: r.status, speciesCode: r.species?.code ?? '', speciesName: r.species?.name ?? '', breedName: r.breed?.name ?? '',
      dateOfBirth: r.dateOfBirth ? r.dateOfBirth.toISOString().slice(0, 10) : null,
      due: first ? { name: first.type?.name ?? 'Visit', dueOn: first.dueOn.toISOString().slice(0, 10), status: first.status } : null,
    }
  })
}

export type Medication = { id: string; patientId: string; name: string; directions: string; refillsAuthorised: number }

/** Medications on the pets' active prescriptions (what a refill request can name with one tap). */
export async function myMedications(client: SignedInClient, petIds: string[]): Promise<Medication[]> {
  if (!petIds.length) return []
  const rows = await db().prescriptionLine.findMany({
    where: { expiresAt: { gt: new Date() }, prescription: { status: 'active', clientId: client.clientId, patientId: { in: petIds } } },
    orderBy: [{ expiresAt: 'desc' }],
    select: { id: true, directions: true, refillsAuthorised: true, product: { select: { displayName: true } }, prescription: { select: { patientId: true } } },
    take: 100,
  })
  const seen = new Set<string>()
  const out: Medication[] = []
  for (const r of rows) {
    const name = r.product?.displayName
    const patientId = r.prescription?.patientId
    if (!name || !patientId || seen.has(`${patientId}:${name}`)) continue
    seen.add(`${patientId}:${name}`)
    out.push({ id: r.id, patientId, name, directions: r.directions || '', refillsAuthorised: r.refillsAuthorised ?? 0 })
  }
  return out
}

export type Visit = { id: string; ref: string; startsAt: string; status: string; version: number; typeName: string; providerName: string; locationName: string; timeZone: string; petNames: string[]; canCancel: boolean }

export async function myVisits(client: SignedInClient): Promise<Visit[]> {
  const rows = await db().appointment.findMany({
    where: { clientId: client.clientId, status: { in: LIVE }, endsAt: { gte: new Date() } },
    orderBy: [{ startsAt: 'asc' }],
    select: { id: true, ref: true, startsAt: true, status: true, version: true, appointmentType: { select: { name: true } }, provider: { select: { displayName: true } }, location: { select: { name: true, timeZone: true } }, patients: { select: { patient: { select: { name: true } } } } },
    take: 30,
  })
  return rows.map((r: any) => ({
    id: r.id, ref: r.ref, startsAt: r.startsAt.toISOString(), status: r.status, version: r.version, typeName: r.appointmentType?.name ?? 'Visit', providerName: r.provider?.displayName ?? '',
    locationName: r.location?.name ?? '', timeZone: r.location?.timeZone ?? 'America/Los_Angeles', petNames: r.patients.map((x: any) => x.patient?.name).filter(Boolean),
    canCancel: ['requested', 'booked', 'confirmed'].includes(r.status),
  }))
}

export type Refill = { id: string; ref: string; petName: string; productText: string; status: string; createdAt: string }

export async function myRefills(client: SignedInClient): Promise<Refill[]> {
  const rows = await db().refillRequest.findMany({ where: { clientId: client.clientId }, orderBy: [{ createdAt: 'desc' }], select: { id: true, ref: true, productText: true, status: true, createdAt: true, patient: { select: { name: true } } }, take: 10 })
  return rows.map((r: any) => ({ id: r.id, ref: r.ref, petName: r.patient?.name ?? '', productText: r.productText, status: r.status, createdAt: r.createdAt.toISOString() }))
}

export type Bill = { id: string; ref: string; postedOn: string | null; totalMinor: string; balanceMinor: string; currencyCode: string }

/** Posted invoices with something still to pay. */
export async function myBills(client: SignedInClient): Promise<Bill[]> {
  const p = db()
  const rows = await p.invoice.findMany({ where: { clientId: client.clientId, status: { in: ['posted', 'partially_paid'] } }, orderBy: [{ postedOn: 'desc' }], select: { id: true, ref: true, postedOn: true, totalMinor: true, currencyCode: true }, take: 30 })
  const out: Bill[] = []
  for (const r of rows) {
    const balance = await balanceOfInvoice(p, r.id)
    if (balance > 0n) out.push({ id: r.id, ref: r.ref, postedOn: r.postedOn ? r.postedOn.toISOString().slice(0, 10) : null, totalMinor: String(r.totalMinor), balanceMinor: String(balance), currencyCode: r.currencyCode })
  }
  return out
}

/** One of the client's own invoices with its balance and a signed payment link (the same link staff hand out), or null. */
export async function myBill(client: SignedInClient, invoiceId: string): Promise<(Bill & { status: string; payToken: string | null }) | null> {
  if (!/^[a-z0-9]{10,40}$/.test(String(invoiceId ?? ''))) return null
  const p = db()
  const r = await p.invoice.findFirst({ where: { id: invoiceId, clientId: client.clientId, status: { in: ['posted', 'partially_paid', 'paid'] } }, select: { id: true, ref: true, status: true, postedOn: true, totalMinor: true, currencyCode: true } })
  if (!r) return null
  const balance = r.status === 'paid' ? 0n : await balanceOfInvoice(p, r.id)
  return { id: r.id, ref: r.ref, status: r.status, postedOn: r.postedOn ? r.postedOn.toISOString().slice(0, 10) : null, totalMinor: String(r.totalMinor), balanceMinor: String(balance), currencyCode: r.currencyCode, payToken: balance > 0n && client.canPay ? signPayLink(r.id) : null }
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────

export type BookedVisit = { id: string; ref: string; status: string; startsAt: string; endsAt: string }

/** Book (or, for a request-only visit or an unconfirmed new household, request) a visit at an open time. */
export async function bookVisit(client: SignedInClient, input: { locationId: string; appointmentTypeId: string; startsAt: string; patientIds: string[]; reason?: string | null; idempotencyKey: string }): Promise<BookedVisit> {
  const site = await getSite()
  if (!site.onlineBooking) throw new DomainError(Codes.FEATURE_DISABLED, 'Online booking is turned off right now. Please call us to book.')
  if (!client.canBook) throw new DomainError(Codes.NOT_AUTHORIZED, 'Your sign-in cannot book visits for this household. Please call us.')
  const visit = (await getVisitTypes()).find(t => t.id === input.appointmentTypeId)
  if (!visit) throw new DomainError(Codes.NOT_FOUND, 'That visit is not offered online. Please call us to book it.')
  const prospect = client.clientStatus === 'prospect'
  if (prospect && (site.newClientMode === 'off' || !visit.newClients)) throw new DomainError(Codes.GUARD_FAILED, 'New clients start with a new client visit. Pick that visit, or call us.')
  const start = Date.parse(String(input.startsAt ?? ''))
  if (Number.isNaN(start)) throw new DomainError(Codes.INVALID_INPUT, 'Pick a time.', { field: 'startsAt' })
  const patientIds = [...new Set((input.patientIds ?? []).map(String))].slice(0, 6)
  if (!patientIds.length) throw new DomainError(Codes.INVALID_INPUT, 'Pick at least one pet.', { field: 'patientIds' })
  const reason = String(input.reason ?? '').trim().slice(0, 500)
  const asRequest = visit.mode === 'request' || (prospect && site.newClientMode === 'request')
  const params = { locationId: String(input.locationId), appointmentTypeId: visit.id, startsAt: new Date(start).toISOString(), patientIds: [...patientIds].sort(), reason }

  const actor = clientActor(client.personId)
  const result = await command(db(), { name: 'client_site.book', actor, idempotencyKey: commandKey(client.personId, input.idempotencyKey), params }, async uow => {
    const [type, location] = await Promise.all([
      uow.tx.appointmentType.findUnique({ where: { id: visit.id } }),
      uow.tx.location.findUnique({ where: { id: params.locationId }, select: { id: true, timeZone: true, active: true } }),
    ])
    if (!type?.active || !location?.active) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That time is no longer offered. Pick another time.')
    // The time must be one this site offers right now (schedule, notice and booking window); its signed slot names the doctor and room.
    const offered = await openTimes({ locationId: location.id, appointmentTypeId: type.id, from: localDate({ timeZone: location.timeZone }, start), days: 1, perDay: 60 })
    const time = offered.days[0]?.times.find(t => t.startsAt === params.startsAt)
    if (!time) throw new DomainError(Codes.SLOT_TAKEN, 'That time was just taken. Pick another time.')
    const claims = verifySlot(time.slotToken)

    const patients = await uow.tx.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, status: true, name: true, ownerships: { where: { effectiveTo: null }, select: { clientId: true } } } })
    if (patients.length !== patientIds.length) throw new DomainError(Codes.NOT_FOUND, 'A pet was not found on your account.')
    for (const pet of patients) {
      if (!pet.ownerships.some((o: { clientId: string | null }) => o.clientId === client.clientId)) throw new DomainError(Codes.NOT_FOUND, 'A pet was not found on your account.')
      if (pet.status === 'deceased') throw new DomainError(Codes.PATIENT_DECEASED, `We have ${pet.name} recorded as having passed away. Please call us.`)
      if (pet.status === 'merged' || pet.status === 'inactive') throw new DomainError(Codes.GUARD_FAILED, `${pet.name}'s record needs a look from our team. Please call us.`)
    }

    // One household cannot fill the day sheet: a new household holds one first visit, a client of record up to ten upcoming visits.
    const upcoming = await uow.tx.appointment.count({ where: { clientId: client.clientId, status: { in: LIVE }, endsAt: { gte: uow.now } } })
    if (prospect && upcoming >= 1) throw new DomainError(Codes.GUARD_FAILED, 'You already have a first visit with us. Cancel it under My account to pick another time, or call us.')
    if (upcoming >= MAX_UPCOMING_VISITS) throw new DomainError(Codes.GUARD_FAILED, 'You have several visits coming up already. Please call us to book another.')

    const startsAt = new Date(claims.start)
    const endsAt = new Date(claims.end)
    const clash = async () => {
      const [providerClash, resourceClash] = await Promise.all([
        uow.tx.providerReservation.count({ where: { staffMemberId: claims.providerId, status: { not: 'released' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
        uow.tx.resourceReservation.count({ where: { resourceId: claims.resourceId, status: { not: 'released' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
      ])
      if (providerClash || resourceClash) throw new DomainError(Codes.SLOT_TAKEN, 'That time was just taken. Pick another time.')
    }
    await clash()
    // The same lock keys, in the same order, as the front desk's booking, so the two can never double-book or deadlock.
    const keys = [`resource:${claims.resourceId}`, `provider-day:${claims.providerId}:${localDate({ timeZone: location.timeZone }, claims.start)}`].sort()
    for (const key of keys) await advisoryLock(uow.tx, key)
    await clash()

    const status = asRequest ? 'requested' : 'booked'
    const holdStatus = asRequest ? 'held' : 'confirmed'
    const ref = await nextReference(uow.tx, 'APT', uow.now)
    const appointment = await uow.tx.appointment.create({
      data: { ref, locationId: location.id, clientId: client.clientId, appointmentTypeId: type.id, providerId: claims.providerId, startsAt, endsAt, status, channel: 'portal', slotToken: time.slotToken.slice(-43), reason },
    })
    await uow.tx.appointmentPatient.createMany({ data: patientIds.map(patientId => ({ appointmentId: appointment.id, patientId, reason })) })
    const segments = buildSegments(type.segments as SegmentTemplate[] | null, claims.start, type.durationMinutes)
    await uow.tx.appointmentSegment.createMany({ data: segments.map(s => ({ appointmentId: appointment.id, kind: s.kind, startsAt: s.startsAt, endsAt: s.endsAt, resourceId: claims.resourceId, staffId: claims.providerId })) })
    await uow.tx.resourceReservation.create({ data: { resourceId: claims.resourceId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } })
    await uow.tx.providerReservation.create({ data: { staffMemberId: claims.providerId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } })
    auditCreate(uow, actor, 'Appointment', appointment.id, 'appointment.booked', { ref, status, startsAt, endsAt, typeCode: type.code, channel: 'portal', patients: patientIds.length, personId: client.personId })
    if (asRequest) {
      await uow.tx.task.create({ data: { kind: 'follow_up', priority: 'normal', status: 'open', dueAt: uow.now, subjectType: 'Appointment', subjectId: appointment.id, locationId: location.id, roleName: 'csr', title: `Online visit request ${ref}: accept or decline`.slice(0, 200), detail: `${type.name} at ${startsAt.toISOString()} asked for on the client site. The time is held until you decide.` } })
    }
    return { id: appointment.id, ref, status, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
  })
  return result.value
}

/** Cancel one of the client's own upcoming visits; the room and doctor are freed and the waitlist is flagged for staff. */
export async function cancelVisit(client: SignedInClient, input: { appointmentId: string; expectedVersion: number; idempotencyKey: string }) {
  if (!client.canBook) throw new DomainError(Codes.NOT_AUTHORIZED, 'Your sign-in cannot change visits for this household. Please call us.')
  const actor = clientActor(client.personId)
  const reason = 'Cancelled by the client online'
  const params = { appointmentId: String(input.appointmentId), expectedVersion: Number(input.expectedVersion) }
  const result = await command(db(), { name: 'client_site.cancel', actor, idempotencyKey: commandKey(client.personId, input.idempotencyKey), params }, async uow => {
    const row = await transition<{ id: string; status: string; clientId: string }>(uow, {
      model: 'Appointment', id: params.appointmentId, from: ['requested', 'booked', 'confirmed'], to: 'cancelled', expectedVersion: params.expectedVersion, actor, eventType: 'appointment.cancelled', reason,
      data: { cancelReason: reason, cancelledAt: uow.now }, metadata: { personId: client.personId, channel: 'portal' },
      guard: appt => { if (appt.clientId !== client.clientId) throw new DomainError(Codes.NOT_FOUND, 'Appointment not found.') },
    })
    await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id }, data: { status: 'cancelled' } })
    await uow.tx.resourceReservation.updateMany({ where: { appointmentId: row.id, status: { not: 'released' } }, data: { status: 'released' } })
    await uow.tx.providerReservation.updateMany({ where: { appointmentId: row.id, status: { not: 'released' } }, data: { status: 'released' } })
    await noteFreedSlot(uow, row.id)
    return { id: row.id, status: row.status }
  })
  return result.value
}

async function noteFreedSlot(uow: UnitOfWork, appointmentId: string) {
  const appt = await uow.tx.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, ref: true, startsAt: true, locationId: true, appointmentTypeId: true } })
  if (!appt) return
  const waiting = await uow.tx.waitlistEntry.count({ where: { status: 'waiting', locationId: appt.locationId, OR: [{ appointmentTypeId: appt.appointmentTypeId }, { appointmentTypeId: null }] } })
  if (!waiting) return
  const open = await uow.tx.task.findFirst({ where: { subjectType: 'Appointment', subjectId: appt.id, kind: 'follow_up', status: 'open' }, select: { id: true } })
  if (!open) await uow.tx.task.create({ data: { kind: 'follow_up', priority: 'normal', status: 'open', dueAt: uow.now, subjectType: 'Appointment', subjectId: appt.id, locationId: appt.locationId, roleName: 'csr', title: `Slot freed (${appt.ref}): ${waiting} waiting`, detail: `Offer ${appt.startsAt.toISOString()} to the waitlist.` } })
}

export type RefillReceipt = { id: string; ref: string; status: string; dueAt: string | null; existing: boolean }

/** Ask for a refill. Intake only: a veterinarian decides, and the request lands in the same refill queue as a phone call. */
export async function requestRefill(client: SignedInClient, input: { patientId: string; productText: string; pharmacyNote?: string | null; idempotencyKey: string }): Promise<RefillReceipt> {
  const productText = String(input.productText ?? '').trim().slice(0, 300)
  if (!productText) throw new DomainError(Codes.INVALID_INPUT, 'Tell us which medication to refill.', { field: 'productText' })
  const pharmacyNote = String(input.pharmacyNote ?? '').trim().slice(0, 500)
  const params = { patientId: String(input.patientId), productText, pharmacyNote }
  const actor = clientActor(client.personId)
  const result = await command(db(), { name: 'client_site.refill', actor, idempotencyKey: commandKey(client.personId, input.idempotencyKey), params }, async uow => {
    const patient = await uow.tx.patient.findUnique({ where: { id: params.patientId }, select: { status: true, name: true, ownerships: { where: { effectiveTo: null }, select: { clientId: true } } } })
    if (!patient || !patient.ownerships.some((o: { clientId: string | null }) => o.clientId === client.clientId)) throw new DomainError(Codes.NOT_FOUND, 'That pet was not found on your account.')
    if (patient.status === 'deceased') throw new DomainError(Codes.PATIENT_DECEASED, `We have ${patient.name} recorded as having passed away. Please call us.`)
    // The same medication asked for again within 72 hours is the same request (one item in the refill queue).
    const recent = await uow.tx.refillRequest.findFirst({
      where: { patientId: params.patientId, clientId: client.clientId, productText: { equals: productText, mode: 'insensitive' }, status: { in: ['received', 'in_review'] }, createdAt: { gte: new Date(uow.now.getTime() - 72 * 3_600_000) } },
      select: { id: true, ref: true, status: true, slaDueAt: true },
    })
    if (recent) return { id: recent.id, ref: recent.ref, status: recent.status, dueAt: recent.slaDueAt?.toISOString() ?? null, existing: true }
    const open = await uow.tx.refillRequest.count({ where: { clientId: client.clientId, status: { in: ['received', 'in_review'] } } })
    if (open >= MAX_OPEN_REFILLS) throw new DomainError(Codes.GUARD_FAILED, 'You have several refill requests with us already. Please call us about any others.')
    const ref = await nextReference(uow.tx, 'RFR', uow.now)
    const row = await uow.tx.refillRequest.create({
      data: { ref, patientId: params.patientId, clientId: client.clientId, requestedById: client.personId, channel: 'portal', productText, pharmacyNote, status: 'received', slaDueAt: new Date(uow.now.getTime() + 24 * 3_600_000) },
    })
    auditCreate(uow, actor, 'RefillRequest', row.id, 'refill.requested', { ref, patientId: params.patientId, channel: 'portal', personId: client.personId })
    await uow.tx.task.create({ data: { kind: 'refill_review', title: `Refill request ${ref}: ${productText}`.slice(0, 200), subjectType: 'RefillRequest', subjectId: row.id, priority: 'normal', status: 'open', dueAt: row.slaDueAt } })
    return { id: row.id, ref, status: row.status, dueAt: row.slaDueAt?.toISOString() ?? null, existing: false }
  })
  return result.value
}

const text = (value: unknown, label: string, max = 80) => {
  const out = String(value ?? '').trim()
  if (!out) throw new DomainError(Codes.INVALID_INPUT, `Enter ${label}.`)
  if (out.length > max) throw new DomainError(Codes.INVALID_INPUT, `${label[0].toUpperCase()}${label.slice(1)} is too long.`)
  return out
}

export type NewClientInput = { firstName: string; lastName: string; phone: string; email?: string | null; petName: string; speciesCode: string; breedName?: string | null; petDateOfBirth: string; locationId: string; idempotencyKey: string }

/**
 * A new household from the site: a prospect client, its first person and contact details, and a pending pet. Staff confirm it
 * (the registration review task), exactly as for a new caller. Contact details already on file are flagged for staff, not refused.
 */
export async function registerNewClient(input: NewClientInput): Promise<{ personId: string; contactPointId: string | null; clientRef: string }> {
  const site = await getSite()
  if (site.newClientMode === 'off') throw new DomainError(Codes.FEATURE_DISABLED, 'New clients are registered by phone. Please call us.')
  const firstName = text(input.firstName, 'your first name')
  const lastName = text(input.lastName, 'your last name')
  const petName = text(input.petName, 'your pet’s name')
  const dob = String(input.petDateOfBirth ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(`${dob}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, 'Enter your pet’s date of birth (a best guess is fine).')
  const contacts: { kind: ContactKind; value: string }[] = [{ kind: 'mobile', value: normaliseContact('mobile', input.phone) }]
  if (String(input.email ?? '').trim()) contacts.push({ kind: 'email', value: normaliseContact('email', String(input.email)) })
  if (!KEY.test(String(input.idempotencyKey ?? ''))) throw new DomainError(Codes.INVALID_INPUT, 'Reload the page and try again.')
  const params = { firstName, lastName, contacts, petName, speciesCode: String(input.speciesCode ?? ''), breedName: String(input.breedName ?? '').trim().slice(0, 80), dob, locationId: String(input.locationId ?? '') }
  const actor = clientActor('new-client')
  const result = await command(db(), { name: 'client_site.register', actor, idempotencyKey: `cs:new:${input.idempotencyKey}`, params }, async uow => {
    if (dob > uow.now.toISOString().slice(0, 10)) throw new DomainError(Codes.INVALID_INPUT, 'Your pet’s date of birth is in the future.')
    const location = await uow.tx.location.findUnique({ where: { id: params.locationId }, select: { id: true, stateCode: true, active: true } })
    if (!location?.active) throw new DomainError(Codes.NOT_FOUND, 'Pick a location.')
    const species = await uow.tx.species.findUnique({ where: { code: params.speciesCode } })
    if (!species?.active) throw new DomainError(Codes.INVALID_INPUT, 'Pick what kind of animal your pet is.')
    const breed = params.breedName ? await uow.tx.breed.findFirst({ where: { speciesId: species.id, name: { equals: params.breedName, mode: 'insensitive' } }, select: { id: true } }) : null
    const dupes = await uow.tx.contactPoint.count({ where: { valueHash: { in: contacts.map(c => contactHash(c.value)) }, status: 'active' } })

    const ref = await nextSerial(uow.tx, 'C')
    const household = await uow.tx.client.create({
      data: { ref, publicCode: publicCode('CL'), displayName: `${lastName} household`, kind: 'household', status: 'prospect', primaryLocationId: location.id, stateCode: location.stateCode, source: 'portal', accountFlags: dupes ? { possibleDuplicate: true } : {} },
    })
    auditCreate(uow, actor, 'Client', household.id, 'client.registered_pending', { ref, source: 'portal', possibleDuplicate: dupes > 0 })
    const person = await uow.tx.clientPerson.create({
      data: { clientId: household.id, firstName, lastName, relationship: 'owner', isPrimary: true, canBook: true, canApproveTreatment: true, canReceiveRecords: true, canPay: true, canAuthoriseEuthanasia: true },
    })
    auditCreate(uow, actor, 'ClientPerson', person.id, 'client_person.created', { clientId: household.id, isPrimary: true, relationship: 'owner', source: 'portal' })
    let firstPoint: string | null = null
    for (const contact of contacts) {
      const cp = await uow.tx.contactPoint.create({ data: { personId: person.id, kind: contact.kind, value: contact.value, valueHash: contactHash(contact.value), isPrimary: true, canText: contact.kind === 'mobile', status: 'active' } })
      firstPoint ??= cp.id
      auditCreate(uow, actor, 'ContactPoint', cp.id, 'contact_point.created', { personId: person.id, kind: contact.kind, isPrimary: true })
      // Care and transactional messages are implied by giving a number or address; the basis is recorded from the first contact.
      await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: 'transactional', action: 'grant', method: 'web_form', at: uow.now } })
    }
    const petRef = await nextSerial(uow.tx, 'P')
    const pet = await uow.tx.patient.create({
      data: { ref: petRef, name: petName, kind: 'individual', speciesId: species.id, breedId: breed?.id ?? null, sex: 'unknown', reproductiveStatus: 'unknown', dateOfBirth: new Date(`${dob}T00:00:00Z`), dobEstimated: false, status: 'pending', codeStatus: 'unspecified' },
    })
    await uow.tx.patientOwnership.create({ data: { patientId: pet.id, clientId: household.id, role: 'primary', effectiveFrom: uow.now, basis: 'registration' } })
    auditCreate(uow, actor, 'Patient', pet.id, 'patient.registered', { ref: petRef, clientId: household.id, species: species.code, status: 'pending', microchip: null })
    const task = await uow.tx.task.create({
      data: { kind: 'registration_review', title: `Confirm new client ${ref}${dupes ? ' (possible duplicate)' : ''}`, subjectType: 'Client', subjectId: household.id, locationId: location.id, priority: dupes ? 'high' : 'normal', status: 'open', dueAt: new Date(uow.now.getTime() + 24 * 3_600_000) },
    })
    auditCreate(uow, actor, 'Task', task.id, 'task.created', { kind: 'registration_review', clientId: household.id })
    return { personId: person.id, contactPointId: firstPoint, clientRef: ref }
  })
  return result.value
}
