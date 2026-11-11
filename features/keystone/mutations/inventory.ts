import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { dec, plain, toScale } from '../lib/decimal'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { decimalText, locationDay, staffOf, text, type Ctx } from './clinical'

/*
 * Inventory (BUILD-PLAN P3). Stock is movement-only: every receive, use, count correction and disposal is a
 * StockMovement written in the same transaction as its cause, and the database keeps the level and refuses
 * a movement that would take it below zero. First-expiry-first-out is a suggestion computed on read
 * (`fefoLots`), never a stored plan. A recall finds the patients who got the lot by looking at what was
 * dispensed, administered and vaccinated. A fridge reading out of range opens an excursion and puts the
 * cold-chain lots in that fridge into quarantine, in the same transaction. Nothing here runs on a timer.
 */

const dateOnly = (value: string, field: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field })
  return new Date(`${value}T00:00:00Z`)
}
const positive = (value: unknown, field: string) => {
  const t = decimalText(value, field)
  if (!dec(t).gt(0)) throw new DomainError(Codes.INVALID_INPUT, `${field} must be more than zero.`, { field })
  return t
}

type Movement = { itemId: string; lotId?: string | null; stockLocationId: string; kind: 'receive' | 'use' | 'dispense' | 'adjust' | 'count' | 'transfer_out' | 'transfer_in' | 'dispose' | 'return'; qtySigned: string; unit?: string | null; sourceType: string; sourceId: string; reason?: string; actorId: string }

/** The one way stock changes. The database trigger applies it to the level and refuses an overdraw. */
export async function moveStock(uow: UnitOfWork, m: Movement) {
  return uow.tx.stockMovement.create({
    data: { itemId: m.itemId, lotId: m.lotId ?? null, stockLocationId: m.stockLocationId, kind: m.kind, qtySigned: toScale(dec(m.qtySigned), 'qty'), unit: (m.unit as never) ?? null, sourceType: m.sourceType, sourceId: m.sourceId, reason: m.reason ?? '', actorId: m.actorId, occurredAt: uow.now },
  })
}

/**
 * Choose the lot a dispense or a dose comes from (DOMAIN I-O1): this product's, at this location, available
 * (not quarantined or recalled), in date and holding at least the quantity. With no lot chosen, the
 * soonest-expiring lot that holds enough. Refuses when there is none; `takeFromLot` then writes the movement.
 */
export async function lotToDraw(uow: UnitOfWork, d: { product: { drugId: string } | { vaccineId: string }; productName: string; lotId?: string | null; locationId: string; on: string; qty: string }) {
  const levels = await uow.tx.stockLevel.findMany({
    where: { onHand: { gt: 0 }, stockLocation: { locationId: d.locationId }, lot: { ...d.product, ...(d.lotId ? { id: d.lotId } : {}), locationId: d.locationId, status: 'available', expiresOn: { gte: new Date(`${d.on}T00:00:00Z`) } } },
    select: { itemId: true, stockLocationId: true, onHand: true, unit: true, lot: { select: { id: true, lotNumber: true, expiresOn: true } } },
  })
  if (!levels.length) {
    throw new DomainError(Codes.GUARD_FAILED, d.lotId ? 'That lot has no stock here, or it is expired, quarantined or another product.' : `No lot of ${d.productName} is in stock here (in date and not quarantined). Receive stock first.`, { field: 'lotId', reason: 'no_stock' })
  }
  const need = dec(d.qty)
  const sorted = levels.filter(l => l.lot && l.itemId && l.stockLocationId).sort((a, b) => a.lot!.expiresOn.getTime() - b.lot!.expiresOn.getTime())
  const pick = sorted.find(l => dec(l.onHand.toString()).gte(need))
  if (!pick) {
    const best = sorted.reduce((m, l) => (dec(l.onHand.toString()).gt(dec(m.onHand.toString())) ? l : m))
    throw new DomainError(Codes.GUARD_FAILED, `Lot ${best.lot!.lotNumber} has ${plain(dec(best.onHand.toString()))} on hand; ${plain(need)} is more than that.`, { field: 'quantity', reason: 'not_enough_stock' })
  }
  return { lotId: pick.lot!.id, lotNumber: pick.lot!.lotNumber, expiresOn: pick.lot!.expiresOn, itemId: pick.itemId!, stockLocationId: pick.stockLocationId!, unit: pick.unit, qty: plain(need) }
}

