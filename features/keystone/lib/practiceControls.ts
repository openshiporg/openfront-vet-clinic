import { DomainError, Codes } from './errors'
import { dec, plain } from './decimal'
import { registerApplier } from './approvalAppliers'
import { requestApproval } from './approval'
import type { Actor } from './actor'
import type { UnitOfWork } from './unitOfWork'

/**
 * Practice-wide controls (approval thresholds, deposit rule, agent-owner separation, feature flags)
 * change only through maker-checker: one person requests, a second with canApprovePolicies approves,
 * then the change applies against the version that was approved (STATE-MACHINES §0, SCHEMA §1.1).
 * The AI voice flag lives here: turning the receptionist on is a governed decision, not a toggle.
 */

const FEATURE_KEYS = ['boarding', 'grooming', 'wellnessPlans', 'insurance', 'aiVoice', 'scribe', 'multiLocation', 'pdmp', 'csos', 'drugCabinet'] as const
type FeatureKey = (typeof FEATURE_KEYS)[number]

export type PracticeControls = {
  refundApprovalThresholdMinor?: string
  discountApprovalThresholdBps?: number
  writeOffRequiresApproval?: boolean
  electiveDepositPct?: string
  estimateValidityDays?: number
  noShowGraceMinutes?: number
  strictAgentOwnerSoD?: boolean
  features?: Partial<Record<FeatureKey, boolean>>
}

const CONTROL_KEYS = ['refundApprovalThresholdMinor', 'discountApprovalThresholdBps', 'writeOffRequiresApproval', 'electiveDepositPct', 'estimateValidityDays', 'noShowGraceMinutes', 'strictAgentOwnerSoD', 'features']

const intIn = (value: unknown, min: number, max: number, name: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new DomainError(Codes.INVALID_INPUT, `${name} must be a whole number from ${min} to ${max}.`, { field: name })
}
const bool = (value: unknown, name: string) => {
  if (typeof value !== 'boolean') throw new DomainError(Codes.INVALID_INPUT, `${name} must be true or false.`, { field: name })
  return value
}

export function validatePracticeControls(input: PracticeControls): PracticeControls {
  const out: PracticeControls = {}
  const keys = Object.keys(input ?? {})
  if (!keys.length) throw new DomainError(Codes.INVALID_INPUT, 'Nothing to change.')
  for (const key of keys) if (!CONTROL_KEYS.includes(key)) throw new DomainError(Codes.INVALID_INPUT, `${key} is not a practice control.`, { field: key })
  if (input.refundApprovalThresholdMinor !== undefined) {
    const text = String(input.refundApprovalThresholdMinor)
    if (!/^\d{1,12}$/.test(text)) throw new DomainError(Codes.INVALID_INPUT, 'refundApprovalThresholdMinor must be whole cents, as text.', { field: 'refundApprovalThresholdMinor' })
    out.refundApprovalThresholdMinor = text
  }
  if (input.discountApprovalThresholdBps !== undefined) { intIn(input.discountApprovalThresholdBps, 0, 10_000, 'discountApprovalThresholdBps'); out.discountApprovalThresholdBps = input.discountApprovalThresholdBps }
  if (input.writeOffRequiresApproval !== undefined) out.writeOffRequiresApproval = bool(input.writeOffRequiresApproval, 'writeOffRequiresApproval')
  if (input.electiveDepositPct !== undefined) {
    const pct = dec(String(input.electiveDepositPct))
    if (pct.isNegative() || pct.greaterThan(1) || pct.decimalPlaces() > 6) throw new DomainError(Codes.INVALID_INPUT, 'electiveDepositPct is a fraction from 0 to 1 (0.5 = 50%).', { field: 'electiveDepositPct' })
    out.electiveDepositPct = plain(pct)
  }
  if (input.estimateValidityDays !== undefined) { intIn(input.estimateValidityDays, 1, 365, 'estimateValidityDays'); out.estimateValidityDays = input.estimateValidityDays }
  if (input.noShowGraceMinutes !== undefined) { intIn(input.noShowGraceMinutes, 0, 240, 'noShowGraceMinutes'); out.noShowGraceMinutes = input.noShowGraceMinutes }
  if (input.strictAgentOwnerSoD !== undefined) out.strictAgentOwnerSoD = bool(input.strictAgentOwnerSoD, 'strictAgentOwnerSoD')
  if (input.features !== undefined) {
    if (!input.features || typeof input.features !== 'object') throw new DomainError(Codes.INVALID_INPUT, 'features must be an object of flags.')
    const features: Partial<Record<FeatureKey, boolean>> = {}
    for (const [k, v] of Object.entries(input.features)) {
      if (!FEATURE_KEYS.includes(k as FeatureKey)) throw new DomainError(Codes.INVALID_INPUT, `${k} is not a feature flag.`, { field: k })
      features[k as FeatureKey] = bool(v, k)
    }
    out.features = features
  }
  return out
}

export async function requestPracticeControlsChange(uow: UnitOfWork, actor: Actor, input: PracticeControls, reason: string) {
  const changes = validatePracticeControls(input)
  const practice = await uow.tx.practiceSettings.findUnique({ where: { id: 1 } })
  if (!practice) throw new DomainError(Codes.NOT_FOUND, 'Practice settings are not set up yet.')
  return requestApproval(uow, actor, {
    action: 'practice.controls',
    targetList: 'PracticeSettings',
    targetId: '1',
    payload: { changes, baseVersion: practice.version },
    requiredPermission: 'canApprovePolicies',
    summary: `Change practice controls: ${Object.keys(changes).join(', ')}${reason ? ` (${reason})` : ''}`,
  })
}

registerApplier('practice.controls', async (uow, actor, request) => {
  const [row] = await uow.tx.$queryRaw<{ version: number }[]>`SELECT version FROM "PracticeSettings" WHERE id = 1 FOR UPDATE`
  if (!row) throw new DomainError(Codes.NOT_FOUND, 'Practice settings are not set up yet.')
  const { changes, baseVersion } = request.payload as { changes: PracticeControls; baseVersion: number }
  if (row.version !== baseVersion) throw new DomainError(Codes.STALE_STATE, 'Practice settings changed after this was approved. Request the change again.', { currentVersion: row.version })
  const before = await uow.tx.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })
  const data: Record<string, unknown> = { ...changes, version: { increment: 1 } }
  if (changes.refundApprovalThresholdMinor !== undefined) data.refundApprovalThresholdMinor = BigInt(changes.refundApprovalThresholdMinor)
  if (changes.features) data.features = { ...((before.features as Record<string, boolean> | null) ?? {}), ...changes.features }
  const updated = await uow.tx.practiceSettings.updateMany({ where: { id: 1, version: baseVersion }, data: data as never })
  if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, 'Practice settings changed while applying.')
  const pick = (k: string) => (before as Record<string, unknown>)[k]
  uow.audit({
    eventType: 'practice.controls_changed', entityType: 'PracticeSettings', entityId: '1', actorUserId: actor.kind === 'user' ? actor.userId : null,
    before: Object.fromEntries(Object.keys(changes).map(k => [k, typeof pick(k) === 'bigint' ? String(pick(k)) : pick(k)])), after: changes,
  })
  return { applied: Object.keys(changes) }
})
