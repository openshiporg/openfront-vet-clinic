import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, relationship, text, timestamp } from '@keystone-6/core/fields'
import { fixedChoice, lifecycle, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed, serverOnly } from './listAccess'
import { trackingFields } from './trackingFields'

/* Policy packs, compliance clocks, work queues and retention (SCHEMA §16-§17; DOMAIN §6-§7). */

const POLICY_KINDS = [
  'medical_records', 'vcpr', 'confidentiality', 'controlled_substances', 'prescription', 'rabies', 'supervision',
  'telehealth', 'contact', 'auto_renewal', 'sales_tax', 'boarding', 'licensure',
] as const

/** A jurisdiction's rules of one kind (US = federal baseline, US-CA = California). */
export const PolicyPack = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'code', listView: { initialColumns: ['code', 'kind', 'jurisdiction', 'name'] } },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(POLICY_KINDS),
    jurisdiction: systemText({ indexed: true, required: true }),
    versions: relationship({ ref: 'PolicyVersion.pack', many: true, ...readOnly }),
    ...trackingFields,
  },
})

/**
 * An effective-dated, immutable set of rules (G7). Validated by the kind's Zod schema before it is
 * stored. `verified` false means at least one rule is marked (verify) against its source and the
 * dashboard shows a banner wherever the version is applied.
 */
