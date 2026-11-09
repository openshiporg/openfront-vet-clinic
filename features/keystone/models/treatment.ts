import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { choice, fixedChoice, lifecycle, qty, readOnly, systemText, unit, versionField, wt } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Orders, doses, administrations, hospital stays, treatment sheets and anaesthesia (SCHEMA §5,
 * STATE-MACHINES §6–§7, DOMAIN I-O1–I-O3). Ported from the hospital vertical's MedicalOrder /
 * Admission / BedOccupancyEvent and the pharmacy vertical's clinical-safety checks.
 *   - A dose is an immutable DoseCalculation: weight measurement × dose rate ÷ concentration, all
 *     exact decimals, rounded to a volume a syringe can measure; recomputing it gives the same bytes.
 *   - An Administration has exactly one source order and names the lot (and the CS container for a
 *     controlled drug, whose register entry is written in the same transaction).
 *   - A treatment task is generated from a sheet order's schedule, once per due time (unique), and is
 *     done, skipped with a reason or rescheduled: never dropped.
 *   - Anaesthesia monitoring readings are append-only.
 */

const CLINICAL_READ = ['canReadClinical'] as const
export const ROUTES = ['po', 'iv', 'im', 'sc', 'topical', 'otic', 'ophthalmic', 'inhaled', 'intranasal', 'io', 'rectal', 'transdermal', 'other'] as const

