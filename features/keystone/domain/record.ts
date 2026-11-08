import { canonicalJson, sha256 } from '../lib/canonical'

/*
 * The medical record's pure rules (DOMAIN I-R1–I-R4, STATE-MACHINES §5).
 *   - completeness: the medical_records policy lists what a signed record must hold (CA 16 CCR
 *     2032.3); each required field maps to evidence on the encounter, so the check is data-driven
 *     and a new state pack needs no code.
 *   - signing hash: the canonical content (sections, vitals, findings, diagnoses, orders and
 *     administrations) hashed with SHA-256; an addendum never changes it.
 */

export type SectionLike = { kind: string; ordinal: number; body: string; structured?: unknown }

export type EncounterEvidence = {
  kind: string
  startedAt: Date
  client: { name: string; address: string; phone: string } | null
  patient: { name: string; species: string | null; breed: string | null; ageKnown: boolean; sex: string | null; colour: string | null }
  sections: SectionLike[]
  vitalsCount: number
  findingsCount: number
  diagnosesCount: number
  medications: { description: string; dose: string | null; route: string | null; frequency: string | null; quantity: string | null }[]
  vaccines: { lotNumber: string; lotExpiresOn: string | null }[]
  anaesthesiaGiven: boolean
  anaesthesiaRecordClosed: boolean
  surgeryPerformed: boolean
  surgeryReportPresent: boolean
  signerIsDvm: boolean
}

export type CompletenessResult = { complete: boolean; missing: { field: string; message: string }[] }

const has = (sections: SectionLike[], kinds: string[]) => sections.some(s => kinds.includes(s.kind) && s.body.trim().length > 0)

/** Field → check. Unknown fields fail closed (a pack asking for something we cannot check blocks). */
const CHECKS: Record<string, (e: EncounterEvidence) => string | null> = {
  client_name_address_phone: e => (e.client && e.client.name && e.client.phone ? null : 'The client name and phone number are missing.'),
  patient_name_species_breed_age_sex_colour: e => (e.patient.name && e.patient.species ? null : 'The patient identity (name, species) is incomplete.'),
  date_of_visit: e => (e.startedAt ? null : 'The visit date is missing.'),
  history: e => (has(e.sections, ['history', 'subjective']) ? null : 'Write the history (subjective).'),
  physical_exam: e => (has(e.sections, ['objective']) || e.findingsCount > 0 || e.vitalsCount > 0 ? null : 'Record the physical exam (objective, findings or vitals).'),
  diagnosis_or_assessment: e => (has(e.sections, ['assessment']) || e.diagnosesCount > 0 ? null : 'Write the assessment or add a diagnosis.'),
  treatment_plan: e => (has(e.sections, ['plan']) ? null : 'Write the plan.'),
  medications_dose_route_frequency: e => {
    const bad = e.medications.filter(m => !m.dose || !m.route || !m.frequency)
    if (bad.length) return `Medication orders need dose, route and frequency: ${bad.map(m => m.description).join(', ')}.`
    const lots = e.vaccines.filter(v => !v.lotNumber || !v.lotExpiresOn)
    return lots.length ? 'Every vaccine needs its lot number and expiry.' : null
  },
  anaesthesia_record: e => (!e.anaesthesiaGiven || e.anaesthesiaRecordClosed ? null : 'Anaesthesia was given: close the anaesthesia record first.'),
  surgery_record: e => (!e.surgeryPerformed || e.surgeryReportPresent || has(e.sections, ['surgery_report']) ? null : 'Surgery was performed: write the surgery report.'),
  prognosis: e => (has(e.sections, ['assessment', 'plan', 'discharge']) ? null : 'State the prognosis in the assessment or plan.'),
  author_identity: e => (e.signerIsDvm ? null : 'The record must be signed by a veterinarian.'),
}

/** Encounter kinds where the exam-based fields are not expected (phone advice, imports). */
const LIGHT_KINDS = new Set(['phone_consult', 'records_import', 'tech_visit'])
const LIGHT_SKIPS = new Set(['physical_exam', 'diagnosis_or_assessment', 'prognosis'])

export function checkCompleteness(requiredFields: string[], evidence: EncounterEvidence): CompletenessResult {
  const missing: { field: string; message: string }[] = []
  for (const field of requiredFields) {
    if (LIGHT_KINDS.has(evidence.kind) && LIGHT_SKIPS.has(field)) continue
    const check = CHECKS[field]
    const message = check ? check(evidence) : `The records policy requires "${field}", which this system cannot check yet.`
    if (message) missing.push({ field, message })
  }
  return { complete: missing.length === 0, missing }
}

export const KNOWN_RECORD_FIELDS = Object.keys(CHECKS)

/** Hash of one section revision's content. */
export const revisionHash = (input: { kind: string; ordinal: number; body: string; structured?: unknown; source: string; author: string | null }) =>
  sha256(canonicalJson(input))

/** Encounter kinds that establish a VCPR when signed (in-person exams; telehealth only if the pack allows). */
export function establishesVcpr(kind: string, establishment: 'in_person_only' | 'in_person_or_telehealth') {
  if (['outpatient', 'inpatient_day', 'surgery', 'dental', 'emergency'].includes(kind)) return true
  return kind === 'telehealth' && establishment === 'in_person_or_telehealth'
}

/** Canonical signed content: what the hash covers. */
export function signedContentHash(content: unknown) {
  return sha256(canonicalJson(content))
}

export const addendumHash = (input: { encounterId: string; contentHash: string; sectionKind: string; reason: string; body: string; author: string; signedAt: Date }) =>
  sha256(canonicalJson(input))
