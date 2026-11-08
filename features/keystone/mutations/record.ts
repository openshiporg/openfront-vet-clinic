import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { actorUserId, type Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { requestApproval } from '../lib/approval'
import { registerApplier } from '../lib/approvalAppliers'
import { toJsonValue } from '../lib/canonical'
import { addDays } from '../lib/calendar'
import { resolvePolicy } from '../domain/policy'
import { requireLicence } from '../domain/licensure'
import { addendumHash, checkCompleteness, establishesVcpr, revisionHash, signedContentHash, type EncounterEvidence } from '../domain/record'
import { addMonths } from '../domain/vaccines'
import { ENCOUNTER_KINDS, REPEATABLE_SECTIONS, SECTION_KINDS, EXAM_SYSTEMS } from '../models/record'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { activePatient, chartableEncounter, day, latestWeight, locationDay, markInProgress, staffById, staffOf, text, type Ctx, type StaffRow } from './clinical'

/*
 * The medical record (STATE-MACHINES §5, DOMAIN I-R1–I-R4). Every command here is human-only: an
 * agent can read what it is granted but never writes, signs, amends or voids a record.
 *   open → in_progress (first entry) → pending_signature (completeness) → signed (DVM, licence, hash)
 *   signed → addenda only;  open|in_progress → voided (maker-checker)
 */

const IN_PERSON = new Set(['outpatient', 'inpatient_day', 'surgery', 'dental', 'emergency', 'euthanasia'])

export async function openEncounter(_root: unknown, args: { patientId: string; locationId: string; kind: string; appointmentId?: string | null; reason?: string | null; attendingDvmId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'encounter.open', humanOnly: true }, args, async actor => {
    if (!(ENCOUNTER_KINDS as readonly string[]).includes(args.kind) || args.kind === 'records_import') throw new DomainError(Codes.INVALID_INPUT, 'Choose the kind of visit.', { field: 'kind' })
    const result = await command(context.prisma, { name: 'encounter.open', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const patient = await activePatient(uow, args.patientId)
      await locationDay(uow, args.locationId, uow.now)
      if (args.appointmentId) {
        const appt = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { status: true, locationId: true, providerId: true, patients: { select: { patientId: true } } } })
        if (!appt) throw new DomainError(Codes.NOT_FOUND, 'Appointment not found.')
        if (!appt.patients.some(p => p.patientId === args.patientId)) throw new DomainError(Codes.INVALID_INPUT, 'That patient is not on the appointment.', { field: 'patientId' })
        if (['cancelled', 'no_show', 'declined'].includes(appt.status)) throw new DomainError(Codes.GUARD_FAILED, `The appointment is ${appt.status}.`)
        const existing = await uow.tx.encounter.findFirst({ where: { appointmentId: args.appointmentId, patientId: args.patientId, status: { not: 'voided' } }, select: { id: true, ref: true, status: true } })
        if (existing) return { id: existing.id, ref: existing.ref, status: existing.status, existing: true }
        if (!args.attendingDvmId && appt.providerId) args = { ...args, attendingDvmId: appt.providerId }
      }
      let attending: StaffRow | null = args.attendingDvmId ? await staffById(uow, args.attendingDvmId) : staff.kind === 'dvm' ? staff : null
      if (attending && attending.kind !== 'dvm') attending = null
      const weight = await latestWeight(uow, patient.id)
      const ref = await nextReference(uow.tx, 'ENC', uow.now)
      const enc = await uow.tx.encounter.create({
        data: {
          ref, patientId: patient.id, locationId: args.locationId, appointmentId: args.appointmentId ?? null, kind: args.kind, vcprQualifying: IN_PERSON.has(args.kind),
          status: 'open', reason: text(args.reason ?? '', 'reason', 300, false), attendingDvmId: attending?.id ?? null, weightUsedId: weight?.id ?? null, startedAt: uow.now,
          participants: { connect: [{ id: staff.id }] },
        },
      })
      auditCreate(uow, actor, 'Encounter', enc.id, 'encounter.opened', { ref, patientId: patient.id, kind: args.kind, appointmentId: args.appointmentId ?? null, attendingDvmId: attending?.id ?? null })
      return { id: enc.id, ref, status: enc.status, existing: false }
    })
    return { replay: result.replay, ...result.value }
  })
}

type SectionWrite = { kind: string; ordinal?: number | null; body: string; structured?: unknown; source: 'typed' | 'template' | 'scribe' | 'import'; templateId?: string | null; scribeDraftId?: string | null; expectedVersion?: number | null }

