import type { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { balanceOfInvoice } from '../lib/ledger'
import { stripeAdapter } from '../../integrations/payment'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { cancelEnrollment, enrolPatient, replacePlanCard, retryPlanCharge, runPlanBilling } from './wellness'
import { checkInBoarding, checkOutBoarding, confirmBoarding, reserveBoarding } from './boarding'
import { recordPatientDeath } from './clients'
import { checkRefundStatus, recordPayment, requestRefund } from './billing'
import { addManualReminder } from './vaccines'
import { serviceItemCharge } from './serviceCharge'
import { command } from '../lib/command'
import { fakeStripe } from '../../../tests/helpers/fakeStripe'

/** Phase 5 exit gate against a real database: plan billing, boarding inventory, the entitlement ledger and the death. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const key = () => uniqueKey('k')
const pgError = (e: unknown) => String((e as Error)?.message ?? e)
const today = new Date().toISOString().slice(0, 7)
// The clinic's calendar day (not UTC's): after about 4 pm Pacific the UTC date is already tomorrow, and a stay cannot check in before its start.
const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const plusDays = (n: number) => new Date(new Date(`${clinicToday()}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

describe.skipIf(!hasTestDatabase)('Phase 5 r1 fixes (database)', () => {
  let prisma: PrismaClient
  let ctx: { session: unknown; prisma: PrismaClient }
  let clientId = ''
  let signerId = ''
  let locationId = ''
  let versionId = ''
  const patients: string[] = []
  let serial = 0

  /** A fresh adult dog owned by the test client, so each test has its own patient. */
  async function newPatient(name: string) {
    const base = await prisma.patient.findFirstOrThrow({ where: { status: 'active', species: { code: 'canine' } } })
    const { id: _id, ref: _ref, ...rest } = base as Record<string, unknown>
    const p = await prisma.patient.create({ data: { ...(rest as object), ref: `P-${String(900000 + (serial += 1))}`, name, dateOfBirth: new Date('2022-03-01T00:00:00Z'), version: 1, microchips: undefined, ownerships: undefined } as never })
    await prisma.patientOwnership.create({ data: { patientId: p.id, clientId, role: 'primary', basis: 'registration', effectiveFrom: new Date('2024-01-01T00:00:00Z') } as never })
    patients.push(p.id)
    return p.id
  }
  const enrol = (patientId: string, extra: Record<string, unknown> = {}) =>
    enrolPatient(null, { patientId, planVersionId: versionId, signerId, method: 'in_person', affirmed: true, idempotencyKey: key(), ...extra } as never, ctx) as Promise<{ id: string; status: string; ref: string; firstCharge: string }>

  beforeAll(async () => {
    prisma = testPrisma(10)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    ctx = { session: sessionFor('seed_user_marsh', ALL), prisma }
    const own = await prisma.patientOwnership.findFirstOrThrow({ where: { effectiveTo: null, role: 'primary' } })
    clientId = own.clientId!
    signerId = (await prisma.clientPerson.findFirstOrThrow({ where: { clientId } })).id
    await prisma.clientPerson.update({ where: { id: signerId }, data: { canPay: true, canAuthoriseEuthanasia: true } })
    locationId = (await prisma.location.findFirstOrThrow()).id
    versionId = (await prisma.wellnessPlanVersion.findFirstOrThrow({ where: { plan: { code: 'ADULT' }, status: 'published' } })).id
  }, 1_700_000)
  afterAll(async () => { await prisma?.$disconnect() })
  afterEach(() => { vi.restoreAllMocks(); delete process.env.STRIPE_SECRET_KEY })

  const nextMonth = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }

  it('B1/B2: a declined first month is never charged again, by any later month, in the database too; cancelling credits its invoice out', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe({ status: () => 'requires_payment_method' })
    try {
      const pid = await newPatient('Declined Dee')
      const e = await enrol(pid)
      expect(e.status).toBe('pending_payment')
      const attempts = () => prisma.planBillingAttempt.findMany({ where: { enrollmentId: e.id }, orderBy: [{ periodKey: 'asc' }, { generation: 'asc' }] })
      const first = (await attempts())[0]
      expect(first.status).toBe('failed')
      const invoicesBefore = await prisma.invoice.count({ where: { clientId } })
      const posts = stripe.posts()
      for (const m of [0, 1, 2, 3]) await runPlanBilling(null, { periodKey: nextMonth(m), idempotencyKey: key() }, ctx)
      expect(stripe.posts()).toBe(posts)
      expect(await attempts()).toHaveLength(1)
      expect(await prisma.invoice.count({ where: { clientId } })).toBe(invoicesBefore)
      // The database refuses a new automatic attempt for any month; a retry carries its authorisation.
      const bare = (periodKey: string, generation: number, retryNote = '') => prisma.planBillingAttempt.create({ data: { enrollmentId: e.id, periodKey, generation, status: 'processing', amountMinor: 4900n, cardVersion: 1, termNo: 1, runKey: 'x', startedAt: new Date(), retryNote } as never })
      await expect(bare(nextMonth(2), 1)).rejects.toSatisfy(x => /declined/i.test(pgError(x)))
      await expect(bare(first.periodKey, 2)).rejects.toSatisfy(x => /declined/i.test(pgError(x)))
      // P5 r2 backlog (a): a note alone is not enough. The same card (version 1) is refused even with a retry note; a replaced card (version 2) with a note passes.
      await expect(bare(first.periodKey, 2, 'Client says it is fine now')).rejects.toSatisfy(x => /declined|card/i.test(pgError(x)))
      await expect(prisma.planBillingAttempt.create({ data: { enrollmentId: e.id, periodKey: first.periodKey, generation: 2, status: 'processing', amountMinor: 4900n, cardVersion: 2, termNo: 1, runKey: 'y', startedAt: new Date(), retryNote: 'New card on file' } as never })).resolves.toBeTruthy()
      await prisma.planBillingAttempt.updateMany({ where: { enrollmentId: e.id, generation: 2 }, data: { status: 'failed' } })
      // Cancel: the open invoice is credited out, history untouched.
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: first.invoiceId! } })
      expect(inv.status).toBe('posted')
      const row = await prisma.enrollment.findUniqueOrThrow({ where: { id: e.id } })
      const out = (await cancelEnrollment(null, { enrollmentId: e.id, reason: 'Card kept declining', expectedVersion: row.version, idempotencyKey: key() }, ctx)) as { invoicesCredited: number }
      expect(out.invoicesCredited).toBe(1)
      expect(await balanceOfInvoice(prisma as never, inv.id)).toBe(0n)
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('paid')
      expect(await prisma.creditNote.count({ where: { invoiceId: inv.id } })).toBe(1)
      expect((await prisma.chargeLine.findMany({ where: { invoiceId: inv.id } })).length).toBe(1)
    } finally { stripe.restore() }
  })

  it('B1: Retry after a new card still works (authorised generation) and then later months charge normally', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    let decline = true
    const stripe = fakeStripe({ status: () => (decline ? 'requires_payment_method' : 'succeeded') })
    try {
      const pid = await newPatient('Retry Rosa')
      const e = await enrol(pid)
      const failed = await prisma.planBillingAttempt.findFirstOrThrow({ where: { enrollmentId: e.id } })
      await replacePlanCard(null, { enrollmentId: e.id, signerId, affirmed: true, idempotencyKey: key() }, ctx)
      decline = false
      const r = (await retryPlanCharge(null, { attemptId: failed.id, idempotencyKey: key() }, ctx)) as { status: string }
      expect(r.status).toBe('succeeded')
      expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('active')
      await runPlanBilling(null, { periodKey: nextMonth(1), idempotencyKey: key() }, ctx)
      expect((await prisma.planBillingAttempt.findFirstOrThrow({ where: { enrollmentId: e.id, periodKey: nextMonth(1) } })).status).toBe('succeeded')
    } finally { stripe.restore() }
  })

  it('M2: an active member gets the other-services discount once; a non-member pays list', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const member = await newPatient('Member Max')
      const plain = await newPatient('Plain Pat')
      await enrol(member)
      const charge = async (patientId: string, tag: string) => {
        const done = await command(prisma, { name: `test.groom.${tag}`, actor: { kind: 'user', userId: 'seed_user_marsh' } as never, idempotencyKey: key(), params: {} }, async uow =>
          serviceItemCharge(uow, { kind: 'user', userId: 'seed_user_marsh' } as never, 'GROOM-BATH_BRUSH', { patientId, clientId, locationId, sourceType: 'groom', sourceId: `${tag}:${key()}` }))
        return prisma.chargeLine.findUniqueOrThrow({ where: { id: (done.value as { id: string }).id } })
      }
      const a = await charge(member, 'm'), b = await charge(plain, 'p')
      expect(b.discountMinor).toBe(0n)
      expect(a.extendedMinor).toBe(b.extendedMinor)
      expect(a.discountMinor).toBe((a.extendedMinor * 1000n + 5000n) / 10000n)
      expect(a.discountMinor).toBeGreaterThan(0n)
    } finally { stripe.restore() }
  })

  it('M3: a death records for a pet with a live reminder, and the reminder says why it was suppressed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const pid = await newPatient('Koda')
    const type = await prisma.reminderType.findFirstOrThrow()
    const rem = (await addManualReminder(null, { patientId: pid, typeId: type.id, dueOn: plusDays(30), idempotencyKey: key() }, ctx)) as { id?: string }
    expect(await prisma.patientReminder.count({ where: { patientId: pid, status: { in: ['scheduled', 'due', 'overdue'] } } })).toBeGreaterThan(0)
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: pid } })
    await recordPatientDeath(null, { patientId: pid, expectedVersion: p.version, idempotencyKey: key() }, ctx)
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: pid } })).status).toBe('deceased')
    const rows = await prisma.patientReminder.findMany({ where: { patientId: pid } })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.status === 'suppressed' && r.suppressedReason.length > 0)).toBe(true)
    void rem
  })

  it('M4: check-out makes one invoice for nights x rate, less the paid deposit, and a second check-out makes no second', async () => {
    const rt = await prisma.runType.findFirstOrThrow({ where: { code: 'dog_small' } })
    await prisma.runType.update({ where: { id: rt.id }, data: { depositMinor: 5000n } })
    const pid = await newPatient('Boarder Bo')
    const r = (await reserveBoarding(null, { patientId: pid, runTypeId: rt.id, checkInOn: plusDays(0), checkOutOn: plusDays(2), vaccineOverrideReason: 'Vaccine card seen at the desk, approved', idempotencyKey: key() }, ctx)) as { id: string }
    const dep = await prisma.deposit.findFirstOrThrow({ where: { reservationId: r.id } })
    expect(dep.requestedMinor).toBe(5000n)
    await recordPayment(null, { clientId, depositId: dep.id, method: 'cash', amountMinor: '5000', idempotencyKey: key() }, ctx)
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe('paid')
    const row = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    await confirmBoarding(null, { reservationId: r.id, expectedVersion: row.version, idempotencyKey: key() }, ctx)
    const conf = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    const stay = (await checkInBoarding(null, { reservationId: r.id, emergencyContactName: 'Dana Hill', emergencyContactPhone: '555-0100', expectedVersion: conf.version, idempotencyKey: key() }, ctx)) as { id: string }
    const s = await prisma.boardingStay.findUniqueOrThrow({ where: { id: stay.id } })
    const out = (await checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)) as { invoiceId: string; nights: number; totalMinor: string; depositAppliedMinor: string }
    const lines = await prisma.chargeLine.findMany({ where: { invoiceId: out.invoiceId } })
    expect(lines).toHaveLength(out.nights)
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: out.invoiceId } })
    expect(inv.totalMinor).toBe(lines.reduce((n, l) => n + l.extendedMinor - l.discountMinor + l.taxMinor, 0n))
    expect(inv.totalMinor).toBe(BigInt(out.totalMinor))
    const applied = BigInt(out.depositAppliedMinor)
    expect(applied).toBe(inv.totalMinor < 5000n ? inv.totalMinor : 5000n)
    expect(await balanceOfInvoice(prisma as never, inv.id)).toBe(inv.totalMinor - applied)
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe('applied')
    expect((await prisma.boardingStay.findUniqueOrThrow({ where: { id: stay.id } })).invoiceId).toBe(out.invoiceId)
    await expect(checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)).rejects.toThrow(/already/i)
    expect(await prisma.invoice.count({ where: { id: out.invoiceId } })).toBe(1)
  })

  it('refund: more than is still refundable is refused before the processor; a ledger refusal after the request ends the refund failed, never processing', async () => {
    const rt = await prisma.runType.findFirstOrThrow({ where: { code: 'dog_small' } })
    await prisma.runType.update({ where: { id: rt.id }, data: { depositMinor: 5000n } })
    const pid = await newPatient('Refund Ray')
    const r = (await reserveBoarding(null, { patientId: pid, runTypeId: rt.id, checkInOn: plusDays(0), checkOutOn: plusDays(2), vaccineOverrideReason: 'Vaccine card seen at the desk, approved', idempotencyKey: key() }, ctx)) as { id: string }
    const dep = await prisma.deposit.findFirstOrThrow({ where: { reservationId: r.id } })
    await recordPayment(null, { clientId, depositId: dep.id, method: 'cash', amountMinor: '5000', idempotencyKey: key() }, ctx)
    const paid = await prisma.deposit.findUniqueOrThrow({ where: { id: dep.id } })
    const row = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    await confirmBoarding(null, { reservationId: r.id, expectedVersion: row.version, idempotencyKey: key() }, ctx)
    const conf = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    const stay = (await checkInBoarding(null, { reservationId: r.id, emergencyContactName: 'Dana Hill', emergencyContactPhone: '555-0100', expectedVersion: conf.version, idempotencyKey: key() }, ctx)) as { id: string }
    const s = await prisma.boardingStay.findUniqueOrThrow({ where: { id: stay.id } })
    const out = (await checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)) as { depositAppliedMinor: string }
    const applied = BigInt(out.depositAppliedMinor)
    expect(applied).toBeGreaterThan(0n)
    const left = 5000n - applied
    const before = await prisma.refund.count({ where: { paymentId: paid.paymentId! } })
    await expect(requestRefund(null, { paymentId: paid.paymentId!, amountMinor: '5000', reason: 'Too much', idempotencyKey: key() }, ctx)).rejects.toThrow(/can still be refunded/i)
    expect(await prisma.refund.count({ where: { paymentId: paid.paymentId! } })).toBe(before)
    // A request that got past the check (made by hand here) is refused by the books when it settles: it ends failed.
    const bad = await prisma.refund.create({ data: { ref: `REF-T-${Date.now()}`, paymentId: paid.paymentId!, amountMinor: 5000n, currencyCode: 'USD', reason: 'forced', status: 'processing', providerIdempotencyKey: `t-${key()}` } as never })
    const res = (await checkRefundStatus(null, { refundId: bad.id, idempotencyKey: key() }, ctx)) as { status: string; message: string }
    expect(res.status).toBe('failed')
    expect(res.message).toMatch(/books refused|go below zero/i)
    const end = await prisma.refund.findUniqueOrThrow({ where: { id: bad.id } })
    expect(end.status).toBe('failed')
    expect(end.message).toMatch(/refused/i)
    if (left > 0n) {
      const ok = (await requestRefund(null, { paymentId: paid.paymentId!, amountMinor: left.toString(), reason: 'Balance returned', idempotencyKey: key() }, ctx)) as { status: string }
      expect(ok.status).toBe('succeeded')
      await expect(requestRefund(null, { paymentId: paid.paymentId!, amountMinor: '1', reason: 'Again', idempotencyKey: key() }, ctx)).rejects.toThrow(/can still be refunded/i)
    }
  })
})
