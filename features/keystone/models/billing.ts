import { graphql, list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp, virtual } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { ccy, fixedChoice, lifecycle, minor, qty, rate, readOnly, systemText, versionField } from './domainFields'
import { permissions } from '../access'
import { governed, immutable } from './listAccess'
import { trackingFields } from './trackingFields'
import { balanceOfInvoice, paymentTotals, planSpend } from '../lib/ledger'

/*
 * Phase 4: estimates, treatment plans, fee schedules, invoices, payments and insurance
 * (SCHEMA §7, §14; STATE-MACHINES §11). Money is bigint minor units with a currency; quantities are
 * numeric(18,6). Nothing here is edited through the generated API: every change is a command that runs
 * in one transaction with its audit event. The invariants that must hold whatever the application does
 * are database triggers (migrations/…_phase4_billing):
 *   - the client ledger and payment allocations are append-only; Σ allocations never exceeds the payment;
 *   - Σ refunds never exceeds the payment; a posted invoice's lines and totals are frozen;
 *   - a presented estimate version, a published fee schedule version and an acceptance never change;
 *   - one live charge per clinical source; a closed AR period takes no posting.
 */

const SALES = ['canTakePayments', 'canPostInvoices', 'canViewFinance', 'canManageFees', 'canBook', 'canCheckIn', 'canReadClinical', 'canManagePractice'] as const
const MONEY = ['canTakePayments', 'canPostInvoices', 'canViewFinance', 'canManagePayments', 'canApproveWriteOff', 'canIssueRefunds', 'canManagePractice'] as const
const FEES_READ = ['canAccessDashboard'] as const

const money = (o: { required?: boolean } = {}) => minor({ required: o.required ?? false })

// ── Fee schedules ───────────────────────────────────────────────────────────────────────────

export const FeeSchedule = list({
  access: governed([...FEES_READ]),
  ui: { labelField: 'name' },
  fields: {
    name: systemText({ required: true }),
    code: systemText({ indexed: 'unique', required: true }),
    versions: relationship({ ref: 'FeeScheduleVersion.schedule', many: true, ...readOnly }),
    ...trackingFields,
  },
})

