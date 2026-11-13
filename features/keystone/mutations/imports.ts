import { createHash } from 'node:crypto'
import { command, invariantError } from '../lib/command'
import { auditCreate } from '../lib/cas'
import { actorUserId, type Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference, nextSerial, publicCode } from '../lib/sequence'
import { runInTransaction, type UnitOfWork } from '../lib/unitOfWork'
import { toJsonValue } from '../lib/canonical'
import { dec, toKg, toScale } from '../lib/decimal'
import { contactHash, microchipStandard, normaliseContact } from '../domain/contact'
import { addMonths } from '../domain/vaccines'
import { importDate, importSex, importSpeciesCode, pimsSource, truthy, type ImportEntity, type Mapping, type PimsSystem, type Row } from '../../integrations/pims'
import { gated } from './agentGuard'
import { revisionHash, signedContentHash } from '../domain/record'
import type { Ctx } from './clinical'

/*
 * PIMS import (INTEGRATIONS §10, SM§19). Two steps:
 *   preview → parse and map headers, validate every row, store nothing but the batch and its
 *             row results (status `validated`). The screen shows what will happen.
 *   apply   → chunks of 100 rows, each chunk one transaction. ExternalId(system, value) makes
 *             re-imports idempotent: a row whose id is already mapped is `skipped_existing`.
 * Imported clients get no marketing consent unless the file has an explicit consent column;
 * imported consults become signed `records_import` encounters attributed to the source system,
 * frozen like any signed record and never VCPR-qualifying.
 */

const ENTITIES: ImportEntity[] = ['clients', 'patients', 'weights', 'vaccinations', 'reminders', 'consults', 'balances']
const SYSTEMS: PimsSystem[] = ['ezyvet', 'avimark', 'csv']
const CHUNK = 100
const MAX_ROWS = 50_000

type RowResult = { rowNumber: number; externalId: string; result: 'created' | 'skipped_existing' | 'failed'; recordType?: string; recordId?: string; errors: string[] }

function rowKey(entity: ImportEntity, row: Row) {
  switch (entity) {
    case 'clients': case 'patients': case 'consults': return row.externalId ?? ''
    case 'weights': return `${row.patientExternalId}|${row.date}|${row.weight}${row.unit ?? ''}`
    case 'vaccinations': return `${row.patientExternalId}|${row.vaccine}|${row.givenOn}`
    case 'reminders': return `${row.patientExternalId}|${row.reminder}|${row.dueOn}`
    case 'balances': return `${row.clientExternalId}|${row.asOf}`
  }
}

const RECORD_TYPE: Record<ImportEntity, string> = { clients: 'Client', patients: 'Patient', weights: 'WeightMeasurement', vaccinations: 'PatientReminder', reminders: 'PatientReminder', consults: 'Encounter', balances: 'ClientLedgerEntry' }

type SpeciesRow = { code: string; name: string }
const speciesList = (tx: { species: { findMany: (a: { select: { code: true; name: true } }) => Promise<SpeciesRow[]> } }) => tx.species.findMany({ select: { code: true, name: true } })

