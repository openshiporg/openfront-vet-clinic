import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildSchema, parse } from 'graphql'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { ENCOUNTER_QUERY } from '../features/platform/encounters/screens/encounterQuery'
import { API_MAX_ALIASES_PER_FIELD, API_MAX_RESOLVER_CALLS, API_MAX_ROOT_FIELDS, API_MAX_ROOT_ROWS, API_NESTED_DEFAULT, NESTED_LIST_BOUNDS, breadthLimitPlugin, breadthRefusal, measureBreadth } from '../features/keystone/security/breadthLimit'
import { screenDocuments } from './helpers/screenDocuments'

/* Review r4 F1: 40 aliases x take:500 in one document returned ~20k rows. Payload shapes live here only. */
const schema = buildSchema(fs.readFileSync(path.join(__dirname, '..', 'schema.graphql'), 'utf8'))
const aliases = (n: number, take: number) => `query { ${Array.from({ length: n }, (_, i) => `a${i}: patients(take: ${take}) { id }`).join(' ')} }`
const verdict = (query: string, variables?: Record<string, unknown>) => {
  let result: any
  const plugin = breadthLimitPlugin()
  plugin.onExecute({ args: { schema, document: parse(query), variableValues: variables }, setResultAndStopExecution: r => { result = r } })
  return result?.errors?.[0]?.message as string | undefined
}

describe('GraphQL breadth limit (r4 F1)', () => {
  it('refuses 40 aliases of take:500', () => expect(verdict(aliases(40, 500))).toMatch(/top-level fields/))
  it('refuses few aliases whose rows add up past the cap', () => expect(verdict(aliases(API_MAX_ROOT_FIELDS, 500))).toMatch(/rows/))
  it('counts a list with no take as a full page', () => expect(verdict(`query { ${Array.from({ length: 11 }, (_, i) => `a${i}: patients { id }`).join(' ')} }`)).toMatch(/rows/))
  it('counts take given through a variable', () => expect(verdict('query($t: Int) { a: patients(take: $t) { id } b: patients(take: $t) { id } }', { t: API_MAX_ROOT_ROWS })).toMatch(/rows/))
  it('counts aliases hidden inside fragments', () => expect(verdict(`query { ...F } fragment F on Query { ${Array.from({ length: 30 }, (_, i) => `a${i}: patients(take: 1) { id }`).join(' ')} }`)).toMatch(/top-level fields/))
  it('allows ordinary screens (a few lists, 500 rows each, counts, introspection)', () => {
    expect(verdict('query { a: patients(take: 500) { id } b: clients(take: 500) { id } c: patientsCount __schema { types { name } } }')).toBeUndefined()
    expect(measureBreadth(schema, parse(aliases(10, 500)), null, null).rows).toBe(API_MAX_ROOT_ROWS)
    expect(verdict(aliases(10, 500))).toBeUndefined()
  })
})

/* Review r5 #1/#2: the cost model counts nested rows multiplicatively and the medical record page still fits. */
describe('nested fan-out is counted (r5)', () => {
  const nested = (roots: number, aliasesPerRoot: number) => `query { ${Array.from({ length: roots }, (_, r) => `r${r}: patients(take: 500) { ${Array.from({ length: aliasesPerRoot }, (_, i) => `w${i}: weights { id }`).join(' ')} }`).join(' ')} }`
  it('refuses 100 aliased weights under 500 patients', () => expect(verdict(nested(1, 100))).toMatch(/rows|fields at once/))
  it('refuses 10 roots x 20 nested aliases', () => expect(verdict(nested(10, 20))).toMatch(/rows|fields at once/))
  it('refuses a handful of nested lists whose rows multiply', () => expect(verdict('query { patients(take: 500) { weights(take: 500) { id } } }')).toMatch(/rows/))
  it('counts a nested list with no take as the nested default (r6: not a full page)', () => {
    expect(measureBreadth(schema, parse('query { patients(take: 20) { weights { id } } }'), null, null).rows).toBe(20 + 20 * API_NESTED_DEFAULT)
    expect(verdict('query { patients(take: 500) { weights { id } alerts { id } } }')).toMatch(/rows/)
  })
  it('counts nested lists inside fragments', () => expect(verdict('query { patients(take: 500) { ...F } } fragment F on Patient { a: weights(take: 500) { id } }')).toMatch(/rows/))
  it('refuses a very wide selection set', () => expect(verdict(`query { patients(take: 1) { ${Array.from({ length: 80 }, (_, i) => `a${i}: id`).join(' ')} } }`)).toMatch(/fields at once/))
  it('the medical record page query fits the limit (any role runs this same document)', () => {
    expect(verdict(ENCOUNTER_QUERY, { id: 'x' })).toBeUndefined()
    const b = measureBreadth(schema, parse(ENCOUNTER_QUERY), null, { id: 'x' })
    expect(b.rows).toBeLessThanOrEqual(API_MAX_ROOT_ROWS)
    expect(b.rows).toBeGreaterThan(1000)
  })
  it('ordinary nesting stays allowed', () => expect(verdict('query { patients(take: 50) { id weights(take: 5) { id } alerts(take: 10) { id } } }')).toBeUndefined())
})

