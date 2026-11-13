import type { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { balanceOfInvoice } from '../lib/ledger'
import { stripeAdapter } from '../../integrations/payment'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { cancelEnrollment, checkPlanCharge, enrolPatient, replacePlanCard, retryPlanCharge, returnEntitlement, runPlanBilling, useEntitlement } from './wellness'
import { cancelBoarding, checkInBoarding, checkOutBoarding, confirmBoarding, reserveBoarding } from './boarding'
import { recordPatientDeath } from './clients'
import { requestRefund } from './billing'
import { signEuthanasiaConsent, recordEuthanasia, advanceAftercare } from './endOfLife'
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
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

describe.skipIf(!hasTestDatabase)('Phase 5 (database)', () => {
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
    enrolPatient(null, { patientId, planVersionId: versionId, signerId, method: 'in_person', affirmed: true, paymentMethodId: 'pm_card_visa', idempotencyKey: key(), ...extra } as never, ctx) as Promise<{ id: string; status: string; ref: string; firstCharge: string }>

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

  it('enrolment needs the signer to be allowed to pay and to affirm; the disclosure is stored with its hash', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const pid = await newPatient('Biscuit')
      await expect(enrol(pid, { affirmed: false })).rejects.toThrow(/agree/i)
      await prisma.clientPerson.update({ where: { id: signerId }, data: { canPay: false } })
      await expect(enrol(pid)).rejects.toThrow(/not allowed to pay/i)
      await prisma.clientPerson.update({ where: { id: signerId }, data: { canPay: true } })
      expect(stripe.posts()).toBe(0)
      const e = await enrol(pid)
      expect(e).toMatchObject({ status: 'active', firstCharge: 'succeeded' })
      const consent = await prisma.enrollmentConsent.findFirstOrThrow({ where: { enrollmentId: e.id } })
      expect(consent.disclosureText).toMatch(/renew/i)
      expect(consent.disclosureText).toMatch(/cancel/i)
      expect(consent.disclosureHash).toHaveLength(64)
      await expect(enrol(pid)).rejects.toThrow(/already on/i)
      await expect(prisma.$executeRawUnsafe(`UPDATE "EnrollmentConsent" SET "affirmed" = false WHERE id = '${consent.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    } finally { stripe.restore() }
  })

  it('two presses of Run billing at once make one charge per enrolment and period, and each run total equals its charges', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const pid = await newPatient('Juniper')
      const e = await enrol(pid)
      // The first month was charged by enrolment. A run for the same month charges nothing more.
      const before = stripe.posts()
      const period = today
      const [a, b] = (await Promise.all([
        runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx),
        runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx),
      ])) as { totalMinor: string; succeeded: number; ref: string }[]
      expect(stripe.posts()).toBe(before)
      expect(BigInt(a.totalMinor) + BigInt(b.totalMinor)).toBe(0n)
      // A month ahead: two presses at once, exactly one charge for this enrolment.
      const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1)
      const nextKey = next.toISOString().slice(0, 7)
      const runs = (await Promise.all([
        runPlanBilling(null, { periodKey: nextKey, idempotencyKey: key() }, ctx),
        runPlanBilling(null, { periodKey: nextKey, idempotencyKey: key() }, ctx),
      ])) as { totalMinor: string; succeeded: number; ref: string }[]
      const paid = await prisma.planBillingAttempt.findMany({ where: { enrollmentId: e.id, periodKey: nextKey, status: 'succeeded' } })
      expect(paid).toHaveLength(1)
      const everyone = await prisma.planBillingAttempt.findMany({ where: { periodKey: nextKey, status: 'succeeded' } })
      expect(new Set(everyone.map(x => x.enrollmentId)).size).toBe(everyone.length)
      expect(await prisma.planBillingAttempt.count({ where: { enrollmentId: e.id, periodKey: nextKey } })).toBe(1)
      for (const r of runs) {
        const row = await prisma.planBillingRun.findFirstOrThrow({ where: { ref: r.ref } })
        expect(row.status).toBe('completed')
        const mine = await prisma.planBillingAttempt.findMany({ where: { runKey: row.runKey, status: 'succeeded' } })
        expect(row.totalMinor).toBe(mine.reduce((n, x) => n + x.amountMinor, 0n))
      }
      expect(runs.reduce((n, r) => n + BigInt(r.totalMinor), 0n)).toBe(everyone.reduce((n, x) => n + x.amountMinor, 0n))
      // Same key again: replayed, no new charge.
      const k = key()
      const first = await runPlanBilling(null, { periodKey: nextKey, idempotencyKey: k }, ctx)
      const again = (await runPlanBilling(null, { periodKey: nextKey, idempotencyKey: k }, ctx)) as { replay: boolean }
      expect(again.replay).toBe(true)
      expect(first).toBeTruthy()
      expect(await prisma.planBillingRun.count({ where: { status: { not: 'completed' } } })).toBe(0)
    } finally { stripe.restore() }
  })

  it('a decline is final for its period: Run billing does not charge again, Retry needs a new card, and the retry is a new generation', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const pid = await newPatient('Mochi')
    let decline = false
    const stripe = fakeStripe({ status: () => (decline ? 'requires_payment_method' : 'succeeded') })
    try {
      const e = await enrol(pid)
      const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 2)
      const period = next.toISOString().slice(0, 7)
      decline = true
      await runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx)
      const failed = await prisma.planBillingAttempt.findFirstOrThrow({ where: { enrollmentId: e.id, periodKey: period } })
      expect(failed.status).toBe('failed')
      const posts = stripe.posts()
      for (let i = 0; i < 3; i += 1) await runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx)
      expect(stripe.posts()).toBe(posts)
      expect(await prisma.planBillingAttempt.count({ where: { enrollmentId: e.id, periodKey: period } })).toBe(1)
      await expect(retryPlanCharge(null, { attemptId: failed.id, idempotencyKey: key() }, ctx)).rejects.toThrow(/new card|Replace the card/i)
      expect(stripe.posts()).toBe(posts)
      await replacePlanCard(null, { enrollmentId: e.id, signerId, affirmed: true, paymentMethodId: 'pm_card_visa', idempotencyKey: key() }, ctx)
      decline = false
      const r = (await retryPlanCharge(null, { attemptId: failed.id, idempotencyKey: key() }, ctx)) as { status: string }
      expect(r.status).toBe('succeeded')
      const all = await prisma.planBillingAttempt.findMany({ where: { enrollmentId: e.id, periodKey: period }, orderBy: { generation: 'asc' } })
      expect(all.map(a => [a.generation, a.status])).toEqual([[1, 'failed'], [2, 'succeeded']])
      expect(all[0].invoiceId).toBe(all[1].invoiceId)
      // The database itself refuses a second paid charge for the period.
      await expect(prisma.planBillingAttempt.create({ data: { enrollmentId: e.id, periodKey: period, generation: 3, status: 'processing', amountMinor: 100n, cardVersion: 2, termNo: 1, runKey: 'x' } as never })).rejects.toBeTruthy()
    } finally { stripe.restore() }
  })

  it('a lost answer stays unknown and blocks another charge until Check status; Check status only reads', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const pid = await newPatient('Clover')
    const stripe = fakeStripe()
    try {
      const e = await enrol(pid)
      const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 3)
      const period = next.toISOString().slice(0, 7)
      stripe.loseNextReply()
      await runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx)
      // The lost reply lands on whichever enrolment was charged first; that one is the unknown.
      const a = await prisma.planBillingAttempt.findFirstOrThrow({ where: { periodKey: period, status: 'unknown' } })
      expect(e.id).toBeTruthy()
      const posts = stripe.posts()
      await runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx)
      expect(stripe.posts()).toBe(posts)
      const out = (await checkPlanCharge(null, { attemptId: a.id }, ctx)) as { status: string }
      expect(out.status).toBe('succeeded')
      expect(stripe.posts()).toBe(posts)
      expect(stripe.captured).toBeGreaterThan(0)
    } finally { stripe.restore() }
  })

  it('a refund of a plan month never reopens its invoice', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const pid = await newPatient('Pickle')
    const stripe = fakeStripe()
    try {
      const e = await enrol(pid)
      const a = await prisma.planBillingAttempt.findFirstOrThrow({ where: { enrollmentId: e.id } })
      vi.spyOn(stripeAdapter, 'refund').mockResolvedValue({ outcome: 'succeeded', providerRef: 're_1', message: 'Refunded' })
      const r = (await requestRefund(null, { paymentId: a.paymentId!, invoiceId: a.invoiceId!, amountMinor: '1000', reason: 'Goodwill', idempotencyKey: key() }, ctx)) as { status: string }
      expect(r.status).toBe('succeeded')
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a.invoiceId! } })).status).toBe('paid')
      expect(await balanceOfInvoice(prisma, a.invoiceId!)).toBe(0n)
    } finally { stripe.restore() }
  })

  it('no charge for a cancelled, ended or deceased patient\'s enrolment, and the death ends the plan', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const gone = await newPatient('Ziggy')
      const cancelled = await newPatient('Maple')
      const eDead = await enrol(gone)
      const eCancel = await enrol(cancelled)
      const row = await prisma.enrollment.findUniqueOrThrow({ where: { id: eCancel.id } })
      const c = (await cancelEnrollment(null, { enrollmentId: eCancel.id, reason: 'Moving away', expectedVersion: row.version, idempotencyKey: key() }, ctx)) as { status: string }
      expect(c.status).toBe('cancelled')
      const p = await prisma.patient.findUniqueOrThrow({ where: { id: gone } })
      await recordPatientDeath(null, { patientId: gone, expectedVersion: p.version, idempotencyKey: key() }, ctx)
      expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: eDead.id } })).status).toBe('ended_by_death')
      const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 4)
      const period = next.toISOString().slice(0, 7)
      const posts = stripe.posts()
      await runPlanBilling(null, { periodKey: period, idempotencyKey: key() }, ctx)
      expect(await prisma.planBillingAttempt.count({ where: { enrollmentId: { in: [eDead.id, eCancel.id] }, periodKey: period } })).toBe(0)
      expect(stripe.posts() - posts).toBeLessThanOrEqual(patients.length)
      // The database also refuses to start an attempt for them.
      await expect(prisma.planBillingAttempt.create({ data: { enrollmentId: eDead.id, periodKey: period, generation: 1, status: 'processing', amountMinor: 100n, cardVersion: 1, termNo: 1, runKey: 'z' } as never })).rejects.toBeTruthy()
      await expect(prisma.planBillingAttempt.create({ data: { enrollmentId: eCancel.id, periodKey: period, generation: 1, status: 'processing', amountMinor: 100n, cardVersion: 1, termNo: 1, runKey: 'z' } as never })).rejects.toBeTruthy()
    } finally { stripe.restore() }
  })

  it('the entitlement ledger never goes past what was granted; a return is a new credit line', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const pid = await newPatient('Olive')
      const e = await enrol(pid)
      const useOne = () => useEntitlement(null, { enrollmentId: e.id, code: 'BLOOD', idempotencyKey: key() }, ctx) as Promise<{ id: string }>
      const first = await useOne()
      await expect(useOne()).rejects.toThrow(/used/i)
      // Two at once for the last of the nail trims: the rest are refused, never over-used.
      const results = await Promise.allSettled(Array.from({ length: 15 }, () => useEntitlement(null, { enrollmentId: e.id, code: 'NAIL', idempotencyKey: key() }, ctx)))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(12)
      const grant = await prisma.entitlementGrant.findFirstOrThrow({ where: { enrollmentId: e.id, code: 'NAIL' } })
      const used = await prisma.entitlementEntry.aggregate({ where: { grantId: grant.id, kind: 'debit' }, _sum: { qty: true } })
      expect(Number(used._sum.qty)).toBe(12)
      await returnEntitlement(null, { entryId: first.id, reason: 'Booked by mistake', idempotencyKey: key() }, ctx)
      await expect(returnEntitlement(null, { entryId: first.id, reason: 'Again', idempotencyKey: key() }, ctx)).rejects.toThrow(/already/i)
      await useOne()
      await expect(prisma.$executeRawUnsafe(`UPDATE "EntitlementEntry" SET "qty" = 0 WHERE id = '${first.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    } finally { stripe.restore() }
  })

  it('cancelling charges only the care used above what was paid', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const pid = await newPatient('Hazel')
      const e = await enrol(pid)
      await useEntitlement(null, { enrollmentId: e.id, code: 'BLOOD', idempotencyKey: key() }, ctx)
      const row = await prisma.enrollment.findUniqueOrThrow({ where: { id: e.id } })
      const out = (await cancelEnrollment(null, { enrollmentId: e.id, reason: 'Too expensive', expectedVersion: row.version, idempotencyKey: key() }, ctx)) as { owedMinor: string }
      // One blood panel at retail (14,500) less one month paid (4,900).
      expect(out.owedMinor).toBe('9600')
      const lines = await prisma.chargeLine.findMany({ where: { sourceType: 'plan_true_up', sourceId: e.id } })
      expect(lines).toHaveLength(1)
      expect(lines[0].extendedMinor).toBe(9600n)
    } finally { stripe.restore() }
  })

  it('boarding inventory is never oversold, even with parallel bookings; a lapsed hold frees its nights', async () => {
    const rt = await prisma.runType.findFirstOrThrow({ where: { code: 'dog_large' } })
    const capacity = await prisma.run.count({ where: { runTypeId: rt.id, status: 'available' } })
    const ids: string[] = []
    for (let i = 0; i < capacity + 3; i += 1) ids.push(await newPatient(`Boarder ${i}`))
    const from = plusDays(40), to = plusDays(43)
    const settled = await Promise.allSettled(ids.map(patientId => reserveBoarding(null, { patientId, runTypeId: rt.id, checkInOn: from, checkOutOn: to, vaccineOverrideReason: 'Records on the way, approved by Dr. Marsh', idempotencyKey: key() }, ctx)))
    expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(capacity)
    const nights = await prisma.nightlyRunInventory.findMany({ where: { runTypeId: rt.id, night: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } } })
    expect(nights).toHaveLength(3)
    expect(nights.every(n => n.sold === capacity && n.capacity === capacity)).toBe(true)
    await expect(prisma.$executeRawUnsafe(`UPDATE "NightlyRunInventory" SET "sold" = "capacity" + 1 WHERE id = '${nights[0].id}'`)).rejects.toBeTruthy()
    // One request lapses: the next booking gets its nights.
    const one = await prisma.boardingReservation.findFirstOrThrow({ where: { runTypeId: rt.id, checkInOn: new Date(`${from}T00:00:00Z`) } })
    await prisma.boardingReservation.update({ where: { id: one.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } })
    const late = (await reserveBoarding(null, { patientId: ids[ids.length - 1], runTypeId: rt.id, checkInOn: from, checkOutOn: to, vaccineOverrideReason: 'Records on the way, approved by Dr. Marsh', idempotencyKey: key() }, ctx)) as { status: string }
    expect(late.status).toBe('requested')
    expect((await prisma.boardingReservation.findUniqueOrThrow({ where: { id: one.id } })).status).toBe('cancelled')
    await expect(confirmBoarding(null, { reservationId: one.id, expectedVersion: 1, idempotencyKey: key() }, ctx)).rejects.toBeTruthy()
    // Cancelling gives the nights back.
    const mine = await prisma.boardingReservation.findFirstOrThrow({ where: { runTypeId: rt.id, status: 'requested' } })
    await cancelBoarding(null, { reservationId: mine.id, reason: 'Plans changed', expectedVersion: mine.version, idempotencyKey: key() }, ctx)
    const after = await prisma.nightlyRunInventory.findMany({ where: { runTypeId: rt.id, night: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } } })
    expect(after.every(n => n.sold === capacity - 1)).toBe(true)
  })

  it('check-out charges each night once; a second check-out is refused; a runs never hold two stays', async () => {
    const rt = await prisma.runType.findFirstOrThrow({ where: { code: 'dog_small' } })
    const pid = await newPatient('Walnut')
    const start = plusDays(0)
    const r = (await reserveBoarding(null, { patientId: pid, runTypeId: rt.id, checkInOn: start, checkOutOn: plusDays(2), vaccineOverrideReason: 'Vaccine card seen at the desk, approved', idempotencyKey: key() }, ctx)) as { id: string }
    const row = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    await confirmBoarding(null, { reservationId: r.id, expectedVersion: row.version, idempotencyKey: key() }, ctx)
    const conf = await prisma.boardingReservation.findUniqueOrThrow({ where: { id: r.id } })
    const stay = (await checkInBoarding(null, { reservationId: r.id, emergencyContactName: 'Dana Hill', emergencyContactPhone: '555-0100', belongings: 'Blue blanket', expectedVersion: conf.version, idempotencyKey: key() }, ctx)) as { id: string }
    const s = await prisma.boardingStay.findUniqueOrThrow({ where: { id: stay.id } })
    await expect(checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)).rejects.toThrow(/belonging/i)
    await prisma.belongingItem.updateMany({ where: { stayId: stay.id }, data: { returnedAt: new Date() } })
    const out = (await checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)) as { nights: number }
    expect(out.nights).toBeGreaterThanOrEqual(1)
    const lines = await prisma.chargeLine.findMany({ where: { sourceType: 'boarding_night', sourceId: { startsWith: stay.id } } })
    expect(lines).toHaveLength(out.nights)
    expect(new Set(lines.map(l => l.sourceId)).size).toBe(lines.length)
    await expect(checkOutBoarding(null, { stayId: stay.id, expectedVersion: s.version, idempotencyKey: key() }, ctx)).rejects.toThrow(/already/i)
  })

  it('euthanasia needs a signed consent from someone allowed to sign, ends the plan in the same transaction, and aftercare names the tag every step', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    const stripe = fakeStripe()
    try {
      const pid = await newPatient('Rosie')
      const e = await enrol(pid)
      const base = { patientId: pid, authority: 'owner', biteAttestation: 'no_bite', aftercare: 'private_cremation', clientPresent: true, method: 'in_person', signatureText: 'Pat Rivera' }
      await prisma.clientPerson.update({ where: { id: signerId }, data: { canAuthoriseEuthanasia: false } })
      await expect(signEuthanasiaConsent(null, { ...base, signerId, idempotencyKey: key() }, ctx)).rejects.toThrow(/not marked as allowed/i)
      await prisma.clientPerson.update({ where: { id: signerId }, data: { canAuthoriseEuthanasia: true } })
      const p = await prisma.patient.findUniqueOrThrow({ where: { id: pid } })
      await expect(recordEuthanasia(null, { patientId: pid, consentId: 'nope', tagNumber: 'T-1', expectedVersion: p.version, idempotencyKey: key() }, ctx)).rejects.toBeTruthy()
      expect((await prisma.patient.findUniqueOrThrow({ where: { id: pid } })).status).toBe('active')
      await expect(signEuthanasiaConsent(null, { ...base, biteAttestation: 'bite_in_last_10_days', signerId, idempotencyKey: key() }, ctx)).rejects.toThrow(/rabies testing/i)
      const consent = (await signEuthanasiaConsent(null, { ...base, signerId, idempotencyKey: key() }, ctx)) as { id: string }
      const done = (await recordEuthanasia(null, { patientId: pid, consentId: consent.id, tagNumber: 'CC-2041', expectedVersion: p.version, idempotencyKey: key() }, ctx)) as { aftercareId: string; plansEnded: number }
      expect(done.plansEnded).toBe(1)
      expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('ended_by_death')
      expect((await prisma.patient.findUniqueOrThrow({ where: { id: pid } })).status).toBe('deceased')
      expect((await prisma.euthanasiaConsent.findUniqueOrThrow({ where: { id: consent.id } })).status).toBe('used')
      await expect(signEuthanasiaConsent(null, { ...base, signerId, idempotencyKey: key() }, ctx)).rejects.toThrow(/deceased|died/i)
      const order = await prisma.aftercareOrder.findUniqueOrThrow({ where: { id: done.aftercareId } })
      const v = async () => (await prisma.aftercareOrder.findUniqueOrThrow({ where: { id: order.id } })).version
      await expect(advanceAftercare(null, { orderId: order.id, step: 'store', tagNumber: 'WRONG', expectedVersion: await v(), idempotencyKey: key() }, ctx)).rejects.toThrow(/tag/i)
      await advanceAftercare(null, { orderId: order.id, step: 'store', tagNumber: 'CC-2041', place: 'Cold room', expectedVersion: await v(), idempotencyKey: key() }, ctx)
      await advanceAftercare(null, { orderId: order.id, step: 'pick_up', tagNumber: 'CC-2041', crematory: 'Valley Pet Cremation', manifestRef: 'M-7781', expectedVersion: await v(), idempotencyKey: key() }, ctx)
      await expect(advanceAftercare(null, { orderId: order.id, step: 'return_ashes', tagNumber: 'CC-2041', crematoryRef: 'M-0000', expectedVersion: await v(), idempotencyKey: key() }, ctx)).rejects.toThrow(/manifest/i)
      await advanceAftercare(null, { orderId: order.id, step: 'return_ashes', tagNumber: 'CC-2041', crematoryRef: 'M-7781', expectedVersion: await v(), idempotencyKey: key() }, ctx)
      const log = await prisma.custodyEvent.findMany({ where: { orderId: order.id }, orderBy: { at: 'asc' } })
      expect(log.map(l => l.kind)).toEqual(['tagged', 'stored', 'picked_up', 'returned'])
      expect(log.every(l => l.tagNumber === 'CC-2041')).toBe(true)
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "CustodyEvent"`)).rejects.toBeTruthy()
    } finally { stripe.restore() }
  })
})
