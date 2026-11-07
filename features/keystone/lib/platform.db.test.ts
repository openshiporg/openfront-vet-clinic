import fc from 'fast-check'
import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import type { Actor } from './actor'
import { verifyAuditChain } from './audit'
import { auditCreate, transition } from './cas'
import { command } from './command'
import { DomainError } from './errors'
import { acquireLease, assertFence } from './lease'
import { drainOutbox } from './outbox'
import { consumeApproval, decideApproval, requestApproval } from './approval'
import { nextReference } from './sequence'
import { runInTransaction } from './unitOfWork'

const maker: Actor = { kind: 'user', userId: '', permissions: new Set(['canDiscount', 'canApproveDiscount']) }
const checker: Actor = { kind: 'user', userId: '', permissions: new Set(['canDiscount', 'canApproveDiscount']) }

const codeOf = (error: unknown) => (error instanceof DomainError ? error.code : (error as Error)?.message)

describe.skipIf(!hasTestDatabase)('platform spine (database)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = testPrisma(16)
    await resetDatabase(prisma)
    const [a, b] = await Promise.all([
      prisma.user.create({ data: { name: 'Maker', email: `${uniqueKey('maker')}@test.local`, password: 'x'.repeat(60) } }),
      prisma.user.create({ data: { name: 'Checker', email: `${uniqueKey('checker')}@test.local`, password: 'x'.repeat(60) } }),
    ])
    ;(maker as { userId: string }).userId = a.id
    ;(checker as { userId: string }).userId = b.id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  /** A governed row to move through states: an ApprovalRequest has status + version. */
  async function newRequest() {
    return runInTransaction(prisma, uow => requestApproval(uow, maker, { action: 'discount.apply', targetList: 'Invoice', targetId: uniqueKey('inv'), payload: { amountMinor: '1500', reason: 'senior' }, requiredPermission: 'canApproveDiscount' }))
  }

  describe('transition() compare-and-set', () => {
    it('lets exactly one of many concurrent writers win; the rest see STALE_STATE or INVALID_TRANSITION', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async writers => {
          const request = await newRequest()
          const results = await Promise.allSettled(
            Array.from({ length: writers }, (_, i) =>
              runInTransaction(prisma, uow => transition(uow, { model: 'ApprovalRequest', id: request.id, from: ['pending'], to: i % 2 ? 'cancelled' : 'rejected', expectedVersion: 0, actor: maker, eventType: 'test.race' }))
            )
          )
          const winners = results.filter(r => r.status === 'fulfilled')
          expect(winners).toHaveLength(1)
          for (const loser of results.filter(r => r.status === 'rejected')) {
            expect(['STALE_STATE', 'INVALID_TRANSITION']).toContain(codeOf((loser as PromiseRejectedResult).reason))
          }
          const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })
          expect(row.version).toBe(1)
        }),
        { numRuns: 6 }
      )
    })

    it('refuses a forbidden from-state and a stale version, changing nothing', async () => {
      const request = await newRequest()
      await expect(runInTransaction(prisma, uow => transition(uow, { model: 'ApprovalRequest', id: request.id, from: ['approved'], to: 'expired', actor: maker, eventType: 'x' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      await expect(runInTransaction(prisma, uow => transition(uow, { model: 'ApprovalRequest', id: request.id, from: ['pending'], to: 'cancelled', expectedVersion: 7, actor: maker, eventType: 'x' }))).rejects.toMatchObject({ code: 'STALE_STATE', details: { currentStatus: 'pending', currentVersion: 0 } })
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('pending')
    })

    it('rolls back the state change, audit and outbox together when a later step fails', async () => {
      const request = await newRequest()
      const auditBefore = await prisma.auditEvent.count()
      const outboxBefore = await prisma.outboxEvent.count()
      await expect(runInTransaction(prisma, async uow => {
        await transition(uow, { model: 'ApprovalRequest', id: request.id, from: ['pending'], to: 'cancelled', actor: maker, eventType: 'approval.cancelled' })
        uow.emit({ topic: 'test.never', aggregateType: 'ApprovalRequest', aggregateId: request.id, payload: {} })
        throw new Error('posting failed')
      })).rejects.toThrow('posting failed')
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('pending')
      expect(await prisma.auditEvent.count()).toBe(auditBefore)
      expect(await prisma.outboxEvent.count()).toBe(outboxBefore)
    })
  })

  describe('command() idempotency', () => {
    it('runs once per key, replays the stored response, and refuses the key for another request', async () => {
      const key = uniqueKey('idem')
      let runs = 0
      const run = (qty: string, actor: Actor = maker) => command(prisma, { name: 'test.create', actor, idempotencyKey: key, params: { qty } }, async uow => {
        runs += 1
        const reference = await nextReference(uow.tx, 'TST', uow.now)
        auditCreate(uow, actor, 'Test', reference, 'test.created', { qty })
        return { reference }
      })
      const results = await Promise.all([run('5'), run('5'), run('5'), run('5')])
      expect(runs).toBe(1)
      expect(new Set(results.map(r => r.value.reference)).size).toBe(1)
      expect(results.filter(r => !r.replay)).toHaveLength(1)
      await expect(run('6')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
      await expect(run('5', checker)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
      await expect(command(prisma, { name: 'x', actor: maker, idempotencyKey: '', params: {} }, async () => 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
    })

    it('hands out gap-free references under concurrency', async () => {
      const refs = await Promise.all(Array.from({ length: 12 }, () => runInTransaction(prisma, uow => nextReference(uow.tx, 'SEQ', uow.now))))
      const numbers = refs.map(r => Number.parseInt(r.split('-').pop()!, 10)).sort((a, b) => a - b)
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    })
  })

  describe('maker-checker approvals', () => {
    it('blocks self-approval, binds the approval to the payload, and consumes it once', async () => {
      const targetId = uniqueKey('inv')
      const payload = { amountMinor: '1500', lineId: 'line-1', reason: 'senior' }
      const request = await runInTransaction(prisma, uow => requestApproval(uow, maker, { action: 'discount.apply', targetList: 'Invoice', targetId, payload, requiredPermission: 'canApproveDiscount' }))
      await expect(runInTransaction(prisma, uow => decideApproval(uow, maker, { requestId: request.id, decision: 'approve' }))).rejects.toMatchObject({ code: 'SELF_APPROVAL' })
      const agent: Actor = { kind: 'agent', agentId: 'agent-1', ownerUserId: null, scopes: new Set(['charges.suggest']) }
      await expect(runInTransaction(prisma, uow => decideApproval(uow, agent, { requestId: request.id, decision: 'approve' }))).rejects.toMatchObject({ code: 'AGENT_CANNOT_APPROVE' })
      const unprivileged: Actor = { kind: 'user', userId: checker.kind === 'user' ? checker.userId : '', permissions: new Set(['canDiscount']) }
      await expect(runInTransaction(prisma, uow => decideApproval(uow, unprivileged, { requestId: request.id, decision: 'approve' }))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })

      await runInTransaction(prisma, uow => decideApproval(uow, checker, { requestId: request.id, decision: 'approve', reason: 'Within limits', expectedVersion: 0 }))
      await expect(runInTransaction(prisma, uow => consumeApproval(uow, { requestId: request.id, action: 'discount.apply', targetList: 'Invoice', targetId, payload: { ...payload, amountMinor: '15000' } }))).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' })
      const used = await runInTransaction(prisma, uow => consumeApproval(uow, { requestId: request.id, action: 'discount.apply', targetList: 'Invoice', targetId, payload }))
      expect(used.approverId).toBe(checker.kind === 'user' ? checker.userId : null)
      await expect(runInTransaction(prisma, uow => consumeApproval(uow, { requestId: request.id, action: 'discount.apply', targetList: 'Invoice', targetId, payload }))).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' })
    })
  })

  describe('leases and fencing', () => {
    it('grants one holder, increments the token on take-over, and rejects the stale holder', async () => {
      const key = uniqueKey('router')
      const t0 = new Date('2026-11-06T15:00:00Z')
      const a = await acquireLease(prisma, key, 'worker-a', 30_000, t0)
      expect(a?.fencingToken).toBe(1)
      expect(await acquireLease(prisma, key, 'worker-b', 30_000, new Date(t0.getTime() + 1_000))).toBeNull()
      const renewed = await acquireLease(prisma, key, 'worker-a', 30_000, new Date(t0.getTime() + 2_000))
      expect(renewed?.fencingToken).toBe(1)
      // worker-a stalls past expiry; worker-b takes over with a higher token.
      const later = new Date(t0.getTime() + 40_000)
      const b = await acquireLease(prisma, key, 'worker-b', 30_000, later)
      expect(b?.fencingToken).toBe(2)
      await expect(prisma.$transaction(tx => assertFence(tx, renewed!, later))).rejects.toMatchObject({ code: 'STALE_FENCING_TOKEN' })
      await expect(prisma.$transaction(tx => assertFence(tx, b!, later))).resolves.toBeUndefined()
      await expect(prisma.$transaction(tx => assertFence(tx, b!, new Date(later.getTime() + 31_000)))).rejects.toMatchObject({ code: 'LEASE_LOST' })
    })

    it('lets exactly one of many concurrent claimants hold a free lease', async () => {
      const key = uniqueKey('contended')
      const now = new Date()
      const grants = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireLease(prisma, key, `w${i}`, 30_000, now)))
      expect(grants.filter(Boolean)).toHaveLength(1)
    })
  })

  describe('outbox delivery', () => {
    it('delivers each message exactly once in effect, even when a worker crashes after the side effect', async () => {
      const topic = uniqueKey('topic')
      const ids = await runInTransaction(prisma, async uow => {
        for (let i = 0; i < 5; i += 1) uow.emit({ topic, aggregateType: 'Test', aggregateId: `agg-${i}`, payload: { i }, dedupeKey: `${topic}:${i}` })
        // Same dedupe key again: kept once.
        uow.emit({ topic, aggregateType: 'Test', aggregateId: 'agg-0', payload: { i: 0 }, dedupeKey: `${topic}:0` })
        return true
      })
      expect(ids).toBe(true)
      expect(await prisma.outboxEvent.count({ where: { topic } })).toBe(5)

      // The receiving side is idempotent on the dedupe key (as payment and lab partners are on their idempotency keys).
      const effects = new Map<string, number>()
      const receive = (dedupeKey: string) => effects.set(dedupeKey, (effects.get(dedupeKey) ?? 0) + 1)
      const applied = new Set<string>()
      const handler = async (message: { dedupeKey: string }) => {
        if (!applied.has(message.dedupeKey)) { applied.add(message.dedupeKey); receive(message.dedupeKey) }
      }

      const t0 = new Date(Date.now() + 1_000)
      // Worker A delivers message effects but "crashes" before acknowledging two of them.
      let crashes = 0
      const crashing = await drainOutbox(prisma, {
        workerId: 'worker-a', topics: [topic], leaseMs: 5_000, now: () => t0,
        handlers: { [topic]: async message => { await handler(message); if (crashes < 2) { crashes += 1; throw new Error('worker crashed after send') } } },
      })
      expect(crashing.claimed).toBe(5)
      expect(crashing.failed).toBe(2)

      // Worker B runs after the retry delay and redelivers only the unacknowledged ones.
      const t1 = new Date(t0.getTime() + 10_000)
      const second = await drainOutbox(prisma, { workerId: 'worker-b', topics: [topic], now: () => t1, handlers: { [topic]: handler } })
      expect(second.delivered).toBe(2)
      expect(await prisma.outboxEvent.count({ where: { topic, status: 'delivered' } })).toBe(5)
      expect([...effects.values()].every(count => count === 1)).toBe(true)
      expect(effects.size).toBe(5)
    })

    it('refuses the acknowledgement of a worker whose lease was taken over', async () => {
      const topic = uniqueKey('slow')
      await runInTransaction(prisma, async uow => uow.emit({ topic, aggregateType: 'Test', aggregateId: 'x', payload: {}, dedupeKey: `${topic}:x` }))
      const t0 = new Date(Date.now() + 1_000)
      let resultB: Awaited<ReturnType<typeof drainOutbox>> | null = null
      const resultA = await drainOutbox(prisma, {
        workerId: 'slow-a', topics: [topic], leaseMs: 1_000, now: () => t0,
        handlers: {
          // While A is still working, its lease expires and B claims and delivers the message.
          [topic]: async () => { resultB = await drainOutbox(prisma, { workerId: 'fast-b', topics: [topic], now: () => new Date(t0.getTime() + 5_000), handlers: { [topic]: async () => undefined } }) },
        },
      })
      expect(resultB!.delivered).toBe(1)
      expect(resultA.staleAcks).toBe(1)
      const row = await prisma.outboxEvent.findFirstOrThrow({ where: { topic } })
      expect(row.status).toBe('delivered')
      expect(row.attempts).toBe(2)
    })
  })

  describe('audit chain', () => {
    it('verifies, and pinpoints tampering even by someone with database access', async () => {
      const verified = await verifyAuditChain(prisma)
      expect(verified.ok).toBe(true)
      expect(verified.count).toBeGreaterThan(10)

      // The append-only trigger blocks edits and deletes outright.
      await expect(prisma.auditEvent.updateMany({ where: { seq: 3 }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/)
      await expect(prisma.auditEvent.deleteMany({ where: { seq: 3 } })).rejects.toThrow(/append-only/)

      // Bypass the trigger (as a superuser could) and the chain still exposes the edit.
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER USER'),
        prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET reason = 'quietly edited' WHERE seq = 3`),
        prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER USER'),
      ])
      const tampered = await verifyAuditChain(prisma)
      expect(tampered).toMatchObject({ ok: false, brokenAtSeq: 3, problem: 'content does not match its hash' })
    })
  })
})
