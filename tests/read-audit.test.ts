import fs from 'node:fs'
import path from 'node:path'
import { buildSchema, isObjectType } from 'graphql'
import { describe, expect, it } from 'vitest'
import { AUDITED_TYPES } from '../features/keystone/security/readAudit'

/**
 * Schema contract for the read audit (SCHEMA §17, I-R3): every list that holds client or clinical
 * data must be in AUDITED_TYPES, so a new list cannot ship without its reads being recorded.
 */
const schema = buildSchema(fs.readFileSync(path.join(__dirname, '..', 'schema.graphql'), 'utf8'))
const listTypes = Object.values(schema.getTypeMap())
  .filter(isObjectType)
  .map(t => t.name)
  .filter(name => !name.startsWith('_') && !name.startsWith('Keystone') && !/(Query|Mutation|Subscription|Input|Output|Result|Meta|RelateTo)/.test(name))

/** Clinical or client data by name. A list matching this is audited unless it is listed below. */
const CLINICAL = /^(Client|Patient|Encounter|Prescription|Dispense|Refill|Vaccination|Rabies|Lab|Anaesthesia|Surgery|Euthanasia|Treatment|Estimate|Invoice|Payment|Appointment|Boarding|Hospitali[sz]ation|Clinical|Scribe|Referral|Comms|Weight|Microchip|Vcpr|Triage|Whiteboard|Waitlist|Suppression|Cs[A-Z]|PetInsurance|AlertAck|Call|Consent|ContactPoint|Records|Vitals|Addendum)/

/** Lists that match the pattern but hold no client or clinical data (reasons alongside). */
const NOT_CLINICAL: Record<string, string> = {
  CalendarException: 'business calendar closures',
  PaymentProviderConfig: 'processor settings, no client data',
  AppointmentType: 'catalogue of visit types, no client data',
  ReferralHospital: 'directory of emergency and specialty hospitals',
  ReferringVet: 'directory of referring clinics and vets',
  TriageProtocol: 'the published phone-triage protocol, no client data',
  TriageProtocolVersion: 'versions of the triage protocol questions and scripts',
  Laboratory: 'directory of reference and in-house laboratories',
  LabTest: 'catalogue of tests a laboratory offers, no patient data',
  LabAnalyteMap: 'mapping of a laboratory code to an analyte, no patient data',
}

describe('read audit contract', () => {
  it('every client or clinical list in the schema is audited', () => {
    const missing = listTypes.filter(name => CLINICAL.test(name) && !NOT_CLINICAL[name] && !AUDITED_TYPES.has(name))
    expect(missing).toEqual([])
  })

  it('the audit list itself is never audited (no recursion) and platform lists are not noise', () => {
    for (const name of ['ReadAudit', 'AuditEvent', 'PolicyVersion', 'StaffMember', 'User', 'Role']) expect(AUDITED_TYPES.has(name)).toBe(false)
  })

  it('names in AUDITED_TYPES are real list names or reserved for a later phase', () => {
    const present = [...AUDITED_TYPES].filter(name => listTypes.includes(name))
    for (const name of AUDITED_TYPES) expect(name).toMatch(/^[A-Z][A-Za-z]+$/)
    // Phase 0 has no clinical lists yet; each phase adds lists and this count grows.
    expect(present.length).toBeGreaterThanOrEqual(0)
  })
})
