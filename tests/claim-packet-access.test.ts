import { describe, expect, it } from 'vitest'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { permissionNames } from '../features/keystone/access'

/* A claim packet carries diagnosis text: its form fields and body are clinical, readable only with canReadClinical. */
const context: any = getContext(config as never, PrismaModule)
const lists: Record<string, any> = context.__internal.lists
const session = (granted: string[]) => ({ itemId: 'u', data: { name: 'u', kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } } })
const groomer = session(['canAccessDashboard', 'canGroom', 'canCheckIn', 'canBook'])
const frontDesk = session(['canAccessDashboard', 'canTakePayments', 'canPostInvoices', 'canCheckIn', 'canBook'])
const clinical = session(['canAccessDashboard', 'canReadClinical', 'canPostInvoices'])

describe('claim packet clinical fields', () => {
  for (const field of ['formFields', 'packetBody']) {
    it(`InsuranceClaimPacket.${field} is readable only with canReadClinical`, () => {
      const read = lists.InsuranceClaimPacket.fields[field].access.read
      for (const [who, s, allowed] of [['groomer', groomer, false], ['front desk without clinical', frontDesk, false], ['clinical', clinical, true], ['nobody', null, false]] as const) {
        expect(read({ session: s, context: {}, listKey: 'InsuranceClaimPacket', fieldKey: field, operation: 'read' }), who).toBe(allowed)
      }
    })
    it(`InsuranceClaimPacket.${field} can be filtered and sorted on only with canReadClinical (no oracle)`, () => {
      const { filter, orderBy } = lists.InsuranceClaimPacket.fields[field].graphql.isEnabled
      for (const rule of [filter, orderBy]) {
        if (rule === false) continue
        expect(typeof rule).toBe('function')
        for (const [who, s, allowed] of [['groomer', groomer, false], ['front desk without clinical', frontDesk, false], ['clinical', clinical, true], ['nobody', null, false]] as const) {
          expect(rule({ session: s, context: {}, listKey: 'InsuranceClaimPacket', fieldKey: field }), who).toBe(allowed)
        }
      }
    })
  }

  it('the review exploit (front desk counting packets by packetBody text) is refused before any row is read', async () => {
    // Keystone checks filter and order access before it builds a query, so this needs no database.
    const csr = context.withSession(frontDesk)
    for (const query of [
      `{ insuranceClaimPacketsCount(where: { packetBody: { contains: "Wellness" } }) }`,
      `{ insuranceClaimPackets(where: { packetBody: { startsWith: "<" } }) { id } }`,
      `{ insuranceClaimPackets(orderBy: { packetBody: asc }) { id } }`,
    ]) {
      const res = await csr.graphql.raw({ query })
      expect(res.errors?.length, query).toBeGreaterThan(0)
      expect(String(res.errors?.[0]?.message), query).toMatch(/You do not have access to perform '(filter|orderBy)' operations on the fields \["InsuranceClaimPacket\.packetBody"\]/)
      expect(JSON.stringify(res.data ?? null)).not.toMatch(/[1-9]/)
    }
  })
})
