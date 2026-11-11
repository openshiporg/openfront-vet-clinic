import { auditCreate } from '../lib/cas'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { nextReference } from '../lib/sequence'
import { DRUG_LOTS, VACCINE_LOTS } from './clinicalData'

/**
 * Phase 3 stock: the shelves and the vaccine fridge at the main hospital, the catalogue behind the lots that
 * were already seeded, opening stock written as receive movements (so the level is derived like any other),
 * two suppliers, re-order points and one order in draft. Idempotent: it does nothing once the catalogue exists.
 */
const PLACES = [
  { id: 'seed_stock_main_pharmacy', name: 'Pharmacy shelf', kind: 'shelf', min: null, max: null },
  { id: 'seed_stock_main_fridge', name: 'Vaccine fridge', kind: 'fridge', min: '2', max: '8' },
  { id: 'seed_stock_main_treatment', name: 'Treatment room cabinet', kind: 'cabinet', min: null, max: null },
] as const
const OPENING: Record<string, number> = {
  seed_lot_carprofen_main: 240, seed_lot_gabapentin_main: 180, seed_lot_meloxicam_main: 120, seed_lot_cefovecin_main: 24, seed_lot_maropitant_main: 40, seed_lot_lrs_main: 12,
  seed_lot_dapp_main: 60, seed_lot_dapp_old: 8, seed_lot_lepto_main: 40, seed_lot_bord_main: 30, seed_lot_civ_main: 20, seed_lot_fvrcp_main: 36, seed_lot_felv_main: 18,
}
const SUPPLIERS = [
  { id: 'seed_sup_covetrus', name: 'Covetrus', accountNumber: 'CC-204118', phone: '800-555-0143', email: 'orders@covetrus.example.com' },
  { id: 'seed_sup_patterson', name: 'Patterson Veterinary', accountNumber: 'PV-77302', phone: '800-555-0187', email: 'sales@pattersonvet.example.com' },
]

export async function seedInventory(uow: UnitOfWork, actor: Actor, count: (k: string, n: number) => void) {
  const { tx, now } = uow
  if (await tx.stockLocation.findUnique({ where: { id: PLACES[0].id }, select: { id: true } })) return
  const staff = await tx.staffMember.findUnique({ where: { id: 'seed_staff_lopez' }, select: { id: true } })
  await tx.stockLocation.createMany({ data: PLACES.map(p => ({ id: p.id, name: p.name, locationId: 'seed_loc_main', kind: p.kind, minTempC: p.min, maxTempC: p.max, active: true })) })
  count('stockLocations', PLACES.length)
  await tx.supplier.createMany({ data: SUPPLIERS.map(s => ({ ...s, active: true })) })
  count('suppliers', SUPPLIERS.length)

  const lots = [...DRUG_LOTS.map(l => ({ id: l.id, drugId: l.drug as string, vaccineId: null as string | null })), ...VACCINE_LOTS.filter(l => l.location === 'seed_loc_main').map(l => ({ id: l.id, drugId: null as string | null, vaccineId: l.vaccine as string }))]
  const itemFor = new Map<string, string>()
  for (const l of lots) {
    const key = l.drugId ?? l.vaccineId!
    if (itemFor.has(key)) continue
    const name = l.drugId ? (await tx.drugProduct.findUniqueOrThrow({ where: { id: l.drugId }, select: { displayName: true } })).displayName : (await tx.vaccineProduct.findUniqueOrThrow({ where: { id: l.vaccineId! }, select: { name: true } })).name
    const item = await tx.item.create({ data: { ref: await nextReference(tx, 'ITM', now), name, kind: l.drugId ? 'drug' : 'vaccine', drugId: l.drugId, vaccineId: l.vaccineId, baseUnit: l.drugId ? 'unit' : 'dose', coldChain: !!l.vaccineId, active: true } })
    itemFor.set(key, item.id)
  }
  count('items', itemFor.size)

  let moves = 0
  for (const l of lots) {
    const qty = OPENING[l.id]
    if (!qty) continue
    const itemId = itemFor.get(l.drugId ?? l.vaccineId!)!
    await tx.stockMovement.create({ data: { itemId, lotId: l.id, stockLocationId: l.vaccineId ? 'seed_stock_main_fridge' : l.id === 'seed_lot_lrs_main' ? 'seed_stock_main_treatment' : 'seed_stock_main_pharmacy', kind: 'receive', qtySigned: String(qty), unit: l.drugId ? 'unit' : 'dose', sourceType: 'opening_stock', sourceId: l.id, reason: 'Opening stock', actorId: staff?.id ?? null, occurredAt: now } })
    moves += 1
  }
  count('stockMovements', moves)

  const rule = (drug: string, min: number, target: number) => ({ itemId: itemFor.get(drug)!, locationId: 'seed_loc_main', minQty: String(min), targetQty: String(target) })
  await tx.reorderRule.createMany({ data: [rule('seed_drug_carprofen', 100, 300), rule('seed_drug_gabapentin', 60, 200), rule('seed_drug_cefovecin', 30, 60), rule('seed_drug_lrs', 12, 24), rule('seed_vx_dapp', 20, 80)] })
  count('reorderRules', 5)

  const po = await tx.purchaseOrder.create({ data: { ref: await nextReference(tx, 'PO', now), supplierId: 'seed_sup_covetrus', locationId: 'seed_loc_main', status: 'draft', orderedById: staff?.id ?? null, note: 'Weekly pharmacy top-up', lines: { create: [{ itemId: itemFor.get('seed_drug_cefovecin')!, qtyOrdered: '36', qtyReceived: '0', unit: 'unit', unitCostMinor: 8450n }, { itemId: itemFor.get('seed_drug_lrs')!, qtyOrdered: '12', qtyReceived: '0', unit: 'unit', unitCostMinor: 1275n }] } } })
  auditCreate(uow, actor, 'PurchaseOrder', po.id, 'po.drafted', { ref: po.ref, lines: 2 })
  count('purchaseOrders', 1)
}
