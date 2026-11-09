import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { ROLES } from '../seed/practice'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { openEncounter } from './record'
import { administerVaccine } from './vaccines'
import { previewImport, applyImport } from './imports'
import { startScribeSession, draftScribeSession, acceptScribeDraft } from './scribe'
import { bindAgentApp, unbindAgentApp } from './agents'
import { actorFor } from './actorFor'

/**
 * Review r3b, the checks it left unrun, against the scratch Postgres `vitest` schema:
 *   - no rabies certificate without the rabies vaccine it certifies (database, on its own);
 *   - scribe and import refuse roles without the permission (CSR, Practice Manager for scribe);
 *   - an agent token whose binding was removed gets no access; binding and unbinding revoke tokens.
 */
const sessionForRole = (userId: string, roleId: string) => {
  const role = ROLES.find(r => r.id === roleId)!
  return { itemId: userId, data: { name: userId, email: `${userId}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: role.id, name: role.name, ...Object.fromEntries(permissionNames.map(p => [p, role.permissions.includes(p)])) } } }
}
const pg = (e: unknown) => String((e as Error)?.message ?? e)
const DOG = 'seed_pet_007_1'

describe.skipIf(!hasTestDatabase)('r3b unrun checks (database)', () => {
  let prisma: PrismaClient
  const as = (userId: string, roleId: string) => ({ session: sessionForRole(userId, roleId), prisma })

  beforeAll(async () => {
    prisma = testPrisma(10)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: { itemId: boot.id, data: { name: 'boot', role: Object.fromEntries(permissionNames.filter(p => p !== 'canBreakGlass').map(p => [p, true])) } }, prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    await prisma.practiceSettings.update({ where: { id: 1 }, data: { features: { ...((await prisma.practiceSettings.findUniqueOrThrow({ where: { id: 1 } })).features as object), scribe: true } } })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('a rabies certificate cannot exist without the rabies vaccine it certifies', async () => {
    const okafor = as('seed_user_okafor', 'seed_role_dvm')
    const enc = await openEncounter(null, { patientId: DOG, locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Annual wellness and vaccines', attendingDvmId: 'seed_staff_okafor', idempotencyKey: uniqueKey('enc') }, okafor)
    const given = await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Right hindlimb SC', tagNumber: '26-207001', idempotencyKey: uniqueKey('vx') }, okafor)
    expect(given.certificate?.ref).toMatch(/^RAB-/)
    const cert = await prisma.rabiesCertificate.findUniqueOrThrow({ where: { id: given.certificate!.id } })
    // A bare certificate with no vaccine behind it, written straight to the database: refused at commit.
    await expect(prisma.rabiesCertificate.create({ data: { ref: 'RAB-2026-990777', patientId: DOG, vaccinatedOn: new Date(), durationMonths: 12, nextDueOn: new Date(Date.now() + 365 * 86_400_000), tagNumber: '26-207999', tagJurisdiction: cert.tagJurisdiction, reportedTo: 'none' } }))
      .rejects.toSatisfy(e => /needs the rabies vaccine it certifies/.test(pg(e)))
    // Pointing a non-rabies vaccine at a new certificate does not satisfy it either.
    const other = await prisma.vaccineAdministration.findFirst({ where: { product: { isRabies: false } }, select: { id: true } })
    await expect(prisma.$transaction(async tx => {
      const c = await tx.rabiesCertificate.create({ data: { ref: 'RAB-2026-990778', patientId: DOG, vaccinatedOn: new Date(), durationMonths: 12, nextDueOn: new Date(Date.now() + 365 * 86_400_000), tagNumber: '26-207998', tagJurisdiction: cert.tagJurisdiction, reportedTo: 'none' } })
      if (other) await tx.vaccineAdministration.update({ where: { id: other.id }, data: { certificateId: c.id } }).catch(() => undefined)
    })).rejects.toSatisfy(e => /needs the rabies vaccine it certifies/.test(pg(e)))
    expect(await prisma.rabiesCertificate.count({ where: { ref: { in: ['RAB-2026-990777', 'RAB-2026-990778'] } } })).toBe(0)
  }, 120_000)

  it('scribe refuses the front desk and the practice manager; import refuses the front desk', async () => {
    const okafor = as('seed_user_okafor', 'seed_role_dvm')
    const enc = await openEncounter(null, { patientId: DOG, locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Itchy skin for two weeks', attendingDvmId: 'seed_staff_okafor', idempotencyKey: uniqueKey('enc') }, okafor)
    for (const [user, role] of [['seed_user_kim', 'seed_role_csr'], ['seed_user_park', 'seed_role_manager']] as const) {
      await expect(startScribeSession(null, { encounterId: enc.id, clientConsent: true, consentMethod: 'staff_entry', staffAcknowledged: true, idempotencyKey: uniqueKey('sc') }, as(user, role))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
      await expect(draftScribeSession(null, { sessionId: 'any', pastedTranscript: 'x', idempotencyKey: uniqueKey('sd') }, as(user, role))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
      await expect(acceptScribeDraft(null, { draftId: 'any', blocks: [{ index: 0 }], idempotencyKey: uniqueKey('sa') }, as(user, role))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    }
    // The clinician may start it (the role check is what refused the others, not a missing setting).
    const started = await startScribeSession(null, { encounterId: enc.id, clientConsent: true, consentMethod: 'staff_entry', staffAcknowledged: true, idempotencyKey: uniqueKey('sc') }, okafor)
    expect(started.status).toBe('recording')
    const csv = 'Client ID,First Name,Last Name,Email\nAV-7001,Iris,Lane,iris.lane.av7001@gmail.com\n'
    const kim = as('seed_user_kim', 'seed_role_csr')
    await expect(previewImport(null, { system: 'avimark', entity: 'clients', locationId: 'seed_loc_main', fileName: 'c.csv', csv, idempotencyKey: uniqueKey('p') }, kim)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    const preview = await previewImport(null, { system: 'avimark', entity: 'clients', locationId: 'seed_loc_main', fileName: 'c.csv', csv, idempotencyKey: uniqueKey('p') }, as('seed_user_park', 'seed_role_manager'))
    await expect(applyImport(null, { batchId: preview.id, idempotencyKey: uniqueKey('a') }, kim)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    expect(await prisma.externalId.count({ where: { system: 'avimark:clients', value: 'AV-7001' } })).toBe(0)
  }, 120_000)

  it('an agent token acts only while bound; unbinding revokes every token and the marker never becomes the person', async () => {
    const manager = as('seed_user_park', 'seed_role_manager')
    const app = await prisma.oAuthApp.findUniqueOrThrow({ where: { id: 'seed_oauth_reception' } })
    const agent = await prisma.agentIdentity.findUniqueOrThrow({ where: { id: 'seed_agent_reception' } })
    expect(agent.oauthAppId).toBe(app.id)
    expect(await prisma.user.findUnique({ where: { id: 'agent_user_seed_agent_reception' }, select: { roleId: true } })).toEqual({ roleId: 'seed_role_ai_agent' })
    const approver = sessionForRole('seed_user_marsh', 'seed_role_owner')
    const tokenSession = (agentId?: string) => ({ ...approver, mcp: { clientId: app.clientId, scopes: ['mcp:read', 'mcp:write'], tokenId: 't1', ...(agentId ? { agentId } : {}) } })
    // While bound: the agent, never the owner who approved the connection.
    expect(await actorFor({ session: tokenSession('seed_agent_reception'), prisma })).toMatchObject({ kind: 'agent', agentId: 'seed_agent_reception' })
    await prisma.oAuthToken.create({ data: { tokenType: 'access_token', token: uniqueKey('tok'), clientId: app.clientId, userId: 'seed_user_marsh', agentId: 'seed_agent_reception', isRevoked: 'false', expiresAt: new Date(Date.now() + 3_600_000) } })
    const unbound = await unbindAgentApp(null, { agentId: agent.id, expectedVersion: agent.version, idempotencyKey: uniqueKey('ub') }, manager)
    expect(unbound.revokedTokens).toBeGreaterThanOrEqual(1)
    expect(await prisma.oAuthToken.count({ where: { clientId: app.clientId, isRevoked: 'false' } })).toBe(0)
    // After unbinding, a session still carrying the agent marker is refused, never the approving person.
    await expect(actorFor({ session: tokenSession('seed_agent_reception'), prisma })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    // Rebind: a token from before the binding is revoked too.
    await prisma.oAuthToken.create({ data: { tokenType: 'access_token', token: uniqueKey('tok'), clientId: app.clientId, userId: 'seed_user_marsh', agentId: '', isRevoked: 'false', expiresAt: new Date(Date.now() + 3_600_000) } })
    const bound = await bindAgentApp(null, { agentId: agent.id, oauthAppId: app.id, expectedVersion: unbound.version, idempotencyKey: uniqueKey('b') }, manager)
    expect(bound.revokedTokens).toBe(1)
    // Only people with canManageAgents bind; an agent can never do it.
    await expect(unbindAgentApp(null, { agentId: agent.id, expectedVersion: bound.version, idempotencyKey: uniqueKey('ub') }, as('seed_user_kim', 'seed_role_csr'))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(unbindAgentApp(null, { agentId: agent.id, expectedVersion: bound.version, idempotencyKey: uniqueKey('ub') }, { session: tokenSession('seed_agent_reception'), prisma })).rejects.toMatchObject({ code: 'NEVER_ALLOWED_FOR_AGENTS' })
    const audit = await prisma.auditEvent.findMany({ where: { entityId: agent.id, eventType: { in: ['agent.app_bound', 'agent.app_unbound'] } }, select: { eventType: true } })
    expect(audit.map(a => a.eventType).sort()).toEqual(['agent.app_bound', 'agent.app_unbound'])
  }, 120_000)
})
