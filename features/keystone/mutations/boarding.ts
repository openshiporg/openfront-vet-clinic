import { randomUUID } from 'node:crypto'
import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { advisoryLock } from '../lib/db'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { resolvePolicy } from '../domain/policy'
import { addDays } from '../domain/wellness'
import { applyDepositTo, clientOfPatient, postDraftInvoice } from './billing'
import { serviceCharge, serviceItemCharge } from './serviceCharge'
import { gated } from './agentGuard'
import { activePatient, locationDay, staffOf, text, type Ctx } from './clinical'
import { dateOnly, minorText, pick } from './billingInput'
import type { UnitOfWork } from '../lib/unitOfWork'

/*
 * Boarding and grooming (BUILD-PLAN P5, STATE-MACHINES §16). Capacity is counted per run type per night in NightlyRunInventory.
 * Every booking locks the nights it touches (in date order, so two bookings cannot deadlock) and a CHECK keeps sold between zero
 * and capacity, so the last run can only ever be given once. A request is a hold: it counts only until its hold time passes, and
 * that is decided when the page or the booking reads it (no sweeper). Nothing here runs on a timer.
 */

const BOARDERS = ['canManageBoarding', 'canBook', 'canCheckIn'] as const
const GROOMERS = ['canGroom', 'canManageBoarding', 'canBook', 'canCheckIn'] as const
const HOLD_HOURS = 24
const MAX_NIGHTS = 60
const ZERO = 0n
const asDate = (s: string) => new Date(`${s}T00:00:00Z`)
const day = (d: Date) => d.toISOString().slice(0, 10)

export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = []
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d)
  return out
}

/** Nights this reservation holds right now: a request whose hold lapsed holds nothing. */
export const holdsNights = (r: { status: string; holdExpiresAt: Date | null }, now: Date) => r.status === 'confirmed' || r.status === 'checked_in' || (r.status === 'requested' && (!r.holdExpiresAt || r.holdExpiresAt > now))

// ── Availability ────────────────────────────────────────────────────────────────────────────

/** Give back the inventory of requests that lapsed, for the nights asked about. Called inside the booking transaction, under the night locks. */
async function releaseLapsed(uow: UnitOfWork, runTypeId: string, nights: string[]) {
  const lapsed = await uow.tx.boardingReservation.findMany({ where: { runTypeId, status: 'requested', holdExpiresAt: { lte: uow.now }, checkInOn: { lte: asDate(nights[nights.length - 1]) }, checkOutOn: { gt: asDate(nights[0]) } }, select: { id: true, checkInOn: true, checkOutOn: true, version: true } })
  for (const r of lapsed) {
    const own = nightsBetween(day(r.checkInOn), day(r.checkOutOn))
    await uow.tx.nightlyRunInventory.updateMany({ where: { runTypeId, night: { in: own.map(asDate) }, sold: { gt: 0 } }, data: { sold: { decrement: 1 } } })
    await uow.tx.boardingReservation.updateMany({ where: { id: r.id, status: 'requested', version: r.version }, data: { status: 'cancelled', cancelReason: 'The hold ran out', version: { increment: 1 } } })
  }
  return lapsed.length
}

async function lockNights(uow: UnitOfWork, runTypeId: string, nights: string[]) {
  for (const n of [...nights].sort()) await advisoryLock(uow.tx, `boarding-night:${runTypeId}:${n}`)
}

async function takeNights(uow: UnitOfWork, runType: { id: string; locationId: string | null; capacity: number }, nights: string[]) {
  await lockNights(uow, runType.id, nights)
  await releaseLapsed(uow, runType.id, nights)
  for (const n of nights) {
    // The night lock above makes find-then-create safe; the unique index on (run type, night) is the backstop.
    const row = await uow.tx.nightlyRunInventory.findFirst({ where: { runTypeId: runType.id, night: asDate(n) }, select: { id: true, capacity: true } })
    if (!row) await uow.tx.nightlyRunInventory.create({ data: { runTypeId: runType.id, locationId: runType.locationId, night: asDate(n), capacity: runType.capacity, sold: 0 } })
    else if (row.capacity !== runType.capacity) await uow.tx.nightlyRunInventory.update({ where: { id: row.id }, data: { capacity: runType.capacity } })
  }
  const taken = await uow.tx.nightlyRunInventory.updateMany({ where: { runTypeId: runType.id, night: { in: nights.map(asDate) }, sold: { lt: runType.capacity } }, data: { sold: { increment: 1 } } })
  if (taken.count !== nights.length) {
    // Some night was full: the whole booking is refused and the transaction rolls back every night it took.
    throw new DomainError(Codes.SLOT_TAKEN, 'No run of that size is free for all of those nights.', { reason: 'sold_out' })
  }
}

