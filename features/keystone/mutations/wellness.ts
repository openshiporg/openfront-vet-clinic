import { randomUUID } from 'node:crypto'
import { command } from '../lib/command'
import { auditCreate, casUpdate, lockRow, transition } from '../lib/cas'
import { advisoryLock } from '../lib/db'
import { DomainError, Codes, isDomainError } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { periodFor, post } from '../lib/ledger'
import { localDate } from '../lib/calendar'
import { resolvePolicy } from '../domain/policy'
import { addMonths, ageOn, disclosureHash, disclosureText, parseEntitlements, PERIOD, periodLabel, termMonthsOf, monthOf } from '../domain/wellness'
import { adapterFor, cardConfigured, saveCard } from '../../integrations/payment'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { dateOnly, minorText, pick } from './billingInput'
import { locationDay, staffOf, text, type Ctx } from './clinical'
import { newPayment, recordOutcome } from './billing'
import { resolveUnknownPayment } from './billing'

/*
 * Wellness plans (BUILD-PLAN P5, STATE-MACHINES §12). Money rules, all enforced twice (here and in the database):
 *  - one charge per enrolment and period: the attempt row is unique on (enrolment, period, generation) and an index allows
 *    only one attempt per period that is processing, unknown or paid, so two presses at once cannot both charge;
 *  - a decline is final for its key; Retry is a staff action that needs a card newer than the one that was declined;
 *  - a refund never reopens a plan invoice (billing.ts keeps it paid with an offsetting entry);
 *  - nothing is charged for an enrolment that is cancelled, ended, completed or suspended, or for a patient who has died;
 *  - "Run billing" finishes inside the request. There is no schedule, no lease, no queue.
 */

const MANAGE = ['canTakePayments', 'canManagePayments'] as const
const PERIOD_TERM = (a: { termStartsOn: Date; termEndsOn: Date }) => termMonthsOf(a.termStartsOn.toISOString().slice(0, 10), a.termEndsOn.toISOString().slice(0, 10))
const ZERO = 0n
const day = (d: Date) => d.toISOString().slice(0, 10)
const asDate = (s: string) => new Date(`${s}T00:00:00Z`)

// ── The catalogue ───────────────────────────────────────────────────────────────────────────

