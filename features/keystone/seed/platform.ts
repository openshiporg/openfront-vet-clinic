import { permissionNames } from '../access'
import { US_FED, US_FED_HOLIDAYS, US_FED_SOURCE } from '../lib/calendar'
import { auditCreate } from '../lib/cas'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { rulesHash, validateLayer } from '../domain/policy'
import { APPROVAL_POLICIES, DEA_REGISTRATIONS, LOCATIONS, PRACTICE, ROLES, STAFF } from './practice'
import { POLICY_PACKS } from './policies'

/**
 * Loads the Cedar Creek practice spine idempotently: practice settings, locations, the federal and
 * location calendars, roles, staff (users + staff members + licences), DEA registrations, policy
 * packs (validated per kind, hashed, effective-dated) and approval policies. Creates by deterministic
 * id or natural key, so running it again changes nothing and never overwrites later edits.
 */

/**
 * Seeded people cannot sign in until an administrator sets a password or sends a reset link.
 * This is a bcrypt hash of 32 random bytes that were discarded when it was made, so no password matches it.
 */
const UNUSABLE_PASSWORD_HASH = '$2a$10$3dITCbIvf5zFA.1U8KZDhOHC3EEexi3KYy5ysZK1cRF6LHMm0H.ya'
const DAY = (d: string) => new Date(`${d}T00:00:00Z`)
const meta = { metadata: { seed: true } }

