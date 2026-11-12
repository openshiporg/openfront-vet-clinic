import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, hiddenHash, lifecycle, minor, qty, readOnly, systemText, versionField } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Phase 5, wellness plans (STATE-MACHINES §12). A plan version is frozen once published. An enrolment records the
 * auto-renewal disclosure and the client's consent append-only. Monthly billing is a staff button: one attempt per
 * (enrolment, period, generation), and a database index allows only one attempt per period that is not a failed one,
 * so a crash, a retry or two presses at once can never charge twice. The entitlement ledger is append-only and a
 * trigger keeps every grant between zero and what it was granted.
 */

const CATALOG = ['canAccessDashboard'] as const
const ENROL = ['canTakePayments', 'canPostInvoices', 'canViewFinance', 'canManagePayments', 'canBook', 'canCheckIn', 'canManagePractice'] as const
const MONEY = ['canTakePayments', 'canPostInvoices', 'canViewFinance', 'canManagePayments', 'canManagePractice'] as const

export const ENROLLMENT_STATES = ['pending_payment', 'active', 'cancelling', 'cancelled', 'suspended', 'completed', 'ended_by_death'] as const

export const WellnessPlan = list({
  access: governed([...CATALOG]),
  ui: { labelField: 'name', listView: { initialColumns: ['code', 'name', 'status'] } },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    summary: systemText(),
    status: lifecycle(['active', 'retired']),
    version: versionField(),
    ...trackingFields,
  },
})

