import { command } from '../lib/command'
import { auditCreate, lockRow } from '../lib/cas'
import { actorUserId } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { toJsonValue } from '../lib/canonical'
import { resolvePolicy } from '../domain/policy'
import { scribeAdapters, DraftSchema, type Draft } from '../../integrations/scribe'
import { gated } from './agentGuard'
import { chartableEncounter, locationDay, practiceSettings, staffOf, text, type Ctx } from './clinical'
import { writeSection } from './record'

/*
 * Ambient scribe commands (INTEGRATIONS §8, DOMAIN I-R3).
 *   start   → needs the scribe feature on and, where the contact pack says all-party (California),
 *             the client's recording consent captured on this visit, plus the clinician's own
 *             acknowledgement; otherwise refused.
 *   draft   → transcript (adapter) → section drafts (adapter), stored with provenance; no record write.
 *   accept  → a person picks blocks (optionally edited); each becomes a section revision with
 *             source=scribe and the draft id. Rejecting keeps the draft for the audit trail.
 * Network calls to the adapters happen outside any transaction.
 */

export async function startScribeSession(_root: unknown, args: { encounterId: string; clientConsent: boolean; consentMethod?: 'verbal_recorded' | 'paper' | 'staff_entry' | null; staffAcknowledged: boolean; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'scribe.start', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'scribe.start', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const settings = await practiceSettings(uow)
      if (!settings.features.scribe) throw new DomainError(Codes.FEATURE_DISABLED, 'The ambient scribe is turned off for this practice. An owner turns it on in Settings.')
      const enc = await chartableEncounter(uow, args.encounterId)
      const { on } = await locationDay(uow, enc.locationId!, uow.now)
      const contact = await resolvePolicy(uow.tx, 'contact', { locationId: enc.locationId!, on })
      if (!args.staffAcknowledged) throw new DomainError(Codes.CONSENT_REQUIRED, 'Everyone on the team in the room must know the visit is being recorded.')
      let consentId: string | null = null
      if (contact.rules.recordingConsent === 'all_party' || contact.rules.consentPurposes.recording !== 'implied') {
        if (!args.clientConsent) throw new DomainError(Codes.CONSENT_REQUIRED, 'This state requires everyone\'s consent to record. Ask the client and record their answer first.', { reason: 'all_party' })
      }
      if (args.clientConsent) {
        const owner = await uow.tx.patientOwnership.findFirst({ where: { patientId: enc.patientId, role: 'primary', effectiveTo: null }, select: { client: { select: { people: { where: { isPrimary: true }, select: { contactPoints: { where: { isPrimary: true, status: 'active' }, select: { id: true }, take: 1 } } } } } } })
        const contactPointId = owner?.client?.people[0]?.contactPoints[0]?.id
        if (!contactPointId) throw new DomainError(Codes.CONSENT_REQUIRED, 'The client has no contact on file to attach the recording consent to.')
        const consent = await uow.tx.consentRecord.create({ data: { contactPointId, purpose: 'recording', action: 'grant', method: args.consentMethod ?? 'staff_entry', capturedByUserId: actorUserId(actor), policyVersionId: contact.versions[contact.versions.length - 1]?.id ?? null, at: uow.now } })
        consentId = consent.id
      }
      const { transcription, model } = scribeAdapters()
      const session = await uow.tx.scribeSession.create({ data: { encounterId: enc.id, startedById: staff.id, clientConsentId: consentId, staffAcknowledged: true, status: 'recording', transcriptionProvider: transcription.key, modelProvider: model.key, modelRef: model.modelRef, audioDeleteAfter: new Date(uow.now.getTime() + 30 * 86_400_000) } })
      auditCreate(uow, actor, 'ScribeSession', session.id, 'scribe.started', { encounterId: enc.id, consentId, recordingConsent: contact.rules.recordingConsent, transcription: transcription.key, model: model.key })
      return { id: session.id, status: session.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Transcribe and draft. The adapters run outside the transaction; the draft is stored in one. */
export async function draftScribeSession(_root: unknown, args: { sessionId: string; pastedTranscript?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'scribe.draft', humanOnly: true }, args, async actor => {
    const prisma = context.prisma
    const session = await prisma.scribeSession.findUnique({ where: { id: args.sessionId }, select: { id: true, status: true, encounter: { select: { id: true, status: true, patient: { select: { name: true, species: { select: { code: true } } } } } } } })
    if (!session) throw new DomainError(Codes.NOT_FOUND, 'Scribe session not found.')
    if (!['recording', 'transcribing', 'drafted'].includes(session.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The scribe session is ${session.status}.`)
    if (!session.encounter || ['signed', 'voided'].includes(session.encounter.status)) throw new DomainError(Codes.GUARD_FAILED, 'The visit record is closed.')
    const replay = await prisma.commandReceipt.findUnique({ where: { idempotencyKey: args.idempotencyKey }, select: { id: true } })
    let draft: Draft | null = null
    let transcript: { text: string; ref: string; provider: string } | null = null
    if (!replay) {
      const { transcription, model } = scribeAdapters()
      const t = await transcription.transcribe({ pastedText: args.pastedTranscript ?? null })
      transcript = { text: t.text, ref: t.ref, provider: t.provider }
      draft = DraftSchema.parse(await model.draft({ transcript: t, species: session.encounter.patient?.species?.code ?? null, patientName: session.encounter.patient?.name ?? 'the patient' }))
    }
    const result = await command(prisma, { name: 'scribe.draft', actor, idempotencyKey: args.idempotencyKey, params: { sessionId: args.sessionId, transcriptLength: args.pastedTranscript?.length ?? 0 } }, async uow => {
      const row = await lockRow<{ id: string; status: string; version: number; modelRef: string }>(uow.tx, 'ScribeSession', args.sessionId)
      if (!draft || !transcript) throw new DomainError(Codes.IN_PROGRESS, 'The draft is being prepared; try again.')
      await uow.tx.scribeSession.update({ where: { id: row.id }, data: { status: 'drafted', transcript: transcript.text.slice(0, 100_000), transcriptRef: transcript.ref, version: { increment: 1 } } })
      const created = await uow.tx.scribeDraft.create({ data: { sessionId: row.id, sections: toJsonValue(draft.sections) as never, suggestedCharges: toJsonValue(draft.suggestedCharges) as never, confidence: draft.confidence, modelRef: row.modelRef, acceptedBlocks: [] as never, status: 'proposed' } })
      auditCreate(uow, actor, 'ScribeDraft', created.id, 'scribe.drafted', { sessionId: row.id, sections: draft.sections.map(s => s.kind), provider: transcript.provider, modelRef: row.modelRef })
      return { id: created.id, sections: draft.sections, suggestedCharges: draft.suggestedCharges, confidence: draft.confidence }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Accept selected blocks (I-R3): each becomes a section revision with source=scribe. */
export async function acceptScribeDraft(_root: unknown, args: { draftId: string; blocks: { index: number; body?: string | null; expectedVersion?: number | null }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'scribe.accept', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.blocks) || !args.blocks.length) throw new DomainError(Codes.INVALID_INPUT, 'Choose at least one block to accept, or reject the draft.')
    const result = await command(context.prisma, { name: 'scribe.accept', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const draft = await lockRow<{ id: string; status: string; version: number; sessionId: string; sections: { kind: string; body: string }[]; acceptedBlocks: number[] | null }>(uow.tx, 'ScribeDraft', args.draftId)
      if (!['proposed', 'partly_accepted'].includes(draft.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The draft is ${draft.status.replace(/_/g, ' ')}.`)
      const session = await uow.tx.scribeSession.findUniqueOrThrow({ where: { id: draft.sessionId }, select: { id: true, encounterId: true } })
      const accepted = new Set(draft.acceptedBlocks ?? [])
      const written = []
      for (const block of args.blocks) {
        const section = draft.sections[block.index]
        if (!section) throw new DomainError(Codes.INVALID_INPUT, 'That draft block does not exist.', { field: 'blocks' })
        if (accepted.has(block.index)) continue
        const existing = await uow.tx.soapSection.findFirst({ where: { encounterId: session.encounterId!, kind: section.kind, ordinal: 1 }, select: { version: true, body: true } })
        const edited = block.body != null ? text(block.body, 'body', 20_000) : section.body
        // Accepting into a section that already has text appends below it; the clinician edits from there.
        const body = existing?.body?.trim() ? `${existing.body.trim()}\n\n${edited}` : edited
        written.push(await writeSection(uow, actor, staff, session.encounterId!, { kind: section.kind, body, source: 'scribe', scribeDraftId: draft.id, expectedVersion: block.expectedVersion ?? existing?.version ?? 0 }))
        accepted.add(block.index)
      }
      const status = accepted.size >= draft.sections.length ? 'accepted' : 'partly_accepted'
      await uow.tx.scribeDraft.update({ where: { id: draft.id }, data: { acceptedBlocks: [...accepted].sort((a, b) => a - b) as never, status, decidedById: staff.id, decidedAt: uow.now, version: { increment: 1 } } })
      if (status === 'accepted') await uow.tx.scribeSession.update({ where: { id: session.id }, data: { status: 'accepted', version: { increment: 1 } } })
      uow.audit({ eventType: 'scribe.accepted', entityType: 'ScribeDraft', entityId: draft.id, actorUserId: actorUserId(actor), after: { blocks: args.blocks.map(b => ({ index: b.index, edited: b.body != null })), status } })
      return { id: draft.id, status, sections: written }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function rejectScribeDraft(_root: unknown, args: { draftId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'scribe.reject', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'scribe.reject', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const draft = await lockRow<{ id: string; status: string; sessionId: string }>(uow.tx, 'ScribeDraft', args.draftId)
      if (!['proposed', 'partly_accepted'].includes(draft.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The draft is ${draft.status.replace(/_/g, ' ')}.`)
      await uow.tx.scribeDraft.update({ where: { id: draft.id }, data: { status: 'rejected', decidedById: staff.id, decidedAt: uow.now, version: { increment: 1 } } })
      await uow.tx.scribeSession.update({ where: { id: draft.sessionId }, data: { status: 'discarded', version: { increment: 1 } } })
      auditCreate(uow, actor, 'ScribeDraft', draft.id, 'scribe.rejected', { sessionId: draft.sessionId }, { reason })
      return { id: draft.id, status: 'rejected' }
    })
    return { replay: result.replay, ...result.value }
  })
}
