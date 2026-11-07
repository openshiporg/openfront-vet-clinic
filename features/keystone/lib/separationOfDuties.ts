// Separation of duties (openfront-financial separationOfDuties.ts, extended for agents).
// The person who raised a request, or who is the subject of a compliance record, can never be the
// one who approves it, and an agent can never approve anything.
import { DomainError, Codes } from './errors'
import type { Actor } from './actor'

export const SELF_APPROVAL_MESSAGE = "You can't approve your own request."
export const SELF_REVIEW_MESSAGE = "You can't make a compliance decision about your own record."
export const INDEPENDENT_APPROVAL_MESSAGE = 'This needs approval from someone other than the person who requested it.'
export const AGENT_APPROVAL_MESSAGE = 'An agent can propose but never approve.'

type DecisionLike = { decision?: string | null; user?: { id?: string | null } | null } | null | undefined

/** Blocks an approval by the person who raised the request, or by anyone who isn't a person. */
export function assertCanDecide(actor: Actor, requesterUserId: string | null | undefined, requesterAgentOwnerId?: string | null, strictAgentOwner = true) {
  if (actor.kind !== 'user') throw new DomainError(Codes.AGENT_CANNOT_APPROVE, AGENT_APPROVAL_MESSAGE)
  if (requesterUserId && requesterUserId === actor.userId) throw new DomainError(Codes.SELF_APPROVAL, SELF_APPROVAL_MESSAGE)
  // An agent's owner is accountable for what it proposes, so they can't be its checker either (PracticeSettings.strictAgentOwnerSoD).
  if (strictAgentOwner && requesterAgentOwnerId && requesterAgentOwnerId === actor.userId) throw new DomainError(Codes.SELF_APPROVAL, "You can't approve a proposal made by your own agent.")
}

/** True when at least one `approved` decision was made by someone outside `excludedUserIds`. */
export function hasIndependentApproval(decisions: readonly DecisionLike[] | null | undefined, excludedUserIds: readonly (string | null | undefined)[]) {
  const excluded = new Set(excludedUserIds.filter((id): id is string => Boolean(id)))
  return (decisions || []).some(decision => {
    const deciderId = decision?.user?.id
    return (decision?.decision === 'approved' || decision?.decision === 'approve') && typeof deciderId === 'string' && deciderId.length > 0 && !excluded.has(deciderId)
  })
}

export function assertIndependentApproval(decisions: readonly DecisionLike[] | null | undefined, excludedUserIds: readonly (string | null | undefined)[]) {
  if (!hasIndependentApproval(decisions, excludedUserIds)) throw new DomainError(Codes.APPROVAL_REQUIRED, INDEPENDENT_APPROVAL_MESSAGE)
}

const FAVOURABLE_COMPLIANCE_OUTCOMES: Record<string, readonly string[]> = {
  PreClearance: ['approved'],
  PersonalTransactionReport: ['accepted'],
  EligibilityCheck: ['passed'],
  ScreeningCheck: ['clear'],
}

/** Blocks a reviewer from clearing their own pre-clearance, report or check. */
export function assertIndependentComplianceReview(entityType: string, subjectId: string | null | undefined, reviewerId: string, toStatus: string) {
  if (subjectId && subjectId === reviewerId && FAVOURABLE_COMPLIANCE_OUTCOMES[entityType]?.includes(toStatus)) {
    throw new DomainError(Codes.SELF_APPROVAL, SELF_REVIEW_MESSAGE)
  }
}
