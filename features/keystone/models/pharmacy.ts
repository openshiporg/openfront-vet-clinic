import { graphql, list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, timestamp, virtual } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { permissions } from '../access'
import { choice, fixedChoice, lifecycle, qty, readOnly, systemText, unit, versionField } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'
import { containerBalance } from '../lib/csRegister'

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
    /** Derived on read: Σ register entries (never stored, so it cannot drift). */
    balance: virtual({ field: graphql.field({ type: graphql.String, async resolve(item, _args, context) { return (await containerBalance(context.prisma as never, (item as { id: string }).id)).toFixed() } }) }),
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

export const CS_REGISTER_LISTS = ['CsContainer', 'CsLogEntry', 'CsCount', 'CsCountLine', 'CsDiscrepancyCase', 'CsDestructionRecord', 'PdmpReport'] as const

/** What was handed to a client (or used for an in-house sale) against a prescription line. Immutable. */
export const Dispense = list({
  access: governed(['canReadClinical', 'canDispense', 'canFulfilRefill']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'product', 'quantity', 'quantityUnit', 'refillNumber', 'dispensedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    prescription: relationship({ ref: 'Prescription', ...readOnly }),
    line: relationship({ ref: 'PrescriptionLine', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    product: relationship({ ref: 'DrugProduct', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    container: relationship({ ref: 'CsContainer', ...readOnly }),
    csLogEntry: relationship({ ref: 'CsLogEntry', ...readOnly }),
    refillRequest: relationship({ ref: 'RefillRequest', ...readOnly }),
    quantity: qty({ required: true }),
    quantityUnit: unit(),
    /** 0 for the original fill, then 1, 2, … for each refill. */
    refillNumber: integer({ ...readOnly, defaultValue: 0, validation: { isRequired: true, min: 0 } }),
    dispensedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    dispensedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    label: json({ ...readOnly, ui: { ...readOnly.ui, description: 'The label as printed: every field the practice must show (policy pack).' } }),
    ...trackingFields,
  },
})

/** A physical count of every open container at a location (initial, biennial, periodic or spot). */
export const CsCount = list({
  access: governed('canViewControlled'),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'location', 'kind', 'countedBy', 'countedAt', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    kind: fixedChoice(['initial', 'biennial', 'periodic', 'spot']),
    countedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    countedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['closed']),
    lines: relationship({ ref: 'CsCountLine.count', many: true, ...readOnly }),
    ...trackingFields,
  },
})

export const CsCountLine = list({
  access: governed('canViewControlled'),
  fields: {
    count: relationship({ ref: 'CsCount.lines', ...readOnly }),
    container: relationship({ ref: 'CsContainer', ...readOnly }),
    expectedQty: qty({ required: true }),
    countedQty: qty({ required: true }),
    variance: qty({ required: true }),
    unit: unit(),
    discrepancyCase: relationship({ ref: 'CsDiscrepancyCase', ...readOnly }),
  },
})

/**
 * A count variance, a theft or a loss. The two federal clocks are stored as dates and judged on read
 * against the location's business calendar: DEA notice by the next business day (21 CFR 1301.76(b)),
 * then Form 106 within 45 days (21 CFR 1301.76(b)).
 */
export const CsDiscrepancyCase = list({
  access: governed('canViewControlled'),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'location', 'kind', 'status', 'noticeDueOn', 'form106DueOn'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    container: relationship({ ref: 'CsContainer', ...readOnly }),
    kind: fixedChoice(['count_variance', 'theft', 'loss']),
    qty: qty({ required: true }),
    unit: unit(),
    discoveredAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    discoveredBy: relationship({ ref: 'StaffMember', ...readOnly }),
    description: systemText(),
    status: lifecycle(['open', 'notified', 'form_filed', 'closed']),
    noticeDueOn: calendarDay({ ...readOnly }),
    noticeGivenAt: timestamp({ ...readOnly }),
    noticeReference: systemText(),
    form106DueOn: calendarDay({ ...readOnly }),
    form106FiledAt: timestamp({ ...readOnly }),
    form106Reference: systemText(),
    resolution: systemText(),
    closedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Destruction of expired or unwanted stock (Form 41). Two witnesses, both other than the person recording. Immutable. */
export const CsDestructionRecord = list({
  access: governed('canViewControlled'),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'container', 'qty', 'unit', 'destroyedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    container: relationship({ ref: 'CsContainer', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    csLogEntry: relationship({ ref: 'CsLogEntry', ...readOnly }),
    qty: qty({ required: true }),
    unit: unit(),
    method: systemText({ required: true }),
    form41Reference: systemText(),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    witnessA: relationship({ ref: 'StaffMember', ...readOnly }),
    witnessB: relationship({ ref: 'StaffMember', ...readOnly }),
    destroyedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/** A controlled dispense to report to the state programme (CURES in California: within 7 days). Pending until staff record the upload. */
export const PdmpReport = list({
  access: governed('canViewControlled'),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'location', 'program', 'status', 'dueOn', 'submittedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    dispense: relationship({ ref: 'Dispense', ...readOnly }),
    program: systemText({ required: true }),
    format: systemText(),
    dueOn: calendarDay({ ...readOnly }),
    status: lifecycle(['pending', 'submitted']),
    submittedAt: timestamp({ ...readOnly }),
    submittedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    confirmation: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})
