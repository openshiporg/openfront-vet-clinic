import { describe, expect, it } from 'vitest'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { permissionNames } from '../features/keystone/access'
import { ROLES } from '../features/keystone/seed/practice'
import { canReadWholeList } from '../features/keystone/models/guardedRelationship'

/*
 * F1/F2 (review r3b): a role that cannot read a list must not reach it through a relation filter on
 * a list it can read (count or value-probe DeaRegistration through Location.deaRegistrations, say).
 * Every check here is refused before the database is touched, so no database is needed.
 */
const context: any = getContext(config as never, PrismaModule)
const lists: Record<string, any> = context.__internal.lists

const sessionFor = (roleId: string) => {
  const role = ROLES.find(r => r.id === roleId)!
  return {
    itemId: `test_${roleId}`,
    listKey: 'User',
    data: { name: role.name, email: 'x@example.com', kind: 'staff', accessExpiresAt: null, role: { id: role.id, name: role.name, ...Object.fromEntries(permissionNames.map(p => [p, role.permissions.includes(p as never)])) } },
  }
}

const CSR = 'seed_role_csr'
const PM = 'seed_role_manager'

/** The probe the reviewer used: count source rows by a value on the hidden related list. */
function probe(listKey: string, fieldKey: string) {
  const list = lists[listKey]
  const field = list.fields[fieldKey]
  const target = lists[field.dbField.list]
  const textField = Object.keys(target.fields).find(k => k !== 'id' && target.fields[k].dbField.kind === 'scalar' && target.fields[k].dbField.scalar === 'String' && target.fields[k].graphql.isEnabled.filter === true)
  const inner = textField ? `{ ${textField}: { startsWith: "A" } }` : '{ id: { equals: "probe" } }'
  const where = field.dbField.mode === 'many' ? `{ ${fieldKey}: { some: ${inner} } }` : `{ ${fieldKey}: ${inner} }`
  return `query { n: ${list.graphql.names.listQueryCountName}(where: ${where}) }`
}

async function run(roleId: string, query: string) {
  return context.withSession(sessionFor(roleId)).graphql.raw({ query }) as Promise<{ errors?: { extensions?: { code?: string } }[]; data?: any }>
}

/** Every relation field exposed to filtering, with its source and target list. */
const relations = Object.entries(lists).flatMap(([listKey, list]) =>
  Object.entries(list.fields as Record<string, any>)
    .filter(([, f]) => f.dbField.kind === 'relation' && f.graphql.isEnabled.read && f.graphql.isEnabled.filter)
    .map(([fieldKey, f]) => ({ listKey, fieldKey, target: f.dbField.list as string })),
)

async function sourceReadable(roleId: string, listKey: string) {
  return canReadWholeList(listKey, { session: sessionFor(roleId), context }) || (await lists[listKey].access.operation.query({ session: sessionFor(roleId), context, listKey, operation: 'query' })) === true
}

describe('relation filters respect the target list (F1/F2)', () => {
  it.each([
    ['Location', 'deaRegistrations', CSR],
    ['Location', 'deaRegistrations', PM],
    ['PatientReminder', 'satisfactions', CSR],
    ['PatientReminder', 'satisfactions', PM],
  ])('%s.%s is refused for %s', async (listKey, fieldKey, roleId) => {
    const result = await run(roleId, probe(listKey, fieldKey))
    expect(result.errors?.[0]?.extensions?.code).toBe('KS_FILTER_DENIED')
    expect(result.data?.n ?? null).toBeNull()
  })

  it('the owner (who can read both lists) may still filter by them', async () => {
    for (const [listKey, fieldKey] of [['Location', 'deaRegistrations'], ['PatientReminder', 'satisfactions']]) {
      const rule = lists[listKey].fields[fieldKey].graphql.isEnabled.filter
      expect(await rule({ session: sessionFor('seed_role_owner'), context, listKey, fieldKey })).toBe(true)
    }
  })

  // One case per relationship into a list the role cannot read, for each seeded role.
  for (const role of ROLES) {
    it(`${role.name}: every relation into a list it cannot read is refused`, async () => {
      const leaks: string[] = []
      let checked = 0
      for (const r of relations) {
        if (await canReadWholeList(r.target, { session: sessionFor(role.id), context })) continue
        if (!(await sourceReadable(role.id, r.listKey))) continue
        checked++
        const result = await run(role.id, probe(r.listKey, r.fieldKey))
        if (result.errors?.[0]?.extensions?.code !== 'KS_FILTER_DENIED') leaks.push(`${r.listKey}.${r.fieldKey} -> ${r.target}`)
      }
      expect(leaks).toEqual([])
      // CSR reaches DeaRegistration (twice), ReminderSatisfaction and OAuthApp through lists it can read.
      if (role.id === CSR || role.id === PM) expect(checked).toBeGreaterThanOrEqual(3)
    }, 120_000)
  }

  it('schema walk: no relation into any list is filterable or orderable by a role that cannot read the target', async () => {
    const problems: string[] = []
    for (const role of ROLES) {
      const session = sessionFor(role.id)
      for (const r of relations) {
        const field = lists[r.listKey].fields[r.fieldKey]
        const readable = await canReadWholeList(r.target, { session, context })
        for (const op of ['filter', 'orderBy'] as const) {
          const rule = field.graphql.isEnabled[op]
          if (rule === false) continue
          if (typeof rule !== 'function') { problems.push(`${r.listKey}.${r.fieldKey} ${op} is a constant`); continue }
          const allowed = await rule({ session, context, listKey: r.listKey, fieldKey: r.fieldKey })
          if (allowed && !readable) problems.push(`${role.id}: ${r.listKey}.${r.fieldKey} ${op} -> ${r.target}`)
        }
      }
    }
    expect(problems).toEqual([])
    expect(relations.length).toBeGreaterThan(200)
  })
})
