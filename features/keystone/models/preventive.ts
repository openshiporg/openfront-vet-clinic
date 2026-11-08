import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, relationship, text, timestamp } from '@keystone-6/core/fields'
import { choice, fixedChoice, lifecycle, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Preventive care (SCHEMA §6, STATE-MACHINES §18, DOMAIN I-V1–I-V3): vaccines, the rabies
 * certificate, reminder protocols and the patient reminders they drive. Intervals are not code:
 * they live in a published ReminderProtocolVersion (with sources and a verified flag) capped by the
 * jurisdiction's rabies policy. A reminder is satisfied by a qualifying administration, service or
 * external evidence, once per source.
 */

const CLINICAL_READ = ['canReadClinical'] as const
const REMINDER_READ = ['canReadClinical', 'canBook', 'canMessageClients'] as const

export const VaccineProduct = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'manufacturer', 'isRabies', 'licensedDoiMonths', 'minAgeWeeks', 'active'] } },
  fields: {
    name: text({ validation: { isRequired: true } }),
    manufacturer: text({ validation: { isRequired: true } }),
    antigens: json({ defaultValue: [], ui: { description: 'e.g. ["rabies"] or ["CDV","CAV2","CPV","CPiV"].' } }),
    species: relationship({ ref: 'Species', many: true }),
    licensedDoiMonths: integer({ validation: { isRequired: true, min: 1, max: 48 }, defaultValue: 12 }),
    minAgeWeeks: integer({ validation: { isRequired: true, min: 4, max: 52 }, defaultValue: 8 }),
    isRabies: checkbox({ defaultValue: false }),
    usdaProductCode: text(),
    defaultRoute: choice(['sc', 'im', 'intranasal', 'po', 'transdermal'], 'sc'),
    reminderType: relationship({ ref: 'ReminderType' }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const VaccineAdministration = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['patient', 'product', 'lotNumber', 'administeredOn', 'dueNextOn', 'vaccinatedBy'] } },
  fields: {
    administration: relationship({ ref: 'Administration', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    product: relationship({ ref: 'VaccineProduct', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    lotNumber: systemText({ required: true }),
    lotExpiresOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    doseSeries: integer({ ...readOnly, validation: { isRequired: true } }),
    isInitialSeries: checkbox({ ...readOnly, defaultValue: false }),
    route: fixedChoice(['sc', 'im', 'intranasal', 'po', 'transdermal']),
    site: systemText({ required: true }),
    administeredOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    durationMonths: integer({ ...readOnly, validation: { isRequired: true } }),
    dueNextOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    vaccinatedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    supervisingDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    policyVersions: json({ ...readOnly }),
    certificate: relationship({ ref: 'RabiesCertificate', ...readOnly }),
    source: fixedChoice(['administered', 'import', 'external_evidence', 'reversal']),
    /** M5: a reversal is a new row pointing at the dose it cancels (append-only, DVM, with a reason). */
    reverses: relationship({ ref: 'VaccineAdministration', ...readOnly }),
    reason: systemText(),
  },
})

/** NASPHV Form 51-equivalent, generated from the administration; never typed separately (I-V2). */
export const RabiesCertificate = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'vaccinatedOn', 'nextDueOn', 'tagNumber'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    ownerSnapshot: json({ ...readOnly }),
    patientSnapshot: json({ ...readOnly }),
    vaccineSnapshot: json({ ...readOnly }),
    vetSnapshot: json({ ...readOnly }),
    vaccinatedOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    durationMonths: integer({ ...readOnly, validation: { isRequired: true } }),
    nextDueOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    tagNumber: systemText(),
    tagJurisdiction: systemText(),
    fields: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Every certificate field the rabies policy requires, by name.' } }),
    missingFields: json({ ...readOnly, defaultValue: [] }),
    document: relationship({ ref: 'ClinicalDocument', ...readOnly }),
    reportedTo: fixedChoice(['none', 'county', 'city']),
    reportedAt: timestamp({ ...readOnly }),
    policyVersions: json({ ...readOnly }),
    /** Set when the vaccine it certifies is reversed; a void certificate is kept, never deleted. */
    voidedAt: timestamp({ ...readOnly }),
    voidReason: systemText(),
    ...trackingFields,
  },
})

