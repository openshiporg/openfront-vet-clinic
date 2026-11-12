import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { requestApproval } from '../lib/approval'
import { registerApplier } from '../lib/approvalAppliers'
import { DomainError, Codes } from '../lib/errors'
import { STANDARD_SCHEDULE } from '../lib/pricing'
import { FEE_CATEGORIES, TAX_CATEGORIES } from '../models/billing'
import { gated } from './agentGuard'
import { staffOf, text, type Ctx } from './clinical'
import { dateOnly, minorText } from './billingInput'

/*
 * Fee schedules (BUILD-PLAN P4). A version is edited while it is a draft, sent for approval by someone who
 * manages fees, and published by a different person who approves fees (maker-checker). Publishing retires the
 * version it replaces; a published version never changes, so an estimate or invoice that copied its prices
 * keeps them. There is no timer: the version in force is the newest published one.
 */

async function standardSchedule(uow: { tx: any }) {
  const found = await uow.tx.feeSchedule.findFirst({ where: { code: STANDARD_SCHEDULE }, select: { id: true } })
  if (found) return found
  return uow.tx.feeSchedule.create({ data: { name: 'Standard fees', code: STANDARD_SCHEDULE }, select: { id: true } })
}

/** Start a new draft from the published version (every item copied), or an empty one when none exists yet. */
export async function startFeeDraft(_root: unknown, args: { label: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageFees'], tool: 'fees.draft', humanOnly: true }, args, async actor => {
    const label = text(args.label, 'label', 80)
    const result = await command(context.prisma, { name: 'fees.draft', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const schedule = await standardSchedule(uow)
      const open = await uow.tx.feeScheduleVersion.findFirst({ where: { scheduleId: schedule.id, status: { in: ['draft', 'pending_approval'] } }, select: { id: true } })
      if (open) throw new DomainError(Codes.GUARD_FAILED, 'There is already a draft fee schedule. Finish or discard it first.', { reason: 'draft_exists' })
      const last = await uow.tx.feeScheduleVersion.findFirst({ where: { scheduleId: schedule.id }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } })
      const current = await uow.tx.feeScheduleVersion.findFirst({ where: { scheduleId: schedule.id, status: 'published' }, select: { id: true } })
      const row = await uow.tx.feeScheduleVersion.create({ data: { scheduleId: schedule.id, versionNo: (last?.versionNo ?? 0) + 1, label, status: 'draft' } })
      let copied = 0
      if (current) {
        const items = await uow.tx.feeItem.findMany({ where: { versionId: current.id } })
        for (const i of items) {
          const { id: _id, createdAt: _c, updatedAt: _u, versionId: _v, ...rest } = i
          await uow.tx.feeItem.create({ data: { ...rest, versionId: row.id } })
          copied += 1
        }
        for (const r of await uow.tx.priceRule.findMany({ where: { versionId: current.id } })) {
          const { id: _id, createdAt: _c, updatedAt: _u, versionId: _v, ...rest } = r
          await uow.tx.priceRule.create({ data: { ...rest, versionId: row.id } as never })
        }
      }
      auditCreate(uow, actor, 'FeeScheduleVersion', row.id, 'fees.drafted', { versionNo: row.versionNo, copied })
      return { id: row.id, versionNo: row.versionNo, copied, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function saveFeeItem(_root: unknown, args: { versionId: string; itemId?: string | null; code: string; name: string; category: string; priceMinor: string; taxCategory: string; unit?: string | null; minimumChargeMinor?: string | null; drugId?: string | null; vaccineId?: string | null; orderKind?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageFees'], tool: 'fees.item', humanOnly: true }, args, async actor => {
    if (!(FEE_CATEGORIES as readonly string[]).includes(args.category)) throw new DomainError(Codes.INVALID_INPUT, 'Choose a category.', { field: 'category' })
    if (!(TAX_CATEGORIES as readonly string[]).includes(args.taxCategory)) throw new DomainError(Codes.INVALID_INPUT, 'Choose how this is taxed.', { field: 'taxCategory' })
    const data = {
      code: text(args.code, 'code', 40), name: text(args.name, 'name', 160), category: args.category, taxCategory: args.taxCategory, priceMinor: minorText(args.priceMinor, 'price', true), unit: (args.unit as never) ?? 'each',
      minimumChargeMinor: args.minimumChargeMinor ? minorText(args.minimumChargeMinor, 'minimum charge', true) : null, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null, orderKind: args.orderKind ?? '',
    }
    const result = await command(context.prisma, { name: 'fees.item', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const version = await lockRow<{ id: string; status: string }>(uow.tx, 'FeeScheduleVersion', args.versionId)
      if (version.status !== 'draft') throw new DomainError(Codes.GUARD_FAILED, 'Only a draft fee schedule can be edited. A published one is frozen; start a new draft.')
      const row = args.itemId
        ? await uow.tx.feeItem.update({ where: { id: args.itemId }, data })
        : await uow.tx.feeItem.create({ data: { ...data, versionId: version.id } })
      auditCreate(uow, actor, 'FeeItem', row.id, args.itemId ? 'fees.item.changed' : 'fees.item.added', { code: data.code, priceMinor: data.priceMinor.toString() })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Ask for approval to publish. The draft moves to pending; a different person with canApproveFees decides. */
export async function requestFeePublish(_root: unknown, args: { versionId: string; effectiveFrom?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageFees'], tool: 'fees.publish.request', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'fees.publish.request', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const count = await uow.tx.feeItem.count({ where: { versionId: args.versionId } })
      if (!count) throw new DomainError(Codes.GUARD_FAILED, 'This fee schedule has no items yet.')
      const row = await transition(uow, { model: 'FeeScheduleVersion', id: args.versionId, from: ['draft'], to: 'pending_approval', expectedVersion: args.expectedVersion, actor, eventType: 'fees.publish.requested' })
      const request = await requestApproval(uow, actor, { action: 'fees.publish', targetList: 'FeeScheduleVersion', targetId: row.id as string, payload: { versionId: row.id, effectiveFrom: args.effectiveFrom ?? null }, requiredPermission: 'canApproveFees', summary: `Publish fee schedule ${String(row.label)}` })
      return { id: row.id, approvalRequestId: request.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

registerApplier('fees.publish', async (uow, actor, request) => {
  const { versionId, effectiveFrom } = request.payload as { versionId: string; effectiveFrom: string | null }
  const target = await lockRow<{ id: string; scheduleId: string }>(uow.tx, 'FeeScheduleVersion', versionId)
  const previous = await uow.tx.feeScheduleVersion.findMany({ where: { scheduleId: target.scheduleId, status: 'published' }, select: { id: true } })
  for (const p of previous) await transition(uow, { model: 'FeeScheduleVersion', id: p.id, from: ['published'], to: 'retired', actor, eventType: 'fees.retired' })
  const row = await transition(uow, { model: 'FeeScheduleVersion', id: versionId, from: ['pending_approval'], to: 'published', actor, eventType: 'fees.published', data: { publishedAt: uow.now, effectiveFrom: new Date(`${effectiveFrom ?? uow.now.toISOString().slice(0, 10)}T00:00:00Z`) } })
  return { id: row.id, status: row.status }
})

/** Withdraw a pending or draft version back to draft, or drop it. */
export async function discardFeeDraft(_root: unknown, args: { versionId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageFees'], tool: 'fees.discard', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'fees.discard', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await staffOf(uow, actor).catch(() => null)
      const row = await transition(uow, { model: 'FeeScheduleVersion', id: args.versionId, from: ['draft', 'pending_approval'], to: 'retired', expectedVersion: args.expectedVersion, actor, eventType: 'fees.discarded' })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export { dateOnly }
