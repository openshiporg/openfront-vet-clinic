import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { permissions } from '../access'
import { choice, fixedChoice, lifecycle, qty, readOnly, systemText, unit, versionField } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Drug catalogue, prescriptions and the controlled-substance register: the database layer
 * (SCHEMA §9.1, §9.2, §10.1, §10.2). The invariants that must hold whatever the application does are
 * enforced here from Phase 1, by triggers in migrations/…_vet_clinic_phase1_guards:
 *   - a container's balance (Σ CsLogEntry.qtySigned) is never below zero (I-CS1; deferred check
 *     under a container row lock, so parallel administrations serialise);
 *   - register entries are append-only (corrections are reversing entries);
 *   - a Schedule II prescription line can never carry a refill; CIII/CIV lines are capped at five
 *     refills within six months of issue (21 CFR 1306.12, 1306.22; I-RX1).
 * The workflows that write these rows (administer, dispense, count, destroy, PDMP) arrive with the
 * pharmacy and register screens in Phase 3; no list here accepts a write from the generated API.
 */

export const CS_SCHEDULES = ['none', 'CI', 'CII', 'CIIN', 'CIII', 'CIIIN', 'CIV', 'CV'] as const

export const DrugProduct = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'displayName', listView: { initialColumns: ['displayName', 'form', 'strength', 'strengthUnit', 'csSchedule', 'active'] } },
  fields: {
    displayName: systemText({ required: true }),
    genericName: systemText({ required: true }),
    brandName: systemText(),
    form: fixedChoice(['tablet', 'capsule', 'chewable', 'liquid_oral', 'injectable', 'topical', 'otic', 'ophthalmic', 'transdermal', 'powder', 'implant', 'other']),
    strength: qty(),
    strengthUnit: unit(),
    per: choice(['tablet', 'capsule', 'mL', 'g', 'dose', 'application'], null),
    concentration: qty(),
    concentrationUnit: systemText(),
    packageQty: qty(),
    packageUnit: unit(),
    csSchedule: fixedChoice(CS_SCHEDULES),
    stateCsSchedule: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Per-state scheduling from the policy packs, e.g. {"US-CA":"CV"}.' } }),
    isHumanLabel: checkbox({ ...readOnly, defaultValue: false }),
    approvalStatus: fixedChoice(['fda_approved', 'conditional', 'indexed', 'compounded', 'human_label']),
    multiDoseBudDays: integer({ ...readOnly }),
    ndc: systemText({ indexed: true }),
    requiresWitnessOnAdminister: checkbox({ ...readOnly, defaultValue: false }),
    doseRanges: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Per species: {"canine":{"min":"0.2","max":"0.4","unit":"mg","per":"kg"}} from the practice formulary (I-O2 dose check).' } }),
    cautionFlags: json({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: 'Breed genetic flags that make this drug a caution, e.g. ["MDR1_risk"].' } }),
    measurableIncrement: qty(),
    active: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

export const Prescription = list({
  access: governed(['canReadClinical', 'canPrescribe', 'canManageRefills']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'prescriber', 'status', 'issuedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    prescriber: relationship({ ref: 'StaffMember', ...readOnly }),
    deaRegistration: relationship({ ref: 'DeaRegistration', ...readOnly }),
    vcpr: relationship({ ref: 'VcprRecord', ...readOnly }),
    issuedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['draft', 'active', 'exhausted', 'expired', 'cancelled']),
    signedAt: timestamp({ ...readOnly }),
    licenseEvaluation: relationship({ ref: 'LicenseEvaluation', ...readOnly }),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    lines: relationship({ ref: 'PrescriptionLine.prescription', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const PrescriptionLine = list({
  access: governed(['canReadClinical', 'canPrescribe', 'canManageRefills']),
  fields: {
    prescription: relationship({ ref: 'Prescription.lines', ...readOnly }),
    product: relationship({ ref: 'DrugProduct', ...readOnly }),
    /** The product's federal schedule when the line was written (checked against the product by the DB). */
    csSchedule: fixedChoice(CS_SCHEDULES),
    directions: systemText({ required: true }),
    route: systemText(),
    frequency: systemText(),
    quantity: qty({ required: true }),
    quantityUnit: unit(),
    refillsAuthorised: integer({ ...readOnly, defaultValue: 0, validation: { isRequired: true, min: 0 } }),
    expiresAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    extralabel: checkbox({ ...readOnly, defaultValue: false }),
    substitutionAllowed: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

/** One opened (or sealed) bottle of a controlled substance, held under one DEA registration. */
export const CsContainer = list({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'product', 'location', 'status', 'labelQty', 'labelUnit'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    product: relationship({ ref: 'DrugProduct', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    deaRegistration: relationship({ ref: 'DeaRegistration', ...readOnly }),
    lotNumber: systemText({ required: true }),
    lotExpiresOn: calendarDay({ ...readOnly }),
    status: lifecycle(['sealed', 'open', 'emptied', 'quarantined', 'disposed', 'retired']),
    labelQty: qty({ required: true }),
    labelUnit: unit(),
    openedAt: timestamp({ ...readOnly }),
    openedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    budAt: timestamp({ ...readOnly }),
    entries: relationship({ ref: 'CsLogEntry.container', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** The register (21 CFR 1304.21-22). Immutable; the container balance is derived from these rows. */
export const CsLogEntry = list({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'container', 'type', 'qtySigned', 'unit', 'occurredAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    ciiRef: systemText({ indexed: 'unique', nullable: true }),
    container: relationship({ ref: 'CsContainer.entries', ...readOnly }),
    deaRegistration: relationship({ ref: 'DeaRegistration', ...readOnly }),
    schedule: fixedChoice(CS_SCHEDULES),
    type: fixedChoice(['receive', 'open_transfer', 'administer', 'dispense', 'waste', 'transfer_out', 'transfer_in', 'return', 'destroy', 'adjust', 'count_variance', 'theft_loss']),
    qtySigned: qty({ required: true }),
    unit: unit(),
    occurredAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    recordedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    actor: relationship({ ref: 'StaffMember', ...readOnly }),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    clientSnapshot: json({ ...readOnly }),
    reverses: relationship({ ref: 'CsLogEntry', ...readOnly }),
    reason: systemText(),
    prevHash: systemText(),
    hash: systemText(),
  },
})

export const CS_REGISTER_LISTS = ['CsContainer', 'CsLogEntry'] as const
