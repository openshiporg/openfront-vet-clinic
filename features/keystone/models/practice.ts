import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, relationship, text, timestamp } from '@keystone-6/core/fields'
import { permissions } from '../access'
import { choice, fixedChoice, geo, lifecycle, minor, rate, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/* Practice & access (SCHEMA §1). One practice per database (G1); locations model the group inside it. */

export const PracticeSettings = list({
  isSingleton: true,
  graphql: { plural: 'PracticeSettingsItems' },
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: permissions.canManagePractice, delete: () => false } },
  fields: {
    legalName: text({ validation: { isRequired: true }, defaultValue: 'Openfront Vet Clinic' }),
    displayName: text({ validation: { isRequired: true }, defaultValue: 'Openfront Vet Clinic' }),
    homeTimeZone: text({ defaultValue: 'America/Los_Angeles', validation: { isRequired: true } }),
    currencyCode: text({ defaultValue: 'USD', validation: { isRequired: true, match: { regex: /^[A-Z]{3}$/ } } }),
    medicalDirector: relationship({ ref: 'StaffMember', ui: { description: 'Registrant contact for controlled substances.' } }),
    estimateValidityDays: integer({ defaultValue: 30, validation: { min: 1, max: 365 } }),
    estimateOverageToleranceBps: integer({ defaultValue: 0, validation: { min: 0, max: 10_000 } }),
    electiveDepositPct: rate({ description: 'Fraction of the estimate low end taken as a deposit for elective work (0.5 = 50%).' }),
    depositBasis: choice(['low', 'high'], 'low'),
    noShowGraceMinutes: integer({ defaultValue: 15, validation: { min: 0, max: 240 } }),
    unsignedRecordTaskHours: integer({ defaultValue: 24 }),
    unsignedRecordEscalateHours: integer({ defaultValue: 72 }),
    refundApprovalThresholdMinor: minor({ defaultValue: 25_000n }),
    discountApprovalThresholdBps: integer({ defaultValue: 1_000 }),
    writeOffRequiresApproval: checkbox({ defaultValue: true }),
    weightMaxAgeHours: json({ defaultValue: { anaesthesia: 24, inpatient: 72, outpatient: 720 } }),
    features: json({ defaultValue: { boarding: true, grooming: true, wellnessPlans: true, insurance: true, aiVoice: false, scribe: false, multiLocation: true, pdmp: true, csos: false, drugCabinet: false } }),
    // Agents' owner can never be the checker of what the agent proposed (separation of duties).
    strictAgentOwnerSoD: checkbox({ ...readOnly, defaultValue: true }),
    onboardingStatus: choice(['not_started', 'in_progress', 'completed', 'dismissed'], 'not_started'),
    version: versionField(),
    ...trackingFields,
  },
})