async function giveBackNights(uow: UnitOfWork, runTypeId: string, nights: string[]) {
  await lockNights(uow, runTypeId, nights)
  await uow.tx.nightlyRunInventory.updateMany({ where: { runTypeId, night: { in: nights.map(asDate) }, sold: { gt: 0 } }, data: { sold: { decrement: 1 } } })
}

export const runCapacity = async (uow: UnitOfWork, runTypeId: string) => {
  const rt = await uow.tx.runType.findUnique({ where: { id: runTypeId }, select: { id: true, locationId: true, active: true, speciesCodes: true, maxWeightKg: true, nightlyRateMinor: true, depositMinor: true, name: true } })
  if (!rt) throw new DomainError(Codes.NOT_FOUND, 'That run size was not found.')
  return { ...rt, capacity: await uow.tx.run.count({ where: { runTypeId: rt.id, status: 'available' } }) }
}

// ── Vaccines ────────────────────────────────────────────────────────────────────────────────

/** Required vaccines (the practice's boarding policy) that are not in date for every night of the stay. */
export async function missingVaccines(uow: UnitOfWork, patientId: string, speciesCode: string, locationId: string, checkIn: string, checkOut: string) {
  const policy = await resolvePolicy(uow.tx, 'boarding', { locationId, on: checkIn })
  const required = policy.rules.requiredVaccines[speciesCode] ?? []
  if (!required.length) return []
  const last = addDays(checkOut, -1)
  const grace = policy.rules.gracePeriodDays
  const given = await uow.tx.vaccineAdministration.findMany({ where: { patientId, reverses: null }, select: { id: true, dueNextOn: true, product: { select: { isRabies: true, antigens: true, name: true } } } })
  const reversed = new Set((await uow.tx.vaccineAdministration.findMany({ where: { patientId, reversesId: { not: null } }, select: { reversesId: true } })).map(r => r.reversesId))
  const live = given.filter(g => !reversed.has(g.id))
  const covers = (name: string, g: (typeof live)[number]) => {
    const text = `${g.product?.name ?? ''} ${JSON.stringify(g.product?.antigens ?? [])}`.toLowerCase()
    if (name === 'rabies') return g.product?.isRabies === true
    if (name === 'dapp') return /cdv|dapp|dhpp/.test(text)
    if (name === 'bordetella') return /bordetella|bronchiseptica/.test(text)
    if (name === 'fvrcp') return /fvrcp|fpv/.test(text)
    return text.includes(name.toLowerCase())
  }
  return required.filter(name => !live.some(g => covers(name, g) && day(g.dueNextOn) >= addDays(last, -grace)))
}

// ── Run types and runs ──────────────────────────────────────────────────────────────────────