export const WellnessPlanVersion = list({
  access: governed([...CATALOG]),
  ui: { labelField: 'label', listView: { initialColumns: ['plan', 'versionNo', 'label', 'monthlyPriceMinor', 'status'] } },
  fields: {
    plan: relationship({ ref: 'WellnessPlan', ...readOnly }),
    versionNo: integer({ ...readOnly, validation: { isRequired: true } }),
    label: systemText({ required: true }),
    status: lifecycle(['draft', 'published', 'retired']),
    monthlyPriceMinor: minor({ required: true }),
    termMonths: integer({ ...readOnly, validation: { isRequired: true } }),
    speciesCodes: json({ ...readOnly }),
    minAgeWeeks: integer({ ...readOnly, defaultValue: 0 }),
    maxAgeMonths: integer({ ...readOnly }),
    /** [{ code, label, qty, retailMinor }]: what a member gets each term, and what it is worth at the regular fee. */
    entitlements: json({ ...readOnly }),
    otherServicesDiscountBps: integer({ ...readOnly, defaultValue: 0 }),
    trueUpNote: systemText(),
    disclosure: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    publishedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Enrollment = list({
  access: governed([...ENROL]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'client', 'planVersion', 'status', 'termEndsOn'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    plan: relationship({ ref: 'WellnessPlan', ...readOnly }),
    planVersion: relationship({ ref: 'WellnessPlanVersion', ...readOnly }),
    status: lifecycle(ENROLLMENT_STATES),
    startedOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    termNo: integer({ ...readOnly, defaultValue: 1 }),
    termStartsOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    termEndsOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    autoRenew: checkbox({ ...readOnly, defaultValue: true }),
    /** What staff see of the saved card ("Visa ending 4242"). The processor references below are never readable. */
    cardLabel: systemText(),
    customerRef: hiddenHash(),
    paymentMethodRef: hiddenHash(),
    /** Goes up each time the card is replaced: Retry needs a card newer than the one that was declined. */
    cardVersion: integer({ ...readOnly, defaultValue: 1 }),
    consent: relationship({ ref: 'EnrollmentConsent', ...readOnly }),
    cancelRequestedAt: timestamp({ ...readOnly }),
    cancelReason: systemText(),
    trueUpMinor: minor({ defaultValue: 0n }),
    trueUpWaived: checkbox({ ...readOnly, defaultValue: false }),
    trueUpInvoice: relationship({ ref: 'Invoice', ...readOnly }),
    endedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Append-only: the disclosure shown, its hash, who agreed, how, and the card set-up (SetupIntent) reference. */
export const EnrollmentConsent = list({
  access: governed([...ENROL]),
  ui: { listView: { initialColumns: ['enrollment', 'signer', 'method', 'consentedAt'] } },
  fields: {
    enrollment: relationship({ ref: 'Enrollment', ...readOnly }),
    signer: relationship({ ref: 'ClientPerson', ...readOnly }),
    disclosureText: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    disclosureHash: systemText({ required: true }),
    terms: json({ ...readOnly }),
    method: fixedChoice(['in_person', 'portal', 'phone_recorded']),
    affirmed: checkbox({ ...readOnly, defaultValue: false }),
    setupIntentRef: hiddenHash(),
    consentedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const EntitlementGrant = list({
  access: governed([...ENROL]),
  ui: { listView: { initialColumns: ['enrollment', 'termNo', 'label', 'qtyGranted'] } },
  fields: {
    enrollment: relationship({ ref: 'Enrollment', ...readOnly }),
    termNo: integer({ ...readOnly, validation: { isRequired: true } }),
    code: systemText({ required: true }),
    label: systemText({ required: true }),
    qtyGranted: qty({ required: true }),
    retailValueMinor: minor({ required: true }),
    ...trackingFields,
  },
})

/** Append-only ledger: a debit uses an entitlement, a credit gives one back. A grant can never go below zero or above what it was granted. */
export const EntitlementEntry = list({
  access: governed([...ENROL]),
  ui: { listView: { initialColumns: ['grant', 'kind', 'qty', 'at', 'memo'] } },
  fields: {
    entryKey: systemText({ indexed: 'unique', required: true }),
    grant: relationship({ ref: 'EntitlementGrant', ...readOnly }),
    enrollment: relationship({ ref: 'Enrollment', ...readOnly }),
    kind: fixedChoice(['debit', 'credit']),
    qty: qty({ required: true }),
    valueMinor: minor({ defaultValue: 0n }),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    memo: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/** One press of "Run billing". It finishes in the request; its total is the sum of the charges that went through. */
export const PlanBillingRun = list({
  access: governed([...MONEY]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'periodKey', 'attemptCount', 'succeededCount', 'failedCount', 'totalMinor', 'finishedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    runKey: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    periodKey: systemText({ indexed: true, required: true }),
    status: fixedChoice(['completed']),
    attemptCount: integer({ ...readOnly, defaultValue: 0 }),
    succeededCount: integer({ ...readOnly, defaultValue: 0 }),
    failedCount: integer({ ...readOnly, defaultValue: 0 }),
    openCount: integer({ ...readOnly, defaultValue: 0 }),
    skippedCount: integer({ ...readOnly, defaultValue: 0 }),
    totalMinor: minor({ defaultValue: 0n }),
    summary: json({ ...readOnly }),
    startedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    finishedAt: timestamp({ ...readOnly }),
    ...trackingFields,
  },
})

export const PlanBillingAttempt = list({
  access: governed([...MONEY]),
  ui: { listView: { initialColumns: ['enrollment', 'periodKey', 'generation', 'status', 'amountMinor', 'startedAt'] } },
  fields: {
    enrollment: relationship({ ref: 'Enrollment', ...readOnly }),
    periodKey: systemText({ indexed: true, required: true }),
    generation: integer({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['processing', 'succeeded', 'failed', 'unknown']),
    amountMinor: minor({ required: true }),
    cardVersion: integer({ ...readOnly, defaultValue: 1 }),
    termNo: integer({ ...readOnly, defaultValue: 1 }),
    payment: relationship({ ref: 'Payment', ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    /** The press of "Run billing" that made this attempt; the run row is written when the press finishes. */
    runKey: systemText({ indexed: true }),
    message: systemText(),
    retryNote: systemText(),
    startedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    finishedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const WELLNESS_LISTS = { WellnessPlan, WellnessPlanVersion, Enrollment, EnrollmentConsent, EntitlementGrant, EntitlementEntry, PlanBillingRun, PlanBillingAttempt }