/* Review r6 #1: the r5 cost model charged an unpaged nested list 500 rows per parent and broke most screens. */
describe('every dashboard screen document fits the limit (r6)', () => {
  const docs = screenDocuments()
  it('finds the screen documents', () => {
    expect(docs.length).toBeGreaterThan(30)
    for (const page of ['TodayPage', 'SchedulePage', 'WhiteboardPage', 'HospitalPage', 'PatientsPage', 'PatientPage', 'ClientsPage', 'ClientDetailPage', 'ApprovalsPage', 'TeamPage', 'AgentsPage', 'WaitlistPage', 'AuditPage', 'encounterQuery'])
      expect(docs.some(d => d.file.includes(`/${page}.`)), page).toBe(true)
  })
  for (const d of docs) {
    // The command runner builds `mutation Run(...) { op(...) }` from a table; it has no selection to measure.
    if (d.file.endsWith('actions/commands.ts')) continue
    it(`${d.file}:${d.line}`, () => {
      const b = measureBreadth(schema, parse(d.source), null, {})
      expect(breadthRefusal(b), JSON.stringify(b)).toBeNull()
    })
  }
})

describe('ordinary reads are allowed (r6)', () => {
  it('one encounter by ref with its sections and addenda (no take)', () => expect(verdict('{ encounters(where: { ref: { equals: "ENC-2026-000008" } }) { id sections { id } addenda { id } } }')).toBeUndefined())
  it('one order by ref with its administrations (no take)', () => expect(verdict('{ clinicalOrders(where: { ref: { equals: "ORD-2026-000011" } }) { id administrations { id } } }')).toBeUndefined())
  it('one patient by id with weights', () => expect(verdict('query($i: ID!) { patient(where: { id: $i }) { id weights { id } } }', { i: 'x' })).toBeUndefined())
  it('the staff list', () => expect(verdict('{ staffMembers { id } }')).toBeUndefined())
  it('a ref given by variable still bounds the rows', () => expect(verdict('query($r: String!) { encounters(where: { ref: { equals: $r } }) { id sections { id } } }', { r: 'ENC-1' })).toBeUndefined())
  it('a non-unique filter does not', () => expect(verdict('{ encounters(where: { status: { equals: "signed" } }) { id sections { id } addenda { id } } }')).toMatch(/rows/))
})

/* Review r6 #2: `<rel>Count` fields ran one query per parent row and were free. */
describe('count and resolver fields are charged (r6)', () => {
  const al = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join(' ')
  it('59 counts under 500 patients are refused', () => expect(verdict(`{ p: patients(take: 500) { ${al(59, i => `c${i}: weightsCount`)} } }`)).toMatch(/lookups|rows|repeats/))
  it('20 roots x 250 x 59 counts are refused', () => expect(verdict(`{ ${al(20, r => `r${r}: patients(take: 250, skip: ${r * 10}) { ${al(59, i => `c${i}: weightsCount`)} }`)} }`)).toMatch(/lookups|rows|repeats/))
  it('different counts under 500 rows add up past the lookup cap', () => {
    // 300 rows x 7 counts: 2,400 rows (under the row cap) but 2,101 separate queries.
    const b = measureBreadth(schema, parse(`{ patients(take: 300) { ownershipsCount alertsCount weightsCount microchipsCount vcprsCount insurancePoliciesCount a: alertsCount(where: { active: { equals: true } }) } }`), null, null)
    expect(b.rows).toBeLessThanOrEqual(API_MAX_ROOT_ROWS)
    expect(b.calls).toBeGreaterThan(API_MAX_RESOLVER_CALLS)
    expect(breadthRefusal(b)).toMatch(/lookups/)
  })
  it('an ordinary count read is allowed', () => expect(verdict('{ patientsCount clientsCount active: clientsCount(where: { status: { equals: "active" } }) }')).toBeUndefined())
  it('a count per row on a page of 50 is allowed', () => expect(verdict('{ patients(take: 50) { id weightsCount } }')).toBeUndefined())
  it('JSON resolvers are charged: many aliased policy matrices are refused', () => expect(verdict(`{ ${al(15, i => `m${i}: policyMatrix`)} }`)).toMatch(/rows|lookups/))
  it('one JSON resolver is allowed', () => expect(verdict('{ policyMatrix }')).toBeUndefined())
  it(`one list may not be aliased more than ${API_MAX_ALIASES_PER_FIELD} times in a selection`, () => expect(verdict(`{ patients(take: 1) { ${al(API_MAX_ALIASES_PER_FIELD + 1, i => `w${i}: weights(take: 1) { id }`)} } }`)).toMatch(/repeats/))
})

