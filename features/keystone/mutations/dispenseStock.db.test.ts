import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { dispenseFill, setLotQuarantine, writePrescription } from './pharmacy'
import { openEncounter } from './record'
import { placeOrder, recordAdministration, reverseAdministration } from './treatment'
import { administerVaccine } from './vaccines'

/** P3 r1 blocker: a non-controlled dispense or a lot dose moves stock out of one lot, and never more than it holds. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const key = () => uniqueKey('k')

describe.skipIf(!hasTestDatabase)('dispense and lot doses move stock (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }
  let lopez: { session: unknown; prisma: PrismaClient }
  let patientId = ''
  const onHand = async (lotId: string) => (await prisma.stockLevel.findMany({ where: { lotId } })).reduce((s, l) => s + Number(l.onHand), 0)
  const rxLine = async (productId: string, quantity: string) => {
    const rx = await writePrescription(null, { patientId, locationId: 'seed_loc_main', lines: [{ productId, directions: 'Give as directed by the veterinarian', quantity, refillsAuthorised: 2 }], idempotencyKey: key() }, marsh)
    return (await prisma.prescriptionLine.findFirstOrThrow({ where: { prescriptionId: rx.id } })).id
  }

  beforeAll(async () => {
    prisma = testPrisma(2)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    marsh = { session: sessionFor('seed_user_marsh', ALL), prisma }
    lopez = { session: sessionFor('seed_user_lopez', ALL), prisma }
    patientId = (await prisma.vcprRecord.findFirstOrThrow({ where: { status: 'active', expiresAt: { gt: new Date() }, locationId: 'seed_loc_main', patient: { status: 'active', species: { code: 'canine' } } } })).patientId!
  }, 300_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('a fill larger than the lot is refused; a normal fill takes its quantity off the lot', async () => {
    const line = await rxLine('seed_drug_cefovecin', '100')
    expect(await onHand('seed_lot_cefovecin_main')).toBe(24)
    await expect(dispenseFill(null, { lineId: line, quantity: '74', lotId: 'seed_lot_cefovecin_main', idempotencyKey: key() }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'not_enough_stock' } })
    await expect(dispenseFill(null, { lineId: line, quantity: '25', idempotencyKey: key() }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    expect(await prisma.dispense.count({ where: { lineId: line } })).toBe(0)
    const ok = await dispenseFill(null, { lineId: line, quantity: '4', idempotencyKey: key() }, lopez)
    expect(await onHand('seed_lot_cefovecin_main')).toBe(20)
    const d = await prisma.dispense.findUniqueOrThrow({ where: { id: ok.id } })
    expect(d.lotId).toBe('seed_lot_cefovecin_main')
    const mv = await prisma.stockMovement.findMany({ where: { sourceType: 'dispense', sourceId: ok.id } })
    expect(mv.map(m => [m.kind, m.qtySigned.toString()])).toEqual([['dispense', '-4']])
  }, 120_000)

  it('a fill with no eligible lot (the only lot quarantined) is refused', async () => {
    const line = await rxLine('seed_drug_carprofen', '30')
    const lot = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: 'seed_lot_carprofen_main' } })
    await setLotQuarantine(null, { lotId: lot.id, quarantine: true, reason: 'Damaged packaging', expectedVersion: lot.version, idempotencyKey: key() }, marsh)
    await expect(dispenseFill(null, { lineId: line, quantity: '30', idempotencyKey: key() }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'no_stock' } })
    await expect(dispenseFill(null, { lineId: line, quantity: '30', lotId: lot.id, idempotencyKey: key() }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    expect(await prisma.dispense.count({ where: { lineId: line } })).toBe(0)
    expect(await onHand(lot.id)).toBe(240)
  }, 120_000)

  it('a lot dose and a vaccine take stock off their lot; a reversal puts the dose back', async () => {
    const enc = await openEncounter(null, { patientId, locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Nausea and annual vaccines', attendingDvmId: 'seed_staff_marsh', idempotencyKey: key() }, marsh)
    const order = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_maropitant', route: 'sc', frequency: 'once', dose: { doseAmount: '1', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: key() }, marsh)
    const before = await onHand('seed_lot_maropitant_main')
    const given = await recordAdministration(null, { orderId: order.id, lotId: 'seed_lot_maropitant_main', route: 'sc', idempotencyKey: key() }, lopez)
    expect(before - (await onHand('seed_lot_maropitant_main'))).toBeCloseTo(Number(given.qty), 6)
    await reverseAdministration(null, { administrationId: given.id, reason: 'Recorded on the wrong order', idempotencyKey: key() }, marsh)
    expect(await onHand('seed_lot_maropitant_main')).toBeCloseTo(before, 6)
    const vxBefore = await onHand('seed_lot_dapp_main')
    await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_dapp', lotId: 'seed_lot_dapp_main', site: 'Right forelimb SC', idempotencyKey: key() }, marsh)
    expect(await onHand('seed_lot_dapp_main')).toBe(vxBefore - 1)
  }, 120_000)
})
