import { command } from '../lib/command'
import { auditCreate, transition } from '../lib/cas'
import { actorAgentId, actorUserId, type Actor } from '../lib/actor'
import { addDays, localDate } from '../lib/calendar'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import type { UnitOfWork } from '../lib/unitOfWork'
import { resolvePolicy } from '../domain/policy'
import { contactHash, normalisePhone } from '../domain/contact'
import { assertNotDowngrade, outcomeAllowed, parseProtocol, scoreTriage, type TriageLevel } from '../domain/triage'
import { gated } from './agentGuard'

/**
 * The front desk and the AI receptionist (INTEGRATIONS §7, STATE-MACHINES §4, §10). The voice
 * agent drives the same commands as a CSR, in the order the call flow requires: disclosure first,
 * urgency screen before anything else for a sick pet, verify the caller before touching an existing
 * account, then book or take a request. Emergencies are never booked; they are transferred or
 * referred to the ER.
 */

type Ctx = { session: unknown; prisma: any }

/** The location's local date (policies are effective by the clinic's day). */
async function locationDay(uow: UnitOfWork, locationId: string) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { timeZone: true } })
  if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
  return localDate({ timeZone: location.timeZone }, uow.now)
}

// ── Calls ─────────────────────────────────────────────────────────────────────────────────

