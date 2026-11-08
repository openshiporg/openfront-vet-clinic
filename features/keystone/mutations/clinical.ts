import type { Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import type { UnitOfWork } from '../lib/unitOfWork'
import { localDate } from '../lib/calendar'

/** Shared lookups for the clinical commands (record, orders, treatment, vaccines). */

export type Ctx = { session: unknown; prisma: any }

export const text = (value: unknown, field: string, max = 200, required = true) => {
  const out = String(value ?? '').trim()
  if (required && !out) throw new DomainError(Codes.INVALID_INPUT, `${field} is required.`, { field })
  if (out.length > max) throw new DomainError(Codes.INVALID_INPUT, `${field} is too long.`, { field })
  return out
}

export const DECIMAL_TEXT = /^\d{1,9}(\.\d{1,6})?$/
export function decimalText(value: unknown, field: string) {
  const out = String(value ?? '').trim()
  if (!DECIMAL_TEXT.test(out)) throw new DomainError(Codes.INVALID_INPUT, `${field} is a positive number with up to 6 decimals.`, { field })
  return out
}

export type StaffRow = { id: string; kind: string; displayName: string; homeLocationId: string | null }

/** The staff member behind a signed-in user; clinical acts are always attributed to a person. */
export async function staffOf(uow: UnitOfWork, actor: Actor): Promise<StaffRow> {
  if (actor.kind !== 'user') throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, 'Clinical records are written by people.')
  const staff = await uow.tx.staffMember.findFirst({ where: { userId: actor.userId, active: true }, select: { id: true, kind: true, displayName: true, homeLocationId: true } })
  if (!staff) throw new DomainError(Codes.NOT_AUTHORIZED, 'Your user is not linked to an active staff member.')
  return staff
}

export async function staffById(uow: UnitOfWork, id: string): Promise<StaffRow> {
  const staff = await uow.tx.staffMember.findUnique({ where: { id }, select: { id: true, kind: true, displayName: true, homeLocationId: true, active: true } })
  if (!staff || !staff.active) throw new DomainError(Codes.NOT_FOUND, 'Staff member not found.')
  return staff
}

export async function activePatient(uow: UnitOfWork, patientId: string) {
  const patient = await uow.tx.patient.findUnique({
    where: { id: patientId },
    select: { id: true, ref: true, name: true, status: true, dateOfBirth: true, sex: true, codeStatus: true, speciesId: true, species: { select: { code: true, name: true } }, breed: { select: { name: true, geneticFlags: true } } },
  })
  if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
  if (patient.status === 'deceased' || patient.status === 'merged') throw new DomainError(Codes.PATIENT_DECEASED, `The patient is ${patient.status}.`)
  if (patient.status !== 'active') throw new DomainError(Codes.GUARD_FAILED, `The patient is ${patient.status}; confirm the registration first.`)
  return patient
}

export async function locationDay(uow: UnitOfWork, locationId: string, at: Date) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { id: true, timeZone: true, stateCode: true, name: true } })
  if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
  return { location, on: localDate({ timeZone: location.timeZone }, at) }
}

/** Encounter that can still be charted (not signed, not voided). */
export async function chartableEncounter(uow: UnitOfWork, encounterId: string) {
  const enc = await uow.tx.encounter.findUnique({ where: { id: encounterId }, select: { id: true, ref: true, status: true, version: true, patientId: true, locationId: true, kind: true, stayId: true, attendingDvmId: true } })
  if (!enc) throw new DomainError(Codes.NOT_FOUND, 'Encounter not found.')
  if (enc.status === 'signed') throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} is signed. Add an addendum instead.`, { reason: 'signed' })
  if (enc.status === 'voided') throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} was voided.`, { reason: 'voided' })
  return enc
}

/** First clinical entry moves an open encounter to in progress (SM§5). */
export async function markInProgress(uow: UnitOfWork, enc: { id: string; status: string }) {
  if (enc.status !== 'open') return
  await uow.tx.encounter.updateMany({ where: { id: enc.id, status: 'open' }, data: { status: 'in_progress', version: { increment: 1 } } })
}

export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** Latest weight and its age in whole hours. */
export async function latestWeight(uow: UnitOfWork, patientId: string) {
  const w = await uow.tx.weightMeasurement.findFirst({ where: { patientId }, orderBy: { measuredAt: 'desc' }, select: { id: true, valueKg: true, measuredAt: true } })
  if (!w) return null
  return { id: w.id, valueKg: w.valueKg.toString(), measuredAt: w.measuredAt, ageHours: Math.floor((uow.now.getTime() - w.measuredAt.getTime()) / 3_600_000) }
}

export async function practiceSettings(uow: UnitOfWork) {
  const row = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { weightMaxAgeHours: true, features: true, unsignedRecordTaskHours: true, unsignedRecordEscalateHours: true, medicalDirectorId: true } })
  return {
    weightMaxAgeHours: (row?.weightMaxAgeHours as Record<string, number> | null) ?? { anaesthesia: 24, inpatient: 72, outpatient: 720 },
    features: (row?.features as Record<string, boolean> | null) ?? {},
    unsignedTaskHours: row?.unsignedRecordTaskHours ?? 24,
    unsignedEscalateHours: row?.unsignedRecordEscalateHours ?? 72,
    medicalDirectorId: row?.medicalDirectorId ?? null,
  }
}
