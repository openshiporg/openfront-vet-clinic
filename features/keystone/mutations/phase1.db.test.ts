import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { verifyAuditChain } from '../lib/audit'
import { appendCsEntry, containerBalance } from '../lib/csRegister'
import { localDate } from '../lib/calendar'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { decideApprovalRequest, requestPracticeControls } from './approvals'
import { bookAppointment, searchAvailability } from './schedule'
import { recordCallDisclosure, endCall, receiveInboundSms, receptionContext, runTriage, startCall, verifyCaller, requestRefill } from './reception'
import { recordWeight, registerPendingClient } from './clients'
import { runCommsWorker, sendQueued } from '../workers/comms'
import { recordingTelephony, manualTelephony } from '../../integrations/telephony'
import { households, TRIAGE_PROTOCOL } from '../seed/clinicData'

/**
 * Phase 1 exit gate (BUILD-PLAN P1) against the scratch Postgres: 50 parallel bookings for one slot
 * → one wins; the AI receptionist books a vaccine visit on a recorded call and texts a confirmation;
 * "my dog ate rat poison" → ER instruction + urgent transfer, no booking; an unverified caller gets
 * no patient data; a text to a deceased patient's client is blocked; a lapsed VCPR is on the header.
 * Plus the database refusals: CS balance never < 0 and CII refills refused.
 */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@test.local`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
/** The voice runtime's MCP session: a token issued to the receptionist's OAuth client. */
const agentSession = (userId: string) => ({ ...sessionFor(userId, []), mcp: { clientId: 'ccah-voice-receptionist', scopes: ['mcp:read', 'mcp:write'], tokenId: 'tok_test' } })

const HOMES = households()
const ACTIVE_PET = (i: number) => HOMES[i].pets.find(p => (p.status ?? 'active') === 'active')!
const pgError = (e: unknown) => String((e as Error)?.message ?? e)

describe.skipIf(!hasTestDatabase)('Phase 1 exit gate (database)', () => {
  let prisma: PrismaClient
  let owner: { session: unknown; prisma: PrismaClient }
  let director: { session: unknown; prisma: PrismaClient }
  let csr: { session: unknown; prisma: PrismaClient }
  let agent: { session: unknown; prisma: PrismaClient }

  beforeAll(async () => {
    prisma = testPrisma(12)
    await resetDatabase(prisma)
    const make = (name: string) => prisma.user.create({ data: { name, email: `${uniqueKey(name)}@test.local`, password: 'x'.repeat(60) } })
    const [o, d, c, a] = await Promise.all([make('owner'), make('director'), make('csr'), make('voice')])
    owner = { session: sessionFor(o.id, permissionNames.filter(p => p !== 'canBreakGlass')), prisma }
    director = { session: sessionFor(d.id, ['canAccessDashboard', 'canApprovePolicies', 'canReadAudit']), prisma }
    csr = { session: sessionFor(c.id, ['canAccessDashboard', 'canBook', 'canCheckIn', 'canManageClients', 'canMessageClients', 'canReadClientPII']), prisma }
    agent = { session: agentSession(a.id), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('loads the clinic once: the second load creates nothing, and the audit chain verifies', async () => {
    const first = await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    const pets = HOMES.reduce((n, h) => n + h.pets.length, 0)
    expect(first.created).toMatchObject({ clients: HOMES.length, patients: pets, appointmentTypes: 10, triageProtocols: 1, agents: 1, csContainers: 3 })
    expect(pets).toBeGreaterThan(600)
    const again = await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    expect(Object.values(again.created).every(n => n === 0)).toBe(true)
    await expect(loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, csr)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    expect((await verifyAuditChain(prisma as never)).ok).toBe(true)
    // Refs are well-formed and unique; the rescue client has twelve cats.
    expect(await prisma.client.count({ where: { ref: { startsWith: 'C-' } } })).toBe(HOMES.length)
    expect(await prisma.patientOwnership.count({ where: { clientId: 'seed_cl_021' } })).toBe(12)
  }, 180_000)

  it('the AI receptionist is refused until the practice turns aiVoice on (maker-checker)', async () => {
    const call = () => startCall(null, { input: { direction: 'inbound', from: '+19165550102', to: '+19165550100', locationId: 'seed_loc_main', answeredBy: 'ai' }, idempotencyKey: uniqueKey('call') }, agent)
    await expect(call()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    const asked = await requestPracticeControls(null, { changes: { features: { aiVoice: true } }, reason: 'Answer overflow and after-hours calls', idempotencyKey: uniqueKey('pc') }, owner)
    await decideApprovalRequest(null, { requestId: asked.id, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, director)
    const started = await call()
    expect(started.knownNumber).toBe(true)
    const refused = await prisma.agentAction.findFirst({ where: { agentId: 'seed_agent_reception', outcome: 'guard_failed', errorCode: 'FEATURE_DISABLED' } })
    expect(refused).not.toBeNull()
  })

  it('an AI call books a vaccine visit only after disclosure and verification, and texts a confirmation', async () => {
    const home = HOMES[1]
    const pet = ACTIVE_PET(1)
    const call = await startCall(null, { input: { direction: 'inbound', from: home.people[0].phone!, to: '+19165550100', locationId: 'seed_loc_main', answeredBy: 'ai', providerCallId: 'CA-test-1' }, idempotencyKey: uniqueKey('call') }, agent)
    // Before the disclosure: no patient data and no booking.
    await expect(receptionContext(null, { callRecordId: call.id }, agent)).rejects.toMatchObject({ code: 'CALLER_NOT_VERIFIED' })
    await recordCallDisclosure(null, { callRecordId: call.id, recordingConsent: 'accepted', idempotencyKey: uniqueKey('disc') }, agent)
    // The caller knows a wrong date of birth: still nothing.
    const wrong = await verifyCaller(null, { callRecordId: call.id, method: 'pet_name_dob', petName: pet.name, petDateOfBirth: '1999-01-01', idempotencyKey: uniqueKey('v') }, agent)
    expect(wrong.verified).toBe(false)
    await expect(receptionContext(null, { callRecordId: call.id }, agent)).rejects.toMatchObject({ code: 'CALLER_NOT_VERIFIED' })
    const ok = await verifyCaller(null, { callRecordId: call.id, method: 'pet_name_dob', petName: pet.name.toUpperCase(), petDateOfBirth: pet.dob, idempotencyKey: uniqueKey('v') }, agent)
    expect(ok).toMatchObject({ verified: true, clientId: home.id })
    const context = await receptionContext(null, { callRecordId: call.id }, agent)
    expect(context.pets.map((p: { id: string }) => p.id)).toContain(pet.id)
    expect(await prisma.readAudit.count({ where: { actorKind: 'agent', resourceType: 'Patient', purpose: 'agent_tool' } })).toBeGreaterThan(0)

    // Surgery is never booked by the agent.
    await expect(searchAvailability(null, { locationId: 'seed_loc_main', appointmentTypeId: 'seed_at_spay' }, agent)).rejects.toMatchObject({ code: 'NEVER_ALLOWED_FOR_AGENTS' })
    const from = localDate({ timeZone: 'America/Los_Angeles' }, Date.now() + 2 * 86_400_000)
    const offer = await searchAvailability(null, { locationId: 'seed_loc_main', appointmentTypeId: 'seed_at_vaccine', from, days: 7, limit: 5 }, agent)
    expect(offer.slots.length).toBeGreaterThan(0)
    const booked = await bookAppointment(null, { input: { slotToken: offer.slots[0].slotToken, clientId: home.id, patientIds: [pet.id], reason: 'Annual vaccines', callRecordId: call.id }, idempotencyKey: uniqueKey('book') }, agent)
    expect(booked).toMatchObject({ status: 'booked' })
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } })
    expect(appt).toMatchObject({ channel: 'ai_voice', bookedByAgentId: 'seed_agent_reception', callRecordId: call.id })
    await endCall(null, { callRecordId: call.id, disposition: 'booked', summary: 'Booked annual vaccines', idempotencyKey: uniqueKey('end') }, agent)

    const phone = recordingTelephony()
    // Run the worker at 10:00 Sacramento time so quiet hours don't defer the text.
    const tenAm = new Date(`${from}T18:00:00Z`)
    await runCommsWorker(prisma as never, { adapter: phone.adapter, now: () => tenAm })
    const text = phone.sent.find(s => s.to === home.people[0].phone)
    expect(text?.body).toContain(pet.name)
    expect(text?.body).toMatch(/Reply C to confirm/)
    expect(await prisma.commsMessage.count({ where: { appointmentId: booked.id, status: 'sent' } })).toBe(1)

    // The client texts C: the appointment is confirmed (and a provider retry is the same message).
    const sms = { from: home.people[0].phone!, to: '+19165550100', body: 'C', providerId: 'SMconfirm0000000001' }
    expect((await receiveInboundSms(prisma, sms)).handled).toBe('confirmed')
    await receiveInboundSms(prisma, sms)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } })).status).toBe('confirmed')
    expect(await prisma.commsMessage.count({ where: { providerId: sms.providerId } })).toBe(1)
  }, 60_000)

  it('"my dog ate rat poison" → ER instruction and urgent transfer, never a booking', async () => {
    const home = HOMES[2]
    const pet = ACTIVE_PET(2)
    const call = await startCall(null, { input: { direction: 'inbound', from: home.people[0].phone!, to: '+19165550100', locationId: 'seed_loc_main', answeredBy: 'ai' }, idempotencyKey: uniqueKey('call') }, agent)
    await recordCallDisclosure(null, { callRecordId: call.id, recordingConsent: 'accepted', idempotencyKey: uniqueKey('disc') }, agent)
    await verifyCaller(null, { callRecordId: call.id, method: 'pet_name_dob', petName: pet.name, petDateOfBirth: pet.dob, idempotencyKey: uniqueKey('v') }, agent)
    // The agent can't record an emergency as booked.
    await expect(runTriage(null, { input: { complaint: 'My dog ate rat poison', answers: {}, callRecordId: call.id, locationId: 'seed_loc_main', outcome: 'booked' }, idempotencyKey: uniqueKey('t') }, agent)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const triage = await runTriage(null, { input: { complaint: 'My dog ate rat poison', answers: {}, patientId: pet.id, clientId: home.id, callRecordId: call.id, locationId: 'seed_loc_main' }, idempotencyKey: uniqueKey('t') }, agent)
    expect(triage).toMatchObject({ level: 'emergency_now', outcome: 'transferred' })
    expect(triage.script).toMatch(/emergency/i)
    expect(triage.emergencyReferral?.name).toMatch(/24 h/)
    // Booking against the emergency screen is refused, whatever slot is offered.
    const from = localDate({ timeZone: 'America/Los_Angeles' }, Date.now() + 2 * 86_400_000)
    const offer = await searchAvailability(null, { locationId: 'seed_loc_main', appointmentTypeId: 'seed_at_sick', from, days: 7, limit: 1 }, agent)
    await expect(bookAppointment(null, { input: { slotToken: offer.slots[0].slotToken, clientId: home.id, patientIds: [pet.id], callRecordId: call.id, triageId: triage.id }, idempotencyKey: uniqueKey('b') }, agent)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    // A later screen can't lower it.
    const allNo = Object.fromEntries(TRIAGE_PROTOCOL.questions.map(q => [q.id, false]))
    await expect(runTriage(null, { input: { complaint: 'actually he seems fine', answers: allNo, callRecordId: call.id, locationId: 'seed_loc_main' }, idempotencyKey: uniqueKey('t') }, agent)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await endCall(null, { callRecordId: call.id, disposition: 'urgent_transfer', transferTo: '+19165550100', idempotencyKey: uniqueKey('end') }, agent)
    // The worker raises one urgent task for a person.
    await runCommsWorker(prisma as never, { adapter: manualTelephony })
    const tasks = await prisma.task.findMany({ where: { subjectType: 'TriageAssessment', subjectId: triage.id } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ priority: 'urgent', kind: 'call_back' })
    // And the database refuses an emergency recorded as booked, even bypassing the commands.
    await expect(prisma.triageAssessment.create({ data: { level: 'emergency_now', outcome: 'booked', complaint: 'x', actorKind: 'user', at: new Date() } as never })).rejects.toThrow(/emergency_not_booked/)
    expect(await prisma.appointment.count({ where: { triageId: triage.id } })).toBe(0)
  }, 60_000)

  it('scope, kill switch and the human-only lines hold for the agent', async () => {
    await prisma.agentToolGrant.updateMany({ where: { agentId: 'seed_agent_reception', scope: 'pharmacy.intake' }, data: { status: 'revoked' } })
    await expect(requestRefill(null, { input: { patientId: ACTIVE_PET(3).id, productText: 'carprofen 75 mg' }, idempotencyKey: uniqueKey('r') }, agent)).rejects.toMatchObject({ code: 'SCOPE_DENIED' })
    await prisma.agentToolGrant.updateMany({ where: { agentId: 'seed_agent_reception', scope: 'pharmacy.intake' }, data: { status: 'active' } })
    await prisma.agentIdentity.update({ where: { id: 'seed_agent_reception' }, data: { killSwitch: true } })
    await expect(startCall(null, { input: { direction: 'inbound', from: '+19165550110', to: '+19165550100', locationId: 'seed_loc_main', answeredBy: 'ai' }, idempotencyKey: uniqueKey('c') }, agent)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await prisma.agentIdentity.update({ where: { id: 'seed_agent_reception' }, data: { killSwitch: false } })
    // Outbound AI calls are refused by the command and by the database.
    await expect(startCall(null, { input: { direction: 'outbound', from: '+19165550100', to: '+19165550110', locationId: 'seed_loc_main', answeredBy: 'ai' }, idempotencyKey: uniqueKey('c') }, agent)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await expect(prisma.callRecord.create({ data: { ref: 'CALL-X', direction: 'outbound', answeredBy: 'ai', from: '+19165550100', to: '+19165550110', status: 'ringing', startedAt: new Date(), recordingConsent: 'not_asked', verificationMethod: 'none', disposition: 'open' } as never })).rejects.toThrow(/no_outbound_ai/)
    const kinds = await prisma.agentAction.groupBy({ by: ['outcome'], where: { agentId: 'seed_agent_reception' }, _count: true })
    expect(kinds.map(k => k.outcome)).toEqual(expect.arrayContaining(['ok', 'scope_denied', 'killed']))
  })

  it('a new caller is registered as pending, and a phone match alone is not identity', async () => {
    const call = await startCall(null, { input: { direction: 'inbound', from: '+19165550194', to: '+19165550100', locationId: 'seed_loc_main', answeredBy: 'ai' }, idempotencyKey: uniqueKey('call') }, agent)
    expect(call.knownNumber).toBe(false)
    await recordCallDisclosure(null, { callRecordId: call.id, recordingConsent: 'declined', idempotencyKey: uniqueKey('disc') }, agent)
    const pending = await registerPendingClient(null, { input: { firstName: 'Rowan', lastName: 'Ashby', phone: '+19165550194', locationId: 'seed_loc_main', pet: { name: 'Pip', speciesCode: 'feline', sex: 'female', dateOfBirth: '2025-03-01' } as never, callRecordId: call.id }, idempotencyKey: uniqueKey('reg') }, agent)
    const client = await prisma.client.findUniqueOrThrow({ where: { id: pending.clientId } })
    expect(client).toMatchObject({ status: 'prospect', source: 'ai_voice' })
  })

  it('50 parallel bookings for one slot: exactly one wins, the rest get SLOT_TAKEN', async () => {
    const from = localDate({ timeZone: 'America/Los_Angeles' }, Date.now() + 9 * 86_400_000)
    const offer = await searchAvailability(null, { locationId: 'seed_loc_main', appointmentTypeId: 'seed_at_wellness', from, days: 5, limit: 1 }, csr)
    const token = offer.slots[0].slotToken
    const attempts = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => {
      const home = HOMES[30 + i]
      return bookAppointment(null, { input: { slotToken: token, clientId: home.id, patientIds: [ACTIVE_PET(30 + i).id], channel: 'csr' }, idempotencyKey: uniqueKey(`race${i}`) }, csr)
    }))
    const won = attempts.filter(a => a.status === 'fulfilled')
    const lost = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost.map(l => l.reason?.code).filter(c => c !== 'SLOT_TAKEN')).toEqual([])
    // The exclusion constraint holds even without the command.
    const claim = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
    await expect(prisma.providerReservation.create({ data: { staffMemberId: claim.providerId, startsAt: new Date(claim.start), endsAt: new Date(claim.end), status: 'confirmed' } })).rejects.toThrow(/no_overlap/)
  }, 120_000)

  it('a text about a deceased patient is blocked; STOP suppresses once and still gets its confirmation', async () => {
    const deceasedHome = HOMES[15]
    const dead = deceasedHome.pets[0]
    expect(dead.status).toBe('deceased')
    const contact = await prisma.contactPoint.findFirstOrThrow({ where: { personId: deceasedHome.people[0].id, kind: 'mobile' } })
    const thread = await prisma.commsThread.create({ data: { clientId: deceasedHome.id, contactPointId: contact.id, channel: 'sms', subject: 'Reminders', status: 'open' } })
    const msg = await prisma.commsMessage.create({ data: { threadId: thread.id, direction: 'outbound', purpose: 'care', templateCode: 'appointment_reminder', to: contact.value, body: `${dead.name} is due for vaccines`, status: 'queued', patientId: dead.id } })
    const phone = recordingTelephony()
    const noon = new Date('2026-11-12T20:00:00Z')
    const out = await sendQueued(prisma as never, { adapter: phone.adapter, now: noon })
    expect(out.find(o => o.id === msg.id)).toMatchObject({ result: 'blocked', reason: 'patient_deceased' })
    expect(phone.sent.some(s => s.to === contact.value)).toBe(false)
    expect((await prisma.commsMessage.findUniqueOrThrow({ where: { id: msg.id } })).blockedReason).toBe('patient_deceased')

    // Quiet hours (22:30 local) defer instead of blocking.
    const other = HOMES[5]
    const oc = await prisma.contactPoint.findFirstOrThrow({ where: { personId: other.people[0].id, kind: 'mobile' } })
    const t2 = await prisma.commsThread.create({ data: { clientId: other.id, contactPointId: oc.id, channel: 'sms', subject: 'x', status: 'open' } })
    const late = await prisma.commsMessage.create({ data: { threadId: t2.id, direction: 'outbound', purpose: 'transactional', to: oc.value, body: 'Your appointment is tomorrow', status: 'queued' } })
    expect((await sendQueued(prisma as never, { adapter: phone.adapter, now: new Date('2026-11-13T06:30:00Z') })).find(o => o.id === late.id)).toMatchObject({ result: 'deferred', reason: 'quiet_hours' })
    // The manual adapter hands the text to a person.
    expect((await sendQueued(prisma as never, { adapter: manualTelephony, now: noon })).find(o => o.id === late.id)).toMatchObject({ result: 'handed_off' })
    expect(await prisma.task.count({ where: { subjectType: 'CommsMessage', subjectId: late.id } })).toBe(1)

    // STOP twice: one suppression; the confirmation still goes; later texts are blocked.
    await receiveInboundSms(prisma, { from: oc.value, to: '+19165550100', body: 'STOP', providerId: 'SMstop00000000000001' })
    await receiveInboundSms(prisma, { from: oc.value, to: '+19165550100', body: 'stop', providerId: 'SMstop00000000000002' })
    expect(await prisma.suppression.count({ where: { contactPointId: oc.id, active: true } })).toBe(1)
    await runCommsWorker(prisma as never, { adapter: phone.adapter, now: () => noon })
    expect(phone.sent.filter(s => s.to === oc.value && /no longer receive/.test(s.body)).length).toBeGreaterThanOrEqual(1)
    const after = await prisma.commsMessage.create({ data: { threadId: t2.id, direction: 'outbound', purpose: 'transactional', to: oc.value, body: 'See you soon', status: 'queued' } })
    expect((await sendQueued(prisma as never, { adapter: phone.adapter, now: noon })).find(o => o.id === after.id)).toMatchObject({ result: 'blocked' })
  }, 60_000)

  it('a lapsed VCPR is visible on the patient header data', async () => {
    const lapsed = await prisma.vcprRecord.findFirst({ where: { status: 'expired' }, select: { patientId: true, expiresAt: true } })
    expect(lapsed).not.toBeNull()
    expect(lapsed!.expiresAt.getTime()).toBeLessThan(Date.now())
    const active = await prisma.vcprRecord.count({ where: { patientId: lapsed!.patientId, status: 'active', expiresAt: { gt: new Date() } } })
    expect(active).toBe(0)
  })

  it('the database refuses a CS balance below zero, whatever the caller does', async () => {
    const id = 'seed_csc_hydromorphone_1'
    const balance = await containerBalance(prisma as never, id)
    expect(balance.toFixed()).toBe('0.65')
    await expect(prisma.$transaction(tx => appendCsEntry(tx as never, { containerId: id, type: 'administer', qtySigned: '-0.7', unit: 'mL', occurredAt: new Date(), actorId: 'seed_staff_lopez' }, new Date()))).rejects.toThrow(/below zero/)
    // Ten concurrent 0.1 mL draws against 0.65 mL: at most six succeed; the balance never goes negative.
    const draws = await Promise.allSettled(Array.from({ length: 10 }, () => prisma.$transaction(tx => appendCsEntry(tx as never, { containerId: id, type: 'administer', qtySigned: '-0.1', unit: 'mL', occurredAt: new Date(), actorId: 'seed_staff_lopez' }, new Date()), { timeout: 30_000, maxWait: 30_000 })))
    expect(draws.filter(d => d.status === 'fulfilled').length).toBe(6)
    expect((await containerBalance(prisma as never, id)).toFixed()).toBe('0.05')
    // CII entries carry the separate CII sequence; register rows are append-only.
    const cii = await prisma.csLogEntry.findMany({ where: { containerId: id }, select: { ciiRef: true, id: true } })
    expect(cii.every(e => e.ciiRef?.startsWith('CII-'))).toBe(true)
    await expect(prisma.csLogEntry.update({ where: { id: cii[0].id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only|never/i)
    await expect(prisma.csContainer.delete({ where: { id } })).rejects.toThrow(/never deleted/)
  }, 60_000)

  it('the database refuses refills on a Schedule II prescription, and CIII-V beyond five refills or six months', async () => {
    const rx = await prisma.prescription.create({ data: { ref: 'RX-TEST-1', patientId: ACTIVE_PET(0).id, clientId: HOMES[0].id, locationId: 'seed_loc_main', prescriberId: 'seed_staff_marsh', issuedAt: new Date('2026-11-09T18:00:00Z'), status: 'draft' } })
    const line = (productId: string, csSchedule: string, refillsAuthorised: number, months = 3) => prisma.prescriptionLine.create({ data: { prescriptionId: rx.id, productId, csSchedule, quantity: '10', quantityUnit: 'mL', refillsAuthorised, expiresAt: new Date(Date.UTC(2026, 10 + months, 9)) } })
    await expect(line('seed_drug_hydromorphone', 'CII', 1)).rejects.toThrow(/cii_no_refills/)
    await expect(line('seed_drug_hydromorphone', 'none', 2)).rejects.toThrow(/does not match/)
    await expect(line('seed_drug_ketamine', 'CIII', 6)).rejects.toThrow(/ciii_cv_refills/)
    await expect(line('seed_drug_ketamine', 'CIII', 2, 7)).rejects.toThrow(/six months/)
    await expect(line('seed_drug_hydromorphone', 'CII', 0)).resolves.toBeTruthy()
    await expect(line('seed_drug_butorphanol', 'CIV', 5)).resolves.toBeTruthy()
  })

  it('the same weight entered twice is one weighing; a different reading is a second one', async () => {
    const patientId = ACTIVE_PET(1).id
    const before = await prisma.weightMeasurement.count({ where: { patientId } })
    const first = await recordWeight(null, { patientId, value: '12.6', unit: 'kg', idempotencyKey: uniqueKey('w1') }, csr as never) as { id: string; duplicate: boolean }
    const again = await recordWeight(null, { patientId, value: '12.60', unit: 'kg', idempotencyKey: uniqueKey('w2') }, csr as never) as { id: string; duplicate: boolean }
    expect(first.duplicate).toBe(false)
    expect(again).toMatchObject({ id: first.id, duplicate: true })
    await recordWeight(null, { patientId, value: '12.8', unit: 'kg', idempotencyKey: uniqueKey('w3') }, csr as never)
    expect(await prisma.weightMeasurement.count({ where: { patientId } })).toBe(before + 2)
  })

  it('append-only clinical evidence: weights, consents and triage can be added, never edited', async () => {
    const w = await prisma.weightMeasurement.findFirstOrThrow({ where: { patientId: ACTIVE_PET(0).id } })
    await expect(prisma.weightMeasurement.update({ where: { id: w.id }, data: { value: '1' } })).rejects.toThrow()
    const c = await prisma.consentRecord.findFirstOrThrow()
    await expect(prisma.consentRecord.delete({ where: { id: c.id } })).rejects.toThrow()
    const t = await prisma.triageAssessment.findFirstOrThrow()
    await expect(prisma.triageAssessment.update({ where: { id: t.id }, data: { level: 'routine' } })).rejects.toThrow()
    expect((await verifyAuditChain(prisma as never)).ok).toBe(true)
  })
})