/** Row checks against the practice's set-up (species); preview and apply run the same checks, so they agree. */
function validateRow(entity: ImportEntity, row: Row, species: SpeciesRow[]): string[] {
  const errors: string[] = []
  const need = (f: string, label: string) => { if (!row[f]?.trim()) errors.push(`${label} is empty.`) }
  if (entity === 'clients') {
    need('externalId', 'Client id'); need('lastName', 'Last name')
    if (!row.mobile && !row.phone && !row.email) errors.push('No phone or email.')
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) errors.push('Email is not valid.')
  }
  if (entity === 'patients') {
    need('externalId', 'Patient id'); need('clientExternalId', 'Client id'); need('name', 'Name')
    if (!importSpeciesCode(row.species ?? '', species)) errors.push(`Species "${row.species ?? ''}" is not set up here (${species.map(s => s.name).join(', ') || 'no species yet'}).`)
    if (row.dateOfBirth && !importDate(row.dateOfBirth)) errors.push(`Date of birth "${row.dateOfBirth}" is not a date.`)
  }
  if (entity === 'balances') {
    need('clientExternalId', 'Client id')
    if (!importDate(row.asOf ?? '')) errors.push('Balance date is not a date.')
    if (!/^-?\d{1,9}(\.\d{1,2})?$/.test((row.balance ?? '').replace(/[$,\s]/g, ''))) errors.push('Balance is not an amount in dollars and cents.')
  }
  if (entity === 'weights') {
    if (!importDate(row.date ?? '')) errors.push('Weight date is not a date.')
    if (!/^\d+(\.\d+)?$/.test(row.weight ?? '') || dec(row.weight).lte(0)) errors.push('Weight is not a positive number.')
    if (row.unit && !['kg', 'lb', 'lbs', 'g'].includes(row.unit.toLowerCase())) errors.push(`Unit "${row.unit}" is not kg, lb or g.`)
  }
  if (entity === 'vaccinations') {
    need('vaccine', 'Vaccine')
    const given = importDate(row.givenOn ?? '')
    if (!given) errors.push('Date given is not a date.')
    // Review r5 #3: a vaccine cannot have been given after the import day (one day of slack for time zones).
    else if (given > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) errors.push(`Date given "${row.givenOn}" is in the future.`)
    if (row.dueOn && !importDate(row.dueOn)) errors.push('Due date is not a date.')
  }
  if (entity === 'reminders') { need('reminder', 'Reminder'); if (!importDate(row.dueOn ?? '')) errors.push('Due date is not a date.') }
  if (entity === 'consults') { need('externalId', 'Consult id'); need('notes', 'Notes'); if (!importDate(row.date ?? '')) errors.push('Visit date is not a date.') }
  return errors
}

export async function previewImport(_root: unknown, args: { system: PimsSystem; entity: ImportEntity; locationId: string; fileName?: string | null; csv?: string | null; mapping?: Mapping | null; source?: 'manual-csv' | 'ezyvet-api' | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageOnboarding'], tool: 'import.preview', humanOnly: true }, args, async actor => {
    if (!SYSTEMS.includes(args.system)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the system the file came from.', { field: 'system' })
    if (!ENTITIES.includes(args.entity)) throw new DomainError(Codes.INVALID_INPUT, 'Choose what the file contains.', { field: 'entity' })
    let parsed
    try {
      parsed = await pimsSource(args.source ?? 'manual-csv').rows({ system: args.system, entity: args.entity, csv: args.csv, mapping: args.mapping ?? {} })
    } catch (error) {
      throw new DomainError(Codes.INVALID_INPUT, (error as Error).message, { field: 'csv' })
    }
    if (parsed.missingRequired.length) throw new DomainError(Codes.INVALID_INPUT, `The file has no column for: ${parsed.missingRequired.join(', ')}. Map those columns and try again.`, { field: 'mapping', problems: parsed.missingRequired })
    if (parsed.rows.length > MAX_ROWS) throw new DomainError(Codes.INVALID_INPUT, `Split the file: at most ${MAX_ROWS} rows per batch.`)
    const species = await speciesList(context.prisma as never)
    const fileHash = createHash('sha256').update(args.csv ?? JSON.stringify(parsed.rows)).digest('hex')
    const seen = new Set<string>()
    const results = parsed.rows.map(r => {
      const errors = validateRow(args.entity, r.values, species)
      const key = rowKey(args.entity, r.values)
      if (key && seen.has(key)) errors.push('Duplicate of an earlier row in this file.')
      seen.add(key)
      return { rowNumber: r.rowNumber, externalId: key || `row-${r.rowNumber}`, errors, values: r.values }
    })
    const result = await command(context.prisma, { name: 'import.preview', actor, idempotencyKey: args.idempotencyKey, params: { system: args.system, entity: args.entity, locationId: args.locationId, fileHash, mapping: parsed.mapping } }, async uow => {
      const location = await uow.tx.location.findUnique({ where: { id: args.locationId }, select: { id: true } })
      if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
      const ref = await nextReference(uow.tx, 'IMP', uow.now)
      const failed = results.filter(r => r.errors.length).length
      const batch = await uow.tx.importBatch.create({
        data: { ref, system: args.system, channel: args.source === 'ezyvet-api' ? 'api' : 'csv', entity: args.entity, locationId: location.id, fileName: args.fileName ?? '', fileHash, status: 'validated', rowsTotal: results.length, rowsFailed: 0, mapping: toJsonValue({ mapping: parsed.mapping, rows: results.map(r => r.values) }) as never, startedById: actorUserId(actor) },
      })
      auditCreate(uow, actor, 'ImportBatch', batch.id, 'import.previewed', { ref, system: args.system, entity: args.entity, rows: results.length, invalid: failed, fileHash })
      return { id: batch.id, ref, rows: results.length, invalid: failed, mapping: parsed.mapping, sample: results.slice(0, 20).map(r => ({ rowNumber: r.rowNumber, externalId: r.externalId, errors: r.errors, values: r.values })) }
    })
    return { replay: result.replay, ...result.value }
  })
}

