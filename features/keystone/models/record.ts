import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { choice, fixedChoice, lifecycle, qty, rate, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * The medical record (SCHEMA §4, STATE-MACHINES §5, DOMAIN I-R1–I-R5). Ported from the hospital
 * vertical's Encounter / ClinicalDocument shape and made veterinary: one record per visit, edited
 * section by section with compare-and-set (two people can chart the same visit; a stale write is
 * refused, never merged silently), frozen and hashed when a DVM signs it, and corrected afterwards
 * only by addenda. The database refuses edits to a signed record whatever the application does
 * (migrations/…_vet_clinic_phase2_guards). Every read writes a ReadAudit row (security/readAudit.ts).
 */

const CLINICAL_READ = ['canReadClinical'] as const

export const ENCOUNTER_KINDS = ['outpatient', 'inpatient_day', 'surgery', 'dental', 'emergency', 'telehealth', 'phone_consult', 'records_import', 'euthanasia', 'tech_visit'] as const
export const SECTION_KINDS = ['history', 'subjective', 'objective', 'assessment', 'plan', 'discharge', 'surgery_report', 'dental_chart', 'anaesthesia_summary', 'communication'] as const
/** Sections that can appear more than once on one record (each gets the next ordinal). */
export const REPEATABLE_SECTIONS = ['communication'] as const

export const Encounter = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'kind', 'status', 'attendingDvm', 'startedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    appointment: relationship({ ref: 'Appointment', ...readOnly }),
    stay: relationship({ ref: 'HospitalStay', ...readOnly }),
    kind: fixedChoice(ENCOUNTER_KINDS),
    vcprQualifying: checkbox({ ...readOnly, defaultValue: false }),
    status: lifecycle(['open', 'in_progress', 'pending_signature', 'signed', 'voided']),
    reason: systemText(),
    attendingDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    participants: relationship({ ref: 'StaffMember', many: true, ...readOnly }),
    weightUsed: relationship({ ref: 'WeightMeasurement', ...readOnly }),
    startedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    submittedAt: timestamp({ ...readOnly }),
    signedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    signedAt: timestamp({ ...readOnly }),
    contentHash: systemText(),
    signedContent: json({ ...readOnly, ui: { ...readOnly.ui, description: 'The canonical content that was hashed at signing (sections, vitals, findings, diagnoses, orders, administrations).' } }),
    licenseEvaluation: relationship({ ref: 'LicenseEvaluation', ...readOnly }),
    vcpr: relationship({ ref: 'VcprRecord', ...readOnly }),
    document: relationship({ ref: 'ClinicalDocument', ...readOnly }),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    completeness: json({ ...readOnly, ui: { ...readOnly.ui, description: 'The last required-fields check against the medical_records policy (I-R4).' } }),
    voidReason: systemText(),
    voidApproval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    importedFrom: systemText(),
    sections: relationship({ ref: 'SoapSection.encounter', many: true, ...readOnly }),
    addenda: relationship({ ref: 'Addendum.encounter', many: true, ...readOnly }),
    vitals: relationship({ ref: 'VitalsObservation.encounter', many: true, ...readOnly }),
    findings: relationship({ ref: 'PhysicalExamFinding.encounter', many: true, ...readOnly }),
    diagnoses: relationship({ ref: 'Diagnosis.encounter', many: true, ...readOnly }),
    orders: relationship({ ref: 'ClinicalOrder.encounter', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const SoapSection = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['encounter', 'kind', 'ordinal', 'version', 'lockedAt'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter.sections', ...readOnly }),
    kind: fixedChoice(SECTION_KINDS),
    ordinal: integer({ ...readOnly, defaultValue: 1, validation: { isRequired: true } }),
    body: systemText(),
    structured: json({ ...readOnly }),
    source: fixedChoice(['typed', 'template', 'scribe', 'import']),
    lastAuthor: relationship({ ref: 'StaffMember', ...readOnly }),
    revisions: relationship({ ref: 'SoapSectionRevision.section', many: true, ...readOnly }),
    lockedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Every save of a section, kept forever (append-only): who wrote what, from where, when. */
export const SoapSectionRevision = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['section', 'source', 'author', 'at'] } },
  fields: {
    section: relationship({ ref: 'SoapSection.revisions', ...readOnly }),
    revisionNumber: integer({ ...readOnly, validation: { isRequired: true } }),
    body: systemText(),
    structured: json({ ...readOnly }),
    source: fixedChoice(['typed', 'template', 'scribe', 'import']),
    template: relationship({ ref: 'RecordTemplate', ...readOnly }),
    scribeDraft: relationship({ ref: 'ScribeDraft', ...readOnly }),
    author: relationship({ ref: 'StaffMember', ...readOnly }),
    authorUser: relationship({ ref: 'User', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    contentHash: systemText({ required: true }),
  },
})

/** A correction or late entry on a signed record (I-R1). The signed hash never changes. */
export const Addendum = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['encounter', 'sectionKind', 'author', 'signedAt'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter.addenda', ...readOnly }),
    sectionKind: fixedChoice([...SECTION_KINDS, 'general']),
    author: relationship({ ref: 'StaffMember', ...readOnly }),
    authorIsDvm: checkbox({ ...readOnly, defaultValue: false }),
    reason: systemText({ required: true }),
    body: systemText({ required: true }),
    signedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    hash: systemText({ required: true }),
  },
})

