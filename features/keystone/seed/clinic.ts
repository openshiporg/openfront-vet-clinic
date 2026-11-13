import { ensureAgentUser } from '../mutations/agents'
import { auditCreate } from '../lib/cas'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { addDays, localDate, zonedInstant } from '../lib/calendar'
import { dec, toScale } from '../lib/decimal'
import { appendCsEntry } from '../lib/csRegister'
import { reserveReferences, reserveSerials } from '../lib/sequence'
import { contactHash, microchipStandard } from '../domain/contact'
import { parseProtocol, protocolHash } from '../domain/triage'
import { buildSegments, type SegmentTemplate } from '../domain/scheduling'
import { seedClinical } from './clinical'
import { seedInventory } from './inventory'
import { seedBilling } from './billing'
import { seedPhase5 } from './phase5'
import {
  APPOINTMENT_TYPES, COLOURS, DRUG_PRODUCTS, households, KNOWLEDGE_BASE, MESSAGE_TEMPLATES, REFERRAL_HOSPITALS, RESOURCES, SCHEDULES, SPECIES, TRIAGE_PROTOCOL,
} from './clinicData'

/**
 * Phase 1 clinic data: species and breeds, ER referral hospitals, rooms and equipment, appointment
 * types, staff schedules, the published phone-triage protocol, message templates, the knowledge
 * base, the AI receptionist (paused, with its grants), households and patients with weights,
 * microchips and alerts, today's day sheet and the first controlled-substance containers.
 *
 * Idempotent by deterministic id per section: a section that already exists is skipped as a whole,
 * so a second load creates nothing and later staff edits are never overwritten. Needs the practice
 * spine (loadPracticeSetup) first.
 */
const DAY = (d: string) => new Date(`${d}T00:00:00Z`)
const meta = { metadata: { seed: true } }

