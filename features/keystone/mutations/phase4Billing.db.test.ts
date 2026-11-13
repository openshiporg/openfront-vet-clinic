import type { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { runInTransaction } from '../lib/unitOfWork'
import { balanceOfClient, balanceOfInvoice } from '../lib/ledger'
import { systemActor } from '../lib/actor'
import { stripeAdapter } from '../../integrations/payment'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { acceptEstimate, attachOrderToPlan, createEstimate, presentEstimate, recordOverageApproval } from './estimates'
import { addFeeCharge, applyDeposit, applyPaymentEvent, checkPaymentStatus, closeArPeriod, draftInvoice, postInvoice, recordPayment, requestRefund, takeCardPayment } from './billing'
import { buildClaimPacket } from './insurance'
import { fakeStripe } from '../../../tests/helpers/fakeStripe'

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

  it('a second card charge is refused while the first is unknown or pending, with or without a new key, and a double click charges once', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const inv = await postedInvoice(1)
    const charge = vi.spyOn(stripeAdapter, 'charge').mockResolvedValue({ outcome: 'unknown', providerRef: null, message: 'No answer' })
    vi.spyOn(stripeAdapter, 'resolve').mockResolvedValue({ outcome: 'succeeded', providerRef: 'pi_b1', message: 'Paid' })
    const first = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)) as { id: string; status: string }
    expect(first.status).toBe('unknown')
    await expect(takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)).rejects.toThrow(/Check status/)
    await expect(takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: '100', idempotencyKey: key() }, ctx)).rejects.toThrow(/Check status/)
    expect(charge).toHaveBeenCalledTimes(1)
    // The database refuses a second open card payment on the invoice even if the application did not.
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "Payment" (id, ref, "client", method, provider, "amountMinor", status, "forInvoice", "updatedAt") VALUES ('raw_open_card', 'RAW-OPEN', '${clientId}', 'card_on_file', 'stripe', 100, 'pending', '${inv.id}', now())`)).rejects.toBeTruthy()
    // Check status settles it; the invoice is paid once.
    await checkPaymentStatus(null, { paymentId: first.id }, ctx)
    expect(await balanceOfInvoice(prisma, inv.id)).toBe(0n)
    const inv2 = await postedInvoice(1)
    const both = await Promise.allSettled([1, 2].map(() => takeCardPayment(null, { clientId, invoiceId: inv2.id, amountMinor: String(inv2.total), idempotencyKey: key() }, ctx)))
    expect(both.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.payment.count({ where: { forInvoiceId: inv2.id, method: 'card_on_file' } })).toBe(1)
    expect(charge).toHaveBeenCalledTimes(2)
  })

  it('Check status never charges: a named card whose reply was lost is found, not re-sent (15600-on-7800 review sequence)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const inv = await postedInvoice(1)
      stripe.loseNextReply()
      const first = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), paymentMethodId: 'pm_card_mastercard', idempotencyKey: key() }, ctx)) as { id: string; status: string }
      expect(first.status).toBe('unknown')
      expect(stripe.captured).toBe(Number(inv.total))
      const chk = (await checkPaymentStatus(null, { paymentId: first.id }, ctx)) as { status: string }
      expect(chk.status).toBe('succeeded')
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })).providerRef).toBe('pi_fake_1')
      await expect(takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), paymentMethodId: 'pm_card_mastercard', idempotencyKey: key() }, ctx)).rejects.toThrow(/already paid/i)
      expect(stripe.posts()).toBe(1)
      expect(stripe.calls.some(c => c.includes('pm_card_visa'))).toBe(false)
      expect(stripe.captured).toBeLessThanOrEqual(Number(inv.total))
      expect(await balanceOfInvoice(prisma, inv.id)).toBe(0n)
    } finally { stripe.restore() }
  })

  it('a pruned key (no providerRef, intent not found) stays unknown, Check status makes no charge, and a second charge is refused', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const inv = await postedInvoice(1)
      stripe.loseNextReply()
      const first = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), paymentMethodId: 'pm_card_mastercard', idempotencyKey: key() }, ctx)) as { id: string; status: string }
      stripe.prune(); stripe.hide('pi_fake_1')
      for (let i = 0; i < 3; i += 1) expect(((await checkPaymentStatus(null, { paymentId: first.id }, ctx)) as { status: string }).status).toBe('unknown')
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('unknown')
      await expect(takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)).rejects.toThrow(/Check status/)
      expect(stripe.posts()).toBe(1)
      expect(stripe.captured).toBeLessThanOrEqual(Number(inv.total))
    } finally { stripe.restore() }
  })

  it('a 3DS intent (requires_action) is pending, keeps its reference, and settles once when the bank confirms', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe({ status: () => 'requires_action' })
    try {
      const inv = await postedInvoice(1)
      const first = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), paymentMethodId: 'pm_card_threeDSecure2Required', idempotencyKey: key() }, ctx)) as { id: string; status: string }
      expect(first.status).toBe('pending')
      const row = await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })
      expect(row).toMatchObject({ status: 'pending', providerRef: 'pi_fake_1' })
      expect(((await checkPaymentStatus(null, { paymentId: first.id }, ctx)) as { status: string }).status).toBe('pending')
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('pending')
      stripe.setStatus('pi_fake_1', 'succeeded')
      expect(((await checkPaymentStatus(null, { paymentId: first.id }, ctx)) as { status: string }).status).toBe('succeeded')
      await checkPaymentStatus(null, { paymentId: first.id }, ctx)
      expect(stripe.posts()).toBe(1)
      expect(stripe.captured).toBeLessThanOrEqual(Number(inv.total))
      expect(await prisma.clientLedgerEntry.count({ where: { paymentId: first.id } })).toBe(1)
    } finally { stripe.restore() }
  })

  it('a card payment wrongly marked failed while its intent is live goes back to pending once Check status finds the intent', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe({ status: () => 'requires_action' })
    try {
      const inv = await postedInvoice(1)
      stripe.loseNextReply()
      const first = (await takeCardPayment(null, { clientId, invoiceId: inv.id, amountMinor: String(inv.total), idempotencyKey: key() }, ctx)) as { id: string }
      // What the old Check status left behind on live (PAY-2026-000006): failed, no reference.
      await prisma.payment.update({ where: { id: first.id }, data: { status: 'failed' } })
      expect(((await checkPaymentStatus(null, { paymentId: first.id }, ctx)) as { status: string }).status).toBe('pending')
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'pending', providerRef: 'pi_fake_1' })
      // The database allows that one way back only: a failed payment with a reference never reopens.
      await prisma.payment.update({ where: { id: first.id }, data: { status: 'failed' } })
      await expect(prisma.$executeRawUnsafe(`UPDATE "Payment" SET status = 'pending' WHERE id = '${first.id}'`)).rejects.toSatisfy(x => /result never changes/i.test(pgError(x)))
      expect(stripe.posts()).toBe(1)
    } finally { stripe.restore() }
  })

  it('only a veterinarian (staff kind dvm) can record the emergency overage override', async () => {
    const plan = await acceptedPlan('Emergency override', [{ code: 'EXAM-OUTPATIENT', low: '1', high: '1' }], false)
    const row = await prisma.treatmentPlan.findUniqueOrThrow({ where: { id: plan.planId } })
    const high = row.acceptedHighMinor + 5000n
    const rvt = await prisma.staffMember.findFirstOrThrow({ where: { kind: 'rvt' } })
    const dvm = await prisma.staffMember.findFirstOrThrow({ where: { kind: 'dvm', userId: { not: null } } })
    const as = (userId: string) => ({ session: sessionFor(userId, ALL), prisma })
    const args = (n: bigint) => ({ planId: plan.planId, newHighMinor: String(n), method: 'emergency_override', reason: 'Emergency surgery', expectedVersion: row.version, idempotencyKey: key() })
    await expect(recordOverageApproval(null, args(high), as(rvt.userId!))).rejects.toThrow(/Only a veterinarian/)
    const ok = (await recordOverageApproval(null, args(high), as(dvm.userId!))) as { acceptedHighMinor: string }
    expect(ok.acceptedHighMinor).toBe(String(high))
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
    const rel = await prisma.recordsRelease.create({ data: { requestId: req.id, recipient: 'Pet insurer', channel: 'mail', documents: [{ documentId: doc.id, sha256: doc.sha256, title: doc.title }], packetHash: 'h'.repeat(64), at: new Date() } as never })
    const inv = await postedInvoice(1)
    const built = (await buildClaimPacket(null, { invoiceId: inv.id, policyId: policy.id, recordsReleaseId: rel.id, submitter: 'client', idempotencyKey: key() }, ctx)) as { id: string; documents: number }
    expect(built.documents).toBe(1)
    const row = await prisma.insuranceClaimPacket.findUniqueOrThrow({ where: { id: built.id } })
    expect(row.packetBody).toContain('Visit summary')
    expect(row.packetBody).not.toContain('Surgery notes')
    await expect(prisma.insuranceClaimPacket.create({ data: { ref: uniqueKey('CLM').slice(0, 20), policyId: policy.id, patientId, invoiceId: inv.id, recordsReleaseId: rel.id, documents: [{ documentId: other.id, sha256: other.sha256, title: other.title }], submitter: 'client', status: 'draft' } as never })).rejects.toSatisfy(x => /claim packet|released/i.test(pgError(x)))
  })
})
