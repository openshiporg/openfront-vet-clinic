import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { actorAgentId, actorUserId } from '../lib/actor'
import { consumeApproval, requestApproval } from '../lib/approval'
import { payloadHash, sha256 } from '../lib/canonical'
import { writeReadAudit } from '../security/readAudit'
import { gated } from './agentGuard'
import { text, type Ctx } from './clinical'
import { pick } from './billingInput'
import { createHash } from 'node:crypto'

/*
 * Records releases (STATE-MACHINES §19). received → verifying_authority → approved → released (or denied / withdrawn).
 * A basis has to be checked by a person before anything leaves. What leaves is a hash-listed packet: the sorted document hashes,
 * the recipient and the channel are hashed together, the list is stored on the release and the release can never be edited.
 * An agent can only send to the client of record at a channel the clinic already verified, and even then it only prepares a release for
 * a request a person approved; anything for a third party also needs the approval the practice policy names.
 */

const PROCESSORS = ['canProcessRecordsRequests'] as const
const THIRD_PARTY = new Set(['authorised_person', 'referral_with_authorisation', 'insurer_with_authorisation', 'court_order', 'subpoena', 'public_health'])
const SHARE_CHANNELS = ['email', 'portal', 'fax', 'mail', 'in_person'] as const

/** Hash over the sorted document hashes, recipient and channel. The same packet always hashes the same. */
export function packetHashOf(documents: { documentId: string; sha256: string }[], recipient: string, channel: string) {
  return sha256(JSON.stringify({ docs: documents.map(d => `${d.documentId}:${d.sha256}`).sort(), recipient: recipient.trim().toLowerCase(), channel }))
}

/** A person checked the requester's right to the records. Moves received → verifying_authority and records what they found. */
export async function startRecordsVerification(_root: unknown, args: { requestId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS], tool: 'records.start_verification', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'records.start_verification', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'RecordsRequest', id: args.requestId, from: ['received'], to: 'verifying_authority', expectedVersion: args.expectedVersion, actor, eventType: 'records.verification_started' })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

const PROOF_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/webp'])
const PROOF_MAX_BYTES = 4_000_000

/**
 * The person checking a request attaches the proof they were given (the client's signed authorisation, a court order): the file is
 * kept in the database with its sha256 and the returned document id goes on the verification. The receipt keeps only the hash.
 */
