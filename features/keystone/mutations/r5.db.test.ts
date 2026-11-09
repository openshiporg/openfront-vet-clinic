import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildSchema, parse } from 'graphql'
import { TEST_DATABASE_URL, hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { ENCOUNTER_QUERY } from '../../platform/encounters/screens/encounterQuery'
import { API_MAX_ROOT_ROWS, breadthLimitPlugin, measureBreadth } from '../security/breadthLimit'
import { permissionNames } from '../access'
import { ROLES } from '../seed/practice'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { openEncounter } from './record'

/* Review r5 #4: scribe maker-checker is enforced by the database on its own. */
describe.skipIf(!hasTestDatabase)('scribe maker-checker in the database (r5)', () => {
  let prisma: PrismaClient
  beforeAll(async () => { prisma = testPrisma(4); await resetDatabase(prisma) }, 120_000)
  afterAll(async () => { await prisma?.$disconnect() })
  const refused = async (sql: string) => {
    const message = await prisma.$transaction(async tx => { await tx.$executeRawUnsafe(sql) }).then(() => '', e => String((e as Error).message))
    return message
  }
  for (const status of ['accepted', 'partly_accepted', 'rejected']) {
    it(`a ${status} draft with no decider is refused`, async () => {
      expect(await refused(`INSERT INTO "ScribeDraft" (id, status, "updatedAt") VALUES ('r5_${status}', '${status}', now())`)).toMatch(/ScribeDraft_decision_names_decider/)
    })
  }
  it('a proposed draft needs no decider', async () => {
    expect(await refused(`INSERT INTO "ScribeDraft" (id, status, "updatedAt") VALUES ('r5_proposed_ok', 'proposed', now())`)).toBe('')
  })
  it('a scribe revision with no draft or no author is refused', async () => {
    expect(await refused(`INSERT INTO "SoapSectionRevision" (id, "revisionNumber", source, at, "contentHash") VALUES ('r5_rev', 1, 'scribe', now(), '${'a'.repeat(64)}')`)).toMatch(/SoapSectionRevision_scribe_has_draft_and_author/)
  })
})

/* Review r5 #1: the medical record page's own query must pass the breadth limit and answer, for every role. */
describe.skipIf(!hasTestDatabase)('the encounter page query runs as DVM, owner and CSR (r5)', () => {
  let prisma: PrismaClient
  let encounterId = ''
  const sessionFor = (roleId: string, userId: string) => {
    const role = ROLES.find(r => r.id === roleId)!
    return { itemId: userId, listKey: 'User', data: { name: role.name, email: `${userId}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: role.id, name: role.name, ...Object.fromEntries(permissionNames.map(p => [p, role.permissions.includes(p as never)])) } } }
  }
  beforeAll(async () => {
    prisma = testPrisma(6)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: { itemId: boot.id, data: { name: 'boot', email: 'b@cedarcreekvet.com', kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.filter(p => p !== 'canBreakGlass').map(p => [p, true])) } } }, prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    const enc: any = await openEncounter(null, { patientId: 'seed_pet_005_1', locationId: 'seed_loc_main', kind: 'outpatient', reason: 'r5', attendingDvmId: 'seed_staff_marsh', idempotencyKey: uniqueKey('enc') }, { session: sessionFor('seed_role_dvm', 'seed_user_marsh'), prisma })
    encounterId = enc.id ?? enc.encounter?.id
  }, 300_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('the document passes the breadth limit and a fan-out attack does not', () => {
    const schema = buildSchema(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.graphql'), 'utf8'))
    const refuse = (query: string, variables?: Record<string, unknown>) => {
      let result: any
      breadthLimitPlugin().onExecute({ args: { schema, document: parse(query), variableValues: variables }, setResultAndStopExecution: r => { result = r } })
      return result?.errors?.[0]?.extensions?.code
    }
    expect(refuse(ENCOUNTER_QUERY, { id: encounterId })).toBeUndefined()
    expect(measureBreadth(schema, parse(ENCOUNTER_QUERY), null, { id: encounterId }).rows).toBeLessThan(API_MAX_ROOT_ROWS)
    expect(refuse(`query { patients(take: 500) { ${Array.from({ length: 100 }, (_, i) => `w${i}: weights { id }`).join(' ')} } }`)).toBe('QUERY_TOO_BROAD')
  })

  for (const [name, roleId, userId] of [['DVM', 'seed_role_dvm', 'seed_user_marsh'], ['owner', 'seed_role_owner', 'seed_user_okafor'], ['CSR', 'seed_role_csr', 'seed_user_reed']] as const) {
    it(`${name}: Keystone accepts every field of the query`, async () => {
      const { getContext } = await import('@keystone-6/core/context')
      const PrismaModule = await import('@prisma/client')
      const config = (await import('../index')).default
      const context: any = getContext(config as never, PrismaModule)
      const result = await context.withSession(sessionFor(roleId, userId)).graphql.raw({ query: ENCOUNTER_QUERY, variables: { id: encounterId } })
      // The page only needs the query to validate and execute; a role may be denied rows but never the document.
      expect(JSON.stringify(result.errors ?? []), name).not.toMatch(/QUERY_TOO_BROAD|Cannot query field|Unknown argument|Variable/)
    })
  }
})