/** A published version is immutable (G7); a change is a new draft, published after a second person approves. */
export const FeeScheduleVersion = list({
  access: governed([...FEES_READ]),
  ui: { labelField: 'label' },
  fields: {
    schedule: relationship({ ref: 'FeeSchedule.versions', ...readOnly }),
    versionNo: integer({ ...readOnly, validation: { isRequired: true } }),
    label: systemText(),
    status: lifecycle(['draft', 'pending_approval', 'published', 'retired']),
    effectiveFrom: calendarDay({ ...readOnly }),
    publishedAt: timestamp({ ...readOnly }),
    items: relationship({ ref: 'FeeItem.version', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const FEE_CATEGORIES = [
  'exam', 'consultation', 'vaccine', 'medication', 'injection', 'laboratory', 'imaging', 'surgery', 'anaesthesia', 'dental', 'hospitalisation',
  'treatment', 'boarding', 'grooming', 'diet', 'retail_product', 'supplies', 'fee', 'euthanasia', 'aftercare', 'other',
] as const
export const TAX_CATEGORIES = ['professional_service', 'rx_animal_drug', 'vaccine_administered', 'retail_product', 'diet', 'otc_parasiticide', 'supplies', 'merchandise', 'boarding', 'grooming'] as const

export const FeeItem = list({
  access: governed([...FEES_READ]),
  ui: { labelField: 'name', listView: { initialColumns: ['code', 'name', 'category', 'priceMinor', 'taxCategory'] } },
  fields: {
    version: relationship({ ref: 'FeeScheduleVersion.items', ...readOnly }),
    code: systemText({ indexed: true, required: true }),
    name: systemText({ required: true }),
    category: fixedChoice(FEE_CATEGORIES),
    priceMinor: minor({ required: true }),
    currencyCode: ccy(),
    unit: systemText(),
    minimumChargeMinor: money(),
    dispensingFeeMinor: money(),
    injectionFeeMinor: money(),
    markupRate: rate(),
    taxCategory: fixedChoice(TAX_CATEGORIES),
    productionCategory: systemText(),
    /** The kind of clinical order this prices (and the drug, when it prices one drug). */
    orderKind: systemText({ indexed: true }),
    drug: relationship({ ref: 'DrugProduct', ...readOnly }),
    vaccine: relationship({ ref: 'VaccineProduct', ...readOnly }),
    item: relationship({ ref: 'Item', ...readOnly }),
    active: checkbox({ defaultValue: true, ...readOnly }),
    ...trackingFields,
  },
})

export const PriceRule = list({
  access: governed([...FEES_READ]),
  fields: {
    version: relationship({ ref: 'FeeScheduleVersion', ...readOnly }),
    name: systemText({ required: true }),
    kind: fixedChoice(['client_tier', 'species', 'after_hours', 'emergency', 'multi_pet', 'rescue']),
    adjustmentBps: integer({ ...readOnly, validation: { isRequired: true } }),
    conditions: json({ ...readOnly, defaultValue: {} }),
    ...trackingFields,
  },
})

// ── Estimates and treatment plans ───────────────────────────────────────────────────────────

export const Estimate = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'client', 'status', 'createdAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    title: systemText(),
    /** Planned, non-urgent work: the practice may take a deposit on acceptance. */
    elective: checkbox({ defaultValue: false, ...readOnly }),
    status: lifecycle(['open', 'accepted', 'closed']),
    acceptedVersion: relationship({ ref: 'EstimateVersion', ...readOnly }),
    acceptedOption: relationship({ ref: 'EstimateOption', ...readOnly }),
    versions: relationship({ ref: 'EstimateVersion.estimate', many: true, ...readOnly }),
    createdBy: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const EstimateVersion = list({
  access: governed([...SALES]),
  ui: { labelField: 'versionNo' },
  fields: {
    estimate: relationship({ ref: 'Estimate.versions', ...readOnly }),
    versionNo: integer({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['draft', 'presented', 'accepted', 'declined', 'expired', 'superseded']),
    presentedAt: timestamp({ ...readOnly }),
    validUntil: timestamp({ ...readOnly }),
    feeScheduleVersion: relationship({ ref: 'FeeScheduleVersion', ...readOnly }),
    quoteHash: systemText(),
    isOverage: checkbox({ defaultValue: false, ...readOnly }),
    overageOf: relationship({ ref: 'EstimateVersion', ...readOnly }),
    declineReason: systemText(),
    options: relationship({ ref: 'EstimateOption.estimateVersion', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const EstimateOption = list({
  access: governed([...SALES]),
  ui: { labelField: 'label' },
  fields: {
    estimateVersion: relationship({ ref: 'EstimateVersion.options', ...readOnly }),
    label: systemText({ required: true }),
    lowTotalMinor: minor({ required: true }),
    highTotalMinor: minor({ required: true }),
    currencyCode: ccy(),
    recommended: checkbox({ defaultValue: false, ...readOnly }),
    lines: relationship({ ref: 'EstimateLine.option', many: true, ...readOnly }),
    ...trackingFields,
  },
})

export const EstimateLine = list({
  access: governed([...SALES]),
  fields: {
    option: relationship({ ref: 'EstimateOption.lines', ...readOnly }),
    feeItem: relationship({ ref: 'FeeItem', ...readOnly }),
    description: systemText({ required: true }),
    category: systemText(),
    qtyLow: qty({ required: true }),
    qtyHigh: qty({ required: true }),
    unitPriceMinor: minor({ required: true }),
    lowMinor: minor({ required: true }),
    highMinor: minor({ required: true }),
    taxable: checkbox({ defaultValue: false, ...readOnly }),
    optional: checkbox({ defaultValue: false, ...readOnly }),
    sortOrder: integer({ ...readOnly, defaultValue: 0 }),
    ...trackingFields,
  },
})

/** The client's acceptance: who signed, how, and the exact quote hash they saw. Never edited. */
export const EstimateAcceptance = list({
  access: immutable([...SALES]),
  fields: {
    estimateVersion: relationship({ ref: 'EstimateVersion', ...readOnly }),
    option: relationship({ ref: 'EstimateOption', ...readOnly }),
    signer: relationship({ ref: 'ClientPerson', ...readOnly }),
    method: fixedChoice(['in_person_signature', 'esign_link', 'verbal_witnessed']),
    quoteHash: systemText(),
    signatureText: systemText(),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const TreatmentPlan = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'status', 'acceptedHighMinor', 'spentMinor'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    estimate: relationship({ ref: 'Estimate', ...readOnly }),
    estimateVersion: relationship({ ref: 'EstimateVersion', ...readOnly }),
    option: relationship({ ref: 'EstimateOption', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    status: lifecycle(['active', 'completed', 'cancelled']),
    acceptedLowMinor: minor({ required: true }),
    acceptedHighMinor: minor({ required: true }),
    currencyCode: ccy(),
    /** Planned lines plus anything ordered since, counting the charge once it exists (never stored). */
    spentMinor: virtual({ field: graphql.field({ type: graphql.String, async resolve(item, _a, context) { return (await planSpend(context.prisma as never, (item as { id: string }).id)).toString() } }) }),
    items: relationship({ ref: 'TreatmentPlanItem.plan', many: true, ...readOnly }),
    overages: relationship({ ref: 'OverageApproval.plan', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const TreatmentPlanItem = list({
  access: governed([...SALES]),
  fields: {
    plan: relationship({ ref: 'TreatmentPlan.items', ...readOnly }),
    estimateLine: relationship({ ref: 'EstimateLine', ...readOnly }),
    order: relationship({ ref: 'ClinicalOrder', ...readOnly }),
    description: systemText({ required: true }),
    status: lifecycle(['planned', 'ordered', 'done', 'cancelled']),
    /** What the plan expects this to cost (the planned line's high end, or the fee when ordered). */
    projectedMinor: minor({ required: true }),
    /** What was actually charged, once a charge exists. */
    chargedMinor: money(),
    version: versionField(),
    ...trackingFields,
  },
})

/** Written when the client agrees to a higher ceiling (or a veterinarian overrides in an emergency). Never edited. */
export const OverageApproval = list({
  access: immutable([...SALES]),
  fields: {
    plan: relationship({ ref: 'TreatmentPlan.overages', ...readOnly }),
    previousHighMinor: minor({ required: true }),
    newHighMinor: minor({ required: true }),
    method: fixedChoice(['in_person', 'phone_witnessed', 'esign_link', 'emergency_override']),
    approver: relationship({ ref: 'ClientPerson', ...readOnly }),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    emergencyOverrideBy: relationship({ ref: 'StaffMember', ...readOnly }),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    reason: systemText({ required: true }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const Deposit = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'client', 'requestedMinor', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    client: relationship({ ref: 'Client', ...readOnly }),
    estimate: relationship({ ref: 'Estimate', ...readOnly }),
    plan: relationship({ ref: 'TreatmentPlan', ...readOnly }),
    requestedMinor: minor({ required: true }),
    currencyCode: ccy(),
    status: lifecycle(['requested', 'paid', 'applied', 'refunded', 'forfeited']),
    payment: relationship({ ref: 'Payment', ...readOnly }),
    appliedInvoice: relationship({ ref: 'Invoice', ...readOnly }),
    appliedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

// ── Billing ─────────────────────────────────────────────────────────────────────────────────

export const ArPeriod = list({
  access: governed([...MONEY]),
  ui: { labelField: 'label' },
  fields: {
    label: systemText({ required: true }),
    startsOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    endsOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['open', 'closing', 'closed']),
    closedAt: timestamp({ ...readOnly }),
    closedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Invoice = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'client', 'status', 'totalMinor', 'balanceMinor', 'postedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    status: lifecycle(['draft', 'posted', 'partially_paid', 'paid', 'written_off']),
    postedAt: timestamp({ ...readOnly }),
    postedOn: calendarDay({ ...readOnly }),
    period: relationship({ ref: 'ArPeriod', ...readOnly }),
    currencyCode: ccy(),
    subtotalMinor: minor({ defaultValue: 0n }),
    discountMinor: minor({ defaultValue: 0n }),
    taxMinor: minor({ defaultValue: 0n }),
    totalMinor: minor({ defaultValue: 0n }),
    note: systemText(),
    /** What the client still owes: Σ the ledger for this invoice, never stored. */
    balanceMinor: virtual({ field: graphql.field({ type: graphql.String, async resolve(item, _a, context) { return (await balanceOfInvoice(context.prisma as never, (item as { id: string }).id)).toString() } }) }),
    lines: relationship({ ref: 'ChargeLine.invoice', many: true, ...readOnly }),
    allocations: relationship({ ref: 'PaymentAllocation.invoice', many: true, ...readOnly }),
    createdBy: relationship({ ref: 'StaffMember', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const CHARGE_SOURCES = ['administration', 'dispense', 'lab_order', 'imaging_order', 'treatment_task', 'encounter_exam', 'stay_day', 'boarding_night', 'groom', 'plan_period', 'plan_true_up', 'entitlement', 'product_sale', 'fee', 'manual', 'aftercare', 'memorial'] as const

export const ChargeLine = list({
  access: governed([...SALES]),
  ui: { listView: { initialColumns: ['description', 'patient', 'extendedMinor', 'sourceType', 'invoice'] } },
  fields: {
    invoice: relationship({ ref: 'Invoice.lines', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    encounter: relationship({ ref: 'Encounter', ...readOnly }),
    feeItem: relationship({ ref: 'FeeItem', ...readOnly }),
    description: systemText({ required: true }),
    qty: qty({ required: true }),
    unitPriceMinor: minor({ required: true }),
    extendedMinor: minor({ required: true }),
    discountMinor: minor({ defaultValue: 0n }),
    taxMinor: minor({ defaultValue: 0n }),
    taxCategory: systemText(),
    sourceType: fixedChoice(CHARGE_SOURCES),
    sourceId: systemText({ indexed: true }),
    manualReason: systemText(),
    performedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    planItem: relationship({ ref: 'TreatmentPlanItem', ...readOnly }),
    capturedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    reversedAt: timestamp({ ...readOnly }),
    reversalReason: systemText(),
    ...trackingFields,
  },
})

export const CreditNote = list({
  access: immutable([...SALES]),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    amountMinor: minor({ required: true }),
    currencyCode: ccy(),
    reason: systemText({ required: true }),
    postedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    postedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const PAYMENT_METHODS = ['card_present', 'card_on_file', 'payment_link', 'cash', 'check', 'ach', 'insurer_direct', 'financing', 'client_credit'] as const

export const Payment = list({
  access: governed([...MONEY, 'canBook']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'client', 'method', 'amountMinor', 'status', 'receivedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    method: fixedChoice(PAYMENT_METHODS),
    /** Which adapter took it: manual (cash, check, ACH), stripe, or a card reader. */
    provider: systemText(),
    amountMinor: minor({ required: true }),
    currencyCode: ccy(),
    status: lifecycle(['pending', 'succeeded', 'failed', 'unknown', 'voided']),
    reference: systemText(),
    providerRef: systemText({ indexed: true, secret: true }),
    payerAuthorization: relationship({ ref: 'PayerAuthorization', ...readOnly }),
    /** What the payment is for; it is allocated here when it goes through. */
    forInvoice: relationship({ ref: 'Invoice', ...readOnly }),
    forDeposit: relationship({ ref: 'Deposit', ...readOnly }),
    allowOverpay: checkbox({ defaultValue: false, ...readOnly }),
    postedOn: calendarDay({ ...readOnly }),
    /** A card payment link the client can open (copyable). */
    linkUrl: systemText({ secret: true }),
    receivedAt: timestamp({ ...readOnly }),
    receivedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    /** What the client was told about this payment, in words (failure, waiting on the bank, …). */
    note: systemText(),
    allocatedMinor: virtual({ field: graphql.field({ type: graphql.String, async resolve(item, _a, context) { return (await paymentTotals(context.prisma as never, (item as { id: string }).id)).allocated.toString() } }) }),
    refundedMinor: virtual({ field: graphql.field({ type: graphql.String, async resolve(item, _a, context) { return (await paymentTotals(context.prisma as never, (item as { id: string }).id)).refunded.toString() } }) }),
    attempts: relationship({ ref: 'PaymentAttempt.payment', many: true, ...readOnly }),
    allocations: relationship({ ref: 'PaymentAllocation.payment', many: true, ...readOnly }),
    refunds: relationship({ ref: 'Refund.payment', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const PaymentAttempt = list({
  access: governed([...MONEY]),
  fields: {
    payment: relationship({ ref: 'Payment.attempts', ...readOnly }),
    status: lifecycle(['created', 'processing', 'succeeded', 'failed', 'requires_action', 'unknown']),
    /** Sent to the processor with the charge; asking again with it can never charge twice. */
    providerIdempotencyKey: systemText({ indexed: 'unique', required: true, secret: true }),
    providerRef: systemText({ secret: true }),
    amountMinor: minor({ required: true }),
    message: systemText(),
    startedAt: timestamp({ ...readOnly }),
    resolvedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** How much of a payment went to which invoice (or deposit). Never edited (G7). */
export const PaymentAllocation = list({
  access: immutable([...MONEY]),
  fields: {
    payment: relationship({ ref: 'Payment.allocations', ...readOnly }),
    invoice: relationship({ ref: 'Invoice.allocations', ...readOnly }),
    deposit: relationship({ ref: 'Deposit', ...readOnly }),
    amountMinor: minor({ required: true }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const Refund = list({
  access: governed([...MONEY]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'payment', 'amountMinor', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    payment: relationship({ ref: 'Payment.refunds', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    amountMinor: minor({ required: true }),
    currencyCode: ccy(),
    reason: systemText({ required: true }),
    status: lifecycle(['requested', 'approved', 'processing', 'succeeded', 'failed', 'unknown', 'rejected']),
    providerIdempotencyKey: systemText({ indexed: 'unique', secret: true }),
    providerRef: systemText({ secret: true }),
    message: systemText(),
    requestedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    approval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    processedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Every event the processor sent, kept once by its own id; a repeat is recorded as seen and does nothing. */
export const PaymentWebhookEvent = list({
  access: governed(['canManageIntegrations', 'canManagePayments']),
  fields: {
    provider: systemText({ indexed: true, required: true }),
    eventId: systemText({ required: true, secret: true }),
    type: systemText({ required: true }),
    objectRef: systemText({ secret: true }),
    outcome: systemText(),
    receivedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    duplicates: integer({ ...readOnly, defaultValue: 0 }),
  },
})

export const LEDGER_KINDS = [
  'invoice', 'payment', 'payment_unallocated', 'deposit_received', 'deposit_released', 'deposit_applied', 'refund', 'credit_note', 'write_off', 'adjustment',
] as const

/** Debits are positive, credits negative. An invoice's balance is the sum of its entries; the table never changes. */
export const ClientLedgerEntry = list({
  access: immutable([...MONEY]),
  ui: { listView: { initialColumns: ['postedOn', 'client', 'kind', 'amountMinor', 'invoice'] } },
  fields: {
    client: relationship({ ref: 'Client', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    payment: relationship({ ref: 'Payment', ...readOnly }),
    kind: fixedChoice(LEDGER_KINDS),
    amountMinor: minor({ required: true }),
    currencyCode: ccy(),
    postedOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    period: relationship({ ref: 'ArPeriod', ...readOnly }),
    /** Unique per cause, so posting the same thing twice cannot add a second entry. */
    entryKey: systemText({ indexed: 'unique', required: true, secret: true }),
    memo: systemText(),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

// ── Insurance ───────────────────────────────────────────────────────────────────────────────

export const PayerAuthorization = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    payer: relationship({ ref: 'ThirdPartyPayer', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    policy: relationship({ ref: 'PetInsurancePolicy', ...readOnly }),
    requestedMinor: minor({ required: true }),
    authorisedMinor: money(),
    status: lifecycle(['requested', 'authorised', 'paid', 'expired', 'denied']),
    externalRef: systemText(),
    validUntil: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** A claim packet is assembled for download or print; nothing is sent from here. Only released documents go in. */
export const InsuranceClaimPacket = list({
  access: governed([...SALES]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'policy', 'status', 'approvedMinor'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    policy: relationship({ ref: 'PetInsurancePolicy', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    recordsRelease: relationship({ ref: 'RecordsRelease', ...readOnly }),
    // Filter and sort take the same check as read: a where on hidden text is an oracle for it.
    formFields: json({ ...readOnly, access: { ...readOnly.access, read: permissions.canReadClinical }, isFilterable: permissions.canReadClinical, isOrderable: permissions.canReadClinical, defaultValue: {} }),
    /** [{documentId, title, sha256}] — exactly what the release listed. */
    documents: json({ ...readOnly, defaultValue: [] }),
    submitter: fixedChoice(['client', 'clinic']),
    status: lifecycle(['draft', 'ready', 'submitted', 'under_review', 'more_info_requested', 'approved', 'denied']),
    approvedMinor: money(),
    paidTo: text({ db: { isNullable: true }, access: { create: () => false, update: () => false }, ui: { createView: { fieldMode: 'hidden' }, itemView: { fieldMode: 'read' } } }),
    statusNote: systemText(),
    packetBody: text({ ...readOnly, access: { ...readOnly.access, read: permissions.canReadClinical }, isFilterable: permissions.canReadClinical, isOrderable: permissions.canReadClinical, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    packetSha256: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const BILLING_LISTS = {
  FeeSchedule, FeeScheduleVersion, FeeItem, PriceRule,
  Estimate, EstimateVersion, EstimateOption, EstimateLine, EstimateAcceptance, TreatmentPlan, TreatmentPlanItem, OverageApproval, Deposit,
  ArPeriod, Invoice, ChargeLine, CreditNote, Payment, PaymentAttempt, PaymentAllocation, Refund, PaymentWebhookEvent, ClientLedgerEntry,
  PayerAuthorization, InsuranceClaimPacket,
}
