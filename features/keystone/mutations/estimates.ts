import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { payloadHash } from '../lib/canonical'
import { planSpend } from '../lib/ledger'
import { dec } from '../lib/decimal'
import { activeFeeVersion, feeItemFor } from '../lib/pricing'
import { depositFor, estimateLineRange, extend, optionTotals, withinCeiling } from '../domain/billing'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { decimalText, staffOf, text, type Ctx } from './clinical'
import { billingSettings, minorText, pick } from './billingInput'

/*
 * Estimates and treatment plans (BUILD-PLAN P4). An estimate is a range, never a promise of one price: each line has a low
 * and a high quantity, so an option has a low and a high total. A version is edited while it is a draft; presenting it freezes
 * it and fixes a hash of exactly what the client will see. Acceptance records who agreed, how, and that hash, and opens a
 * treatment plan whose ceiling is the accepted high. An order that would pass the ceiling is refused until the client agrees to
 * a higher one (overage approval). Expiry is computed when the estimate is read or accepted; nothing runs on a timer.
 */

const SELLERS = ['canPostInvoices', 'canTakePayments', 'canOrder', 'canManagePractice'] as const

type LineIn = { feeItemId?: string | null; description?: string | null; qtyLow: string; qtyHigh?: string | null; optional?: boolean | null }
type OptionIn = { label: string; recommended?: boolean | null; lines: LineIn[] }

async function primaryClient(uow: UnitOfWork, patientId: string) {
  const own = await uow.tx.patientOwnership.findFirst({ where: { patientId, effectiveTo: null, role: 'primary' }, select: { clientId: true } })
  if (!own?.clientId) throw new DomainError(Codes.GUARD_FAILED, 'This patient has no client of record to bill.')
  return own.clientId
}

async function writeOptions(uow: UnitOfWork, versionId: string, feeVersionId: string, options: OptionIn[], currency: string) {
  if (!options.length || options.length > 4) throw new DomainError(Codes.INVALID_INPUT, 'An estimate has one to four options.', { field: 'options' })
  let n = 0
  for (const option of options) {
    if (!option.lines?.length) throw new DomainError(Codes.INVALID_INPUT, `${option.label || 'Each option'} needs at least one line.`, { field: 'lines' })
    const prepared: { feeItemId: string | null; description: string; category: string; taxable: boolean; qtyLow: string; qtyHigh: string; unitPriceMinor: bigint; lowMinor: bigint; highMinor: bigint; optional: boolean; sortOrder: number }[] = []
    let sort = 0
    for (const line of option.lines) {
      const fee = line.feeItemId ? await uow.tx.feeItem.findFirst({ where: { id: line.feeItemId, versionId: feeVersionId } }) : null
      if (line.feeItemId && !fee) throw new DomainError(Codes.NOT_FOUND, 'That fee is not in the published fee schedule.', { field: 'feeItemId' })
      if (!fee && !line.description?.trim()) throw new DomainError(Codes.INVALID_INPUT, 'Each line needs a fee or a description.', { field: 'description' })
      const qtyLow = decimalText(line.qtyLow, 'low quantity')
      const qtyHigh = decimalText(line.qtyHigh ?? line.qtyLow, 'high quantity')
      const unit = fee?.priceMinor ?? 0n
      let range
      try { range = estimateLineRange({ qtyLow, qtyHigh, unitPriceMinor: unit }) } catch (e) { throw new DomainError(Codes.INVALID_INPUT, (e as Error).message, { field: 'quantity' }) }
      prepared.push({ feeItemId: fee?.id ?? null, description: (line.description?.trim() || fee?.name || '').slice(0, 200), category: fee?.category ?? 'other', taxable: fee ? !['professional_service', 'rx_animal_drug', 'vaccine_administered', 'boarding', 'grooming'].includes(fee.taxCategory) : false, qtyLow, qtyHigh, unitPriceMinor: unit, ...range, optional: line.optional === true, sortOrder: sort += 1 })
    }
    const totals = optionTotals(prepared)
    const row = await uow.tx.estimateOption.create({ data: { estimateVersionId: versionId, label: text(option.label, 'option name', 80), recommended: option.recommended === true, currencyCode: currency, ...totals } })
    for (const p of prepared) await uow.tx.estimateLine.create({ data: { optionId: row.id, ...p } })
    n += 1
  }
  return n
}