/* Review r6 #3/#5: unions and introspection. */
describe('union members and introspection are counted (r6)', () => {
  const al = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join(' ')
  it('walks into `authenticatedItem { ... on User }`', () => {
    const b = measureBreadth(schema, parse(`{ authenticatedItem { ... on User { staffMember { licenses(take: 7) { id } } } } }`), null, null)
    expect(b.rows).toBe(1 + 7)
  })
  it('55 aliased lists under the union are refused', () => expect(verdict(`{ authenticatedItem { ... on User { staffMember { ${al(55, i => `l${i}: licenses { id }`)} } } } }`)).toMatch(/repeats|rows/))
  it('a named fragment on the union member is walked too', () => expect(verdict(`{ authenticatedItem { ...U } } fragment U on User { staffMember { ${al(55, i => `l${i}: licenses { id }`)} } }`)).toMatch(/repeats|rows/))
  it('50 aliased __schema are refused', () => expect(verdict(`{ ${al(50, i => `s${i}: __schema { types { name } }`)} }`)).toMatch(/introspection/))
  it('one __schema (the MCP and admin UI discovery) is allowed', () => expect(verdict('{ __schema { types { name fields { name } } } }')).toBeUndefined())
})

describe('every field whose read is denied is not filterable or orderable (r4 F2)', () => {
  const lists: Record<string, any> = (getContext(config as never, PrismaModule) as any).__internal.lists
  const SECRET: [string, string][] = [
    ['OAuthToken', 'token'], ['OAuthToken', 'accessToken'], ['OAuthToken', 'refreshToken'], ['IntegrationConnection', 'secretRef'],
    ['WaitlistEntry', 'offeredSlotToken'], ['ApprovalRequest', 'payloadHash'], ['Proposal', 'payloadHash'], ['ProviderObservation', 'contentHash'],
  ]
  for (const [listKey, fieldKey] of SECRET) {
    it(`${listKey}.${fieldKey}`, () => {
      const field = lists[listKey].fields[fieldKey]
      expect(field.graphql.isEnabled.filter).toBe(false)
      expect(field.graphql.isEnabled.orderBy).toBe(false)
    })
  }
})

/* Review r7 #1/#3: an ordinary nested read with no takes works, and the estimate is the real nested default. */
describe('nested reads with no take (r7)', () => {
  const PATIENT_WITH_CONTACTS = 'query($i: ID!) { patient(where: { id: $i }) { id weights { id } alerts { id } ownerships { client { id people { id contactPoints { id } } } } } }'
  it('one patient with weights, alerts, owners, their people and contact points (no takes) is allowed', () => expect(verdict(PATIENT_WITH_CONTACTS, { i: 'x' })).toBeUndefined())
  it('one client with people, contact points and pets (no takes) is allowed', () => expect(verdict('query($i: ID!) { client(where: { id: $i }) { id people { id contactPoints { id } } ownerships { patient { id weights { id } } } } }', { i: 'x' })).toBeUndefined())
  it('the estimate is the schema default Keystone really returns, never less', () => {
    const fields = (schema.getType('Patient') as any).getFields()
    const takeDefault = (f: any) => f.args.find((a: any) => a.name === 'take').defaultValue
    expect(takeDefault(fields.weights)).toBe(API_NESTED_DEFAULT)
    expect(takeDefault(fields.ownerships)).toBe(NESTED_LIST_BOUNDS['Patient.ownerships'])
    expect(measureBreadth(schema, parse('query { patients(take: 20) { ownerships { id } } }'), null, null).rows).toBe(20 + 20 * NESTED_LIST_BOUNDS['Patient.ownerships'])
    // Root lists keep the full page: their default is the maxTake.
    expect((schema.getQueryType() as any).getFields().patients.args.find((a: any) => a.name === 'take').defaultValue).toBe(500)
    // No nested list in the schema defaults above the nested estimate unless it is listed with its own bound.
    for (const type of Object.values(schema.getTypeMap()) as any[]) {
      if (!type.getFields || type.name.startsWith('__') || type.name === 'Query' || type.name === 'Mutation') continue
      for (const f of Object.values(type.getFields()) as any[]) {
        const take = f.args?.find((a: any) => a.name === 'take')
        if (take) expect(take.defaultValue, `${type.name}.${f.name}`).toBe(NESTED_LIST_BOUNDS[`${type.name}.${f.name}`] ?? API_NESTED_DEFAULT)
      }
    }
  })
  it('an explicit nested take is still charged at its value', () => expect(verdict('query { patients(take: 500) { weights(take: 500) { id } } }')).toMatch(/rows/))
  it('the r6 fan-outs stay refused: 500 patients x their owners chain', () => expect(verdict('{ patients(take: 500) { ownerships { client { people { contactPoints { id } } } } } }')).toMatch(/rows|lookups/))
})

