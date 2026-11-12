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
  }
})
