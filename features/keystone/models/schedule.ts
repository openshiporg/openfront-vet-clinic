import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { choice, fixedChoice, lifecycle, minor, readOnly, systemText, versionField } from './domainFields'
import { governed, immutable, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/* Schedule, flow and triage (SCHEMA §1.9, §3). Bookings go through bookAppointment (mutations/
   schedule.ts) under advisory locks; the database also refuses overlapping reservations with an
   exclusion constraint (I-O4), so two writers can never both hold a room or a provider. */

const BOOK_READ = ['canBook', 'canCheckIn', 'canReadClinical', 'canManageSchedules'] as const

/** Working blocks per staff member, location and weekday (medspa ProviderSchedule port). */
export const StaffSchedule = list({
  access: managed('canAccessDashboard', 'canManageSchedules'),
  ui: { listView: { initialColumns: ['staffMember', 'location', 'kind', 'weekday', 'localDate', 'startTime', 'endTime'] } },
  fields: {
    staffMember: relationship({ ref: 'StaffMember' }),
    location: relationship({ ref: 'Location' }),
    kind: choice(['recurring', 'one_time', 'time_off'], 'recurring'),
    weekday: integer({ validation: { min: 0, max: 6 }, ui: { description: '0 = Sunday (recurring blocks).' } }),
    localDate: calendarDay({ ui: { description: 'One-time blocks and time off.' } }),
    startTime: text({ validation: { isRequired: true, match: { regex: /^([01]\d|2[0-3]):[0-5]\d$/ } } }),
    endTime: text({ validation: { isRequired: true, match: { regex: /^([01]\d|2[0-3]):[0-5]\d$/ } } }),
    appointmentCategories: json({ ui: { description: 'Allowed categories in this block, e.g. ["surgery","dental"] for the AM surgical block; empty = any.' } }),
    effectiveFrom: calendarDay(),
    effectiveTo: calendarDay(),
    ...trackingFields,
  },
})

export const AppointmentType = list({
  access: managed('signedIn', 'canManageSchedules'),
  ui: { labelField: 'name', listView: { initialColumns: ['code', 'name', 'category', 'durationMinutes', 'aiBookable', 'requestOnly'] } },
  fields: {
    code: text({ isIndexed: 'unique', validation: { isRequired: true, match: { regex: /^[a-z0-9_]{2,40}$/ } } }),
    name: text({ validation: { isRequired: true } }),
    category: choice(['wellness', 'sick', 'recheck', 'surgery', 'dental', 'euthanasia', 'tech', 'vaccine_only', 'grooming', 'boarding_checkin', 'telehealth', 'drop_off']),
    durationMinutes: integer({ validation: { isRequired: true, min: 5, max: 720 } }),
    segments: json({ ui: { description: 'Segment template, e.g. [{"kind":"drop_off","offset":0,"minutes":30},{"kind":"procedure","offset":60,"minutes":120}].' } }),
    species: relationship({ ref: 'Species', many: true, ui: { description: 'Empty = every species.' } }),
    requiredResourceKinds: json({ defaultValue: ['exam_room'] }),
    providerKinds: json({ defaultValue: ['dvm'], ui: { description: 'Staff kinds that can take it: dvm, rvt, groomer.' } }),
    aiBookable: checkbox({ defaultValue: false }),
    portalBookable: checkbox({ defaultValue: false }),
    requestOnly: checkbox({ defaultValue: false }),
    newClientAllowed: checkbox({ defaultValue: true }),
    depositRequired: choice(['none', 'fixed', 'estimate'], 'none'),
    depositMinor: minor(),
    vcprQualifying: checkbox({ defaultValue: false }),
    colour: text(),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

export const Resource = list({
  access: managed('signedIn', 'canManageSchedules'),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'kind', 'location', 'active'] } },
  fields: {
    location: relationship({ ref: 'Location' }),
    kind: choice(['exam_room', 'surgery_suite', 'dental_table', 'anaesthesia_machine', 'ultrasound', 'radiography', 'treatment_table', 'grooming_table', 'isolation']),
    name: text({ validation: { isRequired: true } }),
    sortOrder: integer({ defaultValue: 0 }),
    active: checkbox({ defaultValue: true }),
    ...trackingFields,
  },
})

/** A room/equipment hold. Overlaps are refused by an exclusion constraint (status ≠ released). */
export const ResourceReservation = list({
  access: governed([...BOOK_READ]),
  fields: {
    resource: relationship({ ref: 'Resource', ...readOnly }),
    appointment: relationship({ ref: 'Appointment.reservations', ...readOnly }),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['held', 'confirmed', 'released']),
    ...trackingFields,
  },
})

