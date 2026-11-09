import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildSchema, parse } from 'graphql'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { ENCOUNTER_QUERY } from '../features/platform/encounters/screens/encounterQuery'
import { API_MAX_ROOT_FIELDS, API_MAX_ROOT_ROWS, breadthLimitPlugin, measureBreadth } from '../features/keystone/security/breadthLimit'

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
  it('counts a nested list with no take as a full page', () => expect(verdict('query { patients(take: 20) { weights { id } } }')).toMatch(/rows/))
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
