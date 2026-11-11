import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { containerBalance } from '../lib/csRegister'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { advanceDiscrepancy, countControlled, destroyControlled, reportCsLoss, wasteControlled } from './pharmacy'

/**
 * Phase 3 register guards, attacked as a hostile application role: raw SQL straight at the tables, the
 * way a compromised app or a bad deploy would. The database, not the app code, must refuse.
 */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const pgError = (e: unknown) => String((e as Error)?.message ?? e)
const C = 'seed_csc_hydromorphone_1'

describe.skipIf(!hasTestDatabase)('Phase 3 controlled-substance register (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }

  beforeAll(async () => {
    prisma = testPrisma(10)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    marsh = { session: sessionFor('seed_user_marsh', ALL), prisma }
  }, 300_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('an entry cannot be edited or deleted, and the table cannot be truncated', async () => {
    const e = await prisma.csLogEntry.findFirstOrThrow({ where: { containerId: C } })
    await expect(prisma.$executeRawUnsafe(`UPDATE "CsLogEntry" SET "qtySigned" = 99 WHERE id = '${e.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CsLogEntry" WHERE id = '${e.id}'`)).rejects.toSatisfy(x => /append-only|never/i.test(pgError(x)))
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "CsLogEntry" CASCADE`)).rejects.toBeTruthy()
  })

  it('raw SQL cannot overdraw a container or record waste without a different witness', async () => {
    const e = await prisma.csLogEntry.findFirstOrThrow({ where: { containerId: C } })
    const base = { containerId: C, schedule: e.schedule, qtySigned: '-5000', unit: e.unit, actorId: 'seed_staff_lopez' }
    await expect(prisma.csLogEntry.create({ data: { ...base, ref: 'X1', type: 'waste', witnessId: 'seed_staff_price', occurredAt: new Date(), recordedAt: new Date(), hash: 'x', prevHash: '' } })).rejects.toBeTruthy()
    await expect(prisma.csLogEntry.create({ data: { ...base, qtySigned: '-0.01', ref: 'X2', type: 'waste', occurredAt: new Date(), recordedAt: new Date(), hash: 'x', prevHash: '' } })).rejects.toBeTruthy()
    await expect(prisma.csLogEntry.create({ data: { ...base, qtySigned: '-0.01', ref: 'X3', type: 'waste', witnessId: 'seed_staff_lopez', occurredAt: new Date(), recordedAt: new Date(), hash: 'x', prevHash: '' } })).rejects.toBeTruthy()
    await expect(prisma.csLogEntry.create({ data: { ...base, qtySigned: '-0.01', ref: 'X4', type: 'destroy', occurredAt: new Date(), recordedAt: new Date(), hash: 'x', prevHash: '' } })).rejects.toBeTruthy()
  })

  it('a count must cover every open container, and a difference opens a case with clocks', async () => {
    const open = await prisma.csContainer.findMany({ where: { locationId: 'seed_loc_main', status: 'open' } })
    await expect(countControlled(null, { locationId: 'seed_loc_main', kind: 'periodic', witnessId: 'seed_staff_price', counts: [{ containerId: C, countedQty: '0.1' }], idempotencyKey: uniqueKey('c') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const book = async (id: string) => (await prisma.$transaction(tx => containerBalance(tx as never, id))).toString()
    const counts = await Promise.all(open.map(async c => ({ containerId: c.id, countedQty: c.id === C ? '0.1' : await book(c.id) })))
    const done = await countControlled(null, { locationId: 'seed_loc_main', kind: 'periodic', witnessId: 'seed_staff_price', counts, idempotencyKey: uniqueKey('c') }, marsh)
    expect(done.variances).toBe(1)
    expect((await book(C))).toBe('0.1')
    const dc = await prisma.csDiscrepancyCase.findFirstOrThrow({ where: { containerId: C, kind: 'count_variance' } })
    expect(dc.noticeDueOn && dc.form106DueOn).toBeTruthy()
    const count = await prisma.csCount.findFirstOrThrow()
    await expect(prisma.$executeRawUnsafe(`UPDATE "CsCount" SET kind = 'spot' WHERE id = '${count.id}'`)).rejects.toBeTruthy()
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CsCountLine"`)).rejects.toBeTruthy()
  })

  it('theft needs notice and Form 106 before it closes; destruction needs two distinct witnesses', async () => {
    const loss = await reportCsLoss(null, { containerId: C, kind: 'theft', qty: '0.02', description: 'Vial missing from the locked cabinet at shift change', witnessId: 'seed_staff_price', idempotencyKey: uniqueKey('l') }, marsh)
    const row = await prisma.csDiscrepancyCase.findUniqueOrThrow({ where: { id: loss.id } })
    expect(row.noticeDueOn).toBeTruthy()
    expect(row.form106DueOn).toBeTruthy()
    await expect(prisma.$executeRawUnsafe(`UPDATE "CsDiscrepancyCase" SET status = 'closed', resolution = 'x', "closedAt" = now() WHERE id = '${loss.id}'`)).rejects.toBeTruthy()
    await expect(advanceDiscrepancy(null, { caseId: loss.id, step: 'close', resolution: 'Closed without filing', expectedVersion: row.version, idempotencyKey: uniqueKey('a') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "CsDiscrepancyCase" WHERE id = '${loss.id}'`)).rejects.toBeTruthy()
    await expect(destroyControlled(null, { containerId: C, method: 'Reverse distributor', witnessAId: 'seed_staff_price', witnessBId: 'seed_staff_price', idempotencyKey: uniqueKey('d') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(wasteControlled(null, { containerId: C, qty: '9999', reason: 'Spill', witnessId: 'seed_staff_price', idempotencyKey: uniqueKey('w') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
  })
})