/** Add a plan, or a new version of an existing one. A version is published at once and frozen; later changes make version N+1. */
export async function savePlanVersion(_root: unknown, args: { code: string; name: string; summary?: string | null; label: string; monthlyPriceMinor: string; termMonths: number; speciesCodes?: string[] | null; minAgeWeeks?: number | null; maxAgeMonths?: number | null; entitlements: unknown; otherServicesDiscountBps?: number | null; trueUpNote?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePractice'], tool: 'wellness.save_plan', humanOnly: true }, args, async actor => {
    const code = text(args.code, 'code', 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    if (!code) throw new DomainError(Codes.INVALID_INPUT, 'The plan code uses letters and numbers.', { field: 'code' })
    const price = minorText(args.monthlyPriceMinor, 'monthly price')
    if (!Number.isInteger(args.termMonths) || args.termMonths < 1 || args.termMonths > 24) throw new DomainError(Codes.INVALID_INPUT, 'A term is 1 to 24 months.', { field: 'termMonths' })
    const entitlements = parseEntitlements(args.entitlements)
    if (!entitlements.length) throw new DomainError(Codes.INVALID_INPUT, 'List what the plan includes.', { field: 'entitlements' })
    const bps = args.otherServicesDiscountBps ?? 0
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new DomainError(Codes.INVALID_INPUT, 'The discount is 0 to 100 percent.', { field: 'otherServicesDiscountBps' })
    const result = await command(context.prisma, { name: 'wellness.save_plan', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await advisoryLock(uow.tx, `wellness-plan:${code}`)
      const plan = (await uow.tx.wellnessPlan.findUnique({ where: { code } })) ?? (await uow.tx.wellnessPlan.create({ data: { code, name: text(args.name, 'name', 80), summary: text(args.summary ?? '', 'summary', 300, false), status: 'active' } }))
      const last = await uow.tx.wellnessPlanVersion.findFirst({ where: { planId: plan.id }, orderBy: { versionNo: 'desc' }, select: { id: true, versionNo: true } })
      if (last) await uow.tx.wellnessPlanVersion.updateMany({ where: { planId: plan.id, status: 'published' }, data: { status: 'retired' } })
      const version = await uow.tx.wellnessPlanVersion.create({
        data: {
          planId: plan.id, versionNo: (last?.versionNo ?? 0) + 1, label: text(args.label, 'label', 80), status: 'published', monthlyPriceMinor: price, termMonths: args.termMonths,
          speciesCodes: args.speciesCodes?.length ? args.speciesCodes : undefined, minAgeWeeks: args.minAgeWeeks ?? null, maxAgeMonths: args.maxAgeMonths ?? null,
          entitlements: entitlements.map(e => ({ code: e.code, label: e.label, qty: e.qty, retailValueMinor: e.retailValueMinor.toString() })), otherServicesDiscountBps: bps,
          trueUpNote: text(args.trueUpNote ?? '', 'true-up note', 300, false), disclosure: '', publishedAt: uow.now,
        },
      })
      auditCreate(uow, actor, 'WellnessPlanVersion', version.id, 'wellness.plan_published', { code, versionNo: version.versionNo, monthlyPriceMinor: price.toString() })
      return { id: version.id, planId: plan.id, versionNo: version.versionNo }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Enrolment ───────────────────────────────────────────────────────────────────────────────

async function grantsFor(uow: UnitOfWork, enrollmentId: string, termNo: number, entitlements: unknown) {
  for (const e of parseEntitlements(entitlements)) {
    await uow.tx.entitlementGrant.create({ data: { enrollmentId, termNo, code: e.code, label: e.label, qtyGranted: e.qty, retailValueMinor: e.retailValueMinor * BigInt(e.qty) } })
  }
}

/**
 * Enrol a patient. The person signing must be allowed to pay for the client; they see and agree to the auto-renewal disclosure
 * (stored word for word with its hash); the card is saved with a SetupIntent so it can be charged later without them present.
 * The first month is charged in the same press.
 */
export async function enrolPatient(_root: unknown, args: { patientId: string; planVersionId: string; signerId: string; method: string; affirmed: boolean; paymentMethodId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.enrol', humanOnly: true }, args, async actor => {
    const method = pick(args.method, ['in_person', 'portal', 'phone_recorded'] as const, 'consent method')
    if (args.affirmed !== true) throw new DomainError(Codes.CONSENT_REQUIRED, 'The client must agree to the monthly charges and automatic renewal before a card is saved.', { field: 'affirmed' })
    if (!cardConfigured()) throw new DomainError(Codes.FEATURE_DISABLED, 'Card payments are not set up on this server, so a plan cannot be started.', { reason: 'no_processor' })
    // Read-only checks first, so a bad request never reaches the card processor.
    const ctx = await context.prisma.$transaction(async (tx: any) => {
      const patient = await tx.patient.findUnique({ where: { id: args.patientId }, select: { id: true, name: true, status: true, dateOfBirth: true, species: { select: { code: true } } } })
      if (!patient) throw new DomainError(Codes.NOT_FOUND, 'Patient not found.')
      if (patient.status === 'deceased') throw new DomainError(Codes.PATIENT_DECEASED, 'This patient has died. A plan cannot be started.')
      if (patient.status !== 'active') throw new DomainError(Codes.GUARD_FAILED, `The patient is ${patient.status}; confirm the registration first.`)
      const version = await tx.wellnessPlanVersion.findUnique({ where: { id: args.planVersionId }, include: { plan: true } })
      if (!version || version.status !== 'published' || version.plan?.status !== 'active') throw new DomainError(Codes.GUARD_FAILED, 'That plan is not open for new enrolments.')
      const own = await tx.patientOwnership.findFirst({ where: { patientId: patient.id, effectiveTo: null, role: 'primary' }, select: { clientId: true } })
      if (!own?.clientId) throw new DomainError(Codes.GUARD_FAILED, 'This patient has no client of record to bill.')
      const signer = await tx.clientPerson.findUnique({ where: { id: args.signerId }, select: { id: true, clientId: true, canPay: true, firstName: true, lastName: true, contactPoints: { where: { kind: 'email' }, select: { value: true }, take: 1 } } })
      if (!signer || signer.clientId !== own.clientId) throw new DomainError(Codes.NOT_FOUND, 'That person is not on this client.', { field: 'signerId' })
      if (!signer.canPay) throw new DomainError(Codes.CONSENT_REQUIRED, `${signer.firstName} ${signer.lastName} is not allowed to pay for this client.`, { field: 'signerId' })
      const species = version.speciesCodes as string[] | null
      if (species?.length && !species.includes(patient.species?.code ?? '')) throw new DomainError(Codes.GUARD_FAILED, `${version.plan.name} is not offered for this species.`)
      return { patientName: patient.name as string, clientId: own.clientId as string, signerName: `${signer.firstName} ${signer.lastName}`.trim(), signerEmail: (signer.contactPoints?.[0]?.value as string | undefined) ?? '' }
    })
    const card = await saveCard({ idempotencyKey: `${args.idempotencyKey}:card`, name: ctx.signerName, email: ctx.signerEmail || undefined, paymentMethod: args.paymentMethodId || undefined, metadata: { client: ctx.clientId } })
    if (!card.ok) throw new DomainError(Codes.GUARD_FAILED, card.message, { reason: 'card_not_saved' })
    const made = await command(context.prisma, { name: 'wellness.enrol', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const patient = await lockRow<{ id: string; status: string; deceasedAt: Date | null; dateOfBirth: Date | null; speciesId: string }>(uow.tx, 'Patient', args.patientId)
      if (patient.status !== 'active' || patient.deceasedAt) throw new DomainError(Codes.PATIENT_DECEASED, 'This patient cannot be enrolled.')
      const version = await uow.tx.wellnessPlanVersion.findUniqueOrThrow({ where: { id: args.planVersionId }, include: { plan: true } })
      const client = await uow.tx.client.findUniqueOrThrow({ where: { id: ctx.clientId }, select: { primaryLocationId: true } })
      const locationId = client.primaryLocationId ?? (await uow.tx.location.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true } })).id
      const { on, location } = await locationDay(uow, locationId, uow.now)
      const age = ageOn(patient.dateOfBirth, on)
      if (version.minAgeWeeks && age && age.weeks < version.minAgeWeeks) throw new DomainError(Codes.GUARD_FAILED, `${version.plan!.name} starts at ${version.minAgeWeeks} weeks of age.`)
      if (version.maxAgeMonths && age && age.months > version.maxAgeMonths) throw new DomainError(Codes.GUARD_FAILED, `${version.plan!.name} is for patients up to ${version.maxAgeMonths} months old.`)
      const live = await uow.tx.enrollment.findFirst({ where: { patientId: patient.id, planId: version.planId, status: { in: ['pending_payment', 'active', 'cancelling', 'suspended'] } }, select: { ref: true } })
      if (live) throw new DomainError(Codes.GUARD_FAILED, `This patient is already on ${version.plan!.name} (${live.ref}).`)
      const policy = await resolvePolicy(uow.tx, 'auto_renewal', { locationId, on })
      const practice = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { displayName: true } })
      const disclosure = disclosureText({ planName: version.plan!.name, monthlyPriceMinor: version.monthlyPriceMinor, termMonths: version.termMonths, renewalNoticeDays: policy.rules.renewalNoticeDays, practiceName: practice?.displayName || location.name, cancelNote: version.trueUpNote || undefined })
      const termEnds = addMonths(on, version.termMonths)
      const ref = await nextReference(uow.tx, 'WEL', uow.now)
      const enrollment = await uow.tx.enrollment.create({
        data: {
          ref, patientId: patient.id, clientId: ctx.clientId, locationId, planId: version.planId, planVersionId: version.id, status: 'pending_payment', startedOn: asDate(on), termNo: 1, termStartsOn: asDate(on), termEndsOn: asDate(termEnds),
          autoRenew: true, cardLabel: card.label, customerRef: card.customer, paymentMethodRef: card.paymentMethod, cardVersion: 1,
        },
      })
      const consent = await uow.tx.enrollmentConsent.create({
        data: { enrollmentId: enrollment.id, signerId: args.signerId, disclosureText: disclosure, disclosureHash: disclosureHash(disclosure), terms: { monthlyPriceMinor: version.monthlyPriceMinor.toString(), termMonths: version.termMonths, renewalNoticeDays: policy.rules.renewalNoticeDays, policy: 'US-CA/auto_renewal' }, method, affirmed: true, setupIntentRef: card.setupIntent, consentedAt: uow.now },
      })
      await uow.tx.enrollment.update({ where: { id: enrollment.id }, data: { consentId: consent.id } })
      await grantsFor(uow, enrollment.id, 1, version.entitlements)
      auditCreate(uow, actor, 'Enrollment', enrollment.id, 'wellness.enrolled', { ref, planVersionId: version.id, cardLabel: card.label, disclosureHash: disclosureHash(disclosure) })
      return { id: enrollment.id, ref, periodKey: monthOf(on) }
    })
    if (made.replay) return { replay: true, ...made.value, status: (await context.prisma.enrollment.findUnique({ where: { id: made.value.id }, select: { status: true } }))?.status }
    const charge = await chargeEnrollment(context.prisma, actor, { enrollmentId: made.value.id, periodKey: made.value.periodKey, runKey: args.idempotencyKey })
    const status = (await context.prisma.enrollment.findUnique({ where: { id: made.value.id }, select: { status: true } }))?.status
    return { replay: false, ...made.value, status, firstCharge: charge.status, message: charge.message }
  })
}