/* Review r7 #2/#4: one sign-in per request; the audit chain check at most twice. */
describe('root fields capped per request (r7)', () => {
  const al = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join(' ')
  const signIn = (i: number) => `a${i}: authenticateUserWithPassword(email: "n${i}@example.com", password: "p${i}") { __typename }`
  it('one sign-in is allowed', () => expect(verdict(`mutation { ${signIn(0)} }`)).toBeUndefined())
  it('two aliased sign-ins are refused', () => expect(verdict(`mutation { ${al(2, signIn)} }`)).toMatch(/authenticateUserWithPassword 2 times; at most 1/))
  it('20 aliased sign-ins (the r7 attack) are refused', () => expect(verdict(`mutation { ${al(20, signIn)} }`)).toMatch(/authenticateUserWithPassword 20 times/))
  it('sign-ins hidden in fragments are counted', () => expect(verdict(`mutation { ...A ...B } fragment A on Mutation { ${signIn(0)} } fragment B on Mutation { ${signIn(1)} }`)).toMatch(/authenticateUserWithPassword 2 times/))
  it('verifyAuditChain twice is allowed, three times refused', () => {
    expect(verdict(`{ ${al(2, i => `v${i}: verifyAuditChain`)} }`)).toBeUndefined()
    expect(verdict(`{ ${al(3, i => `v${i}: verifyAuditChain`)} }`)).toMatch(/verifyAuditChain 3 times; at most 2/)
    expect(verdict(`{ ${al(8, i => `v${i}: verifyAuditChain`)} }`)).toMatch(/verifyAuditChain 8 times/)
  })
  it('the audit page (one chain check) is allowed', () => expect(verdict('query { auditEventsCount verifyAuditChain }')).toBeUndefined())
})

/* Admin meta is schema config held in memory, not rows: the dashboard's full admin meta query must fit, its abuse must not. */
describe('admin meta (live sidebar and list pages were refused as about 130k rows)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'dashboard', 'actions', 'getAdminMetaAction.ts'), 'utf8')
  const ADMIN_META = src.slice(src.indexOf('query KsFetchAdminMeta'), src.lastIndexOf('`', src.indexOf('const response')))
  it('the dashboard admin meta query (every list, every field) is allowed', () => {
    expect(ADMIN_META).toMatch(/lists \{/)
    expect(verdict(ADMIN_META)).toBeUndefined()
  })
  it('the item page admin meta for one list with itemView(id) is allowed', () => expect(verdict('query($id: ID!, $k: String!) { patient(where: { id: $id }) { id } keystone { adminMeta { list(key: $k) { fields { path itemView(id: $id) { fieldMode fieldPosition } } } } } }', { id: 'x', k: 'Patient' })).toBeUndefined())
  it('two keystone roots are refused', () => expect(verdict('{ a: keystone { adminMeta { lists { key } } } b: keystone { adminMeta { lists { key } } } }')).toMatch(/keystone 2 times; at most 1/))
  it('aliased lists inside admin meta are refused', () => expect(verdict(`{ keystone { adminMeta { ${Array.from({ length: 5 }, (_, i) => `l${i}: lists { key }`).join(' ')} } } }`)).toMatch(/repeats lists/))
  it('aliased fields deeper inside are refused', () => expect(verdict('{ keystone { adminMeta { lists { fields { a: itemView { fieldMode } b: itemView { fieldMode } } } } } }')).toMatch(/repeats itemView/))
  it('itemView(id) on every list (one database read per list) is refused', () => expect(verdict('{ keystone { adminMeta { lists { fields { itemView(id: "x") { fieldMode } } } } } }')).toMatch(/itemView\(id\) on every list/))
  it('admin meta does not open a way around the row cap for real lists', () => expect(verdict('{ keystone { adminMeta { lists { key } } } patients(take: 500) { weights(take: 500) { id } } }')).toMatch(/rows/))
})
