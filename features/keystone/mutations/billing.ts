import { randomUUID } from 'node:crypto'
import { command } from '../lib/command'
import { auditCreate, casUpdate, lockRow, transition } from '../lib/cas'
import { consumeApproval, requestApproval } from '../lib/approval'
import { registerApplier } from '../lib/approvalAppliers'
import { actorUserId, can, type Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { balanceOfInvoice, post } from '../lib/ledger'
import { activeFeeVersion, feeItemFor, priceCharge, taxRulesFor } from '../lib/pricing'
import { adjustBps } from '../domain/billing'
import { adapterFor, cardConfigured, type ChargeResult } from '../../integrations/payment'
import { PAYMENT_METHODS } from '../models/billing'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { decimalText, locationDay, staffOf, text, type Ctx } from './clinical'
import { billingSettings, dateOnly, minorText, pick } from './billingInput'

/*
 * Charges, invoices, payments, refunds and write-offs (BUILD-PLAN P4, STATE-MACHINES §11).
 * Everything that moves money writes the client ledger in the same transaction as its cause; balances are always the sum of
 * the ledger. A card payment is three steps: record the intent and commit, call the processor with an idempotency key (no
 * transaction open), record the result. If the answer is lost the payment is `unknown`; asking again repeats the same key, so it
 * can never charge twice. A refund is made in the staff request the same way. Nothing here runs on a timer.
 */

const TAKERS = ['canTakePayments', 'canManagePayments'] as const
const POSTERS = ['canPostInvoices', 'canManagePayments'] as const
const ZERO = 0n

type Inv = { id: string; ref: string; clientId: string; locationId: string; status: string; currencyCode: string; totalMinor: bigint; version: number }

// ── Charges ─────────────────────────────────────────────────────────────────────────────────

async function clientOfPatient(uow: UnitOfWork, patientId: string) {
  const own = await uow.tx.patientOwnership.findFirst({ where: { patientId, effectiveTo: null, role: 'primary' }, select: { clientId: true } })
  if (!own?.clientId) throw new DomainError(Codes.GUARD_FAILED, 'This patient has no client of record to bill.')
  return own.clientId
}

async function createCharge(uow: UnitOfWork, actor: Actor, c: { patientId: string; clientId: string; locationId: string; encounterId: string | null; feeItemId: string; qty: string; sourceType: string; sourceId: string; description?: string; performedById?: string | null; dispensing?: boolean; injection?: boolean; manualReason?: string }) {
  const fee = await uow.tx.feeItem.findUniqueOrThrow({ where: { id: c.feeItemId } })
  const { on } = await locationDay(uow, c.locationId, uow.now)
  const client = await uow.tx.client.findUnique({ where: { id: c.clientId }, select: { taxExempt: true } })
  const taxRules = await taxRulesFor(uow.tx, c.locationId, on)
  const priced = priceCharge(fee, c.qty, { dispensing: c.dispensing, injection: c.injection, taxRules })
  const tax = client?.taxExempt ? ZERO : priced.taxMinor
  const row = await uow.tx.chargeLine.create({
    data: {
      clientId: c.clientId, patientId: c.patientId, locationId: c.locationId, encounterId: c.encounterId, feeItemId: fee.id, description: (c.description || fee.name).slice(0, 200), qty: c.qty,
      unitPriceMinor: fee.priceMinor, extendedMinor: priced.extendedMinor, discountMinor: ZERO, taxMinor: tax, taxCategory: fee.taxCategory, sourceType: c.sourceType, sourceId: c.sourceId,
      manualReason: c.manualReason ?? '', performedById: c.performedById ?? null, capturedAt: uow.now,
    },
  })
  auditCreate(uow, actor, 'ChargeLine', row.id, 'charge.captured', { source: c.sourceType, extendedMinor: priced.extendedMinor.toString(), taxMinor: tax.toString() })
  return row
}

/**
 * Turn what happened in a visit into charges: doses given, medicines dispensed, vaccines, the exam. Each source becomes one
 * charge, once (a database index refuses a second live charge for the same source), so pressing this twice is harmless.
 */
export async function captureVisitCharges(_root: unknown, args: { encounterId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS, 'canTakePayments'], tool: 'charges.capture', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'charges.capture', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const enc = await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, kind: true, patientId: true, locationId: true, attendingDvmId: true } })
      if (!enc?.patientId || !enc.locationId) throw new DomainError(Codes.NOT_FOUND, 'Visit not found.')
      const clientId = await clientOfPatient(uow, enc.patientId)
      const fees = await activeFeeVersion(uow.tx)
      const base = { patientId: enc.patientId, clientId, locationId: enc.locationId, encounterId: enc.id }
      const existing = new Set((await uow.tx.chargeLine.findMany({ where: { reversedAt: null, encounterId: enc.id }, select: { sourceType: true, sourceId: true } })).map(c => `${c.sourceType}:${c.sourceId}`))
      let made = 0
      let unpriced = 0
      const add = async (sourceType: string, sourceId: string, match: Parameters<typeof feeItemFor>[2], qty: string, extra: Partial<Parameters<typeof createCharge>[2]> = {}) => {
        if (existing.has(`${sourceType}:${sourceId}`)) return
        const fee = await feeItemFor(uow.tx, fees.id, match)
        if (!fee) { unpriced += 1; return }
        await createCharge(uow, actor, { ...base, feeItemId: fee.id, qty, sourceType, sourceId, ...extra })
        made += 1
      }
      await add('encounter_exam', enc.id, { code: `EXAM-${enc.kind.toUpperCase()}` }, '1', { performedById: enc.attendingDvmId })
      const given = await uow.tx.administration.findMany({ where: { encounterId: enc.id, reversesId: null }, select: { id: true, qty: true, givenById: true, order: { select: { drugId: true, vaccineId: true, kind: true } } } })
      const undone = new Set((await uow.tx.administration.findMany({ where: { encounterId: enc.id, reversesId: { not: null } }, select: { reversesId: true } })).map(r => r.reversesId))
      for (const a of given) {
        if (undone.has(a.id)) continue
        const o = a.order
        if (!o) continue
        if (o.vaccineId) await add('administration', a.id, { vaccineId: o.vaccineId }, '1', { performedById: a.givenById })
        else if (o.drugId) await add('administration', a.id, { drugId: o.drugId }, a.qty.toString(), { performedById: a.givenById, injection: false })
      }
      const dispenses = await uow.tx.dispense.findMany({ where: { prescription: { patientId: enc.patientId }, dispensedAt: { gte: new Date(uow.now.getTime() - 86_400_000) } }, select: { id: true, quantity: true, productId: true, dispensedById: true } })
      for (const d of dispenses) if (d.productId) await add('dispense', d.id, { drugId: d.productId }, d.quantity.toString(), { performedById: d.dispensedById, dispensing: true })
      return { made, unpriced }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Add a priced item from the fee schedule to a visit (a service not captured automatically). */