export async function createEstimate(_root: unknown, args: { patientId: string; locationId: string; encounterId?: string | null; title: string; elective?: boolean | null; options: OptionIn[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.create', humanOnly: true }, args, async actor => {
    const title = text(args.title, 'title', 160)
    const result = await command(context.prisma, { name: 'estimate.create', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor).catch(() => null)
      const clientId = await primaryClient(uow, args.patientId)
      const fee = await activeFeeVersion(uow.tx)
      const practice = await billingSettings(uow)
      const ref = await nextReference(uow.tx, 'EST', uow.now)
      const estimate = await uow.tx.estimate.create({ data: { ref, patientId: args.patientId, clientId, locationId: args.locationId, encounterId: args.encounterId ?? null, title, elective: args.elective === true, status: 'open', createdById: staff?.id ?? null } })
      const version = await uow.tx.estimateVersion.create({ data: { estimateId: estimate.id, versionNo: 1, status: 'draft', feeScheduleVersionId: fee.id } })
      const options = await writeOptions(uow, version.id, fee.id, args.options, practice.currencyCode)
      auditCreate(uow, actor, 'Estimate', estimate.id, 'estimate.created', { ref, options, feeSchedule: fee.versionNo })
      return { id: estimate.id, ref, versionId: version.id, version: version.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Freeze the draft: fix the validity date and the hash of everything the client will be shown. */
export async function presentEstimate(_root: unknown, args: { versionId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.present', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'estimate.present', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const practice = await billingSettings(uow)
      const options = await uow.tx.estimateOption.findMany({ where: { estimateVersionId: args.versionId }, include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } })
      if (!options.length) throw new DomainError(Codes.GUARD_FAILED, 'Add an option before presenting the estimate.')
      const days = practice.estimateValidityDays
      const validUntil = new Date(uow.now.getTime() + days * 86_400_000)
      const quoteHash = payloadHash({ versionId: args.versionId, options: options.map(o => ({ label: o.label, low: o.lowTotalMinor, high: o.highTotalMinor, lines: o.lines.map(l => [l.description, l.qtyLow.toString(), l.qtyHigh.toString(), l.unitPriceMinor, l.lowMinor, l.highMinor, l.optional]) })), validUntil: validUntil.toISOString() })
      const row = await transition(uow, { model: 'EstimateVersion', id: args.versionId, from: ['draft'], to: 'presented', expectedVersion: args.expectedVersion, actor, eventType: 'estimate.presented', data: { presentedAt: uow.now, validUntil, quoteHash } })
      return { id: row.id, status: row.status, quoteHash, validUntil: validUntil.toISOString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** A new draft copied from the latest version; the presented one it replaces is superseded. */
export async function reviseEstimate(_root: unknown, args: { estimateId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.revise', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'estimate.revise', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const estimate = await lockRow<{ id: string; status: string }>(uow.tx, 'Estimate', args.estimateId)
      if (estimate.status !== 'open') throw new DomainError(Codes.GUARD_FAILED, 'This estimate was already accepted or closed.')
      const last = await uow.tx.estimateVersion.findFirst({ where: { estimateId: estimate.id }, orderBy: { versionNo: 'desc' }, include: { options: { include: { lines: true } } } })
      if (!last) throw new DomainError(Codes.NOT_FOUND, 'Estimate has no version.')
      if (last.status === 'draft') throw new DomainError(Codes.GUARD_FAILED, 'The latest version is still a draft. Edit or present it.')
      const fee = await activeFeeVersion(uow.tx)
      if (last.status === 'presented') await transition(uow, { model: 'EstimateVersion', id: last.id, from: ['presented'], to: 'superseded', actor, eventType: 'estimate.superseded' })
      const next = await uow.tx.estimateVersion.create({ data: { estimateId: estimate.id, versionNo: last.versionNo + 1, status: 'draft', feeScheduleVersionId: fee.id } })
      // Prices are taken again from the schedule in force now: an item is found by its code in the new version.
      const codeOf = new Map((await uow.tx.feeItem.findMany({ where: { id: { in: last.options.flatMap(o => o.lines.map(l => l.feeItemId)).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map(f => [f.id, f.code]))
      const nowItems = new Map((await uow.tx.feeItem.findMany({ where: { versionId: fee.id }, select: { id: true, code: true } })).map(f => [f.code, f.id]))
      await writeOptions(uow, next.id, fee.id, last.options.map(o => ({ label: o.label, recommended: o.recommended, lines: o.lines.map(l => ({ feeItemId: (l.feeItemId && nowItems.get(codeOf.get(l.feeItemId) ?? '')) || null, description: l.description, qtyLow: l.qtyLow.toString(), qtyHigh: l.qtyHigh.toString(), optional: l.optional })) })), last.options[0].currencyCode)
      auditCreate(uow, actor, 'EstimateVersion', next.id, 'estimate.revised', { versionNo: next.versionNo })
      return { id: next.id, versionNo: next.versionNo }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function declineEstimate(_root: unknown, args: { versionId: string; reason?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.decline', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'estimate.decline', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<{ id: string; status: string; estimateId: string }>(uow, { model: 'EstimateVersion', id: args.versionId, from: ['presented'], to: 'declined', expectedVersion: args.expectedVersion, actor, eventType: 'estimate.declined', reason: args.reason ?? null, data: { declineReason: String(args.reason ?? '').slice(0, 300) } })
      await uow.tx.estimate.updateMany({ where: { id: row.estimateId, status: 'open' }, data: { status: 'closed', version: { increment: 1 } } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Staff button: mark presented estimates past their date as expired. Acceptance also refuses a lapsed one, so this is housekeeping for the list. */
export async function refreshEstimates(_root: unknown, args: { idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.refresh', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'estimate.refresh', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const lapsed = await uow.tx.estimateVersion.findMany({ where: { status: 'presented', validUntil: { lt: uow.now } }, select: { id: true } })
      for (const l of lapsed) await transition(uow, { model: 'EstimateVersion', id: l.id, from: ['presented'], to: 'expired', actor, eventType: 'estimate.expired' })
      return { expired: lapsed.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * The client agrees to one option. Records the acceptance with the hash they saw, opens the treatment plan with the option's
 * low and high as the accepted range, and, for elective work, asks for the practice's deposit.
 */
export async function acceptEstimate(_root: unknown, args: { versionId: string; optionId: string; signerId: string; method: string; signatureText?: string | null; witnessId?: string | null; quoteHash: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'estimate.accept', humanOnly: true }, args, async actor => {
    const method = pick(args.method, ['in_person_signature', 'esign_link', 'verbal_witnessed'] as const, 'method')
    const result = await command(context.prisma, { name: 'estimate.accept', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const version = await lockRow<{ id: string; estimateId: string; status: string; quoteHash: string; validUntil: Date | null; version: number }>(uow.tx, 'EstimateVersion', args.versionId)
      if (version.status !== 'presented') throw new DomainError(Codes.GUARD_FAILED, version.status === 'accepted' ? 'This estimate was already accepted.' : `This estimate is ${version.status.replaceAll('_', ' ')}; it cannot be accepted.`, { reason: 'not_presented' })
      if (version.validUntil && version.validUntil <= uow.now) throw new DomainError(Codes.GUARD_FAILED, 'This estimate has expired. Make a new version and present it again.', { reason: 'expired' })
      if (args.quoteHash !== version.quoteHash) throw new DomainError(Codes.GUARD_FAILED, 'The estimate changed since it was shown. Show the client the current version.', { reason: 'quote_changed' })
      if (method === 'verbal_witnessed' && !args.witnessId) throw new DomainError(Codes.INVALID_INPUT, 'A verbal acceptance needs a staff witness.', { field: 'witnessId' })
      if (method !== 'esign_link' && !String(args.signatureText ?? '').trim()) throw new DomainError(Codes.INVALID_INPUT, 'Record the name the client signed or gave.', { field: 'signatureText' })
      const estimate = await lockRow<{ id: string; clientId: string; patientId: string; locationId: string; elective: boolean; status: string; ref: string }>(uow.tx, 'Estimate', version.estimateId)
      if (estimate.status !== 'open') throw new DomainError(Codes.GUARD_FAILED, 'This estimate is already closed.')
      const signer = await uow.tx.clientPerson.findUnique({ where: { id: args.signerId }, select: { clientId: true, canApproveTreatment: true, firstName: true, lastName: true } })
      if (!signer || signer.clientId !== estimate.clientId) throw new DomainError(Codes.NOT_FOUND, 'The signer is not part of this household.', { field: 'signerId' })
      if (!signer.canApproveTreatment) throw new DomainError(Codes.NOT_AUTHORIZED, `${signer.firstName} ${signer.lastName} cannot approve treatment for this household.`)
      const option = await uow.tx.estimateOption.findFirst({ where: { id: args.optionId, estimateVersionId: version.id } })
      if (!option) throw new DomainError(Codes.NOT_FOUND, 'That option is not on this estimate.', { field: 'optionId' })
      const lines = await uow.tx.estimateLine.findMany({ where: { optionId: option.id }, orderBy: { sortOrder: 'asc' } })
      await uow.tx.estimateAcceptance.create({ data: { estimateVersionId: version.id, optionId: option.id, signerId: args.signerId, method, quoteHash: version.quoteHash, signatureText: String(args.signatureText ?? '').slice(0, 160), witnessId: args.witnessId ?? null, recordedById: staff.id, at: uow.now } })
      await transition(uow, { model: 'EstimateVersion', id: version.id, from: ['presented'], to: 'accepted', expectedVersion: args.expectedVersion, actor, eventType: 'estimate.accepted', metadata: { optionId: option.id, method } })
      await transition(uow, { model: 'Estimate', id: estimate.id, from: ['open'], to: 'accepted', actor, eventType: 'estimate.closed.accepted', data: { acceptedVersionId: version.id, acceptedOptionId: option.id } })
      const ref = await nextReference(uow.tx, 'TPL', uow.now)
      const plan = await uow.tx.treatmentPlan.create({ data: { ref, estimateId: estimate.id, estimateVersionId: version.id, optionId: option.id, patientId: estimate.patientId, clientId: estimate.clientId, locationId: estimate.locationId, status: 'active', acceptedLowMinor: option.lowTotalMinor, acceptedHighMinor: option.highTotalMinor, currencyCode: option.currencyCode } })
      for (const l of lines) await uow.tx.treatmentPlanItem.create({ data: { planId: plan.id, estimateLineId: l.id, description: l.description, status: 'planned', projectedMinor: l.highMinor } })
      let deposit: { id: string; ref: string; amountMinor: string } | null = null
      const practice = await billingSettings(uow)
      if (estimate.elective && practice.electiveDepositPct && dec(practice.electiveDepositPct).gt(0)) {
        const amount = depositFor({ lowTotalMinor: option.lowTotalMinor, highTotalMinor: option.highTotalMinor }, practice.electiveDepositPct, practice.depositBasis)
        if (amount > 0n) {
          const d = await uow.tx.deposit.create({ data: { ref: await nextReference(uow.tx, 'DEP', uow.now), clientId: estimate.clientId, estimateId: estimate.id, planId: plan.id, requestedMinor: amount, currencyCode: option.currencyCode, status: 'requested' } })
          deposit = { id: d.id, ref: d.ref, amountMinor: amount.toString() }
        }
      }
      auditCreate(uow, actor, 'TreatmentPlan', plan.id, 'plan.opened', { ref, lowMinor: option.lowTotalMinor.toString(), highMinor: option.highTotalMinor.toString(), items: lines.length, deposit: deposit?.amountMinor ?? null })
      return { planId: plan.id, planRef: ref, depositId: deposit?.id ?? null, depositMinor: deposit?.amountMinor ?? null }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── The overage gate ─────────────────────────────────────────────────────────────────────────

/**
 * Called when an order is placed for a patient with an active plan. The order takes the planned item that matches its fee, or
 * becomes an extra item; either way the plan's used total plus this cost must stay within the accepted high, checked with the plan
 * row locked so two orders at once cannot both pass. Past the ceiling the order is refused until an overage approval is recorded.
 */
export async function attachOrderToPlan(uow: UnitOfWork, input: { patientId: string; orderId: string; description: string; drugId?: string | null; orderKind: string; quantity?: string | null }) {
  const plan = await uow.tx.treatmentPlan.findFirst({ where: { patientId: input.patientId, status: 'active' }, select: { id: true } })
  if (!plan) return null
  const fee = await uow.tx.feeScheduleVersion.findFirst({ where: { status: 'published', schedule: { code: 'standard' } }, select: { id: true } })
  const item = fee ? await feeItemFor(uow.tx, fee.id, { drugId: input.drugId ?? null, orderKind: input.drugId ? null : input.orderKind }) : null
  const qty = input.quantity && /^\d{1,9}(\.\d{1,6})?$/.test(input.quantity) && dec(input.quantity).gt(0) ? input.quantity : '1'
  const cost = item ? extend(qty, item.priceMinor, item.minimumChargeMinor) : 0n
  if (cost === 0n) return null
  const locked = await lockRow<{ id: string; acceptedHighMinor: bigint; status: string }>(uow.tx, 'TreatmentPlan', plan.id)
  const used = await planSpend(uow.tx, locked.id)
  const planned = await uow.tx.treatmentPlanItem.findFirst({ where: { planId: locked.id, status: 'planned', estimateLine: { feeItemId: item!.id } }, orderBy: { createdAt: 'asc' } })
  const projected = planned ? planned.projectedMinor : cost
  if (!withinCeiling(used, projected, locked.acceptedHighMinor)) {
    throw new DomainError(Codes.GUARD_FAILED, 'This would go past the amount the client agreed to. Ask the client to approve a higher amount first.', { reason: 'overage', field: 'acceptedHighMinor' })
  }
  if (planned) await uow.tx.treatmentPlanItem.update({ where: { id: planned.id }, data: { status: 'ordered', orderId: input.orderId, version: { increment: 1 } } })
  else await uow.tx.treatmentPlanItem.create({ data: { planId: locked.id, orderId: input.orderId, description: input.description.slice(0, 200), status: 'ordered', projectedMinor: cost } })
  return { planId: locked.id, usedMinor: (used + projected).toString() }
}

/** The client agrees to a higher ceiling (or a veterinarian overrides in an emergency). Written once, never edited. */
export async function recordOverageApproval(_root: unknown, args: { planId: string; newHighMinor: string; method: string; approverId?: string | null; witnessId?: string | null; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'plan.overage', humanOnly: true }, args, async actor => {
    const method = pick(args.method, ['in_person', 'phone_witnessed', 'esign_link', 'emergency_override'] as const, 'method')
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'plan.overage', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const newHigh = minorText(args.newHighMinor, 'new amount')
      const plan = await lockRow<{ id: string; clientId: string; acceptedHighMinor: bigint; status: string; version: number }>(uow.tx, 'TreatmentPlan', args.planId)
      if (newHigh <= plan.acceptedHighMinor) throw new DomainError(Codes.INVALID_INPUT, 'The new amount must be more than what the client already agreed to.', { field: 'newHighMinor' })
      if (method === 'emergency_override') {
        if (staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian can override the amount in an emergency.')
      } else {
        if (!args.approverId) throw new DomainError(Codes.INVALID_INPUT, 'Choose who in the household agreed.', { field: 'approverId' })
        const person = await uow.tx.clientPerson.findUnique({ where: { id: args.approverId }, select: { clientId: true, canApproveTreatment: true } })
        if (!person || person.clientId !== plan.clientId || !person.canApproveTreatment) throw new DomainError(Codes.NOT_AUTHORIZED, 'That person cannot approve treatment costs for this household.')
        if (method === 'phone_witnessed' && !args.witnessId) throw new DomainError(Codes.INVALID_INPUT, 'A phone approval needs a staff witness.', { field: 'witnessId' })
      }
      await uow.tx.overageApproval.create({ data: { planId: plan.id, previousHighMinor: plan.acceptedHighMinor, newHighMinor: newHigh, method, approverId: method === 'emergency_override' ? null : args.approverId, witnessId: args.witnessId ?? null, emergencyOverrideById: method === 'emergency_override' ? staff.id : null, recordedById: staff.id, reason, at: uow.now } })
      await transition(uow, { model: 'TreatmentPlan', id: plan.id, from: ['active'], to: 'active', expectedVersion: args.expectedVersion, actor, eventType: 'plan.ceiling.raised', reason, data: { acceptedHighMinor: newHigh }, metadata: { from: plan.acceptedHighMinor.toString(), to: newHigh.toString(), method } })
      return { planId: plan.id, acceptedHighMinor: newHigh.toString() }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function closePlan(_root: unknown, args: { planId: string; expectedVersion: number; cancel?: boolean | null; reason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SELLERS], tool: 'plan.close', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'plan.close', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'TreatmentPlan', id: args.planId, from: ['active'], to: args.cancel ? 'cancelled' : 'completed', expectedVersion: args.expectedVersion, actor, eventType: args.cancel ? 'plan.cancelled' : 'plan.completed', reason: args.reason ?? null })
      await uow.tx.treatmentPlanItem.updateMany({ where: { planId: args.planId, status: 'planned' }, data: { status: 'cancelled', version: { increment: 1 } } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}
