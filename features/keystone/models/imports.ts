import { list } from '@keystone-6/core'
import { integer, json, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, lifecycle, readOnly, systemText, versionField, hiddenHash } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Incumbent migration (INTEGRATIONS §13): ezyVet and Avimark first. A batch is one upload or one
 * API pull; every source row becomes an ImportRow with its result and errors, and every record it
 * creates gets an ExternalId(system, value) so running the same file again changes nothing.
 * Imported clinical history arrives as signed `records_import` encounters (read-only, provenance).
 */

export const ImportBatch = list({
  access: governed(['canManageOnboarding', 'canManageIntegrations']),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'system', 'entity', 'status', 'rowsTotal', 'rowsCreated', 'rowsFailed'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    system: fixedChoice(['ezyvet', 'avimark', 'csv']),
    channel: fixedChoice(['csv', 'api', 'dbf']),
    entity: fixedChoice(['clients', 'patients', 'weights', 'vaccinations', 'reminders', 'consults', 'balances']),
    location: relationship({ ref: 'Location', ...readOnly }),
    fileName: systemText(),
    fileHash: hiddenHash({ indexed: true }),
    status: lifecycle(['received', 'validated', 'applying', 'applied', 'failed']),
    rowsTotal: integer({ ...readOnly, defaultValue: 0 }),
    rowsCreated: integer({ ...readOnly, defaultValue: 0 }),
    rowsSkipped: integer({ ...readOnly, defaultValue: 0 }),
    rowsFailed: integer({ ...readOnly, defaultValue: 0 }),
    mapping: json({ ...readOnly }),
    startedBy: relationship({ ref: 'User', ...readOnly }),
    finishedAt: timestamp({ ...readOnly }),
    rows: relationship({ ref: 'ImportRow.batch', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const ImportRow = list({
  access: governed(['canManageOnboarding', 'canManageIntegrations']),
  ui: { listView: { initialColumns: ['batch', 'rowNumber', 'externalId', 'result', 'recordType'] } },
  fields: {
    batch: relationship({ ref: 'ImportBatch.rows', ...readOnly }),
    rowNumber: integer({ ...readOnly, validation: { isRequired: true } }),
    externalId: systemText({ required: true }),
    result: fixedChoice(['created', 'skipped_existing', 'failed']),
    recordType: systemText(),
    recordId: systemText(),
    errors: json({ ...readOnly, defaultValue: [] }),
    ...trackingFields,
  },
})
