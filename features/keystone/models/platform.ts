import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, select, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { approvalPermissions, hasPermission, permissions } from '../access'
import { choice, fixedChoice, hiddenHash, lifecycle, minor, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed, serverOnly } from './listAccess'
import { trackingFields } from './trackingFields'

/* Platform spine (SCHEMA §18-§19; ported from the Openfront platform spine). The calendar day list is named
   CalendarException because the GraphQL scalar CalendarDay is reserved. */

export const AgentIdentity = list({
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManageAgents, update: () => false, delete: () => false } },
  ui: { labelField: 'name' },
  fields: {
    name: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
    kind: choice(['voice_receptionist', 'sms_receptionist', 'scribe', 'charge_capture', 'insights', 'external_mcp_client'], 'voice_receptionist'),
    model: text(),
    provider: text(),
    owner: relationship({ ref: 'User' }),
    status: lifecycle(['active', 'paused', 'revoked']),
    killSwitch: checkbox({ ...readOnly, defaultValue: false, ui: { ...readOnly.ui, description: 'On: every tool call is refused at once (setAgentKillSwitch).' } }),
    limits: json({ ...readOnly, defaultValue: { toolCallsPerRun: 40 } }),
    oauthApp: relationship({ ref: 'OAuthApp' }),
    grants: relationship({ ref: 'AgentToolGrant.agent', many: true, ...readOnly }),
    runs: relationship({ ref: 'AgentRun.agent', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const AuditEvent = list({
  access: immutable('canReadAudit'),
  ui: { labelField: 'eventType', listView: { initialColumns: ['seq', 'at', 'eventType', 'entityType', 'entityId', 'actorUser'], initialSort: { field: 'seq', direction: 'DESC' } } },
  fields: {
    seq: integer({ isIndexed: 'unique', validation: { isRequired: true }, ...readOnly }),
    eventKey: systemText({ indexed: 'unique', required: true }),
    eventType: systemText({ indexed: true, required: true }),
    entityType: systemText({ indexed: true, required: true }),
    entityId: systemText({ indexed: true, required: true }),
    actorUser: relationship({ ref: 'User', ...readOnly }),
    actorAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    approver: relationship({ ref: 'User', ...readOnly }),
    reason: systemText(),
    before: json({ ...readOnly }),
    after: json({ ...readOnly }),
    metadata: json({ ...readOnly }),
    requestId: systemText(),
    prevHash: systemText({ required: true }),
    hash: systemText({ indexed: 'unique', required: true }),
    at: timestamp({ validation: { isRequired: true }, defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const CommandReceipt = list({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    idempotencyKey: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    command: text({ validation: { isRequired: true } }),
    principalKey: text({ validation: { isRequired: true } }),
    requestHash: text({ validation: { isRequired: true } }),
    requestParams: json(),
    responseCode: text(),
    responseBody: json(),
    recoveryPoint: text({ defaultValue: 'completed' }),
    completedAt: timestamp({ defaultValue: { kind: 'now' } }),
    ...trackingFields,
  },
})

export const Sequence = list({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    key: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    nextValue: integer({ defaultValue: 1, validation: { isRequired: true } }),
  },
})

export const Notification = list({
  access: {
    operation: { query: permissions.canAccessDashboard, create: () => false, update: permissions.canAccessDashboard, delete: () => false },
    filter: {
      query: ({ session }) => (session ? { recipient: { id: { equals: session.itemId } } } : false),
      update: ({ session }) => (session ? { recipient: { id: { equals: session.itemId } } } : false),
    },
  },
  fields: {
    recipient: relationship({ ref: 'User', ...readOnly }),
    channel: choice(['in_app', 'email'], 'in_app'),
    template: systemText({ required: true }),
    payload: json({ ...readOnly }),
    status: lifecycle(['pending', 'sent', 'failed']),
    sentAt: timestamp({ ...readOnly }),
    readAt: timestamp(),
    ...trackingFields,
  },
})

export const BusinessCalendar = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'code' },
  fields: {
    code: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    name: text(),
    timeZone: text({ validation: { isRequired: true }, defaultValue: 'America/Los_Angeles' }),
    kind: choice(['federal', 'state', 'location'], 'location'),
    weekendDays: json({ defaultValue: [0, 6] }),
    regularOpen: text({ defaultValue: '08:00', ui: { description: 'HH:mm local' } }),
    regularClose: text({ defaultValue: '18:00', ui: { description: 'HH:mm local' } }),
    composedOf: relationship({ ref: 'BusinessCalendar', many: true, ui: { description: 'Holidays of these calendars also apply (a location calendar composes the federal one).' } }),
    exceptions: relationship({ ref: "CalendarException.calendar", many: true }),
    coverageThrough: calendarDay({ ui: { description: 'Scheduling past this date is blocked.' } }),
    source: text({ ui: { description: 'Where the holiday table came from and when it was checked.' } }),
    ...trackingFields,
  },
})

export const CalendarException = list({
  access: managed('signedIn', 'canManagePractice'),
  ui: { labelField: 'date', listView: { initialColumns: ['calendar', 'date', 'kind', 'closeAt', 'note'] } },
  fields: {
    calendar: relationship({ ref: 'BusinessCalendar.exceptions' }),
    date: calendarDay({ validation: { isRequired: true } }),
    kind: choice(['holiday', 'early_close', 'special_open', 'closed'], 'holiday'),
    openAt: text(),
    closeAt: text(),
    note: text(),
    ...trackingFields,
  },
})

export const ApprovalPolicy = list({
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: () => false, delete: () => false } },
  ui: { labelField: 'action' },
  fields: {
    action: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    description: text(),
    requiredPermission: text({ validation: { isRequired: true } }),
    minApprovals: integer({ defaultValue: 1, validation: { min: 1 } }),
    thresholdMinor: minor(),
    expiresAfterMinutes: integer({ defaultValue: 1440 }),
    ...trackingFields,
  },
})

/* Review r5 #6: a request's summary and payload carry the thing being approved (practice settings changes,
   void reasons). Only people who can approve something read every request; anyone else sees their own. */
const canDecideSomething = (session: any) => approvalPermissions.some(name => hasPermission(session, name))
export const ApprovalRequest = list({
  access: {
    ...governed('canAccessDashboard'),
    filter: { query: ({ session }: any) => (canDecideSomething(session) ? true : session?.itemId ? { requestedBy: { id: { equals: session.itemId } } } : false) },
  },
  ui: { labelField: 'action', listView: { initialColumns: ['action', 'status', 'targetList', 'requestedBy', 'createdAt', 'expiresAt'] } },
  fields: {
    action: systemText({ indexed: true, required: true }),
    summary: systemText(),
    targetList: systemText({ required: true }),
    targetId: systemText({ indexed: true, required: true }),
    payload: json({ ...readOnly }),
    payloadHash: hiddenHash({ required: true }),
    requiredPermission: systemText({ required: true }),
    requestedBy: relationship({ ref: 'User', ...readOnly }),
    requestedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    status: lifecycle(['pending', 'approved', 'rejected', 'expired', 'cancelled']),
    expiresAt: timestamp({ ...readOnly }),
    consumedAt: timestamp({ ...readOnly, ui: { ...readOnly.ui, description: 'When the approved action was carried out. An approval is used once.' } }),
    decisions: relationship({ ref: 'ApprovalDecision.request', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/* Review r6 #4: a decision's reason can repeat the request's payload (a void reason, a settings change), so a
   decision is read by the same people as its request: approvers, the requester, and the person who decided it. */
export const ApprovalDecision = list({
  access: {
    ...immutable('canAccessDashboard'),
    filter: {
      query: ({ session }: any) => (canDecideSomething(session) ? true : session?.itemId
        ? { OR: [{ decidedBy: { id: { equals: session.itemId } } }, { request: { requestedBy: { id: { equals: session.itemId } } } }] }
        : false),
    },
  },
  fields: {
    request: relationship({ ref: 'ApprovalRequest.decisions', ...readOnly }),
    decidedBy: relationship({ ref: 'User', ...readOnly }),
    decision: select({ type: 'string', options: ['approve', 'reject'].map(value => ({ label: value, value })), validation: { isRequired: true }, ...readOnly }),
    reason: systemText(),
    at: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

export const Document = list({
  access: governed('canAccessDashboard'),
  fields: {
    title: text({ validation: { isRequired: true } }),
    kind: choice(['dea_form', 'licence', 'policy', 'consent', 'certificate', 'records_packet', 'invoice', 'statement', 'report', 'import', 'other'], 'other'),
    storageKey: systemText(),
    sha256: systemText(),
    mimeType: systemText(),
    sizeBytes: integer({ ...readOnly }),
    documentVersion: integer({ defaultValue: 1, ...readOnly }),
    supersedes: relationship({ ref: 'Document', ...readOnly }),
    visibility: choice(['internal', 'client', 'public'], 'internal'),
    retentionUntil: calendarDay(),
    signedAt: timestamp({ ...readOnly }),
    esignEnvelopeId: systemText(),
    /** The file itself (base64) when the database is the store (storageKey "db:<sha256>"); never returned by the API. */
    content: hiddenHash(),
    ...trackingFields,
  },
})

export const SecretBox = list({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    purpose: text({ validation: { isRequired: true } }),
    ciphertext: text({ validation: { isRequired: true } }),
    iv: text({ validation: { isRequired: true } }),
    authTag: text({ validation: { isRequired: true } }),
    keyVersion: integer({ defaultValue: 1 }),
    ...trackingFields,
  },
})

/**
 * Who read which clinical record, and why (G11; hospital PhiReadAudit port). Written in the same
 * request as the read by domain queries and agent tools; never updated or deleted.
 */
export const ReadAudit = list({
  access: immutable('canReadAudit'),
  ui: { listView: { initialColumns: ['at', 'actorKind', 'actorLabel', 'resourceType', 'resourceId', 'purpose'], initialSort: { field: 'at', direction: 'DESC' } } },
  fields: {
    actorKind: fixedChoice(['user', 'agent', 'system', 'portal']),
    actorId: systemText({ indexed: true, required: true }),
    actorLabel: systemText(),
    patientId: systemText({ indexed: true }),
    clientId: systemText({ indexed: true }),
    resourceType: systemText({ indexed: true, required: true }),
    resourceId: systemText({ indexed: true }),
    purpose: fixedChoice(['treatment', 'operations', 'records_request', 'agent_tool', 'audit', 'break_glass']),
    fields: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Field names returned (never values).' } }),
    requestId: systemText(),
    at: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})

/** A recorded break-glass override: who, what, why; reviewed afterwards by a second person. */
export const BreakGlassEvent = list({
  access: governed('canReadAudit'),
  fields: {
    user: relationship({ ref: 'User', ...readOnly }),
    resourceType: systemText({ required: true }),
    resourceId: systemText({ required: true }),
    reason: systemText({ required: true }),
    status: lifecycle(['open', 'reviewed', 'escalated']),
    reviewedBy: relationship({ ref: 'User', ...readOnly }),
    reviewedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** Raw inbound provider payloads (webhooks, imports), deduplicated before any business effect. */
export const ProviderObservation = list({
  access: governed('canManageIntegrations'),
  fields: {
    source: systemText({ indexed: true, required: true }),
    connectionId: systemText(),
    externalId: systemText({ indexed: true }),
    contentHash: systemText({ required: true, secret: true }),
    payload: json({ ...readOnly }),
    receivedAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
    processedAt: timestamp({ ...readOnly }),
    status: lifecycle(['received', 'processed', 'ignored', 'failed']),
    ...trackingFields,
  },
})

/** A provider connection (payments, telephony, lab, PDMP...). Credentials live in SecretBox, never here (G10). */
export const IntegrationConnection = list({
  access: governed('canManageIntegrations'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'area', 'providerKey', 'mode', 'status', 'lastHealthAt'] } },
  fields: {
    name: systemText({ required: true }),
    area: fixedChoice(['payments', 'telephony', 'voice_agent', 'lab', 'imaging', 'pharmacy', 'pdmp', 'csos', 'cabinet', 'insurance', 'accounting', 'payroll', 'scribe', 'crematory', 'email']),
    providerKey: systemText({ required: true }),
    mode: fixedChoice(['manual', 'test', 'live']),
    location: relationship({ ref: 'Location', ...readOnly }),
    /** Name of the SecretBox entry holding the credential; the secret itself never leaves the server. */
    secretRef: systemText({ secret: true }),
    capabilityProfile: json({ ...readOnly }),
    status: lifecycle(['active', 'paused', 'error', 'retired']),
    lastHealthAt: timestamp({ ...readOnly }),
    lastError: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** External identifiers for any record (ezyVet ids, Avimark codes, Stripe ids). */
export const ExternalId = list({
  access: governed('canAccessDashboard'),
  fields: {
    system: systemText({ indexed: true, required: true }),
    recordType: systemText({ required: true }),
    recordId: systemText({ indexed: true, required: true }),
    value: systemText({ required: true }),
    ...trackingFields,
  },
})
