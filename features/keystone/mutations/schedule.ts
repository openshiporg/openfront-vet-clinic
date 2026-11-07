import { command } from '../lib/command'
import { advisoryLock } from '../lib/db'
import { auditCreate, transition } from '../lib/cas'
import { actorAgentId, actorUserId, type Actor } from '../lib/actor'
import { addDays, localDate } from '../lib/calendar'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import type { UnitOfWork } from '../lib/unitOfWork'
import { buildSegments, findSlots, signSlot, verifySlot, workingIntervals, type Interval, type SegmentTemplate } from '../domain/scheduling'
import { gated } from './agentGuard'

/**
 * Scheduling (STATE-MACHINES §3). Availability is computed from staff schedules, provider and
 * resource reservations; an offered slot is a signed token. Booking takes sorted advisory locks on
 * every resource and provider-day it touches, re-checks, and inserts reservations; the database's
 * exclusion constraints refuse any overlap the locks somehow missed (I-O4).
 */

type Ctx = { session: unknown; prisma: any }
const LIVE = ['requested', 'booked', 'confirmed', 'checked_in', 'in_progress', 'ready_for_checkout']
const STEP_MINUTES = 15

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** Load everything availability needs for a location, type and local-date window in a few queries. */
async function loadAvailability(tx: any, input: { locationId: string; appointmentTypeId: string; from: string; days: number; providerId?: string | null }) {
  const [location, type] = await Promise.all([
    tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, timeZone: true, active: true } }),
    tx.appointmentType.findUnique({ where: { id: input.appointmentTypeId } }),
  ])
  if (!location?.active) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
  if (!type?.active) throw new DomainError(Codes.NOT_FOUND, 'Appointment type not found.')
  const providerKinds = list(type.providerKinds)
  const resourceKinds = list(type.requiredResourceKinds)
  const windowStart = new Date(`${input.from}T00:00:00Z`).getTime() - 86_400_000
  const windowEnd = new Date(`${addDays(input.from, input.days)}T00:00:00Z`).getTime() + 86_400_000
  const range = { startsAt: { lt: new Date(windowEnd) }, endsAt: { gt: new Date(windowStart) }, status: { not: 'released' } }
  const [staff, resources] = await Promise.all([
    tx.staffMember.findMany({
      where: { active: true, kind: { in: providerKinds.length ? providerKinds : ['dvm'] }, ...(input.providerId ? { id: input.providerId } : {}), OR: [{ homeLocationId: location.id }, { locations: { some: { id: location.id } } }] },
      select: { id: true, displayName: true },
    }),
    tx.resource.findMany({ where: { locationId: location.id, active: true, kind: { in: resourceKinds.length ? resourceKinds : ['exam_room'] } }, select: { id: true, name: true, kind: true } }),
  ])
  const staffIds = staff.map((s: { id: string }) => s.id)
  const [schedules, providerBusy, resourceBusy] = await Promise.all([
    tx.staffSchedule.findMany({ where: { staffMemberId: { in: staffIds }, locationId: location.id } }),
    tx.providerReservation.findMany({ where: { staffMemberId: { in: staffIds }, ...range }, select: { staffMemberId: true, startsAt: true, endsAt: true } }),
    tx.resourceReservation.findMany({ where: { resourceId: { in: resources.map((r: { id: string }) => r.id) }, ...range }, select: { resourceId: true, startsAt: true, endsAt: true } }),
  ])
  return { location, type, staff, resources, schedules, providerBusy, resourceBusy }
}

const asInterval = (r: { startsAt: Date; endsAt: Date }): Interval => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() })
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