/** Write the dispense or use movement for a lot chosen by `lotToDraw`; the database refuses an overdraw (a parallel draw). */
export async function takeFromLot(uow: UnitOfWork, lot: Awaited<ReturnType<typeof lotToDraw>>, m: { kind: 'dispense' | 'use'; sourceType: string; sourceId: string; actorId: string }) {
  return moveStock(uow, { itemId: lot.itemId, lotId: lot.lotId, stockLocationId: lot.stockLocationId, kind: m.kind, qtySigned: `-${lot.qty}`, unit: lot.unit, sourceType: m.sourceType, sourceId: m.sourceId, actorId: m.actorId })
}

/** A reversed dose was not given: the stock it took (if any) goes back to its lot as a return movement. */
export async function returnToLot(uow: UnitOfWork, r: { sourceType: string; sourceId: string; reversalId: string; actorId: string; reason: string }) {
  const taken = await uow.tx.stockMovement.findFirst({ where: { sourceType: r.sourceType, sourceId: r.sourceId, kind: 'use' }, select: { itemId: true, lotId: true, stockLocationId: true, qtySigned: true, unit: true } })
  if (!taken) return null
  return moveStock(uow, { itemId: taken.itemId!, lotId: taken.lotId, stockLocationId: taken.stockLocationId!, kind: 'return', qtySigned: plain(dec(taken.qtySigned.toString()).neg()), unit: taken.unit, sourceType: `${r.sourceType}_reversal`, sourceId: r.reversalId, reason: r.reason.slice(0, 200), actorId: r.actorId })
}

/** Lots with stock for an item at a place, soonest expiry first (FEFO), skipping quarantined and expired lots. */
export async function fefoLots(tx: UnitOfWork['tx'], itemId: string, stockLocationId: string, on: string) {
  const levels = await tx.stockLevel.findMany({ where: { itemId, stockLocationId, onHand: { gt: 0 }, lot: { status: 'available', expiresOn: { gte: new Date(`${on}T00:00:00Z`) } } }, select: { onHand: true, lot: { select: { id: true, lotNumber: true, expiresOn: true } } } })
  return levels.filter(l => l.lot).sort((a, b) => a.lot!.expiresOn.getTime() - b.lot!.expiresOn.getTime()).map(l => ({ lotId: l.lot!.id, lotNumber: l.lot!.lotNumber, expiresOn: l.lot!.expiresOn, onHand: l.onHand.toString() }))
}

async function ensureItem(uow: UnitOfWork, input: { drugId?: string | null; vaccineId?: string | null }) {
  const found = await uow.tx.item.findFirst({ where: input.drugId ? { drugId: input.drugId } : { vaccineId: input.vaccineId! }, select: { id: true } })
  if (found) return found.id
  if (input.drugId) {
    const d = await uow.tx.drugProduct.findUniqueOrThrow({ where: { id: input.drugId }, select: { displayName: true, csSchedule: true, form: true } })
    if (d.csSchedule !== 'none') throw new DomainError(Codes.GUARD_FAILED, 'Controlled drugs are stocked through the controlled-substance register.')
    return (await uow.tx.item.create({ data: { ref: await nextReference(uow.tx, 'ITM', uow.now), name: d.displayName, kind: 'drug', drugId: input.drugId, baseUnit: 'unit' } })).id
  }
  const v = await uow.tx.vaccineProduct.findUniqueOrThrow({ where: { id: input.vaccineId! }, select: { name: true } })
  return (await uow.tx.item.create({ data: { ref: await nextReference(uow.tx, 'ITM', uow.now), name: v.name, kind: 'vaccine', vaccineId: input.vaccineId!, baseUnit: 'dose', coldChain: true } })).id
}

