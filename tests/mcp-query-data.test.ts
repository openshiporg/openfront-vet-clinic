import { describe, expect, it } from 'vitest'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import { buildSchema, parse, validate, specifiedRules } from 'graphql'
import config from '../features/keystone'
import { buildListRead, listQueryAllowlist, MAX_DEPTH, MAX_TAKE, parseSelection, QueryInputError } from '../features/keystone/mcp/safeQuery'
import { API_MAX_DEPTH, depthLimitRule } from '../features/keystone/security/depthLimit'
import { API_MAX_TAKE } from '../features/keystone/models'

/*
 * F3 (review r3b): MCP queryData pasted the caller's operation and fields into the document, so a
 * caller could add another root field; nothing capped rows or depth. Payloads live here only.
 */
const context: any = getContext(config as never, PrismaModule)
// Built in this test's own graphql module (Keystone's schema object comes from another realm under vitest).
const schema = buildSchema(fs.readFileSync(path.join(__dirname, '..', 'schema.graphql'), 'utf8'))
const allow = listQueryAllowlist(context.__internal.lists)
const read = (input: Parameters<typeof buildListRead>[1]) => buildListRead(allow, input, schema)

describe('MCP queryData (F3)', () => {
  it('builds one allowlisted list read with variables and a default page', () => {
    const built = read({ operation: 'patients', fields: 'id name species { name }' })
    expect(built.query).toBe('query McpListRead($where: PatientWhereInput!, $take: Int!, $skip: Int!) { patients(where: $where, take: $take, skip: $skip) { id name species { name } } }')
    expect(built.variables).toEqual({ where: {}, take: 25, skip: 0 })
  })

  it('passes a where filter through as a variable (P5 r2 b), never into the document', () => {
    const built = read({ operation: 'patients', fields: 'id', where: { status: { equals: 'active' } } })
    expect(built.variables.where).toEqual({ status: { equals: 'active' } })
    expect(built.query).not.toContain('active')
    expect(() => read({ operation: 'patients', fields: 'id', where: [] as never })).toThrow(QueryInputError)
    expect(() => read({ operation: 'patients', fields: 'id', where: { x: 'y'.repeat(5000) } })).toThrow(QueryInputError)
  })

  it.each([
    ['a second root field smuggled through fields', { operation: 'patients', fields: 'id } encounters { id' }],
    ['a closing brace then a new operation', { operation: 'patients', fields: 'id } } query X { users { email' }],
    ['an alias', { operation: 'patients', fields: 'id x: name' }],
    ['arguments on a field', { operation: 'patients', fields: 'id ownerships(take: 1000) { id }' }],
    ['a fragment spread', { operation: 'patients', fields: 'id ...on Patient { name }' }],
    ['a directive', { operation: 'patients', fields: 'id name @include(if: true)' }],
    ['introspection', { operation: 'patients', fields: '__typename id' }],
    ['a field that does not exist', { operation: 'patients', fields: 'id notAField' }],
  ])('refuses %s', (_label, input) => {
    expect(() => read(input)).toThrow(QueryInputError)
  })

  it.each([
    ['a custom (non-list) root query', 'authenticatedItem'],
    ['a root field with arguments', 'patients(take: 100000)'],
    ['a second root field in the operation', 'patients { id } encounters'],
    ['a never-for-agents list (controlled-substance register)', 'csLogEntries'],
    ['a never-for-agents list (CS containers)', 'csContainers'],
    ['a server-only list', 'leases'],
    ['the keystone meta query', 'keystone'],
  ])('refuses %s as the operation', (_label, operation) => {
    expect(() => read({ operation, fields: 'id' })).toThrow(QueryInputError)
  })

  it(`refuses an oversized take (> ${MAX_TAKE}) and accepts ${MAX_TAKE}`, () => {
    expect(() => read({ operation: 'patients', fields: 'id', limit: 100000 })).toThrow(/at most 200/)
    expect(() => read({ operation: 'patients', fields: 'id', limit: MAX_TAKE + 1 })).toThrow(QueryInputError)
    expect(() => read({ operation: 'patients', fields: 'id', limit: -1 })).toThrow(QueryInputError)
    expect(() => read({ operation: 'patients', fields: 'id', limit: '5; drop' })).toThrow(QueryInputError)
    expect(read({ operation: 'patients', fields: 'id', limit: MAX_TAKE }).variables.take).toBe(MAX_TAKE)
  })

  it(`refuses nesting deeper than ${MAX_DEPTH} levels`, () => {
    const deep = 'id ownerships { client { ownerships { patient { ownerships { id } } } } }'
    expect(() => parseSelection(deep)).toThrow(/nested too deeply/)
    expect(() => read({ operation: 'patients', fields: 'id ownerships { client { ownerships { id } } }' })).not.toThrow()
  })

  it('refuses too many fields', () => {
    expect(() => parseSelection(Array.from({ length: 81 }, (_, i) => `f${i}`).join(' '))).toThrow(/Too many fields/)
  })

  it('only generated list queries are allowlisted', () => {
    expect(allow.has('patients')).toBe(true)
    expect(allow.has('clients')).toBe(true)
    for (const name of ['authenticatedItem', 'keystone', 'csLogEntries', 'csContainers', 'deaRegistrations', 'leases', 'patient']) expect(allow.has(name)).toBe(false)
  })
})

describe('GraphQL API bounds (F3)', () => {
  it(`every list query is capped at ${API_MAX_TAKE} rows`, () => {
    const uncapped = Object.entries<any>(context.__internal.lists)
      .filter(([, l]) => l.graphql.isEnabled.query)
      .filter(([, l]) => l.graphql.types.findManyArgs.take.defaultValue !== API_MAX_TAKE)
      .map(([k]) => k)
    expect(uncapped).toEqual([])
  })

  it('take above the cap is refused by Keystone (no database needed)', async () => {
    const owner = { itemId: 'x', listKey: 'User', data: { name: 'x', kind: 'staff', accessExpiresAt: null, role: { canAccessDashboard: true, canManagePatients: true } } }
    const result = await context.withSession(owner).graphql.raw({ query: '{ patients(take: 100000) { id } }' })
    expect(JSON.stringify(result.errors)).toMatch(/maxTake|limit/i)
  })

  it(`the API refuses a query nested deeper than ${API_MAX_DEPTH} levels and ignores introspection depth`, () => {
    const rules = [...specifiedRules, depthLimitRule()]
    const deep = parse('{ patients { ownerships { client { ownerships { patient { ownerships { client { ownerships { patient { id } } } } } } } } } }')
    expect(validate(schema, deep, rules).map(e => e.extensions?.code)).toContain('QUERY_TOO_DEEP')
    const viaFragment = parse('query { patients { ...A } } fragment A on Patient { ownerships { client { ownerships { patient { ownerships { client { ownerships { patient { id } } } } } } } } }')
    expect(validate(schema, viaFragment, rules).map(e => e.extensions?.code)).toContain('QUERY_TOO_DEEP')
    const ok = parse('{ patients { ownerships { client { ownerships { patient { id } } } } } }')
    expect(validate(schema, ok, rules)).toEqual([])
    const introspection = parse('{ __schema { types { fields { type { ofType { ofType { ofType { ofType { name } } } } } } } } }')
    expect(validate(schema, introspection, rules)).toEqual([])
  })
})
