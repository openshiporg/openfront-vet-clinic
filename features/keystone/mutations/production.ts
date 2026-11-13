import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { actorUserId, type Actor } from '../lib/actor'
import { requestApproval } from '../lib/approval'
import { registerApplier } from '../lib/approvalAppliers'
import { nextReference } from '../lib/sequence'
import { sha256 } from '../lib/canonical'
import type { UnitOfWork } from '../lib/unitOfWork'
import { bpsOf, csvHash, parseCommissionRules, parseRules, payrollCsv, productionBase, ruleHash, totalsByStaff, totalsHash } from '../domain/pay'
import { gated } from './agentGuard'
import { text, type Ctx } from './clinical'
import { dateOnly, minorText } from './billingInput'

/*
 * Production and pay (STATE-MACHINES §20). Manager and owner only; no agent tool reaches any of it.
 *  - A rule version is drafted, then published through an approval; a published version never changes and the newest one in force on the
 *    posting day is the one used.
 *  - Credits are derived when an invoice posts, in the same transaction, one per charge line, staff member and rule version (the DB key
 *    makes a second run a no-op). A corrected or refunded charge never edits a credit: an adjustment line is added, asked for by one
 *    person and approved by another who is not the doctor concerned.
 *  - A pay period goes open → calculated → approved → exported → locked. Totals are frozen at calculation, and approval is checked against
 *    the totals hash that was shown.
 */

const PAY = ['canViewFinance', 'canManagePayments'] as const
const GROOM_SOURCES = new Set(['groom', 'grooming', 'groom_appointment'])

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** The newest published rule version in force on a day. */
export async function ruleVersionOn(uow: UnitOfWork, on: string) {
  return uow.tx.productionRuleVersion.findFirst({ where: { status: 'published', effectiveFrom: { lte: new Date(`${on}T00:00:00Z`) } }, orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }] })
}

/**
 * Called by invoice posting. Writes the credits and commissions for the invoice's lines and returns how many. Running it again for the
 * same invoice changes nothing. Lines without a performer, or in a category without a rule, earn nothing.
 */
export async function deriveProduction(uow: UnitOfWork, invoiceId: string) {
  const inv = await uow.tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, locationId: true, postedOn: true } })
  if (!inv?.postedOn) return { credits: 0, commissions: 0 }
  const on = day(inv.postedOn)!
  const version = await ruleVersionOn(uow, on)
  if (!version) return { credits: 0, commissions: 0 }
  const rules = parseRules(version.rules)
  const commissionRules = parseCommissionRules(version.commissionRules)
  const lines = await uow.tx.chargeLine.findMany({ where: { invoiceId: inv.id, reversedAt: null }, include: { feeItem: { select: { productionCategory: true, category: true } } } })
  let credits = 0
  let commissions = 0
  for (const line of lines) {
    if (!line.performedById) continue
    const base = productionBase(line)
    if (base === 0n) continue
    // The production group set on the price-list item, else its fee category (exam, surgery, laboratory…), so a published price list
    // that predates production groups still earns: rules are keyed on those names.
    const category = line.feeItem?.productionCategory || line.feeItem?.category || ''
    const rule = category ? rules[category] : undefined
    if (rule) {
      const key = sha256(`credit:${line.id}:${line.performedById}:${version.id}`)
      const exists = await uow.tx.productionCredit.findUnique({ where: { entryKey: key }, select: { id: true } })
      if (!exists) {
        await uow.tx.productionCredit.create({ data: { staffId: line.performedById, chargeLineId: line.id, invoiceId: inv.id, ruleVersionId: version.id, locationId: inv.locationId, category, basis: rule.basis, kind: 'credit', baseMinor: base, bps: rule.bps, amountMinor: bpsOf(base, rule.bps), creditedOn: inv.postedOn, entryKey: key } })
        credits++
      }
    }
    const source = GROOM_SOURCES.has(line.sourceType) ? 'groom' : line.sourceType
    const crule = commissionRules[source]
    if (crule) {
      const key = sha256(`commission:${line.id}:${line.performedById}:${version.id}`)
      const exists = await uow.tx.commission.findUnique({ where: { entryKey: key }, select: { id: true } })
      if (!exists) {
        await uow.tx.commission.create({ data: { staffId: line.performedById, chargeLineId: line.id, ruleVersionId: version.id, sourceType: source, sourceId: line.sourceId, baseMinor: base, bps: crule.bps, amountMinor: bpsOf(base, crule.bps), earnedOn: inv.postedOn, entryKey: key } })
        commissions++
      }
    }
  }
  return { credits, commissions }
}

/* ───────── Rule versions ───────── */

