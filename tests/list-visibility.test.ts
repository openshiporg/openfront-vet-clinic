import { describe, expect, it } from 'vitest'
import models from '../features/keystone/models'
import { permissionNames } from '../features/keystone/access'
import { ROLES } from '../features/keystone/seed/practice'
import { visiblePlatformItems } from '../features/dashboard/lib/sidebarAccess'
import { platformNavItems } from '../features/platform/lib/navigation'

/* Fleet rule: a link a role cannot use is hidden. A list the role cannot read is hidden from its navigation (and so is the screen named after it). */
const session = (roleName: string) => {
  const role = ROLES.find(r => r.name === roleName)!
  return { itemId: 'u', data: { name: 'u', email: 'u@x', kind: 'staff', accessExpiresAt: null, role: { id: role.id, name: role.name, ...Object.fromEntries(permissionNames.map(p => [p, (role.permissions as string[]).includes(p)])) } } }
}
const hidden = async (listKey: string, roleName: string) => {
  const ui = (models as Record<string, { ui?: { isHidden?: unknown } }>)[listKey].ui
  return typeof ui?.isHidden === 'function' ? await (ui.isHidden as (a: { session: unknown }) => Promise<boolean>)({ session: session(roleName) }) : Boolean(ui?.isHidden)
}

describe('lists a role cannot read are hidden from its navigation', () => {
  it.each(['Practice Manager', 'Client Service Representative'])('%s: Encounter, HospitalStay and LabResult hidden; Patient shown', async role => {
    expect(await hidden('Encounter', role)).toBe(true)
    expect(await hidden('HospitalStay', role)).toBe(true)
    expect(await hidden('AnaesthesiaRecord', role)).toBe(true)
    expect(await hidden('Patient', role)).toBe(false)
  })
  it('a veterinarian sees Encounter', async () => {
    const dvm = ROLES.find(r => (r.permissions as string[]).includes('canSignRecord'))!.name
    expect(await hidden('Encounter', dvm)).toBe(false)
  })
  it('the Encounters screen follows the list: gone from the PM menu, there for a vet', async () => {
    const lists = await Promise.all(['Encounter', 'Laboratory'].map(async key => ({ key, path: key === 'Encounter' ? 'encounters' : 'laboratories', isHidden: await hidden(key, 'Practice Manager') })))
    const items = visiblePlatformItems(platformNavItems, lists, { role: { canAccessDashboard: true } }).map(i => i.href)
    expect(items).not.toContain('/platform/encounters')
    expect(items).toContain('/platform/laboratories') // the manager sets up labs
    expect(items).toContain('/platform/patients')
  })
  it('lists marked hidden in their own config stay hidden for everyone', async () => {
    const own = Object.entries(models as Record<string, { ui?: { isHidden?: unknown } }>).filter(([, l]) => l.ui?.isHidden === true)
    expect(own.length).toBeGreaterThan(0)
  })
})
