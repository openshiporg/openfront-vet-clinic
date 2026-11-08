/**
 * Clinical drill: runs a day of hospital work through the real Phase 2 commands on a non-production
 * database, so a practice can rehearse the record before go-live and every screen has real rows.
 * Nothing is written by hand; every row comes from the same commands the dashboard calls.
 *   1. a wellness visit: weight, vitals, exam, SOAP, DHPP + rabies (certificate and reminders), signed;
 *   2. a limping dog: dose from the recorded weight, an above-range dose refused, submitted unsigned;
 *   3. a vomiting cat admitted to the ward: a q8h maropitant and q6h fluids sheet, one task done;
 *   4. a TPLO: anaesthesia with induction, monitoring, a witnessed hydromorphone dose and the report;
 *   5. a dental: anaesthesia and a charted mouth;
 *   6. a scribe draft accepted block by block (the scribe turned on through maker-checker);
 *   7. an Avimark client export previewed and applied.
 * Usage: DATABASE_URL=... npx tsx scripts/clinical-drill.ts   (DRILL_ONLY=ward,scribe for some steps)
 * Refuses NODE_ENV=production. Runs on top of the seed (npm run seed or loadClinicSetup).
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { permissionNames } from '../features/keystone/access'
import { recordWeight } from '../features/keystone/mutations/clients'
import { addDiagnosis, openEncounter, recordVitals, saveSoapSection, setExamFinding, signEncounter, submitEncounter } from '../features/keystone/mutations/record'
import { admitPatient, anaesthesiaEvent, completeTreatmentTask, openAnaesthesia, placeOrder, recordAdministration, recordMonitoring, saveDentalChart, saveSurgeryReport } from '../features/keystone/mutations/treatment'
import { administerVaccine } from '../features/keystone/mutations/vaccines'
import { acceptScribeDraft, draftScribeSession, startScribeSession } from '../features/keystone/mutations/scribe'
import { applyImport, previewImport } from '../features/keystone/mutations/imports'
import { decideApprovalRequest, requestPracticeControls } from '../features/keystone/mutations/approvals'
import { renderDocument } from '../features/keystone/workers/documents'
import { drainOutbox } from '../features/keystone/lib/outbox'

if (process.env.NODE_ENV === 'production') throw new Error('The clinical drill never runs in production.')
const prisma = new PrismaClient()
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const RVT = ['canAccessDashboard', 'canReadClinical', 'canWriteRecord', 'canOrder', 'canAdminister', 'canAdministerControlled', 'canWitnessControlled', 'canCheckIn', 'canManagePatients', 'canReadClientPII']
const as = (userId: string, granted: string[]) => ({
  prisma,
  session: { itemId: userId, data: { name: userId, email: `${userId}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'drill', name: 'drill', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } } },
}) as never
const marsh = as('seed_user_marsh', ALL)
const okafor = as('seed_user_okafor', ALL)
const lopez = as('seed_user_lopez', RVT)
const key = (p: string) => `drill-${p}-${randomUUID()}`
const LOC = 'seed_loc_main'
const step = (s: string) => console.log(`· ${s}`)

async function version(id: string) {
  return (await prisma.encounter.findUniqueOrThrow({ where: { id }, select: { version: true } })).version
}

async function sign(id: string, by: never) {
  const sub = await submitEncounter(null, { encounterId: id, expectedVersion: await version(id), idempotencyKey: key('sub') }, lopez)
  await signEncounter(null, { encounterId: id, expectedVersion: Number(sub.version), idempotencyKey: key('sig') }, by)
}

async function wellness() {
  const patient = 'seed_pet_008_2' // Ranger, Golden Retriever
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'outpatient', reason: 'Annual exam and vaccines', attendingDvmId: 'seed_staff_okafor', idempotencyKey: key('enc') }, lopez)
  await recordWeight(null, { patientId: patient, value: '66.8', unit: 'lb', idempotencyKey: key('w') }, lopez)
  await recordVitals(null, { encounterId: enc.id, temperature: '101.2', temperatureUnit: 'F', heartRate: 88, respRate: 20, mucousMembranes: 'pink, moist', crtSeconds: '1.5', painScore: 0, idempotencyKey: key('v') }, lopez)
  for (const [system, status, text] of [['general', 'normal', 'Bright, alert, responsive; BCS 5/9'], ['oral', 'abnormal', 'Grade 1 tartar on upper premolars'], ['cardiovascular', 'normal', ''], ['respiratory', 'normal', ''], ['integument', 'normal', ''], ['musculoskeletal', 'normal', '']] as const) {
    await setExamFinding(null, { encounterId: enc.id, system, status, text, idempotencyKey: key('x') }, okafor)
  }
  await saveSoapSection(null, { encounterId: enc.id, kind: 'subjective', body: 'Annual visit. Owner reports normal appetite, energy and stool. On monthly heartworm and flea prevention year-round.', idempotencyKey: key('s') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'objective', body: 'Weight 66.8 lb (30.3 kg), BCS 5/9. T 101.2 °F, HR 88, RR 20. Mild tartar on upper premolars; otherwise unremarkable exam.', idempotencyKey: key('s') }, okafor)
  await addDiagnosis(null, { encounterId: enc.id, term: 'Healthy adult wellness examination', certainty: 'confirmed', idempotencyKey: key('dx') }, okafor)
  await addDiagnosis(null, { encounterId: enc.id, term: 'Dental calculus, mild', certainty: 'confirmed', addToProblems: true, idempotencyKey: key('dx') }, okafor)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'assessment', body: 'Healthy adult dog. Mild dental calculus.', idempotencyKey: key('s') }, okafor)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'plan', body: 'DAPP and rabies given today. Dental cleaning under anaesthesia within 6 to 12 months. Continue prevention. Recheck in one year.', idempotencyKey: key('s') }, okafor)
  await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_dapp', lotId: 'seed_lot_dapp_main', site: 'Right forelimb SC', supervisingDvmId: 'seed_staff_okafor', idempotencyKey: key('vx') }, lopez)
  await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Right hindlimb SC', supervisingDvmId: 'seed_staff_okafor', tagNumber: 'SAC-26-05112', idempotencyKey: key('vx') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'discharge', body: 'Ranger had his yearly vaccines today. Mild soreness at the injection sites for a day is normal; call us for facial swelling, hives or vomiting.', idempotencyKey: key('s') }, okafor)
  await sign(enc.id, okafor)
  step(`wellness visit signed (${enc.id})`)
}

async function limping() {
  const patient = 'seed_pet_015_2' // Ruby, German Shepherd
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'outpatient', reason: 'Limping left fore', attendingDvmId: 'seed_staff_marsh', idempotencyKey: key('enc') }, lopez)
  await recordWeight(null, { patientId: patient, value: '31.6', unit: 'kg', idempotencyKey: key('w') }, lopez)
  await recordVitals(null, { encounterId: enc.id, temperature: '101.8', temperatureUnit: 'F', heartRate: 104, respRate: 28, painScore: 4, idempotencyKey: key('v') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'subjective', body: 'Lame on the left fore for 5 days, worse after rest. No known trauma.', idempotencyKey: key('s') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'objective', body: 'Grade 2/5 lameness left fore. Pain on elbow extension; mild effusion of the left elbow. Right fore normal.', idempotencyKey: key('s') }, marsh)
  await addDiagnosis(null, { encounterId: enc.id, term: 'Elbow osteoarthritis, left', certainty: 'presumptive', addToProblems: true, idempotencyKey: key('dx') }, marsh)
  await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_carprofen', route: 'po', frequency: 'bid', quantity: '28', quantityUnit: 'tablet', dose: { doseAmount: '2.2', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: key('o') }, marsh)
  await placeOrder(null, { encounterId: enc.id, kind: 'imaging', description: 'Radiographs, left elbow, 2 views', idempotencyKey: key('o') }, marsh)
  try {
    await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_carprofen', route: 'po', frequency: 'bid', dose: { doseAmount: '8', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: key('o') }, marsh)
    throw new Error('An above-range dose was accepted.')
  } catch (e) { if ((e as { code?: string }).code !== 'GUARD_FAILED') throw e }
  await saveSoapSection(null, { encounterId: enc.id, kind: 'assessment', body: 'Presumptive left elbow osteoarthritis; rule out fragmented coronoid process.', idempotencyKey: key('s') }, marsh)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'plan', body: 'Carprofen 2.2 mg/kg PO BID for 14 days with food. Radiographs today. Leash walks only. Recheck in 2 weeks.', idempotencyKey: key('s') }, marsh)
  await submitEncounter(null, { encounterId: enc.id, expectedVersion: await version(enc.id), idempotencyKey: key('sub') }, lopez)
  step(`limping visit waiting for signature (${enc.id})`)
}

async function ward() {
  const patient = 'seed_pet_009_1' // Felix, Siamese
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'inpatient_day', reason: 'Vomiting, dehydrated', attendingDvmId: 'seed_staff_marsh', idempotencyKey: key('enc') }, lopez)
  await recordWeight(null, { patientId: patient, value: '4.4', unit: 'kg', idempotencyKey: key('w') }, lopez)
  await recordVitals(null, { encounterId: enc.id, temperature: '102.6', temperatureUnit: 'F', heartRate: 210, respRate: 36, mucousMembranes: 'tacky', crtSeconds: '2.5', idempotencyKey: key('v') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'subjective', body: 'Vomiting 6 times since last night, not eating. Indoor only. No toxin exposure known.', idempotencyKey: key('s') }, lopez)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'objective', body: 'Estimated 7 % dehydrated. Mild cranial abdominal discomfort; no palpable foreign body.', idempotencyKey: key('s') }, marsh)
  const stay = await admitPatient(null, { encounterId: enc.id, cageId: 'seed_cage_cw02', codeStatus: 'full', reason: 'IV fluids and anti-emetics', idempotencyKey: key('adm') }, lopez)
  await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_maropitant', route: 'iv', frequency: 'q24h', dose: { doseAmount: '1', doseUnit: 'mg', dosePer: 'kg' }, sheet: { stayId: stay.id, frequency: 'q24h', durationHours: 72 }, idempotencyKey: key('o') }, marsh)
  await placeOrder(null, { encounterId: enc.id, kind: 'nursing', description: 'TPR, appetite and vomiting check', sheet: { stayId: stay.id, frequency: 'q6h', durationHours: 48 }, idempotencyKey: key('o') }, marsh)
  await placeOrder(null, { encounterId: enc.id, kind: 'nursing', description: 'Offer a bland diet; record intake', sheet: { stayId: stay.id, frequency: 'q8h', durationHours: 48 }, idempotencyKey: key('o') }, marsh)
  const first = await prisma.treatmentTask.findFirstOrThrow({ where: { stayId: stay.id, sheetOrder: { order: { drugId: 'seed_drug_maropitant' } } }, orderBy: { dueAt: 'asc' } })
  await completeTreatmentTask(null, { taskId: first.id, expectedVersion: first.version, lotId: 'seed_lot_maropitant_main', observation: 'Given slowly IV; no reaction', idempotencyKey: key('t') }, lopez)
  step(`cat admitted to CW-02 with a treatment sheet (${stay.id})`)
}

async function surgery() {
  const patient = 'seed_pet_005_1'
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'surgery', reason: 'TPLO right stifle', attendingDvmId: 'seed_staff_marsh', idempotencyKey: key('enc') }, marsh)
  await recordWeight(null, { patientId: patient, value: '22.4', unit: 'kg', idempotencyKey: key('w') }, lopez)
  const an = await openAnaesthesia(null, { encounterId: enc.id, procedure: 'TPLO, right stifle', asaStatus: 'II', fastingConfirmed: true, consentConfirmed: true, anaesthetistId: 'seed_staff_lopez', idempotencyKey: key('an') }, lopez)
  const v = async () => (await prisma.anaesthesiaRecord.findUniqueOrThrow({ where: { id: an.id }, select: { version: true } })).version
  await anaesthesiaEvent(null, { recordId: an.id, event: 'induce', expectedVersion: await v(), idempotencyKey: key('ev') }, lopez)
  await anaesthesiaEvent(null, { recordId: an.id, event: 'intubate', expectedVersion: await v(), idempotencyKey: key('ev') }, lopez)
  const hydro = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_hydromorphone', route: 'iv', frequency: 'once', dose: { doseAmount: '0.05', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: key('o') }, marsh)
  await recordAdministration(null, { orderId: hydro.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', site: 'Left cephalic catheter', witnessId: 'seed_staff_price', wasteQty: '0.04', idempotencyKey: key('ad') }, lopez)
  for (const [hr, rr, spo2, etco2, sbp, map, tempC, agentPct, notes] of [[96, 12, 99, 38, 118, 82, '37.8', '2.0', 'Stable after induction'], [88, 10, 98, 41, 104, 72, '37.4', '2.2', 'Incision'], [84, 10, 98, 43, 96, 64, '37.1', '2.2', 'Osteotomy'], [92, 12, 99, 40, 108, 76, '36.9', '1.8', 'Closing']] as const) {
    await recordMonitoring(null, { recordId: an.id, hr, rr, spo2, etco2, sbp, map, tempC, agentPct, notes, idempotencyKey: key('m') }, lopez)
  }
  await anaesthesiaEvent(null, { recordId: an.id, event: 'extubate', expectedVersion: await v(), idempotencyKey: key('ev') }, lopez)
  await saveSurgeryReport(null, { encounterId: enc.id, procedure: 'Tibial plateau levelling osteotomy (TPLO), right', technique: 'Medial approach; arthrotomy showed a complete cranial cruciate rupture and an intact medial meniscus. 24 mm radial osteotomy, rotated to a 5° plateau angle, 3.5 mm locking plate.', findings: 'Complete cranial cruciate ligament rupture; meniscus intact.', closure: 'Layered closure; intradermal skin.', sutures: '2-0 PDS fascia, 3-0 Monocryl subcutaneous and intradermal', idempotencyKey: key('sr') }, marsh)
  await saveSoapSection(null, { encounterId: enc.id, kind: 'plan', body: 'Recovery in ICU overnight. Pain scores every 4 hours. Strict rest; sling walks. Recheck and radiographs in 8 weeks.', idempotencyKey: key('s') }, marsh)
  step(`TPLO recorded with anaesthesia ${an.ref}`)
}

async function dental() {
  const patient = 'seed_pet_014_1' // Cleo, Maine Coon
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'dental', reason: 'Dental cleaning and assessment', attendingDvmId: 'seed_staff_okafor', idempotencyKey: key('enc') }, lopez)
  await recordWeight(null, { patientId: patient, value: '6.9', unit: 'kg', idempotencyKey: key('w') }, lopez)
  const an = await openAnaesthesia(null, { encounterId: enc.id, procedure: 'Dental cleaning, radiographs and extractions', asaStatus: 'II', fastingConfirmed: true, consentConfirmed: true, anaesthetistId: 'seed_staff_price', idempotencyKey: key('an') }, lopez)
  const r = await prisma.anaesthesiaRecord.findUniqueOrThrow({ where: { id: an.id }, select: { version: true } })
  await anaesthesiaEvent(null, { recordId: an.id, event: 'induce', expectedVersion: r.version, idempotencyKey: key('ev') }, lopez)
  await recordMonitoring(null, { recordId: an.id, hr: 168, rr: 16, spo2: 99, etco2: 36, sbp: 112, map: 78, tempC: '37.6', agentPct: '1.6', notes: 'Stable', idempotencyKey: key('m') }, lopez)
  await saveDentalChart(null, { encounterId: enc.id, teeth: { '307': { findings: ['resorption'], procedures: ['radiograph', 'surgical_extraction'] }, '407': { findings: ['resorption'], procedures: ['radiograph', 'surgical_extraction'] }, '108': { findings: ['calculus', 'gingivitis'], procedures: ['root_planing'] }, '208': { findings: ['calculus'] } }, idempotencyKey: key('dc') }, okafor)
  step(`dental charted (${enc.id})`)
}

async function scribe() {
  const settings = await prisma.practiceSettings.findFirst({ select: { features: true } })
  if (!(settings?.features as Record<string, boolean> | null)?.scribe) {
    const req = await requestPracticeControls(null, { changes: { features: { scribe: true } }, reason: 'Clinical drill: rehearse the scribe on test data', idempotencyKey: key('pc') }, okafor)
    const director = await prisma.user.findFirstOrThrow({ where: { id: { not: 'seed_user_okafor' }, role: { canApprovePolicies: true } }, select: { id: true } })
    await decideApprovalRequest(null, { requestId: req.id, decision: 'approve', expectedVersion: 0, idempotencyKey: key('d') }, as(director.id, ALL))
  }
  const patient = 'seed_pet_013_2' // Luna, Boxer
  const enc = await openEncounter(null, { patientId: patient, locationId: LOC, kind: 'outpatient', reason: 'Itchy ears', attendingDvmId: 'seed_staff_okafor', idempotencyKey: key('enc') }, lopez)
  const s = await startScribeSession(null, { encounterId: enc.id, clientConsent: true, consentMethod: 'verbal_recorded', staffAcknowledged: true, idempotencyKey: key('sc') }, okafor)
  await draftScribeSession(null, { sessionId: s.id, pastedTranscript: [
    'Vet: What brings Luna in today?',
    'Owner: She keeps shaking her head and scratching her right ear, for about a week. It smells.',
    'Vet: Any change in food? Has she been swimming?',
    'Owner: We went to the lake last weekend.',
    'Vet: Her right ear canal is red and swollen with brown discharge; the left ear looks normal. I will take a swab for cytology.',
    'Vet: Cytology shows lots of yeast. This is a yeast ear infection, likely after the swimming.',
    'Vet: We will clean the ear today and send home ear drops twice a day for 10 days, and recheck in two weeks.',
  ].join('\n'), idempotencyKey: key('dr') }, okafor)
  const draft = await prisma.scribeDraft.findFirstOrThrow({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' } })
  await acceptScribeDraft(null, { draftId: draft.id, blocks: [{ index: 0, body: undefined }], idempotencyKey: key('acc') }, okafor)
  step(`scribe draft accepted into the record (${enc.id})`)
}

async function importAvimark() {
  const csv = [
    'Client Number,First Name,Last Name,Email,Address,City,Zip',
    'AV-20114,Rosa,Delgado,rosa.delgado.av@gmail.com,2210 Freeport Blvd,Sacramento,95818',
    'AV-20115,Marcus,Whitfield,m.whitfield.av@outlook.com,88 Riverside Blvd,Sacramento,95818',
    'AV-20116,Priya,Ramaswamy,,415 Laguna Blvd,Elk Grove,95758',
  ].join('\n')
  const p = await previewImport(null, { system: 'avimark', entity: 'clients', locationId: LOC, fileName: 'avimark-clients-2026-11.csv', csv, source: 'manual-csv', idempotencyKey: key('imp') }, marsh)
  const a = await applyImport(null, { batchId: p.id, idempotencyKey: key('app') }, marsh)
  step(`Avimark import: ${a.rowsCreated} created, ${a.rowsFailed} with problems`)
}

async function main() {
  const owner = await prisma.staffMember.findUnique({ where: { id: 'seed_staff_marsh' }, select: { id: true } })
  if (!owner) throw new Error('Seed the practice first (loadClinicSetup).')
  // DRILL_ONLY=scribe,import runs just those steps (e.g. after fixing one).
  const only = new Set((process.env.DRILL_ONLY ?? '').split(',').filter(Boolean))
  if (only.has('render-only')) only.add('none')
  const steps: [string, () => Promise<void>][] = [['wellness', wellness], ['limping', limping], ['ward', ward], ['surgery', surgery], ['dental', dental], ['scribe', scribe], ['import', importAvimark]]
  for (const [name, run] of steps) if (!only.size || only.has(name)) await run()
  // Render the documents the signed records queued (normally the outbox worker does this).
  // Render what the signed records, certificates and discharges queued, the way the worker does.
  const drained = await drainOutbox(prisma as never, { workerId: 'clinical-drill', topics: ['document.render'], handlers: { 'document.render': m => renderDocument(prisma as never, m) } })
  step(`documents rendered: ${JSON.stringify(drained)}`)
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