export async function seedClinic(uow: UnitOfWork, actor: Actor) {
  const { tx, now } = uow
  const created: Record<string, number> = {}
  const count = (k: string, n: number) => { created[k] = (created[k] ?? 0) + n }
  if (!(await tx.location.findUnique({ where: { id: 'seed_loc_main' }, select: { id: true } }))) {
    throw new Error('Load the practice (locations, staff and policies) before the clinic data.')
  }

  // ── Species, breeds and colours ──
  const haveSpecies = new Set((await tx.species.findMany({ where: { id: { in: SPECIES.map(s => s.id) } }, select: { id: true } })).map(s => s.id))
  const newSpecies = SPECIES.filter(s => !haveSpecies.has(s.id))
  if (newSpecies.length) {
    await tx.species.createMany({ data: newSpecies.map(s => ({ id: s.id, code: s.code, name: s.name, module: s.module, defaultWeightUnit: s.defaultWeightUnit, active: true })) })
    await tx.breed.createMany({ data: newSpecies.flatMap(s => s.breeds.map((name, i) => ({ id: `${s.id}_b${i + 1}`, speciesId: s.id, name }))) })
    await tx.colourMarking.createMany({ data: newSpecies.flatMap(s => (COLOURS[s.code] ?? []).map((name, i) => ({ id: `${s.id}_c${i + 1}`, speciesId: s.id, name }))) })
    auditCreate(uow, actor, 'Species', 'seed_species', 'species.loaded', { species: newSpecies.map(s => s.code), breeds: newSpecies.reduce((n, s) => n + s.breeds.length, 0) }, meta)
    count('species', newSpecies.length)
  }
  const speciesByCode = new Map((await tx.species.findMany({ select: { id: true, code: true } })).map(s => [s.code, s.id]))
  const breedId = new Map((await tx.breed.findMany({ select: { id: true, name: true, speciesId: true } })).map(b => [`${b.speciesId}|${b.name}`, b.id]))

  // ── Referral hospitals, resources, appointment types, schedules ──
  const haveEr = new Set((await tx.referralHospital.findMany({ where: { id: { in: REFERRAL_HOSPITALS.map(h => h.id) } }, select: { id: true } })).map(h => h.id))
  const newEr = REFERRAL_HOSPITALS.filter(h => !haveEr.has(h.id))
  if (newEr.length) {
    await tx.referralHospital.createMany({ data: newEr.map(h => ({ ...h, fax: '', verifiedChannel: true, active: true })) })
    for (const h of newEr) auditCreate(uow, actor, 'ReferralHospital', h.id, 'referral_hospital.created', { name: h.name, kind: h.kind, open24h: h.open24h }, meta)
    count('referralHospitals', newEr.length)
  }
  const haveRes = new Set((await tx.resource.findMany({ where: { id: { in: RESOURCES.map(r => r.id) } }, select: { id: true } })).map(r => r.id))
  const newRes = RESOURCES.filter(r => !haveRes.has(r.id))
  if (newRes.length) {
    await tx.resource.createMany({ data: newRes.map(r => ({ ...r, active: true })) })
    auditCreate(uow, actor, 'Resource', 'seed_resources', 'resources.loaded', { count: newRes.length }, meta)
    count('resources', newRes.length)
  }
  const haveTypes = new Set((await tx.appointmentType.findMany({ where: { id: { in: APPOINTMENT_TYPES.map(t => t.id) } }, select: { id: true } })).map(t => t.id))
  for (const t of APPOINTMENT_TYPES.filter(t => !haveTypes.has(t.id))) {
    await tx.appointmentType.create({
      data: {
        id: t.id, code: t.code, name: t.name, category: t.category, durationMinutes: t.durationMinutes, segments: (t.segments ?? null) as never, requiredResourceKinds: t.requiredResourceKinds, providerKinds: t.providerKinds,
        aiBookable: t.aiBookable, portalBookable: t.portalBookable, requestOnly: t.requestOnly, newClientAllowed: t.newClientAllowed, depositRequired: t.depositRequired ?? 'none', depositMinor: t.depositMinor ?? null,
        vcprQualifying: t.vcprQualifying, colour: t.colour, active: true, ...(t.species ? { species: { connect: t.species.map(code => ({ id: speciesByCode.get(code)! })) } } : {}),
      },
      select: { id: true },
    })
    auditCreate(uow, actor, 'AppointmentType', t.id, 'appointment_type.created', { code: t.code, aiBookable: t.aiBookable, requestOnly: t.requestOnly }, meta)
    count('appointmentTypes', 1)
  }
  if (!(await tx.staffSchedule.findFirst({ where: { id: { startsWith: 'seed_sch_' } }, select: { id: true } }))) {
    const rows = SCHEDULES.flatMap((s, i) => s.days.map(weekday => ({ id: `seed_sch_${i}_${weekday}`, staffMemberId: s.staffId, locationId: s.locationId, kind: 'recurring', weekday, startTime: s.start, endTime: s.end, appointmentCategories: (s.categories ?? null) as never, effectiveFrom: DAY('2026-01-01') })))
    await tx.staffSchedule.createMany({ data: rows })
    auditCreate(uow, actor, 'StaffSchedule', 'seed_schedules', 'schedules.loaded', { blocks: rows.length }, meta)
    count('scheduleBlocks', rows.length)
  }

  // ── Phone triage protocol (published v1), templates, knowledge base, public booking profile ──
  if (!(await tx.triageProtocol.findUnique({ where: { code: 'phone_triage' }, select: { id: true } }))) {
    const protocol = parseProtocol(TRIAGE_PROTOCOL)
    await tx.triageProtocol.create({ data: { id: 'seed_tp_phone', code: 'phone_triage', name: 'Phone triage (front desk and AI receptionist)' } })
    await tx.triageProtocolVersion.create({ data: { id: 'seed_tpv_phone_1', protocolId: 'seed_tp_phone', versionNumber: 1, label: 'v1 (Cedar Creek, reviewed by Dr. Marsh)', questions: protocol.questions as never, redFlags: protocol.redFlags as never, levelRules: protocol.levelRules as never, scripts: protocol.scripts as never, contentHash: protocolHash(protocol), status: 'published', publishedAt: now } })
    auditCreate(uow, actor, 'TriageProtocolVersion', 'seed_tpv_phone_1', 'triage_protocol.published', { code: 'phone_triage', version: 1, redFlags: protocol.redFlags.length, contentHash: protocolHash(protocol) }, meta)
    count('triageProtocols', 1)
  }
  const haveTemplates = new Set((await tx.messageTemplate.findMany({ where: { channel: 'sms' }, select: { code: true } })).map(t => t.code))
  const newTemplates = MESSAGE_TEMPLATES.filter(t => !haveTemplates.has(t.code))
  if (newTemplates.length) {
    await tx.messageTemplate.createMany({ data: newTemplates.map(t => ({ id: `seed_tpl_${t.code}`, code: t.code, purpose: t.purpose, channel: 'sms', locale: 'en-US', body: t.body, templateVersion: 1, active: true })) })
    count('messageTemplates', newTemplates.length)
  }
  if (!(await tx.knowledgeBaseEntry.findFirst({ where: { id: { startsWith: 'seed_kb_' } }, select: { id: true } }))) {
    await tx.knowledgeBaseEntry.createMany({ data: KNOWLEDGE_BASE.map((k, i) => ({ id: `seed_kb_${i + 1}`, topic: k.topic, keywords: k.keywords, content: k.content, visibility: k.visibility, locationId: k.locationId, entryVersion: 1, active: true })) })
    auditCreate(uow, actor, 'KnowledgeBaseEntry', 'seed_kb', 'knowledge_base.loaded', { entries: KNOWLEDGE_BASE.length }, meta)
    count('knowledgeBase', KNOWLEDGE_BASE.length)
  }
  if (!(await tx.publicSiteProfile.findFirst({ select: { id: true } }))) {
    await tx.publicSiteProfile.create({ data: { id: 1, headline: 'Cedar Creek Animal Hospital', onlineBookingEnabled: true, newClientBookingMode: 'request', bookingWindowDays: 60, minimumNoticeMinutes: 120 } })
    const publicTypes = APPOINTMENT_TYPES.filter(t => t.portalBookable || t.requestOnly)
    await tx.publicAppointmentType.createMany({ data: publicTypes.map((t, i) => ({ id: `seed_pat_${t.code}`, appointmentTypeId: t.id, publicName: t.name, description: '', mode: t.requestOnly ? 'request' : 'book', newClients: t.newClientAllowed, sortOrder: i, active: true })) })
    count('publicAppointmentTypes', publicTypes.length)
  }

  // ── The AI receptionist: paused, with its reception grants. Turning it on is a practice-controls change (maker-checker). ──
  if (!(await tx.agentIdentity.findUnique({ where: { id: 'seed_agent_reception' }, select: { id: true } }))) {
    await tx.oAuthApp.create({ data: { id: 'seed_oauth_reception', name: 'Cedar Creek AI receptionist (voice runtime)', clientId: 'ccah-voice-receptionist', tokenEndpointAuthMethod: 'none', redirectUris: ['https://voice.cedarcreekvet.com/oauth/callback'], scopes: ['mcp:read', 'mcp:write'], status: 'active', description: 'The voice runtime signs in as this client; its token acts as the receptionist agent, never as a person.' } })
    await tx.agentIdentity.create({ data: { id: 'seed_agent_reception', name: 'Cedar Creek AI receptionist', kind: 'voice_receptionist', model: 'operator-selected (OpenRouter)', provider: 'openrouter', ownerId: 'seed_user_park', status: 'active', killSwitch: false, limits: { toolCallsPerRun: 40, maxBookingsPerCall: 3 }, oauthAppId: 'seed_oauth_reception' } })
    await ensureAgentUser(tx, { id: 'seed_agent_reception', name: 'Cedar Creek AI receptionist' })
    const scopes = ['reception.read', 'reception.book', 'reception.register', 'triage.run', 'pharmacy.intake', 'records.request']
    await tx.agentToolGrant.createMany({ data: scopes.map(scope => ({ id: `seed_grant_reception_${scope.replace('.', '_')}`, agentId: 'seed_agent_reception', scope, status: 'active', constraints: { locations: ['seed_loc_main', 'seed_loc_elkgrove'] } })) })
    auditCreate(uow, actor, 'AgentIdentity', 'seed_agent_reception', 'agent.created', { kind: 'voice_receptionist', owner: 'seed_user_park', scopes, note: 'aiVoice feature is off until a practice-controls change is approved' }, meta)
    count('agents', 1)
  }

  // ── Households and patients ──
  const homes = households()
  const haveClients = new Set((await tx.client.findMany({ where: { id: { in: homes.map(h => h.id) } }, select: { id: true } })).map(c => c.id))
  const newHomes = homes.filter(h => !haveClients.has(h.id))
  if (newHomes.length) {
    const clientRefs = await reserveSerials(tx, 'C', newHomes.length)
    const pets = newHomes.flatMap(h => h.pets.map(p => ({ home: h, pet: p })))
    const patientRefs = await reserveSerials(tx, 'P', pets.length)
    await tx.client.createMany({
      data: newHomes.map((h, i) => ({ id: h.id, ref: clientRefs[i], displayName: h.displayName, kind: h.kind, status: h.status ?? 'active', primaryLocationId: h.locationId, addressLine1: h.addressLine1, city: h.city, stateCode: 'US-CA', postalCode: h.postalCode, source: h.source ?? 'import', accountFlags: h.status === 'prospect' ? { possibleDuplicate: false } : {} })),
    })
    const people = newHomes.flatMap(h => h.people.map((p, i) => ({ home: h, person: p, primary: i === 0 })))
    await tx.clientPerson.createMany({
      data: people.map(({ home, person, primary }) => ({ id: person.id, clientId: home.id, firstName: person.firstName, lastName: person.lastName, relationship: person.relationship, isPrimary: primary, canBook: true, canApproveTreatment: primary, canReceiveRecords: primary, canPay: true, canAuthoriseEuthanasia: primary, dateOfBirth: DAY(person.dob), preferredLanguage: 'en' })),
    })
    const contacts = people.flatMap(({ person }) => [
      ...(person.phone ? [{ id: `${person.id}_m`, personId: person.id, kind: 'mobile', value: person.phone, valueHash: contactHash(person.phone), isPrimary: true, canText: true, status: 'active', verifiedAt: now }] : []),
      { id: `${person.id}_e`, personId: person.id, kind: 'email', value: person.email, valueHash: contactHash(person.email), isPrimary: true, canText: false, status: 'active', verifiedAt: null as Date | null },
    ])
    await tx.contactPoint.createMany({ data: contacts })
    // Transactional texts are implied by giving the number (US/contact pack); the grant row records the basis.
    await tx.consentRecord.createMany({ data: contacts.map(c => ({ contactPointId: c.id, purpose: 'transactional', action: 'grant', method: 'import', at: now })) })
    await tx.patient.createMany({
      data: pets.map(({ pet }, i) => {
        const spId = speciesByCode.get(pet.species)!
        return { id: pet.id, ref: patientRefs[i], name: pet.name, kind: 'individual', speciesId: spId, breedId: breedId.get(`${spId}|${pet.breed}`) ?? null, sex: pet.sex, reproductiveStatus: pet.repro, dateOfBirth: DAY(pet.dob), dobEstimated: false, colourMarkings: pet.colour, status: pet.status ?? 'active', deceasedAt: pet.diedOn ? new Date(`${pet.diedOn}T17:00:00Z`) : null, codeStatus: 'unspecified' }
      }),
    })
    await tx.patientOwnership.createMany({ data: pets.map(({ home, pet }) => ({ id: `${pet.id}_own`, patientId: pet.id, clientId: home.id, role: 'primary', effectiveFrom: DAY('2024-01-01'), basis: 'import' })) })
    const weights = pets.flatMap(({ pet }) => pet.weightsKg.map((kg, k) => ({ id: `${pet.id}_w${k + 1}`, patientId: pet.id, value: toScale(dec(kg), 'wt'), unit: 'kg', valueKg: toScale(dec(kg), 'wt'), method: 'scale', measuredAt: new Date(now.getTime() - (2 - k) * 180 * 86_400_000 - 30 * 86_400_000) })))
    if (weights.length) await tx.weightMeasurement.createMany({ data: weights })
    const chips = pets.filter(({ pet }) => pet.microchip).map(({ pet }) => ({ id: `${pet.id}_chip`, patientId: pet.id, number: pet.microchip!, standard: microchipStandard(pet.microchip!), registry: 'Found Animals (fictional entry)', registeredToClient: true, active: true }))
    if (chips.length) await tx.microchip.createMany({ data: chips })
    const alerts = pets.flatMap(({ pet }) => (pet.alerts ?? []).map((a, k) => ({ id: `${pet.id}_alert${k + 1}`, patientId: pet.id, kind: a.kind, severity: a.severity, text: a.text, active: true })))
    if (alerts.length) await tx.patientAlert.createMany({ data: alerts })
    // VCPRs from the last exam: most current; a few lapsed so the header shows it.
    const vcprs = pets.filter(({ pet }) => (pet.status ?? 'active') === 'active').map(({ home, pet }, k) => {
      const lapsed = k % 9 === 4
      const established = new Date(now.getTime() - (lapsed ? 430 : 40 + (k % 200)) * 86_400_000)
      return { id: `${pet.id}_vcpr`, patientId: pet.id, scope: 'practice', locationId: home.locationId, establishedByRef: 'import', establishedVia: 'import', establishedAt: established, expiresAt: new Date(established.getTime() + 365 * 86_400_000), status: lapsed ? 'expired' : 'active' }
    })
    if (vcprs.length) await tx.vcprRecord.createMany({ data: vcprs })
    // The deceased patient: suppressed for reminders and marketing for good.
    for (const { home, pet } of pets.filter(({ pet }) => pet.status === 'deceased')) {
      await tx.suppression.create({ data: { id: `${pet.id}_supp`, patientId: pet.id, clientId: home.id, reason: 'deceased', active: true } })
    }
    auditCreate(uow, actor, 'Client', 'seed_clients', 'clients.imported', { households: newHomes.length, people: people.length, patients: pets.length, alerts: alerts.length, deceased: pets.filter(({ pet }) => pet.status === 'deceased').length }, meta)
    count('clients', newHomes.length)
    count('patients', pets.length)
  }

  // ── Today's day sheet at the main hospital (and tomorrow's), built from the same segment rules as booking ──
  if (!(await tx.appointment.findFirst({ where: { id: { startsWith: 'seed_apt_' } }, select: { id: true } }))) {
    const tz = 'America/Los_Angeles'
    // The day sheet is for the next open day (Sunday is closed), staffed by who works that weekday.
    let today = localDate({ timeZone: tz }, now)
    if (new Date(`${today}T12:00:00Z`).getUTCDay() === 0) today = addDays(today, 1)
    const saturday = new Date(`${today}T12:00:00Z`).getUTCDay() === 6
    const dvm = saturday ? 'seed_staff_marsh' : 'seed_staff_okafor'
    const dvm2 = saturday ? 'seed_staff_cole' : 'seed_staff_okafor'
    const nextDay = addDays(today, saturday ? 2 : new Date(`${today}T12:00:00Z`).getUTCDay() === 5 ? 3 : 1)
    const types = new Map((await tx.appointmentType.findMany({ where: { id: { in: APPOINTMENT_TYPES.map(t => t.id) } } })).map(t => [t.id, t]))
    const plan: { day: string; time: string; type: string; provider: string; room: string; home: number; status: string; channel: string }[] = [
      { day: today, time: '08:00', type: 'seed_at_wellness', provider: dvm, room: 'seed_res_main_exam1', home: 0, status: 'checked_in', channel: 'csr' },
      { day: today, time: '08:30', type: 'seed_at_vaccine', provider: dvm, room: 'seed_res_main_exam1', home: 1, status: 'confirmed', channel: 'ai_voice' },
      { day: today, time: '09:00', type: 'seed_at_sick', provider: dvm2, room: 'seed_res_main_exam2', home: 4, status: 'booked', channel: 'csr' },
      { day: today, time: '09:30', type: 'seed_at_recheck', provider: dvm, room: 'seed_res_main_exam1', home: 7, status: 'booked', channel: 'portal' },
      { day: today, time: '10:00', type: 'seed_at_wellness', provider: dvm2, room: 'seed_res_main_exam3', home: 9, status: 'confirmed', channel: 'csr' },
      { day: today, time: '11:00', type: 'seed_at_sick', provider: dvm, room: 'seed_res_main_exam2', home: 12, status: 'booked', channel: 'ai_voice' },
      { day: today, time: saturday ? '12:30' : '13:30', type: 'seed_at_wellness', provider: dvm, room: 'seed_res_main_exam1', home: 16, status: 'booked', channel: 'csr' },
      { day: today, time: '09:00', type: 'seed_at_tech', provider: 'seed_staff_lopez', room: 'seed_res_main_treat', home: 18, status: 'confirmed', channel: 'csr' },
      { day: today, time: '10:00', type: 'seed_at_groom', provider: 'seed_staff_morgan', room: 'seed_res_main_groom', home: 22, status: 'booked', channel: 'portal' },
      { day: nextDay, time: '07:30', type: 'seed_at_dental', provider: 'seed_staff_marsh', room: 'seed_res_main_dental', home: 24, status: 'requested', channel: 'portal' },
      { day: nextDay, time: '08:00', type: 'seed_at_wellness', provider: 'seed_staff_okafor', room: 'seed_res_main_exam1', home: 26, status: 'booked', channel: 'ai_voice' },
      { day: nextDay, time: '08:30', type: 'seed_at_sick', provider: 'seed_staff_okafor', room: 'seed_res_main_exam2', home: 28, status: 'booked', channel: 'csr' },
    ]
    const refs = await reserveReferences(tx, 'APT', plan.length, now)
    const homesById = homes
    for (const [i, p] of plan.entries()) {
      const type = types.get(p.type)!
      const home = homesById[p.home]
      const pet = home.pets.find(x => (x.status ?? 'active') === 'active') ?? home.pets[0]
      const startsAt = zonedInstant(tz, p.day, p.time)
      const endsAt = new Date(startsAt.getTime() + type.durationMinutes * 60_000)
      const id = `seed_apt_${String(i + 1).padStart(2, '0')}`
      const hold = p.status === 'requested' ? 'held' : 'confirmed'
      await tx.appointment.create({ data: { id, ref: refs[i], locationId: 'seed_loc_main', clientId: home.id, appointmentTypeId: type.id, providerId: p.provider, startsAt, endsAt, status: p.status, channel: p.channel, reason: type.name, confirmedAt: p.status === 'confirmed' || p.status === 'checked_in' ? now : null, checkedInAt: p.status === 'checked_in' ? now : null } })
      await tx.appointmentPatient.create({ data: { appointmentId: id, patientId: pet.id, reason: type.name, status: p.status === 'checked_in' ? 'checked_in' : 'scheduled' } })
      const segments = buildSegments(type.segments as SegmentTemplate[] | null, startsAt.getTime(), type.durationMinutes)
      await tx.appointmentSegment.createMany({ data: segments.map(s => ({ appointmentId: id, kind: s.kind, startsAt: s.startsAt, endsAt: s.endsAt, resourceId: p.room, staffId: p.provider })) })
      await tx.resourceReservation.create({ data: { resourceId: p.room, appointmentId: id, startsAt, endsAt, status: hold } })
      await tx.providerReservation.create({ data: { staffMemberId: p.provider, appointmentId: id, startsAt, endsAt, status: hold } })
      if (p.status === 'checked_in') await tx.whiteboardEntry.create({ data: { locationId: 'seed_loc_main', patientId: pet.id, appointmentId: id, status: 'in_exam', roomId: p.room, assignedDvmId: p.provider, assignedTechId: 'seed_staff_price', since: now, flags: {} } })
    }
    auditCreate(uow, actor, 'Appointment', 'seed_day_sheet', 'appointments.loaded', { count: plan.length, day: today }, meta)
    count('appointments', plan.length)
  }

  // ── Formulary entries for the controlled-substance register, and the first containers ──
  const haveDrugs = new Set((await tx.drugProduct.findMany({ where: { id: { in: DRUG_PRODUCTS.map(d => d.id) } }, select: { id: true } })).map(d => d.id))
  const newDrugs = DRUG_PRODUCTS.filter(d => !haveDrugs.has(d.id))
  if (newDrugs.length) {
    await tx.drugProduct.createMany({
      data: newDrugs.map(d => ({ id: d.id, displayName: d.displayName, genericName: d.genericName, brandName: d.brandName, form: d.form, strength: d.strength, strengthUnit: d.strengthUnit, per: d.per, concentration: d.concentration, concentrationUnit: d.concentrationUnit, packageQty: d.packageQty, packageUnit: d.packageUnit, csSchedule: d.csSchedule, stateCsSchedule: ('stateCsSchedule' in d ? d.stateCsSchedule : null) as never, isHumanLabel: d.approvalStatus === 'human_label', approvalStatus: d.approvalStatus, multiDoseBudDays: d.multiDoseBudDays, ndc: d.ndc, requiresWitnessOnAdminister: d.requiresWitnessOnAdminister, active: true })),
    })
    count('drugProducts', newDrugs.length)
  }
  if (!(await tx.csContainer.findFirst({ where: { id: { startsWith: 'seed_csc_' } }, select: { id: true } }))) {
    const containers = [
      { id: 'seed_csc_ketamine_1', ref: 'CSC-MAIN-0001', productId: 'seed_drug_ketamine', locationId: 'seed_loc_main', dea: 'seed_dea_main', lot: 'KT24117', label: '10', unit: 'mL', used: '2.4' },
      { id: 'seed_csc_hydromorphone_1', ref: 'CSC-MAIN-0002', productId: 'seed_drug_hydromorphone', locationId: 'seed_loc_main', dea: 'seed_dea_main', lot: 'HM25031', label: '1', unit: 'mL', used: '0.35' },
      { id: 'seed_csc_butorphanol_eg', ref: 'CSC-EG-0001', productId: 'seed_drug_butorphanol', locationId: 'seed_loc_elkgrove', dea: 'seed_dea_elkgrove', lot: 'BT25210', label: '10', unit: 'mL', used: '0.8' },
    ]
    for (const c of containers) {
      await tx.csContainer.create({ data: { id: c.id, ref: c.ref, productId: c.productId, locationId: c.locationId, deaRegistrationId: c.dea, lotNumber: c.lot, lotExpiresOn: DAY('2027-09-30'), status: 'open', labelQty: c.label, labelUnit: c.unit, openedAt: new Date(now.getTime() - 3 * 86_400_000), openedById: 'seed_staff_lopez', budAt: new Date(now.getTime() + 25 * 86_400_000) } })
      await appendCsEntry(tx, { containerId: c.id, type: 'receive', qtySigned: c.label, unit: c.unit, occurredAt: new Date(now.getTime() - 3 * 86_400_000), actorId: 'seed_staff_lopez', reason: 'Opening balance' }, now)
      await appendCsEntry(tx, { containerId: c.id, type: 'administer', qtySigned: dec(c.used).negated(), unit: c.unit, occurredAt: new Date(now.getTime() - 2 * 86_400_000), actorId: 'seed_staff_lopez', witnessId: 'seed_staff_okafor', patientId: homes[0].pets[0].id, clientId: homes[0].id, reason: 'Premedication' }, now)
    }
    auditCreate(uow, actor, 'CsContainer', 'seed_cs', 'cs.containers_opened', { containers: containers.map(c => c.ref) }, meta)
    count('csContainers', containers.length)
  }

  // ── Phase 2: formulary dose ranges, vaccines, reminder protocols, wards, codes, templates ──
  await seedClinical(uow, actor, count)
  await seedInventory(uow, actor, count)
  await seedBilling(uow, actor, count)
  await seedPhase5(uow, actor, count)
  // Labs are not loaded here: each practice sets up its own, or takes the in-house catalog as its own onboarding step (seed/labs.ts).

  return created
}