/** Section write with compare-and-set (I-R2): a stale version is refused, never merged. */
export async function writeSection(uow: UnitOfWork, actor: Actor, staff: StaffRow, encounterId: string, input: SectionWrite) {
  if (!(SECTION_KINDS as readonly string[]).includes(input.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Unknown record section.', { field: 'kind' })
  const body = text(input.body, 'body', 20_000, false)
  const enc = await chartableEncounter(uow, encounterId)
  const repeatable = (REPEATABLE_SECTIONS as readonly string[]).includes(input.kind)
  let ordinal = input.ordinal ?? 1
  if (repeatable && input.ordinal == null) {
    const last = await uow.tx.soapSection.findFirst({ where: { encounterId, kind: input.kind }, orderBy: { ordinal: 'desc' }, select: { ordinal: true } })
    ordinal = (last?.ordinal ?? 0) + 1
  }
  const existing = await uow.tx.soapSection.findFirst({ where: { encounterId, kind: input.kind, ordinal }, select: { id: true } })
  let sectionId: string
  let version: number
  if (!existing) {
    if (input.expectedVersion != null && input.expectedVersion !== 0) throw new DomainError(Codes.STALE_STATE, 'This section was removed or never saved. Reload and try again.', { currentVersion: 0 })
    try {
      const created = await uow.tx.soapSection.create({ data: { encounterId, kind: input.kind, ordinal, body, structured: (input.structured ?? null) as never, source: input.source, lastAuthorId: staff.id } })
      sectionId = created.id
      version = created.version
    } catch (error) {
      if (String((error as { code?: string })?.code) === 'P2002') throw new DomainError(Codes.STALE_STATE, 'Someone else just started this section. Reload to see their text.', { currentVersion: 0 })
      throw error
    }
  } else {
    const row = await lockRow<{ id: string; version: number; lockedAt: Date | null; body: string }>(uow.tx, 'SoapSection', existing.id)
    if (row.lockedAt) throw new DomainError(Codes.GUARD_FAILED, 'This section is signed. Add an addendum instead.', { reason: 'signed' })
    if (input.expectedVersion == null || input.expectedVersion !== row.version) {
      throw new DomainError(Codes.STALE_STATE, 'Someone else saved this section since you opened it. Reload to see their changes, then save again.', { currentVersion: row.version })
    }
    const updated = await uow.tx.soapSection.updateMany({ where: { id: row.id, version: row.version }, data: { body, structured: (input.structured ?? null) as never, source: input.source, lastAuthorId: staff.id, version: { increment: 1 } } })
    if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, 'Someone else saved this section since you opened it.', { currentVersion: row.version })
    sectionId = row.id
    version = row.version + 1
  }
  const revisionNumber = (await uow.tx.soapSectionRevision.count({ where: { sectionId } })) + 1
  const hash = revisionHash({ kind: input.kind, ordinal, body, structured: input.structured ?? null, source: input.source, author: staff.id })
  await uow.tx.soapSectionRevision.create({
    data: { sectionId, revisionNumber, body, structured: (input.structured ?? null) as never, source: input.source, templateId: input.templateId ?? null, scribeDraftId: input.scribeDraftId ?? null, authorId: staff.id, authorUserId: actorUserId(actor), at: uow.now, contentHash: hash },
  })
  await markInProgress(uow, enc)
  await uow.tx.encounter.update({ where: { id: encounterId }, data: { participants: { connect: [{ id: staff.id }] } } })
  uow.audit({ eventType: 'record.section_saved', entityType: 'SoapSection', entityId: sectionId, actorUserId: actorUserId(actor), after: { encounterId, kind: input.kind, ordinal, version, revisionNumber, source: input.source, contentHash: hash } })
  return { id: sectionId, kind: input.kind, ordinal, version, revisionNumber }
}

export async function saveSoapSection(_root: unknown, args: { encounterId: string; kind: string; ordinal?: number | null; body: string; structured?: unknown; templateId?: string | null; expectedVersion?: number | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'record.section_save', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'record.section_save', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      return writeSection(uow, actor, staff, args.encounterId, { kind: args.kind, ordinal: args.ordinal, body: args.body, structured: args.structured, source: args.templateId ? 'template' : 'typed', templateId: args.templateId, expectedVersion: args.expectedVersion })
    })
    return { replay: result.replay, ...result.value }
  })
}

const intOrNull = (v: unknown, field: string, min: number, max: number) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new DomainError(Codes.INVALID_INPUT, `${field} must be a whole number from ${min} to ${max}.`, { field })
  return n
}
const decOrNull = (v: unknown, field: string) => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new DomainError(Codes.INVALID_INPUT, `${field} is a number with up to 2 decimals.`, { field })
  return s
}