// ── Charging one enrolment for one period ───────────────────────────────────────────────────

type ChargeOutcome = { status: 'succeeded' | 'failed' | 'unknown' | 'skipped'; attemptId?: string; message: string; amountMinor?: string }

/**
 * Step 1 commits the attempt, the invoice and a pending card payment (under a lock on the enrolment). Step 2 calls the processor
 * with no transaction open and an idempotency key. Step 3 records the answer. A lost answer leaves the attempt `unknown`, which
 * blocks any other attempt for the period until staff press "Check status".
 */
export async function chargeEnrollment(prisma: any, actor: Actor, input: { enrollmentId: string; periodKey: string; runKey: string; retryOfAttemptId?: string }): Promise<ChargeOutcome> {
  const stem = `${input.runKey}:${input.enrollmentId}:${input.periodKey}`
  let started
  try {
    started = await command(prisma, { name: 'wellness.charge.start', actor, idempotencyKey: `${stem}:start`, params: input }, async uow => {
      await advisoryLock(uow.tx, `enrollment:${input.enrollmentId}`)
      let e = await lockRow<any>(uow.tx, 'Enrollment', input.enrollmentId)
      if (!['pending_payment', 'active'].includes(e.status)) return { skip: `The plan is ${e.status.replaceAll('_', ' ')}.` }
      const patient = await uow.tx.patient.findUniqueOrThrow({ where: { id: e.patientId }, select: { deceasedAt: true, status: true } })
      if (patient.deceasedAt || patient.status === 'deceased') return { skip: 'The patient has died.' }
      const prior = await uow.tx.planBillingAttempt.findMany({ where: { enrollmentId: e.id, periodKey: input.periodKey }, orderBy: { generation: 'asc' } })
      const live = prior.find(a => ['succeeded', 'processing', 'unknown'].includes(a.status))
      if (live) return { skip: live.status === 'succeeded' ? 'This month is already paid.' : 'The card processor has not given a final answer for this month. Check its status first.' }
      const lastFailed = prior[prior.length - 1]
      if (lastFailed && !input.retryOfAttemptId) return { skip: 'The card was declined. Replace the card, then use Retry.' }
      if (input.retryOfAttemptId) {
        if (!lastFailed || lastFailed.id !== input.retryOfAttemptId || lastFailed.status !== 'failed') return { skip: 'Only the latest declined charge can be retried.' }
        if (e.cardVersion <= (lastFailed.cardVersion ?? 0)) throw new DomainError(Codes.GUARD_FAILED, 'Replace the card on file first. A declined charge is only retried with a new card.', { reason: 'same_card' })
      }
      let months = PERIOD_TERM(e)
      if (!months.includes(input.periodKey)) {
        const lastMonth = months[months.length - 1]
        if (input.periodKey < months[0]) return { skip: 'This month is before the plan started.' }
        if (input.periodKey !== monthOf(addMonths(`${lastMonth}-01`, 1)) || e.status !== 'active' || !e.autoRenew) return { skip: 'This month is outside the plan term.' }
        // A new term begins: the plan renews at the price of the version the client agreed to.
        const version = await uow.tx.wellnessPlanVersion.findUniqueOrThrow({ where: { id: e.planVersionId } })
        const startsOn = day(e.termEndsOn)
        await uow.tx.enrollment.update({ where: { id: e.id }, data: { termNo: e.termNo + 1, termStartsOn: asDate(startsOn), termEndsOn: asDate(addMonths(startsOn, version.termMonths)), version: { increment: 1 } } })
        await grantsFor(uow, e.id, e.termNo + 1, version.entitlements)
        auditCreate(uow, actor, 'Enrollment', e.id, 'wellness.renewed', { termNo: e.termNo + 1 })
        e = await lockRow<any>(uow.tx, 'Enrollment', input.enrollmentId)
        months = PERIOD_TERM(e)
      }
      const version = await uow.tx.wellnessPlanVersion.findUniqueOrThrow({ where: { id: e.planVersionId }, include: { plan: true } })
      const amount = version.monthlyPriceMinor
      if (!e.customerRef || !e.paymentMethodRef) return { skip: 'There is no card on file.' }
      const generation = prior.length + 1
      const attempt = await uow.tx.planBillingAttempt.create({ data: { enrollmentId: e.id, periodKey: input.periodKey, generation, status: 'processing', amountMinor: amount, cardVersion: e.cardVersion, termNo: e.termNo, runKey: input.runKey, startedAt: uow.now } })
      const { on } = await locationDay(uow, e.locationId, uow.now)
      // The invoice for the month is made once (generation 1) and reused by a retry, so a month is never billed twice.
      let invoiceId = prior.find(a => a.invoiceId)?.invoiceId ?? null
      if (!invoiceId) {
        const description = `${version.plan!.name}: ${periodLabel(input.periodKey)}`
        const draft = await uow.tx.invoice.create({ data: { ref: `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`, clientId: e.clientId, locationId: e.locationId, status: 'draft', currencyCode: 'USD', note: '' } })
        const line = await uow.tx.chargeLine.create({ data: { clientId: e.clientId, patientId: e.patientId, locationId: e.locationId, invoiceId: draft.id, description, qty: '1', unitPriceMinor: amount, extendedMinor: amount, discountMinor: ZERO, taxMinor: ZERO, taxCategory: 'professional_service', sourceType: 'plan_period', sourceId: `${e.id}:${input.periodKey}`, capturedAt: uow.now } })
        const period = await periodFor(uow.tx, on)
        const ref = await nextReference(uow.tx, 'INV', uow.now)
        await transition(uow, { model: 'Invoice', id: draft.id, from: ['draft'], to: 'posted', actor, eventType: 'invoice.posted', data: { ref, postedAt: uow.now, postedOn: asDate(on), periodId: period.id, subtotalMinor: amount, discountMinor: ZERO, taxMinor: ZERO, totalMinor: amount }, metadata: { plan: e.ref } })
        await post(uow, { clientId: e.clientId, invoiceId: draft.id, kind: 'invoice', amountMinor: amount, currencyCode: 'USD', postedOn: on, entryKey: `invoice:${draft.id}:post`, memo: ref })
        invoiceId = draft.id
        auditCreate(uow, actor, 'ChargeLine', line.id, 'charge.captured', { source: 'plan_period', extendedMinor: amount.toString() })
      }
      const pay = await newPayment(uow, actor, { clientId: e.clientId, locationId: e.locationId, method: 'card_on_file', provider: 'stripe', amountMinor: amount, target: { invoiceId }, reference: `${e.ref} ${input.periodKey}` })
      const pa = await uow.tx.paymentAttempt.create({ data: { paymentId: pay.id, status: 'processing', providerIdempotencyKey: `vet-plan-${attempt.id}`, amountMinor: amount, startedAt: uow.now } })
      await uow.tx.planBillingAttempt.update({ where: { id: attempt.id }, data: { paymentId: pay.id, invoiceId } })
      auditCreate(uow, actor, 'PlanBillingAttempt', attempt.id, 'wellness.charge_started', { enrollment: e.ref, periodKey: input.periodKey, generation, amountMinor: amount.toString() })
      return { attemptId: attempt.id, paymentId: pay.id, paymentAttemptId: pa.id, key: pa.providerIdempotencyKey, amountMinor: amount.toString(), payRef: pay.ref, customer: e.customerRef as string, method: e.paymentMethodRef as string, enrollmentRef: e.ref as string, planName: version.plan!.name }
    })
  } catch (error) {
    if (isDomainError(error) && error.code === Codes.GUARD_FAILED) return { status: 'skipped', message: error.message }
    throw error
  }
  const s = started.value as any
  if (s.skip) return { status: 'skipped', message: s.skip }
  if (started.replay) return statusOf(prisma, s.attemptId)
  const outcome = await adapterFor('stripe').charge({
    amountMinor: BigInt(s.amountMinor), currencyCode: 'USD', idempotencyKey: s.key, description: `${s.planName} ${s.enrollmentRef} ${input.periodKey}`,
    metadata: { payment: s.paymentId, enrollment: input.enrollmentId, period: input.periodKey }, paymentMethod: s.method, customer: s.customer, offSession: true,
  })
  await recordOutcome({ prisma, session: null }, actor, s.paymentId, s.paymentAttemptId, outcome, `${stem}:${s.attemptId}:result`)
  return finishAttempt(prisma, actor, s.attemptId)
}