export async function saveRunType(_root: unknown, args: { runTypeId?: string | null; code: string; name: string; locationId: string; speciesCodes?: string[] | null; maxWeightKg?: number | null; nightlyRateMinor: string; depositMinor?: string | null; runs: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageBoarding', 'canManagePractice'], tool: 'boarding.save_run_type', humanOnly: true }, args, async actor => {
    const rate = minorText(args.nightlyRateMinor, 'nightly rate')
    const deposit = args.depositMinor ? minorText(args.depositMinor, 'deposit', true) : ZERO
    if (!Number.isInteger(args.runs) || args.runs < 0 || args.runs > 100) throw new DomainError(Codes.INVALID_INPUT, 'The number of runs is 0 to 100.', { field: 'runs' })
    const result = await command(context.prisma, { name: 'boarding.save_run_type', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await locationDay(uow, args.locationId, uow.now)
      const code = text(args.code, 'code', 30).toLowerCase().replace(/[^a-z0-9_-]/g, '')
      const data = { code, name: text(args.name, 'name', 60), locationId: args.locationId, speciesCodes: args.speciesCodes?.length ? args.speciesCodes : undefined, maxWeightKg: args.maxWeightKg ?? null, nightlyRateMinor: rate, depositMinor: deposit, active: true }
      const rt = args.runTypeId ? await uow.tx.runType.update({ where: { id: args.runTypeId }, data }) : await uow.tx.runType.create({ data })
      const have = await uow.tx.run.count({ where: { runTypeId: rt.id } })
      for (let i = have; i < args.runs; i += 1) await uow.tx.run.create({ data: { label: `${rt.name} ${i + 1}`, runTypeId: rt.id, locationId: args.locationId, status: 'available' } })
      auditCreate(uow, actor, 'RunType', rt.id, 'boarding.run_type_saved', { code, runs: args.runs })
      return { id: rt.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function setRunStatus(_root: unknown, args: { runId: string; status: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageBoarding', 'canManagePractice'], tool: 'boarding.set_run_status', humanOnly: true }, args, async actor => {
    const status = pick(args.status, ['available', 'out_of_service'] as const, 'status')
    const result = await command(context.prisma, { name: 'boarding.set_run_status', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const run = await lockRow<any>(uow.tx, 'Run', args.runId)
      if (status === 'out_of_service' && (await uow.tx.runAssignment.count({ where: { runId: run.id, endsAt: null } }))) throw new DomainError(Codes.GUARD_FAILED, 'A pet is staying in this run. Move them first.')
      const row = await transition(uow, { model: 'Run', id: run.id, from: ['available', 'out_of_service'], to: status, expectedVersion: args.expectedVersion, actor, eventType: 'boarding.run_status' })
      return { id: run.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Reservations ────────────────────────────────────────────────────────────────────────────

/** Ask for a run for some nights. It is a hold for 24 hours; a deposit is requested; staff confirm it. A vaccine gap blocks it unless a veterinarian-approved override reason is given. */
export async function reserveBoarding(_root: unknown, args: { patientId: string; runTypeId: string; checkInOn: string; checkOutOn: string; notes?: string | null; vaccineOverrideReason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.reserve', humanOnly: true }, args, async actor => {
    const checkIn = dateOnly(args.checkInOn, 'check-in day')
    const checkOut = dateOnly(args.checkOutOn, 'check-out day')
    if (checkOut <= checkIn) throw new DomainError(Codes.INVALID_INPUT, 'Check-out must be after check-in.', { field: 'checkOutOn' })
    const nights = nightsBetween(checkIn, checkOut)
    if (nights.length > MAX_NIGHTS) throw new DomainError(Codes.INVALID_INPUT, `A stay is at most ${MAX_NIGHTS} nights.`, { field: 'checkOutOn' })
    const result = await command(context.prisma, { name: 'boarding.reserve', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const patient = await activePatient(uow, args.patientId)
      const clientId = await clientOfPatient(uow, patient.id)
      const rt = await runCapacity(uow, args.runTypeId)
      if (!rt.active || !rt.locationId) throw new DomainError(Codes.GUARD_FAILED, 'That run size is not taking bookings.')
      const { on } = await locationDay(uow, rt.locationId, uow.now)
      if (checkIn < on) throw new DomainError(Codes.INVALID_INPUT, 'Check-in cannot be in the past.', { field: 'checkInOn' })
      const species = rt.speciesCodes as string[] | null
      if (species?.length && !species.includes(patient.species?.code ?? '')) throw new DomainError(Codes.GUARD_FAILED, `${rt.name} is not for ${patient.species?.name?.toLowerCase() ?? 'this species'}.`)
      const missing = await missingVaccines(uow, patient.id, patient.species?.code ?? '', rt.locationId, checkIn, checkOut)
      let override = ''
      if (missing.length) {
        override = (args.vaccineOverrideReason ?? '').trim()
        if (override.length < 8) throw new DomainError(Codes.GUARD_FAILED, `${patient.name} needs current ${missing.join(', ')} vaccination for the whole stay. Record the vaccine, or give the reason a veterinarian approved an exception.`, { reason: 'vaccines_missing', missing })
        const staff = await staffOf(uow, actor)
        const role = actor.kind === 'user' ? await uow.tx.user.findUnique({ where: { id: actor.userId }, select: { role: { select: { canManageBoarding: true, canManagePractice: true } } } }) : null
        if (!role?.role?.canManageBoarding && !role?.role?.canManagePractice) throw new DomainError(Codes.NOT_AUTHORIZED, 'Only the boarding manager can accept a vaccine exception.')
        auditCreate(uow, actor, 'Patient', patient.id, 'boarding.vaccine_override', { missing, staffId: staff.id }, { reason: override })
      }
      const dup = await uow.tx.boardingReservation.findFirst({ where: { patientId: patient.id, checkInOn: asDate(checkIn), status: { in: ['requested', 'confirmed', 'checked_in'] } }, select: { ref: true } })
      if (dup) throw new DomainError(Codes.GUARD_FAILED, `${patient.name} already has ${dup.ref} starting that day.`)
      await takeNights(uow, rt, nights)
      const ref = await nextReference(uow.tx, 'BRD', uow.now)
      const holdsUntil = new Date(uow.now.getTime() + HOLD_HOURS * 3_600_000)
      const row = await uow.tx.boardingReservation.create({
        data: { ref, patientId: patient.id, clientId, locationId: rt.locationId, runTypeId: rt.id, checkInOn: asDate(checkIn), checkOutOn: asDate(checkOut), status: 'requested', holdExpiresAt: holdsUntil, depositMinor: rt.depositMinor, vaccineOverrideReason: override, notes: text(args.notes ?? '', 'notes', 500, false) },
      })
      if (rt.depositMinor > ZERO) await uow.tx.deposit.create({ data: { ref: await nextReference(uow.tx, 'DEP', uow.now), clientId, reservationId: row.id, requestedMinor: rt.depositMinor, status: 'requested' } })
      auditCreate(uow, actor, 'BoardingReservation', row.id, 'boarding.requested', { ref, nights: nights.length, runType: rt.name })
      return { id: row.id, ref, status: 'requested', nights: nights.length, holdExpiresAt: holdsUntil.toISOString(), totalMinor: (rt.nightlyRateMinor * BigInt(nights.length)).toString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function confirmBoarding(_root: unknown, args: { reservationId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.confirm', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'boarding.confirm', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const r = await lockRow<any>(uow.tx, 'BoardingReservation', args.reservationId)
      if (r.status === 'requested' && r.holdExpiresAt && r.holdExpiresAt <= uow.now) {
        // The hold lapsed before anyone confirmed: it is released now, and the person is told, not given a stale booking.
        await giveBackNights(uow, r.runTypeId, nightsBetween(day(r.checkInOn), day(r.checkOutOn)))
        await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['requested'], to: 'cancelled', actor, eventType: 'boarding.hold_lapsed', data: { cancelReason: 'The hold ran out' } })
        throw new DomainError(Codes.GUARD_FAILED, 'The hold on this request ran out. Make a new booking.', { reason: 'hold_lapsed' })
      }
      const row = await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['requested'], to: 'confirmed', expectedVersion: args.expectedVersion, actor, eventType: 'boarding.confirmed', data: { holdExpiresAt: null } })
      return { id: r.id, ref: r.ref, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function cancelBoarding(_root: unknown, args: { reservationId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.cancel', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 200)
    const result = await command(context.prisma, { name: 'boarding.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const r = await lockRow<any>(uow.tx, 'BoardingReservation', args.reservationId)
      const row = await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['requested', 'confirmed'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'boarding.cancelled', reason, data: { cancelReason: reason } })
      await giveBackNights(uow, r.runTypeId, nightsBetween(day(r.checkInOn), day(r.checkOutOn)))
      return { id: r.id, ref: r.ref, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── In house ────────────────────────────────────────────────────────────────────────────────

/** Check in: the pet goes into a run, belongings are listed, the run card is written (feeding, handling, medicines, emergency contact and the spending limit). */
export async function checkInBoarding(_root: unknown, args: { reservationId: string; runId?: string | null; feeding?: string | null; handling?: string | null; medications?: string | null; emergencyContactName: string; emergencyContactPhone: string; medicalLimitMinor?: string | null; belongings?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.check_in', humanOnly: true }, args, async actor => {
    const contact = text(args.emergencyContactName, 'emergency contact', 80)
    const phone = text(args.emergencyContactPhone, 'emergency phone', 30)
    const limit = args.medicalLimitMinor ? minorText(args.medicalLimitMinor, 'spending limit', true) : ZERO
    const result = await command(context.prisma, { name: 'boarding.check_in', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const r = await lockRow<any>(uow.tx, 'BoardingReservation', args.reservationId)
      const patient = await activePatient(uow, r.patientId)
      const { on } = await locationDay(uow, r.locationId, uow.now)
      if (day(r.checkInOn) > on) throw new DomainError(Codes.GUARD_FAILED, `This stay starts on ${day(r.checkInOn)}.`)
      const missing = await missingVaccines(uow, patient.id, patient.species?.code ?? '', r.locationId, on, day(r.checkOutOn))
      if (missing.length && !r.vaccineOverrideReason) throw new DomainError(Codes.GUARD_FAILED, `${patient.name} needs current ${missing.join(', ')} vaccination before check-in.`, { reason: 'vaccines_missing', missing })
      const busy = (await uow.tx.runAssignment.findMany({ where: { endsAt: null }, select: { runId: true } })).map(a => a.runId).filter((x): x is string => !!x)
      const free = await uow.tx.run.findMany({ where: { runTypeId: r.runTypeId, status: 'available', id: args.runId ? { equals: args.runId, notIn: busy } : { notIn: busy } }, orderBy: { label: 'asc' }, take: 1, select: { id: true, label: true } })
      if (!free.length) throw new DomainError(Codes.SLOT_TAKEN, args.runId ? 'That run is not free.' : 'Every run of that size is in use right now.', { reason: 'no_free_run' })
      const run = free[0]
      const row = await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['confirmed'], to: 'checked_in', expectedVersion: args.expectedVersion, actor, eventType: 'boarding.checked_in' })
      const ref = await nextReference(uow.tx, 'STY', uow.now)
      const stay = await uow.tx.boardingStay.create({ data: { ref, reservationId: r.id, patientId: r.patientId, clientId: r.clientId, locationId: r.locationId, runId: run.id, status: 'in_house', checkedInAt: uow.now } })
      await uow.tx.runAssignment.create({ data: { stayId: stay.id, runId: run.id, startsAt: uow.now } })
      await uow.tx.runCard.create({ data: { stayId: stay.id, reservationId: r.id, feeding: text(args.feeding ?? '', 'feeding', 500, false), handling: text(args.handling ?? '', 'handling', 500, false), medications: (args.medications ?? '').trim() ? [{ note: text(args.medications, 'medicines', 500) }] : [], emergencyContactName: contact, emergencyContactPhone: phone, medicalLimitMinor: limit } })
      for (const item of (args.belongings ?? '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 30)) await uow.tx.belongingItem.create({ data: { stayId: stay.id, description: text(item, 'belonging', 120) } })
      auditCreate(uow, actor, 'BoardingStay', stay.id, 'boarding.stay_started', { ref, run: run.label, reservation: r.ref })
      return { id: stay.id, ref, run: run.label, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function moveBoardingRun(_root: unknown, args: { stayId: string; runId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.move_run', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'boarding.move_run', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const stay = await lockRow<any>(uow.tx, 'BoardingStay', args.stayId)
      if (stay.status !== 'in_house') throw new DomainError(Codes.GUARD_FAILED, 'This pet has gone home.')
      if (stay.runId === args.runId) return { id: stay.id, runId: stay.runId }
      const run = await uow.tx.run.findUnique({ where: { id: args.runId }, select: { id: true, status: true, locationId: true, label: true } })
      if (!run || run.status !== 'available' || run.locationId !== stay.locationId) throw new DomainError(Codes.GUARD_FAILED, 'That run is not available.')
      await uow.tx.runAssignment.updateMany({ where: { stayId: stay.id, endsAt: null }, data: { endsAt: uow.now } })
      await uow.tx.runAssignment.create({ data: { stayId: stay.id, runId: run.id, startsAt: uow.now } })
      await uow.tx.boardingStay.update({ where: { id: stay.id }, data: { runId: run.id, version: { increment: 1 } } })
      auditCreate(uow, actor, 'BoardingStay', stay.id, 'boarding.run_moved', { run: run.label })
      return { id: stay.id, runId: run.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

const CARE = ['fed', 'walked', 'medicated', 'played', 'cleaned', 'observation'] as const
export async function logBoardingCare(_root: unknown, args: { stayId: string; kind: string; note?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.log_care', humanOnly: true }, args, async actor => {
    const kind = pick(args.kind, CARE, 'kind of care')
    const result = await command(context.prisma, { name: 'boarding.log_care', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const stay = await lockRow<any>(uow.tx, 'BoardingStay', args.stayId)
      if (stay.status !== 'in_house') throw new DomainError(Codes.GUARD_FAILED, 'This pet has gone home.')
      const staff = await staffOf(uow, actor)
      const note = text(args.note ?? '', 'note', 300, kind === 'observation')
      const row = await uow.tx.dailyCareLog.create({ data: { stayId: stay.id, kind, note, byId: staff.id, at: uow.now } })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function returnBelonging(_root: unknown, args: { itemId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.return_belonging', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'boarding.return_belonging', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const item = await lockRow<any>(uow.tx, 'BelongingItem', args.itemId)
      if (item.returnedAt) return { id: item.id }
      if (item.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'Reload and try again.')
      await uow.tx.belongingItem.update({ where: { id: item.id }, data: { returnedAt: uow.now, version: { increment: 1 } } })
      return { id: item.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Check out. Every night of the stay becomes one charge, once (the source id is the stay and the night, and an index refuses a
 * second live charge for the same source). Nights not stayed (early pick-up) are given back to the inventory. Unreturned
 * belongings block the check-out.
 */
export async function checkOutBoarding(_root: unknown, args: { stayId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...BOARDERS], tool: 'boarding.check_out', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'boarding.check_out', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const stay = await lockRow<any>(uow.tx, 'BoardingStay', args.stayId)
      if (stay.status !== 'in_house') throw new DomainError(Codes.GUARD_FAILED, 'This pet has already gone home.')
      if (stay.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'Reload and try again.')
      const left = await uow.tx.belongingItem.count({ where: { stayId: stay.id, returnedAt: null } })
      if (left) throw new DomainError(Codes.GUARD_FAILED, `${left} ${left === 1 ? 'belonging has' : 'belongings have'} not been handed back yet.`, { reason: 'belongings' })
      const r = await lockRow<any>(uow.tx, 'BoardingReservation', stay.reservationId)
      const rt = await uow.tx.runType.findUniqueOrThrow({ where: { id: r.runTypeId } })
      const { on } = await locationDay(uow, stay.locationId, uow.now)
      const startedOn = day(stay.checkedInAt) < day(r.checkInOn) ? day(r.checkInOn) : day(stay.checkedInAt)
      const lastNight = on < day(r.checkOutOn) ? on : day(r.checkOutOn)
      // The night of the day they leave is not charged; a same-day pick-up is charged one night.
      const stayed = startedOn >= lastNight ? [startedOn] : nightsBetween(startedOn, lastNight)
      for (const night of stayed) {
        await serviceCharge(uow, actor, { unitPriceMinor: rt.nightlyRateMinor, taxCategory: 'boarding', description: `Boarding, ${rt.name}: night of ${night}`, patientId: stay.patientId, clientId: stay.clientId, locationId: stay.locationId, sourceType: 'boarding_night', sourceId: `${stay.id}:${night}` })
      }
      const unused = nightsBetween(day(r.checkInOn), day(r.checkOutOn)).filter(n => !stayed.includes(n) && n >= on)
      if (unused.length) await giveBackNights(uow, rt.id, unused)
      await uow.tx.runAssignment.updateMany({ where: { stayId: stay.id, endsAt: null }, data: { endsAt: uow.now } })
      await transition(uow, { model: 'BoardingStay', id: stay.id, from: ['in_house'], to: 'checked_out', actor, eventType: 'boarding.checked_out', data: { checkedOutAt: uow.now } })
      await transition(uow, { model: 'BoardingReservation', id: r.id, from: ['checked_in'], to: 'checked_out', actor, eventType: 'boarding.completed' })
      // The invoice: the nights stayed, less the deposit if it was paid. Made once (the stay can only be checked out once).
      const lines = await uow.tx.chargeLine.findMany({ where: { clientId: stay.clientId, invoiceId: null, reversedAt: null, sourceType: 'boarding_night', sourceId: { startsWith: `${stay.id}:` } }, select: { id: true } })
      const draft = await uow.tx.invoice.create({ data: { ref: `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`, clientId: stay.clientId, locationId: stay.locationId, status: 'draft', currencyCode: 'USD', note: '' } })
      await uow.tx.chargeLine.updateMany({ where: { id: { in: lines.map(l => l.id) } }, data: { invoiceId: draft.id } })
      const posted = await postDraftInvoice(uow, actor, draft.id, undefined)
      const deposit = await uow.tx.deposit.findFirst({ where: { reservationId: r.id, status: 'paid' }, select: { id: true } })
      const applied = deposit ? await applyDepositTo(uow, actor, deposit.id, draft.id) : null
      await uow.tx.boardingStay.update({ where: { id: stay.id }, data: { invoiceId: draft.id, version: { increment: 1 } } })
      return { id: stay.id, status: 'checked_out', nights: stayed.length, invoiceId: draft.id, invoiceRef: posted.ref, totalMinor: posted.totalMinor, depositAppliedMinor: applied?.appliedMinor ?? '0' }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Grooming ────────────────────────────────────────────────────────────────────────────────

const GROOM_SERVICES = ['bath_brush', 'full_groom', 'nail_trim', 'de_shed', 'dental_scale'] as const

export async function bookGroom(_root: unknown, args: { patientId: string; groomerId: string; startsAt: string; service: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...GROOMERS], tool: 'groom.book', humanOnly: true }, args, async actor => {
    const service = pick(args.service, GROOM_SERVICES, 'service')
    const startsAt = new Date(args.startsAt)
    if (Number.isNaN(startsAt.getTime())) throw new DomainError(Codes.INVALID_INPUT, 'Choose a start time.', { field: 'startsAt' })
    const result = await command(context.prisma, { name: 'groom.book', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      if (startsAt < new Date(uow.now.getTime() - 5 * 60_000)) throw new DomainError(Codes.INVALID_INPUT, 'That time has passed.', { field: 'startsAt' })
      const patient = await activePatient(uow, args.patientId)
      const clientId = await clientOfPatient(uow, patient.id)
      const groomer = await uow.tx.staffMember.findUnique({ where: { id: args.groomerId }, select: { id: true, kind: true, active: true, homeLocationId: true, displayName: true } })
      if (!groomer || !groomer.active || groomer.kind !== 'groomer') throw new DomainError(Codes.NOT_FOUND, 'Choose a groomer.', { field: 'groomerId' })
      const locationId = groomer.homeLocationId ?? (await uow.tx.location.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true } })).id
      const item = await uow.tx.serviceItem.findFirst({ where: { code: `GROOM-${service.toUpperCase()}`, active: true } })
      if (!item) throw new DomainError(Codes.GUARD_FAILED, 'That service has no price yet.')
      const ref = await nextReference(uow.tx, 'GRM', uow.now)
      const row = await uow.tx.groomAppointment.create({
        data: { ref, patientId: patient.id, clientId, locationId, groomerId: groomer.id, startsAt, durationMinutes: item.minutes && item.minutes > 0 ? item.minutes : 60, service, priceMinor: item.priceMinor, status: 'booked' },
      })
      auditCreate(uow, actor, 'GroomAppointment', row.id, 'groom.booked', { ref, service, groomer: groomer.displayName })
      return { id: row.id, ref, status: 'booked' }
    })
    return { replay: result.replay, ...result.value }
  })
}

const GROOM_NEXT: Record<string, string[]> = { booked: ['checked_in', 'cancelled', 'no_show'], checked_in: ['in_progress', 'cancelled'], in_progress: ['ready'], ready: ['completed'] }

export async function advanceGroom(_root: unknown, args: { groomId: string; to: string; reason?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...GROOMERS], tool: 'groom.advance', humanOnly: true }, args, async actor => {
    const to = pick(args.to, ['checked_in', 'in_progress', 'ready', 'completed', 'cancelled', 'no_show'] as const, 'step')
    const result = await command(context.prisma, { name: 'groom.advance', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const g = await lockRow<any>(uow.tx, 'GroomAppointment', args.groomId)
      if (!GROOM_NEXT[g.status]?.includes(to)) throw new DomainError(Codes.INVALID_TRANSITION, `A groom that is ${g.status.replaceAll('_', ' ')} cannot go to ${to.replaceAll('_', ' ')}.`)
      if (['cancelled', 'no_show'].includes(to)) text(args.reason ?? '', 'reason', 200)
      if (['checked_in', 'in_progress', 'ready', 'completed'].includes(to)) await activePatient(uow, g.patientId)
      const data: Record<string, unknown> = {}
      if (to === 'cancelled' || to === 'no_show') data.cancelReason = text(args.reason ?? '', 'reason', 200)
      let chargeId: string | null = null
      if (to === 'completed') {
        const line = await serviceItemCharge(uow, actor, `GROOM-${String(g.service).toUpperCase()}`, { patientId: g.patientId, clientId: g.clientId, locationId: g.locationId, performedById: g.groomerId ?? null, sourceType: 'groom', sourceId: g.id })
        chargeId = line.id
        // Commission is a plain percentage of the price kept for the groomer, on the groomer's own record; only finance can read it.
        const bps = 4000
        data.commissionBps = bps
        data.commissionMinor = (g.priceMinor * BigInt(bps)) / 10_000n
      }
      const row = await transition(uow, { model: 'GroomAppointment', id: g.id, from: Object.keys(GROOM_NEXT), to, expectedVersion: args.expectedVersion, actor, eventType: `groom.${to}`, data })
      return { id: g.id, ref: g.ref, status: row.status, chargeId }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** A new version of the pet's groom notes (blade, style, behaviour). Earlier versions stay; the appointment points at the latest. */
export async function saveGroomNote(_root: unknown, args: { patientId: string; blade?: string | null; style?: string | null; behaviour?: string | null; notes?: string | null; photoUrl?: string | null; groomId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...GROOMERS], tool: 'groom.save_note', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'groom.save_note', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await advisoryLock(uow.tx, `groom-note:${args.patientId}`)
      const patient = await activePatient(uow, args.patientId)
      const staff = await staffOf(uow, actor)
      const last = await uow.tx.groomNote.findFirst({ where: { patientId: patient.id }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } })
      const photo = (args.photoUrl ?? '').trim()
      if (photo && !/^https:\/\//.test(photo)) throw new DomainError(Codes.INVALID_INPUT, 'A photo link starts with https://', { field: 'photoUrl' })
      const note = await uow.tx.groomNote.create({ data: { patientId: patient.id, versionNo: (last?.versionNo ?? 0) + 1, blade: text(args.blade ?? '', 'blade', 40, false), style: text(args.style ?? '', 'style', 120, false), behaviour: text(args.behaviour ?? '', 'behaviour', 300, false), notes: text(args.notes ?? '', 'notes', 500, false), photoUrl: photo, byId: staff.id } })
      if (args.groomId) await uow.tx.groomAppointment.updateMany({ where: { id: args.groomId, patientId: patient.id }, data: { noteVersionId: note.id } })
      return { id: note.id, versionNo: note.versionNo }
    })
    return { replay: result.replay, ...result.value }
  })
}

export { randomUUID }