function computeSlots(data: Awaited<ReturnType<typeof loadAvailability>>, input: { from: string; days: number; notBefore: number; limit: number }) {
  const category = String(data.type.category)
  const out: ReturnType<typeof findSlots> = []
  for (let i = 0; i < input.days && out.length < input.limit; i += 1) {
    const date = addDays(input.from, i)
    const providers = data.staff.map((s: { id: string }) => ({
      id: s.id,
      working: workingIntervals(
        data.schedules.filter((b: { staffMemberId: string }) => b.staffMemberId === s.id).map((b: any) => ({
          kind: b.kind, weekday: b.weekday, localDate: isoDay(b.localDate), startTime: b.startTime, endTime: b.endTime,
          categories: list(b.appointmentCategories), effectiveFrom: isoDay(b.effectiveFrom), effectiveTo: isoDay(b.effectiveTo),
        })),
        date, data.location.timeZone, category,
      ),
      busy: data.providerBusy.filter((r: { staffMemberId: string }) => r.staffMemberId === s.id).map(asInterval),
    }))
    const resources = data.resources.map((r: { id: string }) => ({ id: r.id, busy: data.resourceBusy.filter((b: { resourceId: string }) => b.resourceId === r.id).map(asInterval) }))
    out.push(...findSlots({ minutes: data.type.durationMinutes, stepMinutes: STEP_MINUTES, notBefore: input.notBefore, providers, resources, limit: input.limit - out.length }))
  }
  return out
}