export const VitalsObservation = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['encounter', 'temperature', 'heartRate', 'respRate', 'painScore', 'at'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter.vitals', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    temperature: qty(),
    temperatureUnit: choice(['F', 'C'], 'F'),
    heartRate: integer({ ...readOnly }),
    respRate: integer({ ...readOnly }),
    mucousMembranes: choice(['pink', 'pale', 'white', 'cyanotic', 'icteric', 'injected', 'brick_red', 'not_assessed'], null),
    crtSeconds: qty(),
    painScore: integer({ ...readOnly }),
    bodyConditionScore: integer({ ...readOnly }),
    mentation: choice(['bar', 'qar', 'dull', 'obtunded', 'stuporous', 'comatose'], null),
    hydrationPct: qty(),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
  },
})

export const EXAM_SYSTEMS = ['general', 'integument', 'eyes', 'ears', 'oral', 'cardiovascular', 'respiratory', 'gi', 'urogenital', 'musculoskeletal', 'neurologic', 'lymphatic'] as const

export const PhysicalExamFinding = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['encounter', 'system', 'status', 'text'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter.findings', ...readOnly }),
    system: fixedChoice(EXAM_SYSTEMS),
    status: fixedChoice(['normal', 'abnormal', 'not_examined']),
    text: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Coded terms: the practice's own list, with VeNom/SNOMED-vet imported where licensed. */
export const DiagnosisCode = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'term', listView: { initialColumns: ['codeSystem', 'code', 'term', 'active'] } },
  fields: {
    codeSystem: choice(['practice', 'venomcode', 'snomed_vet'], 'practice'),
    code: text({ validation: { isRequired: true } }),
    term: text({ validation: { isRequired: true } }),
    species: relationship({ ref: 'Species', many: true }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** The patient's problem list: lives across visits. */
export const Problem = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'term', listView: { initialColumns: ['patient', 'term', 'status', 'chronic', 'onset'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    code: relationship({ ref: 'DiagnosisCode', ...readOnly }),
    term: systemText({ required: true }),
    status: lifecycle(['active', 'resolved', 'inactive']),
    chronic: checkbox({ ...readOnly, defaultValue: false }),
    onset: calendarDay({ ...readOnly }),
    resolvedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** A diagnosis made at one visit, with how sure the clinician is. */
export const Diagnosis = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'term', listView: { initialColumns: ['encounter', 'term', 'certainty'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter.diagnoses', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    code: relationship({ ref: 'DiagnosisCode', ...readOnly }),
    term: systemText({ required: true }),
    certainty: fixedChoice(['presumptive', 'differential', 'confirmed', 'ruled_out']),
    problem: relationship({ ref: 'Problem', ...readOnly }),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    ...trackingFields,
  },
})

export const ClinicalAttachment = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'caption' },
  fields: {
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    kind: fixedChoice(['photo', 'radiograph', 'ultrasound', 'lab_pdf', 'external_record', 'audio', 'other']),
    caption: systemText(),
    document: relationship({ ref: 'Document', ...readOnly }),
    addedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    ...trackingFields,
  },
})