export async function draftRuleVersion(_root: unknown, args: { label: string; effectiveFrom: string; rules: unknown; commissionRules?: unknown; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'production.rules.draft', humanOnly: true }, args, async actor => {
    const label = text(args.label, 'label', 120)
    const effectiveFrom = dateOnly(args.effectiveFrom, 'effective from')
    let rules: ReturnType<typeof parseRules>
    let commissionRules: ReturnType<typeof parseCommissionRules>
    try { rules = parseRules(args.rules); commissionRules = parseCommissionRules(args.commissionRules ?? {}) } catch (error) { throw new DomainError(Codes.INVALID_INPUT, (error as Error).message, { field: 'rules' }) }
    if (!Object.keys(rules).length && !Object.keys(commissionRules).length) throw new DomainError(Codes.INVALID_INPUT, 'Give at least one production or commission rule.', { field: 'rules' })
    const result = await command(context.prisma, { name: 'production.rules.draft', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const last = await uow.tx.productionRuleVersion.aggregate({ _max: { versionNo: true } })
      const row = await uow.tx.productionRuleVersion.create({ data: { versionNo: (last._max.versionNo ?? 0) + 1, label, rules: rules as never, commissionRules: commissionRules as never, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), status: 'draft', ruleHash: ruleHash(rules, commissionRules) } })
      auditCreate(uow, actor, 'ProductionRuleVersion', row.id, 'production.rules_drafted', { versionNo: row.versionNo })
      return { id: row.id, versionNo: row.versionNo, status: 'draft', ruleHash: row.ruleHash }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Ask for a draft to be published. A different manager approves it; the approval is for this exact rule hash. */
export async function requestRulePublication(_root: unknown, args: { ruleVersionId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'production.rules.publish', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'production.rules.publish', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await lockRow<Record<string, any>>(uow.tx, 'ProductionRuleVersion', args.ruleVersionId)
      if (row.status !== 'draft') throw new DomainError(Codes.INVALID_TRANSITION, 'Only a draft can be published.', { currentStatus: row.status })
      const approval = await requestApproval(uow, actor, { action: 'production.rules_publish', targetList: 'ProductionRuleVersion', targetId: row.id, payload: { ruleHash: row.ruleHash }, requiredPermission: 'canManagePayments', summary: `Publish production rules "${row.label}" from ${day(row.effectiveFrom)}` })
      return { approvalRequestId: (approval as any).id, status: 'draft' }
    })
    return { replay: result.replay, ...result.value }
  })
}

registerApplier('production.rules_publish', async (uow, actor, request) => {
  const row = await lockRow<Record<string, any>>(uow.tx, 'ProductionRuleVersion', request.targetId)
  if (row.status !== 'draft' || row.ruleHash !== request.payload?.ruleHash) throw new DomainError(Codes.APPROVAL_MISMATCH, 'The rules changed after they were approved.')
  await transition(uow, { model: 'ProductionRuleVersion', id: row.id, from: ['draft'], to: 'published', actor, eventType: 'production.rules_published', data: { publishedAt: uow.now } })
  return { id: row.id, status: 'published' }
})

/* ───────── Adjustments (separation of duties) ───────── */

/** Ask to add or take away production on a credit (a corrected or refunded charge). Amount is signed cents as text. */
export async function requestProductionAdjustment(_root: unknown, args: { creditId: string; amountMinor: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'production.adjust', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const negative = String(args.amountMinor ?? '').trim().startsWith('-')
    const amount = minorText(String(args.amountMinor ?? '').trim().replace(/^-/, ''), 'amount')
    const signed = negative ? -amount : amount
    const result = await command(context.prisma, { name: 'production.adjust', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const credit = await uow.tx.productionCredit.findUnique({ where: { id: args.creditId }, select: { id: true, kind: true, amountMinor: true, staffId: true } })
      if (!credit) throw new DomainError(Codes.NOT_FOUND, 'Credit not found.')
      if (credit.kind !== 'credit') throw new DomainError(Codes.GUARD_FAILED, 'Adjust the original credit, not an adjustment.')
      const prior = await uow.tx.productionCredit.aggregate({ where: { adjustsId: credit.id }, _sum: { amountMinor: true } })
      if (credit.amountMinor + (prior._sum.amountMinor ?? 0n) + signed < 0n) throw new DomainError(Codes.GUARD_FAILED, 'An adjustment cannot take more than the credit is worth.')
      const approval = await requestApproval(uow, actor, { action: 'production.adjust', targetList: 'ProductionCredit', targetId: credit.id, payload: { amountMinor: signed.toString(), reason, requestedBy: actorUserId(actor) }, requiredPermission: 'canManagePayments', summary: `Adjust production by ${signed.toString()} cents: ${reason}` })
      return { approvalRequestId: (approval as any).id }
    })
    return { replay: result.replay, ...result.value }
  })
}