export const Location = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'code', 'kind', 'stateCode', 'timeZone', 'active'] } },
  fields: {
    name: text({ validation: { isRequired: true } }),
    code: text({ isIndexed: 'unique', validation: { isRequired: true, match: { regex: /^[A-Z0-9-]{3,24}$/, explanation: 'Capital letters, digits and dashes.' } } }),
    kind: choice(['general_practice', 'emergency', 'specialty', 'wellness', 'mobile'], 'general_practice'),
    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    postalCode: text(),
    stateCode: text({ validation: { isRequired: true, match: { regex: /^US-[A-Z]{2}$/, explanation: 'ISO 3166-2, e.g. US-CA.' } } }),
    lat: geo(),
    lng: geo(),
    timeZone: text({ validation: { isRequired: true }, defaultValue: 'America/Los_Angeles' }),
    phone: text(),
    email: text(),
    calendar: relationship({ ref: 'BusinessCalendar' }),
    openHours: json({ ui: { description: 'Per weekday open/close "HH:mm" in the location time zone.' } }),
    emergencyCoverage: choice(['none', 'in_house', 'referral'], 'referral'),
    deaRegistrations: relationship({ ref: 'DeaRegistration.location', many: true, ...readOnly }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** DEA registration per location and registrant (I-P2; 21 CFR 1301.12). */
export const DeaRegistration = list({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: 'registrationNumber', listView: { initialColumns: ['registrationNumber', 'registrantName', 'location', 'status', 'expiresOn'] } },
  fields: {
    registrationNumber: systemText({ indexed: 'unique', required: true }),
    registrantName: systemText({ required: true }),
    registrantKind: fixedChoice(['practitioner_individual', 'practitioner_institution']),
    staffMember: relationship({ ref: 'StaffMember', ...readOnly }),
    location: relationship({ ref: 'Location.deaRegistrations', ...readOnly }),
    schedules: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Schedules covered, e.g. ["2","2N","3","3N","4","5"].' } }),
    issuedOn: calendarDay({ ...readOnly }),
    expiresOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    stateCsRegistration: systemText(),
    csosCertificateRef: systemText(),
    powersOfAttorney: relationship({ ref: 'DeaPowerOfAttorney.registration', many: true, ...readOnly }),
    status: lifecycle(['active', 'expired', 'surrendered', 'revoked']),
    version: versionField(),
    ...trackingFields,
  },
})

export const DeaPowerOfAttorney = list({
  access: governed('canViewControlled'),
  fields: {
    registration: relationship({ ref: 'DeaRegistration.powersOfAttorney', ...readOnly }),
    grantee: relationship({ ref: 'StaffMember', ...readOnly }),
    signedOn: calendarDay({ ...readOnly }),
    revokedOn: calendarDay({ ...readOnly }),
    document: relationship({ ref: 'Document', ...readOnly }),
    ...trackingFields,
  },
})

export const StaffMember = list({
  access: managed('canAccessDashboard', 'canManagePeople'),
  ui: { labelField: 'displayName', listView: { initialColumns: ['displayName', 'kind', 'credentials', 'homeLocation', 'employment', 'active'] } },
  fields: {
    user: relationship({ ref: 'User.staffMember' }),
    displayName: text({ validation: { isRequired: true } }),
    kind: choice(['dvm', 'rvt', 'assistant', 'csr', 'groomer', 'manager', 'inventory', 'bookkeeper', 'kennel']),
    credentials: text({ ui: { description: 'e.g. "DVM, DACVS".' } }),
    employment: choice(['employee', 'relief', 'contractor'], 'employee'),
    homeLocation: relationship({ ref: 'Location' }),
    locations: relationship({ ref: 'Location', many: true }),
    colour: text(),
    licenses: relationship({ ref: 'ProfessionalLicense.staffMember', many: true, ...readOnly }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** A professional licence (I-P1). Verified against the state board; never edited in place once verified. */
export const ProfessionalLicense = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'licenseNumber', listView: { initialColumns: ['staffMember', 'kind', 'stateCode', 'licenseNumber', 'status', 'expiresOn'] } },
  fields: {
    staffMember: relationship({ ref: 'StaffMember.licenses', ...readOnly }),
    kind: fixedChoice(['veterinarian', 'registered_veterinary_technician', 'veterinary_assistant_cs_permit', 'groomer_cert']),
    stateCode: systemText({ required: true }),
    licenseNumber: systemText({ required: true }),
    issuedOn: calendarDay({ ...readOnly }),
    expiresOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['active', 'expired', 'suspended', 'revoked']),
    verifiedAt: timestamp({ ...readOnly }),
    verifiedBy: relationship({ ref: 'User', ...readOnly }),
    verificationSource: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** Immutable record of which licence/registration authorised (or blocked) an action (G15). */
export const LicenseEvaluation = list({
  access: immutable('canAccessDashboard'),
  ui: { listView: { initialColumns: ['action', 'result', 'staffMember', 'location', 'at'] } },
  fields: {
    action: systemText({ indexed: true, required: true }),
    staffMember: relationship({ ref: 'StaffMember', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    onDate: calendarDay({ ...readOnly }),
    license: relationship({ ref: 'ProfessionalLicense', ...readOnly }),
    deaRegistration: relationship({ ref: 'DeaRegistration', ...readOnly }),
    policyVersions: json({ ...readOnly }),
    result: fixedChoice(['allowed', 'blocked']),
    findings: json({ ...readOnly }),
  },
})