/** Open slots with signed tokens (the AI receptionist and the front desk use the same answer). */
export async function searchAvailability(_root: unknown, args: { locationId: string; appointmentTypeId: string; from?: string | null; days?: number | null; providerId?: string | null; limit?: number | null }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.read', tool: 'schedule.search' }, args, async actor => {
    const days = Math.min(Math.max(args.days ?? 7, 1), 21)
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50)
    const now = Date.now()
    const location = await context.prisma.location.findUnique({ where: { id: args.locationId }, select: { timeZone: true } })
    if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
    const from = args.from && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : localDate({ timeZone: location.timeZone }, now)
    const data = await loadAvailability(context.prisma, { locationId: args.locationId, appointmentTypeId: args.appointmentTypeId, from, days, providerId: args.providerId })
    if (actor.kind === 'agent' && !data.type.aiBookable) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${data.type.name} is booked by the front desk, not the AI receptionist.`)
    const names = new Map<string, string>([...data.staff.map((s: any) => [s.id, s.displayName] as [string, string]), ...data.resources.map((r: any) => [r.id, r.name] as [string, string])])
    const slots = computeSlots(data, { from, days, notBefore: now + 15 * 60_000, limit })
    return {
      appointmentType: { id: data.type.id, name: data.type.name, durationMinutes: data.type.durationMinutes, requestOnly: data.type.requestOnly },
      slots: slots.map(s => ({
        startsAt: new Date(s.start).toISOString(), endsAt: new Date(s.end).toISOString(), providerId: s.providerId, providerName: names.get(s.providerId) ?? '', resourceName: names.get(s.resourceId) ?? '',
        slotToken: signSlot({ providerId: s.providerId, resourceId: s.resourceId, appointmentTypeId: data.type.id, locationId: args.locationId, start: s.start, end: s.end }, now),
      })),
    }
  })
}

type BookInput = { slotToken: string; clientId: string; patientIds: string[]; reason?: string | null; channel?: string | null; callRecordId?: string | null; triageId?: string | null }

/** Lock keys in a fixed order so two bookings never deadlock (resource first, then provider-day). */
async function lockSlot(uow: UnitOfWork, claims: { resourceId: string; providerId: string; start: number }, timeZone: string) {
  const keys = [`resource:${claims.resourceId}`, `provider-day:${claims.providerId}:${localDate({ timeZone }, claims.start)}`].sort()
  for (const key of keys) await advisoryLock(uow.tx, key)
}

/** The AI path's preconditions (INTEGRATIONS §7): disclosure played, urgency screened, caller verified. */
async function agentBookingChecks(uow: UnitOfWork, input: BookInput, category: string) {
  if (!input.callRecordId) throw new DomainError(Codes.GUARD_FAILED, 'An AI booking belongs to a call.', { field: 'callRecordId' })
  const call = await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { disclosurePlayedAt: true, callerVerifiedAt: true, clientId: true, status: true } })
  if (!call || call.status !== 'in_progress') throw new DomainError(Codes.GUARD_FAILED, 'The call is not in progress.')
  if (!call.disclosurePlayedAt) throw new DomainError(Codes.GUARD_FAILED, 'The AI disclosure has not been played on this call.')
  const client = await uow.tx.client.findUnique({ where: { id: input.clientId }, select: { status: true } })
  if (client?.status !== 'prospect' && (!call.callerVerifiedAt || call.clientId !== input.clientId)) {
    throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller before booking for an existing client.')
  }
  if (category === 'sick' || category === 'recheck') {
    if (!input.triageId) throw new DomainError(Codes.GUARD_FAILED, 'A sick visit booked by the AI receptionist needs the urgency screen first.', { field: 'triageId' })
  }
}

export async function bookAppointment(_root: unknown, args: { input: BookInput; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.book', tool: 'appointment.book' }, args, async actor => {
    const input = args.input
    const claims = verifySlot(input.slotToken)
    if (!input.patientIds?.length) throw new DomainError(Codes.INVALID_INPUT, 'Pick at least one patient.', { field: 'patientIds' })
    const result = await command(context.prisma, { name: 'appointment.book', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => bookInTx(uow, actor, input, claims))
    return { replay: result.replay, ...result.value }
  })
}

async function bookInTx(uow: UnitOfWork, actor: Actor, input: BookInput, claims: ReturnType<typeof verifySlot>) {
  const [type, location] = await Promise.all([
    uow.tx.appointmentType.findUnique({ where: { id: claims.appointmentTypeId } }),
    uow.tx.location.findUnique({ where: { id: claims.locationId }, select: { id: true, timeZone: true } }),
  ])
  if (!type?.active || !location) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That slot is no longer offered.')
  if (actor.kind === 'agent') {
    if (!type.aiBookable) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${type.name} is booked by the front desk.`)
    await agentBookingChecks(uow, input, String(type.category))
  }
  if (input.triageId) {
    const triage = await uow.tx.triageAssessment.findUnique({ where: { id: input.triageId }, select: { level: true } })
    if (!triage) throw new DomainError(Codes.NOT_FOUND, 'Triage not found.')
    if (triage.level === 'emergency_now') throw new DomainError(Codes.GUARD_FAILED, 'This is an emergency: transfer the call or refer to the ER now. It is never booked as an appointment.')
  }
  const patients = await uow.tx.patient.findMany({ where: { id: { in: input.patientIds } }, select: { id: true, status: true, name: true, ownerships: { where: { effectiveTo: null }, select: { clientId: true } } } })
  if (patients.length !== new Set(input.patientIds).size) throw new DomainError(Codes.NOT_FOUND, 'A patient was not found.')
  for (const p of patients) {
    if (p.status === 'deceased') throw new DomainError(Codes.PATIENT_DECEASED, `${p.name} has died. Appointments can't be booked.`)
    if (p.status === 'merged' || p.status === 'inactive') throw new DomainError(Codes.GUARD_FAILED, `${p.name}'s record is ${p.status}.`)
    if (!p.ownerships.some(o => o.clientId === input.clientId)) throw new DomainError(Codes.GUARD_FAILED, `${p.name} is not on this client's account.`)
  }
  const startsAt = new Date(claims.start)
  const endsAt = new Date(claims.end)
  const clash = async () => {
    const [providerClash, resourceClash] = await Promise.all([
      uow.tx.providerReservation.count({ where: { staffMemberId: claims.providerId, status: { not: 'released' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
      uow.tx.resourceReservation.count({ where: { resourceId: claims.resourceId, status: { not: 'released' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
    ])
    if (providerClash || resourceClash) throw new DomainError(Codes.SLOT_TAKEN, 'That time was just taken. Pick another slot.')
  }
  // Fast path: an already-taken slot fails without queueing on the locks.
  await clash()
  await lockSlot(uow, claims, location.timeZone)
  // Re-check under the locks: someone may have taken it since the slot was offered.
  await clash()
  const status = type.requestOnly ? 'requested' : 'booked'
  const holdStatus = type.requestOnly ? 'held' : 'confirmed'
  const ref = await nextReference(uow.tx, 'APT', uow.now)
  const channel = actor.kind === 'agent' ? 'ai_voice' : input.channel ?? 'csr'
  const appointment = await uow.tx.appointment.create({
    data: {
      ref, locationId: location.id, clientId: input.clientId, appointmentTypeId: type.id, providerId: claims.providerId, startsAt, endsAt, status, channel,
      bookedByUserId: actorUserId(actor), bookedByAgentId: actorAgentId(actor), slotToken: input.slotToken.slice(-43), reason: String(input.reason ?? '').slice(0, 500),
      triageId: input.triageId ?? null, callRecordId: input.callRecordId ?? null,
    },
  })
  await uow.tx.appointmentPatient.createMany({ data: input.patientIds.map(patientId => ({ appointmentId: appointment.id, patientId, reason: String(input.reason ?? '').slice(0, 500) })) })
  const segments = buildSegments(type.segments as SegmentTemplate[] | null, claims.start, type.durationMinutes)
  await uow.tx.appointmentSegment.createMany({ data: segments.map(s => ({ appointmentId: appointment.id, kind: s.kind, startsAt: s.startsAt, endsAt: s.endsAt, resourceId: claims.resourceId, staffId: claims.providerId })) })
  await uow.tx.resourceReservation.create({ data: { resourceId: claims.resourceId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } })
  await uow.tx.providerReservation.create({ data: { staffMemberId: claims.providerId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } })
  auditCreate(uow, actor, 'Appointment', appointment.id, 'appointment.booked', { ref, status, startsAt, endsAt, typeCode: type.code, channel, patients: input.patientIds.length })
  uow.emit({ topic: 'comms.appointment_booked', aggregateType: 'Appointment', aggregateId: appointment.id, payload: { appointmentId: appointment.id, template: status === 'requested' ? 'appointment_requested' : 'appointment_booked' }, dedupeKey: `comms.booked:${appointment.id}` })
  return { id: appointment.id, ref, status, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

async function releaseHolds(uow: UnitOfWork, appointmentId: string) {
  await uow.tx.resourceReservation.updateMany({ where: { appointmentId, status: { not: 'released' } }, data: { status: 'released' } })
  await uow.tx.providerReservation.updateMany({ where: { appointmentId, status: { not: 'released' } }, data: { status: 'released' } })
}

export async function cancelAppointment(_root: unknown, args: { appointmentId: string; reason: string; expectedVersion: number; callRecordId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.book', tool: 'appointment.cancel' }, args, async actor => {
    if (!args.reason?.trim()) throw new DomainError(Codes.INVALID_INPUT, 'Give a reason.', { field: 'reason' })
    const result = await command(context.prisma, { name: 'appointment.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string; clientId: string }>(uow, {
        model: 'Appointment', id: args.appointmentId, from: ['requested', 'booked', 'confirmed'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.cancelled', reason: args.reason,
        data: { cancelReason: args.reason.trim().slice(0, 300), cancelledAt: uow.now },
        guard: async appt => {
          if (actor.kind !== 'agent') return
          const call = args.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null
          if (!call?.callerVerifiedAt || call.clientId !== appt.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller before changing their appointment.')
        },
      })
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id }, data: { status: 'cancelled' } })
      await releaseHolds(uow, row.id)
      uow.emit({ topic: 'waitlist.slot_freed', aggregateType: 'Appointment', aggregateId: row.id, payload: { appointmentId: row.id }, dedupeKey: `waitlist.freed:${row.id}` })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Move to a new offered slot: the old holds are released and the new ones taken in one transaction. */
export async function rescheduleAppointment(_root: unknown, args: { appointmentId: string; slotToken: string; expectedVersion: number; callRecordId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.book', tool: 'appointment.reschedule' }, args, async actor => {
    const claims = verifySlot(args.slotToken)
    const result = await command(context.prisma, { name: 'appointment.reschedule', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const old = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { id: true, clientId: true, appointmentTypeId: true, triageId: true, reason: true, patients: { select: { patientId: true } } } })
      if (!old) throw new DomainError(Codes.NOT_FOUND, 'Appointment not found.')
      if (old.appointmentTypeId !== claims.appointmentTypeId) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That slot is for a different appointment type.')
      await transition(uow, {
        model: 'Appointment', id: old.id, from: ['requested', 'booked', 'confirmed'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.rescheduled_from', reason: 'rescheduled',
        data: { cancelReason: 'rescheduled', cancelledAt: uow.now },
        guard: async () => {
          if (actor.kind !== 'agent') return
          const call = args.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null
          if (!call?.callerVerifiedAt || call.clientId !== old.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller before changing their appointment.')
        },
      })
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: old.id }, data: { status: 'cancelled' } })
      await releaseHolds(uow, old.id)
      const booked = await bookInTx(uow, actor, { slotToken: args.slotToken, clientId: old.clientId!, patientIds: old.patients.map(p => p.patientId!), reason: old.reason, callRecordId: args.callRecordId, triageId: old.triageId }, claims)
      return { previousId: old.id, ...booked }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** The client confirms (C reply, call, portal) or staff confirm on their behalf. */
export async function confirmAppointment(_root: unknown, args: { appointmentId: string; expectedVersion?: number | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.book', tool: 'appointment.confirm' }, args, async actor => {
    const result = await command(context.prisma, { name: 'appointment.confirm', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string }>(uow, { model: 'Appointment', id: args.appointmentId, from: ['booked'], to: 'confirmed', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.confirmed', data: { confirmedAt: uow.now } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Staff accept a request-only booking (surgery, dental): holds become firm. */
export async function acceptAppointmentRequest(_root: unknown, args: { appointmentId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], tool: 'appointment.accept', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'appointment.accept', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string }>(uow, { model: 'Appointment', id: args.appointmentId, from: ['requested'], to: 'booked', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.accepted' })
      await uow.tx.resourceReservation.updateMany({ where: { appointmentId: row.id, status: 'held' }, data: { status: 'confirmed' } })
      await uow.tx.providerReservation.updateMany({ where: { appointmentId: row.id, status: 'held' }, data: { status: 'confirmed' } })
      uow.emit({ topic: 'comms.appointment_booked', aggregateType: 'Appointment', aggregateId: row.id, payload: { appointmentId: row.id, template: 'appointment_booked' }, dedupeKey: `comms.accepted:${row.id}` })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Check-in (SM§3): every active warn/block alert on the patients must be acknowledged by the person
 * checking in, a block alert needs the acknowledgement plus canCheckIn; the patients go on the board.
 */
export async function checkInAppointment(_root: unknown, args: { appointmentId: string; acknowledgedAlertIds?: string[] | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCheckIn'], tool: 'appointment.check_in', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'appointment.check_in', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const appt = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { locationId: true, patients: { select: { patientId: true } }, segments: { select: { resourceId: true }, take: 1 } } })
      if (!appt) throw new DomainError(Codes.NOT_FOUND, 'Appointment not found.')
      const patientIds = appt.patients.map(p => p.patientId!)
      const alerts = await uow.tx.patientAlert.findMany({ where: { patientId: { in: patientIds }, active: true, severity: { in: ['warn', 'block'] } }, select: { id: true, text: true } })
      const acked = new Set(args.acknowledgedAlertIds ?? [])
      const missing = alerts.filter(a => !acked.has(a.id))
      if (missing.length) throw new DomainError(Codes.GUARD_FAILED, `Acknowledge the patient alerts first: ${missing.map(a => a.text).join('; ')}`, { problems: missing.map(a => a.id) })
      const row = await transition<{ id: string; status: string }>(uow, { model: 'Appointment', id: args.appointmentId, from: ['booked', 'confirmed'], to: 'checked_in', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.checked_in', data: { checkedInAt: uow.now } })
      if (alerts.length) await uow.tx.alertAcknowledgement.createMany({ data: alerts.map(a => ({ alertId: a.id, userId: actorUserId(actor), appointmentId: row.id, at: uow.now })) })
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id, status: 'scheduled' }, data: { status: 'checked_in', version: { increment: 1 } } })
      for (const patientId of patientIds) {
        const live = await uow.tx.whiteboardEntry.findFirst({ where: { locationId: appt.locationId, patientId, status: { not: 'discharged' } }, select: { id: true } })
        if (!live) {
          const entry = await uow.tx.whiteboardEntry.create({ data: { locationId: appt.locationId, patientId, appointmentId: row.id, status: 'waiting', roomId: appt.segments[0]?.resourceId ?? null, since: uow.now, flags: [] } })
          auditCreate(uow, actor, 'WhiteboardEntry', entry.id, 'whiteboard.added', { patientId, appointmentId: row.id })
        }
      }
      return { id: row.id, status: row.status, alertsAcknowledged: alerts.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Mark a no-show after the start time has passed (releases holds; feeds the client's history). */
export async function markNoShow(_root: unknown, args: { appointmentId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCheckIn', 'canBook'], tool: 'appointment.no_show', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'appointment.no_show', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string; startsAt: Date }>(uow, {
        model: 'Appointment', id: args.appointmentId, from: ['booked', 'confirmed'], to: 'no_show', expectedVersion: args.expectedVersion, actor, eventType: 'appointment.no_show',
        guard: appt => { if (appt.startsAt.getTime() > uow.now.getTime()) throw new DomainError(Codes.GUARD_FAILED, 'The appointment has not started yet.') },
      })
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id }, data: { status: 'no_show' } })
      await releaseHolds(uow, row.id)
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

const BOARD_MOVES: Record<string, string[]> = {
  waiting: ['in_exam', 'treatment', 'diagnostics', 'hospitalised', 'surgery', 'boarding', 'ready_for_discharge'],
  in_exam: ['treatment', 'diagnostics', 'hospitalised', 'surgery', 'ready_for_discharge', 'waiting'],
  treatment: ['in_exam', 'diagnostics', 'hospitalised', 'surgery', 'ready_for_discharge'],
  diagnostics: ['in_exam', 'treatment', 'hospitalised', 'surgery', 'ready_for_discharge'],
  hospitalised: ['treatment', 'diagnostics', 'surgery', 'ready_for_discharge'],
  surgery: ['recovery'],
  recovery: ['hospitalised', 'treatment', 'ready_for_discharge'],
  boarding: ['ready_for_discharge', 'treatment'],
  ready_for_discharge: ['discharged', 'treatment', 'hospitalised'],
}

export async function moveWhiteboardEntry(_root: unknown, args: { entryId: string; to: string; roomId?: string | null; assignedDvmId?: string | null; assignedTechId?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canCheckIn', 'canWriteRecord'], tool: 'whiteboard.move', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'whiteboard.move', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const current = await uow.tx.whiteboardEntry.findUnique({ where: { id: args.entryId }, select: { status: true, appointmentId: true } })
      if (!current) throw new DomainError(Codes.NOT_FOUND, 'Board entry not found.')
      const allowed = BOARD_MOVES[current.status] ?? []
      if (!allowed.includes(args.to)) throw new DomainError(Codes.INVALID_TRANSITION, `A patient in ${current.status} can't move to ${args.to}.`, { currentStatus: current.status, to: args.to })
      const row = await transition<{ id: string; status: string }>(uow, {
        model: 'WhiteboardEntry', id: args.entryId, from: [current.status], to: args.to, expectedVersion: args.expectedVersion, actor, eventType: 'whiteboard.moved',
        data: { since: uow.now, ...(args.roomId !== undefined ? { roomId: args.roomId } : {}), ...(args.assignedDvmId !== undefined ? { assignedDvmId: args.assignedDvmId } : {}), ...(args.assignedTechId !== undefined ? { assignedTechId: args.assignedTechId } : {}) },
      })
      if (current.appointmentId && args.to === 'in_exam') {
        await uow.tx.appointment.updateMany({ where: { id: current.appointmentId, status: 'checked_in' }, data: { status: 'in_progress', version: { increment: 1 } } })
      }
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addToWaitlist(_root: unknown, args: { input: { clientId: string; patientIds: string[]; locationId: string; appointmentTypeId: string; urgency: 'routine' | 'soon' | 'urgent'; preferredWindows?: unknown; note?: string | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.book', tool: 'waitlist.add' }, args, async actor => {
    const input = args.input
    const result = await command(context.prisma, { name: 'waitlist.add', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const row = await uow.tx.waitlistEntry.create({
        data: { clientId: input.clientId, locationId: input.locationId, appointmentTypeId: input.appointmentTypeId, urgency: input.urgency, preferredWindows: (input.preferredWindows ?? []) as never, note: String(input.note ?? '').slice(0, 500), status: 'waiting', patients: { connect: input.patientIds.map(id => ({ id })) } },
      })
      auditCreate(uow, actor, 'WaitlistEntry', row.id, 'waitlist.added', { clientId: input.clientId, urgency: input.urgency })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export const LIVE_APPOINTMENT_STATUSES = LIVE
