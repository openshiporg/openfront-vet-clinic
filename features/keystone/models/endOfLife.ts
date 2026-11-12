import { list } from '@keystone-6/core'
import { checkbox, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, lifecycle, minor, readOnly, systemText, versionField } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Phase 5, end of life (STATE-MACHINES §17). A death is one transaction: the record, the patient's status, the
 * reminders, appointments, boardings, grooms, plan enrolments, queued messages and open estimates all change together
 * or not at all. The aftercare chain is append-only, and every link names the tag on the animal: the service and the
 * database both refuse a link without one.
 */

const EOL = ['canReadClinical', 'canAuthoriseEuthanasia', 'canManageBoarding', 'canManagePractice'] as const

export const AFTERCARE_CHOICES = ['private_cremation', 'communal_cremation', 'home_burial', 'rabies_testing'] as const

export const EuthanasiaConsent = list({
  access: governed(['canReadClinical', 'canAuthoriseEuthanasia']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'signer', 'aftercare', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    signer: relationship({ ref: 'ClientPerson', ...readOnly }),
    /** Someone other than the owner who may sign: animal control, a court order, a shelter's policy. */
    authority: fixedChoice(['owner', 'animal_control', 'court_order', 'shelter_policy']),
    authorityNote: systemText(),
    status: lifecycle(['draft', 'signed', 'used', 'revoked']),
    biteAttestation: fixedChoice(['no_bite', 'bite_in_last_10_days']),
    aftercare: fixedChoice(AFTERCARE_CHOICES),
    clientPresent: checkbox({ ...readOnly, defaultValue: false }),
    method: fixedChoice(['in_person', 'e_signature']),
    witness: relationship({ ref: 'StaffMember', ...readOnly }),
    verbalConfirmedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    verbalConfirmedAt: timestamp({ ...readOnly }),
    signatureText: systemText(),
    signedAt: timestamp({ ...readOnly }),
    usedAt: timestamp({ ...readOnly }),
    revokedReason: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const DeathRecord = list({
  access: governed(['canReadClinical', 'canManagePatients', 'canAuthoriseEuthanasia']),
  ui: { listView: { initialColumns: ['patient', 'cause', 'diedAt', 'recordedBy'] } },
  fields: {
    patient: relationship({ ref: 'Patient', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    cause: fixedChoice(['euthanasia', 'natural', 'dead_on_arrival']),
    causeNote: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    diedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    consent: relationship({ ref: 'EuthanasiaConsent', ...readOnly }),
    administration: relationship({ ref: 'Administration', ...readOnly }),
    effects: text({ ...readOnly, ui: { ...readOnly.ui, displayMode: 'textarea' } }),
    ...trackingFields,
  },
})

export const AftercareOrder = list({
  access: governed([...EOL]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'patient', 'choice', 'tagNumber', 'status'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    deathRecord: relationship({ ref: 'DeathRecord', ...readOnly }),
    choice: fixedChoice(['private_cremation', 'communal_cremation', 'home_burial', 'rabies_testing']),
    status: lifecycle(['ordered', 'body_tagged', 'stored', 'picked_up', 'returned', 'closed', 'released_to_owner', 'held_for_testing']),
    /** The tag on the animal. Nothing after "ordered" exists without one. */
    tagNumber: systemText(),
    crematory: systemText(),
    manifestRef: systemText(),
    /** What the crematory wrote on the ashes; it must match the manifest before they come back. */
    crematoryRef: systemText(),
    heldFrom: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const CustodyEvent = list({
  access: governed([...EOL]),
  ui: { listView: { initialColumns: ['order', 'kind', 'tagNumber', 'by', 'at'] } },
  fields: {
    order: relationship({ ref: 'AftercareOrder', ...readOnly }),
    kind: fixedChoice(['tagged', 'stored', 'picked_up', 'returned', 'released', 'closed', 'testing_hold', 'testing_release']),
    tagNumber: systemText({ required: true }),
    place: systemText(),
    crematoryRef: systemText(),
    receivedBy: systemText(),
    by: relationship({ ref: 'StaffMember', ...readOnly }),
    at: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const MemorialItem = list({
  access: governed([...EOL]),
  ui: { listView: { initialColumns: ['order', 'kind', 'description', 'priceMinor'] } },
  fields: {
    order: relationship({ ref: 'AftercareOrder', ...readOnly }),
    kind: fixedChoice(['paw_print', 'clay_impression', 'fur_clipping', 'urn', 'keepsake']),
    description: systemText({ required: true }),
    priceMinor: minor({ required: true }),
    chargeLine: relationship({ ref: 'ChargeLine', ...readOnly }),
    ...trackingFields,
  },
})

export const END_OF_LIFE_LISTS = { EuthanasiaConsent, DeathRecord, AftercareOrder, CustodyEvent, MemorialItem }