async function statusOf(prisma: any, attemptId: string): Promise<ChargeOutcome> {
  const a = await prisma.planBillingAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { id: true, status: true, message: true, amountMinor: true } })
  return { status: a.status === 'processing' ? 'unknown' : a.status, attemptId: a.id, message: a.message || '', amountMinor: a.amountMinor.toString() }
}

/** Bring the plan attempt in line with what its card payment says now. Safe to repeat. */
export async function finishAttempt(prisma: any, actor: Actor, attemptId: string): Promise<ChargeOutcome> {
  await command(prisma, { name: 'wellness.charge.finish', actor, idempotencyKey: `finish:${attemptId}:${randomUUID()}`, params: { attemptId } }, async uow => {
    const a = await lockRow<any>(uow.tx, 'PlanBillingAttempt', attemptId)
    if (a.status === 'succeeded' || a.status === 'failed') return { unchanged: true }
    const pay = await uow.tx.payment.findUniqueOrThrow({ where: { id: a.paymentId }, select: { status: true } })
    const attempt = await uow.tx.paymentAttempt.findFirst({ where: { paymentId: a.paymentId }, orderBy: { createdAt: 'desc' }, select: { message: true } })
    const next = pay.status === 'succeeded' ? 'succeeded' : pay.status === 'failed' || pay.status === 'voided' ? 'failed' : 'unknown'
    if (next === a.status) return { unchanged: true }
    await casUpdate(uow, { model: 'PlanBillingAttempt', id: a.id, version: a.version, from: [a.status], to: next, actor, eventType: `wellness.charge_${next}`, data: { message: (attempt?.message ?? '').slice(0, 200), ...(next === 'unknown' ? {} : { finishedAt: uow.now }) } })
    if (next === 'succeeded') {
      const e = await lockRow<any>(uow.tx, 'Enrollment', a.enrollmentId)
      if (e.status === 'pending_payment') await casUpdate(uow, { model: 'Enrollment', id: e.id, version: e.version, from: ['pending_payment'], to: 'active', actor, eventType: 'wellness.activated' })
    }
    return { status: next }
  })
  return statusOf(prisma, attemptId)
}

