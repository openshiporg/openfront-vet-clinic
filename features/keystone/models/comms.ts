import { list } from '@keystone-6/core'
import { checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { choice, fixedChoice, lifecycle, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed, serverOnly } from './listAccess'
import { trackingFields } from './trackingFields'

/* Communications, calls and the public/portal API state (SCHEMA §16, §18, §19). Free text from
   clients (SMS bodies, transcripts) is stored as received and treated as untrusted data: it is never
   rendered as HTML and is wrapped before it reaches any agent prompt (INTEGRATIONS §0.4). */

const COMMS_READ = ['canMessageClients', 'canManageClients', 'canBook'] as const

export const CommsThread = list({
  access: governed([...COMMS_READ]),
  ui: { labelField: 'subject', listView: { initialColumns: ['client', 'channel', 'status', 'lastMessageAt'] } },
  fields: {
    client: relationship({ ref: 'Client', ...readOnly }),
    contactPoint: relationship({ ref: 'ContactPoint', ...readOnly }),
    channel: fixedChoice(['sms', 'email', 'voice', 'portal']),
    subject: systemText(),
    status: lifecycle(['open', 'waiting_client', 'waiting_staff', 'closed']),
    assignedTo: relationship({ ref: 'StaffMember', ...readOnly }),
    lastMessageAt: timestamp({ ...readOnly }),
    messages: relationship({ ref: 'CommsMessage.thread', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/**
 * One message. Outbound messages are queued in the same transaction as their cause and sent by the
 * messaging worker after the send-time guard (patient alive, consent, suppression, quiet hours).
 */
export const CommsMessage = list({
  access: governed([...COMMS_READ]),
  ui: { listView: { initialColumns: ['thread', 'direction', 'purpose', 'status', 'createdAt'] } },
  fields: {
    thread: relationship({ ref: 'CommsThread.messages', ...readOnly }),
    direction: fixedChoice(['inbound', 'outbound']),
    purpose: fixedChoice(['care', 'transactional', 'marketing']),
    templateCode: systemText(),
    to: systemText(),
    from: systemText(),
    body: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    status: lifecycle(['queued', 'sending', 'sent', 'delivered', 'failed', 'blocked', 'received']),
    blockedReason: systemText(),
    providerId: systemText({ indexed: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    appointment: relationship({ ref: 'Appointment', ...readOnly }),
    sentAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const MessageTemplate = list({
  access: managed('canAccessDashboard', 'canManageTemplates'),
  ui: { labelField: 'code', listView: { initialColumns: ['code', 'purpose', 'channel', 'locale', 'templateVersion'] } },
  fields: {
    code: text({ validation: { isRequired: true } }),
    purpose: choice(['care', 'transactional', 'marketing']),
    channel: choice(['sms', 'email', 'voice']),
    locale: text({ defaultValue: 'en-US' }),
    body: text({ validation: { isRequired: true }, ui: { displayMode: 'textarea', description: 'Placeholders: {{practice}}, {{pet}}, {{when}}, {{location}}, {{ref}}.' } }),
    templateVersion: integer({ defaultValue: 1 }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** A call, answered by the AI receptionist or staff. The transcript is untrusted text. */
export const CallRecord = list({
  access: governed([...COMMS_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'startedAt', 'from', 'answeredBy', 'disposition', 'status'], initialSort: { field: 'startedAt', direction: 'DESC' } } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    direction: fixedChoice(['inbound', 'outbound']),
    from: systemText({ required: true }),
    to: systemText({ required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    person: relationship({ ref: 'ClientPerson', ...readOnly }),
    answeredBy: fixedChoice(['ai', 'staff', 'voicemail', 'missed']),
    agent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    agentRun: relationship({ ref: 'AgentRun', ...readOnly }),
    providerCallId: systemText({ indexed: true }),
    adapterKey: systemText(),
    disclosurePlayedAt: timestamp({ ...readOnly }),
    recordingConsent: fixedChoice(['not_asked', 'accepted', 'declined']),
    callerVerifiedAt: timestamp({ ...readOnly }),
    verificationMethod: fixedChoice(['none', 'pet_name_dob', 'otp']),
    transcript: json({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: '[{speaker, text, at}] as received; untrusted.' } }),
    summary: systemText(),
    disposition: fixedChoice(['open', 'booked', 'rescheduled', 'cancelled', 'refill_request', 'records_request', 'info', 'transferred', 'urgent_transfer', 'er_referred', 'voicemail', 'abandoned', 'callback_task']),
    transferTo: systemText(),
    startedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endedAt: timestamp({ ...readOnly }),
    durationSeconds: integer({ ...readOnly }),
    recordingRef: systemText(),
    status: lifecycle(['ringing', 'in_progress', 'completed', 'failed']),
    version: versionField(),
    ...trackingFields,
  },
})

/** Do-not-contact rules beyond consent: deceased pets, legal holds, client requests. */
export const Suppression = list({
  access: governed([...COMMS_READ]),
  fields: {
    contactPoint: relationship({ ref: 'ContactPoint', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    reason: fixedChoice(['stop_keyword', 'deceased', 'client_request', 'legal', 'invalid_number', 'bounce']),
    until: timestamp({ ...readOnly }),
    active: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

/** Facts the receptionist may say (hours, prices published by the practice, policies). */
export const KnowledgeBaseEntry = list({
  access: managed('signedIn', 'canManageTemplates'),
  ui: { labelField: 'topic', listView: { initialColumns: ['topic', 'visibility', 'entryVersion', 'active'] } },
  fields: {
    topic: text({ validation: { isRequired: true }, isIndexed: true }),
    keywords: json({ defaultValue: [], ui: { description: 'Lower-case words that match a question to this entry.' } }),
    content: text({ validation: { isRequired: true }, ui: { displayMode: 'textarea' } }),
    visibility: choice(['public', 'verified_client', 'staff'], 'public'),
    location: relationship({ ref: 'Location' }),
    entryVersion: integer({ defaultValue: 1 }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** Public profile served to the booking API (no HTML here; the storefront consumes it later). */
export const PublicSiteProfile = list({
  access: managed('signedIn', 'canManagePractice'),
  isSingleton: true,
  fields: {
    headline: text({ defaultValue: 'Cedar Creek Animal Hospital' }),
    onlineBookingEnabled: checkbox({ defaultValue: true }),
    newClientBookingMode: choice(['book', 'request', 'off'], 'request'),
    bookingWindowDays: integer({ defaultValue: 60, validation: { min: 1, max: 365 } }),
    minimumNoticeMinutes: integer({ defaultValue: 120 }),
    ...trackingFields,
  },
})

export const PublicAppointmentType = list({
  access: managed('signedIn', 'canManageSchedules'),
  ui: { labelField: 'publicName' },
  fields: {
    appointmentType: relationship({ ref: 'AppointmentType' }),
    publicName: text({ validation: { isRequired: true } }),
    description: text({ ui: { displayMode: 'textarea' } }),
    mode: choice(['book', 'request'], 'book'),
    newClients: checkbox({ defaultValue: false }),
    sortOrder: integer({ defaultValue: 0 }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** A portal session (magic link + OTP). Server-only: tokens never reach GraphQL. */
export const PortalSession = list({
  access: serverOnly,
  graphql: { omit: true },
  fields: {
    person: relationship({ ref: 'ClientPerson' }),
    contactPoint: relationship({ ref: 'ContactPoint' }),
    tokenHash: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    otpHash: text(),
    otpAttempts: integer({ defaultValue: 0 }),
    status: choice(['pending', 'verified', 'expired', 'revoked'], 'pending'),
    expiresAt: timestamp({ validation: { isRequired: true } }),
    verifiedAt: timestamp(),
    ipHash: text(),
    ...trackingFields,
  },
})

/** Rate-limit buckets for public endpoints (per IP hash / phone hash). */
export const RateLimitBucket = list({
  access: serverOnly,
  graphql: { omit: true },
  fields: {
    key: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    // Indexed for the sign-in limiter's sweep of expired rows (review r8 #3).
    windowStart: timestamp({ validation: { isRequired: true }, isIndexed: true }),
    count: integer({ defaultValue: 0 }),
  },
})