async function findMapped(uow: UnitOfWork, system: string, recordType: string, value: string) {
  return uow.tx.externalId.findFirst({ where: { system, recordType, value }, select: { recordId: true } })
}

async function mapExternal(uow: UnitOfWork, system: string, recordType: string, recordId: string, value: string) {
  await uow.tx.externalId.create({ data: { system, recordType, recordId, value } })
}

async function applyRow(uow: UnitOfWork, actor: Actor, batch: { id: string; ref: string; system: string; entity: ImportEntity; locationId: string }, row: Row, rowNumber: number): Promise<RowResult> {
  const sys = `${batch.system}:${batch.entity}`
  const key = rowKey(batch.entity, row)
  const base = { rowNumber, externalId: key, errors: [] as string[] }
  const species = await speciesList(uow.tx as never)
  const errors = validateRow(batch.entity, row, species)
  if (errors.length) return { ...base, result: 'failed', errors }
  const existing = await findMapped(uow, sys, RECORD_TYPE[batch.entity], key)
  if (existing) return { ...base, result: 'skipped_existing', recordType: RECORD_TYPE[batch.entity], recordId: existing.recordId }
  const patientFor = async (ext: string) => {
    const m = await findMapped(uow, `${batch.system}:patients`, 'Patient', ext)
    if (!m) throw new DomainError(Codes.NOT_FOUND, `Patient ${ext} has not been imported yet; import patients first.`)
    return m.recordId
  }
  switch (batch.entity) {
    case 'clients': {
      const contacts: { kind: 'mobile' | 'landline' | 'email'; value: string }[] = []
      if (row.mobile) contacts.push({ kind: 'mobile', value: row.mobile })
      if (row.phone) contacts.push({ kind: 'landline', value: row.phone })
      if (row.email) contacts.push({ kind: 'email', value: row.email })
      const normalised = contacts.map(c => { try { return { ...c, value: normaliseContact(c.kind, c.value) } } catch { return null } }).filter(Boolean) as typeof contacts
      if (!normalised.length) return { ...base, result: 'failed', errors: ['No valid phone or email.'] }
      const dupe = await uow.tx.contactPoint.findFirst({ where: { valueHash: { in: normalised.map(c => contactHash(c.value)) }, status: 'active' }, select: { person: { select: { client: { select: { id: true, ref: true } } } } } })
      if (dupe?.person?.client) {
        await mapExternal(uow, sys, 'Client', dupe.person.client.id, key)
        return { ...base, result: 'skipped_existing', recordType: 'Client', recordId: dupe.person.client.id, errors: [`Matched existing client ${dupe.person.client.ref} by contact.`] }
      }
      const ref = await nextSerial(uow.tx, 'C')
      const location = await uow.tx.location.findUniqueOrThrow({ where: { id: batch.locationId }, select: { stateCode: true } })
      const client = await uow.tx.client.create({ data: { ref, publicCode: publicCode('CL'), displayName: `${row.lastName.trim()} household`, kind: 'household', status: 'active', primaryLocationId: batch.locationId, addressLine1: row.address ?? '', city: row.city ?? '', stateCode: location.stateCode, postalCode: row.postalCode ?? '', source: 'import', accountFlags: {} } })
      const person = await uow.tx.clientPerson.create({ data: { clientId: client.id, firstName: (row.firstName || '').trim() || '(unknown)', lastName: row.lastName.trim(), relationship: 'owner', isPrimary: true, canBook: true, canApproveTreatment: true, canReceiveRecords: true, canPay: true, canAuthoriseEuthanasia: true } })
      const seen = new Set<string>()
      for (const c of normalised) {
        const cp = await uow.tx.contactPoint.create({ data: { personId: person.id, kind: c.kind, value: c.value, valueHash: contactHash(c.value), isPrimary: !seen.has(c.kind), canText: false, status: 'active' } })
        seen.add(c.kind)
        // Transactional care messages rest on the existing relationship; marketing only with an explicit column.
        await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: 'transactional', action: 'grant', method: 'import', capturedByUserId: actorUserId(actor), at: uow.now } })
        if (row.marketingConsent && truthy(row.marketingConsent)) await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: 'marketing', action: 'grant', method: 'import', capturedByUserId: actorUserId(actor), at: uow.now } })
      }
      await mapExternal(uow, sys, 'Client', client.id, key)
      auditCreate(uow, actor, 'Client', client.id, 'client.imported', { ref, batch: batch.ref, rowNumber })
      return { ...base, result: 'created', recordType: 'Client', recordId: client.id }
    }
    case 'patients': {
      const owner = await findMapped(uow, `${batch.system}:clients`, 'Client', row.clientExternalId)
      if (!owner) return { ...base, result: 'failed', errors: [`Client ${row.clientExternalId} has not been imported yet; import clients first.`] }
      const code = importSpeciesCode(row.species, species)
      const speciesRow = code ? await uow.tx.species.findUnique({ where: { code }, select: { id: true } }) : null
      if (!speciesRow) return { ...base, result: 'failed', errors: [`Species "${row.species}" is not set up.`] }
      const breed = row.breed ? await uow.tx.breed.findFirst({ where: { speciesId: speciesRow.id, name: { equals: row.breed.trim(), mode: 'insensitive' } }, select: { id: true } }) : null
      const { sex, reproductiveStatus } = importSex(row.sex ?? '')
      const dob = row.dateOfBirth ? importDate(row.dateOfBirth) : null
      const deceased = row.deceased ? truthy(row.deceased) : false
      let chip: string | null = null
      if (row.microchip) {
        chip = row.microchip.replace(/[\s-]/g, '').toUpperCase()
        const clash = await uow.tx.microchip.findFirst({ where: { number: chip, active: true }, select: { patient: { select: { ref: true } } } })
        if (clash) return { ...base, result: 'failed', errors: [`Microchip ${chip} is already on ${clash.patient?.ref ?? 'another patient'}.`] }
      }
      const ref = await nextSerial(uow.tx, 'P')
      const patient = await uow.tx.patient.create({ data: { ref, name: row.name.trim(), kind: 'individual', speciesId: speciesRow.id, breedId: breed?.id ?? null, sex, reproductiveStatus, dateOfBirth: dob ? new Date(`${dob}T00:00:00Z`) : null, dobEstimated: false, status: deceased ? 'deceased' : 'active', deceasedAt: deceased ? uow.now : null, codeStatus: 'unspecified' } })
      await uow.tx.patientOwnership.create({ data: { patientId: patient.id, clientId: owner.recordId, role: 'primary', effectiveFrom: uow.now, basis: 'import', recordedById: actorUserId(actor) } })
      if (chip) await uow.tx.microchip.create({ data: { patientId: patient.id, number: chip, standard: microchipStandard(chip), active: true } })
      await mapExternal(uow, sys, 'Patient', patient.id, key)
      auditCreate(uow, actor, 'Patient', patient.id, 'patient.imported', { ref, batch: batch.ref, rowNumber, deceased })
      return { ...base, result: 'created', recordType: 'Patient', recordId: patient.id }
    }
    case 'weights': {
      const patientId = await patientFor(row.patientExternalId)
      const unit = (row.unit || 'kg').toLowerCase().replace('lbs', 'lb') as 'kg' | 'lb' | 'g'
      const on = importDate(row.date)!
      const w = await uow.tx.weightMeasurement.create({ data: { patientId, value: toScale(row.weight, 'wt'), unit, valueKg: toScale(toKg(dec(row.weight), unit), 'wt'), method: 'carried_over', measuredAt: new Date(`${on}T12:00:00Z`) } })
      await mapExternal(uow, sys, 'WeightMeasurement', w.id, key)
      return { ...base, result: 'created', recordType: 'WeightMeasurement', recordId: w.id }
    }
    case 'vaccinations':
    case 'reminders': {
      const patientId = await patientFor(row.patientExternalId)
      const label = (batch.entity === 'vaccinations' ? row.vaccine : row.reminder).trim()
      // Map by product name or reminder-type name, then the protocol satisfying it.
      const product = await uow.tx.vaccineProduct.findFirst({ where: { name: { equals: label, mode: 'insensitive' } }, select: { id: true, licensedDoiMonths: true, reminderTypeId: true } })
      const type = product?.reminderTypeId
        ? { id: product.reminderTypeId }
        : await uow.tx.reminderType.findFirst({ where: { OR: [{ name: { equals: label, mode: 'insensitive' } }, { code: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_') }] }, select: { id: true } })
      if (!type) return { ...base, result: 'failed', errors: [`"${label}" does not match a vaccine or reminder type. Add it under Reminders, or map it.`] }
      const dueOn = batch.entity === 'reminders' ? importDate(row.dueOn)! : row.dueOn ? importDate(row.dueOn)! : addMonths(importDate(row.givenOn)!, product?.licensedDoiMonths ?? 12)
      const reminder = await uow.tx.patientReminder.upsert({
        where: { patientId_typeId_dueOn: { patientId, typeId: type.id, dueOn: new Date(`${dueOn}T00:00:00Z`) } },
        create: { patientId, locationId: batch.locationId, typeId: type.id, dueOn: new Date(`${dueOn}T00:00:00Z`), status: 'scheduled', source: 'import', sourceKey: `${sys}:${key}` },
        update: {},
      })
      if (batch.entity === 'vaccinations') {
        const givenOn = importDate(row.givenOn)!
        const note = `Imported from ${batch.system}: ${label} given ${givenOn}${row.lotNumber ? `, lot ${row.lotNumber}` : ''}${row.tagNumber ? `, tag ${row.tagNumber}` : ''}.`
        const older = await uow.tx.patientReminder.findMany({ where: { patientId, typeId: type.id, status: { in: ['scheduled', 'due', 'overdue', 'lapsed'] }, dueOn: { lte: new Date(`${givenOn}T00:00:00Z`) }, id: { not: reminder.id } }, select: { id: true } })
        for (const o of older) {
          await uow.tx.reminderSatisfaction.create({ data: { reminderId: o.id, sourceKey: `${sys}:${key}`, note, at: uow.now } })
          await uow.tx.patientReminder.update({ where: { id: o.id }, data: { status: 'satisfied', version: { increment: 1 } } })
        }
      }
      await mapExternal(uow, sys, 'PatientReminder', reminder.id, key)
      return { ...base, result: 'created', recordType: 'PatientReminder', recordId: reminder.id }
    }
    case 'balances': {
      // An opening balance is one ledger adjustment per client and date, keyed so a re-import cannot post it twice.
      const mapped = await findMapped(uow, `${batch.system}:clients`, 'Client', row.clientExternalId)
      if (!mapped) throw new DomainError(Codes.NOT_FOUND, `Client ${row.clientExternalId} has not been imported yet; import clients first.`)
      const raw = row.balance.replace(/[$,\s]/g, '')
      const neg = raw.startsWith('-')
      const [whole, cents = ''] = raw.replace('-', '').split('.')
      const minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'))
      // Exports show money owed as positive. The ledger only holds credit without an invoice, so an amount owed is not
      // imported here: it needs an invoice a person raises. A credit (negative in the file) becomes money on account.
      if (!neg && minor > 0n) throw new DomainError(Codes.GUARD_FAILED, 'A balance owed cannot be imported as a ledger entry. Raise an invoice for it; only credit balances (negative) import.')
      const signed = -minor
      const entryKey = `import:${batch.system}:balance:${row.clientExternalId}:${importDate(row.asOf)}`
      if (signed === 0n) return { ...base, result: 'skipped_existing', errors: ['Zero balance: nothing to post.'] }
      const { post } = await import('../lib/ledger')
      const posted = await post(uow, { clientId: mapped.recordId, kind: 'adjustment', amountMinor: signed, postedOn: importDate(row.asOf)!, entryKey, memo: `Opening balance from ${batch.system} (${batch.ref})` })
      await mapExternal(uow, sys, 'ClientLedgerEntry', posted.id, key)
      auditCreate(uow, actor, 'ClientLedgerEntry', posted.id, 'balance.imported', { batch: batch.ref, rowNumber, amountMinor: signed.toString() })
      return { ...base, result: 'created', recordType: 'ClientLedgerEntry', recordId: posted.id }
    }
    case 'consults': {
      const patientId = await patientFor(row.patientExternalId)
      const on = importDate(row.date)!
      const ref = await nextReference(uow.tx, 'ENC', uow.now)
      const startedAt = new Date(`${on}T12:00:00Z`)
      const body = row.notes.trim()
      const content = { importedFrom: batch.system, externalId: key, date: on, vet: row.vet ?? '', reason: row.reason ?? '', notes: body, batch: batch.ref }
      const hash = signedContentHash(toJsonValue(content))
      const enc = await uow.tx.encounter.create({ data: { ref, patientId, locationId: batch.locationId, kind: 'records_import', vcprQualifying: false, status: 'open', reason: (row.reason ?? '').slice(0, 300), startedAt, importedFrom: `${batch.system}:${key}` } })
      const section = await uow.tx.soapSection.create({ data: { encounterId: enc.id, kind: 'history', ordinal: 1, body, source: 'import' } })
      await uow.tx.soapSectionRevision.create({ data: { sectionId: section.id, revisionNumber: 1, body, source: 'import', authorUserId: actorUserId(actor), at: uow.now, contentHash: revisionHash({ kind: 'history', ordinal: 1, body, structured: null, source: 'import', author: `import:${batch.system}` }) } })
      await uow.tx.soapSection.update({ where: { id: section.id }, data: { lockedAt: uow.now } })
      // Signed in the source system: the record carries the source attribution and hash, no local signer licence.
      await uow.tx.$executeRawUnsafe(`UPDATE "Encounter" SET status = 'signed', "signedAt" = $2, "contentHash" = $3, "signedContent" = $4::jsonb, "submittedAt" = $2, version = version + 1 WHERE id = $1`, enc.id, uow.now, hash, JSON.stringify({ ...content, signer: { source: batch.system, name: row.vet ?? '' } }))
      await mapExternal(uow, sys, 'Encounter', enc.id, key)
      auditCreate(uow, actor, 'Encounter', enc.id, 'encounter.imported', { ref, batch: batch.ref, rowNumber, contentHash: hash })
      return { ...base, result: 'created', recordType: 'Encounter', recordId: enc.id }
    }
  }
}

/**
 * Apply a validated batch in chunks; each chunk commits on its own so a 20 000-row file never holds
 * one long transaction. Resuming after a crash is safe: rows already mapped are skipped.
 */
export async function applyImport(_root: unknown, args: { batchId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageOnboarding'], tool: 'import.apply', humanOnly: true }, args, async actor => {
    const prisma = context.prisma
    const claim = await command(prisma, { name: 'import.apply', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const rows = await uow.tx.$queryRawUnsafe<{ id: string; status: string }[]>(`SELECT id, status FROM "ImportBatch" WHERE id = $1 FOR UPDATE`, args.batchId)
      if (!rows.length) throw new DomainError(Codes.NOT_FOUND, 'Import batch not found.')
      // validated → applying starts a run; applying → applying resumes one that stopped part-way
      // (rows already mapped are skipped below), with a fresh idempotency key.
      if (!['validated', 'applying'].includes(rows[0].status)) throw new DomainError(Codes.INVALID_TRANSITION, `The batch is ${rows[0].status}.`, { currentStatus: rows[0].status })
      const resumed = rows[0].status === 'applying'
      await uow.tx.importBatch.update({ where: { id: args.batchId }, data: { status: 'applying', version: { increment: 1 } } })
      uow.audit({ eventType: resumed ? 'import.apply_resumed' : 'import.apply_started', entityType: 'ImportBatch', entityId: args.batchId, actorUserId: actorUserId(actor) })
      return { started: true, resumed }
    })
    if (claim.replay) {
      const b = await prisma.importBatch.findUnique({ where: { id: args.batchId }, select: { ref: true, status: true, rowsCreated: true, rowsSkipped: true, rowsFailed: true, rowsTotal: true } })
      return { replay: true, ...b }
    }
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: args.batchId }, select: { id: true, ref: true, system: true, entity: true, locationId: true, mapping: true, rowsTotal: true } })
    const stored = (batch.mapping as unknown as { rows: Row[] }).rows
    const totals = { created: 0, skipped: 0, failed: 0 }
    for (let start = 0; start < stored.length; start += CHUNK) {
      const chunk = stored.slice(start, start + CHUNK)
      const results: RowResult[] = []
      for (const [i, values] of chunk.entries()) {
        const rowNumber = start + i + 2
        const done = await prisma.importRow.findUnique({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber } }, select: { id: true } })
        if (done) continue
        // Each row in its own savepoint-equivalent transaction: one bad row never rolls back its neighbours.
        try {
          const r = await runInTransaction(prisma, uow => applyRow(uow, actor, batch as never, values, rowNumber).then(async res => {
            await uow.tx.importRow.create({ data: { batchId: batch.id, rowNumber, externalId: res.externalId || `row-${rowNumber}`, result: res.result, recordType: res.recordType ?? '', recordId: res.recordId ?? '', errors: toJsonValue(res.errors) as never } })
            return res
          }))
          results.push(r)
        } catch (error) {
          const message = error instanceof DomainError ? error.message : (invariantError(error)?.message ?? 'The row could not be saved.')
          await prisma.importRow.create({ data: { batchId: batch.id, rowNumber, externalId: rowKey(batch.entity as ImportEntity, values) || `row-${rowNumber}`, result: 'failed', errors: [message] } })
          results.push({ rowNumber, externalId: '', result: 'failed', errors: [message] })
        }
      }
      for (const r of results) totals[r.result === 'created' ? 'created' : r.result === 'skipped_existing' ? 'skipped' : 'failed']++
      await prisma.importBatch.update({ where: { id: batch.id }, data: { rowsCreated: { increment: results.filter(r => r.result === 'created').length }, rowsSkipped: { increment: results.filter(r => r.result === 'skipped_existing').length }, rowsFailed: { increment: results.filter(r => r.result === 'failed').length } } })
    }
    const final = await runInTransaction(prisma, async uow => {
      const row = await uow.tx.importBatch.update({ where: { id: batch.id }, data: { status: 'applied', finishedAt: uow.now, version: { increment: 1 } }, select: { ref: true, status: true, rowsCreated: true, rowsSkipped: true, rowsFailed: true, rowsTotal: true } })
      uow.audit({ eventType: 'import.applied', entityType: 'ImportBatch', entityId: batch.id, actorUserId: actorUserId(actor), after: { ...row, run: totals } })
      return row
    })
    return { replay: false, ...final }
  })
}
