import { DomainError, Codes } from '../lib/errors'
import { localDate } from '../lib/calendar'
import type { Tx } from '../lib/db'
import { resolvePolicy } from './policy'

/**
 * Licence and DEA guards (I-P1, I-P2). Holding a role permission is never enough for a licensed act:
 * the actor needs an active licence of the kind the location's licensure policy names, in the
 * location's state, on the location's local date. A controlled-substance act needs a DEA
 * registration for that location, valid that day and covering the drug's schedule. Each allowed
 * check is stored as a LicenseEvaluation so the record shows which licence and registration
 * authorised it. A failed check throws and changes nothing.
 */

export type CsSchedule = 'CI' | 'CII' | 'CIIN' | 'CIII' | 'CIIIN' | 'CIV' | 'CV'
/** DEA registration schedule codes (as printed on the certificate). */
export const DEA_SCHEDULE_CODE: Record<CsSchedule, string> = { CI: '1', CII: '2', CIIN: '2N', CIII: '3', CIIIN: '3N', CIV: '4', CV: '5' }

const day = (d: Date | string | null | undefined) => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

async function locationOf(tx: Tx, locationId: string) {
  const location = await tx.location.findUnique({ where: { id: locationId }, select: { id: true, stateCode: true, timeZone: true, active: true } })
  if (!location || !location.active) throw new DomainError(Codes.NOT_FOUND, 'Location not found or inactive.', { locationId })
  return location
}

/** The DEA check-digit rule: (d1+d3+d5) + 2*(d2+d4+d6), last digit = d7. */
export function isValidDeaNumber(value: string) {
  const m = /^[A-Z][A-Z9](\d{7})$/.exec(value)
  if (!m) return false
  const d = m[1].split('').map(c => c.charCodeAt(0) - 48)
  return ((d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5])) % 10 === d[6]
}

export type LicenceCheck = { evaluationId: string; licenseId: string; policyVersionIds: string[]; onDate: string }

/** Require an active licence for a licensed action at a location. */
export async function requireLicence(tx: Tx, input: { staffMemberId: string; locationId: string; action: string; at: Date }): Promise<LicenceCheck> {
  const location = await locationOf(tx, input.locationId)
  const onDate = localDate({ timeZone: location.timeZone }, input.at)
  const policy = await resolvePolicy(tx, 'licensure', { locationId: location.id, on: onDate })
  const kinds = policy.rules.licenceKindsByAction[input.action]
  if (!kinds?.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `The licensure policy does not say who may ${input.action.replaceAll('_', ' ')}.`, { action: input.action })
  const licences = await tx.professionalLicense.findMany({
    where: { staffMemberId: input.staffMemberId, kind: { in: kinds }, ...(policy.rules.licenceMustMatchLocationState ? { stateCode: location.stateCode } : {}) },
    orderBy: { expiresOn: 'desc' },
  })
  const valid = licences.find(l => l.status === 'active' && (!l.issuedOn || day(l.issuedOn)! <= onDate) && day(l.expiresOn)! >= onDate)
  if (!valid) {
    const latest = licences[0]
    const why = !latest ? `no ${kinds.join(' or ')} licence in ${location.stateCode}` : latest.status !== 'active' ? `the ${location.stateCode} licence is ${latest.status}` : `the ${location.stateCode} licence expired on ${day(latest.expiresOn)}`
    throw new DomainError(Codes.LICENSE_INACTIVE, `This needs an active licence: ${why}.`, { action: input.action, staffMemberId: input.staffMemberId, onDate })
  }
  const evaluation = await tx.licenseEvaluation.create({
    data: {
      action: input.action, staffMemberId: input.staffMemberId, locationId: location.id, at: input.at, onDate: new Date(`${onDate}T00:00:00Z`),
      licenseId: valid.id, policyVersions: policy.versions.map(v => v.id), result: 'allowed', findings: { kinds, state: location.stateCode, verified: policy.verified },
    },
  })
  return { evaluationId: evaluation.id, licenseId: valid.id, policyVersionIds: policy.versions.map(v => v.id), onDate }
}

export type DeaCheck = { evaluationId: string; deaRegistrationId: string; registrationNumber: string; onDate: string }

/**
 * Require a DEA registration for a controlled-substance act at a location (21 CFR 1301.12: one
 * registration per location). `registrantStaffMemberId` pins the registration to a prescriber's
 * own (a CS prescription references the prescriber's registration, R§11.6).
 */
export async function requireDeaRegistration(tx: Tx, input: { locationId: string; schedule: CsSchedule; at: Date; action: string; registrantStaffMemberId?: string | null; actorStaffMemberId?: string | null }): Promise<DeaCheck> {
  const location = await locationOf(tx, input.locationId)
  const onDate = localDate({ timeZone: location.timeZone }, input.at)
  if (input.schedule === 'CI') throw new DomainError(Codes.DEA_REGISTRATION_INVALID, 'Schedule I substances have no veterinary use under a practitioner registration.')
  const code = DEA_SCHEDULE_CODE[input.schedule]
  const registrations = await tx.deaRegistration.findMany({
    where: { locationId: location.id, ...(input.registrantStaffMemberId ? { staffMemberId: input.registrantStaffMemberId } : {}) },
    orderBy: { expiresOn: 'desc' },
  })
  const covers = (r: { schedules: unknown }) => Array.isArray(r.schedules) && (r.schedules as string[]).includes(code)
  const valid = registrations.find(r => r.status === 'active' && (!r.issuedOn || day(r.issuedOn)! <= onDate) && day(r.expiresOn)! >= onDate && covers(r))
  if (!valid) {
    const latest = registrations[0]
    const why = !latest ? 'no DEA registration for this location' + (input.registrantStaffMemberId ? ' held by this prescriber' : '')
      : latest.status !== 'active' ? `the registration is ${latest.status}`
      : day(latest.expiresOn)! < onDate ? `the registration expired on ${day(latest.expiresOn)}`
      : `the registration does not cover schedule ${code}`
    throw new DomainError(Codes.DEA_REGISTRATION_INVALID, `This controlled-substance action needs a valid DEA registration: ${why}.`, { locationId: location.id, schedule: input.schedule, onDate })
  }
  const evaluation = await tx.licenseEvaluation.create({
    data: {
      action: input.action, staffMemberId: input.actorStaffMemberId ?? input.registrantStaffMemberId ?? null, locationId: location.id, at: input.at,
      onDate: new Date(`${onDate}T00:00:00Z`), deaRegistrationId: valid.id, result: 'allowed', findings: { schedule: input.schedule, code },
    },
  })
  return { evaluationId: evaluation.id, deaRegistrationId: valid.id, registrationNumber: valid.registrationNumber, onDate }
}
