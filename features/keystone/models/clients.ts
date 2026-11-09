import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { choice, fixedChoice, geo, lifecycle, minor, rate, readOnly, systemText, versionField, wt, WEIGHT_UNITS, hiddenHash } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/* Clients & patients (SCHEMA §2). Records are created and changed only by commands
   (mutations/clients.ts), so every change is idempotent, audited and guarded. Reads of these lists
   write ReadAudit rows (security/readAudit.ts). */

const CLIENT_READ = ['canManageClients', 'canBook', 'canReadClientPII', 'canReadClinical'] as const
const PATIENT_READ = ['canReadClinical', 'canBook', 'canManagePatients', 'canCheckIn'] as const

export const Client = list({
  access: governed([...CLIENT_READ]),
  ui: { labelField: 'displayName', listView: { initialColumns: ['ref', 'displayName', 'kind', 'status', 'primaryLocation'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    publicCode: systemText({ indexed: 'unique', nullable: true }),
    displayName: systemText({ required: true }),
    kind: fixedChoice(['individual', 'household', 'rescue', 'shelter', 'business', 'government']),
    status: lifecycle(['prospect', 'active', 'inactive', 'merged', 'closed']),
    primaryLocation: relationship({ ref: 'Location', ...readOnly }),
    addressLine1: systemText(),
    addressLine2: systemText(),
    city: systemText(),
    stateCode: systemText(),
    postalCode: systemText(),
    creditLimitMinor: minor({ defaultValue: 0n }),
    accountFlags: json({ ...readOnly, defaultValue: {}, ui: { ...readOnly.ui, description: 'collections, cashOnly, noOnlineBooking, cautionClient (staff safety).' } }),
    taxExempt: checkbox({ ...readOnly, defaultValue: false }),
    mergedInto: relationship({ ref: 'Client', ...readOnly }),
    people: relationship({ ref: 'ClientPerson.client', many: true, ...readOnly }),
    ownerships: relationship({ ref: 'PatientOwnership.client', many: true, ...readOnly }),
    source: fixedChoice(['csr', 'portal', 'ai_voice', 'ai_sms', 'import', 'walk_in']),
    version: versionField(),
    ...trackingFields,
  },
})

/** A person acting for a household, with explicit rights (I-C6). */
export const ClientPerson = list({
  access: governed([...CLIENT_READ]),
  ui: { labelField: 'lastName', listView: { initialColumns: ['firstName', 'lastName', 'client', 'relationship', 'isPrimary'] } },
  fields: {
    client: relationship({ ref: 'Client.people', ...readOnly }),
    firstName: systemText({ required: true }),
    lastName: systemText({ required: true }),
    relationship: fixedChoice(['owner', 'co_owner', 'family', 'agent', 'foster', 'shelter_staff', 'other']),
    isPrimary: checkbox({ ...readOnly, defaultValue: false }),
    canBook: checkbox({ ...readOnly, defaultValue: true }),
    canApproveTreatment: checkbox({ ...readOnly, defaultValue: false }),
    canReceiveRecords: checkbox({ ...readOnly, defaultValue: false }),
    canPay: checkbox({ ...readOnly, defaultValue: true }),
    canAuthoriseEuthanasia: checkbox({ ...readOnly, defaultValue: false }),
    dateOfBirth: calendarDay({ ...readOnly }),
    preferredLanguage: systemText(),
    user: relationship({ ref: 'User', ...readOnly }),
    identityVerifiedAt: timestamp({ ...readOnly }),
    contactPoints: relationship({ ref: 'ContactPoint.person', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const ContactPoint = list({
  access: governed([...CLIENT_READ]),
  ui: { labelField: 'value', listView: { initialColumns: ['person', 'kind', 'value', 'status', 'canText'] } },
  fields: {
    person: relationship({ ref: 'ClientPerson.contactPoints', ...readOnly }),
    kind: fixedChoice(['mobile', 'landline', 'email']),
    value: systemText({ required: true }),
    /** Hash of the normalised value: duplicate detection and caller lookup. Server-only (a phone number is guessable). */
    valueHash: hiddenHash({ indexed: true, required: true }),
    isPrimary: checkbox({ ...readOnly, defaultValue: false }),
    verifiedAt: timestamp({ ...readOnly }),
    canText: checkbox({ ...readOnly, defaultValue: false }),
    status: lifecycle(['active', 'invalid', 'ported']),
    consents: relationship({ ref: 'ConsentRecord.contactPoint', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Consent grants and revocations, append-only. Effective consent = the latest row per (contact point, purpose). */
export const ConsentRecord = list({
  access: immutable([...CLIENT_READ]),
  ui: { listView: { initialColumns: ['contactPoint', 'purpose', 'action', 'method', 'at'] } },
  fields: {
    contactPoint: relationship({ ref: 'ContactPoint.consents', ...readOnly }),
    purpose: fixedChoice(['care', 'transactional', 'marketing', 'ai_voice', 'recording']),
    action: fixedChoice(['grant', 'revoke']),
    method: fixedChoice(['web_form', 'sms_keyword', 'verbal_recorded', 'paper', 'portal', 'import', 'staff_entry']),
    evidence: relationship({ ref: 'Document', ...readOnly }),
    callRecord: relationship({ ref: 'CallRecord', ...readOnly }),
    keyword: systemText(),
    capturedByUser: relationship({ ref: 'User', ...readOnly }),
    capturedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

export const Species = list({
  access: managed('signedIn', 'canManagePractice'),
  graphql: { plural: 'SpeciesList' },
  ui: { labelField: 'name' },
  fields: {
    code: text({ isIndexed: 'unique', validation: { isRequired: true, match: { regex: /^[a-z_]{2,40}$/ } } }),
    name: text({ validation: { isRequired: true } }),
    module: choice(['companion', 'equine', 'food_animal'], 'companion'),
    defaultWeightUnit: choice(WEIGHT_UNITS, 'kg'),
    vitalsReference: json({ ui: { description: 'Reference ranges: {"hr":[60,140],"rr":[10,30],"tempC":["37.5","39.2"]}' } }),
    breeds: relationship({ ref: 'Breed.species', many: true }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const Breed = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'species', 'sizeClass'] } },
  fields: {
    species: relationship({ ref: 'Species.breeds' }),
    name: text({ validation: { isRequired: true } }),
    registryCode: text(),
    sizeClass: choice(['toy', 'small', 'medium', 'large', 'giant'], null),
    geneticFlags: json({ ui: { description: 'e.g. {"MDR1_risk": true} for herding breeds.' } }),
    ...trackingFields,
  },
})

export const ColourMarking = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name' },
  fields: { species: relationship({ ref: 'Species' }), name: text({ validation: { isRequired: true } }), ...trackingFields },
})

export const Patient = list({
  access: governed([...PATIENT_READ]),
  ui: { labelField: 'name', listView: { initialColumns: ['ref', 'name', 'species', 'breed', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(['individual', 'group']),
    species: relationship({ ref: 'Species', ...readOnly }),
    breed: relationship({ ref: 'Breed', ...readOnly }),
    secondaryBreed: relationship({ ref: 'Breed', ...readOnly }),
    sex: fixedChoice(['male', 'female', 'unknown']),
    reproductiveStatus: fixedChoice(['intact', 'neutered', 'spayed', 'unknown']),
    dateOfBirth: calendarDay({ ...readOnly }),
    dobEstimated: checkbox({ ...readOnly, defaultValue: false }),
    colourMarkings: systemText(),
    status: lifecycle(['pending', 'active', 'inactive', 'deceased', 'merged']),
    deceasedAt: timestamp({ ...readOnly }),
    codeStatus: fixedChoice(['unspecified', 'full', 'closed_chest_only', 'dnr']),
    preferredDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    groupSize: integer({ ...readOnly }),
    mergedInto: relationship({ ref: 'Patient', ...readOnly }),
    photo: relationship({ ref: 'Document', ...readOnly }),
    ownerships: relationship({ ref: 'PatientOwnership.patient', many: true, ...readOnly }),
    alerts: relationship({ ref: 'PatientAlert.patient', many: true, ...readOnly }),
    weights: relationship({ ref: 'WeightMeasurement.patient', many: true, ...readOnly }),
    microchips: relationship({ ref: 'Microchip.patient', many: true, ...readOnly }),
    vcprs: relationship({ ref: 'VcprRecord.patient', many: true, ...readOnly }),
    insurancePolicies: relationship({ ref: 'PetInsurancePolicy.patient', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Ownership history. One open primary owner per patient (partial unique + exclusion constraint). */
export const PatientOwnership = list({
  access: governed([...PATIENT_READ]),
  ui: { listView: { initialColumns: ['patient', 'client', 'role', 'effectiveFrom', 'effectiveTo'] } },
  fields: {
    patient: relationship({ ref: 'Patient.ownerships', ...readOnly }),
    client: relationship({ ref: 'Client.ownerships', ...readOnly }),
    role: fixedChoice(['primary', 'co_owner', 'foster', 'boarding_custodian']),
    effectiveFrom: timestamp({ ...readOnly, validation: { isRequired: true } }),
    effectiveTo: timestamp({ ...readOnly }),
    basis: fixedChoice(['registration', 'transfer_signed', 'adoption', 'shelter_transfer', 'court', 'import']),
    evidence: relationship({ ref: 'Document', ...readOnly }),
    recordedBy: relationship({ ref: 'User', ...readOnly }),
    ...trackingFields,
  },
})

/** Weights are immutable (I-C4): the value as entered, its unit, and the exact kilogram value. */
export const WeightMeasurement = list({
  access: immutable([...PATIENT_READ]),
  ui: { listView: { initialColumns: ['patient', 'value', 'unit', 'valueKg', 'method', 'measuredAt'] } },
  fields: {
    patient: relationship({ ref: 'Patient.weights', ...readOnly }),
    value: wt({ required: true }),
    unit: fixedChoice(WEIGHT_UNITS),
    valueKg: wt({ required: true }),
    method: fixedChoice(['scale', 'owner_reported', 'estimate', 'carried_over']),
    bodyConditionScore: integer({ ...readOnly, validation: { min: 1, max: 9 } }),
    measuredAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    measuredBy: relationship({ ref: 'StaffMember', ...readOnly }),
    appointment: relationship({ ref: 'Appointment', ...readOnly }),
    ...trackingFields,
  },
})

export const PatientAlert = list({
  access: governed([...PATIENT_READ]),
  ui: { labelField: 'text', listView: { initialColumns: ['patient', 'kind', 'severity', 'text', 'active'] } },
  fields: {
    patient: relationship({ ref: 'Patient.alerts', ...readOnly }),
    kind: fixedChoice(['behaviour_caution', 'allergy', 'drug_sensitivity', 'medical', 'genetic', 'handling', 'financial', 'deceased_sibling_note']),
    severity: fixedChoice(['info', 'warn', 'block']),
    text: systemText({ required: true }),
    active: checkbox({ ...readOnly, defaultValue: true }),
    createdBy: relationship({ ref: 'User', ...readOnly }),
    acknowledgements: relationship({ ref: 'AlertAcknowledgement.alert', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Who acknowledged an alert, when (check-in requires it). Append-only. */
export const AlertAcknowledgement = list({
  access: immutable([...PATIENT_READ]),
  fields: {
    alert: relationship({ ref: 'PatientAlert.acknowledgements', ...readOnly }),
    user: relationship({ ref: 'User', ...readOnly }),
    appointment: relationship({ ref: 'Appointment', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

export const Microchip = list({
  access: governed([...PATIENT_READ]),
  ui: { labelField: 'number', listView: { initialColumns: ['number', 'patient', 'standard', 'registry', 'active'] } },
  fields: {
    patient: relationship({ ref: 'Patient.microchips', ...readOnly }),
    number: systemText({ indexed: true, required: true }),
    standard: fixedChoice(['iso_11784', 'avid_9', 'avid_10', 'other']),
    implantedOn: calendarDay({ ...readOnly }),
    registry: systemText(),
    registeredToClient: checkbox({ ...readOnly, defaultValue: false }),
    active: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

/**
 * Veterinarian-client-patient relationship (I-C5; SM§2). Created only by signing a qualifying
 * encounter (Phase 2) or by an import with evidence; never by an agent.
 */
export const VcprRecord = list({
  access: governed(['canReadClinical', 'canBook', 'canCheckIn']),
  ui: { listView: { initialColumns: ['patient', 'dvm', 'scope', 'status', 'establishedAt', 'expiresAt'] } },
  fields: {
    patient: relationship({ ref: 'Patient.vcprs', ...readOnly }),
    scope: fixedChoice(['dvm', 'practice']),
    dvm: relationship({ ref: 'StaffMember', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    establishedByRef: systemText(),
    establishedVia: fixedChoice(['encounter', 'import']),
    establishedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    expiresAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['active', 'expired', 'terminated']),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    terminatedReason: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** Pet insurers and financing (manual adapter first; INTEGRATIONS §6). */
export const ThirdPartyPayer = list({
  access: managed('canAccessDashboard', 'canManagePractice'),
  ui: { labelField: 'name' },
  fields: {
    name: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
    kind: choice(['insurer', 'financing', 'shelter_program', 'employer'], 'insurer'),
    directPay: checkbox({ defaultValue: false }),
    phone: text(),
    claimsEmail: text(),
    portalUrl: text(),
    adapterKey: text({ defaultValue: 'manual' }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const PetInsurancePolicy = list({
  access: governed([...PATIENT_READ]),
  fields: {
    patient: relationship({ ref: 'Patient.insurancePolicies', ...readOnly }),
    insurer: relationship({ ref: 'ThirdPartyPayer', ...readOnly }),
    policyNumber: systemText({ required: true }),
    plan: systemText(),
    deductibleMinor: minor(),
    reimbursementRate: rate(),
    effectiveFrom: calendarDay({ ...readOnly }),
    effectiveTo: calendarDay({ ...readOnly }),
    directPayEligible: checkbox({ ...readOnly, defaultValue: false }),
    clientAuthorisation: relationship({ ref: 'Document', ...readOnly }),
    ...trackingFields,
  },
})

/** Emergency and specialty hospitals: triage ER referral and records sending. */
export const ReferralHospital = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'kind', 'phone', 'open24h', 'active'] } },
  fields: {
    name: text({ validation: { isRequired: true } }),
    kind: choice(['emergency', 'specialty', 'general'], 'emergency'),
    phone: text({ validation: { isRequired: true } }),
    fax: text(),
    email: text(),
    addressLine1: text(),
    city: text(),
    stateCode: text(),
    lat: geo(),
    lng: geo(),
    open24h: checkbox({ defaultValue: false }),
    hours: json({ ui: { description: 'Per weekday open/close "HH:mm" when not 24h.' } }),
    verifiedChannel: checkbox({ defaultValue: false }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const ReferringVet = list({
  access: managed('signedIn', 'canManageClients'),
  ui: { labelField: 'name' },
  fields: {
    name: text({ validation: { isRequired: true } }),
    clinicName: text(),
    phone: text(),
    fax: text(),
    email: text(),
    verifiedChannel: checkbox({ defaultValue: false }),
    ...trackingFields,
  },
})

/**
 * A refill request (intake). Phase 1 takes requests from staff, the portal and the AI receptionist;
 * the decision (I-RX2) is the DVM's and arrives with the pharmacy in Phase 3.
 */
export const RefillRequest = list({
  access: governed(['canReadClinical', 'canManageRefills', 'canFulfilRefill', 'canBook']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'productText', 'channel', 'status', 'slaDueAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    requestedBy: relationship({ ref: 'ClientPerson', ...readOnly }),
    channel: fixedChoice(['portal', 'csr', 'ai_voice', 'ai_sms', 'online_pharmacy', 'retail_pharmacy', 'email']),
    productText: systemText({ required: true }),
    pharmacyNote: systemText(),
    status: lifecycle(['received', 'in_review', 'fulfilled_under_existing_rx', 'approved_new_rx', 'denied', 'needs_exam', 'merged']),
    slaDueAt: timestamp({ ...readOnly }),
    decidedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    decidedAt: timestamp({ ...readOnly }),
    denialReason: systemText(),
    callRecord: relationship({ ref: 'CallRecord', ...readOnly }),
    createdByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const RecordsRequest = list({
  access: governed(['canProcessRecordsRequests', 'canReadClinical']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'requesterKind', 'basis', 'status', 'responseDueAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    requesterKind: fixedChoice(['client_person', 'clinic', 'insurer', 'court', 'public_health', 'other']),
    requesterName: systemText({ required: true }),
    requesterContact: systemText(),
    requestedBy: relationship({ ref: 'ClientPerson', ...readOnly }),
    channel: fixedChoice(['portal', 'csr', 'ai_voice', 'email', 'fax', 'mail']),
    basis: fixedChoice(['client_of_record', 'authorised_person', 'referral_with_authorisation', 'insurer_with_authorisation', 'court_order', 'subpoena', 'public_health']),
    scope: systemText(),
    authorisationDocument: relationship({ ref: 'Document', ...readOnly }),
    status: lifecycle(['received', 'verifying_authority', 'approved', 'released', 'denied', 'withdrawn']),
    responseDueAt: timestamp({ ...readOnly }),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    callRecord: relationship({ ref: 'CallRecord', ...readOnly }),
    createdByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    releases: relationship({ ref: 'RecordsRelease.request', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** What was released, to whom, with document hashes. Append-only. */
export const RecordsRelease = list({
  access: immutable(['canProcessRecordsRequests', 'canReadAudit']),
  fields: {
    request: relationship({ ref: 'RecordsRequest.releases', ...readOnly }),
    recipient: systemText({ required: true }),
    channel: fixedChoice(['email', 'portal', 'fax', 'mail', 'in_person']),
    documents: json({ ...readOnly, ui: { ...readOnly.ui, description: '[{documentId, sha256, title}]' } }),
    releasedByUser: relationship({ ref: 'User', ...readOnly }),
    releasedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})
