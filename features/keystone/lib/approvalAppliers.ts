import type { Actor } from './actor'
import type { UnitOfWork } from './unitOfWork'

/**
 * What runs when an approval request is approved and the requester (or the system) applies it.
 * Each domain registers its actions here; applying consumes the approval, which checks the payload
 * hash, so the approved payload is exactly what runs.
 */
export type ApprovalApplier = (uow: UnitOfWork, actor: Actor, request: { id: string; targetList: string; targetId: string; payload: any }) => Promise<unknown>

type Registration = { apply: ApprovalApplier; applyOnApprove: boolean }
const appliers = new Map<string, Registration>()

/**
 * applyOnApprove: the approved change runs in the same transaction as the approval (practice controls,
 * policy publication). Otherwise the owning workflow consumes the approval when it acts (an order
 * release consumes it when the order routes).
 */
export function registerApplier(action: string, apply: ApprovalApplier, options: { applyOnApprove?: boolean } = {}) {
  if (appliers.has(action)) throw new Error(`Applier for ${action} already registered`)
  appliers.set(action, { apply, applyOnApprove: options.applyOnApprove ?? true })
}

export function applierFor(action: string) {
  return appliers.get(action) ?? null
}
