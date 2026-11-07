import { describe, expect, it } from 'vitest'
import type { Actor } from './actor'
import { canonicalJson, payloadHash } from './canonical'
import { auditHash, GENESIS_HASH } from './audit'
import { assertCanDecide, assertIndependentApproval, assertIndependentComplianceReview, hasIndependentApproval } from './separationOfDuties'

const user = (userId: string): Actor => ({ kind: 'user', userId, permissions: new Set(['canApprovePolicies']) })

describe('separation of duties', () => {
  it('blocks self-approval, agent approval and owner-of-agent approval', () => {
    expect(() => assertCanDecide(user('u1'), 'u1')).toThrow(/your own request/)
    expect(() => assertCanDecide({ kind: 'agent', agentId: 'a1', ownerUserId: 'u2', scopes: new Set() }, 'u1')).toThrow(/never approve/)
    expect(() => assertCanDecide({ kind: 'system', name: 'router' }, 'u1')).toThrow(/never approve/)
    expect(() => assertCanDecide(user('u2'), null, 'u2')).toThrow(/your own agent/)
    expect(() => assertCanDecide(user('u2'), null, 'u2', false)).not.toThrow()
    expect(() => assertCanDecide(user('u2'), 'u1')).not.toThrow()
  })

  it('needs an approval from someone outside the excluded set', () => {
    const decisions = [{ decision: 'approved', user: { id: 'u1' } }, { decision: 'rejected', user: { id: 'u3' } }]
    expect(hasIndependentApproval(decisions, ['u1'])).toBe(false)
    expect(hasIndependentApproval([...decisions, { decision: 'approved', user: { id: 'u2' } }], ['u1'])).toBe(true)
    expect(() => assertIndependentApproval(decisions, ['u1'])).toThrow(/someone other/)
  })

  it('blocks favourable compliance decisions about yourself only', () => {
    expect(() => assertIndependentComplianceReview('PreClearance', 'u1', 'u1', 'approved')).toThrow()
    expect(() => assertIndependentComplianceReview('PreClearance', 'u1', 'u1', 'denied')).not.toThrow()
    expect(() => assertIndependentComplianceReview('PreClearance', 'u1', 'u2', 'approved')).not.toThrow()
  })
})

describe('canonical hashing', () => {
  it('ignores key order and keeps exact numbers as text', () => {
    expect(canonicalJson({ b: 1n, a: { d: undefined, c: new Date('2026-11-06T00:00:00Z') } })).toBe('{"a":{"c":"2026-11-06T00:00:00.000Z"},"b":"1"}')
    expect(payloadHash({ x: 1, y: 2 })).toBe(payloadHash({ y: 2, x: 1 }))
  })

  it('changes the audit hash when any stored field changes', () => {
    const row = { seq: 1, eventKey: 'k', eventType: 'order.created', entityType: 'Order', entityId: 'o1', actorUserId: 'u1', actorAgentId: null, approverId: null, reason: null, before: null, after: { qty: '1' }, metadata: null, requestId: null, prevHash: GENESIS_HASH, at: new Date('2026-11-06T15:00:00Z') }
    const base = auditHash(GENESIS_HASH, row)
    expect(auditHash(GENESIS_HASH, { ...row, after: { qty: '2' } })).not.toBe(base)
    expect(auditHash(GENESIS_HASH, { ...row, actorUserId: 'u2' })).not.toBe(base)
    expect(auditHash('f'.repeat(64), row)).not.toBe(base)
    expect(auditHash(GENESIS_HASH, { ...row })).toBe(base)
  })
})
