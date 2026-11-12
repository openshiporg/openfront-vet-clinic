import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, lifecycle, minor, readOnly, systemText, versionField } from './domainFields'
import { governed } from './listAccess'
import { permissions } from '../access'
import { trackingFields } from './trackingFields'

/*
 * Phase 5, boarding and grooming (STATE-MACHINES §16). Capacity is per run type per night: a database CHECK keeps
 * sold between zero and capacity whatever the application does, and every reservation takes a lock per night, so two
 * people booking the last run cannot both get it. A request is a hold that lapses when read (no sweeper): it counts
 * against availability only while its hold time has not passed. Two stays can never be in the same run at once (an
 * exclusion constraint on run assignments). Care logs and belongings returns are append-only.
 */

const BOARDING = ['canManageBoarding', 'canBook', 'canCheckIn', 'canReadClinical', 'canManagePractice'] as const
const KENNEL = ['canManageBoarding', 'canReadClinical', 'canManagePractice'] as const
const GROOM = ['canGroom', 'canManageBoarding', 'canBook', 'canCheckIn', 'canManagePractice'] as const

export const RunType = list({
  access: governed([...BOARDING]),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'location', 'speciesCodes', 'nightlyRateMinor'] } },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    speciesCodes: json({ ...readOnly }),
    maxWeightKg: integer({ ...readOnly }),
    nightlyRateMinor: minor({ required: true }),
    depositMinor: minor({ defaultValue: 0n }),
    active: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

export const Run = list({
  access: governed([...BOARDING]),
  ui: { labelField: 'label', listView: { initialColumns: ['label', 'runType', 'status'] } },
  fields: {
    label: systemText({ required: true }),
    runType: relationship({ ref: 'RunType', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    status: lifecycle(['available', 'out_of_service']),
    version: versionField(),
    ...trackingFields,
  },
})

export const NightlyRunInventory = list({
  access: governed([...BOARDING]),
  ui: { listView: { initialColumns: ['runType', 'night', 'capacity', 'sold'] } },
  fields: {
    runType: relationship({ ref: 'RunType', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    night: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    capacity: integer({ ...readOnly, validation: { isRequired: true } }),
    sold: integer({ ...readOnly, defaultValue: 0 }),
    ...trackingFields,
  },
})

export const BoardingReservation = list({
  access: governed([...BOARDING]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'runType', 'checkInOn', 'checkOutOn', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    runType: relationship({ ref: 'RunType', ...readOnly }),
    checkInOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    /** The morning the pet goes home: nights are check-in through the night before this day. */
    checkOutOn: calendarDay({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(['requested', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']),
    holdExpiresAt: timestamp({ ...readOnly }),
    depositMinor: minor({ defaultValue: 0n }),
    vaccineOverrideReason: systemText(),
    notes: systemText(),
    cancelReason: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const BoardingStay = list({
  access: governed([...BOARDING]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'run', 'checkedInAt', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    reservation: relationship({ ref: 'BoardingReservation', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    run: relationship({ ref: 'Run', ...readOnly }),
    status: lifecycle(['in_house', 'checked_out']),
    checkedInAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    checkedOutAt: timestamp({ ...readOnly }),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const RunAssignment = list({
  access: governed([...KENNEL]),
  ui: { listView: { initialColumns: ['stay', 'run', 'startsAt', 'endsAt'] } },
  fields: {
    stay: relationship({ ref: 'BoardingStay', ...readOnly }),
    run: relationship({ ref: 'Run', ...readOnly }),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    endsAt: timestamp({ ...readOnly }),
    ...trackingFields,
  },
})

/** Feeding, handling, medicines and the emergency contact for one stay. Medicines and the spending limit are clinical, so the list needs a kennel or clinical role. */
export const RunCard = list({
  access: governed([...KENNEL]),
  ui: { listView: { initialColumns: ['stay', 'emergencyContactName', 'medicalLimitMinor'] } },
  fields: {
    stay: relationship({ ref: 'BoardingStay', ...readOnly }),
    reservation: relationship({ ref: 'BoardingReservation', ...readOnly }),
    feeding: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    handling: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    medications: json({ ...readOnly }),
    emergencyContactName: systemText(),
    emergencyContactPhone: systemText({ secret: true }),
    /** The most the owner has said the hospital may spend on emergency care without calling first. */
    medicalLimitMinor: minor({ defaultValue: 0n }),
    ...trackingFields,
  },
})

export const BelongingItem = list({
  access: governed([...KENNEL]),
  ui: { listView: { initialColumns: ['stay', 'description', 'returnedAt'] } },
  fields: {
    stay: relationship({ ref: 'BoardingStay', ...readOnly }),
    description: systemText({ required: true }),
    returnedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const DailyCareLog = list({
  access: governed([...KENNEL]),
  ui: { listView: { initialColumns: ['stay', 'kind', 'note', 'at'] } },
  fields: {
    stay: relationship({ ref: 'BoardingStay', ...readOnly }),
    kind: fixedChoice(['fed', 'walked', 'medicated', 'played', 'cleaned', 'observation']),
    note: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const GroomAppointment = list({
  access: governed([...GROOM]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'groomer', 'startsAt', 'service', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    groomer: relationship({ ref: 'StaffMember', ...readOnly }),
    startsAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    durationMinutes: integer({ ...readOnly, defaultValue: 60 }),
    service: systemText({ required: true }),
    priceMinor: minor({ required: true }),
    status: lifecycle(['booked', 'checked_in', 'in_progress', 'ready', 'completed', 'cancelled', 'no_show']),
    noteVersion: relationship({ ref: 'GroomNote', ...readOnly }),
    cancelReason: systemText(),
    invoice: relationship({ ref: 'Invoice', ...readOnly }),
    /** Managers only: what the groomer earns on this groom. Not readable, filterable or sortable by anyone else. */
    commissionBps: integer({ ...readOnly, access: { ...readOnly.access, read: permissions.canViewFinance }, isFilterable: permissions.canViewFinance, isOrderable: permissions.canViewFinance, defaultValue: 0 }),
    commissionMinor: minor({ defaultValue: 0n }),
    version: versionField(),
    ...trackingFields,
  },
})

/** A new version for every change (like a salon colour formula): blade, style and how the pet behaves on the table. */
export const GroomNote = list({
  access: governed([...GROOM]),
  ui: { listView: { initialColumns: ['patient', 'versionNo', 'style', 'blade', 'behaviour'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    versionNo: integer({ ...readOnly, validation: { isRequired: true } }),
    blade: systemText(),
    style: systemText(),
    behaviour: systemText(),
    notes: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    photoUrl: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    ...trackingFields,
  },
})

/** What the practice charges for grooming, euthanasia and aftercare: one price list, so no price is typed at the desk. */
export const ServiceItem = list({
  access: governed(['canAccessDashboard']),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'area', 'priceMinor', 'active'] } },
  fields: {
    code: systemText({ indexed: 'unique', required: true }),
    area: fixedChoice(['grooming', 'euthanasia', 'aftercare']),
    name: systemText({ required: true }),
    priceMinor: minor({ required: true }),
    minutes: integer({ ...readOnly, defaultValue: 0 }),
    taxCategory: fixedChoice(['professional_service', 'grooming', 'merchandise', 'boarding']),
    active: checkbox({ ...readOnly, defaultValue: true }),
    ...trackingFields,
  },
})

export const BOARDING_LISTS = { ServiceItem, RunType, Run, NightlyRunInventory, BoardingReservation, BoardingStay, RunAssignment, RunCard, BelongingItem, DailyCareLog, GroomAppointment, GroomNote }
