import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { verifyAuditChain } from '../lib/audit'
import { US_FED_HOLIDAYS } from '../lib/calendar'
import { runInTransaction } from '../lib/unitOfWork'
import { resolvePolicy } from '../domain/policy'
import { requireDeaRegistration, requireLicence } from '../domain/licensure'
import { loadPracticeSetup } from './setup'
import { cancelApprovalRequest, decideApprovalRequest, requestPracticeControls } from './approvals'
import { policyMatrix } from './practice'
import { APPROVAL_POLICIES, DEA_REGISTRATIONS, LOCATIONS, ROLES, STAFF } from '../seed/practice'
import { POLICY_PACKS } from '../seed/policies'

/** A Keystone-like session for a user with the given permissions. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@test.local`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})

const AT = new Date('2026-11-09T18:00:00Z') // Monday 10:00 in Sacramento

describe.skipIf(!hasTestDatabase)('Phase 0 commands (database)', () => {
  let prisma: PrismaClient
  let owner: { session: unknown; prisma: PrismaClient }
  let director: { session: unknown; prisma: PrismaClient }
  let csr: { session: unknown; prisma: PrismaClient }

  beforeAll(async () => {
    prisma = testPrisma(8)
    await resetDatabase(prisma)
    const make = (name: string) => prisma.user.create({ data: { name, email: `${uniqueKey(name)}@test.local`, password: 'x'.repeat(60) } })
    const [o, d, c] = await Promise.all([make('owner'), make('director'), make('csr')])
    owner = { session: sessionFor(o.id, permissionNames.filter(p => p !== 'canBreakGlass')), prisma }
    director = { session: sessionFor(d.id, ['canAccessDashboard', 'canApprovePolicies', 'canReadAudit']), prisma }
    csr = { session: sessionFor(c.id, ['canAccessDashboard', 'canBook', 'canCheckIn']), prisma }
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('loads the practice once: a second load with a new key creates nothing, and a replay returns the first result', async () => {
    const key = uniqueKey('setup')
    const first = await loadPracticeSetup(null, { idempotencyKey: key }, owner)
    expect(first.replay).toBe(false)
    expect(first.created).toMatchObject({
      practice: 1, locations: LOCATIONS.length, calendars: 1 + LOCATIONS.length, roles: ROLES.length, staff: STAFF.length,
      licences: STAFF.filter(s => s.licence).length, deaRegistrations: DEA_REGISTRATIONS.length, policyPacks: POLICY_PACKS.length,
      policyVersions: POLICY_PACKS.length, approvalPolicies: APPROVAL_POLICIES.length,
    })
    expect(first.created.calendarExceptions).toBeGreaterThanOrEqual(US_FED_HOLIDAYS.length)

    const replay = await loadPracticeSetup(null, { idempotencyKey: key }, owner)
    expect(replay).toEqual({ ...first, replay: true })

    const again = await loadPracticeSetup(null, { idempotencyKey: uniqueKey('setup') }, owner)
    expect(Object.values(again.created).every(n => n === 0)).toBe(true)

    const roles = await prisma.role.findMany({ where: { id: { startsWith: 'seed_' } } })
    expect(roles.some(role => (role as Record<string, unknown>).canBreakGlass === true)).toBe(false)
    const seeded = await prisma.user.findMany({ where: { id: { startsWith: 'seed_' } } })
    expect(seeded).toHaveLength(STAFF.length)
    expect(new Set(seeded.map(u => u.password)).size).toBe(1)
    expect(seeded.find(u => u.id === 'seed_user_cole')?.accessExpiresAt).not.toBeNull()

    const chain = await verifyAuditChain(prisma)
    expect(chain.ok).toBe(true)
    expect(chain.count).toBeGreaterThan(ROLES.length + STAFF.length)
  })

  it('refuses setup without canManageOnboarding', async () => {
    await expect(loadPracticeSetup(null, { idempotencyKey: uniqueKey('setup') }, csr)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
  })

  it('every policy kind resolves at both California locations, and unverified rules surface', async () => {
    const rows = await policyMatrix(null, {}, owner) as { ok: boolean; kind: string; location: string; verified?: boolean; unverifiedRules?: string[] }[]
    const failing = rows.filter(r => !r.ok)
    expect(failing).toEqual([])
    const cs = await resolvePolicy(prisma, 'controlled_substances', { locationId: 'seed_loc_main', on: '2026-11-09' })
    // Federal 2 years, California 3: the state layer is stricter and wins; CURES 7 days applies.
    expect(cs.rules.recordRetentionYears).toBe(3)
    expect(cs.rules.pdmp).toMatchObject({ required: true, maxDays: 7, program: 'CURES' })
    expect(cs.rules.destructionWitnesses).toBe(2)
    expect(cs.rules.witnessRequired.waste).toBe(true)
    expect(cs.versions.map(v => v.layer)).toEqual(['federal', 'state', 'local'])
    const vcpr = await resolvePolicy(prisma, 'vcpr', { locationId: 'seed_loc_main', on: '2026-11-09' })
    expect(vcpr.verified).toBe(false)
    expect(vcpr.unverifiedRules.length).toBeGreaterThan(0)
    const rx = await resolvePolicy(prisma, 'prescription', { locationId: 'seed_loc_elkgrove', on: '2026-11-09' })
    expect(rx.rules.refillLimits.CII?.maxRefills).toBe(0)
  })

  it('fails closed: before any version is in force, and for a location with no state pack', async () => {
    await expect(resolvePolicy(prisma, 'vcpr', { locationId: 'seed_loc_main', on: '2025-06-01' })).rejects.toMatchObject({ code: 'POLICY_UNRESOLVED' })
    await prisma.location.create({ data: { id: 'test_loc_nv', code: 'TEST-NV', name: 'Reno pop-up', stateCode: 'US-NV', timeZone: 'America/Los_Angeles' } })
    // The federal licensure pack does not exist, and no Nevada pack is bound: nothing resolves.
    await expect(resolvePolicy(prisma, 'licensure', { locationId: 'test_loc_nv', on: '2026-11-09' })).rejects.toMatchObject({ code: 'POLICY_UNRESOLVED' })
    // Federal-only VCPR rules are incomplete without a state layer, so they fail the full schema.
    await expect(resolvePolicy(prisma, 'vcpr', { locationId: 'test_loc_nv', on: '2026-11-09' })).rejects.toMatchObject({ code: 'POLICY_UNRESOLVED' })
  })

  it('licence and DEA guards: active CA licence and a location registration covering the schedule', async () => {
    const ok = await runInTransaction(prisma, uow => requireLicence(uow.tx, { staffMemberId: 'seed_staff_okafor', locationId: 'seed_loc_main', action: 'prescribe', at: AT }))
    expect(ok.licenseId).toBe('seed_lic_okafor')
    // Bennett's licence expired 2026-10-31.
    await expect(runInTransaction(prisma, uow => requireLicence(uow.tx, { staffMemberId: 'seed_staff_bennett', locationId: 'seed_loc_main', action: 'prescribe', at: AT }))).rejects.toMatchObject({ code: 'LICENSE_INACTIVE' })
    // An RVT may induce anaesthesia but may not prescribe.
    await runInTransaction(prisma, uow => requireLicence(uow.tx, { staffMemberId: 'seed_staff_lopez', locationId: 'seed_loc_main', action: 'induce_anaesthesia', at: AT }))
    await expect(runInTransaction(prisma, uow => requireLicence(uow.tx, { staffMemberId: 'seed_staff_lopez', locationId: 'seed_loc_main', action: 'prescribe', at: AT }))).rejects.toMatchObject({ code: 'LICENSE_INACTIVE' })
    // Elk Grove's registration does not cover Schedule II; the main hospital's does.
    await expect(runInTransaction(prisma, uow => requireDeaRegistration(uow.tx, { locationId: 'seed_loc_elkgrove', schedule: 'CII', at: AT, action: 'cs.receive' }))).rejects.toMatchObject({ code: 'DEA_REGISTRATION_INVALID' })
    const dea = await runInTransaction(prisma, uow => requireDeaRegistration(uow.tx, { locationId: 'seed_loc_main', schedule: 'CII', at: AT, action: 'cs.receive' }))
    expect(dea.registrationNumber).toBe('BB7418521')
    // Dr. Cole's own registration expired: she cannot prescribe CS on it.
    await expect(runInTransaction(prisma, uow => requireDeaRegistration(uow.tx, { locationId: 'seed_loc_main', schedule: 'CIV', at: AT, action: 'rx.sign', registrantStaffMemberId: 'seed_staff_cole' }))).rejects.toMatchObject({ code: 'DEA_REGISTRATION_INVALID' })
    // CI is never allowed.
    await expect(runInTransaction(prisma, uow => requireDeaRegistration(uow.tx, { locationId: 'seed_loc_main', schedule: 'CI', at: AT, action: 'cs.receive' }))).rejects.toMatchObject({ code: 'DEA_REGISTRATION_INVALID' })
    expect(await prisma.licenseEvaluation.count()).toBe(3)
  })

  it('append-only rows cannot be changed: policy versions, licence evaluations, read audits', async () => {
    const version = await prisma.policyVersion.findFirstOrThrow()
    await expect(prisma.policyVersion.update({ where: { id: version.id }, data: { label: 'tampered' } })).rejects.toThrow(/append-only/)
    const evaluation = await prisma.licenseEvaluation.findFirstOrThrow()
    await expect(prisma.licenseEvaluation.delete({ where: { id: evaluation.id } })).rejects.toThrow(/append-only/)
    const read = await prisma.readAudit.create({ data: { actorKind: 'user', actorId: 'u1', resourceType: 'Patient', resourceId: 'p1', purpose: 'treatment' } })
    await expect(prisma.readAudit.update({ where: { id: read.id }, data: { purpose: 'audit' } })).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRawUnsafe(`UPDATE "DeaRegistration" SET "registrationNumber" = 'BB7418522' WHERE id = 'seed_dea_main'`)).rejects.toThrow(/DEA number/)
  })

  it('practice controls change only after a second person approves, and the approved payload is what applies', async () => {
    const before = await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })
    expect(before.noShowGraceMinutes).toBe(15)
    expect((before.features as Record<string, boolean>).aiVoice).toBe(false)

    await expect(requestPracticeControls(null, { changes: { noShowGraceMinutes: 999 }, reason: 'too long', idempotencyKey: uniqueKey('pc') }, owner)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(requestPracticeControls(null, { changes: { features: { teleport: true } } as never, reason: 'x', idempotencyKey: uniqueKey('pc') }, owner)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(requestPracticeControls(null, { changes: { noShowGraceMinutes: 10 }, reason: 'tighten', idempotencyKey: uniqueKey('pc') }, csr)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })

    const asked = await requestPracticeControls(null, { changes: { features: { aiVoice: true }, noShowGraceMinutes: 10 }, reason: 'Turn on the AI receptionist for after-hours calls', idempotencyKey: uniqueKey('pc') }, owner)
    expect(asked.status).toBe('pending')
    expect(((await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })).features as Record<string, boolean>).aiVoice).toBe(false)

    // The requester holds canApprovePolicies too, but cannot approve their own request.
    await expect(decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, owner)).rejects.toMatchObject({ code: 'SELF_APPROVAL' })
    await expect(decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, csr)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 7, idempotencyKey: uniqueKey('d') }, director)).rejects.toMatchObject({ code: 'STALE_STATE' })

    const key = uniqueKey('d')
    const approved = await decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 0, idempotencyKey: key }, director)
    expect(approved).toMatchObject({ status: 'approved', replay: false })
    const after = await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })
    expect(after.noShowGraceMinutes).toBe(10)
    expect((after.features as Record<string, boolean>)).toMatchObject({ aiVoice: true, boarding: true })
    expect(after.version).toBe(before.version + 1)

    const replay = await decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 0, idempotencyKey: key }, director)
    expect(replay.replay).toBe(true)
    expect((await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })).version).toBe(after.version)

    const events = await prisma.auditEvent.findMany({ where: { entityId: { in: [asked.id, '1'] } }, orderBy: { seq: 'asc' } })
    expect(events.map(e => e.eventType)).toEqual(expect.arrayContaining(['approval.requested', 'approval.approved', 'approval.consumed', 'practice.controls_changed']))
    expect((await verifyAuditChain(prisma)).ok).toBe(true)
  })

  it('a change approved against an old version is refused when applied after another change landed', async () => {
    const one = await requestPracticeControls(null, { changes: { noShowGraceMinutes: 20 }, reason: 'first', idempotencyKey: uniqueKey('pc') }, owner)
    const two = await requestPracticeControls(null, { changes: { estimateValidityDays: 14 }, reason: 'second', idempotencyKey: uniqueKey('pc') }, owner)
    await decideApprovalRequest(null, { requestId: one.id, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, director)
    await expect(decideApprovalRequest(null, { requestId: two.id, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, director)).rejects.toMatchObject({ code: 'STALE_STATE' })
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: two.id } })).status).toBe('pending')
    expect((await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })).estimateValidityDays).toBe(30)
  })

  it('rejecting needs a reason; only the requester can withdraw', async () => {
    const asked = await requestPracticeControls(null, { changes: { noShowGraceMinutes: 5 }, reason: 'try', idempotencyKey: uniqueKey('pc') }, owner)
    await expect(decideApprovalRequest(null, { requestId: asked.id, decision: 'reject', reason: ' ', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, director)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(cancelApprovalRequest(null, { requestId: asked.id, expectedVersion: 0, idempotencyKey: uniqueKey('c') }, director)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    const withdrawn = await cancelApprovalRequest(null, { requestId: asked.id, expectedVersion: 0, idempotencyKey: uniqueKey('c') }, owner)
    expect(withdrawn.status).toBe('cancelled')
  })
})