export const ReminderType = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name' },
  fields: {
    code: text({ isIndexed: 'unique', validation: { isRequired: true, match: { regex: /^[A-Z0-9_]{2,32}$/, explanation: 'Capital letters, digits and underscores.' } } }),
    name: text({ validation: { isRequired: true } }),
    kind: choice(['vaccine', 'test', 'procedure', 'recheck', 'preventive_med'], 'vaccine'),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const ReminderProtocol = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'name' },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    species: relationship({ ref: 'Species', ...readOnly }),
    versions: relationship({ ref: 'ReminderProtocolVersion.protocol', many: true, ...readOnly }),
    ...trackingFields,
  },
})

/** Frozen once published (database trigger); a change is a new version. */
export const ReminderProtocolVersion = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'label' },
  fields: {
    protocol: relationship({ ref: 'ReminderProtocol.versions', ...readOnly }),
    label: systemText({ required: true }),
    versionNumber: integer({ ...readOnly, validation: { isRequired: true } }),
    rules: relationship({ ref: 'ReminderRule.protocolVersion', many: true, ...readOnly }),
    sourceRefs: json({ ...readOnly }),
    verified: checkbox({ ...readOnly, defaultValue: false }),
    unverifiedRules: json({ ...readOnly, defaultValue: [] }),
    status: lifecycle(['draft', 'published', 'superseded']),
    publishedAt: timestamp({ ...readOnly }),
    contentHash: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/**
 * One line of a protocol: giving one of `triggerVaccines` (or the service code) satisfies
 * `satisfies` and schedules the next one by `schedule`:
 * { initialSeries: { doses, intervalWeeks, untilAgeWeeks }, afterInitialMonths, boosterMonths, useProductDoi }.
 */
export const ReminderRule = list({
  access: governed('canAccessDashboard'),
  fields: {
    protocolVersion: relationship({ ref: 'ReminderProtocolVersion.rules', ...readOnly }),
    code: systemText({ required: true }),
    triggerVaccines: relationship({ ref: 'VaccineProduct', many: true, ...readOnly }),
    triggerServiceCode: systemText(),
    satisfies: relationship({ ref: 'ReminderType', ...readOnly }),
    schedule: json({ ...readOnly }),
    leadDays: integer({ ...readOnly, defaultValue: 30 }),
    graceDays: integer({ ...readOnly, defaultValue: 30 }),
    lapseDays: integer({ ...readOnly, defaultValue: 180 }),
    ...trackingFields,
  },
})

export const PatientReminder = list({
  access: governed([...REMINDER_READ]),
  ui: { listView: { initialColumns: ['patient', 'type', 'dueOn', 'status', 'source'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    type: relationship({ ref: 'ReminderType', ...readOnly }),
    rule: relationship({ ref: 'ReminderRule', ...readOnly }),
    dueOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['scheduled', 'due', 'overdue', 'satisfied', 'suppressed', 'lapsed']),
    suppressedReason: systemText(),
    protocolVersion: relationship({ ref: 'ReminderProtocolVersion', ...readOnly }),
    source: fixedChoice(['protocol', 'vaccine', 'manual', 'import']),
    sourceKey: systemText({ required: true }),
    lastNotifiedAt: timestamp({ ...readOnly }),
    satisfactions: relationship({ ref: 'ReminderSatisfaction.reminder', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const ReminderSatisfaction = list({
  access: immutable([...CLINICAL_READ]),
  fields: {
    reminder: relationship({ ref: 'PatientReminder.satisfactions', ...readOnly }),
    sourceKey: systemText({ required: true }),
    vaccineAdministration: relationship({ ref: 'VaccineAdministration', ...readOnly }),
    administration: relationship({ ref: 'Administration', ...readOnly }),
    externalEvidence: relationship({ ref: 'Document', ...readOnly }),
    note: systemText(),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

export const AdverseEventReport = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['patient', 'product', 'severity', 'reportedTo', 'status'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    vaccineAdministration: relationship({ ref: 'VaccineAdministration', ...readOnly }),
    administration: relationship({ ref: 'Administration', ...readOnly }),
    product: relationship({ ref: 'VaccineProduct', ...readOnly }),
    drug: relationship({ ref: 'DrugProduct', ...readOnly }),
    lotNumber: systemText(),
    description: systemText({ required: true }),
    severity: fixedChoice(['mild', 'moderate', 'severe', 'fatal']),
    reportedTo: fixedChoice(['manufacturer', 'fda_cvm', 'usda_cvb']),
    status: lifecycle(['draft', 'submitted', 'acknowledged']),
    reference: systemText(),
    submittedAt: timestamp({ ...readOnly }),
    createdBy: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})
