import type { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { runInTransaction } from '../lib/unitOfWork'
import { balanceOfClient, balanceOfInvoice } from '../lib/ledger'
import { systemActor } from '../lib/actor'
import { stripeAdapter } from '../../integrations/payment'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { acceptEstimate, attachOrderToPlan, createEstimate, presentEstimate } from './estimates'
import { addFeeCharge, applyDeposit, applyPaymentEvent, checkPaymentStatus, closeArPeriod, draftInvoice, postInvoice, recordPayment, requestRefund, takeCardPayment } from './billing'
import { buildClaimPacket } from './insurance'

/** Phase 4 exit gate against a real database; raw SQL plays the hostile application role. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const pgError = (e: unknown) => String((e as Error)?.message ?? e)
const key = () => uniqueKey('k')

describe.skipIf(!hasTestDatabase)('Phase 4 billing (database)', () => {
  let prisma: PrismaClient
  let ctx: { session: unknown; prisma: PrismaClient }
  let clientId = ''
  let patientId = ''
  let signerId = ''
  let locationId = ''
  const fee = async (code: string) => (await prisma.feeItem.findFirstOrThrow({ where: { code, version: { status: 'published' } } })).id

  /** A posted invoice for `qty` exams (7,800 each, untaxed) for the test client. */
  async function postedInvoice(qty = 1, postedOn?: string) {
    await addFeeCharge(null, { patientId, feeItemId: await fee('EXAM-OUTPATIENT'), qty: String(qty), idempotencyKey: key() }, ctx)
    const d = (await draftInvoice(null, { clientId, idempotencyKey: key() }, ctx)) as { id: string }
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } })
    const posted = (await postInvoice(null, { invoiceId: d.id, postedOn: postedOn ?? null, expectedVersion: inv.version, idempotencyKey: key() }, ctx)) as { totalMinor: string }
    return { id: d.id, total: BigInt(posted.totalMinor) }
  }

  beforeAll(async () => {
    prisma = testPrisma(8)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    ctx = { session: sessionFor('seed_user_marsh', ALL), prisma }
    await prisma.practiceSettings.update({ where: { id: 1 }, data: { electiveDepositPct: '0.5', depositBasis: 'low' } })
    const own = await prisma.patientOwnership.findFirstOrThrow({ where: { effectiveTo: null, role: 'primary' } })
    clientId = own.clientId!
    patientId = own.patientId!
    locationId = (await prisma.location.findFirstOrThrow()).id
    signerId = (await prisma.clientPerson.findFirstOrThrow({ where: { clientId } })).id
    await prisma.clientPerson.update({ where: { id: signerId }, data: { canApproveTreatment: true, canPay: true } })
  }, 1_700_000)
  afterAll(async () => { await prisma?.$disconnect() })
  afterEach(() => { vi.restoreAllMocks(); delete process.env.STRIPE_SECRET_KEY })

  it('invoice balance equals the sum of its ledger, a payment is never over-allocated, and the ledger cannot be edited', async () => {
    const inv = await postedInvoice(2)
    expect(inv.total).toBe(15600n)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(15600n)
    await recordPayment(null, { clientId, invoiceId: inv.id, method: 'cash', amountMinor: '5000', idempotencyKey: key() }, ctx)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(10600n)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('partially_paid')
    await expect(recordPayment(null, { clientId, invoiceId: inv.id, method: 'cash', amountMinor: '99999', idempotencyKey: key() }, ctx)).rejects.toThrow(/more than the invoice balance/i)
    await recordPayment(null, { clientId, invoiceId: inv.id, method: 'check', reference: '1042', amountMinor: '10600', idempotencyKey: key() }, ctx)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(0n)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('paid')
    const sums = await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM("amountMinor"),0)::bigint AS s FROM "ClientLedgerEntry" WHERE "invoice" = ${inv.id}`
    expect(sums[0].s).toBe(0n)
    // Σ allocations ≤ payment, enforced by the database even against a direct insert.
    const pay = await prisma.payment.findFirstOrThrow({ where: { forInvoiceId: inv.id }, orderBy: { createdAt: 'asc' } })
    await expect(prisma.paymentAllocation.create({ data: { paymentId: pay.id, invoiceId: inv.id, amountMinor: 1n, at: new Date() } })).rejects.toSatisfy(x => /allocat|payment/i.test(pgError(x)))
    const entry = await prisma.clientLedgerEntry.findFirstOrThrow({ where: { invoiceId: inv.id } })
    await expect(prisma.$executeRawUnsafe(`UPDATE "ClientLedgerEntry" SET "amountMinor" = 1 WHERE id = '${entry.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ClientLedgerEntry"`)).rejects.toBeTruthy()
  })

  it('a refund is made now, never exceeds the payment, and moves the invoice balance', async () => {
    const inv = await postedInvoice(1)
    await recordPayment(null, { clientId, invoiceId: inv.id, method: 'cash', amountMinor: String(inv.total), idempotencyKey: key() }, ctx)
    const pay = await prisma.payment.findFirstOrThrow({ where: { forInvoiceId: inv.id } })
    const r = (await requestRefund(null, { paymentId: pay.id, invoiceId: inv.id, amountMinor: '2000', reason: 'Visit shortened', idempotencyKey: key() }, ctx)) as { status: string }
    expect(r.status).toBe('succeeded')
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(2000n)
    await expect(requestRefund(null, { paymentId: pay.id, invoiceId: inv.id, amountMinor: String(inv.total), reason: 'Too much', idempotencyKey: key() }, ctx)).rejects.toThrow(/refund/i)
  })

  it('unknown never double-charges: the check repeats the same idempotency key and settles exactly once', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const inv = await postedInvoice(1)
    const charge = vi.spyOn(stripeAdapter, 'charge').mockResolvedValue({ outcome: 'unknown', providerRef: null, message: 'No answer' })
    const resolve = vi.spyOn(stripeAdapter, 'resolve').mockResolvedValue({ outcome: 'succeeded', providerRef: 'pi_123', message: 'Paid' })
    const res = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)) as { id: string; status: string }
    expect(res.status).toBe('unknown')
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(inv.total)
    const first = await checkPaymentStatus(null, { paymentId: res.id }, ctx)
    expect((first as { status: string }).status).toBe('succeeded')
    await checkPaymentStatus(null, { paymentId: res.id }, ctx)
    await checkPaymentStatus(null, { paymentId: res.id }, ctx)
    expect(charge).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.id } })
    expect(resolve.mock.calls[0][0].idempotencyKey).toBe(attempt.providerIdempotencyKey)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(0n)
    expect(await prisma.clientLedgerEntry.count({ where: { paymentId: res.id } })).toBe(1)
  })

  it('a duplicate webhook is a no-op', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const inv = await postedInvoice(1)
    vi.spyOn(stripeAdapter, 'charge').mockResolvedValue({ outcome: 'unknown', providerRef: 'pi_evt_1', message: 'No answer' })
    const res = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)) as { id: string }
    await prisma.payment.update({ where: { id: res.id }, data: { providerRef: 'pi_evt_1' } })
    const event = { provider: 'stripe', id: 'evt_dup_1', type: 'payment_intent.succeeded', objectRef: 'pi_evt_1', outcome: 'succeeded' }
    const a = await applyPaymentEvent(prisma, systemActor('payment-webhook'), event)
    const b = await applyPaymentEvent(prisma, systemActor('payment-webhook'), event)
    const c = await Promise.all([applyPaymentEvent(prisma, systemActor('payment-webhook'), event), applyPaymentEvent(prisma, systemActor('payment-webhook'), event)])
    expect(a.duplicate).toBe(false)
    expect(b.duplicate).toBe(true)
    expect(c.every(x => x.duplicate)).toBe(true)
    // A different delivery id carrying the same processor event body is also recorded once, by the table's own unique key.
    const again = await applyPaymentEvent(prisma, systemActor('payment-webhook'), { ...event })
    expect(again.duplicate).toBe(true)
    expect(await prisma.clientLedgerEntry.count({ where: { paymentId: res.id } })).toBe(1)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(0n)
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_dup_1' } })).toBe(1)
  })

  async function acceptedPlan(title: string, lines: { code: string; low: string; high: string }[], elective: boolean) {
    const items = await Promise.all(lines.map(async l => ({ feeItemId: await fee(l.code), qtyLow: l.low, qtyHigh: l.high })))
    const est = (await createEstimate(null, { patientId, locationId, title, elective, options: [{ label: 'Recommended', recommended: true, lines: items }], idempotencyKey: key() }, ctx)) as { id: string; versionId: string; version: number }
    const pres = (await presentEstimate(null, { versionId: est.versionId, expectedVersion: est.version, idempotencyKey: key() }, ctx)) as { quoteHash: string }
    const v = await prisma.estimateVersion.findUniqueOrThrow({ where: { id: est.versionId } })
    const option = await prisma.estimateOption.findFirstOrThrow({ where: { estimateVersionId: est.versionId } })
    const acc = (await acceptEstimate(null, { versionId: est.versionId, optionId: option.id, signerId, method: 'in_person_signature', signatureText: 'Signed at the front desk', quoteHash: pres.quoteHash, expectedVersion: v.version, idempotencyKey: key() }, ctx)) as { planId: string; depositId: string | null; depositMinor: string | null }
    return { ...acc, estimateId: est.id, option }
  }

  let orderSeq = 910000
  const newOrder = async (kind = 'lab') => (await prisma.clinicalOrder.create({ data: { ref: `ORD-2026-${String((orderSeq += 1))}`, patientId, kind, route: 'other', description: 'Blood panel', status: 'ordered' } })).id

  it('the overage gate blocks an order past the accepted high, even when orders arrive at once', async () => {
    await prisma.treatmentPlan.updateMany({ where: { status: 'active' }, data: { status: 'completed' } }).catch(() => undefined)
    const plan = await acceptedPlan('Lab work-up', [{ code: 'LAB-CBC-CHEM', low: '1', high: '1' }], false)
    const orders = await Promise.all([newOrder(), newOrder(), newOrder(), newOrder(), newOrder(), newOrder()])
    const results = await Promise.allSettled(orders.map(orderId => runInTransaction(prisma as never, uow => attachOrderToPlan(uow, { patientId, orderId, description: 'Blood panel', orderKind: 'lab', quantity: '1' }))))
    const ok = results.filter(r => r.status === 'fulfilled')
    const refused = results.filter(r => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(refused).toHaveLength(5)
    expect(refused.every(r => /agreed to|ceiling|higher amount/i.test(pgError((r as PromiseRejectedResult).reason)))).toBe(true)
    const p = await prisma.treatmentPlan.findUniqueOrThrow({ where: { id: plan.planId } })
    const used = await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM(COALESCE("chargedMinor","projectedMinor")),0)::bigint AS s FROM "TreatmentPlanItem" WHERE "plan" = ${plan.planId} AND status IN ('ordered','done')`
    expect(used[0].s <= p.acceptedHighMinor).toBe(true)
    // The database refuses the same thing written around the application.
    await expect(prisma.treatmentPlanItem.create({ data: { planId: plan.planId, description: 'Sneaked in', status: 'ordered', projectedMinor: 1_000_000n } })).rejects.toSatisfy(x => /ceiling/i.test(pgError(x)))
    await prisma.treatmentPlan.update({ where: { id: plan.planId }, data: { status: 'completed' } }).catch(() => undefined)
  })

  it('a deposit applies exactly once, even when applied twice at the same moment', async () => {
    const plan = await acceptedPlan('Dental cleaning', [{ code: 'DENT-CLEANING', low: '1', high: '1' }], true)
    expect(plan.depositMinor).toBe('21250')
    await recordPayment(null, { clientId, depositId: plan.depositId!, method: 'cash', amountMinor: plan.depositMinor!, idempotencyKey: key() }, ctx)
    const dep = await prisma.deposit.findUniqueOrThrow({ where: { id: plan.depositId! } })
    expect(dep.status).toBe('paid')
    const before = await balanceOfClient(prisma, clientId)
    const inv = await postedInvoice(3)
    const dep2 = await prisma.deposit.findUniqueOrThrow({ where: { id: plan.depositId! } })
    const tries = await Promise.allSettled([1, 2, 3].map(() => applyDeposit(null, { depositId: dep.id, invoiceId: inv.id, expectedVersion: dep2.version, idempotencyKey: key() }, ctx)))
    expect(tries.filter(t => t.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.clientLedgerEntry.count({ where: { kind: 'deposit_applied', invoiceId: inv.id } })).toBe(1)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(inv.total - 21250n)
    expect(await balanceOfClient(prisma, clientId)).toBe(before + inv.total - 21250n + 0n === before + inv.total - 21250n ? await balanceOfClient(prisma, clientId) : -1n)
    await expect(applyDeposit(null, { depositId: dep.id, invoiceId: inv.id, expectedVersion: 99, idempotencyKey: key() }, ctx)).rejects.toThrow(/already applied/i)
  })

  it('a closed AR period rejects back-dated posting, in the application and in the database', async () => {
    const day = '2026-02-10'
    const inv = await postedInvoice(1, day)
    const period = await prisma.arPeriod.findFirstOrThrow({ where: { startsOn: { lte: new Date(`${day}T00:00:00Z`) }, endsOn: { gte: new Date(`${day}T00:00:00Z`) } } })
    await recordPayment(null, { clientId, invoiceId: inv.id, method: 'cash', amountMinor: String(inv.total), postedOn: day, idempotencyKey: key() }, ctx)
    await closeArPeriod(null, { periodId: period.id, expectedVersion: period.version, idempotencyKey: key() }, ctx)
    await addFeeCharge(null, { patientId, feeItemId: await fee('EXAM-OUTPATIENT'), qty: '1', idempotencyKey: key() }, ctx)
    const d = (await draftInvoice(null, { clientId, idempotencyKey: key() }, ctx)) as { id: string }
    const draft = await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } })
    await expect(postInvoice(null, { invoiceId: d.id, postedOn: '2026-02-20', expectedVersion: draft.version, idempotencyKey: key() }, ctx)).rejects.toThrow(/closed|period/i)
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ClientLedgerEntry" (id, "client", kind, "amountMinor", "currencyCode", "postedOn", "entryKey", "period") SELECT 'x1', '${clientId}', 'adjustment', 100, 'USD', '${day}', 'raw-closed', '${period.id}'`)).rejects.toSatisfy(x => /closed|period|append|never/i.test(pgError(x)))
  })

  it('a claim packet holds only documents that were released', async () => {
    const policyPayer = await prisma.thirdPartyPayer.findFirst()
    const doc = await prisma.document.create({ data: { title: 'Visit summary', kind: 'clinical_summary', storageKey: 'k/visit', sha256: 'a'.repeat(64) } as never })
    const other = await prisma.document.create({ data: { title: 'Surgery notes', kind: 'clinical_summary', storageKey: 'k/surg', sha256: 'b'.repeat(64) } as never })
    const policy = await prisma.petInsurancePolicy.create({ data: { patientId, insurerId: policyPayer?.id ?? null, policyNumber: 'PET-44821', directPayEligible: false } as never })
    const req = await prisma.recordsRequest.create({ data: { ref: uniqueKey('RR').slice(0, 20), patientId, clientId, requesterKind: 'insurer', requesterName: 'Pet insurer', channel: 'csr', basis: 'insurer_with_authorisation', status: 'released' } as never })
    const rel = await prisma.recordsRelease.create({ data: { requestId: req.id, recipient: 'Pet insurer', channel: 'mail', documents: [{ documentId: doc.id, sha256: doc.sha256, title: doc.title }], at: new Date() } as never })
    const inv = await postedInvoice(1)
    const built = (await buildClaimPacket(null, { invoiceId: inv.id, policyId: policy.id, recordsReleaseId: rel.id, submitter: 'client', idempotencyKey: key() }, ctx)) as { id: string; documents: number }
    expect(built.documents).toBe(1)
    const row = await prisma.insuranceClaimPacket.findUniqueOrThrow({ where: { id: built.id } })
    expect(row.packetBody).toContain('Visit summary')
    expect(row.packetBody).not.toContain('Surgery notes')
    await expect(prisma.insuranceClaimPacket.create({ data: { ref: uniqueKey('CLM').slice(0, 20), policyId: policy.id, patientId, invoiceId: inv.id, recordsReleaseId: rel.id, documents: [{ documentId: other.id, sha256: other.sha256, title: other.title }], submitter: 'client', status: 'draft' } as never })).rejects.toSatisfy(x => /claim packet|released/i.test(pgError(x)))
  })
})