export async function recordVitals(_root: unknown, args: { encounterId: string; temperature?: string | null; temperatureUnit?: 'F' | 'C' | null; heartRate?: number | null; respRate?: number | null; mucousMembranes?: string | null; crtSeconds?: string | null; painScore?: number | null; bodyConditionScore?: number | null; mentation?: string | null; hydrationPct?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord', 'canAdminister'], tool: 'record.vitals', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'record.vitals', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      const data = {
        encounterId: enc.id, patientId: enc.patientId, temperature: decOrNull(args.temperature, 'temperature'), temperatureUnit: args.temperatureUnit === 'C' ? 'C' : 'F',
        heartRate: intOrNull(args.heartRate, 'heartRate', 1, 500), respRate: intOrNull(args.respRate, 'respRate', 1, 300), mucousMembranes: args.mucousMembranes ?? null,
        crtSeconds: decOrNull(args.crtSeconds, 'crtSeconds'), painScore: intOrNull(args.painScore, 'painScore', 0, 10), bodyConditionScore: intOrNull(args.bodyConditionScore, 'bodyConditionScore', 1, 9),
        mentation: args.mentation ?? null, hydrationPct: decOrNull(args.hydrationPct, 'hydrationPct'), at: uow.now, byId: staff.id,
      }
      // M7: the same plausible ranges as the CHECK VitalsObservation_ranges, refused here with a clear message.
      if (args.temperatureUnit && !['F', 'C'].includes(args.temperatureUnit)) throw new DomainError(Codes.INVALID_INPUT, 'Temperature unit is °F or °C.', { field: 'temperatureUnit' })
      if (data.temperature !== null) {
        const t = Number(data.temperature)
        const [lo, hi] = data.temperatureUnit === 'F' ? [80, 115] : [26, 46]
        if (t < lo || t > hi) throw new DomainError(Codes.INVALID_INPUT, `Temperature ${data.temperature} °${data.temperatureUnit} is outside ${lo}–${hi} °${data.temperatureUnit}. Check the reading and the unit.`, { field: 'temperature' })
      }
      if (data.crtSeconds !== null && Number(data.crtSeconds) > 10) throw new DomainError(Codes.INVALID_INPUT, 'Capillary refill time is 0–10 seconds.', { field: 'crtSeconds' })
      if (data.hydrationPct !== null && Number(data.hydrationPct) > 20) throw new DomainError(Codes.INVALID_INPUT, 'Dehydration is 0–20 %.', { field: 'hydrationPct' })
      if (![data.temperature, data.heartRate, data.respRate, data.mucousMembranes, data.crtSeconds, data.painScore, data.bodyConditionScore, data.mentation, data.hydrationPct].some(v => v !== null)) {
        throw new DomainError(Codes.INVALID_INPUT, 'Enter at least one vital sign.')
      }
      const row = await uow.tx.vitalsObservation.create({ data })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'VitalsObservation', row.id, 'record.vitals_recorded', { encounterId: enc.id })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function setExamFinding(_root: unknown, args: { encounterId: string; system: string; status: 'normal' | 'abnormal' | 'not_examined'; text?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'record.exam_finding', humanOnly: true }, args, async actor => {
    if (!(EXAM_SYSTEMS as readonly string[]).includes(args.system)) throw new DomainError(Codes.INVALID_INPUT, 'Unknown body system.', { field: 'system' })
    if (!['normal', 'abnormal', 'not_examined'].includes(args.status)) throw new DomainError(Codes.INVALID_INPUT, 'Choose normal, abnormal or not examined.', { field: 'status' })
    if (args.status === 'abnormal' && !String(args.text ?? '').trim()) throw new DomainError(Codes.INVALID_INPUT, 'Describe the abnormal finding.', { field: 'text' })
    const result = await command(context.prisma, { name: 'record.exam_finding', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      const existing = await uow.tx.physicalExamFinding.findFirst({ where: { encounterId: enc.id, system: args.system }, select: { id: true } })
      const data = { status: args.status, text: text(args.text ?? '', 'text', 2000, false), byId: staff.id }
      const row = existing
        ? await uow.tx.physicalExamFinding.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await uow.tx.physicalExamFinding.create({ data: { encounterId: enc.id, system: args.system, ...data } })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'PhysicalExamFinding', row.id, 'record.exam_finding_set', { encounterId: enc.id, system: args.system, status: args.status })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addDiagnosis(_root: unknown, args: { encounterId: string; term?: string | null; codeId?: string | null; certainty: string; addToProblems?: boolean | null; chronic?: boolean | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'record.diagnosis', humanOnly: true }, args, async actor => {
    if (!['presumptive', 'differential', 'confirmed', 'ruled_out'].includes(args.certainty)) throw new DomainError(Codes.INVALID_INPUT, 'Choose how certain the diagnosis is.', { field: 'certainty' })
    const result = await command(context.prisma, { name: 'record.diagnosis', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      const code = args.codeId ? await uow.tx.diagnosisCode.findUnique({ where: { id: args.codeId }, select: { id: true, term: true, active: true } }) : null
      if (args.codeId && (!code || !code.active)) throw new DomainError(Codes.NOT_FOUND, 'Diagnosis code not found.')
      const term = code?.term ?? text(args.term, 'term', 200)
      let problemId: string | null = null
      if (args.addToProblems && args.certainty !== 'ruled_out') {
        const open = await uow.tx.problem.findFirst({ where: { patientId: enc.patientId, term, status: 'active' }, select: { id: true } })
        problemId = open?.id ?? (await uow.tx.problem.create({ data: { patientId: enc.patientId, encounterId: enc.id, codeId: code?.id ?? null, term, status: 'active', chronic: args.chronic === true, onset: new Date(`${uow.now.toISOString().slice(0, 10)}T00:00:00Z`) } })).id
      }
      const row = await uow.tx.diagnosis.create({ data: { encounterId: enc.id, patientId: enc.patientId, codeId: code?.id ?? null, term, certainty: args.certainty, problemId, byId: staff.id } })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'Diagnosis', row.id, 'record.diagnosis_added', { encounterId: enc.id, term, certainty: args.certainty, problemId })
      return { id: row.id, problemId }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function resolveProblem(_root: unknown, args: { problemId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'record.problem_resolve', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'record.problem_resolve', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'Problem', id: args.problemId, from: ['active', 'inactive'], to: 'resolved', expectedVersion: args.expectedVersion, actor, eventType: 'record.problem_resolved', data: { resolvedAt: uow.now } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Everything the completeness check and the signing hash need, read once. */
async function encounterEvidence(uow: UnitOfWork, encounterId: string, signer: StaffRow | null) {
  const enc = await uow.tx.encounter.findUniqueOrThrow({
    where: { id: encounterId },
    select: {
      id: true, ref: true, kind: true, startedAt: true, locationId: true, patientId: true, reason: true, attendingDvmId: true, weightUsedId: true,
      patient: { select: { ref: true, name: true, dateOfBirth: true, sex: true, reproductiveStatus: true, colourMarkings: true, species: { select: { code: true, name: true } }, breed: { select: { name: true } },
        ownerships: { where: { role: 'primary', effectiveTo: null }, select: { client: { select: { ref: true, displayName: true, addressLine1: true, city: true, postalCode: true, people: { where: { isPrimary: true }, select: { firstName: true, lastName: true, contactPoints: { where: { isPrimary: true, status: 'active' }, select: { kind: true, value: true } } } } } } } } } },
      sections: { orderBy: [{ kind: 'asc' }, { ordinal: 'asc' }], select: { id: true, kind: true, ordinal: true, body: true, structured: true } },
      vitals: { orderBy: { at: 'asc' }, select: { temperature: true, temperatureUnit: true, heartRate: true, respRate: true, mucousMembranes: true, crtSeconds: true, painScore: true, bodyConditionScore: true, mentation: true, hydrationPct: true, at: true } },
      findings: { orderBy: { system: 'asc' }, select: { system: true, status: true, text: true } },
      diagnoses: { orderBy: { createdAt: 'asc' }, select: { term: true, certainty: true } },
      orders: { orderBy: { createdAt: 'asc' }, select: { ref: true, kind: true, description: true, status: true, route: true, frequency: true, quantity: true, quantityUnit: true, dose: { select: { doseAmount: true, doseUnit: true, dosePer: true, totalAmount: true, roundedQty: true, computedUnit: true, manualOverrideQty: true, hash: true } }, administrations: { orderBy: { givenAt: 'asc' }, select: { qty: true, unit: true, route: true, lotNumber: true, givenAt: true, givenById: true } } } },
    },
  })
  const vaccines = await uow.tx.vaccineAdministration.findMany({ where: { encounterId }, orderBy: { administeredOn: 'asc' }, select: { lotNumber: true, lotExpiresOn: true, administeredOn: true, dueNextOn: true, site: true, route: true, product: { select: { name: true } } } })
  const anaesthesia = await uow.tx.anaesthesiaRecord.findMany({ where: { encounterId }, select: { ref: true, status: true, asaStatus: true, inductionAt: true, recoveryEndAt: true } })
  const surgery = await uow.tx.surgeryReport.count({ where: { encounterId } })
  const client = enc.patient?.ownerships[0]?.client ?? null
  const person = client?.people[0]
  const phone = person?.contactPoints.find(c => c.kind !== 'email')?.value ?? ''
  const meds = enc.orders.filter(o => o.kind === 'medication' && o.status !== 'cancelled')
  const evidence: EncounterEvidence = {
    kind: enc.kind,
    startedAt: enc.startedAt,
    client: client ? { name: person ? `${person.firstName} ${person.lastName}` : client.displayName, address: [client.addressLine1, client.city, client.postalCode].filter(Boolean).join(', '), phone } : null,
    patient: { name: enc.patient?.name ?? '', species: enc.patient?.species?.code ?? null, breed: enc.patient?.breed?.name ?? null, ageKnown: Boolean(enc.patient?.dateOfBirth), sex: enc.patient?.sex ?? null, colour: enc.patient?.colourMarkings ?? null },
    sections: enc.sections.map(s => ({ kind: s.kind, ordinal: s.ordinal, body: s.body, structured: s.structured })),
    vitalsCount: enc.vitals.length,
    findingsCount: enc.findings.filter(f => f.status !== 'not_examined').length,
    diagnosesCount: enc.diagnoses.filter(d => d.certainty !== 'ruled_out').length,
    medications: meds.map(o => ({ description: o.description, dose: o.dose ? `${(o.dose.manualOverrideQty ?? o.dose.roundedQty ?? o.dose.totalAmount).toString()} ${o.dose.computedUnit ?? ''}`.trim() : null, route: o.route || null, frequency: o.frequency || null, quantity: o.quantity?.toString() ?? null })),
    vaccines: vaccines.map(v => ({ lotNumber: v.lotNumber, lotExpiresOn: day(v.lotExpiresOn) })),
    anaesthesiaGiven: anaesthesia.length > 0,
    anaesthesiaRecordClosed: anaesthesia.every(a => a.status === 'closed'),
    surgeryPerformed: enc.kind === 'surgery',
    surgeryReportPresent: surgery > 0,
    signerIsDvm: signer?.kind === 'dvm',
  }
  const content = {
    encounter: { ref: enc.ref, kind: enc.kind, startedAt: enc.startedAt, reason: enc.reason, weightUsedId: enc.weightUsedId },
    patient: { ref: enc.patient?.ref, name: enc.patient?.name, species: enc.patient?.species?.name, breed: enc.patient?.breed?.name ?? null, sex: enc.patient?.sex, reproductiveStatus: enc.patient?.reproductiveStatus, dateOfBirth: day(enc.patient?.dateOfBirth) },
    client: client ? { ref: client.ref, name: evidence.client?.name, address: evidence.client?.address, phone } : null,
    sections: enc.sections.map(s => ({ kind: s.kind, ordinal: s.ordinal, body: s.body, structured: s.structured ?? null })),
    vitals: enc.vitals,
    findings: enc.findings,
    diagnoses: enc.diagnoses,
    orders: enc.orders,
    vaccines,
    anaesthesia,
  }
  return { enc, evidence, content }
}

async function recordsPolicy(uow: UnitOfWork, locationId: string, at: Date) {
  const { on } = await locationDay(uow, locationId, at)
  return resolvePolicy(uow.tx, 'medical_records', { locationId, on })
}

/** in_progress → pending_signature, after the completeness check (I-R4). */
export async function submitEncounter(_root: unknown, args: { encounterId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'encounter.submit', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'encounter.submit', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      const policy = await recordsPolicy(uow, enc.locationId!, uow.now)
      const { evidence } = await encounterEvidence(uow, enc.id, null)
      // The signer's identity is checked when the veterinarian signs, not when the record is submitted.
      const check = checkCompleteness(policy.rules.requiredFields.filter(f => f !== 'author_identity'), evidence)
      if (!check.complete) throw new DomainError(Codes.GUARD_FAILED, `The record is incomplete: ${check.missing.map(m => m.message).join(' ')}`, { reason: 'incomplete', problems: check.missing })
      const row = await transition(uow, { model: 'Encounter', id: enc.id, from: ['open', 'in_progress'], to: 'pending_signature', expectedVersion: args.expectedVersion, actor, eventType: 'encounter.submitted', data: { submittedAt: uow.now, completeness: toJsonValue({ ...check, policyVersions: policy.versions.map(v => v.id), checkedAt: uow.now }) as never } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function returnEncounter(_root: unknown, args: { encounterId: string; expectedVersion: number; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'encounter.return', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'encounter.return', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'Encounter', id: args.encounterId, from: ['pending_signature'], to: 'in_progress', expectedVersion: args.expectedVersion, actor, eventType: 'encounter.returned', reason })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Sign [L] (SM§5): a veterinarian on the encounter (or the medical director) with an active licence
 * for the location's state. The canonical content is hashed and frozen; the sections lock; a
 * qualifying visit establishes or renews the VCPR; the signed record is rendered via the outbox.
 */
export async function signEncounter(_root: unknown, args: { encounterId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canSignRecord'], tool: 'encounter.sign', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'encounter.sign', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.LICENSE_INACTIVE, 'Only a veterinarian signs the medical record.')
      const current = await lockRow<{ id: string; ref: string; status: string; version: number; locationId: string; patientId: string; kind: string; attendingDvmId: string | null }>(uow.tx, 'Encounter', args.encounterId)
      if (current.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, `${current.ref} changed since you loaded it. Reload and try again.`, { currentStatus: current.status, currentVersion: current.version })
      if (!['in_progress', 'pending_signature'].includes(current.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${current.ref} is ${current.status.replace(/_/g, ' ')}; it cannot be signed.`, { currentStatus: current.status })
      const settings = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { medicalDirectorId: true } })
      const participants = await uow.tx.encounter.findUnique({ where: { id: current.id }, select: { participants: { select: { id: true } } } })
      const onEncounter = current.attendingDvmId === staff.id || participants?.participants.some(p => p.id === staff.id) || settings?.medicalDirectorId === staff.id
      if (current.attendingDvmId && !onEncounter) throw new DomainError(Codes.GUARD_FAILED, 'Only the attending veterinarian, a veterinarian who charted this visit, or the medical director can sign it.')
      const licence = await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: current.locationId, action: 'sign_record', at: uow.now })
      const policy = await recordsPolicy(uow, current.locationId, uow.now)
      const { evidence, content } = await encounterEvidence(uow, current.id, staff)
      const check = checkCompleteness(policy.rules.requiredFields, evidence)
      if (!check.complete) throw new DomainError(Codes.GUARD_FAILED, `The record is incomplete: ${check.missing.map(m => m.message).join(' ')}`, { reason: 'incomplete', problems: check.missing })

      // VCPR (I-C5): a qualifying in-person visit signed by the DVM establishes or renews it.
      let vcprId: string | null = null
      const { on } = await locationDay(uow, current.locationId, uow.now)
      const vcpr = await resolvePolicy(uow.tx, 'vcpr', { locationId: current.locationId, on })
      if (establishesVcpr(current.kind, vcpr.rules.establishment)) {
        await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: current.locationId, action: 'establish_vcpr', at: uow.now })
        const expiresOn = addMonths(on, vcpr.rules.durationMonths)
        const row = await uow.tx.vcprRecord.create({
          data: { patientId: current.patientId, scope: vcpr.rules.level, dvmId: staff.id, locationId: current.locationId, establishedByRef: current.ref, establishedVia: 'encounter', establishedAt: uow.now, expiresAt: new Date(`${expiresOn}T23:59:59Z`), status: 'active', policyVersionId: vcpr.versions[vcpr.versions.length - 1]?.id ?? null },
        })
        vcprId = row.id
        auditCreate(uow, actor, 'VcprRecord', row.id, 'vcpr.established', { patientId: current.patientId, scope: vcpr.rules.level, encounter: current.ref, expiresOn })
      }

      const signedContent = toJsonValue({ ...content, signer: { staffMemberId: staff.id, name: staff.displayName, licenseId: licence.licenseId }, signedAt: uow.now })
      const contentHash = signedContentHash(signedContent)
      await uow.tx.soapSection.updateMany({ where: { encounterId: current.id, lockedAt: null }, data: { lockedAt: uow.now, version: { increment: 1 } } })
      await uow.tx.surgeryReport.updateMany({ where: { encounterId: current.id, status: 'draft' }, data: { status: 'signed', version: { increment: 1 } } })
      const doc = await uow.tx.clinicalDocument.create({ data: { patientId: current.patientId, encounterId: current.id, kind: 'encounter_record', title: `Medical record ${current.ref}`, status: 'pending_render', sourceType: 'Encounter', sourceId: current.id, sourceHash: contentHash, signedById: staff.id } })
      const updated = await uow.tx.encounter.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          status: 'signed', signedById: staff.id, signedAt: uow.now, contentHash, signedContent: signedContent as never, licenseEvaluationId: licence.evaluationId, vcprId,
          policyVersionId: policy.versions[policy.versions.length - 1]?.id ?? null, completeness: toJsonValue({ ...check, checkedAt: uow.now }) as never, version: { increment: 1 },
          ...(current.attendingDvmId ? {} : { attendingDvmId: staff.id }),
        },
      })
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, `${current.ref} changed while signing.`)
      await uow.tx.task.updateMany({ where: { subjectType: 'Encounter', subjectId: current.id, kind: 'record_unsigned', status: { in: ['open', 'in_progress'] } }, data: { status: 'done', completedAt: uow.now, version: { increment: 1 } } })
      uow.emit({ topic: 'document.render', aggregateType: 'ClinicalDocument', aggregateId: doc.id, payload: { encounterId: current.id, contentHash }, dedupeKey: `document.render:${doc.id}` })
      uow.audit({ eventType: 'encounter.signed', entityType: 'Encounter', entityId: current.id, actorUserId: actorUserId(actor), before: { status: current.status, version: current.version }, after: { status: 'signed', version: current.version + 1, contentHash, signedById: staff.id, licenseEvaluationId: licence.evaluationId, vcprId, documentId: doc.id } })
      return { id: current.id, ref: current.ref, status: 'signed', contentHash, vcprId, documentId: doc.id, verified: policy.verified }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Addendum (I-R1): after signing; the signed hash never changes. Assessment or plan changes need a DVM. */
export async function addAddendum(_root: unknown, args: { encounterId: string; sectionKind: string; reason: string; body: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'record.addendum', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const body = text(args.body, 'body', 10_000)
    if (![...SECTION_KINDS, 'general'].includes(args.sectionKind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose which part of the record this amends.', { field: 'sectionKind' })
    const result = await command(context.prisma, { name: 'record.addendum', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, ref: true, status: true, contentHash: true } })
      if (!enc) throw new DomainError(Codes.NOT_FOUND, 'Encounter not found.')
      if (enc.status !== 'signed') throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} is not signed yet; edit the section instead.`)
      if (['assessment', 'plan'].includes(args.sectionKind) && staff.kind !== 'dvm') throw new DomainError(Codes.GUARD_FAILED, 'A change to the assessment or plan is a veterinarian\'s addendum.')
      const hash = addendumHash({ encounterId: enc.id, contentHash: enc.contentHash, sectionKind: args.sectionKind, reason, body, author: staff.id, signedAt: uow.now })
      const row = await uow.tx.addendum.create({ data: { encounterId: enc.id, sectionKind: args.sectionKind, authorId: staff.id, authorIsDvm: staff.kind === 'dvm', reason, body, signedAt: uow.now, hash } })
      auditCreate(uow, actor, 'Addendum', row.id, 'record.addendum_added', { encounterId: enc.id, ref: enc.ref, sectionKind: args.sectionKind, hash }, { reason })
      return { id: row.id, hash }
    })
    return { replay: result.replay, ...result.value }
  })
}

async function voidBlockers(uow: UnitOfWork, encounterId: string) {
  const [orders, administrations, vaccines] = await Promise.all([
    uow.tx.clinicalOrder.count({ where: { encounterId, status: { notIn: ['cancelled', 'reversed'] } } }),
    // Doses still standing: neither a reversal row nor reversed since (M5).
    uow.tx.administration.count({ where: { encounterId, reversesId: null, from_Administration_reverses: { none: {} } } }),
    uow.tx.vaccineAdministration.count({ where: { encounterId, reversesId: null, from_VaccineAdministration_reverses: { none: {} } } }),
  ])
  const blockers: string[] = []
  if (orders) blockers.push(`${orders} active order${orders === 1 ? '' : 's'}`)
  if (administrations) blockers.push(`${administrations} administration${administrations === 1 ? '' : 's'}`)
  if (vaccines) blockers.push(`${vaccines} vaccine${vaccines === 1 ? '' : 's'}`)
  return blockers
}

/** Void [MC]: open or in-progress records with nothing given or charged; a second person approves. */
export async function requestVoidEncounter(_root: unknown, args: { encounterId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'encounter.void_request', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'encounter.void_request', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const enc = await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, ref: true, status: true, version: true } })
      if (!enc) throw new DomainError(Codes.NOT_FOUND, 'Encounter not found.')
      if (!['open', 'in_progress'].includes(enc.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${enc.ref} is ${enc.status.replace(/_/g, ' ')}; only an open or in-progress record can be voided.`)
      const blockers = await voidBlockers(uow, enc.id)
      if (blockers.length) throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} has ${blockers.join(', ')}; cancel or reverse them first.`)
      const request = await requestApproval(uow, actor, { action: 'encounter.void', targetList: 'Encounter', targetId: enc.id, payload: { encounterId: enc.id, reason, baseVersion: enc.version }, summary: `Void ${enc.ref}: ${reason}`, requiredPermission: 'canSignRecord' })
      return { approvalRequestId: request.id, status: request.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

registerApplier('encounter.void', async (uow, actor, request) => {
  const { encounterId, reason, baseVersion } = request.payload as { encounterId: string; reason: string; baseVersion: number }
  const blockers = await voidBlockers(uow, encounterId)
  if (blockers.length) throw new DomainError(Codes.GUARD_FAILED, `The encounter now has ${blockers.join(', ')}; it can no longer be voided.`)
  const row = await transition(uow, { model: 'Encounter', id: encounterId, from: ['open', 'in_progress'], to: 'voided', expectedVersion: baseVersion, actor, eventType: 'encounter.voided', reason, approverId: actorUserId(actor), data: { voidReason: reason, voidApprovalId: request.id } })
  await uow.tx.task.updateMany({ where: { subjectType: 'Encounter', subjectId: encounterId, kind: 'record_unsigned', status: { in: ['open', 'in_progress'] } }, data: { status: 'cancelled', completedAt: uow.now, version: { increment: 1 } } })
  return { id: row.id, status: row.status }
})

/**
 * Unsigned-record clock (SM§5): an encounter still unsigned `unsignedRecordTaskHours` after it
 * started raises a task for the attending DVM; after `unsignedRecordEscalateHours` the task goes to
 * the medical director (once). Idempotent: one task per encounter, escalated at most once.
 */
export async function runUnsignedRecordClock(uow: UnitOfWork) {
  const settings = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { unsignedRecordTaskHours: true, unsignedRecordEscalateHours: true, medicalDirectorId: true } })
  const taskHours = settings?.unsignedRecordTaskHours ?? 24
  const escalateHours = settings?.unsignedRecordEscalateHours ?? 72
  const due = await uow.tx.encounter.findMany({
    where: { status: { in: ['open', 'in_progress', 'pending_signature'] }, startedAt: { lte: new Date(uow.now.getTime() - taskHours * 3_600_000) } },
    select: { id: true, ref: true, startedAt: true, locationId: true, attendingDvmId: true, patient: { select: { name: true } } },
    take: 500,
  })
  let raised = 0
  let escalated = 0
  for (const enc of due) {
    const ageHours = Math.floor((uow.now.getTime() - enc.startedAt.getTime()) / 3_600_000)
    const task = await uow.tx.task.findFirst({ where: { subjectType: 'Encounter', subjectId: enc.id, kind: 'record_unsigned' }, select: { id: true, status: true, priority: true } })
    if (!task) {
      const row = await uow.tx.task.create({ data: { kind: 'record_unsigned', title: `Sign ${enc.ref} (${enc.patient?.name ?? 'patient'})`, detail: `Unsigned for ${ageHours} hours.`, subjectType: 'Encounter', subjectId: enc.id, locationId: enc.locationId, assigneeId: enc.attendingDvmId, roleName: 'dvm', priority: ageHours >= escalateHours ? 'urgent' : 'high', status: 'open', dueAt: uow.now } })
      uow.audit({ eventType: 'task.raised', entityType: 'Task', entityId: row.id, after: { kind: 'record_unsigned', encounterId: enc.id, ageHours }, metadata: { system: 'record-clock' } })
      raised++
    } else if (ageHours >= escalateHours && task.priority !== 'urgent' && ['open', 'in_progress'].includes(task.status)) {
      await uow.tx.task.update({ where: { id: task.id }, data: { priority: 'urgent', assigneeId: settings?.medicalDirectorId ?? enc.attendingDvmId, detail: `Unsigned for ${ageHours} hours; escalated to the medical director.`, version: { increment: 1 } } })
      uow.audit({ eventType: 'task.escalated', entityType: 'Task', entityId: task.id, after: { encounterId: enc.id, ageHours, to: settings?.medicalDirectorId ?? null }, metadata: { system: 'record-clock' } })
      escalated++
    }
  }
  return { checked: due.length, raised, escalated, through: addDays(uow.now.toISOString().slice(0, 10), 0) }
}
