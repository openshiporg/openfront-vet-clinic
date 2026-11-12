import { describe, expect, it } from 'vitest'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { permissionNames } from '../features/keystone/access'
import { ROLES } from '../features/keystone/seed/practice'

/* P5 r1 B3: groomer commission (pay) is readable, filterable and sortable only by the owner or a manager (canManagePeople). */
const context: any = getContext(config as never, PrismaModule)
const lists: Record<string, any> = context.__internal.lists
const roleSession = (id: string) => {
  const granted = ROLES.find(r => r.id === id)!.permissions as string[]
  return { itemId: 'u', data: { name: 'u', kind: 'staff', accessExpiresAt: null, role: { id, name: id, ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } } }
}
const cases = [
  ['owner', 'seed_role_owner', true], ['manager', 'seed_role_manager', true],
  ['groomer', 'seed_role_groomer', false], ['kennel', 'seed_role_assistant', false], ['csr', 'seed_role_csr', false],
  ['dvm', 'seed_role_dvm', false], ['rvt', 'seed_role_rvt', false], ['bookkeeper', 'seed_role_bookkeeper', false],
] as const

describe('groom commission is owner or manager only', () => {
  for (const field of ['commissionMinor', 'commissionBps']) {
    it(`GroomAppointment.${field}: read, filter and orderBy take the same check`, () => {
      const f = lists.GroomAppointment.fields[field]
      const { filter, orderBy } = f.graphql.isEnabled
      for (const [who, id, allowed] of cases) {
        const s = roleSession(id)
        expect(f.access.read({ session: s, context: {}, listKey: 'GroomAppointment', fieldKey: field, operation: 'read' }), who).toBe(allowed)
        for (const rule of [filter, orderBy]) {
          expect(typeof rule, `${field} ${who}`).toBe('function')
          expect(rule({ session: s, context: {}, listKey: 'GroomAppointment', fieldKey: field }), who).toBe(allowed)
        }
      }
      expect(f.access.read({ session: null, context: {}, listKey: 'GroomAppointment', fieldKey: field, operation: 'read' })).toBe(false)
    })
  }

  it('the review oracle (filter or sort on commissionMinor) is refused before any row is read', async () => {
    for (const id of ['seed_role_groomer', 'seed_role_assistant', 'seed_role_csr']) {
      const ctx = context.withSession(roleSession(id))
      for (const query of [
        `{ groomAppointmentsCount(where: { commissionMinor: { equals: "3800" } }) }`,
        `{ groomAppointments(where: { commissionBps: { gt: 0 } }) { id } }`,
        `{ groomAppointments(orderBy: { commissionMinor: desc }) { id } }`,
      ]) {
        const res = await ctx.graphql.raw({ query })
        expect(String(res.errors?.[0]?.message), `${id} ${query}`).toMatch(/You do not have access to perform '(filter|orderBy)' operations on the fields \["GroomAppointment\.commission(Minor|Bps)"\]/)
        expect(JSON.stringify(res.data ?? null)).not.toMatch(/[1-9]/)
      }
    }
  })
})
