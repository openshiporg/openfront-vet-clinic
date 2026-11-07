/**
 * Reception drill: runs the inbound AI receptionist through its real commands on a non-production
 * database, as the voice runtime would (the receptionist's OAuth client, recording telephony), so a
 * practice can rehearse before switching `aiVoice` on for real callers. Four fictional calls:
 *   1. a known client books annual vaccines after disclosure and verification, and gets a text;
 *   2. "my dog ate rat poison": emergency screen → ER instruction + urgent transfer, no booking;
 *   3. an unknown caller who cannot verify: no patient details, a call-back task;
 *   4. a client asks for a refill: the request is taken for a DVM to decide.
 * Usage: DATABASE_URL=... DRILL_OWNER_USER_ID=seed_user_park npx tsx scripts/reception-drill.ts
 * Refuses NODE_ENV=production. aiVoice must already be on (maker-checker in Practice settings).
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { appendCallTranscript, endCall, recordCallDisclosure, requestRefill, runTriage, startCall, verifyCaller } from '../features/keystone/mutations/reception'
import { bookAppointment, searchAvailability } from '../features/keystone/mutations/schedule'
import { runCommsWorker } from '../features/keystone/workers/comms'
import { recordingTelephony } from '../features/integrations/telephony'
import { households, TRIAGE_PROTOCOL } from '../features/keystone/seed/clinicData'

if (process.env.NODE_ENV === 'production') throw new Error('The reception drill never runs in production.')
const prisma = new PrismaClient()
const owner = process.env.DRILL_OWNER_USER_ID ?? 'seed_user_park'
const ctx = { prisma, session: { itemId: owner, data: { name: 'Voice runtime', kind: 'staff' }, mcp: { clientId: 'ccah-voice-receptionist', scopes: ['mcp:read', 'mcp:write'], tokenId: 'drill' } } } as never
const key = (p: string) => `drill-${p}-${randomUUID()}`
const LINE = '+19165550100'
const homes = households()
/** The caller said no to every screening question. */
const allNo = Object.fromEntries(TRIAGE_PROTOCOL.questions.map(q => [q.id, false]))

async function say(callRecordId: string, turns: [('caller' | 'agent'), string][]) {
  await appendCallTranscript(null, { callRecordId, turns: turns.map(([speaker, text]) => ({ speaker, text })), idempotencyKey: key('t') }, ctx)
}