// ── Run billing, Retry, Check status, Replace card ──────────────────────────────────────────

/**
 * The staff button. Charges every enrolment that is due for the month, once. Pressing it again (or from two screens) finds the
 * attempts already there and charges nothing twice. The run row is written when the work is done, so it is never "running".
 */
export async function runPlanBilling(_root: unknown, args: { periodKey?: string | null; locationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.run_billing', humanOnly: true }, args, async actor => {
    if (!cardConfigured()) throw new DomainError(Codes.FEATURE_DISABLED, 'Card payments are not set up on this server.', { reason: 'no_processor' })
    const location = args.locationId ? await context.prisma.location.findUnique({ where: { id: args.locationId }, select: { id: true, timeZone: true } }) : await context.prisma.location.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, timeZone: true } })
    if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
    const periodKey = args.periodKey?.trim() || monthOf(localDate({ timeZone: location.timeZone }, new Date()))
    if (!PERIOD.test(periodKey)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the month as YYYY-MM.', { field: 'periodKey' })
    const due = await context.prisma.enrollment.findMany({
      where: { status: { in: ['pending_payment', 'active'] }, patient: { deceasedAt: null, status: { not: 'deceased' } }, ...(args.locationId ? { locationId: args.locationId } : {}) },
      orderBy: { ref: 'asc' }, take: 500, select: { id: true, ref: true },
    })
    const skipped: { ref: string; reason: string }[] = []
    for (const e of due) {
      const out = await chargeEnrollment(context.prisma, actor, { enrollmentId: e.id, periodKey, runKey: args.idempotencyKey })
      if (out.status === 'skipped') skipped.push({ ref: e.ref, reason: out.message })
    }
    const done = await command(context.prisma, { name: 'wellness.run_billing', actor, idempotencyKey: `${args.idempotencyKey}:run`, params: args }, async uow => {
      const staff = await staffOf(uow, actor).catch(() => null)
      const attempts = await uow.tx.planBillingAttempt.findMany({ where: { runKey: args.idempotencyKey }, select: { status: true, amountMinor: true } })
      const succeeded = attempts.filter(a => a.status === 'succeeded')
      const total = succeeded.reduce((n, a) => n + a.amountMinor, ZERO)
      const ref = await nextReference(uow.tx, 'PBR', uow.now)
      const run = await uow.tx.planBillingRun.create({
        data: {
          ref, runKey: args.idempotencyKey, locationId: location.id, periodKey, status: 'completed', attemptCount: attempts.length, succeededCount: succeeded.length, failedCount: attempts.filter(a => a.status === 'failed').length,
          openCount: attempts.filter(a => a.status === 'unknown' || a.status === 'processing').length, skippedCount: skipped.length, totalMinor: total, summary: { skipped: skipped.slice(0, 50) }, startedById: staff?.id ?? null, finishedAt: uow.now,
        },
      })
      auditCreate(uow, actor, 'PlanBillingRun', run.id, 'wellness.run_finished', { ref, periodKey, attempts: attempts.length, totalMinor: total.toString() })
      return { id: run.id, ref, periodKey, attempts: attempts.length, succeeded: succeeded.length, failed: run.failedCount, open: run.openCount, skipped: skipped.length, totalMinor: total.toString() }
    })
    return { replay: done.replay, ...done.value }
  })
}