/** A call starts (telephony webhook or the voice agent's first tool call). */
export async function startCall(_root: unknown, args: { input: { direction: 'inbound' | 'outbound'; from: string; to: string; locationId: string; answeredBy: 'ai' | 'staff' | 'voicemail' | 'missed'; providerCallId?: string | null; adapterKey?: string | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook', 'canMessageClients'], scope: 'reception.read', tool: 'call.start' }, args, async actor => {
    const input = args.input
    if (input.direction === 'outbound' && input.answeredBy === 'ai') throw new DomainError(Codes.FEATURE_DISABLED, 'Outbound AI calls are disabled.')
    if (actor.kind === 'agent' && input.answeredBy !== 'ai') throw new DomainError(Codes.INVALID_INPUT, 'The AI receptionist only answers calls as the AI.')
    const result = await command(context.prisma, { name: 'call.start', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true } })
      if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
      const from = normalisePhone(input.from)
      // Who is calling: match the number to a contact point (never trusted as identity; see verifyCaller).
      const match = await uow.tx.contactPoint.findFirst({ where: { valueHash: contactHash(from), status: 'active' }, select: { person: { select: { id: true, clientId: true } } } })
      const ref = await nextReference(uow.tx, 'CALL', uow.now)
      const row = await uow.tx.callRecord.create({
        data: {
          ref, direction: input.direction, from, to: normalisePhone(input.to), locationId: location.id, answeredBy: input.answeredBy, agentId: actorAgentId(actor),
          providerCallId: String(input.providerCallId ?? ''), adapterKey: String(input.adapterKey ?? 'manual'), recordingConsent: 'not_asked', verificationMethod: 'none',
          disposition: 'open', startedAt: uow.now, status: input.answeredBy === 'ai' ? 'ringing' : 'in_progress', transcript: [],
          // The number match is a hint for the screen; the account is attached only after verification.
          personId: null, clientId: null,
        },
      })
      auditCreate(uow, actor, 'CallRecord', row.id, 'call.started', { ref, direction: input.direction, answeredBy: input.answeredBy, knownNumber: !!match })
      return { id: row.id, ref, knownNumber: !!match }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * The AI disclosure was played (FCC 24-17; contact pack aiVoiceDisclosure). Under an all-party
 * recording state the caller's answer to "this call is recorded" is captured here; declining stops
 * recording, never the call.
 */
export async function recordCallDisclosure(_root: unknown, args: { callRecordId: string; recordingConsent: 'accepted' | 'declined'; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.read', tool: 'call.disclosure' }, args, async actor => {
    const result = await command(context.prisma, { name: 'call.disclosure', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string; locationId: string }>(uow, {
        model: 'CallRecord', id: args.callRecordId, from: ['ringing'], to: 'in_progress', actor, eventType: 'call.disclosed',
        data: { disclosurePlayedAt: uow.now, recordingConsent: args.recordingConsent },
      })
      const contact = await resolvePolicy(uow.tx, 'contact', { locationId: row.locationId, on: await locationDay(uow, row.locationId) })
      return { id: row.id, status: row.status, recording: contact.rules.recordingConsent === 'all_party' ? args.recordingConsent === 'accepted' : true }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Verify the caller against the account: a pet name plus date of birth on file, or a one-time code
 * (INTEGRATIONS §7.3). Until this passes, the agent may give general information only.
 */
export async function verifyCaller(_root: unknown, args: { callRecordId: string; method: 'pet_name_dob'; petName: string; petDateOfBirth: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.read', tool: 'call.verify' }, args, async actor => {
    if (args.method !== 'pet_name_dob') throw new DomainError(Codes.INVALID_INPUT, 'Unsupported verification method.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.petDateOfBirth)) throw new DomainError(Codes.INVALID_INPUT, 'Date of birth is YYYY-MM-DD.', { field: 'petDateOfBirth' })
    const result = await command(context.prisma, { name: 'call.verify', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const call = await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { from: true, status: true, callerVerifiedAt: true } })
      if (!call || call.status !== 'in_progress') throw new DomainError(Codes.GUARD_FAILED, 'The call is not in progress.')
      const person = await uow.tx.clientPerson.findFirst({ where: { contactPoints: { some: { valueHash: contactHash(call.from), status: 'active' } } }, select: { id: true, clientId: true, canBook: true } })
      const pet = person
        ? await uow.tx.patient.findFirst({
          where: { name: { equals: args.petName.trim(), mode: 'insensitive' }, dateOfBirth: new Date(`${args.petDateOfBirth}T00:00:00Z`), ownerships: { some: { clientId: person.clientId, effectiveTo: null } } },
          select: { id: true },
        })
        : null
      if (!person || !pet) {
        uow.audit({ eventType: 'call.verification_failed', entityType: 'CallRecord', entityId: args.callRecordId, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { method: args.method } })
        return { verified: false }
      }
      await uow.tx.callRecord.update({ where: { id: args.callRecordId }, data: { callerVerifiedAt: uow.now, verificationMethod: 'pet_name_dob', clientId: person.clientId, personId: person.id, version: { increment: 1 } } })
      uow.audit({ eventType: 'call.caller_verified', entityType: 'CallRecord', entityId: args.callRecordId, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { method: args.method, clientId: person.clientId } })
      return { verified: true, clientId: person.clientId, canBook: person.canBook }
    })
    return { replay: result.replay, ...result.value }
  })
}

const MAX_TRANSCRIPT_TURNS = 400

/** Append transcript turns as received (untrusted text; never rendered as HTML). */
export async function appendCallTranscript(_root: unknown, args: { callRecordId: string; turns: { speaker: 'caller' | 'agent' | 'staff'; text: string; at?: string | null }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.read', tool: 'call.transcript' }, args, async actor => {
    const result = await command(context.prisma, { name: 'call.transcript', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const call = await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { transcript: true, status: true } })
      if (!call) throw new DomainError(Codes.NOT_FOUND, 'Call not found.')
      if (call.status === 'completed' || call.status === 'failed') throw new DomainError(Codes.GUARD_FAILED, 'The call has ended.')
      const existing = Array.isArray(call.transcript) ? (call.transcript as unknown[]) : []
      const turns = args.turns.slice(0, 50).map(t => ({ speaker: ['caller', 'agent', 'staff'].includes(t.speaker) ? t.speaker : 'caller', text: String(t.text ?? '').slice(0, 2000), at: t.at ?? uow.now.toISOString() }))
      const next = [...existing, ...turns].slice(-MAX_TRANSCRIPT_TURNS)
      await uow.tx.callRecord.update({ where: { id: args.callRecordId }, data: { transcript: next as never, version: { increment: 1 } } })
      return { turns: next.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

const DISPOSITIONS = ['booked', 'rescheduled', 'cancelled', 'refill_request', 'records_request', 'info', 'transferred', 'urgent_transfer', 'er_referred', 'voicemail', 'abandoned', 'callback_task']

/** The call ends with a disposition and a summary; anything left undone becomes a staff task. */
export async function endCall(_root: unknown, args: { callRecordId: string; disposition: string; summary?: string | null; transferTo?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'reception.read', tool: 'call.end' }, args, async actor => {
    if (!DISPOSITIONS.includes(args.disposition)) throw new DomainError(Codes.INVALID_INPUT, 'Unknown disposition.', { field: 'disposition' })
    const result = await command(context.prisma, { name: 'call.end', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string; startedAt: Date; locationId: string; clientId: string | null; ref: string }>(uow, {
        model: 'CallRecord', id: args.callRecordId, from: ['ringing', 'in_progress'], to: 'completed', actor, eventType: 'call.ended',
        data: call => ({ endedAt: uow.now, durationSeconds: Math.max(0, Math.round((uow.now.getTime() - new Date(call.startedAt).getTime()) / 1000)), disposition: args.disposition, summary: String(args.summary ?? '').slice(0, 2000), transferTo: String(args.transferTo ?? '').slice(0, 40) }),
      })
      if (args.disposition === 'callback_task' || args.disposition === 'voicemail') {
        await uow.tx.task.create({ data: { kind: 'call_back', title: `Call back (${row.ref})`, detail: String(args.summary ?? '').slice(0, 2000), subjectType: 'CallRecord', subjectId: row.id, locationId: row.locationId, priority: 'normal', status: 'open', dueAt: new Date(uow.now.getTime() + 4 * 3_600_000), createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } })
      }
      return { id: row.id, status: row.status, disposition: args.disposition }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Triage ────────────────────────────────────────────────────────────────────────────────

async function publishedProtocol(uow: UnitOfWork, code = 'phone_triage') {
  const version = await uow.tx.triageProtocolVersion.findFirst({ where: { status: 'published', protocol: { code } }, orderBy: { versionNumber: 'desc' } })
  if (!version) throw new DomainError(Codes.POLICY_UNRESOLVED, 'No triage protocol is published. The front desk transfers every sick-pet call until one is.')
  return { version, protocol: parseProtocol({ questions: version.questions, redFlags: version.redFlags, levelRules: version.levelRules, scripts: version.scripts }) }
}

/** The published protocol's questions, so the voice agent asks exactly what the protocol says. */
export async function triageQuestions(_root: unknown, _args: Record<string, never>, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'triage.run', tool: 'triage.questions' }, {}, async () => {
    const version = await context.prisma.triageProtocolVersion.findFirst({ where: { status: 'published', protocol: { code: 'phone_triage' } }, orderBy: { versionNumber: 'desc' } })
    if (!version) throw new DomainError(Codes.POLICY_UNRESOLVED, 'No triage protocol is published.')
    const protocol = parseProtocol({ questions: version.questions, redFlags: version.redFlags, levelRules: version.levelRules, scripts: version.scripts })
    return { protocolVersionId: version.id, label: version.label, questions: protocol.questions.map(q => ({ id: q.id, text: q.text, required: q.required })) }
  })
}

/**
 * Score an urgency screen and store it (append-only). Red flags → emergency_now, and the only
 * outcomes are transfer to a person or referral to the nearest open ER (never a booking).
 */
export async function runTriage(_root: unknown, args: { input: { complaint: string; answers: Record<string, boolean | null>; patientId?: string | null; clientId?: string | null; callRecordId?: string | null; locationId: string; outcome?: string | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook'], scope: 'triage.run', tool: 'triage.run' }, args, async actor => {
    const input = args.input
    const result = await command(context.prisma, { name: 'triage.run', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const { version, protocol } = await publishedProtocol(uow)
      const scored = scoreTriage(protocol, { complaint: String(input.complaint ?? '').slice(0, 1000), answers: input.answers ?? {} })
      if (input.callRecordId) {
        const previous = await uow.tx.triageAssessment.findFirst({ where: { callRecordId: input.callRecordId }, orderBy: { at: 'desc' }, select: { level: true } })
        if (previous) assertNotDowngrade(previous.level as TriageLevel, scored.level)
      }
      const outcome = input.outcome ?? (scored.level === 'emergency_now' ? (actor.kind === 'agent' ? 'transferred' : 'er_referred') : 'booked')
      if (!outcomeAllowed(scored.level, outcome)) throw new DomainError(Codes.GUARD_FAILED, 'An emergency is transferred or referred to the ER. It is never booked.')
      let referral: { id: string; name: string; phone: string; addressLine1: string; city: string } | null = null
      if (scored.level === 'emergency_now') {
        const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { emergencyCoverage: true, stateCode: true } })
        if (location?.emergencyCoverage !== 'in_house') {
          referral = await uow.tx.referralHospital.findFirst({ where: { kind: 'emergency', active: true, open24h: true, stateCode: location?.stateCode ?? undefined }, orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true, addressLine1: true, city: true } })
        }
      }
      const row = await uow.tx.triageAssessment.create({
        data: {
          patientId: input.patientId ?? null, clientId: input.clientId ?? null, callRecordId: input.callRecordId ?? null, protocolVersionId: version.id,
          complaint: String(input.complaint ?? '').slice(0, 1000), answers: (input.answers ?? {}) as never, redFlagsHit: scored.redFlagsHit as never,
          level: scored.level, outcome, referredToId: outcome === 'er_referred' ? referral?.id ?? null : null,
          actorKind: actor.kind === 'agent' ? 'agent' : 'user', actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), at: uow.now,
        },
      })
      auditCreate(uow, actor, 'TriageAssessment', row.id, 'triage.assessed', { level: scored.level, outcome, redFlags: scored.redFlagsHit, protocolVersion: version.versionNumber })
      if (scored.level === 'emergency_now' || scored.level === 'urgent_today') {
        // A person calls the client back or takes the transfer: one urgent task per assessment.
        const who = input.patientId ? (await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { name: true } }))?.name : null
        const call = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { locationId: true } }) : null
        const task = await uow.tx.task.create({ data: { kind: 'call_back', priority: 'urgent', status: 'open', dueAt: uow.now, subjectType: 'TriageAssessment', subjectId: row.id, locationId: call?.locationId ?? input.locationId ?? null, roleName: 'csr',
          title: scored.level === 'emergency_now' ? `EMERGENCY call: ${who ? `${who}: ` : ''}transfer or confirm ER referral now` : `Urgent call-back today: ${who ? `${who}: ` : ''}${String(input.complaint ?? '').slice(0, 80)}`, detail: input.callRecordId ? `Call ${input.callRecordId}` : '' } })
        uow.audit({ eventType: 'task.raised', entityType: 'Task', entityId: task.id, after: { kind: 'call_back', priority: 'urgent', level: scored.level }, metadata: { system: 'triage' } })
      }
      return { id: row.id, level: scored.level, outcome, script: scored.script, redFlags: scored.reasons, unanswered: scored.unanswered, emergencyReferral: referral }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Staff refer a patient to an ER from an urgent screen (the agent can only transfer or read the script). */
export async function referToEmergency(_root: unknown, args: { triageId: string; referralHospitalId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canBook', 'canWriteRecord'], tool: 'triage.refer_er', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'triage.refer_er', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const prior = await uow.tx.triageAssessment.findUnique({ where: { id: args.triageId } })
      if (!prior) throw new DomainError(Codes.NOT_FOUND, 'Triage not found.')
      const er = await uow.tx.referralHospital.findUnique({ where: { id: args.referralHospitalId }, select: { id: true, active: true } })
      if (!er?.active) throw new DomainError(Codes.NOT_FOUND, 'Referral hospital not found.')
      // A new assessment records the referral (assessments are append-only).
      const row = await uow.tx.triageAssessment.create({
        data: {
          patientId: prior.patientId, clientId: prior.clientId, callRecordId: prior.callRecordId, protocolVersionId: prior.protocolVersionId, complaint: prior.complaint,
          answers: (prior.answers ?? {}) as never, redFlagsHit: (prior.redFlagsHit ?? []) as never, level: prior.level === 'routine' || prior.level === 'soon' ? 'urgent_today' : prior.level,
          outcome: 'er_referred', referredToId: er.id, actorKind: 'user', actorUserId: actorUserId(actor), at: uow.now,
        },
      })
      auditCreate(uow, actor, 'TriageAssessment', row.id, 'triage.er_referred', { previous: prior.id, referralHospitalId: er.id })
      return { id: row.id, outcome: row.outcome }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Refill and records requests (intake only; DVM and records staff decide) ───────────────

export async function requestRefill(_root: unknown, args: { input: { patientId: string; productText: string; pharmacyNote?: string | null; channel?: string | null; callRecordId?: string | null }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageRefills', 'canBook'], scope: 'pharmacy.intake', tool: 'refill.request' }, args, async actor => {
    const input = args.input
    const result = await command(context.prisma, { name: 'refill.request', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const patient = await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { status: true, name: true, ownerships: { where: { effectiveTo: null, role: 'primary' }, select: { clientId: true } } } })
      if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
      if (patient.status === 'deceased') throw new DomainError(Codes.PATIENT_DECEASED, `${patient.name} has died.`)
      const clientId = patient.ownerships[0]?.clientId ?? null
      if (actor.kind === 'agent') {
        const call = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null
        if (!call?.callerVerifiedAt || call.clientId !== clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller before taking a refill request.')
      }
      const ref = await nextReference(uow.tx, 'RFR', uow.now)
      // Due within one business day (practice standard; the DVM decides).
      const row = await uow.tx.refillRequest.create({
        data: {
          ref, patientId: input.patientId, clientId, channel: actor.kind === 'agent' ? 'ai_voice' : input.channel ?? 'csr', productText: String(input.productText ?? '').slice(0, 300),
          pharmacyNote: String(input.pharmacyNote ?? '').slice(0, 500), status: 'received', slaDueAt: new Date(uow.now.getTime() + 24 * 3_600_000), callRecordId: input.callRecordId ?? null, createdByAgentId: actorAgentId(actor),
        },
      })
      auditCreate(uow, actor, 'RefillRequest', row.id, 'refill.requested', { ref, patientId: input.patientId, channel: row.channel })
      await uow.tx.task.create({ data: { kind: 'refill_review', title: `Refill request ${ref}: ${row.productText}`.slice(0, 200), subjectType: 'RefillRequest', subjectId: row.id, priority: 'normal', status: 'open', dueAt: row.slaDueAt, createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } })
      return { id: row.id, ref, status: row.status, dueAt: row.slaDueAt?.toISOString() ?? null }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function requestRecords(_root: unknown, args: { input: { patientId: string; requesterKind: string; requesterName?: string | null; requesterContact?: string | null; basis: string; scope?: string | null; channel?: string | null; callRecordId?: string | null; locationId: string }; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canProcessRecordsRequests', 'canBook'], scope: 'records.request', tool: 'records.request' }, args, async actor => {
    const input = args.input
    const result = await command(context.prisma, { name: 'records.request', actor, idempotencyKey: args.idempotencyKey, params: input }, async uow => {
      const patient = await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { ownerships: { where: { effectiveTo: null, role: 'primary' }, select: { clientId: true } } } })
      if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
      const clientId = patient.ownerships[0]?.clientId ?? null
      if (actor.kind === 'agent') {
        if (input.requesterKind !== 'client_person' || input.basis !== 'client_of_record') throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, 'The AI receptionist takes records requests from the client of record only; others go to staff.')
        const call = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null
        if (!call?.callerVerifiedAt || call.clientId !== clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller before taking a records request.')
      }
      const today = await locationDay(uow, input.locationId)
      const records = await resolvePolicy(uow.tx, 'medical_records', { locationId: input.locationId, on: today })
      const ref = await nextReference(uow.tx, 'REC', uow.now)
      const due = addDays(today, records.rules.clientCopyDays)
      const row = await uow.tx.recordsRequest.create({
        data: {
          ref, patientId: input.patientId, clientId, requesterKind: input.requesterKind, requesterName: String(input.requesterName ?? '').slice(0, 120), requesterContact: String(input.requesterContact ?? '').slice(0, 200),
          channel: actor.kind === 'agent' ? 'ai_voice' : input.channel ?? 'csr', basis: input.basis, scope: String(input.scope ?? 'full record').slice(0, 300), status: 'received',
          responseDueAt: new Date(`${due}T23:59:00Z`), policyVersionId: records.versions[records.versions.length - 1]?.id ?? null, callRecordId: input.callRecordId ?? null, createdByAgentId: actorAgentId(actor),
        },
      })
      auditCreate(uow, actor, 'RecordsRequest', row.id, 'records.requested', { ref, basis: input.basis, requesterKind: input.requesterKind, dueOn: due, policyVerified: records.verified })
      await uow.tx.task.create({ data: { kind: 'records_request', title: `Records request ${ref}`, subjectType: 'RecordsRequest', subjectId: row.id, locationId: input.locationId, priority: 'normal', status: 'open', dueAt: row.responseDueAt, createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } })
      return { id: row.id, ref, status: row.status, dueOn: due }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Answer from the knowledge base (hours, directions, policies). Public entries only for agents. */
export async function lookupKnowledge(_root: unknown, args: { question: string; locationId?: string | null }, context: Ctx) {
  return gated(context, { permissions: ['canAccessDashboard'], scope: 'reception.read', tool: 'knowledge.lookup' }, args, async actor => {
    const words = String(args.question ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
    const entries = await context.prisma.knowledgeBaseEntry.findMany({ where: { active: true, ...(actor.kind === 'agent' ? { visibility: 'public' } : {}), OR: [{ locationId: null }, { locationId: args.locationId ?? undefined }] }, select: { id: true, topic: true, keywords: true, content: true } })
    const scored = entries.map((e: { id: string; topic: string; keywords: unknown; content: string }) => {
      const keys = (Array.isArray(e.keywords) ? (e.keywords as string[]) : []).map(k => k.toLowerCase())
      return { e, score: words.filter(w => keys.includes(w) || e.topic.toLowerCase().includes(w)).length }
    }).filter((x: { score: number }) => x.score > 0).sort((a: { score: number }, b: { score: number }) => b.score - a.score).slice(0, 3)
    return { answers: scored.map((x: { e: { topic: string; content: string } }) => ({ topic: x.e.topic, content: x.e.content })) }
  })
}

/**
 * What the receptionist may see about a verified caller: the household's pets (name, species,
 * status) and their upcoming appointments. Nothing clinical beyond that. JSON results are invisible
 * to the GraphQL read walker, so this read is audited here, field names only, and fails closed.
 */
export async function receptionContext(_root: unknown, args: { callRecordId?: string | null; clientId?: string | null }, context: Ctx) {
  return gated(context, { permissions: ['canBook', 'canReadClientPII'], scope: 'reception.read', tool: 'reception.context' }, args, async actor => {
    let clientId = args.clientId ?? null
    if (actor.kind === 'agent' || args.callRecordId) {
      const call = args.callRecordId ? await context.prisma.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null
      if (!call?.callerVerifiedAt || !call.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, 'Verify the caller first.')
      clientId = call.clientId
    }
    if (!clientId) throw new DomainError(Codes.INVALID_INPUT, 'Name the client or the call.', { field: 'clientId' })
    const client = await context.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true, ref: true, displayName: true, status: true, primaryLocationId: true,
        ownerships: { where: { effectiveTo: null }, select: { patient: { select: { id: true, ref: true, name: true, status: true, species: { select: { name: true } } } } } },
      },
    })
    if (!client) throw new DomainError(Codes.NOT_FOUND, 'Client not found.')
    const appointments = await context.prisma.appointment.findMany({
      where: { clientId, status: { in: ['requested', 'booked', 'confirmed'] }, startsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' }, take: 10,
      select: { id: true, ref: true, startsAt: true, status: true, version: true, appointmentType: { select: { name: true } }, provider: { select: { displayName: true } } },
    })
    const pets = client.ownerships.map((o: any) => o.patient).filter((p: any) => p && p.status !== 'merged')
    const { writeReadAudit, actorFromSession } = await import('../security/readAudit')
    const reader = actorFromSession(context.session) ?? { actorKind: actor.kind === 'agent' ? 'agent' as const : 'user' as const, actorId: actor.kind === 'agent' ? actor.agentId : actor.kind === 'user' ? actor.userId : 'system' }
    await writeReadAudit(context.prisma, reader, [
      { resourceType: 'Client', resourceId: client.id, fields: new Set(['ref', 'displayName', 'status']) },
      ...pets.map((p: any) => ({ resourceType: 'Patient', resourceId: p.id, fields: new Set(['ref', 'name', 'status', 'species']) })),
      ...appointments.map((a: any) => ({ resourceType: 'Appointment', resourceId: a.id, fields: new Set(['ref', 'startsAt', 'status', 'appointmentType', 'provider']) })),
    ], actor.kind === 'agent' ? 'agent_tool' : 'operations', null)
    return {
      client: { id: client.id, ref: client.ref, displayName: client.displayName, status: client.status, locationId: client.primaryLocationId },
      pets: pets.map((p: any) => ({ id: p.id, ref: p.ref, name: p.name, species: p.species?.name ?? '', status: p.status })),
      upcoming: appointments.map((a: any) => ({ id: a.id, ref: a.ref, startsAt: a.startsAt.toISOString(), status: a.status, version: a.version, type: a.appointmentType?.name ?? '', provider: a.provider?.displayName ?? '' })),
    }
  })
}