export const ClinicalOrder = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'kind', 'description', 'status', 'orderedBy'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    encounter: relationship({ ref: 'Encounter.orders', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    kind: fixedChoice(['medication', 'procedure', 'treatment', 'lab', 'imaging', 'vaccine', 'fluid', 'diet', 'nursing', 'euthanasia']),
    description: systemText({ required: true }),
    drug: relationship({ ref: 'DrugProduct', ...readOnly }),
    vaccine: relationship({ ref: 'VaccineProduct', ...readOnly }),
    status: lifecycle(['ordered', 'in_progress', 'completed', 'cancelled', 'reversed']),
    orderedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    licenseEvaluation: relationship({ ref: 'LicenseEvaluation', ...readOnly }),
    dose: relationship({ ref: 'DoseCalculation', ...readOnly }),
    frequency: systemText(),
    schedule: json({ ...readOnly, ui: { ...readOnly.ui, description: '{ frequency: "q8h" | "SID" | "BID" | "TID" | "PRN" | "once", startAt, durationHours }' } }),
    route: fixedChoice(ROUTES),
    quantity: qty(),
    quantityUnit: unit(),
    extralabel: checkbox({ ...readOnly, defaultValue: false }),
    emergencyStabilisation: checkbox({ ...readOnly, defaultValue: false }),
    overrideReason: systemText(),
    warnings: json({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: 'Contraindication and safety warnings shown when ordering, acknowledged by the orderer.' } }),
    cancelReason: systemText(),
    administrations: relationship({ ref: 'Administration.order', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** I-O2: an exact, reproducible dose. Never edited; a new dose is a new row. */
export const DoseCalculation = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['product', 'weightKg', 'doseAmount', 'doseUnit', 'totalAmount', 'roundedQty', 'computedUnit'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    weight: relationship({ ref: 'WeightMeasurement', ...readOnly }),
    weightKg: wt({ required: true }),
    weightAgeHours: integer({ ...readOnly }),
    doseAmount: qty({ required: true }),
    doseUnit: fixedChoice(['mg', 'mcg', 'g', 'mL', 'IU', 'unit', 'tablet', 'capsule', 'dose']),
    dosePer: fixedChoice(['kg', 'm2', 'animal']),
    bsaM2: qty(),
    bsaConstant: qty(),
    totalAmount: qty({ required: true }),
    totalUnit: systemText({ required: true }),
    product: relationship({ ref: 'DrugProduct', ...readOnly }),
    concentration: qty(),
    concentrationUnit: systemText(),
    computedQty: qty(),
    computedUnit: systemText(),
    roundingRule: json({ ...readOnly }),
    roundedQty: qty(),
    deliveredAmount: qty(),
    deviationBps: integer({ ...readOnly }),
    manualOverrideQty: qty(),
    overrideReason: systemText(),
    warnings: json({ ...readOnly, defaultValue: [] }),
    calcVersion: systemText({ required: true }),
    hash: systemText({ required: true }),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

/**
 * A lot of a drug or vaccine at a location. Phase 2 introduces the lot so administrations and
 * vaccine certificates carry the real lot and expiry; Phase 3 adds the item master, supplier, cost
 * and the stock movements against it.
 */
export const InventoryLot = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'lotNumber', listView: { initialColumns: ['lotNumber', 'drug', 'vaccine', 'expiresOn', 'status', 'location'] } },
  fields: {
    drug: relationship({ ref: 'DrugProduct', ...readOnly }),
    vaccine: relationship({ ref: 'VaccineProduct', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    lotNumber: systemText({ required: true }),
    expiresOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['available', 'quarantined', 'disposed']),
    quarantineReason: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** I-O1: what was actually given, from which order, lot or container, by whom. Append-only. */
export const Administration = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['order', 'patient', 'qty', 'unit', 'route', 'givenBy', 'givenAt'] } },
  fields: {
    order: relationship({ ref: 'ClinicalOrder.administrations', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    treatmentTask: relationship({ ref: 'TreatmentTask', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    lotNumber: systemText(),
    lotExpiresOn: calendarDay({ ...readOnly }),
    csContainer: relationship({ ref: 'CsContainer', ...readOnly }),
    csLogEntry: relationship({ ref: 'CsLogEntry', ...readOnly }),
    qty: qty({ required: true }),
    unit: systemText({ required: true }),
    route: fixedChoice(ROUTES),
    site: systemText(),
    givenBy: relationship({ ref: 'StaffMember', ...readOnly }),
    supervisingDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    licenseEvaluation: relationship({ ref: 'LicenseEvaluation', ...readOnly }),
    wasteLogEntry: relationship({ ref: 'CsLogEntry', ...readOnly }),
    givenAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    wasteQty: qty(),
    reverses: relationship({ ref: 'Administration', ...readOnly }),
    reason: systemText(),
    /** N1: why a veterinarian recorded an amount outside the ordered quantity (trigger Administration_qty_guard). */
    qtyOverrideReason: systemText(),
  },
})

export const Ward = list({
  access: managed('canReadClinical', 'canManagePractice'),
  ui: { labelField: 'name' },
  fields: {
    location: relationship({ ref: 'Location' }),
    name: systemText({ required: true }),
    kind: choice(['general', 'icu', 'isolation', 'surgery_recovery', 'exotics'], 'general'),
    cages: relationship({ ref: 'Cage.ward', many: true }),
    ...trackingFields,
  },
})

export const Cage = list({
  access: managed('canReadClinical', 'canManagePractice'),
  ui: { labelField: 'code', listView: { initialColumns: ['code', 'ward', 'size', 'active'] } },
  fields: {
    ward: relationship({ ref: 'Ward.cages' }),
    code: systemText({ required: true, indexed: 'unique' }),
    size: choice(['small', 'medium', 'large', 'run'], 'medium'),
    features: json({ defaultValue: {} }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const HospitalStay = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'status', 'cage', 'admittedAt', 'attendingDvm'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    cage: relationship({ ref: 'Cage', ...readOnly }),
    admittedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    dischargedAt: timestamp({ ...readOnly }),
    status: lifecycle(['admitted', 'in_care', 'ready_for_discharge', 'discharged', 'transferred', 'deceased']),
    codeStatus: fixedChoice(['full', 'closed_chest_only', 'dnr']),
    attendingDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    reason: systemText(),
    assignments: relationship({ ref: 'CageAssignment.stay', many: true, ...readOnly }),
    sheetOrders: relationship({ ref: 'TreatmentSheetOrder.stay', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Who is in which cage when. The database refuses two live stays in one cage at once (I-O4). */
export const CageAssignment = list({
  access: governed([...CLINICAL_READ]),
  fields: {
    stay: relationship({ ref: 'HospitalStay.assignments', ...readOnly }),
    cage: relationship({ ref: 'Cage', ...readOnly }),
    fromAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    toAt: timestamp({ ...readOnly }),
    ...trackingFields,
  },
})

export const TreatmentSheetOrder = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['stay', 'order', 'frequency', 'active', 'materialisedThrough'] } },
  fields: {
    stay: relationship({ ref: 'HospitalStay.sheetOrders', ...readOnly }),
    order: relationship({ ref: 'ClinicalOrder', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    frequency: fixedChoice(['q1h', 'q2h', 'q4h', 'q6h', 'q8h', 'q12h', 'sid', 'bid', 'tid', 'qid', 'prn', 'cri', 'once']),
    startAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endAt: timestamp({ ...readOnly }),
    instructions: systemText(),
    materialisedThrough: timestamp({ ...readOnly }),
    graceMinutes: integer({ ...readOnly, defaultValue: 30 }),
    active: checkbox({ ...readOnly, defaultValue: true }),
    tasks: relationship({ ref: 'TreatmentTask.sheetOrder', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const TreatmentTask = list({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['patient', 'sheetOrder', 'dueAt', 'status', 'doneBy'] } },
  fields: {
    sheetOrder: relationship({ ref: 'TreatmentSheetOrder.tasks', ...readOnly }),
    stay: relationship({ ref: 'HospitalStay', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    dueAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['scheduled', 'due', 'overdue', 'missed', 'done', 'skipped', 'rescheduled']),
    doneBy: relationship({ ref: 'StaffMember', ...readOnly }),
    doneAt: timestamp({ ...readOnly }),
    skipReason: systemText(),
    rescheduledTo: relationship({ ref: 'TreatmentTask', ...readOnly }),
    administration: relationship({ ref: 'Administration', ...readOnly }),
    observation: json({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const AnaesthesiaRecord = list({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'asaStatus', 'status', 'anaesthetist', 'inductionAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    procedure: systemText({ required: true }),
    asaStatus: fixedChoice(['I', 'II', 'III', 'IV', 'V', 'IE', 'IIE', 'IIIE', 'IVE', 'VE']),
    fastingConfirmed: checkbox({ ...readOnly, defaultValue: false }),
    consentConfirmed: checkbox({ ...readOnly, defaultValue: false }),
    preWeight: relationship({ ref: 'WeightMeasurement', ...readOnly }),
    ivCatheter: json({ ...readOnly }),
    protocol: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Premedication, induction and maintenance plan.' } }),
    checklist: json({ ...readOnly }),
    inductionAt: timestamp({ ...readOnly }),
    intubatedAt: timestamp({ ...readOnly }),
    extubatedAt: timestamp({ ...readOnly }),
    recoveryEndAt: timestamp({ ...readOnly }),
    anaesthetist: relationship({ ref: 'StaffMember', ...readOnly }),
    dvm: relationship({ ref: 'StaffMember', ...readOnly }),
    licenseEvaluation: relationship({ ref: 'LicenseEvaluation', ...readOnly }),
    status: lifecycle(['open', 'monitoring', 'recovery', 'closed']),
    complications: systemText(),
    closedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    readings: relationship({ ref: 'MonitoringReading.record', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const MonitoringReading = list({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ['record', 'at', 'hr', 'rr', 'spo2', 'etco2', 'map', 'tempC'] } },
  fields: {
    record: relationship({ ref: 'AnaesthesiaRecord.readings', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    hr: integer({ ...readOnly }),
    rr: integer({ ...readOnly }),
    spo2: integer({ ...readOnly }),
    etco2: integer({ ...readOnly }),
    sbp: integer({ ...readOnly }),
    dbp: integer({ ...readOnly }),
    map: integer({ ...readOnly }),
    tempC: qty(),
    agentPct: qty(),
    o2FlowLpm: qty(),
    fluidsRateMlHr: qty(),
    notes: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
  },
})

export const SurgeryReport = list({
  access: governed([...CLINICAL_READ]),
  fields: {
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    procedure: systemText({ required: true }),
    surgeon: relationship({ ref: 'StaffMember', ...readOnly }),
    assistant: relationship({ ref: 'StaffMember', ...readOnly }),
    technique: systemText(),
    findings: systemText(),
    closure: systemText(),
    sutures: systemText(),
    specimens: systemText(),
    status: lifecycle(['draft', 'signed']),
    version: versionField(),
    ...trackingFields,
  },
})

/** Triadan tooth map: { "108": { findings: [...], procedures: [...] } }. */
export const DentalChart = list({
  access: governed([...CLINICAL_READ]),
  fields: {
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    teeth: json({ ...readOnly, defaultValue: {} }),
    version: versionField(),
    ...trackingFields,
  },
})

export const DischargeInstruction = list({
  access: governed([...CLINICAL_READ]),
  fields: {
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    stay: relationship({ ref: 'HospitalStay', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    body: systemText({ required: true }),
    medsSummary: systemText(),
    recheckOn: calendarDay({ ...readOnly }),
    sentAt: timestamp({ ...readOnly }),
    author: relationship({ ref: 'StaffMember', ...readOnly }),
    ...trackingFields,
  },
})