async function main() {
  const location = 'seed_loc_main'
  const tz = 'America/Los_Angeles'
  const from = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + 2 * 86_400_000))

  // 1. Vaccines for a known client.
  const h1 = homes[1], pet1 = h1.pets.find(p => (p.status ?? 'active') === 'active')!
  const c1 = await startCall(null, { input: { direction: 'inbound', from: h1.people[0].phone!, to: LINE, locationId: location, answeredBy: 'ai', providerCallId: `CA${randomUUID().replaceAll('-', '')}`, adapterKey: 'drill' }, idempotencyKey: key('c') }, ctx)
  await recordCallDisclosure(null, { callRecordId: c1.id, recordingConsent: 'accepted', idempotencyKey: key('d') }, ctx)
  await say(c1.id, [['agent', 'Thanks for calling Cedar Creek Animal Hospital. I am an AI assistant and this call is recorded. Is your pet having an emergency?'], ['caller', `No, ${pet1.name} just needs the yearly shots.`], ['agent', `Can you confirm ${pet1.name}'s date of birth?`], ['caller', pet1.dob]])
  await runTriage(null, { input: { complaint: 'Annual vaccines, no symptoms', answers: allNo, patientId: pet1.id, clientId: h1.id, callRecordId: c1.id, locationId: location }, idempotencyKey: key('tr') }, ctx)
  await verifyCaller(null, { callRecordId: c1.id, method: 'pet_name_dob', petName: pet1.name, petDateOfBirth: pet1.dob, idempotencyKey: key('v') }, ctx)
  const offer = await searchAvailability(null, { locationId: location, appointmentTypeId: 'seed_at_vaccine', from, days: 7, limit: 3 }, ctx)
  const booked = await bookAppointment(null, { input: { slotToken: offer.slots[0].slotToken, clientId: h1.id, patientIds: [pet1.id], reason: 'Annual vaccines', callRecordId: c1.id }, idempotencyKey: key('b') }, ctx)
  await say(c1.id, [['agent', `You're booked: ${offer.slots[0].providerName}, ${new Date(offer.slots[0].startsAt).toLocaleString('en-US', { timeZone: tz })}. I'll text you a confirmation.`]])
  await endCall(null, { callRecordId: c1.id, disposition: 'booked', summary: `Booked annual vaccines for ${pet1.name} (${booked.ref}).`, idempotencyKey: key('e') }, ctx)

  // 2. Rat poison: emergency, never booked.
  const h2 = homes[2], pet2 = h2.pets.find(p => (p.status ?? 'active') === 'active')!
  const c2 = await startCall(null, { input: { direction: 'inbound', from: h2.people[0].phone!, to: LINE, locationId: location, answeredBy: 'ai', adapterKey: 'drill' }, idempotencyKey: key('c') }, ctx)
  await recordCallDisclosure(null, { callRecordId: c2.id, recordingConsent: 'accepted', idempotencyKey: key('d') }, ctx)
  await say(c2.id, [['caller', `My dog ${pet2.name} ate rat poison about twenty minutes ago.`]])
  const t2 = await runTriage(null, { input: { complaint: `${pet2.name} ate rat poison about twenty minutes ago`, answers: { ...allNo, toxin: true }, patientId: pet2.id, clientId: h2.id, callRecordId: c2.id, locationId: location }, idempotencyKey: key('tr') }, ctx)
  await say(c2.id, [['agent', t2.script]])
  await endCall(null, { callRecordId: c2.id, disposition: 'urgent_transfer', transferTo: LINE, summary: 'Rat poison ingestion: told to come in now / ER; transferred to the front desk.', idempotencyKey: key('e') }, ctx)

  // 3. Unknown caller who cannot verify.
  const c3 = await startCall(null, { input: { direction: 'inbound', from: '+19165550197', to: LINE, locationId: location, answeredBy: 'ai', adapterKey: 'drill' }, idempotencyKey: key('c') }, ctx)
  await recordCallDisclosure(null, { callRecordId: c3.id, recordingConsent: 'declined', idempotencyKey: key('d') }, ctx)
  await say(c3.id, [['caller', "I'm calling about my neighbour's cat's test results."], ['agent', "I can't share a patient's details on this call. I'll ask the front desk to call the owner back."]])
  await endCall(null, { callRecordId: c3.id, disposition: 'callback_task', summary: 'Caller asked for results for a patient they could not verify; no details given.', idempotencyKey: key('e') }, ctx)

  // 4. Refill request.
  const h4 = homes[9], pet4 = h4.pets.find(p => (p.status ?? 'active') === 'active')!
  const c4 = await startCall(null, { input: { direction: 'inbound', from: h4.people[0].phone!, to: LINE, locationId: location, answeredBy: 'ai', adapterKey: 'drill' }, idempotencyKey: key('c') }, ctx)
  await recordCallDisclosure(null, { callRecordId: c4.id, recordingConsent: 'accepted', idempotencyKey: key('d') }, ctx)
  await verifyCaller(null, { callRecordId: c4.id, method: 'pet_name_dob', petName: pet4.name, petDateOfBirth: pet4.dob, idempotencyKey: key('v') }, ctx)
  await runTriage(null, { input: { complaint: 'Refill of a regular medication, no new symptoms', answers: allNo, patientId: pet4.id, clientId: h4.id, callRecordId: c4.id, locationId: location, outcome: 'callback_task' }, idempotencyKey: key('tr') }, ctx)
  await requestRefill(null, { input: { patientId: pet4.id, productText: 'Gabapentin 100 mg capsules', channel: 'ai_voice', callRecordId: c4.id }, idempotencyKey: key('r') }, ctx)
  await say(c4.id, [['agent', 'I have passed the refill request to the doctor. You will get a text when it is decided.']])
  await endCall(null, { callRecordId: c4.id, disposition: 'refill_request', summary: `Refill request for ${pet4.name}: gabapentin 100 mg.`, idempotencyKey: key('e') }, ctx)

  const phone = recordingTelephony()
  const drained = await runCommsWorker(prisma as never, { adapter: phone.adapter })
  console.log(JSON.stringify({ calls: [c1.ref, c2.ref, c3.ref, c4.ref], booked: booked.ref, triage: t2.level, texts: phone.sent.length, worker: drained }, null, 1))
}

main().then(() => prisma.$disconnect(), async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