export const ClinicalDocument = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'title', listView: { initialColumns: ['patient', 'kind', 'title', 'status', 'createdAt'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    kind: fixedChoice(['encounter_record', 'discharge', 'rabies_certificate', 'health_certificate', 'estimate', 'consent', 'lab_report', 'imaging_report', 'referral_letter', 'records_bundle', 'cs_count', 'form41_packet', 'form106_packet', 'claim_packet', 'imported_record']),
    title: systemText({ required: true }),
    status: lifecycle(['pending_render', 'rendered', 'failed']),
    sourceType: systemText(),
    sourceId: systemText({ indexed: true }),
    sourceHash: systemText(),
    document: relationship({ ref: 'Document', ...readOnly }),
    signedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    renderedAt: timestamp({ ...readOnly }),
    // The rendered document (database store, the default; an object-store adapter keeps only the
    // key). Deterministic from the frozen source, so sha256 proves it was not altered.
    mimeType: systemText(),
    body: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    sha256: systemText(),
    renderError: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const RecordTemplate = list({
  access: managed('canReadClinical', 'canManagePractice'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'kind', 'sectionKind', 'active'] } },
  fields: {
    name: text({ validation: { isRequired: true } }),
    kind: choice(['wellness', 'sick', 'recheck', 'surgery', 'dental', 'euthanasia', 'discharge', 'phone'], 'wellness'),
    sectionKind: choice([...SECTION_KINDS], 'objective'),
    species: relationship({ ref: 'Species' }),
    body: text({ ui: { displayMode: 'textarea' } }),
    templateVersion: integer({ defaultValue: 1 }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** Practice shorthand ("WNL" → "within normal limits"), expanded when shown, never rewritten in the record. */
export const Glossary = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'term' },
  fields: {
    term: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
    expansion: text({ validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/**
 * Ambient scribe (INTEGRATIONS §8, I-R3): the room's audio becomes a transcript, the transcript a
 * draft per section, and nothing reaches the record until a person accepts it. Recording needs the
 * consent of everyone in the room where the contact pack says all-party (California).
 */
export const ScribeSession = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['encounter', 'status', 'transcriptionProvider', 'modelProvider', 'createdAt'] } },
  fields: {
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    startedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    startedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    clientConsent: relationship({ ref: 'ConsentRecord', ...readOnly }),
    staffAcknowledged: checkbox({ ...readOnly, defaultValue: false }),
    audioDocument: relationship({ ref: 'Document', ...readOnly }),
    audioDeleteAfter: timestamp({ ...readOnly }),
    transcriptRef: systemText(),
    transcript: systemText(),
    transcriptionProvider: systemText(),
    modelProvider: systemText(),
    modelRef: systemText(),
    status: lifecycle(['recording', 'transcribing', 'drafted', 'accepted', 'discarded']),
    drafts: relationship({ ref: 'ScribeDraft.session', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const ScribeDraft = list({
  access: governed([...CLINICAL_READ]),
  fields: {
    session: relationship({ ref: 'ScribeSession.drafts', ...readOnly }),
    sections: json({ ...readOnly, ui: { ...readOnly.ui, description: '[{ kind, body, evidence: [transcript spans] }]' } }),
    suggestedCharges: json({ ...readOnly }),
    confidence: rate(),
    modelRef: systemText(),
    acceptedBlocks: json({ ...readOnly }),
    status: lifecycle(['proposed', 'partly_accepted', 'accepted', 'rejected']),
    decidedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    decidedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Referral = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['patient', 'direction', 'hospital', 'urgency', 'status'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    direction: fixedChoice(['outbound', 'inbound']),
    hospital: relationship({ ref: 'ReferralHospital', ...readOnly }),
    referringVet: relationship({ ref: 'ReferringVet', ...readOnly }),
    reason: systemText({ required: true }),
    urgency: fixedChoice(['emergency', 'urgent', 'routine']),
    recordsRelease: relationship({ ref: 'RecordsRelease', ...readOnly }),
    status: lifecycle(['draft', 'sent', 'accepted', 'seen', 'report_received', 'closed']),
    createdBy: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})