export async function attachRecordsProof(_root: unknown, args: { requestId: string; fileName: string; mimeType: string; contentBase64: string; idempotencyKey: string }, context: Ctx) {
  const { contentBase64, ...rest } = args
  return gated(context, { permissions: [...PROCESSORS], tool: 'records.attach_proof', humanOnly: true }, rest, async actor => {
    const fileName = text(args.fileName, 'file name', 200)
    if (!PROOF_TYPES.has(args.mimeType)) throw new DomainError(Codes.INVALID_INPUT, 'Attach a PDF or a photo (PNG, JPEG, HEIC or WebP).', { field: 'authorisationFile' })
    const b64 = String(contentBase64 ?? '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new DomainError(Codes.INVALID_INPUT, 'The file could not be read.', { field: 'authorisationFile' })
    const bytes = Buffer.from(b64, 'base64')
    if (!bytes.length || bytes.length > PROOF_MAX_BYTES) throw new DomainError(Codes.INVALID_INPUT, 'The file must be under 4 MB.', { field: 'authorisationFile' })
    const hash = createHash('sha256').update(bytes).digest('hex')
    const result = await command(context.prisma, { name: 'records.attach_proof', actor, idempotencyKey: args.idempotencyKey, params: { ...rest, sha256: hash } }, async uow => {
      const request = await uow.tx.recordsRequest.findUnique({ where: { id: args.requestId }, select: { id: true, ref: true, status: true } })
      if (!request) throw new DomainError(Codes.NOT_FOUND, 'Records request not found.')
      if (!['received', 'verifying_authority'].includes(request.status)) throw new DomainError(Codes.GUARD_FAILED, 'Proof is attached while the request is being checked.')
      const doc = await uow.tx.document.create({ data: { title: `${request.ref} proof: ${fileName}`, kind: 'consent', storageKey: `db:${hash}`, sha256: hash, mimeType: args.mimeType, sizeBytes: bytes.length, visibility: 'internal', content: bytes.toString('base64') }, select: { id: true } })
      auditCreate(uow, actor, 'Document', doc.id, 'records.proof_attached', { requestId: request.id, sha256: hash, sizeBytes: bytes.length, mimeType: args.mimeType })
      return { id: doc.id, sha256: hash }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function verifyRecordsRequest(_root: unknown, args: { requestId: string; note: string; authorisationDocumentId?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS], tool: 'records.verify', humanOnly: true }, args, async actor => {
    const note = text(args.note, 'verification note', 1000)
    const result = await command(context.prisma, { name: 'records.verify', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const current = await lockRow<Record<string, any>>(uow.tx, 'RecordsRequest', args.requestId)
      if (THIRD_PARTY.has(current.basis) && !args.authorisationDocumentId && !['court_order', 'subpoena', 'public_health'].includes(current.basis)) {
        throw new DomainError(Codes.GUARD_FAILED, 'A third party needs the client\'s signed authorisation on file.', { field: 'authorisationDocumentId' })
      }
      if (args.authorisationDocumentId && !(await uow.tx.document.findUnique({ where: { id: args.authorisationDocumentId }, select: { id: true } }))) throw new DomainError(Codes.NOT_FOUND, 'Authorisation document not found.', { field: 'authorisationDocumentId' })
      const row = await transition<Record<string, any>>(uow, {
        model: 'RecordsRequest', id: args.requestId, from: ['verifying_authority'], to: 'verifying_authority', expectedVersion: args.expectedVersion, actor, eventType: 'records.verified',
        data: { verifiedById: actorUserId(actor), verifiedAt: uow.now, verificationNote: note, ...(args.authorisationDocumentId ? { authorisationDocumentId: args.authorisationDocumentId } : {}) },
      })
      return { id: row.id, status: row.status, verifiedAt: uow.now }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Approve or deny. Approval needs the verification above; a denial needs a reason. */
export async function decideRecordsRequest(_root: unknown, args: { requestId: string; decision: string; reason?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS], tool: 'records.decide', humanOnly: true }, args, async actor => {
    const decision = pick(args.decision, ['approve', 'deny'] as const, 'decision')
    const reason = decision === 'deny' ? text(args.reason, 'reason', 500) : String(args.reason ?? '').slice(0, 500)
    const result = await command(context.prisma, { name: 'records.decide', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const current = await lockRow<Record<string, any>>(uow.tx, 'RecordsRequest', args.requestId)
      if (decision === 'approve' && !current.verifiedAt) throw new DomainError(Codes.GUARD_FAILED, 'Verify who is asking and on what basis before approving.')
      const row = await transition<Record<string, any>>(uow, {
        model: 'RecordsRequest', id: args.requestId, from: ['verifying_authority'], to: decision === 'approve' ? 'approved' : 'denied', expectedVersion: args.expectedVersion, actor, eventType: `records.${decision === 'approve' ? 'approved' : 'denied'}`, reason, data: { decisionReason: reason },
      })
      await uow.tx.task.updateMany({ where: { kind: 'records_request', subjectType: 'RecordsRequest', subjectId: row.id, status: { in: ['open', 'in_progress'] } }, data: decision === 'deny' ? { status: 'done', completedAt: uow.now, version: { increment: 1 } } : { version: { increment: 1 } } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function withdrawRecordsRequest(_root: unknown, args: { requestId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS], tool: 'records.withdraw', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 500)
    const result = await command(context.prisma, { name: 'records.withdraw', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'RecordsRequest', id: args.requestId, from: ['received', 'verifying_authority', 'approved'], to: 'withdrawn', expectedVersion: args.expectedVersion, actor, eventType: 'records.withdrawn', reason, data: { decisionReason: reason } })
      await uow.tx.task.updateMany({ where: { kind: 'records_request', subjectType: 'RecordsRequest', subjectId: row.id, status: { in: ['open', 'in_progress'] } }, data: { status: 'cancelled', completedAt: uow.now, version: { increment: 1 } } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Ask for the approval a third-party release needs. The approval names exactly this packet: any change to it is a new request. */
async function packetFor(uow: any, request: Record<string, any>, documentIds: string[]) {
  if (!Array.isArray(documentIds) || !documentIds.length || documentIds.length > 200) throw new DomainError(Codes.INVALID_INPUT, 'Choose between 1 and 200 documents.', { field: 'documentIds' })
  const unique = [...new Set(documentIds)]
  const docs = await uow.tx.clinicalDocument.findMany({ where: { id: { in: unique }, patientId: request.patientId, status: { not: 'void' } }, select: { id: true, title: true, sha256: true, documentId: true } })
  if (docs.length !== unique.length) throw new DomainError(Codes.GUARD_FAILED, 'Every document must belong to this patient.', { field: 'documentIds' })
  const missing = docs.find((d: any) => !d.sha256)
  if (missing) throw new DomainError(Codes.GUARD_FAILED, `"${missing.title}" has not been rendered yet, so it has no fingerprint.`, { field: 'documentIds' })
  return docs.map((d: any) => ({ documentId: d.id, sha256: d.sha256 as string, title: String(d.title).slice(0, 120) }))
}

/**
 * Release the packet. Staff release to the client of record directly; any other basis needs the third-party approval for this exact
 * packet. An agent releases only to the client of record, to a contact point the clinic has verified, and only for an approved request.
 * The assembler's reading of each document is written to the read audit.
 */
export async function releaseRecords(_root: unknown, args: { requestId: string; documentIds: string[]; recipient: string; channel: string; contactPointId?: string | null; approvalRequestId?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS], scope: 'records.send', tool: 'records.release' }, args, async actor => {
    const channel = pick(args.channel, SHARE_CHANNELS, 'channel')
    const recipient = text(args.recipient, 'recipient', 200)
    const result = await command(context.prisma, { name: 'records.release', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const request = await lockRow<Record<string, any>>(uow.tx, 'RecordsRequest', args.requestId)
      if (request.status !== 'approved') throw new DomainError(Codes.INVALID_TRANSITION, 'Only an approved request can be released.', { currentStatus: request.status })
      const thirdParty = THIRD_PARTY.has(request.basis)
      let destination = recipient
      if (actor.kind === 'agent') {
        if (thirdParty) {
          // Not the agent's to send: leave a proposal for staff, naming the packet, and stop.
          const documentsP = await packetFor(uow, request, args.documentIds)
          const hashP = packetHashOf(documentsP, recipient, channel)
          const payload = { requestId: request.id, packetHash: hashP, recipient, channel, documents: documentsP.length }
          const prior = await uow.tx.proposal.findFirst({ where: { kind: 'records.release', targetId: request.id, payloadHash: payloadHash(payload), status: 'proposed' }, select: { id: true } })
          const p = prior ?? await uow.tx.proposal.create({ data: { kind: 'records.release', payload: payload as never, payloadHash: payloadHash(payload), status: 'proposed', targetList: 'RecordsRequest', targetId: request.id, proposedByAgentId: actorAgentId(actor) } })
          return { proposed: true, proposalId: p.id, packetHash: hashP, documents: documentsP.length }
        }
      }
      if (!thirdParty || actor.kind === 'agent' || args.contactPointId) {
        if (request.basis === 'client_of_record' || actor.kind === 'agent') {
          if (!args.contactPointId) throw new DomainError(Codes.GUARD_FAILED, 'Pick the verified contact the records go to.', { field: 'contactPointId' })
          const cp = await uow.tx.contactPoint.findUnique({ where: { id: args.contactPointId }, select: { value: true, verifiedAt: true, status: true, person: { select: { clientId: true } } } })
          if (!cp?.verifiedAt || cp.status !== 'active' || cp.person?.clientId !== request.clientId) throw new DomainError(Codes.GUARD_FAILED, 'Records go only to a verified contact of the client of record.', { field: 'contactPointId' })
          destination = cp.value
        }
      }
      const documents = await packetFor(uow, request, args.documentIds)
      const hash = packetHashOf(documents, destination, channel)
      if (thirdParty) {
        if (!args.approvalRequestId) {
          const approval = await requestApproval(uow, actor, { action: 'records.release_third_party', targetList: 'RecordsRequest', targetId: request.id, payload: { packetHash: hash, recipient: destination, channel }, requiredPermission: 'canApproveRecordsRelease', summary: `Release ${documents.length} document(s) to ${destination} (${request.basis.replaceAll('_', ' ')})` })
          return { proposed: true, approvalRequestId: (approval as any).id, packetHash: hash, documents: documents.length }
        }
        await consumeApproval(uow, { requestId: args.approvalRequestId, action: 'records.release_third_party', targetList: 'RecordsRequest', targetId: request.id, payload: { packetHash: hash, recipient: destination, channel } })
      }
      const release = await uow.tx.recordsRelease.create({ data: { requestId: request.id, recipient: destination, channel, destination, documents, packetHash: hash, releasedByUserId: actorUserId(actor), releasedByAgentId: actorAgentId(actor), at: uow.now } })
      await transition(uow, { model: 'RecordsRequest', id: request.id, from: ['approved'], to: 'released', expectedVersion: args.expectedVersion, actor, eventType: 'records.released', metadata: { releaseId: release.id, packetHash: hash } })
      await writeReadAudit(uow.tx, { actorKind: actor.kind === 'user' ? 'user' : actor.kind === 'agent' ? 'agent' : 'system', actorId: actor.kind === 'user' ? actor.userId : actor.kind === 'agent' ? actor.agentId : actor.name, actorLabel: actor.name ?? null },
        documents.map((d: { documentId: string }) => ({ resourceType: 'ClinicalDocument', resourceId: d.documentId, fields: new Set(['body', 'release']) })).concat([{ resourceType: 'Patient', resourceId: request.patientId, fields: new Set(['records_release']) }]) as never, 'records_request', release.id)
      await uow.tx.task.updateMany({ where: { kind: 'records_request', subjectType: 'RecordsRequest', subjectId: request.id, status: { in: ['open', 'in_progress'] } }, data: { status: 'done', completedAt: uow.now, version: { increment: 1 } } })
      auditCreate(uow, actor, 'RecordsRelease', release.id, 'records.release_made', { packetHash: hash, documents: documents.length, channel, basis: request.basis })
      return { proposed: false, id: release.id, packetHash: hash, documents: documents.length, status: 'released' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Show the same packet again exactly: recompute its hash from the stored list. */
export async function verifyReleasePacket(_root: unknown, args: { releaseId: string }, context: Ctx) {
  return gated(context, { permissions: [...PROCESSORS, 'canReadAudit'], tool: 'records.verify_packet', humanOnly: true }, args, async () => {
    const rel = await context.prisma.recordsRelease.findUnique({ where: { id: args.releaseId } })
    if (!rel) throw new DomainError(Codes.NOT_FOUND, 'Release not found.')
    const docs = (rel.documents as { documentId: string; sha256: string }[] | null) ?? []
    return { id: rel.id, packetHash: rel.packetHash, matches: packetHashOf(docs, rel.destination || rel.recipient, rel.channel) === rel.packetHash, documents: docs.length, hashOfList: payloadHash(docs) }
  })
}