export async function seedPractice(uow: UnitOfWork, actor: Actor) {
  const { tx, now } = uow
  const created: Record<string, number> = { practice: 0, locations: 0, calendars: 0, calendarExceptions: 0, roles: 0, staff: 0, licences: 0, deaRegistrations: 0, policyPacks: 0, policyVersions: 0, policyBindings: 0, approvalPolicies: 0 }

  if (!(await tx.practiceSettings.findUnique({ where: { id: 1 } }))) {
    await tx.practiceSettings.create({ data: { id: 1, ...PRACTICE, onboardingStatus: 'in_progress' } })
    auditCreate(uow, actor, 'PracticeSettings', '1', 'practice.created', PRACTICE, meta)
    created.practice += 1
  }

  // Calendars: the federal business-day calendar, then one per location composing it.
  let federal = await tx.businessCalendar.findUnique({ where: { code: US_FED.code } })
  if (!federal) {
    federal = await tx.businessCalendar.create({
      data: { id: 'seed_cal_us_fed', code: US_FED.code, name: 'US federal business days', timeZone: US_FED.timeZone, kind: 'federal', weekendDays: US_FED.weekendDays, regularOpen: US_FED.regularOpen, regularClose: US_FED.regularClose, coverageThrough: DAY(US_FED.coverageThrough), source: US_FED_SOURCE },
    })
    auditCreate(uow, actor, 'BusinessCalendar', federal.id, 'calendar.created', { code: US_FED.code, coverageThrough: US_FED.coverageThrough }, meta)
    created.calendars += 1
  }
  created.calendarExceptions += await loadDays(uow, actor, federal.id, US_FED_HOLIDAYS.map(date => ({ date, kind: 'holiday', note: 'Federal holiday (observed)' })))

  for (const loc of LOCATIONS) {
    const code = `${loc.code}-CAL`
    let cal = await tx.businessCalendar.findUnique({ where: { code } })
    if (!cal) {
      cal = await tx.businessCalendar.create({
        data: { id: `seed_cal_${loc.id.replace('seed_loc_', '')}`, code, name: `${loc.name} hours`, timeZone: loc.timeZone, kind: 'location', weekendDays: [0, 6], regularOpen: loc.regularOpen, regularClose: loc.regularClose, coverageThrough: DAY(US_FED.coverageThrough), source: 'Practice closures + US federal holidays', composedOf: { connect: [{ id: federal.id }] } },
      })
      auditCreate(uow, actor, 'BusinessCalendar', cal.id, 'calendar.created', { code }, meta)
      created.calendars += 1
    }
    created.calendarExceptions += await loadDays(uow, actor, cal.id, loc.closures.map(date => ({ date, kind: 'closed', note: 'Practice closed' })))
    if (!(await tx.location.findUnique({ where: { id: loc.id } }))) {
      const { id, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage } = loc
      await tx.location.create({ data: { id, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage, calendarId: cal.id } })
      auditCreate(uow, actor, 'Location', id, 'location.created', { code: locCode, name, stateCode, timeZone }, meta)
      created.locations += 1
    }
  }

  const haveRoles = new Set((await tx.role.findMany({ where: { id: { in: ROLES.map(r => r.id) } }, select: { id: true } })).map(r => r.id))
  const newRoles = ROLES.filter(role => !haveRoles.has(role.id))
  if (newRoles.length) {
    await tx.role.createMany({ data: newRoles.map(role => ({ id: role.id, name: role.name, description: role.description, ...Object.fromEntries(permissionNames.map(name => [name, role.permissions.includes(name)])) })) })
    for (const role of newRoles) auditCreate(uow, actor, 'Role', role.id, 'role.created', { name: role.name, permissions: role.permissions }, meta)
    created.roles = newRoles.length
  }

  const haveUsers = await tx.user.findMany({ where: { OR: [{ id: { in: STAFF.map(p => p.userId) } }, { email: { in: STAFF.map(p => p.email) } }] }, select: { id: true, email: true } })
  const newUsers = STAFF.filter(person => !haveUsers.some(u => u.id === person.userId || u.email === person.email))
  if (newUsers.length) {
    await tx.user.createMany({
      data: newUsers.map(person => ({
        id: person.userId, name: person.name, email: person.email, title: person.title, password: UNUSABLE_PASSWORD_HASH, kind: person.userKind, roleId: person.roleId,
        accessExpiresAt: person.accessDays ? new Date(now.getTime() + person.accessDays * 86_400_000) : null, onboardingStatus: 'dismissed',
      })),
    })
    for (const person of newUsers) auditCreate(uow, actor, 'User', person.userId, 'user.created', { name: person.name, title: person.title, role: person.roleId, kind: person.userKind }, meta)
  }

  const haveStaff = new Set((await tx.staffMember.findMany({ where: { id: { in: STAFF.map(p => p.id) } }, select: { id: true } })).map(r => r.id))
  const userIds = new Map((await tx.user.findMany({ where: { OR: [{ id: { in: STAFF.map(p => p.userId) } }, { email: { in: STAFF.map(p => p.email) } }] }, select: { id: true, email: true } })).flatMap(u => [[u.id, u.id], [u.email, u.id]] as [string, string][]))
  const newStaff = STAFF.filter(person => !haveStaff.has(person.id))
  // Interactive transactions run one statement at a time; the nested location connect needs a create per person.
  for (const person of newStaff) {
    const userId = userIds.get(person.userId) ?? userIds.get(person.email)
    await tx.staffMember.create({
      data: {
        id: person.id, displayName: person.name, kind: person.kind, credentials: person.credentials, employment: person.employment, homeLocationId: person.homeLocationId,
        locations: { connect: person.locationIds.map(id => ({ id })) }, ...(userId ? { userId } : {}),
      },
      select: { id: true },
    })
    auditCreate(uow, actor, 'StaffMember', person.id, 'staff.created', { name: person.name, kind: person.kind, employment: person.employment }, meta)
  }
  created.staff = newStaff.length
  // Bennett's licence lapsed on 2026-10-31 (seed edge case: the licence guard refuses him until renewed).
  const licences = newStaff.filter(p => p.licence).map(person => ({ person, id: person.id.replace('seed_staff_', 'seed_lic_'), licence: person.licence! }))
  if (licences.length) {
    await tx.professionalLicense.createMany({
      data: licences.map(({ person, id, licence }) => ({ id, staffMemberId: person.id, kind: licence.kind, stateCode: 'US-CA', licenseNumber: licence.number, issuedOn: DAY(licence.issuedOn), expiresOn: DAY(licence.expiresOn), status: 'active', verifiedAt: now, verificationSource: 'Seed (fictional licence; verify against the board in production)' })),
    })
    for (const { person, id, licence } of licences) auditCreate(uow, actor, 'ProfessionalLicense', id, 'licence.recorded', { staffMemberId: person.id, kind: licence.kind, number: licence.number, expiresOn: licence.expiresOn }, meta)
    created.licences = licences.length
  }

  // Cole's registration expired on 2026-08-31 (seed edge case: CS orders under it are refused).
  const haveDea = new Set((await tx.deaRegistration.findMany({ where: { id: { in: DEA_REGISTRATIONS.map(r => r.id) } }, select: { id: true } })).map(r => r.id))
  const newDea = DEA_REGISTRATIONS.filter(r => !haveDea.has(r.id))
  if (newDea.length) {
    const today = now.toISOString().slice(0, 10)
    await tx.deaRegistration.createMany({
      data: newDea.map(reg => ({ id: reg.id, registrationNumber: reg.registrationNumber, registrantName: reg.registrantName, registrantKind: reg.registrantKind, staffMemberId: reg.staffMemberId, locationId: reg.locationId, schedules: reg.schedules, issuedOn: DAY(reg.issuedOn), expiresOn: DAY(reg.expiresOn), status: reg.expiresOn < today ? 'expired' : 'active' })),
    })
    for (const reg of newDea) auditCreate(uow, actor, 'DeaRegistration', reg.id, 'dea_registration.recorded', { registrationNumber: reg.registrationNumber, locationId: reg.locationId, schedules: reg.schedules, expiresOn: reg.expiresOn }, meta)
    created.deaRegistrations = newDea.length
  }
  await tx.practiceSettings.updateMany({ where: { id: 1, medicalDirectorId: null }, data: { medicalDirectorId: 'seed_staff_marsh' } })

  // Policy packs: validate each layer against its kind, store an immutable published version, bind.
  const packId = (code: string) => `seed_pp_${code.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()}`
  const packIds = new Map((await tx.policyPack.findMany({ where: { code: { in: POLICY_PACKS.map(p => p.code) } }, select: { id: true, code: true } })).map(r => [r.code, r.id]))
  const newPacks = POLICY_PACKS.filter(p => !packIds.has(p.code))
  if (newPacks.length) {
    await tx.policyPack.createMany({ data: newPacks.map(pack => ({ id: packId(pack.code), code: pack.code, name: pack.name, kind: pack.kind, jurisdiction: pack.jurisdiction })) })
    for (const pack of newPacks) {
      packIds.set(pack.code, packId(pack.code))
      auditCreate(uow, actor, 'PolicyPack', packId(pack.code), 'policy_pack.created', { code: pack.code, kind: pack.kind, jurisdiction: pack.jurisdiction }, meta)
    }
    created.policyPacks = newPacks.length
  }
  const versioned = new Set((await tx.policyVersion.findMany({ where: { packId: { in: [...packIds.values()] } }, select: { packId: true } })).map(r => r.packId))
  const versions = POLICY_PACKS.filter(p => !versioned.has(packIds.get(p.code)!)).map(pack => {
    const rules = validateLayer(pack.kind, pack.rules)
    const id = packIds.get(pack.code)!
    return {
      id: `${id}_v1`, packId: id, label: `${pack.code} v1`, versionNumber: 1, rules: rules as never, rulesHash: rulesHash(rules), sourceRefs: pack.sourceRefs as never,
      verified: pack.unverified.length === 0, unverifiedRules: pack.unverified, verifiedAt: pack.verifiedAt ? new Date(pack.verifiedAt) : null,
      effectiveFrom: DAY(pack.effectiveFrom), status: 'published', publishedAt: now, pack,
    }
  })
  if (versions.length) {
    await tx.policyVersion.createMany({ data: versions.map(({ pack: _pack, ...row }) => row) })
    for (const v of versions) auditCreate(uow, actor, 'PolicyVersion', v.id, 'policy.published', { pack: v.pack.code, rulesHash: v.rulesHash, verified: v.verified, unverified: v.pack.unverified }, meta)
    created.policyVersions = versions.length
  }
  const bindingKey = (pid: string, scope: string, locationId: string | null) => `${pid}|${scope}|${locationId ?? ''}`
  const haveBindings = new Set((await tx.policyBinding.findMany({ where: { packId: { in: [...packIds.values()] } }, select: { packId: true, scope: true, locationId: true } })).map(b => bindingKey(b.packId!, b.scope, b.locationId)))
  const bindings = POLICY_PACKS.flatMap(pack => {
    const pid = packIds.get(pack.code)!
    const targets = pack.bind === 'practice' ? [{ scope: 'practice', locationId: null as string | null }] : LOCATIONS.filter(l => l.stateCode === pack.jurisdiction).map(l => ({ scope: 'location', locationId: l.id as string | null }))
    return targets.filter(t => !haveBindings.has(bindingKey(pid, t.scope, t.locationId))).map(t => ({ id: `${pid}_${t.locationId ? t.locationId.replace('seed_loc_', '') : 'practice'}`, packId: pid, scope: t.scope, locationId: t.locationId, layer: pack.layer, code: pack.code }))
  })
  if (bindings.length) {
    await tx.policyBinding.createMany({ data: bindings.map(({ code: _code, ...row }) => row) })
    for (const b of bindings) auditCreate(uow, actor, 'PolicyBinding', b.id, 'policy.bound', { pack: b.code, scope: b.scope, locationId: b.locationId }, meta)
    created.policyBindings = bindings.length
  }

  const havePolicies = new Set((await tx.approvalPolicy.findMany({ select: { action: true } })).map(p => p.action))
  const newPolicies = APPROVAL_POLICIES.filter(p => !havePolicies.has(p.action))
  if (newPolicies.length) {
    const rows = newPolicies.map(policy => ({ id: `seed_ap_${policy.action.replace(/[^a-z0-9]+/g, '_')}`, action: policy.action, description: policy.description, requiredPermission: policy.requiredPermission, minApprovals: 1, expiresAfterMinutes: policy.expiresAfterMinutes, thresholdMinor: policy.thresholdMinor ?? null }))
    await tx.approvalPolicy.createMany({ data: rows })
    for (const row of rows) auditCreate(uow, actor, 'ApprovalPolicy', row.id, 'approval_policy.created', { action: row.action, requiredPermission: row.requiredPermission }, meta)
    created.approvalPolicies = rows.length
  }

  return created
}

async function loadDays(uow: UnitOfWork, actor: Actor, calendarId: string, days: { date: string; kind: string; note: string }[]) {
  const have = new Set((await uow.tx.calendarException.findMany({ where: { calendarId }, select: { date: true } })).map(d => d.date.toISOString().slice(0, 10)))
  const fresh = days.filter(d => !have.has(d.date))
  if (!fresh.length) return 0
  await uow.tx.calendarException.createMany({ data: fresh.map(d => ({ calendarId, date: DAY(d.date), kind: d.kind, note: d.note })) })
  uow.audit({ eventType: 'calendar.exceptions_loaded', entityType: 'BusinessCalendar', entityId: calendarId, actorUserId: actor.kind === 'user' ? actor.userId : null, after: { count: fresh.length } })
  return fresh.length
}
