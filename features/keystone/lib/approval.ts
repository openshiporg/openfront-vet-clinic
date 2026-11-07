import { payloadHash, toJsonValue } from './canonical'
import { actorAgentId, actorUserId, type Actor } from './actor'
import { DomainError, Codes } from './errors'
import { assertCanDecide } from './separationOfDuties'
import { lockRow, transition } from './cas'
import type { UnitOfWork } from './unitOfWork'
import type { Permission } from '../access'

/**
 * Action-bound maker-checker approvals (SCHEMA §13.5; restaurant managerApproval.ts pattern).
 * A request names an action, a target and the exact payload. The decider must be a different
 * person who holds the required permission. Using an approval checks the payload hash against the
 * action about to run, so an approval for one order can't release another, and it is consumed once.
 */

export type RequestApprovalInput = {
  action: string
  targetList: string
  targetId: string
  payload: unknown
  requiredPermission: Permission
  summary?: string
  expiresInMinutes?: number
}

export async function requestApproval(uow: UnitOfWork, actor: Actor, input: RequestApprovalInput) {
  const policy = await uow.tx.approvalPolicy.findUnique({ where: { action: input.action } })
  const requiredPermission = (policy?.requiredPermission as Permission | undefined) ?? input.requiredPermission
  const minutes = input.expiresInMinutes ?? policy?.expiresAfterMinutes ?? 1440
  const created = await uow.tx.approvalRequest.create({
    data: {
      action: input.action,
      summary: input.summary ?? '',
      targetList: input.targetList,
      targetId: input.targetId,
      payload: toJsonValue(input.payload) as never,
      payloadHash: payloadHash(input.payload),
      requiredPermission,
      requestedById: actorUserId(actor),
      requestedByAgentId: actorAgentId(actor),
      status: 'pending',
      expiresAt: new Date(uow.now.getTime() + minutes * 60_000),
    },
  })
  uow.audit({ eventType: 'approval.requested', entityType: 'ApprovalRequest', entityId: created.id, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { action: input.action, targetList: input.targetList, targetId: input.targetId, payloadHash: created.payloadHash, requiredPermission } })
  uow.emit({ topic: 'notify.approval', aggregateType: 'ApprovalRequest', aggregateId: created.id, payload: { action: input.action, requiredPermission }, dedupeKey: `notify.approval:${created.id}` })
  return created
}

export async function decideApproval(uow: UnitOfWork, actor: Actor, input: { requestId: string; decision: 'approve' | 'reject'; reason?: string; expectedVersion?: number | null; strictAgentOwner?: boolean }) {
  const request = await lockRow<Record<string, any>>(uow.tx, 'ApprovalRequest', input.requestId)
  let agentOwnerId: string | null = null
  if (request.requestedByAgentId) {
    const agent = await uow.tx.agentIdentity.findUnique({ where: { id: request.requestedByAgentId }, select: { ownerId: true } })
    agentOwnerId = agent?.ownerId ?? null
  }
  assertCanDecide(actor, request.requestedById, agentOwnerId, input.strictAgentOwner ?? true)
  if (actor.kind !== 'user' || !actor.permissions.has(request.requiredPermission as Permission)) {
    throw new DomainError(Codes.NOT_AUTHORIZED, `Deciding this needs the ${request.requiredPermission} permission.`)
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() <= uow.now.getTime()) {
    await transition(uow, { model: 'ApprovalRequest', id: input.requestId, from: ['pending'], to: 'expired', actor, eventType: 'approval.expired' })
    throw new DomainError(Codes.GUARD_FAILED, 'This approval request has expired.')
  }
  const to = input.decision === 'approve' ? 'approved' : 'rejected'
  const updated = await transition(uow, {
    model: 'ApprovalRequest', id: input.requestId, from: ['pending'], to, expectedVersion: input.expectedVersion, actor,
    eventType: `approval.${to}`, reason: input.reason ?? null, approverId: actor.userId,
  })
  await uow.tx.approvalDecision.create({ data: { requestId: input.requestId, decidedById: actor.userId, decision: input.decision, reason: input.reason ?? '', at: uow.now } })
  return updated
}

/**
 * Use an approved request for exactly this action and payload. Marks it consumed so it can't be
 * used twice. Returns the approver's user id for the audit trail.
 */
export async function consumeApproval(uow: UnitOfWork, input: { requestId: string; action: string; targetList: string; targetId: string; payload: unknown }) {
  const request = await lockRow<Record<string, any>>(uow.tx, 'ApprovalRequest', input.requestId)
  if (request.status !== 'approved') throw new DomainError(Codes.APPROVAL_REQUIRED, 'This action needs an approved request.')
  if (request.consumedAt) throw new DomainError(Codes.APPROVAL_MISMATCH, 'This approval was already used.')
  if (request.action !== input.action || request.targetList !== input.targetList || request.targetId !== input.targetId || request.payloadHash !== payloadHash(input.payload)) {
    throw new DomainError(Codes.APPROVAL_MISMATCH, 'The approval was given for a different action or payload.')
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() <= uow.now.getTime()) throw new DomainError(Codes.GUARD_FAILED, 'The approval has expired.')
  const decision = await uow.tx.approvalDecision.findFirst({ where: { requestId: input.requestId, decision: 'approve' }, orderBy: { at: 'desc' } })
  await uow.tx.approvalRequest.update({ where: { id: input.requestId }, data: { consumedAt: uow.now, version: { increment: 1 } } })
  uow.audit({ eventType: 'approval.consumed', entityType: 'ApprovalRequest', entityId: input.requestId, approverId: decision?.decidedById ?? null, after: { action: input.action, targetId: input.targetId } })
  return { approverId: decision?.decidedById ?? null }
}
