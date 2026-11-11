import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { containerBalance } from '../lib/csRegister'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { addStockLocation, adjustStock, closeRecall, countStock, draftPurchaseOrder, logTemperature, openRecall, receivePurchaseOrder, receiveStock, resolveExcursion, submitPurchaseOrder } from './inventory'
import { issueOrderForm, logCabinetAccess, receiveOnOrderForm, transferControlled } from './register'
import { wasteControlled } from './pharmacy'

/** Phase 3 inventory and register exit gate, against a real database; raw SQL plays the hostile application role. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const pgError = (e: unknown) => String((e as Error)?.message ?? e)
const key = () => uniqueKey('k')

describe.skipIf(!hasTestDatabase)('Phase 3 inventory and register (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }
  let lopez: { session: unknown; prisma: PrismaClient }
  const pharmacy = 'seed_stock_main_pharmacy'
  let itemId = ''

  beforeAll(async () => {
    prisma = testPrisma(2)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    marsh = { session: sessionFor('seed_user_marsh', ALL), prisma }
    lopez = { session: sessionFor('seed_user_lopez', ALL), prisma }
    itemId = (await prisma.item.findFirstOrThrow({ where: { name: { contains: 'Carprofen' } } })).id
  }, 300_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('stock levels come from movements only, and an overdraw is refused by the database', async () => {
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { itemId, stockLocationId: pharmacy } })
    await expect(prisma.$executeRawUnsafe(`UPDATE "StockLevel" SET "onHand" = 99999 WHERE id = '${level.id}'`)).rejects.toSatisfy(x => /movements|directly/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "StockLevel"`)).rejects.toBeTruthy()
    const mv = await prisma.stockMovement.findFirstOrThrow()
    await expect(prisma.$executeRawUnsafe(`UPDATE "StockMovement" SET "qtySigned" = 1 WHERE id = '${mv.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE id = '${mv.id}'`)).rejects.toBeTruthy()
    await expect(prisma.stockMovement.create({ data: { itemId, lotId: level.lotId, stockLocationId: pharmacy, kind: 'use', qtySigned: '-100000', occurredAt: new Date() } })).rejects.toSatisfy(x => /below zero/i.test(pgError(x)))
    await expect(adjustStock(null, { itemId, lotId: level.lotId, stockLocationId: pharmacy, kind: 'dispose', quantity: '100000', reason: 'Trying to overdraw', idempotencyKey: key() }, marsh)).rejects.toBeTruthy()
  })

  it('property: 200 random stock operations, some in parallel, never take a level below zero and the level equals the sum of movements', async () => {
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { itemId, stockLocationId: pharmacy } })
    let seed = 7
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const ops = Array.from({ length: 200 }, () => ({ out: rnd() < 0.7, qty: Math.ceil(rnd() * 40) }))
    for (let i = 0; i < ops.length; i += 20) {
      await Promise.allSettled(ops.slice(i, i + 20).map(o => o.out
        ? adjustStock(null, { itemId, lotId: level.lotId, stockLocationId: pharmacy, kind: 'use', quantity: String(o.qty), reason: 'Used at the treatment table', idempotencyKey: key() }, marsh)
        : receiveStock(null, { drugId: 'seed_drug_carprofen', stockLocationId: pharmacy, lotNumber: 'CP-55102', expiresOn: '2027-12-31', quantity: String(o.qty), idempotencyKey: key() }, marsh)))
      const now = await prisma.stockLevel.findFirstOrThrow({ where: { id: level.id } })
      expect(Number(now.onHand)).toBeGreaterThanOrEqual(0)
    }
    const sum = await prisma.stockMovement.aggregate({ where: { itemId, lotId: level.lotId, stockLocationId: pharmacy }, _sum: { qtySigned: true } })
    const final = await prisma.stockLevel.findFirstOrThrow({ where: { id: level.id } })
    expect(final.onHand.toString()).toBe((sum._sum.qtySigned ?? 0).toString())
  })

  it('an order is received in parts, never beyond what was ordered, and a count writes its difference', async () => {
    const supplier = await prisma.supplier.findFirstOrThrow()
    const po = await draftPurchaseOrder(null, { supplierId: supplier.id, locationId: 'seed_loc_main', lines: [{ itemId, quantity: '50', unitCostMinor: '1250' }], idempotencyKey: key() }, marsh)
    await expect(receivePurchaseOrder(null, { orderId: po.id, stockLocationId: pharmacy, lines: [], idempotencyKey: key() }, marsh)).rejects.toBeTruthy()
    const sub = await submitPurchaseOrder(null, { orderId: po.id, expectedVersion: po.version, idempotencyKey: key() }, marsh)
    expect(sub.status).toBe('submitted')
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } })
    const first = await receivePurchaseOrder(null, { orderId: po.id, stockLocationId: pharmacy, lines: [{ lineId: line.id, lotNumber: 'CP-61001', expiresOn: '2028-03-31', quantity: '30' }], idempotencyKey: key() }, marsh)
    expect(first.status).toBe('partially_received')
    await expect(receivePurchaseOrder(null, { orderId: po.id, stockLocationId: pharmacy, lines: [{ lineId: line.id, lotNumber: 'CP-61001', expiresOn: '2028-03-31', quantity: '25' }], idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(receivePurchaseOrder(null, { orderId: po.id, stockLocationId: pharmacy, lines: [{ lineId: line.id, lotNumber: 'CP-61002', expiresOn: '2020-01-31', quantity: '5' }], idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const last = await receivePurchaseOrder(null, { orderId: po.id, stockLocationId: pharmacy, lines: [{ lineId: line.id, lotNumber: 'CP-61001', expiresOn: '2028-03-31', quantity: '20' }], idempotencyKey: key() }, marsh)
    expect(last.status).toBe('received')
    await expect(prisma.$executeRawUnsafe(`UPDATE "PurchaseOrder" SET status = 'draft' WHERE id = '${po.id}'`)).rejects.toSatisfy(x => /cannot change/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`UPDATE "PurchaseOrderLine" SET "qtyReceived" = 51 WHERE id = '${line.id}'`)).rejects.toBeTruthy()
    const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { lotNumber: 'CP-61001' } })
    const lvl = await prisma.stockLevel.findFirstOrThrow({ where: { lotId: lot.id } })
    expect(lvl.onHand.toString()).toBe('50')
    const counted = await countStock(null, { stockLocationId: pharmacy, counts: [{ itemId, lotId: lot.id, countedQty: '47' }], idempotencyKey: key() }, marsh)
    expect(counted.variances).toBe(1)
    expect((await prisma.stockLevel.findFirstOrThrow({ where: { lotId: lot.id } })).onHand.toString()).toBe('47')
    const cl = await prisma.stockCountLine.findFirstOrThrow()
    expect(cl.variance.toString()).toBe('-3')
    await expect(prisma.$executeRawUnsafe(`UPDATE "StockCountLine" SET variance = 0 WHERE id = '${cl.id}'`)).rejects.toBeTruthy()
  })

  it('a fridge reading out of range opens one excursion and quarantines the cold-chain lots, and a quarantined lot cannot be used', async () => {
    const fridge = 'seed_stock_main_fridge'
    const ok = await logTemperature(null, { stockLocationId: fridge, readingC: '4.5', idempotencyKey: key() }, lopez)
    expect(ok.status).toBe('in_range')
    const bad = await logTemperature(null, { stockLocationId: fridge, readingC: '11.2', idempotencyKey: key() }, lopez)
    expect(bad.status).toBe('excursion')
    expect(bad.quarantinedLots).toBeGreaterThan(0)
    const again = await logTemperature(null, { stockLocationId: fridge, readingC: '12.0', idempotencyKey: key() }, lopez)
    expect(again.excursionId).toBe(bad.excursionId)
    expect(await prisma.temperatureExcursion.count({ where: { stockLocationId: fridge, status: 'open' } })).toBe(1)
    const vaxItem = await prisma.item.findFirstOrThrow({ where: { coldChain: true } })
    const lvl = await prisma.stockLevel.findFirstOrThrow({ where: { itemId: vaxItem.id, stockLocationId: fridge, onHand: { gt: 0 } } })
    await expect(prisma.stockMovement.create({ data: { itemId: vaxItem.id, lotId: lvl.lotId, stockLocationId: fridge, kind: 'use', qtySigned: '-1', occurredAt: new Date() } })).rejects.toSatisfy(x => /cannot be used/i.test(pgError(x)))
    const ex = await prisma.temperatureExcursion.findUniqueOrThrow({ where: { id: bad.excursionId as string } })
    await expect(prisma.$executeRawUnsafe(`UPDATE "TemperatureExcursion" SET status = 'resolved' WHERE id = '${ex.id}'`)).rejects.toBeTruthy()
    const done = await resolveExcursion(null, { excursionId: ex.id, resolution: 'Compressor repaired; stock reviewed by the veterinarian', expectedVersion: ex.version, idempotencyKey: key() }, marsh)
    expect(done.status).toBe('resolved')
    await expect(prisma.$executeRawUnsafe(`UPDATE "TemperatureExcursion" SET status = 'open' WHERE id = '${ex.id}'`)).rejects.toSatisfy(x => /reopened/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "TemperatureLog"`)).rejects.toBeTruthy()
  })

  it('a recall quarantines the lot, lists who received it, and closes only when every patient is resolved', async () => {
    const item = await prisma.item.findFirstOrThrow({ where: { name: { contains: 'Maropitant' } } })
    const opened = await openRecall(null, { itemId: item.id, lotNumber: 'MP-12088', title: 'Manufacturer notice: potency below label', source: 'Manufacturer', idempotencyKey: key() }, marsh)
    expect(opened.quarantinedLots).toBe(1)
    await expect(openRecall(null, { itemId: item.id, lotNumber: 'MP-12088', title: 'Again', idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const rc = await prisma.recallCase.findUniqueOrThrow({ where: { id: opened.id } })
    await expect(prisma.$executeRawUnsafe(`UPDATE "RecallCase" SET status = 'closed' WHERE id = '${rc.id}'`)).rejects.toBeTruthy()
    await prisma.recallExposure.create({ data: { recallId: rc.id, sourceType: 'dispense', sourceId: 'x1', givenOn: new Date(), status: 'to_contact' } })
    await expect(closeRecall(null, { recallId: rc.id, resolution: 'Everyone contacted', expectedVersion: rc.version, idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(prisma.recallExposure.create({ data: { recallId: rc.id, sourceType: 'dispense', sourceId: 'x1', givenOn: new Date(), status: 'to_contact' } })).rejects.toBeTruthy()
  })

  it('an order form is valid sixty days, receipts are partial, and an expired form is refused by the database', async () => {
    const supplier = await prisma.supplier.findFirstOrThrow()
    const product = await prisma.drugProduct.findFirstOrThrow({ where: { csSchedule: 'CII' } })
    const today = new Date().toISOString().slice(0, 10)
    await expect(issueOrderForm(null, { supplierId: supplier.id, locationId: 'seed_loc_main', formNumber: 'F222-1001', kind: 'form_222', issuedOn: today, lines: [{ productId: product.id, packages: 0 }], idempotencyKey: key() }, marsh)).rejects.toBeTruthy()
    const form = await issueOrderForm(null, { supplierId: supplier.id, locationId: 'seed_loc_main', formNumber: 'F222-1001', kind: 'form_222', issuedOn: today, lines: [{ productId: product.id, packages: 2 }], idempotencyKey: key() }, marsh)
    await expect(issueOrderForm(null, { supplierId: supplier.id, locationId: 'seed_loc_main', formNumber: 'F222-1001', kind: 'form_222', issuedOn: today, lines: [{ productId: product.id, packages: 1 }], idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const line = await prisma.csOrderFormLine.findFirstOrThrow({ where: { orderFormId: form.id } })
    const r1 = await receiveOnOrderForm(null, { lineId: line.id, lotNumber: 'HM-8841', lotExpiresOn: '2028-06-30', labelQty: '20', labelUnit: 'mL', idempotencyKey: key() }, marsh)
    expect(r1.status).toBe('partially_filled')
    const r2 = await receiveOnOrderForm(null, { lineId: line.id, lotNumber: 'HM-8842', lotExpiresOn: '2028-06-30', labelQty: '20', labelUnit: 'mL', idempotencyKey: key() }, marsh)
    expect(r2.status).toBe('filled')
    await expect(receiveOnOrderForm(null, { lineId: line.id, lotNumber: 'HM-8843', lotExpiresOn: '2028-06-30', labelQty: '20', labelUnit: 'mL', idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(prisma.$executeRawUnsafe(`UPDATE "CsOrderForm" SET "expiresOn" = "expiresOn" + 400 WHERE id = '${form.id}'`)).rejects.toBeTruthy()
    await expect(prisma.csOrderForm.create({ data: { ref: 'OF-X', formNumber: 'F-BAD', kind: 'form_222', supplierId: supplier.id, locationId: 'seed_loc_main', issuedOn: new Date('2026-01-01'), expiresOn: new Date('2027-01-01'), status: 'open' } })).rejects.toSatisfy(x => /sixty|check/i.test(pgError(x)))
    const old = await prisma.csOrderForm.create({ data: { ref: 'OF-OLD', formNumber: 'F-OLD', kind: 'form_222', supplierId: supplier.id, locationId: 'seed_loc_main', issuedOn: new Date('2026-01-01'), expiresOn: new Date('2026-03-02'), status: 'open', lines: { create: [{ productId: product.id, packages: 1 }] } }, include: { lines: true } })
    await expect(receiveOnOrderForm(null, { lineId: old.lines[0].id, lotNumber: 'HM-0001', lotExpiresOn: '2028-06-30', labelQty: '20', labelUnit: 'mL', idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(prisma.$executeRawUnsafe(`UPDATE "CsOrderFormLine" SET "packagesReceived" = 1 WHERE id = '${old.lines[0].id}'`)).rejects.toSatisfy(x => /expired/i.test(pgError(x)))
  })

  it('a transfer needs a different witness and records both the register entry and the transfer, cabinet events are immutable', async () => {
    const c = await prisma.csContainer.findFirstOrThrow({ where: { status: 'open', product: { csSchedule: { not: 'none' } } }, orderBy: { ref: 'asc' } })
    const other = await prisma.deaRegistration.findFirstOrThrow({ where: { status: 'active', NOT: { id: c.deaRegistrationId ?? '' } } }).catch(() => null)
    if (other) {
      await expect(transferControlled(null, { containerId: c.id, qty: '0.01', toRegistrationId: other.id, witnessId: 'seed_staff_lopez', idempotencyKey: key() }, lopez)).rejects.toBeTruthy()
      const before = await prisma.$transaction(tx => containerBalance(tx as never, c.id))
      const t = await transferControlled(null, { containerId: c.id, qty: '0.01', toRegistrationId: other.id, witnessId: 'seed_staff_price', idempotencyKey: key() }, marsh)
      expect(t.status).toBe('sent')
      const after = await prisma.$transaction(tx => containerBalance(tx as never, c.id))
      expect(before.minus(after).toString()).toBe('0.01')
      const row = await prisma.csTransfer.findUniqueOrThrow({ where: { id: t.id } })
      await expect(prisma.$executeRawUnsafe(`UPDATE "CsTransfer" SET qty = 5 WHERE id = '${row.id}'`)).rejects.toBeTruthy()
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "CsTransfer"`)).rejects.toBeTruthy()
    }
    await logCabinetAccess(null, { locationId: 'seed_loc_main', kind: 'opened', note: 'Morning count', idempotencyKey: key() }, marsh)
    const ev = await prisma.cabinetAccessEvent.findFirstOrThrow()
    await expect(prisma.$executeRawUnsafe(`UPDATE "CabinetAccessEvent" SET kind = 'closed' WHERE id = '${ev.id}'`)).rejects.toBeTruthy()
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CabinetAccessEvent"`)).rejects.toBeTruthy()
  })

  it('property: parallel wastes from one container never take it below zero, and the balance equals the sum of entries', async () => {
    const c = await prisma.csContainer.findFirstOrThrow({ where: { status: 'open' }, orderBy: { ref: 'desc' } })
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => wasteControlled(null, { containerId: c.id, qty: '0.4', reason: 'Dose drawn and not given', witnessId: 'seed_staff_price', idempotencyKey: key() }, marsh)))
    expect(results.some(r => r.status === 'fulfilled')).toBe(true)
    const bal = await prisma.$transaction(tx => containerBalance(tx as never, c.id))
    expect(bal.gte(0)).toBe(true)
    const sum = await prisma.csLogEntry.aggregate({ where: { containerId: c.id }, _sum: { qtySigned: true } })
    expect(bal.toString()).toBe(new (bal.constructor as new (v: unknown) => { toString(): string })(sum._sum.qtySigned ?? 0).toString())
  })

  it('a storage place that is a fridge needs its range', async () => {
    await expect(addStockLocation(null, { locationId: 'seed_loc_main', name: 'Spare fridge', kind: 'fridge', idempotencyKey: key() }, marsh)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