export async function addFeeCharge(_root: unknown, args: { patientId: string; encounterId?: string | null; feeItemId: string; qty: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS, 'canTakePayments'], tool: 'charges.add', humanOnly: true }, args, async actor => {
    const qty = decimalText(args.qty, 'quantity')
    const result = await command(context.prisma, { name: 'charges.add', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const clientId = await clientOfPatient(uow, args.patientId)
      const enc = args.encounterId ? await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { locationId: true } }) : null
      const locationId = enc?.locationId ?? (await uow.tx.location.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id
      if (!locationId) throw new DomainError(Codes.NOT_FOUND, 'No location.')
      const fees = await activeFeeVersion(uow.tx)
      const fee = await uow.tx.feeItem.findFirst({ where: { id: args.feeItemId, versionId: fees.id } })
      if (!fee) throw new DomainError(Codes.NOT_FOUND, 'That fee is not in the published schedule.', { field: 'feeItemId' })
      const staff = await staffOf(uow, actor).catch(() => null)
      const row = await createCharge(uow, actor, { patientId: args.patientId, clientId, locationId, encounterId: args.encounterId ?? null, feeItemId: fee.id, qty, sourceType: 'fee', sourceId: randomUUID(), performedById: staff?.id ?? null })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** A charge with no clinical source (I-M1): needs canAddManualCharge and a reason, and the amount is typed in. */
export async function addManualCharge(_root: unknown, args: { patientId: string; encounterId?: string | null; description: string; amountMinor: string; taxCategory: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAddManualCharge'], tool: 'charges.manual', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const description = text(args.description, 'description', 160)
    const amount = minorText(args.amountMinor, 'amount')
    const result = await command(context.prisma, { name: 'charges.manual', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const clientId = await clientOfPatient(uow, args.patientId)
      const enc = args.encounterId ? await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { locationId: true } }) : null
      const locationId = enc?.locationId ?? (await uow.tx.location.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id
      if (!locationId) throw new DomainError(Codes.NOT_FOUND, 'No location.')
      const { on } = await locationDay(uow, locationId, uow.now)
      const taxRules = await taxRulesFor(uow.tx, locationId, on)
      let tax = ZERO
      try { tax = priceCharge({ priceMinor: amount, minimumChargeMinor: null, dispensingFeeMinor: null, injectionFeeMinor: null, taxCategory: args.taxCategory }, '1', { taxRules }).taxMinor } catch { throw new DomainError(Codes.INVALID_INPUT, 'Choose how this charge is taxed.', { field: 'taxCategory' }) }
      const staff = await staffOf(uow, actor).catch(() => null)
      const row = await uow.tx.chargeLine.create({ data: { clientId, patientId: args.patientId, locationId, encounterId: args.encounterId ?? null, description, qty: '1', unitPriceMinor: amount, extendedMinor: amount, discountMinor: ZERO, taxMinor: tax, taxCategory: args.taxCategory, sourceType: 'manual', sourceId: '', manualReason: reason, performedById: staff?.id ?? null, capturedAt: uow.now } })
      auditCreate(uow, actor, 'ChargeLine', row.id, 'charge.manual', { amountMinor: amount.toString() }, { reason })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Reverse a charge that is not on a posted invoice (the clinical event was wrong or cancelled). */
export async function reverseCharge(_root: unknown, args: { chargeId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS], tool: 'charges.reverse', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'charges.reverse', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const line = await lockRow<{ id: string; invoiceId: string | null; reversedAt: Date | null }>(uow.tx, 'ChargeLine', args.chargeId)
      if (line.reversedAt) throw new DomainError(Codes.GUARD_FAILED, 'That charge was already reversed.')
      if (line.invoiceId) {
        const inv = await uow.tx.invoice.findUnique({ where: { id: line.invoiceId }, select: { status: true } })
        if (inv?.status !== 'draft') throw new DomainError(Codes.GUARD_FAILED, 'This charge is on a posted invoice. Issue a credit note instead.')
      }
      await uow.tx.chargeLine.update({ where: { id: line.id }, data: { reversedAt: uow.now, reversalReason: reason, invoiceId: null } })
      auditCreate(uow, actor, 'ChargeLine', line.id, 'charge.reversed', {}, { reason })
      return { id: line.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Invoices ────────────────────────────────────────────────────────────────────────────────

/** Gather a client's open charges (optionally for one visit) onto a new draft invoice. */
export async function draftInvoice(_root: unknown, args: { clientId: string; encounterId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS, 'canTakePayments'], tool: 'invoice.draft', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'invoice.draft', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const lines = await uow.tx.chargeLine.findMany({ where: { clientId: args.clientId, invoiceId: null, reversedAt: null, ...(args.encounterId ? { encounterId: args.encounterId } : {}) }, orderBy: { capturedAt: 'asc' } })
      if (!lines.length) throw new DomainError(Codes.GUARD_FAILED, 'There are no open charges to invoice.')
      const locationId = lines[0].locationId!
      const settings = await billingSettings(uow)
      const staff = await staffOf(uow, actor).catch(() => null)
      const ref = `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`
      const inv = await uow.tx.invoice.create({ data: { ref, clientId: args.clientId, locationId, encounterId: args.encounterId ?? lines[0].encounterId, status: 'draft', currencyCode: settings.currencyCode, note: '', createdById: staff?.id ?? null } })
      await uow.tx.chargeLine.updateMany({ where: { id: { in: lines.map(l => l.id) } }, data: { invoiceId: inv.id } })
      auditCreate(uow, actor, 'Invoice', inv.id, 'invoice.drafted', { lines: lines.length })
      return { id: inv.id, lines: lines.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Percentage discount across a draft invoice's lines. Above the practice's limit it needs someone who may approve discounts. */
export async function discountInvoice(_root: unknown, args: { invoiceId: string; percent: number; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canDiscount', 'canApproveDiscount'], tool: 'invoice.discount', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const bps = Math.round(Number(args.percent) * 100)
    if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new DomainError(Codes.INVALID_INPUT, 'Discount is a percentage from 0 to 100.', { field: 'percent' })
    const result = await command(context.prisma, { name: 'invoice.discount', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const settings = await billingSettings(uow)
      if (bps > settings.discountApprovalThresholdBps && !can(actor, 'canApproveDiscount')) throw new DomainError(Codes.APPROVAL_REQUIRED, `Discounts over ${settings.discountApprovalThresholdBps / 100}% need someone who can approve discounts.`)
      const inv = await lockRow<Inv>(uow.tx, 'Invoice', args.invoiceId)
      if (inv.status !== 'draft') throw new DomainError(Codes.GUARD_FAILED, 'Only a draft invoice can be discounted.')
      const lines = await uow.tx.chargeLine.findMany({ where: { invoiceId: inv.id } })
      const { on } = await locationDay(uow, inv.locationId, uow.now)
      const taxRules = await taxRulesFor(uow.tx, inv.locationId, on)
      const client = await uow.tx.client.findUnique({ where: { id: inv.clientId }, select: { taxExempt: true } })
      let total = ZERO
      for (const l of lines) {
        const discount = -adjustBps(l.extendedMinor, -bps)
        const net = l.extendedMinor - discount
        const { taxOn } = await import('../domain/billing')
        const tax = client?.taxExempt ? ZERO : taxOn(taxRules, l.taxCategory, net)
        await uow.tx.chargeLine.update({ where: { id: l.id }, data: { discountMinor: discount, taxMinor: tax } })
        total += discount
      }
      auditCreate(uow, actor, 'Invoice', inv.id, 'invoice.discounted', { bps, discountMinor: total.toString() }, { reason })
      return { id: inv.id, discountMinor: total.toString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Post the draft: totals frozen, a number assigned, the amount owed written to the ledger on its day. */
export async function postInvoice(_root: unknown, args: { invoiceId: string; postedOn?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS], tool: 'invoice.post', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'invoice.post', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const inv = await lockRow<Inv>(uow.tx, 'Invoice', args.invoiceId)
      const lines = await uow.tx.chargeLine.findMany({ where: { invoiceId: inv.id, reversedAt: null } })
      if (!lines.length) throw new DomainError(Codes.GUARD_FAILED, 'An invoice needs at least one charge.')
      const { on } = await locationDay(uow, inv.locationId, uow.now)
      const postedOn = args.postedOn ? dateOnly(args.postedOn, 'posting day') : on
      if (postedOn > on) throw new DomainError(Codes.INVALID_INPUT, 'An invoice cannot be posted for a future day.', { field: 'postedOn' })
      const subtotal = lines.reduce((n, l) => n + l.extendedMinor, ZERO)
      const discount = lines.reduce((n, l) => n + l.discountMinor, ZERO)
      const tax = lines.reduce((n, l) => n + l.taxMinor, ZERO)
      const total = subtotal - discount + tax
      const { periodFor } = await import('../lib/ledger')
      const period = await periodFor(uow.tx, postedOn)
      const ref = await nextReference(uow.tx, 'INV', uow.now)
      const row = await transition<Record<string, unknown>>(uow, { model: 'Invoice', id: inv.id, from: ['draft'], to: 'posted', expectedVersion: args.expectedVersion, actor, eventType: 'invoice.posted', data: { ref, postedAt: uow.now, postedOn: new Date(`${postedOn}T00:00:00Z`), periodId: period.id, subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total }, metadata: { totalMinor: total.toString() } })
      if (total > ZERO) await post(uow, { clientId: inv.clientId, invoiceId: inv.id, kind: 'invoice', amountMinor: total, currencyCode: inv.currencyCode, postedOn, entryKey: `invoice:${inv.id}:post`, memo: ref })
      else await transition(uow, { model: 'Invoice', id: inv.id, from: ['posted'], to: 'paid', actor, eventType: 'invoice.paid' })
      return { id: inv.id, ref, status: row.status, totalMinor: total.toString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Move the invoice status to what its ledger balance says. */
async function syncInvoiceStatus(uow: UnitOfWork, actor: Actor, invoiceId: string, reason: string) {
  const inv = await uow.tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, version: true, totalMinor: true } })
  if (inv.status === 'written_off' || inv.status === 'draft') return inv.status
  const balance = await balanceOfInvoice(uow.tx, invoiceId)
  const next = balance <= ZERO ? 'paid' : balance < inv.totalMinor ? 'partially_paid' : 'posted'
  if (next !== inv.status) await casUpdate(uow, { model: 'Invoice', id: invoiceId, version: inv.version, from: [inv.status], to: next, actor, eventType: `invoice.${next}`, reason })
  return next
}

// ── Payments ────────────────────────────────────────────────────────────────────────────────

type Target = { invoiceId?: string | null; depositId?: string | null }

/** The ledger and allocation for a payment that has gone through. Runs once: the status change that precedes it is a CAS. */
async function settleSucceeded(uow: UnitOfWork, actor: Actor, paymentId: string, providerRef?: string | null) {
  const pay = await lockRow<{ id: string; clientId: string; locationId: string | null; amountMinor: bigint; currencyCode: string; status: string; forInvoiceId: string | null; forDepositId: string | null; postedOn: Date | null; ref: string; version: number }>(uow.tx, 'Payment', paymentId)
  if (pay.status === 'succeeded') return { settled: false, paymentId }
  if (!['pending', 'unknown'].includes(pay.status)) throw new DomainError(Codes.GUARD_FAILED, `This payment is ${pay.status} and cannot be marked paid.`)
  const locationId = pay.locationId ?? (await uow.tx.location.findFirst({ select: { id: true } }))!.id
  const day = pay.postedOn ? pay.postedOn.toISOString().slice(0, 10) : (await locationDay(uow, locationId, uow.now)).on
  await casUpdate(uow, { model: 'Payment', id: pay.id, version: pay.version, from: [pay.status], to: 'succeeded', actor, eventType: 'payment.succeeded', data: { receivedAt: uow.now, ...(providerRef ? { providerRef } : {}) } })
  let left = pay.amountMinor
  if (pay.forDepositId) {
    const dep = await lockRow<{ id: string; status: string; requestedMinor: bigint; version: number }>(uow.tx, 'Deposit', pay.forDepositId)
    if (dep.status !== 'requested') throw new DomainError(Codes.GUARD_FAILED, 'That deposit was already paid.')
    await uow.tx.paymentAllocation.create({ data: { paymentId: pay.id, depositId: dep.id, amountMinor: pay.amountMinor, at: uow.now } })
    await casUpdate(uow, { model: 'Deposit', id: dep.id, version: dep.version, from: ['requested'], to: 'paid', actor, eventType: 'deposit.paid', data: { paymentId: pay.id } })
    await post(uow, { clientId: pay.clientId, kind: 'deposit_received', amountMinor: -pay.amountMinor, currencyCode: pay.currencyCode, postedOn: day, entryKey: `payment:${pay.id}:deposit`, paymentId: pay.id, memo: pay.ref })
    left = ZERO
  } else if (pay.forInvoiceId) {
    await lockRow(uow.tx, 'Invoice', pay.forInvoiceId)
    const balance = await balanceOfInvoice(uow.tx, pay.forInvoiceId)
    const apply = balance < left ? (balance > ZERO ? balance : ZERO) : left
    if (apply > ZERO) {
      await uow.tx.paymentAllocation.create({ data: { paymentId: pay.id, invoiceId: pay.forInvoiceId, amountMinor: apply, at: uow.now } })
      await post(uow, { clientId: pay.clientId, invoiceId: pay.forInvoiceId, paymentId: pay.id, kind: 'payment', amountMinor: -apply, currencyCode: pay.currencyCode, postedOn: day, entryKey: `payment:${pay.id}:invoice`, memo: pay.ref })
      left -= apply
    }
  }
  if (left > ZERO) await post(uow, { clientId: pay.clientId, paymentId: pay.id, kind: 'payment_unallocated', amountMinor: -left, currencyCode: pay.currencyCode, postedOn: day, entryKey: `payment:${pay.id}:account`, memo: `${pay.ref} held on account` })
  if (pay.forInvoiceId) await syncInvoiceStatus(uow, actor, pay.forInvoiceId, pay.ref)
  return { settled: true, paymentId, heldOnAccountMinor: left.toString() }
}

async function newPayment(uow: UnitOfWork, actor: Actor, a: { clientId: string; locationId?: string | null; method: string; provider: string; amountMinor: bigint; target: Target; reference?: string; note?: string; postedOn?: string | null; allowOverpay?: boolean; payerAuthorizationId?: string | null }) {
  const settings = await billingSettings(uow)
  let locationId = a.locationId ?? null
  type InvoiceHead = { id: string; status: string; clientId: string | null; currencyCode: string; locationId: string | null }
  let invoice: InvoiceHead | null = null
  if (a.target.invoiceId) {
    invoice = await uow.tx.invoice.findUnique({ where: { id: a.target.invoiceId }, select: { id: true, status: true, clientId: true, currencyCode: true, locationId: true } })
    if (!invoice || invoice.clientId !== a.clientId) throw new DomainError(Codes.NOT_FOUND, 'Invoice not found for this client.')
    if (!['posted', 'partially_paid'].includes(invoice.status)) throw new DomainError(Codes.GUARD_FAILED, invoice.status === 'paid' ? 'That invoice is already paid.' : 'That invoice cannot take a payment.')
    locationId = invoice.locationId
    const balance = await balanceOfInvoice(uow.tx, invoice.id)
    if (a.amountMinor > balance && !a.allowOverpay) throw new DomainError(Codes.GUARD_FAILED, 'That is more than the invoice balance. Take the balance, or choose to hold the extra on account.', { reason: 'overpay' })
  }
  if (a.target.depositId) {
    const dep = await uow.tx.deposit.findUnique({ where: { id: a.target.depositId }, select: { clientId: true, status: true, requestedMinor: true } })
    if (!dep || dep.clientId !== a.clientId) throw new DomainError(Codes.NOT_FOUND, 'Deposit not found for this client.')
    if (dep.status !== 'requested') throw new DomainError(Codes.GUARD_FAILED, 'That deposit was already paid.')
    if (dep.requestedMinor !== a.amountMinor) throw new DomainError(Codes.GUARD_FAILED, 'A deposit is paid in full, at the amount that was asked for.', { reason: 'deposit_amount' })
  }
  const staff = await staffOf(uow, actor).catch(() => null)
  const ref = await nextReference(uow.tx, 'PAY', uow.now)
  return uow.tx.payment.create({
    data: {
      ref, clientId: a.clientId, locationId, method: a.method, provider: a.provider, amountMinor: a.amountMinor, currencyCode: invoice?.currencyCode ?? settings.currencyCode, status: 'pending', reference: (a.reference ?? '').slice(0, 120), note: (a.note ?? '').slice(0, 300),
      forInvoiceId: a.target.invoiceId ?? null, forDepositId: a.target.depositId ?? null, allowOverpay: a.allowOverpay === true, payerAuthorizationId: a.payerAuthorizationId ?? null, receivedById: staff?.id ?? null,
      postedOn: a.postedOn ? new Date(`${dateOnly(a.postedOn, 'posting day')}T00:00:00Z`) : null,
    },
  })
}

/** Cash, check, ACH, an insurer's payment, financing, or a card taken on a reader: the person records what was received. */
export async function recordPayment(_root: unknown, args: { clientId: string; invoiceId?: string | null; depositId?: string | null; method: string; amountMinor: string; reference?: string | null; note?: string | null; postedOn?: string | null; allowOverpay?: boolean | null; payerAuthorizationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TAKERS], tool: 'payment.record', humanOnly: true }, args, async actor => {
    const method = pick(args.method, PAYMENT_METHODS.filter(m => !['payment_link', 'client_credit'].includes(m)), 'payment method')
    const amount = minorText(args.amountMinor, 'amount')
    if (method === 'insurer_direct' && !args.payerAuthorizationId) throw new DomainError(Codes.INVALID_INPUT, 'An insurer payment needs the authorisation it was paid against.', { field: 'payerAuthorizationId' })
    if (['check', 'ach'].includes(method) && !String(args.reference ?? '').trim()) throw new DomainError(Codes.INVALID_INPUT, 'Enter the check or reference number.', { field: 'reference' })
    const result = await command(context.prisma, { name: 'payment.record', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      if (args.payerAuthorizationId) {
        const auth = await uow.tx.payerAuthorization.findUnique({ where: { id: args.payerAuthorizationId }, select: { status: true, invoiceId: true } })
        if (!auth || !['authorised', 'paid'].includes(auth.status)) throw new DomainError(Codes.GUARD_FAILED, 'That authorisation has not been approved by the insurer.')
        if (auth.invoiceId && auth.invoiceId !== args.invoiceId) throw new DomainError(Codes.GUARD_FAILED, 'That authorisation is for a different invoice.')
      }
      const pay = await newPayment(uow, actor, { clientId: args.clientId, method, provider: 'manual', amountMinor: amount, target: { invoiceId: args.invoiceId, depositId: args.depositId }, reference: args.reference ?? '', note: args.note ?? '', postedOn: args.postedOn, allowOverpay: args.allowOverpay === true, payerAuthorizationId: args.payerAuthorizationId })
      const settled = await settleSucceeded(uow, actor, pay.id)
      auditCreate(uow, actor, 'Payment', pay.id, 'payment.recorded', { method, amountMinor: amount.toString() })
      return { id: pay.id, ref: pay.ref, status: 'succeeded', heldOnAccountMinor: (settled as { heldOnAccountMinor?: string }).heldOnAccountMinor ?? '0' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Record the intent, commit, call the card processor with an idempotency key, record the answer. */
export async function takeCardPayment(_root: unknown, args: { clientId: string; invoiceId?: string | null; depositId?: string | null; amountMinor: string; paymentMethodId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TAKERS], tool: 'payment.card', humanOnly: true }, args, async actor => {
    const amount = minorText(args.amountMinor, 'amount')
    if (!cardConfigured()) throw new DomainError(Codes.FEATURE_DISABLED, 'Card payments are not set up on this server. Record the card payment by hand, or ask the practice owner to connect the card processor.', { reason: 'no_processor' })
    const started = await command(context.prisma, { name: 'payment.card.start', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const pay = await newPayment(uow, actor, { clientId: args.clientId, method: 'card_on_file', provider: 'stripe', amountMinor: amount, target: { invoiceId: args.invoiceId, depositId: args.depositId } })
      const attempt = await uow.tx.paymentAttempt.create({ data: { paymentId: pay.id, status: 'processing', providerIdempotencyKey: `vet-pay-${pay.id}`, amountMinor: amount, startedAt: uow.now } })
      return { paymentId: pay.id, ref: pay.ref, attemptId: attempt.id, key: attempt.providerIdempotencyKey, currencyCode: pay.currencyCode }
    })
    if (started.replay) return { replay: true, ...(await settleFromState(context, actor, started.value.paymentId)) }
    const outcome = await adapterFor('stripe').charge({ amountMinor: amount, currencyCode: started.value.currencyCode, idempotencyKey: started.value.key, description: `Payment ${started.value.ref}`, metadata: { payment: started.value.paymentId }, paymentMethod: args.paymentMethodId ?? undefined })
    return { replay: false, ...(await recordOutcome(context, actor, started.value.paymentId, started.value.attemptId, outcome, `${args.idempotencyKey}:result`)) }
  })
}

async function settleFromState(context: Ctx, actor: Actor, paymentId: string) {
  const p = await context.prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, ref: true, status: true } })
  return { id: p.id, ref: p.ref, status: p.status }
}

async function recordOutcome(context: Ctx, actor: Actor, paymentId: string, attemptId: string, outcome: ChargeResult, key: string) {
  const done = await command(context.prisma, { name: 'payment.card.result', actor, idempotencyKey: key, params: { paymentId, attemptId, outcome: outcome.outcome, providerRef: outcome.providerRef } }, async uow => {
    const pay = await lockRow<{ id: string; ref: string; status: string; version: number }>(uow.tx, 'Payment', paymentId)
    if (pay.status === 'succeeded') return { id: pay.id, ref: pay.ref, status: 'succeeded', message: 'Paid.' }
    const attempt = await lockRow<{ id: string; status: string; version: number }>(uow.tx, 'PaymentAttempt', attemptId)
    const attemptStatus = outcome.outcome
    if (attempt.status !== attemptStatus) await casUpdate(uow, { model: 'PaymentAttempt', id: attempt.id, version: attempt.version, from: [attempt.status], to: attemptStatus, actor, eventType: `payment.attempt.${attemptStatus}`, data: { providerRef: outcome.providerRef ?? '', message: outcome.message.slice(0, 200), ...(attemptStatus === 'unknown' || attemptStatus === 'requires_action' ? {} : { resolvedAt: uow.now }) } })
    if (outcome.outcome === 'succeeded') await settleSucceeded(uow, actor, paymentId, outcome.providerRef)
    else if (outcome.outcome === 'failed') await casUpdate(uow, { model: 'Payment', id: pay.id, version: pay.version, from: [pay.status], to: 'failed', actor, eventType: 'payment.failed', data: { providerRef: outcome.providerRef ?? '' } })
    else if (outcome.outcome === 'unknown' && pay.status === 'pending') await casUpdate(uow, { model: 'Payment', id: pay.id, version: pay.version, from: ['pending'], to: 'unknown', actor, eventType: 'payment.unknown', data: { providerRef: outcome.providerRef ?? '' } })
    return { id: pay.id, ref: pay.ref, status: outcome.outcome === 'requires_action' ? 'pending' : outcome.outcome, message: outcome.message }
  })
  return done.value
}

/**
 * Ask the processor what happened to a payment whose answer was lost. It repeats the same idempotency key, so the processor
 * returns the original result rather than charging again; a result already recorded is returned without calling out.
 */
export async function resolveUnknownPayment(prisma: any, actor: Actor, paymentId: string) {
  const pay = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, status: true, provider: true, amountMinor: true, currencyCode: true, providerRef: true, ref: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, providerIdempotencyKey: true, status: true } } } })
  if (!pay) throw new DomainError(Codes.NOT_FOUND, 'Payment not found.')
  if (!['unknown', 'pending'].includes(pay.status) || !pay.attempts[0]) return { id: pay.id, ref: pay.ref, status: pay.status, message: 'Nothing to check.' }
  const attempt = pay.attempts[0]
  if (!cardConfigured()) return { id: pay.id, ref: pay.ref, status: pay.status, message: 'The card processor is not reachable from here.' }
  const outcome = await adapterFor(pay.provider).resolve({ amountMinor: pay.amountMinor, currencyCode: pay.currencyCode, idempotencyKey: attempt.providerIdempotencyKey, description: `Payment ${pay.ref}`, metadata: { payment: pay.id }, providerRef: pay.providerRef || null })
  return recordOutcome({ prisma, session: null }, actor, pay.id, attempt.id, outcome, `resolve:${pay.id}:${outcome.outcome}:${outcome.providerRef ?? ''}`)
}

export async function checkPaymentStatus(_root: unknown, args: { paymentId: string }, context: Ctx) {
  return gated(context, { permissions: [...TAKERS], tool: 'payment.check', humanOnly: true }, args, async actor => resolveUnknownPayment(context.prisma, actor, args.paymentId))
}

/** A processor event (the shared payment webhook route). Recorded once by its own id; a repeat does nothing. */
export async function applyPaymentEvent(prisma: any, actor: Actor, event: { provider: string; id: string; type: string; objectRef: string; outcome: string }) {
  const done = await applyPaymentEventOnce(prisma, actor, event)
  // The same event id again is answered from the stored receipt (or the event table); either way nothing is applied twice.
  return { duplicate: done.replay || (done.value as { duplicate: boolean }).duplicate === true }
}

async function applyPaymentEventOnce(prisma: any, actor: Actor, event: { provider: string; id: string; type: string; objectRef: string; outcome: string }) {
  return command(prisma, { name: 'payment.webhook', actor, idempotencyKey: `webhook:${event.provider}:${event.id}`, params: event }, async uow => {
    const seen = await uow.tx.paymentWebhookEvent.findFirst({ where: { provider: event.provider, eventId: event.id }, select: { id: true } })
    if (seen) {
      await uow.tx.paymentWebhookEvent.update({ where: { id: seen.id }, data: { duplicates: { increment: 1 } } })
      return { duplicate: true }
    }
    await uow.tx.paymentWebhookEvent.create({ data: { provider: event.provider, eventId: event.id, type: event.type, objectRef: event.objectRef, outcome: event.outcome, receivedAt: uow.now } })
    if (event.outcome === 'succeeded') {
      const pay = await uow.tx.payment.findFirst({ where: { providerRef: event.objectRef, status: { in: ['pending', 'unknown'] } }, select: { id: true } })
      if (pay) await settleSucceeded(uow, actor, pay.id, event.objectRef)
    }
    return { duplicate: false }
  })
}

// ── Deposits ────────────────────────────────────────────────────────────────────────────────

/** Put a paid deposit against an invoice: once, to one invoice. Whatever the invoice cannot take stays on the client's account. */
export async function applyDeposit(_root: unknown, args: { depositId: string; invoiceId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TAKERS, ...POSTERS], tool: 'deposit.apply', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'deposit.apply', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const dep = await lockRow<{ id: string; clientId: string; status: string; paymentId: string | null; currencyCode: string; version: number }>(uow.tx, 'Deposit', args.depositId)
      if (dep.status === 'applied') throw new DomainError(Codes.GUARD_FAILED, 'This deposit was already applied.', { reason: 'already_applied' })
      if (dep.status !== 'paid') throw new DomainError(Codes.GUARD_FAILED, 'This deposit has not been paid yet.')
      const inv = await lockRow<Inv>(uow.tx, 'Invoice', args.invoiceId)
      if (inv.clientId !== dep.clientId) throw new DomainError(Codes.GUARD_FAILED, 'A deposit can only go against the same client\u2019s invoice.')
      if (!['posted', 'partially_paid'].includes(inv.status)) throw new DomainError(Codes.GUARD_FAILED, 'That invoice cannot take a deposit.')
      const pay = await uow.tx.payment.findUniqueOrThrow({ where: { id: dep.paymentId! }, select: { amountMinor: true } })
      const balance = await balanceOfInvoice(uow.tx, inv.id)
      const apply = pay.amountMinor < balance ? pay.amountMinor : balance
      const { on } = await locationDay(uow, inv.locationId, uow.now)
      await post(uow, { clientId: dep.clientId, kind: 'deposit_released', amountMinor: apply, currencyCode: dep.currencyCode, postedOn: on, entryKey: `deposit:${dep.id}:release`, memo: 'Deposit applied' })
      await post(uow, { clientId: dep.clientId, invoiceId: inv.id, kind: 'deposit_applied', amountMinor: -apply, currencyCode: dep.currencyCode, postedOn: on, entryKey: `deposit:${dep.id}:apply`, memo: 'Deposit applied' })
      await casUpdate(uow, { model: 'Deposit', id: dep.id, version: dep.version, from: ['paid'], to: 'applied', actor, eventType: 'deposit.applied', data: { appliedInvoiceId: inv.id, appliedAt: uow.now } })
      const status = await syncInvoiceStatus(uow, actor, inv.id, 'Deposit applied')
      return { depositId: dep.id, invoiceId: inv.id, appliedMinor: apply.toString(), invoiceStatus: status }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Credit notes, refunds, write-offs ───────────────────────────────────────────────────────

/** Reduce what an invoice says is owed. Anything beyond the balance moves to the client's account as credit. */
export async function issueCreditNote(_root: unknown, args: { invoiceId: string; amountMinor: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS], tool: 'credit.note', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const amount = minorText(args.amountMinor, 'amount')
    const result = await command(context.prisma, { name: 'credit.note', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const inv = await lockRow<Inv>(uow.tx, 'Invoice', args.invoiceId)
      if (!['posted', 'partially_paid', 'paid'].includes(inv.status)) throw new DomainError(Codes.GUARD_FAILED, 'Only a posted invoice can be credited.')
      if (amount > inv.totalMinor) throw new DomainError(Codes.GUARD_FAILED, 'A credit note cannot be more than the invoice total.')
      const credited = (await uow.tx.creditNote.aggregate({ where: { invoiceId: inv.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? ZERO
      if (credited + amount > inv.totalMinor) throw new DomainError(Codes.GUARD_FAILED, 'Credit notes cannot add up to more than the invoice total.')
      const staff = await staffOf(uow, actor).catch(() => null)
      const ref = await nextReference(uow.tx, 'CRN', uow.now)
      const note = await uow.tx.creditNote.create({ data: { ref, invoiceId: inv.id, clientId: inv.clientId, amountMinor: amount, currencyCode: inv.currencyCode, reason, postedById: staff?.id ?? null, postedAt: uow.now } })
      const { on } = await locationDay(uow, inv.locationId, uow.now)
      const balance = await balanceOfInvoice(uow.tx, inv.id)
      await post(uow, { clientId: inv.clientId, invoiceId: inv.id, kind: 'credit_note', amountMinor: -amount, currencyCode: inv.currencyCode, postedOn: on, entryKey: `credit:${note.id}`, memo: ref })
      const excess = amount > balance ? amount - (balance > ZERO ? balance : ZERO) : ZERO
      if (excess > ZERO) {
        await post(uow, { clientId: inv.clientId, invoiceId: inv.id, kind: 'adjustment', amountMinor: excess, currencyCode: inv.currencyCode, postedOn: on, entryKey: `credit:${note.id}:excess:invoice`, memo: `${ref}: already paid` })
        await post(uow, { clientId: inv.clientId, kind: 'adjustment', amountMinor: -excess, currencyCode: inv.currencyCode, postedOn: on, entryKey: `credit:${note.id}:excess:account`, memo: `${ref}: credit held on account` })
      }
      await syncInvoiceStatus(uow, actor, inv.id, ref)
      auditCreate(uow, actor, 'CreditNote', note.id, 'credit.issued', { ref, amountMinor: amount.toString(), heldOnAccountMinor: excess.toString() }, { reason })
      return { id: note.id, ref, heldOnAccountMinor: excess.toString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

async function runRefund(prisma: any, actor: Actor, refundId: string, key: string) {
  const start = await command(prisma, { name: 'refund.start', actor, idempotencyKey: `${key}:start`, params: { refundId } }, async uow => {
    const r = await lockRow<{ id: string; status: string; paymentId: string; amountMinor: bigint; reason: string; providerIdempotencyKey: string; version: number; invoiceId: string | null }>(uow.tx, 'Refund', refundId)
    if (r.status === 'succeeded') return { skip: true as const, status: r.status }
    if (!['requested', 'approved', 'processing', 'unknown'].includes(r.status)) throw new DomainError(Codes.GUARD_FAILED, `This refund is ${r.status}.`)
    if (r.status === 'requested' || r.status === 'approved') await casUpdate(uow, { model: 'Refund', id: r.id, version: r.version, from: [r.status], to: 'processing', actor, eventType: 'refund.processing' })
    const pay = await uow.tx.payment.findUniqueOrThrow({ where: { id: r.paymentId }, select: { provider: true, providerRef: true } })
    return { skip: false as const, id: r.id, amountMinor: r.amountMinor, reason: r.reason, key: r.providerIdempotencyKey, provider: pay.provider, providerRef: pay.providerRef }
  })
  if (start.value.skip) return { id: refundId, status: start.value.status, message: 'Already refunded.' }
  const s = start.value
  const out = await adapterFor(s.provider).refund({ providerRef: s.providerRef, amountMinor: s.amountMinor, idempotencyKey: s.key, reason: s.reason })
  const done = await command(prisma, { name: 'refund.settle', actor, idempotencyKey: `${key}:settle:${out.outcome}:${out.providerRef ?? ''}`, params: { refundId, outcome: out.outcome } }, async uow => {
    const r = await lockRow<{ id: string; status: string; version: number; paymentId: string; invoiceId: string | null; amountMinor: bigint; ref: string }>(uow.tx, 'Refund', refundId)
    if (r.status === 'succeeded') return { id: r.id, status: 'succeeded' }
    const pay = await uow.tx.payment.findUniqueOrThrow({ where: { id: r.paymentId }, select: { clientId: true, currencyCode: true, locationId: true } })
    if (out.outcome === 'succeeded') {
      const locationId = pay.locationId ?? (await uow.tx.location.findFirstOrThrow({ select: { id: true } })).id
      const { on } = await locationDay(uow, locationId, uow.now)
      await post(uow, { clientId: pay.clientId!, invoiceId: r.invoiceId, paymentId: r.paymentId, kind: 'refund', amountMinor: r.amountMinor, currencyCode: pay.currencyCode, postedOn: on, entryKey: `refund:${r.id}`, memo: r.ref })
      if (r.invoiceId) await syncInvoiceStatus(uow, actor, r.invoiceId, r.ref)
      await casUpdate(uow, { model: 'Refund', id: r.id, version: r.version, from: [r.status], to: 'succeeded', actor, eventType: 'refund.succeeded', data: { providerRef: out.providerRef ?? '', processedAt: uow.now, message: out.message.slice(0, 200) } })
    } else if (out.outcome === 'failed') {
      await casUpdate(uow, { model: 'Refund', id: r.id, version: r.version, from: [r.status], to: 'failed', actor, eventType: 'refund.failed', data: { message: out.message.slice(0, 200) } })
    } else if (r.status !== 'unknown') {
      await casUpdate(uow, { model: 'Refund', id: r.id, version: r.version, from: [r.status], to: 'unknown', actor, eventType: 'refund.unknown', data: { message: out.message.slice(0, 200), providerRef: out.providerRef ?? '' } })
    }
    return { id: r.id, status: out.outcome, message: out.message }
  })
  return done.value
}

/** Ask for a refund of part or all of a payment. Above the practice's limit it waits for an approver; otherwise it is made now. */
export async function requestRefund(_root: unknown, args: { paymentId: string; invoiceId?: string | null; amountMinor: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canIssueRefunds', 'canTakePayments'], tool: 'refund.request', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const amount = minorText(args.amountMinor, 'amount')
    const made = await command(context.prisma, { name: 'refund.request', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const pay = await lockRow<{ id: string; clientId: string; status: string; amountMinor: bigint }>(uow.tx, 'Payment', args.paymentId)
      if (pay.status !== 'succeeded') throw new DomainError(Codes.GUARD_FAILED, 'Only a payment that went through can be refunded.')
      if (args.invoiceId) {
        const inv = await uow.tx.invoice.findUnique({ where: { id: args.invoiceId }, select: { clientId: true } })
        if (!inv || inv.clientId !== pay.clientId) throw new DomainError(Codes.NOT_FOUND, 'Invoice not found for this client.')
      }
      const settings = await billingSettings(uow)
      const staff = await staffOf(uow, actor).catch(() => null)
      const ref = await nextReference(uow.tx, 'REF', uow.now)
      const needsApproval = amount > settings.refundApprovalThresholdMinor
      const refund = await uow.tx.refund.create({ data: { ref, paymentId: pay.id, invoiceId: args.invoiceId ?? null, amountMinor: amount, currencyCode: 'USD', reason, status: 'requested', providerIdempotencyKey: `vet-refund-${randomUUID()}`, requestedById: staff?.id ?? null } })
      let approvalId: string | null = null
      if (needsApproval) {
        const req = await requestApproval(uow, actor, { action: 'refund.issue', targetList: 'Refund', targetId: refund.id, payload: { refundId: refund.id, amountMinor: amount.toString() }, requiredPermission: 'canIssueRefunds', summary: `Refund ${ref}` })
        approvalId = req.id
        await uow.tx.refund.update({ where: { id: refund.id }, data: { approvalId } })
      }
      auditCreate(uow, actor, 'Refund', refund.id, 'refund.requested', { ref, amountMinor: amount.toString(), needsApproval }, { reason })
      return { id: refund.id, ref, needsApproval, approvalRequestId: approvalId }
    })
    if (made.replay || made.value.needsApproval) return { replay: made.replay, ...made.value, status: 'requested' }
    const out = await runRefund(context.prisma, actor, made.value.id, args.idempotencyKey)
    return { replay: false, ...made.value, ...out }
  })
}

/** After an approver has said yes: make the refund. The approval is used once and must match the amount. */
export async function issueApprovedRefund(_root: unknown, args: { refundId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canIssueRefunds', 'canTakePayments'], tool: 'refund.issue', humanOnly: true }, args, async actor => {
    await command(context.prisma, { name: 'refund.approve.use', actor, idempotencyKey: `${args.idempotencyKey}:use`, params: args }, async uow => {
      const r = await lockRow<{ id: string; status: string; approvalId: string | null; amountMinor: bigint; version: number }>(uow.tx, 'Refund', args.refundId)
      if (r.status !== 'requested') return { skipped: true }
      if (!r.approvalId) return { skipped: true }
      const used = await consumeApproval(uow, { requestId: r.approvalId, action: 'refund.issue', targetList: 'Refund', targetId: r.id, payload: { refundId: r.id, amountMinor: r.amountMinor.toString() } })
      await casUpdate(uow, { model: 'Refund', id: r.id, version: r.version, from: ['requested'], to: 'approved', actor, eventType: 'refund.approved', approverId: used.approverId })
      return { skipped: false }
    })
    return runRefund(context.prisma, actor, args.refundId, args.idempotencyKey)
  })
}

/** "Check status" for a refund whose answer was lost: repeats the same idempotency key. */
export async function checkRefundStatus(_root: unknown, args: { refundId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canIssueRefunds', 'canTakePayments'], tool: 'refund.check', humanOnly: true }, args, async actor => runRefund(context.prisma, actor, args.refundId, args.idempotencyKey))
}

/** Write off what is left on an invoice. When the practice requires it, a second person approves first. */
export async function requestWriteOff(_root: unknown, args: { invoiceId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...POSTERS, 'canApproveWriteOff'], tool: 'invoice.writeoff', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'invoice.writeoff', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const inv = await lockRow<Inv>(uow.tx, 'Invoice', args.invoiceId)
      if (!['posted', 'partially_paid'].includes(inv.status)) throw new DomainError(Codes.GUARD_FAILED, 'Only an invoice that still has a balance can be written off.')
      const settings = await billingSettings(uow)
      if (!settings.writeOffRequiresApproval && can(actor, 'canApproveWriteOff')) return writeOff(uow, actor, inv.id, reason)
      const req = await requestApproval(uow, actor, { action: 'invoice.writeoff', targetList: 'Invoice', targetId: inv.id, payload: { invoiceId: inv.id, reason }, requiredPermission: 'canApproveWriteOff', summary: `Write off ${inv.ref}` })
      return { id: inv.id, status: 'pending_approval', approvalRequestId: req.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

async function writeOff(uow: UnitOfWork, actor: Actor, invoiceId: string, reason: string) {
  const inv = await lockRow<Inv>(uow.tx, 'Invoice', invoiceId)
  const balance = await balanceOfInvoice(uow.tx, inv.id)
  if (balance <= ZERO) throw new DomainError(Codes.GUARD_FAILED, 'This invoice has no balance to write off.')
  const { on } = await locationDay(uow, inv.locationId, uow.now)
  await post(uow, { clientId: inv.clientId, invoiceId: inv.id, kind: 'write_off', amountMinor: -balance, currencyCode: inv.currencyCode, postedOn: on, entryKey: `writeoff:${inv.id}`, memo: reason })
  await transition(uow, { model: 'Invoice', id: inv.id, from: ['posted', 'partially_paid'], to: 'written_off', actor, eventType: 'invoice.written_off', reason, metadata: { writtenOffMinor: balance.toString() } })
  return { id: inv.id, status: 'written_off', writtenOffMinor: balance.toString() }
}

registerApplier('invoice.writeoff', async (uow, actor, request) => writeOff(uow, actor, (request.payload as { invoiceId: string }).invoiceId, (request.payload as { reason: string }).reason))

// ── Accounting periods ──────────────────────────────────────────────────────────────────────

/** Close a month. From then on the ledger takes no entry dated inside it. */
export async function closeArPeriod(_root: unknown, args: { periodId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePayments', 'canViewFinance'], tool: 'period.close', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'period.close', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const period = await lockRow<{ id: string; endsOn: Date }>(uow.tx, 'ArPeriod', args.periodId)
      const staff = await staffOf(uow, actor).catch(() => null)
      const drafts = await uow.tx.invoice.count({ where: { status: 'draft', createdAt: { lte: new Date(period.endsOn.getTime() + 86_400_000) } } })
      const pending = await uow.tx.payment.count({ where: { status: { in: ['pending', 'unknown'] }, createdAt: { lte: new Date(period.endsOn.getTime() + 86_400_000) } } })
      if (pending) throw new DomainError(Codes.GUARD_FAILED, `${pending} ${pending === 1 ? 'payment is' : 'payments are'} still waiting on the card processor. Check ${pending === 1 ? 'its' : 'their'} status first.`, { reason: 'pending_payments' })
      const row = await transition(uow, { model: 'ArPeriod', id: period.id, from: ['open'], to: 'closed', expectedVersion: args.expectedVersion, actor, eventType: 'period.closed', data: { closedAt: uow.now, closedById: staff?.id ?? null }, metadata: { draftInvoices: drafts } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function reopenArPeriod(_root: unknown, args: { periodId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManagePractice'], tool: 'period.reopen', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'period.reopen', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'ArPeriod', id: args.periodId, from: ['closed'], to: 'open', expectedVersion: args.expectedVersion, actor, eventType: 'period.reopened', reason, data: { closedAt: null, closedById: null } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export { actorUserId }
