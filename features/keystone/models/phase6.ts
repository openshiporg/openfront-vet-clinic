import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, select, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, hiddenHash, lifecycle, minor, qty, readOnly, systemText, versionField } from './domainFields'
import { governed, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Phase 6. Diagnostics (STATE-MACHINES §9), production and pay (§20), exports and campaigns.
 * Results, result values, production credits and reviews are append-only (database triggers in the
 * phase6_guards migration): a corrected result is a new row that supersedes the old one, never an edit.
 */

const LAB_READ = ['canReadClinical'] as const
const LAB_SETUP = ['canManageIntegrations', 'canManagePractice'] as const
const PAY = ['canViewFinance', 'canManagePayments'] as const

export const LAB_ORDER_STATES = ['ordered', 'specimen_collected', 'sent', 'partial', 'final', 'corrected', 'reviewed', 'communicated', 'cancelled'] as const
export const LAB_FLAGS = ['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal'] as const
export const PAY_PERIOD_STATES = ['open', 'calculated', 'approved', 'exported', 'locked'] as const

/*
 * Lab set-up (laboratories, tests, analytes, code maps, reference ranges) is reference data the practice keeps itself: people who
 * manage the practice or its integrations create and edit it in the admin screens. Rows are never deleted (past results point at them);
 * a lab or test is retired instead. The columns are the same as before, so this needs no migration.
 */
const setupText = (options: { indexed?: 'unique' } = {}) => text({ ...(options.indexed ? { isIndexed: options.indexed } : {}), validation: { isRequired: true } })
const setupChoice = (values: readonly string[], initial?: string) =>
  select({ type: 'string', options: values.map(value => ({ label: value.replaceAll('_', ' '), value })), ...(initial ? { defaultValue: initial } : {}), validation: { isRequired: true } })

/* ───────── Diagnostics ───────── */

export const Laboratory = list({
  access: managed([...LAB_READ, ...LAB_SETUP], [...LAB_SETUP]),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'kind', 'status'] } },
  fields: {
    code: setupText({ indexed: 'unique' }),
    name: setupText(),
    kind: setupChoice(['reference', 'in_house']),
    /** How results arrive: keyed by hand, a CSV/HL7 file dropped in, or the lab's own adapter. */
    intake: setupChoice(['manual', 'file_drop', 'adapter']),
    integration: relationship({ ref: 'IntegrationConnection', ...readOnly }),
    accountNumber: text(),
    status: setupChoice(['active', 'retired'], 'active'),
    tests: relationship({ ref: 'LabTest.lab', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Analyte = list({
  access: managed([...LAB_READ, ...LAB_SETUP], [...LAB_SETUP]),
  ui: { labelField: 'code' },
  fields: {
    code: setupText({ indexed: 'unique' }),
    name: setupText(),
    canonicalUnit: setupText(),
    ...trackingFields,
  },
})

export const LabTest = list({
  access: managed([...LAB_READ, ...LAB_SETUP], [...LAB_SETUP]),
  ui: { labelField: 'name', listView: { initialColumns: ['lab', 'code', 'name', 'turnaroundHours'] } },
  fields: {
    lab: relationship({ ref: 'Laboratory.tests' }),
    code: setupText(),
    name: setupText(),
    species: relationship({ ref: 'Species', many: true }),
    specimenRequirements: json(),
    /** The price-list item charged when the test is ordered. */
    feeItem: relationship({ ref: 'FeeItem' }),
    turnaroundHours: integer({ defaultValue: 24, validation: { isRequired: true, min: 0, max: 2000 } }),
    status: setupChoice(['active', 'retired'], 'active'),
    ...trackingFields,
  },
})

export const LabAnalyteMap = list({
  access: managed([...LAB_READ, ...LAB_SETUP], [...LAB_SETUP]),
  ui: { labelField: 'externalCode' },
  fields: {
    lab: relationship({ ref: 'Laboratory' }),
    externalCode: setupText(),
    analyte: relationship({ ref: 'Analyte' }),
    /** { factor: "0.0555", offset?: "0" }: external value × factor + offset = canonical value. */
    unitConversion: json(),
    ...trackingFields,
  },
})

export const ReferenceRange = list({
  access: managed([...LAB_READ, ...LAB_SETUP], [...LAB_SETUP]),
  ui: { listView: { initialColumns: ['analyte', 'species', 'ageClass', 'low', 'high', 'unit'] } },
  fields: {
    analyte: relationship({ ref: 'Analyte' }),
    species: relationship({ ref: 'Species' }),
    ageClass: setupChoice(['juvenile', 'adult', 'senior', 'any']),
    lab: relationship({ ref: 'Laboratory' }),
    low: qty(),
    high: qty(),
    /** Beyond these the value is critical, not just abnormal. */
    criticalLow: qty(),
    criticalHigh: qty(),
    unit: setupText(),
    source: text(),
    ...trackingFields,
  },
})

export const LabOrder = list({
  access: governed([...LAB_READ, 'canOrder']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'lab', 'status', 'accessionId'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    order: relationship({ ref: 'ClinicalOrder', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    lab: relationship({ ref: 'Laboratory', ...readOnly }),
    tests: relationship({ ref: 'LabTest', many: true, ...readOnly }),
    orderedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    accessionId: systemText({ nullable: true }),
    status: lifecycle(LAB_ORDER_STATES),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    cancelReason: systemText(),
    sentAt: timestamp({ ...readOnly }),
    specimens: relationship({ ref: 'Specimen.labOrder', many: true, ...readOnly }),
    results: relationship({ ref: 'LabResult.labOrder', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Specimen = list({
  access: governed([...LAB_READ, 'canOrder']),
  graphql: { plural: 'SpecimenList' },
  fields: {
    labOrder: relationship({ ref: 'LabOrder.specimens', ...readOnly }),
    kind: fixedChoice(['whole_blood', 'serum', 'plasma', 'urine', 'feces', 'tissue', 'swab', 'fluid', 'other']),
    collectedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    collectedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    containerId: systemText(),
    ...trackingFields,
  },
})

/** One report from the lab. Append-only; a correction is a new row that points at the one it replaces. */
export const LabResult = list({
  access: governed([...LAB_READ]),
  ui: { listView: { initialColumns: ['labOrder', 'status', 'receivedAt', 'worstFlag'] } },
  fields: {
    labOrder: relationship({ ref: 'LabOrder.results', ...readOnly }),
    observation: relationship({ ref: 'ProviderObservation', ...readOnly }),
    status: fixedChoice(['partial', 'final', 'corrected']),
    supersedes: relationship({ ref: 'LabResult.supersededBy', ...readOnly }),
    supersededBy: relationship({ ref: 'LabResult.supersedes', many: true, ...readOnly }),
    reportDocument: relationship({ ref: 'Document', ...readOnly }),
    worstFlag: fixedChoice(LAB_FLAGS),
    source: fixedChoice(['manual', 'file_drop', 'adapter']),
    contentHash: hiddenHash({ indexed: true }),
    receivedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    values: relationship({ ref: 'LabResultValue.result', many: true, ...readOnly }),
    reviews: relationship({ ref: 'ResultReview.result', many: true, ...readOnly }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const LabResultValue = list({
  access: governed([...LAB_READ]),
  fields: {
    result: relationship({ ref: 'LabResult.values', ...readOnly }),
    analyte: relationship({ ref: 'Analyte', ...readOnly }),
    externalCode: systemText(),
    valueNumeric: qty(),
    valueText: systemText(),
    unit: systemText(),
    /** The range used, copied at the time so a later range edit never rewrites history. */
    refLow: qty(),
    refHigh: qty(),
    flag: fixedChoice(LAB_FLAGS),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

/** The DVM's read of a result and how the client was told. Append-only: communicating is a second row. */
export const ResultReview = list({
  access: governed([...LAB_READ]),
  fields: {
    result: relationship({ ref: 'LabResult.reviews', ...readOnly }),
    dvm: relationship({ ref: 'StaffMember', ...readOnly }),
    kind: fixedChoice(['interpretation', 'communication']),
    interpretation: text({ db: { isNullable: false }, defaultValue: '' }),
    communicatedVia: fixedChoice(['call', 'message', 'in_person', 'portal', 'none']),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const ImagingOrder = list({
  access: governed([...LAB_READ, 'canOrder']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'modality', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    order: relationship({ ref: 'ClinicalOrder', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    orderedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    modality: fixedChoice(['DX', 'US', 'CT', 'MR', 'ECG', 'ENDO']),
    region: systemText(),
    reason: systemText(),
    status: lifecycle(['ordered', 'acquired', 'read', 'communicated', 'cancelled']),
    studies: relationship({ ref: 'ImagingStudy.order', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const ImagingStudy = list({
  access: governed([...LAB_READ]),
  ui: { labelField: 'studyInstanceUid' },
  fields: {
    order: relationship({ ref: 'ImagingOrder.studies', ...readOnly }),
    studyInstanceUid: systemText({ indexed: 'unique', required: true }),
    modality: fixedChoice(['DX', 'US', 'CT', 'MR', 'ECG', 'ENDO']),
    pacs: relationship({ ref: 'IntegrationConnection', ...readOnly }),
    acquiredAt: timestamp({ ...readOnly }),
    images: integer({ defaultValue: 0, validation: { isRequired: true } }),
    reports: relationship({ ref: 'ImagingReport.study', many: true, ...readOnly }),
    ...trackingFields,
  },
})

export const ImagingReport = list({
  access: governed([...LAB_READ]),
  fields: {
    study: relationship({ ref: 'ImagingStudy.reports', ...readOnly }),
    author: fixedChoice(['in_house_dvm', 'teleradiology']),
    authorStaff: relationship({ ref: 'StaffMember', ...readOnly }),
    authorName: systemText(),
    text: text({ db: { isNullable: false }, defaultValue: '' }),
    reportedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

/* ───────── Production, commission and pay ───────── */

export const ProductionRuleVersion = list({
  access: governed([...PAY]),
  ui: { labelField: 'label', listView: { initialColumns: ['versionNo', 'label', 'status', 'effectiveFrom'] } },
  fields: {
    versionNo: integer({ ...readOnly, validation: { isRequired: true } }),
    label: systemText({ required: true }),
    /** { "<productionCategory>": { basis: "performed"|"ordered", bps: 2000 }, … } */
    rules: json({ ...readOnly }),
    /** Groomer and retail commission: { groom: { bps: 4000 }, retail: { bps: 500 } } */
    commissionRules: json({ ...readOnly }),
    effectiveFrom: calendarDay({ validation: { isRequired: true } }),
    status: lifecycle(['draft', 'published', 'retired']),
    publishedAt: timestamp({ ...readOnly }),
    ruleHash: hiddenHash(),
    version: versionField(),
    ...trackingFields,
  },
})

/** Derived once per posted charge line and rule version. Append-only; an adjustment is a new line pointing at the one it adjusts. */
export const ProductionCredit = list({
  access: governed([...PAY]),
  ui: { listView: { initialColumns: ['staff', 'category', 'amountMinor', 'kind', 'creditedOn'] } },
  fields: {
    staff: relationship({ ref: 'StaffMember', ...readOnly }),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    ruleVersion: relationship({ ref: 'ProductionRuleVersion', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    category: systemText({ required: true }),
    basis: fixedChoice(['performed', 'ordered']),
    kind: fixedChoice(['credit', 'adjustment']),
    adjusts: relationship({ ref: 'ProductionCredit', ...readOnly }),
    baseMinor: minor({ required: true }),
    bps: integer({ validation: { isRequired: true } }),
    amountMinor: minor({ required: true }),
    reason: systemText(),
    requestedBy: relationship({ ref: 'User', ...readOnly }),
    approvedBy: relationship({ ref: 'User', ...readOnly }),
    creditedOn: calendarDay({ validation: { isRequired: true } }),
    period: relationship({ ref: 'PayPeriod.credits', ...readOnly }),
    entryKey: hiddenHash({ indexed: 'unique', required: true }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const Commission = list({
  access: governed([...PAY]),
  ui: { listView: { initialColumns: ['staff', 'sourceType', 'amountMinor', 'earnedOn'] } },
  fields: {
    staff: relationship({ ref: 'StaffMember', ...readOnly }),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    ruleVersion: relationship({ ref: 'ProductionRuleVersion', ...readOnly }),
    sourceType: systemText({ required: true }),
    sourceId: systemText(),
    baseMinor: minor({ required: true }),
    bps: integer({ validation: { isRequired: true } }),
    amountMinor: minor({ required: true }),
    earnedOn: calendarDay({ validation: { isRequired: true } }),
    period: relationship({ ref: 'PayPeriod.commissions', ...readOnly }),
    entryKey: hiddenHash({ indexed: 'unique', required: true }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const PayPeriod = list({
  access: governed([...PAY]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'startsOn', 'endsOn', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    startsOn: calendarDay({ validation: { isRequired: true } }),
    endsOn: calendarDay({ validation: { isRequired: true } }),
    status: lifecycle(PAY_PERIOD_STATES),
    /** [{ staffId, productionMinor, commissionMinor }] frozen at calculation. */
    totals: json({ ...readOnly }),
    totalsHash: hiddenHash(),
    calculatedAt: timestamp({ ...readOnly }),
    approvedBy: relationship({ ref: 'User', ...readOnly }),
    approvedAt: timestamp({ ...readOnly }),
    lockedAt: timestamp({ ...readOnly }),
    credits: relationship({ ref: 'ProductionCredit.period', many: true, ...readOnly }),
    commissions: relationship({ ref: 'Commission.period', many: true, ...readOnly }),
    exports: relationship({ ref: 'PayrollExportBatch.period', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const PayrollExportBatch = list({
  access: governed([...PAY]),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    period: relationship({ ref: 'PayPeriod.exports', ...readOnly }),
    format: fixedChoice(['csv']),
    rows: integer({ defaultValue: 0, validation: { isRequired: true } }),
    contentHash: hiddenHash({ required: true }),
    csv: text({ db: { isNullable: false }, defaultValue: '', access: { create: () => false, update: () => false } }),
    exportedBy: relationship({ ref: 'User', ...readOnly }),
    exportedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    createdAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

/* ───────── Exports and campaigns ───────── */

/** A staff-pressed export (the data-portability set). Built on the press; the file is kept so a repeat press can show the same hash. */
export const ExportJob = list({
  access: governed(['canManageOnboarding', 'canManageIntegrations', 'canReadAudit']),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    kind: fixedChoice(['clients', 'patients', 'balances', 'lab_results', 'records_releases', 'full']),
    status: lifecycle(['built', 'failed']),
    rows: integer({ defaultValue: 0, validation: { isRequired: true } }),
    contentHash: hiddenHash(),
    requestedBy: relationship({ ref: 'User', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/** A planned send (reminders, recalls, clinic news). Planning only: nothing is queued or sent from here, and marketing needs consent per contact at send time. */
export const Campaign = list({
  access: governed(['canManagePractice', 'canMessageClients']),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'purpose', 'status'] } },
  fields: {
    name: systemText({ required: true }),
    purpose: fixedChoice(['transactional', 'reminder', 'marketing']),
    template: relationship({ ref: 'MessageTemplate', ...readOnly }),
    audience: json({ ...readOnly }),
    status: lifecycle(['draft', 'approved', 'running', 'done', 'cancelled']),
    outboundVoice: checkbox({ defaultValue: false, access: { create: () => false, update: () => false } }),
    version: versionField(),
    ...trackingFields,
  },
})

export const PHASE6_LISTS = {
  Laboratory, Analyte, LabTest, LabAnalyteMap, ReferenceRange, LabOrder, Specimen, LabResult, LabResultValue, ResultReview,
  ImagingOrder, ImagingStudy, ImagingReport,
  ProductionRuleVersion, ProductionCredit, Commission, PayPeriod, PayrollExportBatch,
  ExportJob, Campaign,
}