/** After the card was replaced: charge the declined month again, as a new generation of the same period. */
export async function retryPlanCharge(_root: unknown, args: { attemptId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.retry_charge', humanOnly: true }, args, async actor => {
    if (!cardConfigured()) throw new DomainError(Codes.FEATURE_DISABLED, 'Card payments are not set up on this server.', { reason: 'no_processor' })
    const a = await context.prisma.planBillingAttempt.findUnique({ where: { id: args.attemptId }, select: { enrollmentId: true, periodKey: true, status: true } })
    if (!a) throw new DomainError(Codes.NOT_FOUND, 'Charge not found.')
    if (a.status !== 'failed') throw new DomainError(Codes.GUARD_FAILED, 'Only a declined charge can be retried.')
    const out = await chargeEnrollment(context.prisma, actor, { enrollmentId: a.enrollmentId, periodKey: a.periodKey, runKey: args.idempotencyKey, retryOfAttemptId: args.attemptId })
    if (out.status === 'skipped') throw new DomainError(Codes.GUARD_FAILED, out.message)
    return { replay: false, id: out.attemptId, status: out.status, message: out.message }
  })
}

/** "Check status": ask the processor about a charge whose answer was lost. It only reads; it never charges. */
export async function checkPlanCharge(_root: unknown, args: { attemptId: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.check_charge', humanOnly: true }, args, async actor => {
    const a = await context.prisma.planBillingAttempt.findUnique({ where: { id: args.attemptId }, select: { id: true, paymentId: true, status: true } })
    if (!a?.paymentId) throw new DomainError(Codes.NOT_FOUND, 'Charge not found.')
    if (a.status === 'unknown' || a.status === 'processing') await resolveUnknownPayment(context.prisma, actor, a.paymentId)
    const out = await finishAttempt(context.prisma, actor, a.id)
    return { replay: false, id: a.id, status: out.status, message: out.message }
  })
}

