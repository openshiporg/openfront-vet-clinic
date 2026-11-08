/**
 * Clinical vocabularies the screens offer as choices. They mirror the server's lists
 * (features/keystone/models/record.ts, treatment.ts); the server re-checks every value, so a
 * mismatch is refused, never stored. Screens never import the Keystone layer directly.
 */
export const ENCOUNTER_KINDS = ['outpatient', 'inpatient_day', 'surgery', 'dental', 'emergency', 'telehealth', 'phone_consult', 'euthanasia', 'tech_visit'] as const
export const SECTION_KINDS = ['subjective', 'objective', 'assessment', 'plan', 'discharge', 'communication'] as const
export const SECTION_TITLE: Record<string, string> = {
  history: 'History taken by the scribe', subjective: 'Subjective (history)', objective: 'Objective (exam)', assessment: 'Assessment', plan: 'Plan', discharge: 'Discharge',
  surgery_report: 'Surgery report', dental_chart: 'Dental chart', anaesthesia_summary: 'Anaesthesia summary', communication: 'Client communication', general: 'General',
}
export const EXAM_SYSTEMS = ['general', 'integument', 'eyes', 'ears', 'oral', 'cardiovascular', 'respiratory', 'gi', 'urogenital', 'musculoskeletal', 'neurologic', 'lymphatic'] as const
export const ROUTES = ['po', 'iv', 'im', 'sc', 'topical', 'otic', 'ophthalmic', 'inhaled', 'intranasal', 'io', 'rectal', 'transdermal', 'other'] as const
export const FREQUENCIES = ['once', 'sid', 'bid', 'tid', 'qid', 'q4h', 'q6h', 'q8h', 'q12h', 'q24h', 'prn'] as const
export const SHEET_FREQUENCIES = ['q1h', 'q2h', 'q4h', 'q6h', 'q8h', 'q12h', 'q24h', 'sid', 'bid', 'tid', 'qid', 'once', 'prn', 'cri'] as const
export const ORDER_KINDS = ['medication', 'procedure', 'treatment', 'lab', 'imaging', 'fluid', 'diet', 'nursing'] as const
export const ASA = ['I', 'II', 'III', 'IV', 'V', 'IE', 'IIE', 'IIIE', 'IVE', 'VE'] as const
export const CODE_STATUS = ['full', 'closed_chest_only', 'dnr'] as const

/** "IIIE" → "ASA III, emergency". */
export const asaText = (code: string) => `ASA ${code.replace(/E$/, '')}${code.endsWith('E') ? ', emergency' : ''}`

/** A dose warning code → the sentence the clinician reads. */
export const DOSE_WARNING: Record<string, string> = {
  weight_stale: 'The weight is older than this context allows; weigh again.',
  below_measurable: 'The volume is below what can be measured; dilute or choose another strength.',
  rounding_deviation: 'Rounding to a measurable amount changes the dose noticeably.',
  above_range: 'Above the formulary range for this species.',
  below_range: 'Below the formulary range for this species.',
  no_species_range: 'The formulary has no range for this species.',
  genetic_caution: 'Breed genetic caution (e.g. MDR1) for this drug.',
  patient_sensitivity: 'The patient has a recorded sensitivity.',
}