export const PolicyVersion = list({
  access: immutable('canAccessDashboard'),
  ui: { labelField: 'label', listView: { initialColumns: ['pack', 'label', 'status', 'effectiveFrom', 'effectiveTo', 'verified'] } },
  fields: {
    pack: relationship({ ref: 'PolicyPack.versions', ...readOnly }),
    label: systemText({ required: true }),
    versionNumber: integer({ ...readOnly, validation: { isRequired: true } }),
    rules: json({ ...readOnly }),
    rulesHash: systemText({ required: true }),
    sourceRefs: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Citations: [{ ref, title, url, section }].' } }),
    verified: checkbox({ ...readOnly, defaultValue: false }),
    unverifiedRules: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Rule paths still marked (verify).' } }),
    verifiedAt: timestamp({ ...readOnly }),
    effectiveFrom: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    effectiveTo: calendarDay({ ...readOnly }),
    status: lifecycle(['draft', 'published', 'superseded']),
    approval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    publishedAt: timestamp({ ...readOnly }),
    publishedBy: relationship({ ref: 'User', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Which pack applies where. A location in US-CA binds the US and US-CA packs of each kind. */
export const PolicyBinding = list({
  access: governed('canAccessDashboard'),
  fields: {
    pack: relationship({ ref: 'PolicyPack', ...readOnly }),
    scope: fixedChoice(['practice', 'location']),
    location: relationship({ ref: 'Location', ...readOnly }),
    layer: fixedChoice(['federal', 'state', 'local']),
    ...trackingFields,
  },
})

/** A legal or regulatory clock (D§6.3): created by the event that starts it, escalated by the scheduler. */
export const ComplianceTask = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'title', listView: { initialColumns: ['kind', 'title', 'location', 'dueAt', 'status'], initialSort: { field: 'dueAt', direction: 'ASC' } } },
  fields: {
    kind: fixedChoice([
      'dea_theft_loss_notice', 'dea_form_106', 'dea_biennial_inventory', 'dea_222_validity', 'pdmp_report', 'dea_registration_expiry',
      'licence_expiry', 'records_request_response', 'rabies_bite_observation', 'vcpr_expiry', 'refill_request_sla', 'lab_result_review',
      'estimate_expiry', 'wellness_renewal_notice', 'retention_disposition', 'policy_review',
    ]),
    title: systemText({ required: true }),
    subjectType: systemText(),
    subjectId: systemText({ indexed: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    startedAt: timestamp({ ...readOnly }),
    dueAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    dedupeKey: systemText({ indexed: 'unique' }),
    escalations: json({ ...readOnly }),
    status: lifecycle(['open', 'done', 'overdue', 'waived']),
    evidence: json({ ...readOnly }),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    completedAt: timestamp({ ...readOnly }),
    completedBy: relationship({ ref: 'User', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** A unit of staff work (call back, review a refill, finish a record). */
export const Task = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'title', listView: { initialColumns: ['title', 'kind', 'priority', 'assignee', 'dueAt', 'status'], initialSort: { field: 'dueAt', direction: 'ASC' } } },
  fields: {
    ref: systemText({ indexed: 'unique' }),
    kind: fixedChoice(['call_back', 'refill_review', 'result_review', 'record_unsigned', 'records_request', 'registration_review', 'follow_up', 'agent_handoff', 'general']),
    title: systemText({ required: true }),
    detail: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    subjectType: systemText(),
    subjectId: systemText({ indexed: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    assignee: relationship({ ref: 'StaffMember', ...readOnly }),
    roleName: systemText(),
    priority: fixedChoice(['urgent', 'high', 'normal', 'low']),
    dueAt: timestamp({ ...readOnly }),
    status: lifecycle(['open', 'in_progress', 'done', 'cancelled']),
    createdByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    createdByUser: relationship({ ref: 'User', ...readOnly }),
    completedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Note = list({
  access: governed('canAccessDashboard'),
  fields: {
    subjectType: systemText({ required: true }),
    subjectId: systemText({ indexed: true, required: true }),
    body: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    visibility: fixedChoice(['staff', 'clinical']),
    author: relationship({ ref: 'User', ...readOnly }),
    authorAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    ...trackingFields,
  },
})

export const Tag = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'name' },
  fields: {
    name: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    colour: text(),
    appliesTo: fixedChoice(['client', 'patient', 'appointment', 'any']),
    ...trackingFields,
  },
})

/** Freezes disposition of the named records (I-G5). */
export const LegalHold = list({
  access: governed('canReadAudit'),
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    reason: systemText({ required: true }),
    subjectType: systemText({ required: true }),
    subjectId: systemText({ indexed: true, required: true }),
    placedBy: relationship({ ref: 'User', ...readOnly }),
    placedAt: timestamp({ ...readOnly }),
    releasedBy: relationship({ ref: 'User', ...readOnly }),
    releasedAt: timestamp({ ...readOnly }),
    status: lifecycle(['active', 'released']),
    version: versionField(),
    ...trackingFields,
  },
})

/** Retention per record class, derived from the policy packs (the longest applicable rule wins). */
export const RetentionPolicy = list({
  access: governed('canAccessDashboard'),
  fields: {
    recordClass: systemText({ indexed: 'unique', required: true }),
    retainYears: integer({ ...readOnly, validation: { isRequired: true, min: 1 } }),
    from: fixedChoice(['last_visit', 'record_date', 'death', 'account_closed']),
    policyVersion: relationship({ ref: 'PolicyVersion', ...readOnly }),
    ...trackingFields,
  },
})

/** Security, privacy or safety incident (lost device, misdirected record, CS theft escalation). */
export const Incident = list({
  access: governed('canReadAudit'),
  ui: { labelField: 'title' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    kind: fixedChoice(['privacy', 'security', 'controlled_substance', 'patient_safety', 'other']),
    title: systemText({ required: true }),
    detail: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    location: relationship({ ref: 'Location', ...readOnly }),
    discoveredAt: timestamp({ ...readOnly }),
    status: lifecycle(['open', 'investigating', 'reported', 'closed']),
    version: versionField(),
    ...trackingFields,
  },
})

/** Server-to-server credential (lab and telephony webhooks, cabinet feeds). Only a hash is stored. */
export const MachineCredential = list({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    name: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    purpose: text({ validation: { isRequired: true } }),
    secretHash: text({ validation: { isRequired: true } }),
    lastUsedAt: timestamp(),
    revokedAt: timestamp(),
    ...trackingFields,
  },
})