/** Save a different card for the plan. A declined month can then be retried. */
export async function replacePlanCard(_root: unknown, args: { enrollmentId: string; signerId: string; affirmed: boolean; paymentMethodId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.replace_card', humanOnly: true }, args, async actor => {
    if (args.affirmed !== true) throw new DomainError(Codes.CONSENT_REQUIRED, 'The client must agree to the monthly charges on the new card.', { field: 'affirmed' })
    if (!cardConfigured()) throw new DomainError(Codes.FEATURE_DISABLED, 'Card payments are not set up on this server.', { reason: 'no_processor' })
    const e = await context.prisma.enrollment.findUnique({ where: { id: args.enrollmentId }, select: { id: true, clientId: true, status: true } })
    if (!e) throw new DomainError(Codes.NOT_FOUND, 'Plan not found.')
    if (!['pending_payment', 'active', 'suspended'].includes(e.status)) throw new DomainError(Codes.GUARD_FAILED, 'This plan has ended; a card cannot be added to it.')
    const signer = await context.prisma.clientPerson.findUnique({ where: { id: args.signerId }, select: { clientId: true, canPay: true, firstName: true, lastName: true, contactPoints: { where: { kind: 'email' }, select: { value: true }, take: 1 } } })
    if (!signer || signer.clientId !== e.clientId || !signer.canPay) throw new DomainError(Codes.CONSENT_REQUIRED, 'Choose a person who may pay for this client.', { field: 'signerId' })
    const card = await saveCard({ idempotencyKey: `${args.idempotencyKey}:card`, name: `${signer.firstName} ${signer.lastName}`.trim(), email: signer.contactPoints?.[0]?.value || undefined, paymentMethod: args.paymentMethodId || undefined, metadata: { client: e.clientId } })
    if (!card.ok) throw new DomainError(Codes.GUARD_FAILED, card.message, { reason: 'card_not_saved' })
    const result = await command(context.prisma, { name: 'wellness.replace_card', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await lockRow<any>(uow.tx, 'Enrollment', args.enrollmentId)
      if (!['pending_payment', 'active', 'suspended'].includes(row.status)) throw new DomainError(Codes.GUARD_FAILED, 'This plan has ended; a card cannot be added to it.')
      await uow.tx.enrollment.update({ where: { id: row.id }, data: { customerRef: card.customer, paymentMethodRef: card.paymentMethod, cardLabel: card.label, cardVersion: row.cardVersion + 1, version: { increment: 1 } } })
      auditCreate(uow, actor, 'Enrollment', row.id, 'wellness.card_replaced', { cardLabel: card.label, setupIntentSaved: true })
      return { id: row.id, cardLabel: card.label, cardVersion: row.cardVersion + 1 }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Cancellation and the entitlement ledger ─────────────────────────────────────────────────

/** What has been used, at retail price, less what has been paid. Never negative. */
export async function trueUpFor(tx: any, enrollmentId: string) {
  const entries = await tx.entitlementEntry.findMany({ where: { enrollmentId }, select: { kind: true, valueMinor: true } })
  const used = entries.reduce((n: bigint, e: { kind: string; valueMinor: bigint }) => n + (e.kind === 'debit' ? e.valueMinor : -e.valueMinor), ZERO)
  const paid = (await tx.planBillingAttempt.aggregate({ where: { enrollmentId, status: 'succeeded' }, _sum: { amountMinor: true } }))._sum.amountMinor ?? ZERO
  return { used, paid, owed: used > paid ? used - paid : ZERO }
}

/** Cancel: no more charges. If more care was used than was paid for, the difference becomes an open charge (unless waived by someone who may). */
export async function cancelEnrollment(_root: unknown, args: { enrollmentId: string; reason: string; waiveTrueUp?: boolean | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.cancel', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'wellness.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await advisoryLock(uow.tx, `enrollment:${args.enrollmentId}`)
      const e = await lockRow<any>(uow.tx, 'Enrollment', args.enrollmentId)
      if (args.waiveTrueUp === true && !(actor.kind === 'user' && (await uow.tx.user.findUnique({ where: { id: actor.userId }, select: { role: { select: { canManagePayments: true, canManagePractice: true } } } }))?.role?.canManagePayments)) {
        throw new DomainError(Codes.NOT_AUTHORIZED, 'Only someone who manages payments can waive the amount owed.')
      }
      const open = await uow.tx.planBillingAttempt.count({ where: { enrollmentId: e.id, status: { in: ['processing', 'unknown'] } } })
      if (open) throw new DomainError(Codes.GUARD_FAILED, 'A monthly charge has no final answer yet. Check its status before cancelling.', { reason: 'charge_open' })
      const { used, paid, owed } = await trueUpFor(uow.tx, e.id)
      let chargeId: string | null = null
      const waived = args.waiveTrueUp === true
      if (owed > ZERO && !waived) {
        const line = await uow.tx.chargeLine.create({ data: { clientId: e.clientId, patientId: e.patientId, locationId: e.locationId, description: `Plan cancelled: care used above what was paid (${e.ref})`, qty: '1', unitPriceMinor: owed, extendedMinor: owed, discountMinor: ZERO, taxMinor: ZERO, taxCategory: 'professional_service', sourceType: 'plan_true_up', sourceId: e.id, capturedAt: uow.now } })
        chargeId = line.id
      }
      await transition(uow, {
        model: 'Enrollment', id: e.id, from: ['pending_payment', 'active', 'suspended', 'cancelling'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'wellness.cancelled', reason,
        data: { cancelRequestedAt: uow.now, cancelReason: reason, endedAt: uow.now, autoRenew: false, trueUpMinor: waived ? ZERO : owed, trueUpWaived: waived && owed > ZERO },
      })
      return { id: e.id, status: 'cancelled', usedMinor: used.toString(), paidMinor: paid.toString(), owedMinor: (waived ? ZERO : owed).toString(), chargeId }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Use some of what the plan includes. Recorded in the append-only ledger; the database refuses going past what was granted. */
export async function useEntitlement(_root: unknown, args: { enrollmentId: string; code: string; qty?: number | null; memo?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE, 'canCheckIn', 'canWriteRecord'], tool: 'wellness.use_entitlement', humanOnly: true }, args, async actor => {
    const qty = args.qty ?? 1
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new DomainError(Codes.INVALID_INPUT, 'Use a whole number from 1 to 50.', { field: 'qty' })
    const result = await command(context.prisma, { name: 'wellness.use_entitlement', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await advisoryLock(uow.tx, `enrollment:${args.enrollmentId}`)
      const e = await lockRow<any>(uow.tx, 'Enrollment', args.enrollmentId)
      if (e.status !== 'active') throw new DomainError(Codes.GUARD_FAILED, e.status === 'pending_payment' ? 'The first month has not been paid, so nothing can be used yet.' : `This plan is ${e.status.replaceAll('_', ' ')}.`)
      const patient = await uow.tx.patient.findUniqueOrThrow({ where: { id: e.patientId }, select: { deceasedAt: true } })
      if (patient.deceasedAt) throw new DomainError(Codes.PATIENT_DECEASED, 'The patient has died.')
      const grant = await uow.tx.entitlementGrant.findFirst({ where: { enrollmentId: e.id, code: args.code, termNo: e.termNo } })
      if (!grant) throw new DomainError(Codes.NOT_FOUND, 'The plan does not include that.', { field: 'code' })
      const staff = await staffOf(uow, actor).catch(() => null)
      const unit = grant.qtyGranted.gte(1) ? grant.retailValueMinor / BigInt(grant.qtyGranted.floor().toString()) : ZERO
      try {
        const entry = await uow.tx.entitlementEntry.create({ data: { entryKey: `use:${args.idempotencyKey}`, grantId: grant.id, enrollmentId: e.id, kind: 'debit', qty, valueMinor: unit * BigInt(qty), memo: text(args.memo ?? '', 'memo', 200, false), byId: staff?.id ?? null, at: uow.now } })
        auditCreate(uow, actor, 'EntitlementEntry', entry.id, 'wellness.entitlement_used', { code: args.code, qty, enrollment: e.ref })
        return { id: entry.id, code: args.code, qty }
      } catch (error) {
        if (/outside what was granted|check_violation|23514/.test(String((error as Error)?.message))) throw new DomainError(Codes.GUARD_FAILED, `All of "${grant.label}" for this term has been used.`, { reason: 'entitlement_exhausted' })
        throw error
      }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Put a use back (it was recorded by mistake): a credit entry that names the use. The original is never edited. */
export async function returnEntitlement(_root: unknown, args: { entryId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...MANAGE], tool: 'wellness.return_entitlement', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 200)
    const result = await command(context.prisma, { name: 'wellness.return_entitlement', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const orig = await uow.tx.entitlementEntry.findUnique({ where: { id: args.entryId } })
      if (!orig || orig.kind !== 'debit') throw new DomainError(Codes.NOT_FOUND, 'That use was not found.')
      await advisoryLock(uow.tx, `enrollment:${orig.enrollmentId}`)
      const key = `return:${orig.id}`
      if (await uow.tx.entitlementEntry.findUnique({ where: { entryKey: key }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, 'That use was already put back.')
      const staff = await staffOf(uow, actor).catch(() => null)
      const entry = await uow.tx.entitlementEntry.create({ data: { entryKey: key, grantId: orig.grantId, enrollmentId: orig.enrollmentId, kind: 'credit', qty: orig.qty, valueMinor: orig.valueMinor, memo: reason, byId: staff?.id ?? null, at: uow.now } })
      auditCreate(uow, actor, 'EntitlementEntry', entry.id, 'wellness.entitlement_returned', { of: orig.id }, { reason })
      return { id: entry.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

export { dateOnly }