/** Provider time holds (the provider-day guard as data; exclusion constraint as for resources). */
export const ProviderReservation = list({
  access: governed([...BOOK_READ]),
  fields: {
    staffMember: relationship({ ref: 'StaffMember', ...readOnly }),
    appointment: relationship({ ref: 'Appointment.providerReservations', ...readOnly }),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['held', 'confirmed', 'released']),
    ...trackingFields,
  },
})

export const Appointment = list({
  access: governed([...BOOK_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'startsAt', 'client', 'appointmentType', 'provider', 'status', 'channel'], initialSort: { field: 'startsAt', direction: 'ASC' } } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    appointmentType: relationship({ ref: 'AppointmentType', ...readOnly }),
    provider: relationship({ ref: 'StaffMember', ...readOnly }),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['requested', 'booked', 'confirmed', 'checked_in', 'in_progress', 'ready_for_checkout', 'completed', 'cancelled', 'no_show', 'declined']),
    channel: fixedChoice(['csr', 'portal', 'ai_voice', 'ai_sms', 'walk_in', 'referral', 'import']),
    bookedByUser: relationship({ ref: 'User', ...readOnly }),
    bookedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    slotToken: systemText(),
    reason: systemText(),
    triage: relationship({ ref: 'TriageAssessment', ...readOnly }),
    callRecord: relationship({ ref: 'CallRecord', ...readOnly }),
    cancelReason: systemText(),
    cancelledAt: timestamp({ ...readOnly }),
    confirmedAt: timestamp({ ...readOnly }),
    checkedInAt: timestamp({ ...readOnly }),
    completedAt: timestamp({ ...readOnly }),
    patients: relationship({ ref: 'AppointmentPatient.appointment', many: true, ...readOnly }),
    segments: relationship({ ref: 'AppointmentSegment.appointment', many: true, ...readOnly }),
    reservations: relationship({ ref: 'ResourceReservation.appointment', many: true, ...readOnly }),
    providerReservations: relationship({ ref: 'ProviderReservation.appointment', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const AppointmentPatient = list({
  access: governed([...BOOK_READ]),
  fields: {
    appointment: relationship({ ref: 'Appointment.patients', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    reason: systemText(),
    status: lifecycle(['scheduled', 'checked_in', 'in_progress', 'done', 'cancelled', 'no_show']),
    weightSkippedReason: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** Drop-off → procedure → recovery → pick-up (salon segment port). */
export const AppointmentSegment = list({
  access: governed([...BOOK_READ]),
  fields: {
    appointment: relationship({ ref: 'Appointment.segments', ...readOnly }),
    kind: fixedChoice(['drop_off', 'exam', 'procedure', 'anaesthesia', 'recovery', 'pickup', 'groom', 'bath']),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    resource: relationship({ ref: 'Resource', ...readOnly }),
    staff: relationship({ ref: 'StaffMember', ...readOnly }),
    status: lifecycle(['planned', 'active', 'done', 'skipped']),
    transitions: relationship({ ref: 'SegmentTransition.segment', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const SegmentTransition = list({
  access: immutable([...BOOK_READ]),
  fields: {
    segment: relationship({ ref: 'AppointmentSegment.transitions', ...readOnly }),
    fromStatus: systemText({ required: true }),
    toStatus: systemText({ required: true }),
    by: relationship({ ref: 'User', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

export const WaitlistEntry = list({
  access: governed([...BOOK_READ]),
  ui: { listView: { initialColumns: ['client', 'appointmentType', 'urgency', 'status', 'createdAt'] } },
  fields: {
    client: relationship({ ref: 'Client', ...readOnly }),
    patients: relationship({ ref: 'Patient', many: true, ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    appointmentType: relationship({ ref: 'AppointmentType', ...readOnly }),
    preferredWindows: json({ ...readOnly }),
    urgency: fixedChoice(['routine', 'soon', 'urgent']),
    status: lifecycle(['waiting', 'offered', 'accepted', 'expired', 'declined', 'cancelled']),
    offeredSlotToken: systemText({ secret: true }),
    offerExpiresAt: timestamp({ ...readOnly }),
    bookedAppointment: relationship({ ref: 'Appointment', ...readOnly }),
    note: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const TriageProtocol = list({
  access: governed('signedIn'),
  ui: { labelField: 'name' },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    versions: relationship({ ref: 'TriageProtocolVersion.protocol', many: true, ...readOnly }),
    ...trackingFields,
  },
})

/** Frozen once published (DB trigger); a new protocol is a new version published by maker-checker. */
export const TriageProtocolVersion = list({
  access: governed('signedIn'),
  ui: { labelField: 'label', listView: { initialColumns: ['protocol', 'versionNumber', 'status', 'publishedAt'] } },
  fields: {
    protocol: relationship({ ref: 'TriageProtocol.versions', ...readOnly }),
    versionNumber: integer({ ...readOnly, validation: { isRequired: true } }),
    label: systemText(),
    questions: json({ ...readOnly }),
    redFlags: json({ ...readOnly }),
    levelRules: json({ ...readOnly }),
    scripts: json({ ...readOnly }),
    contentHash: systemText({ required: true }),
    status: lifecycle(['draft', 'published', 'superseded']),
    publishedAt: timestamp({ ...readOnly }),
    approval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    ...trackingFields,
  },
})

/** One triage (phone, agent or lobby). Append-only; red flags force emergency_now (SM§4). */
export const TriageAssessment = list({
  access: immutable(['canReadClinical', 'canBook', 'canCheckIn']),
  ui: { listView: { initialColumns: ['at', 'patient', 'level', 'outcome', 'actorKind'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    callRecord: relationship({ ref: 'CallRecord', ...readOnly }),
    protocolVersion: relationship({ ref: 'TriageProtocolVersion', ...readOnly }),
    complaint: systemText(),
    answers: json({ ...readOnly }),
    redFlagsHit: json({ ...readOnly }),
    level: fixedChoice(['emergency_now', 'urgent_today', 'soon', 'routine']),
    outcome: fixedChoice(['transferred', 'er_referred', 'booked', 'advised_home_monitor', 'callback_task']),
    referredTo: relationship({ ref: 'ReferralHospital', ...readOnly }),
    actorKind: fixedChoice(['user', 'agent']),
    actorUser: relationship({ ref: 'User', ...readOnly }),
    actorAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
  },
})

/** Live patient flow per location (SM§4). Status and place change separately, each by CAS. */
export const WhiteboardEntry = list({
  access: governed(['canReadClinical', 'canCheckIn', 'canBook']),
  ui: { listView: { initialColumns: ['location', 'patient', 'status', 'room', 'assignedDvm', 'since'] } },
  fields: {
    location: relationship({ ref: 'Location', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    appointment: relationship({ ref: 'Appointment', ...readOnly }),
    status: lifecycle(['waiting', 'in_exam', 'treatment', 'diagnostics', 'hospitalised', 'surgery', 'recovery', 'boarding', 'ready_for_discharge', 'discharged']),
    room: relationship({ ref: 'Resource', ...readOnly }),
    assignedDvm: relationship({ ref: 'StaffMember', ...readOnly }),
    assignedTech: relationship({ ref: 'StaffMember', ...readOnly }),
    flags: json({ ...readOnly, defaultValue: [] }),
    since: timestamp({ ...readOnly, validation: { isRequired: true } }),
    version: versionField(),
    ...trackingFields,
  },
})
