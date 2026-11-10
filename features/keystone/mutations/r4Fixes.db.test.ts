import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { openEncounter } from './record'
import { saveDentalChart } from './treatment'
import { refreshClinicalClocks } from './clocks'

/* Review r4 F4 (dental findings) and the staff-run clocks (no scheduler), against the scratch `vitest` schema. */
const sessionFor = (id: string) => ({ itemId: id, data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, p !== 'canBreakGlass'])) } } })
const pg = (e: unknown) => String((e as Error)?.message ?? e)

describe.skipIf(!hasTestDatabase)('r4 fixes (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }
  beforeAll(async () => {
    prisma = testPrisma(10)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    marsh = { session: sessionFor('seed_user_marsh'), prisma }
  }, 300_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('F4: dental findings must be short strings, in the mutation and in the database', async () => {
    const enc = await openEncounter(null, { patientId: 'seed_pet_005_1', locationId: 'seed_loc_main', kind: 'dental', reason: 'Dental cleaning', attendingDvmId: 'seed_staff_okafor', idempotencyKey: uniqueKey('enc') }, marsh)
    const save = (teeth: unknown) => saveDentalChart(null, { encounterId: enc.id, teeth: teeth as never, idempotencyKey: uniqueKey('d') }, marsh)
    await expect(save({ 104: { findings: [{ a: 1 }] } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(save({ 104: { findings: [42] } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(save({ 104: { findings: ['x'.repeat(100_000)] } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(save({ 104: { findings: Array(51).fill('a') } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(save({ 104: { procedures: [null] } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(save({ 104: { findings: ['calculus grade 2', 'gingivitis'], procedures: ['scale'] } })).resolves.toBeTruthy()
    const row = await prisma.dentalChart.findFirstOrThrow({ where: { encounterId: enc.id } })
    // The database refuses on its own what the application would also refuse.
    for (const teeth of [{ 204: { findings: [1] } }, { 204: { findings: ['y'.repeat(501)] } }, { 204: { procedures: [{}] } }]) {
      const err = await prisma.dentalChart.update({ where: { id: row.id }, data: { teeth: teeth as never } }).catch(e => e)
      expect(pg(err)).toMatch(/DentalChart_teeth_shape|check constraint/i)
    }
    await expect(prisma.dentalChart.update({ where: { id: row.id }, data: { teeth: { 204: { findings: ['ok'] } } } })).resolves.toBeTruthy()
  }, 120_000)

  it('the clocks run when staff press Refresh, twice in a row is harmless, and no scheduler tables exist', async () => {
    const first = await refreshClinicalClocks(null, { idempotencyKey: uniqueKey('clk') }, marsh)
    expect(first.reminders.length).toBeGreaterThan(0)
    const again = await refreshClinicalClocks(null, { idempotencyKey: uniqueKey('clk') }, marsh)
    expect(again.records.raised).toBe(0)
    expect(again.reminders.every(r => r.changed === 0)).toBe(true)
    const tables = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('OutboxEvent', 'ScheduledJob', 'Lease')`
    expect(tables[0].n).toBe(0)
  }, 120_000)
})