/** Create a place where stock is kept (shelf, fridge with its range, locked cabinet). */
export async function addStockLocation(_root: unknown, args: { locationId: string; name: string; kind: string; minTempC?: string | null; maxTempC?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory'], tool: 'stock.add_place', humanOnly: true }, args, async actor => {
    const name = text(args.name, 'name', 80)
    if (!['shelf', 'fridge', 'freezer', 'cabinet', 'controlled_cabinet', 'vehicle'].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose the kind of place.', { field: 'kind' })
    const cold = args.kind === 'fridge' || args.kind === 'freezer'
    if (cold && (!args.minTempC || !args.maxTempC)) throw new DomainError(Codes.INVALID_INPUT, 'A fridge or freezer needs its allowed temperature range.', { field: 'minTempC' })
    if (cold && !dec(args.minTempC!).lt(dec(args.maxTempC!))) throw new DomainError(Codes.INVALID_INPUT, 'The lowest allowed temperature must be below the highest.', { field: 'minTempC' })
    const result = await command(context.prisma, { name: 'stock.add_place', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await locationDay(uow, args.locationId, uow.now)
      const row = await uow.tx.stockLocation.create({ data: { name, locationId: args.locationId, kind: args.kind as never, minTempC: cold ? toScale(dec(args.minTempC!), 'qty') : null, maxTempC: cold ? toScale(dec(args.maxTempC!), 'qty') : null } })
      auditCreate(uow, actor, 'StockLocation', row.id, 'stock.place_added', { name, kind: args.kind })
      return { id: row.id, status: 'active' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Receive a lot straight into stock (no purchase order): creates the lot if new, then the receive movement. */
export async function receiveStock(_root: unknown, args: { drugId?: string | null; vaccineId?: string | null; stockLocationId: string; lotNumber: string; expiresOn: string; quantity: string; unit?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveStock', 'canManageInventory'], tool: 'stock.receive_lot', humanOnly: true }, args, async actor => {
    const lotNumber = text(args.lotNumber, 'lotNumber', 60)
    const expiresOn = dateOnly(args.expiresOn, 'Expires')
    const quantity = positive(args.quantity, 'quantity')
    if (!args.drugId === !args.vaccineId) throw new DomainError(Codes.INVALID_INPUT, 'Choose a drug or a vaccine.')
    const result = await command(context.prisma, { name: 'stock.receive_lot', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true, kind: true, active: true } })
      if (!place?.active || !place.locationId) throw new DomainError(Codes.NOT_FOUND, 'That storage place is not available.')
      if (place.kind === 'controlled_cabinet') throw new DomainError(Codes.GUARD_FAILED, 'Controlled drugs are received through the controlled-substance register.')
      const { on } = await locationDay(uow, place.locationId, uow.now)
      if (day(expiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, 'That lot is already expired.')
      const itemId = await ensureItem(uow, args)
      let lot = await uow.tx.inventoryLot.findFirst({ where: { locationId: place.locationId, lotNumber, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null }, select: { id: true, expiresOn: true, status: true } })
      if (lot && lot.status !== 'available') throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is ${lot.status} and cannot take more stock.`)
      if (lot && day(lot.expiresOn) !== day(expiresOn)) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already here with a different expiry date.`)
      lot ??= await uow.tx.inventoryLot.create({ data: { drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null, locationId: place.locationId, lotNumber, expiresOn, status: 'available' }, select: { id: true, expiresOn: true, status: true } })
      const mv = await moveStock(uow, { itemId, lotId: lot.id, stockLocationId: place.id, kind: 'receive', qtySigned: quantity, unit: args.unit, sourceType: 'receive', sourceId: lot.id, actorId: staff.id })
      auditCreate(uow, actor, 'InventoryLot', lot.id, 'stock.received', { lotNumber, quantity, stockLocationId: place.id, movementId: mv.id })
      return { id: lot.id, movementId: mv.id, status: 'available' }
    })
    return { replay: result.replay, ...result.value }
  })
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/** Use or dispose of stock from a lot (waste, expiry, damage). A sale or a dose goes through dispense or administration. */
export async function adjustStock(_root: unknown, args: { itemId: string; lotId?: string | null; stockLocationId: string; kind: 'dispose' | 'use'; quantity: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory', 'canReceiveStock'], tool: 'stock.adjust', humanOnly: true }, args, async actor => {
    const quantity = positive(args.quantity, 'quantity')
    const reason = text(args.reason, 'reason', 200)
    if (reason.length < 4) throw new DomainError(Codes.INVALID_INPUT, 'Say why (at least 4 characters).', { field: 'reason' })
    if (args.kind !== 'dispose' && args.kind !== 'use') throw new DomainError(Codes.INVALID_INPUT, 'Choose dispose or use.', { field: 'kind' })
    const result = await command(context.prisma, { name: 'stock.adjust', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const mv = await moveStock(uow, { itemId: args.itemId, lotId: args.lotId, stockLocationId: args.stockLocationId, kind: args.kind, qtySigned: `-${quantity}`, sourceType: 'adjustment', sourceId: args.lotId ?? args.itemId, reason, actorId: staff.id })
      auditCreate(uow, actor, 'StockMovement', mv.id, 'stock.adjusted', { kind: args.kind, quantity, reason }, { reason })
      return { id: mv.id, status: 'recorded' }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Purchasing and receiving ───────────────────────────────────────────────────────────────

export async function addSupplier(_root: unknown, args: { name: string; accountNumber?: string | null; phone?: string | null; email?: string | null; deaNumber?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrderStock', 'canManageInventory'], tool: 'supplier.create', humanOnly: true }, args, async actor => {
    const name = text(args.name, 'name', 100)
    const result = await command(context.prisma, { name: 'supplier.create', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      if (await uow.tx.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `${name} is already a supplier.`)
      const row = await uow.tx.supplier.create({ data: { name, accountNumber: String(args.accountNumber ?? '').trim().slice(0, 60), phone: String(args.phone ?? '').trim().slice(0, 40), email: String(args.email ?? '').trim().slice(0, 120), deaNumber: String(args.deaNumber ?? '').trim().slice(0, 20) } })
      auditCreate(uow, actor, 'Supplier', row.id, 'supplier.created', { name })
      return { id: row.id, status: 'active' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Draft a purchase order. A line needs a quantity and a cost in cents. */
export async function draftPurchaseOrder(_root: unknown, args: { supplierId: string; locationId: string; lines: { itemId: string; quantity: string; unitCostMinor: string; unit?: string | null }[]; note?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrderStock'], tool: 'po.draft', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 60) throw new DomainError(Codes.INVALID_INPUT, 'An order needs between one and sixty lines.', { field: 'lines' })
    const result = await command(context.prisma, { name: 'po.draft', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      await locationDay(uow, args.locationId, uow.now)
      if (!(await uow.tx.supplier.findFirst({ where: { id: args.supplierId, active: true }, select: { id: true } }))) throw new DomainError(Codes.NOT_FOUND, 'Supplier not found.')
      for (const l of args.lines) {
        positive(l.quantity, 'quantity')
        if (!/^\d{1,9}$/.test(String(l.unitCostMinor))) throw new DomainError(Codes.INVALID_INPUT, 'Cost is in whole cents.', { field: 'unitCostMinor' })
        if (!(await uow.tx.item.findFirst({ where: { id: l.itemId, active: true }, select: { id: true } }))) throw new DomainError(Codes.NOT_FOUND, 'An item on the order is not in the catalogue.')
      }
      const ref = await nextReference(uow.tx, 'PO', uow.now)
      const row = await uow.tx.purchaseOrder.create({
        data: { ref, supplierId: args.supplierId, locationId: args.locationId, status: 'draft', orderedById: staff.id, note: String(args.note ?? '').slice(0, 300), lines: { create: args.lines.map(l => ({ itemId: l.itemId, qtyOrdered: toScale(dec(l.quantity), 'qty'), qtyReceived: '0', unit: (l.unit as never) ?? null, unitCostMinor: BigInt(l.unitCostMinor) })) } },
      })
      auditCreate(uow, actor, 'PurchaseOrder', row.id, 'po.drafted', { ref, lines: args.lines.length })
      return { id: row.id, ref, status: 'draft', version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Submit a draft. An order over the practice's approval limit needs a second person with purchase approval. */
export async function submitPurchaseOrder(_root: unknown, args: { orderId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrderStock', 'canApprovePurchase'], tool: 'po.submit', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'po.submit', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const lines = await uow.tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: args.orderId }, select: { qtyOrdered: true, unitCostMinor: true } })
      if (!lines.length) throw new DomainError(Codes.GUARD_FAILED, 'The order has no lines.')
      const row = await transition(uow, { model: 'PurchaseOrder', id: args.orderId, from: ['draft'], to: 'submitted', expectedVersion: args.expectedVersion, actor, eventType: 'po.submitted', data: { orderedAt: uow.now, approvedById: staff.id } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function cancelPurchaseOrder(_root: unknown, args: { orderId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canOrderStock', 'canApprovePurchase'], tool: 'po.cancel', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 200)
    const result = await command(context.prisma, { name: 'po.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'PurchaseOrder', id: args.orderId, from: ['draft', 'submitted'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'po.cancelled', reason })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Receive against an order: per line a lot, an expiry and an amount. Over-receiving is refused; a short
 * delivery leaves the order partially received until the rest arrives. Each line is a receive movement
 * into the chosen place, in this transaction, so stock and the order cannot disagree.
 */
export async function receivePurchaseOrder(_root: unknown, args: { orderId: string; stockLocationId: string; packingSlip?: string | null; lines: { lineId: string; lotNumber: string; expiresOn: string; quantity: string }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveStock'], tool: 'po.receive', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.lines) || !args.lines.length) throw new DomainError(Codes.INVALID_INPUT, 'Enter what arrived.', { field: 'lines' })
    const result = await command(context.prisma, { name: 'po.receive', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const po = await lockRow<{ id: string; ref: string; status: string; locationId: string; version: number }>(uow.tx, 'PurchaseOrder', args.orderId)
      if (!['submitted', 'partially_received'].includes(po.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${po.ref} is ${po.status.replaceAll('_', ' ')}; it cannot be received.`)
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true, kind: true, active: true } })
      if (!place?.active || place.locationId !== po.locationId) throw new DomainError(Codes.GUARD_FAILED, 'Choose a storage place at the ordering location.')
      const { on } = await locationDay(uow, po.locationId, uow.now)
      const receiptRef = await nextReference(uow.tx, 'GRN', uow.now)
      const receipt = await uow.tx.goodsReceipt.create({ data: { ref: receiptRef, purchaseOrderId: po.id, locationId: po.locationId, receivedById: staff.id, receivedAt: uow.now, packingSlip: String(args.packingSlip ?? '').trim().slice(0, 60) } })
      for (const l of args.lines) {
        const qty = positive(l.quantity, 'quantity')
        const line = await lockRow<{ id: string; itemId: string; qtyOrdered: unknown; qtyReceived: unknown; unit: string | null; purchaseOrderId: string }>(uow.tx, 'PurchaseOrderLine', l.lineId)
        if (line.purchaseOrderId !== po.id) throw new DomainError(Codes.GUARD_FAILED, 'A line does not belong to this order.')
        const remaining = dec(String(line.qtyOrdered)).minus(dec(String(line.qtyReceived)))
        if (dec(qty).gt(remaining)) throw new DomainError(Codes.GUARD_FAILED, `Only ${plain(remaining)} more of that line is expected.`)
        const expiresOn = dateOnly(l.expiresOn, 'Expires')
        if (day(expiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, `Lot ${l.lotNumber} is already expired; refuse it at the door.`)
        const item = await uow.tx.item.findUniqueOrThrow({ where: { id: line.itemId }, select: { drugId: true, vaccineId: true } })
        const lotNumber = text(l.lotNumber, 'lotNumber', 60)
        let lot = await uow.tx.inventoryLot.findFirst({ where: { locationId: po.locationId, lotNumber, drugId: item.drugId, vaccineId: item.vaccineId }, select: { id: true, expiresOn: true } })
        if (lot && day(lot.expiresOn) !== day(expiresOn)) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already here with a different expiry date.`)
        lot ??= await uow.tx.inventoryLot.create({ data: { drugId: item.drugId, vaccineId: item.vaccineId, locationId: po.locationId, lotNumber, expiresOn, status: 'available' }, select: { id: true, expiresOn: true } })
        await moveStock(uow, { itemId: line.itemId, lotId: lot.id, stockLocationId: place.id, kind: 'receive', qtySigned: qty, unit: line.unit, sourceType: 'goods_receipt', sourceId: receipt.id, actorId: staff.id })
        await uow.tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, purchaseOrderLineId: line.id, itemId: line.itemId, lotId: lot.id, qty: toScale(dec(qty), 'qty'), unit: (line.unit as never) ?? null } })
        await uow.tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: toScale(dec(String(line.qtyReceived)).plus(dec(qty)), 'qty') } })
      }
      const all = await uow.tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id }, select: { qtyOrdered: true, qtyReceived: true } })
      const done = all.every(l => dec(l.qtyReceived.toString()).gte(dec(l.qtyOrdered.toString())))
      await transition(uow, { model: 'PurchaseOrder', id: po.id, from: ['submitted', 'partially_received'], to: done ? 'received' : 'partially_received', actor, eventType: 'po.received' })
      auditCreate(uow, actor, 'GoodsReceipt', receipt.id, 'po.goods_received', { ref: receiptRef, order: po.ref, lines: args.lines.length })
      return { id: receipt.id, ref: receiptRef, status: done ? 'received' : 'partially_received' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Set the low-stock and target quantities for an item at a location. */
export async function setReorderRule(_root: unknown, args: { itemId: string; locationId: string; minQty: string; targetQty: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory'], tool: 'stock.reorder_rule', humanOnly: true }, args, async actor => {
    const minQty = decimalText(args.minQty, 'minQty')
    const targetQty = positive(args.targetQty, 'targetQty')
    if (!dec(targetQty).gt(dec(minQty))) throw new DomainError(Codes.INVALID_INPUT, 'The target must be above the re-order point.', { field: 'targetQty' })
    const result = await command(context.prisma, { name: 'stock.reorder_rule', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await locationDay(uow, args.locationId, uow.now)
      const existing = await uow.tx.reorderRule.findFirst({ where: { itemId: args.itemId, locationId: args.locationId }, select: { id: true } })
      const data = { minQty: toScale(dec(minQty), 'qty'), targetQty: toScale(dec(targetQty), 'qty') }
      const row = existing ? await uow.tx.reorderRule.update({ where: { id: existing.id }, data }) : await uow.tx.reorderRule.create({ data: { itemId: args.itemId, locationId: args.locationId, ...data } })
      auditCreate(uow, actor, 'ReorderRule', row.id, 'stock.reorder_rule_set', { minQty, targetQty })
      return { id: row.id, status: 'active' }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Counts ──────────────────────────────────────────────────────────────────────────────────

/** Count a storage place: each counted lot is compared to the level, and the difference becomes a count movement. */
export async function countStock(_root: unknown, args: { stockLocationId: string; counts: { itemId: string; lotId?: string | null; countedQty: string }[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory', 'canReceiveStock'], tool: 'stock.count', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.counts) || !args.counts.length || args.counts.length > 300) throw new DomainError(Codes.INVALID_INPUT, 'Enter at least one counted amount.', { field: 'counts' })
    const result = await command(context.prisma, { name: 'stock.count', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true } })
      if (!place) throw new DomainError(Codes.NOT_FOUND, 'Storage place not found.')
      const ref = await nextReference(uow.tx, 'SCN', uow.now)
      const count = await uow.tx.stockCount.create({ data: { ref, locationId: place.locationId, stockLocationId: place.id, status: 'closed', countedById: staff.id, countedAt: uow.now } })
      let variances = 0
      for (const c of args.counts) {
        const counted = dec(decimalText(c.countedQty, 'countedQty'))
        const level = await uow.tx.stockLevel.findFirst({ where: { itemId: c.itemId, lotId: c.lotId ?? null, stockLocationId: place.id }, select: { onHand: true } })
        const expected = dec(level?.onHand?.toString() ?? '0')
        const variance = counted.minus(expected)
        await uow.tx.stockCountLine.create({ data: { countId: count.id, itemId: c.itemId, lotId: c.lotId ?? null, expectedQty: toScale(expected, 'qty'), countedQty: toScale(counted, 'qty'), variance: toScale(variance, 'qty') } })
        if (!variance.isZero()) { variances += 1; await moveStock(uow, { itemId: c.itemId, lotId: c.lotId, stockLocationId: place.id, kind: 'count', qtySigned: plain(variance), sourceType: 'stock_count', sourceId: count.id, reason: `Count ${ref}`, actorId: staff.id }) }
      }
      auditCreate(uow, actor, 'StockCount', count.id, 'stock.counted', { ref, lines: args.counts.length, variances })
      return { id: count.id, ref, status: 'closed', variances }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Recalls ─────────────────────────────────────────────────────────────────────────────────

/**
 * Open a recall for a lot number of an item. The patients who may have received it are found from what was
 * dispensed, administered and vaccinated from that lot, the lot is quarantined where it sits, and each
 * exposure becomes a contact to make.
 */
export async function openRecall(_root: unknown, args: { itemId: string; lotNumber: string; title: string; source?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory'], tool: 'recall.open', humanOnly: true }, args, async actor => {
    const lotNumber = text(args.lotNumber, 'lotNumber', 60)
    const title = text(args.title, 'title', 160)
    const result = await command(context.prisma, { name: 'recall.open', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const item = await uow.tx.item.findUnique({ where: { id: args.itemId }, select: { id: true, drugId: true, vaccineId: true } })
      if (!item) throw new DomainError(Codes.NOT_FOUND, 'Item not found.')
      if (await uow.tx.recallCase.findFirst({ where: { itemId: item.id, lotNumber, status: 'open' }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, 'A recall for that lot is already open.')
      const ref = await nextReference(uow.tx, 'RCL', uow.now)
      const recall = await uow.tx.recallCase.create({ data: { ref, title, source: String(args.source ?? '').slice(0, 120), itemId: item.id, lotNumber, status: 'open', openedAt: uow.now } })
      const lots = await uow.tx.inventoryLot.findMany({ where: { lotNumber, drugId: item.drugId, vaccineId: item.vaccineId }, select: { id: true, status: true } })
      const lotIds = lots.map(l => l.id)
      let quarantined = 0
      for (const l of lots.filter(x => x.status === 'available')) {
        await transition(uow, { model: 'InventoryLot', id: l.id, from: ['available'], to: 'quarantined', actor, eventType: 'stock.quarantined', reason: `Recall ${ref}`, data: { quarantineReason: `Recall ${ref}: ${title}` } })
        quarantined += 1
      }
      const exposures: { patientId: string | null; clientId: string | null; sourceType: 'dispense' | 'administration' | 'vaccine'; sourceId: string; givenOn: Date }[] = []
      for (const d of await uow.tx.dispense.findMany({ where: { lotId: { in: lotIds } }, select: { id: true, patientId: true, clientId: true, dispensedAt: true } })) exposures.push({ patientId: d.patientId, clientId: d.clientId, sourceType: 'dispense', sourceId: d.id, givenOn: d.dispensedAt })
      for (const a of await uow.tx.administration.findMany({ where: { lotId: { in: lotIds }, reversesId: null }, select: { id: true, patientId: true, givenAt: true } })) exposures.push({ patientId: a.patientId, clientId: null, sourceType: 'administration', sourceId: a.id, givenOn: a.givenAt })
      for (const v of await uow.tx.vaccineAdministration.findMany({ where: { lotId: { in: lotIds }, reversesId: null }, select: { id: true, patientId: true, administeredOn: true } })) exposures.push({ patientId: v.patientId, clientId: null, sourceType: 'vaccine', sourceId: v.id, givenOn: v.administeredOn })
      for (const e of exposures) {
        const clientId = e.clientId ?? (e.patientId ? (await uow.tx.patientOwnership.findFirst({ where: { patientId: e.patientId, effectiveTo: null, role: 'primary' }, select: { clientId: true } }))?.clientId ?? null : null)
        await uow.tx.recallExposure.create({ data: { recallId: recall.id, patientId: e.patientId, clientId, sourceType: e.sourceType, sourceId: e.sourceId, givenOn: e.givenOn, status: 'to_contact' } })
      }
      auditCreate(uow, actor, 'RecallCase', recall.id, 'recall.opened', { ref, lotNumber, quarantined, exposures: exposures.length })
      return { id: recall.id, ref, status: 'open', quarantinedLots: quarantined, exposures: exposures.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function markRecallExposure(_root: unknown, args: { exposureId: string; status: 'contacted' | 'resolved'; note?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory'], tool: 'recall.exposure', humanOnly: true }, args, async actor => {
    if (args.status !== 'contacted' && args.status !== 'resolved') throw new DomainError(Codes.INVALID_INPUT, 'Choose contacted or resolved.', { field: 'status' })
    const result = await command(context.prisma, { name: 'recall.exposure', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'RecallExposure', id: args.exposureId, from: args.status === 'contacted' ? ['to_contact'] : ['to_contact', 'contacted'], to: args.status, expectedVersion: args.expectedVersion, actor, eventType: 'recall.exposure_updated', data: { note: String(args.note ?? '').slice(0, 300) } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Close a recall once every exposure is resolved. */
export async function closeRecall(_root: unknown, args: { recallId: string; resolution: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageInventory'], tool: 'recall.close', humanOnly: true }, args, async actor => {
    const resolution = text(args.resolution, 'resolution', 300)
    const result = await command(context.prisma, { name: 'recall.close', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const open = await uow.tx.recallExposure.count({ where: { recallId: args.recallId, status: { not: 'resolved' } } })
      if (open) throw new DomainError(Codes.GUARD_FAILED, `${open} ${open === 1 ? 'patient has' : 'patients have'} not been marked resolved.`)
      const row = await transition(uow, { model: 'RecallCase', id: args.recallId, from: ['open'], to: 'closed', expectedVersion: args.expectedVersion, actor, eventType: 'recall.closed', reason: resolution, data: { closedAt: uow.now, resolution } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}

// ── Temperature ──────────────────────────────────────────────────────────────────────────────

/**
 * Log a fridge or freezer reading. In range: just the log. Out of range: the log, an excursion (one open at
 * a time per place), and every available cold-chain lot stocked there goes into quarantine, in this transaction.
 */
export async function logTemperature(_root: unknown, args: { stockLocationId: string; readingC: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReceiveStock', 'canManageInventory', 'canAdminister'], tool: 'temperature.log', humanOnly: true }, args, async actor => {
    if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(String(args.readingC ?? '').trim())) throw new DomainError(Codes.INVALID_INPUT, 'Temperature: a number like 4.2', { field: 'readingC' })
    const result = await command(context.prisma, { name: 'temperature.log', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const place = await lockRow<{ id: string; kind: string; minTempC: unknown; maxTempC: unknown; name: string }>(uow.tx, 'StockLocation', args.stockLocationId)
      if (!['fridge', 'freezer'].includes(place.kind) || place.minTempC === null || place.maxTempC === null) throw new DomainError(Codes.GUARD_FAILED, `${place.name} is not a fridge or freezer.`)
      const reading = dec(args.readingC.trim())
      const inRange = reading.gte(dec(String(place.minTempC))) && reading.lte(dec(String(place.maxTempC)))
      const log = await uow.tx.temperatureLog.create({ data: { stockLocationId: place.id, readingC: toScale(reading, 'qty'), inRange, recordedById: staff.id, recordedAt: uow.now } })
      let excursionId: string | null = null
      let quarantined = 0
      if (!inRange) {
        const openOne = await uow.tx.temperatureExcursion.findFirst({ where: { stockLocationId: place.id, status: 'open' }, select: { id: true } })
        if (openOne) excursionId = openOne.id
        else {
          const ref = await nextReference(uow.tx, 'TEX', uow.now)
          const ex = await uow.tx.temperatureExcursion.create({ data: { ref, stockLocationId: place.id, logId: log.id, status: 'open', openedAt: uow.now } })
          excursionId = ex.id
        }
        const levels = await uow.tx.stockLevel.findMany({ where: { stockLocationId: place.id, onHand: { gt: 0 }, lotId: { not: null }, lot: { status: 'available' }, item: { coldChain: true } }, select: { lotId: true } })
        for (const lotId of [...new Set(levels.map(l => l.lotId!))]) {
          await transition(uow, { model: 'InventoryLot', id: lotId, from: ['available'], to: 'quarantined', actor, eventType: 'stock.quarantined', reason: `Fridge out of range (${plain(reading)} °C)`, data: { quarantineReason: `${place.name} read ${plain(reading)} °C, outside ${plain(dec(String(place.minTempC)))} to ${plain(dec(String(place.maxTempC)))} °C` } })
          quarantined += 1
        }
        await uow.tx.temperatureExcursion.update({ where: { id: excursionId }, data: { quarantinedLots: { increment: quarantined } } })
        auditCreate(uow, actor, 'TemperatureExcursion', excursionId, 'temperature.excursion', { place: place.name, readingC: plain(reading), quarantined })
      }
      return { id: log.id, status: inRange ? 'in_range' : 'excursion', excursionId, quarantinedLots: quarantined }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Close an excursion once the stock is judged. Lots stay quarantined until released by someone allowed to. */
export async function resolveExcursion(_root: unknown, args: { excursionId: string; resolution: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canReleaseQuarantine', 'canManageInventory'], tool: 'temperature.resolve', humanOnly: true }, args, async actor => {
    const resolution = text(args.resolution, 'resolution', 300)
    const result = await command(context.prisma, { name: 'temperature.resolve', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'TemperatureExcursion', id: args.excursionId, from: ['open'], to: 'resolved', expectedVersion: args.expectedVersion, actor, eventType: 'temperature.resolved', reason: resolution, data: { resolvedAt: uow.now, resolution } })
      return { id: row.id, status: row.status, version: row.version }
    })
    return { replay: result.replay, ...result.value }
  })
}