registerApplier('production.adjust', async (uow, actor, request) => {
  const approver = actorUserId(actor)
  const credit = await lockRow<Record<string, any>>(uow.tx, 'ProductionCredit', request.targetId)
  const amount = BigInt(request.payload.amountMinor)
  const key = sha256(`adjust:${request.id}`)
  const existing = await uow.tx.productionCredit.findUnique({ where: { entryKey: key }, select: { id: true } })
  if (existing) return { id: existing.id }
  // Checked again here, with the credit row locked: two requests made while both were pending must not together take more than it is worth.
  const prior = await uow.tx.productionCredit.aggregate({ where: { adjustsId: credit.id }, _sum: { amountMinor: true } })
  if (BigInt(credit.amountMinor) + (prior._sum.amountMinor ?? 0n) + amount < 0n) throw new DomainError(Codes.GUARD_FAILED, 'An adjustment cannot take more than the credit is worth. Other adjustments to this credit were approved first.')
  const row = await uow.tx.productionCredit.create({ data: { staffId: credit.staffId, ruleVersionId: credit.ruleVersionId, locationId: credit.locationId, invoiceId: credit.invoiceId, category: credit.category, basis: credit.basis, kind: 'adjustment', adjustsId: credit.id, baseMinor: 0n, bps: 0, amountMinor: amount, reason: String(request.payload.reason), requestedById: request.payload.requestedBy, approvedById: approver, creditedOn: new Date(`${(await uow.tx.$queryRaw<{ d: string }[]>`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)[0].d}T00:00:00Z`), entryKey: key } })
  auditCreate(uow, actor, 'ProductionCredit', row.id, 'production.adjusted', { adjusts: credit.id, amountMinor: amount.toString() })
  return { id: row.id }
})

/* ───────── Pay periods ───────── */

export async function openPayPeriod(_root: unknown, args: { startsOn: string; endsOn: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.create', humanOnly: true }, args, async actor => {
    const startsOn = dateOnly(args.startsOn, 'start')
    const endsOn = dateOnly(args.endsOn, 'end')
    if (endsOn < startsOn) throw new DomainError(Codes.INVALID_INPUT, 'The period cannot end before it starts.', { field: 'endsOn' })
    const result = await command(context.prisma, { name: 'pay.period.create', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const ref = await nextReference(uow.tx, 'PAY', uow.now)
      const row = await uow.tx.payPeriod.create({ data: { ref, startsOn: new Date(`${startsOn}T00:00:00Z`), endsOn: new Date(`${endsOn}T00:00:00Z`), status: 'open' } })
      return { id: row.id, ref, status: 'open' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Gather every unassigned credit and commission dated up to the period's end, freeze the per-person totals and hash them. */
export async function calculatePayPeriod(_root: unknown, args: { periodId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.calculate', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'pay.period.calculate', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const period = await lockRow<Record<string, any>>(uow.tx, 'PayPeriod', args.periodId)
      if (period.status !== 'open') throw new DomainError(Codes.INVALID_TRANSITION, 'Only an open period can be calculated. Reopen a calculated one first.', { currentStatus: period.status })
      // Everything not yet in a period up to the period's end: a line dated inside an earlier period that was already calculated (a late
      // invoice, an adjustment) is paid in this one rather than never.
      const upTo = { lte: period.endsOn }
      await uow.tx.productionCredit.updateMany({ where: { periodId: null, creditedOn: upTo }, data: { periodId: period.id } })
      await uow.tx.commission.updateMany({ where: { periodId: null, earnedOn: upTo }, data: { periodId: period.id } })
      const credits = await uow.tx.productionCredit.findMany({ where: { periodId: period.id }, select: { staffId: true, amountMinor: true } })
      const commissions = await uow.tx.commission.findMany({ where: { periodId: period.id }, select: { staffId: true, amountMinor: true } })
      const totals = totalsByStaff(credits.filter(c => c.staffId).map(c => ({ staffId: c.staffId!, amountMinor: c.amountMinor })), commissions.filter(c => c.staffId).map(c => ({ staffId: c.staffId!, amountMinor: c.amountMinor })))
      const hash = totalsHash(totals)
      const row = await transition<Record<string, any>>(uow, { model: 'PayPeriod', id: period.id, from: ['open'], to: 'calculated', expectedVersion: args.expectedVersion, actor, eventType: 'pay.calculated', data: { totals: totals as never, totalsHash: hash, calculatedAt: uow.now } })
      return { id: row.id, status: row.status, totals, totalsHash: hash, credits: credits.length, commissions: commissions.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function reopenPayPeriod(_root: unknown, args: { periodId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.reopen', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'pay.period.reopen', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'PayPeriod', id: args.periodId, from: ['calculated'], to: 'open', expectedVersion: args.expectedVersion, actor, eventType: 'pay.reopened', reason, data: { totals: [] as never, totalsHash: '', calculatedAt: null } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Ask for approval of the calculated totals. The approval names the totals hash; another manager decides it. */
export async function requestPayPeriodApproval(_root: unknown, args: { periodId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.approve', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'pay.period.approve', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const period = await lockRow<Record<string, any>>(uow.tx, 'PayPeriod', args.periodId)
      if (period.status !== 'calculated') throw new DomainError(Codes.INVALID_TRANSITION, 'Calculate the period first.', { currentStatus: period.status })
      const approval = await requestApproval(uow, actor, { action: 'pay_period.approve', targetList: 'PayPeriod', targetId: period.id, payload: { totalsHash: period.totalsHash }, requiredPermission: 'canManagePayments', summary: `Approve pay period ${period.ref}` })
      return { approvalRequestId: (approval as any).id, totalsHash: period.totalsHash }
    })
    return { replay: result.replay, ...result.value }
  })
}

registerApplier('pay_period.approve', async (uow, actor, request) => {
  const period = await lockRow<Record<string, any>>(uow.tx, 'PayPeriod', request.targetId)
  if (period.totalsHash !== request.payload?.totalsHash) throw new DomainError(Codes.APPROVAL_MISMATCH, 'The totals changed after they were shown for approval.')
  await transition(uow, { model: 'PayPeriod', id: period.id, from: ['calculated'], to: 'approved', actor, eventType: 'pay.approved', data: { approvedById: actorUserId(actor), approvedAt: uow.now } })
  return { id: period.id, status: 'approved' }
})

/** Build the payroll file for an approved period. Once per period: pressing again returns the same file. */
export async function exportPayPeriod(_root: unknown, args: { periodId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.export', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'pay.period.export', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const period = await lockRow<Record<string, any>>(uow.tx, 'PayPeriod', args.periodId)
      const prior = await uow.tx.payrollExportBatch.findFirst({ where: { periodId: period.id } })
      if (prior) return { id: prior.id, ref: prior.ref, rows: prior.rows, contentHash: prior.contentHash, csv: prior.csv, status: period.status }
      if (period.status !== 'approved') throw new DomainError(Codes.INVALID_TRANSITION, 'Only an approved period can be exported.', { currentStatus: period.status })
      const totals = (period.totals as { staffId: string; productionMinor: string; commissionMinor: string }[] | null) ?? []
      const staff = await uow.tx.staffMember.findMany({ where: { id: { in: totals.map(t => t.staffId) } }, select: { id: true, displayName: true, employment: true } })
      const by = new Map(staff.map(s => [s.id, s]))
      const csv = payrollCsv({ ref: period.ref, startsOn: day(period.startsOn)!, endsOn: day(period.endsOn)! }, totals.map(t => ({ staffId: t.staffId, name: by.get(t.staffId)?.displayName ?? '', employeeRef: String((by.get(t.staffId) as any)?.employment ?? ''), productionMinor: BigInt(t.productionMinor), commissionMinor: BigInt(t.commissionMinor) })))
      const ref = await nextReference(uow.tx, 'PXB', uow.now)
      const batch = await uow.tx.payrollExportBatch.create({ data: { ref, periodId: period.id, format: 'csv', rows: totals.length, contentHash: csvHash(csv), csv, exportedById: actorUserId(actor), exportedAt: uow.now } })
      await transition(uow, { model: 'PayPeriod', id: period.id, from: ['approved'], to: 'exported', actor, eventType: 'pay.exported', metadata: { batchId: batch.id, contentHash: batch.contentHash } })
      auditCreate(uow, actor, 'PayrollExportBatch', batch.id, 'pay.exported', { rows: totals.length, contentHash: batch.contentHash })
      return { id: batch.id, ref, rows: totals.length, contentHash: batch.contentHash, csv, status: 'exported' }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function lockPayPeriod(_root: unknown, args: { periodId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...PAY], tool: 'pay.period.lock', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'pay.period.lock', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'PayPeriod', id: args.periodId, from: ['exported'], to: 'locked', expectedVersion: args.expectedVersion, actor, eventType: 'pay.locked', data: { lockedAt: uow.now } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export type { Actor }
