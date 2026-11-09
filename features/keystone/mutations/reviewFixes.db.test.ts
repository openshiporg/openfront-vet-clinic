import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { containerBalance } from '../lib/csRegister'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { recordWeight } from './clients'
import { addDiagnosis, openEncounter, recordVitals, requestVoidEncounter, saveSoapSection, signEncounter, submitEncounter } from './record'
import { admitPatient, anaesthesiaEvent, completeTreatmentTask, moveCage, openAnaesthesia, placeOrder, recordAdministration, recordMonitoring, reverseAdministration, runTreatmentSheetJob } from './treatment'
import { runInTransaction } from '../lib/unitOfWork'
import { administerVaccine, recordOutsideVaccine, reverseVaccineAdministration } from './vaccines'
import { applyImport, previewImport } from './imports'
import { prismaToDomain } from './op'

/**
 * Phase 2 review fixes (B1–B5, M2–M5, M7) against the scratch Postgres `vitest` schema: each finding
 * is reproduced the way the reviewer did it and must now be refused, by the application and, where
 * REVIEW.md asked for it, by the database on its own.
 */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const RVT = ['canAccessDashboard', 'canReadClinical', 'canWriteRecord', 'canOrder', 'canAdminister', 'canAdministerControlled', 'canWitnessControlled', 'canCheckIn', 'canManagePatients', 'canReadClientPII']
const pg = (e: unknown) => String((e as Error)?.message ?? e)
const DOG = 'seed_pet_005_1'

describe.skipIf(!hasTestDatabase)('Phase 2 review fixes (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }
  let okafor: { session: unknown; prisma: PrismaClient }
  let lopez: { session: unknown; prisma: PrismaClient }
  let reed: { session: unknown; prisma: PrismaClient }

  beforeAll(async () => {
    prisma = testPrisma(10)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    marsh = { session: sessionFor('seed_user_marsh', ALL), prisma }
    okafor = { session: sessionFor('seed_user_okafor', ALL), prisma }
    lopez = { session: sessionFor('seed_user_lopez', RVT), prisma }
    reed = { session: sessionFor('seed_user_reed', [...RVT]), prisma }
    await recordWeight(null, { patientId: DOG, value: '49.4', unit: 'lb', idempotencyKey: uniqueKey('w') }, lopez)
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const encounter = (kind: string, reason: string, patientId = DOG) => openEncounter(null, { patientId, locationId: 'seed_loc_main', kind, reason, attendingDvmId: 'seed_staff_okafor', idempotencyKey: uniqueKey('enc') }, okafor)

  it('B1: meloxicam 2000 mcg/kg is converted to 2 mg/kg and refused; mcg in range passes', async () => {
    const enc = await encounter('outpatient', 'Post-op pain relief')
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '2000', doseUnit: 'mcg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '0.2', doseUnit: 'mg', dosePer: 'lb' as never }, idempotencyKey: uniqueKey('o') }, okafor)).rejects.toBeTruthy()
    const ok = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '150', doseUnit: 'mcg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, okafor)
    expect(ok.id).toBeTruthy()
  }, 120_000)

  it('B2: a CSR cannot witness; the witness is on the register entry; the database refuses a waste without one', async () => {
    const enc = await encounter('surgery', 'Laceration repair, left forelimb')
    const order = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_hydromorphone', route: 'iv', frequency: 'once', dose: { doseAmount: '0.05', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, okafor)
    await expect(recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', witnessId: 'seed_staff_reed', idempotencyKey: uniqueKey('ad') }, lopez)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', witnessId: 'seed_staff_lopez', idempotencyKey: uniqueKey('ad') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const given = await recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', witnessId: 'seed_staff_okafor', wasteQty: '0.04', idempotencyKey: uniqueKey('ad') }, lopez)
    const entries = await prisma.csLogEntry.findMany({ where: { id: { in: [given.csLogEntryId!, given.wasteLogEntryId!] } }, select: { witnessId: true } })
    expect(entries.map(e => e.witnessId)).toEqual(['seed_staff_okafor', 'seed_staff_okafor'])
    // The database on its own: a waste with no witness, and a witness who is the actor.
    const last = await prisma.csLogEntry.findFirstOrThrow({ where: { containerId: 'seed_csc_hydromorphone_1' }, orderBy: { recordedAt: 'desc' } })
    const raw = (witness: string | null) => prisma.$executeRawUnsafe(`INSERT INTO "CsLogEntry" (id, ref, "ciiRef", container, schedule, type, "qtySigned", unit, "occurredAt", "recordedAt", actor, witness, reason, "prevHash", hash) VALUES ($1, $2, $3, 'seed_csc_hydromorphone_1', 'CII', 'waste', -0.01, 'mL', now(), now(), 'seed_staff_lopez', $4, 'Spill', $5, $5)`, uniqueKey('cs'), `CS-2026-9${Date.now() % 100000}`, `CII-2026-9${Date.now() % 100000}`, witness, last.hash)
    await expect(raw(null)).rejects.toSatisfy(e => /CsLogEntry_witness_required/.test(pg(e)))
    await expect(raw('seed_staff_lopez')).rejects.toSatisfy(e => /CsLogEntry_witness_not_actor/.test(pg(e)))
    void reed
  }, 120_000)

  it('B3: a second q24h maropitant dose in a row is refused, by the application and by the database', async () => {
    const enc = await encounter('inpatient_day', 'Vomiting, hospitalised for fluids')
    const stay = await admitPatient(null, { encounterId: enc.id, cageId: 'seed_cage_mw03', codeStatus: 'full', reason: 'IV fluids', idempotencyKey: uniqueKey('adm') }, lopez)
    await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_maropitant', route: 'iv', frequency: 'q24h', dose: { doseAmount: '1', doseUnit: 'mg', dosePer: 'kg' }, sheet: { stayId: stay.id, frequency: 'Q24H', durationHours: 72 }, idempotencyKey: uniqueKey('o') }, okafor)
    const tasks = await prisma.treatmentTask.findMany({ where: { stayId: stay.id }, orderBy: { dueAt: 'asc' } })
    expect(tasks.length).toBeGreaterThanOrEqual(1)
    await completeTreatmentTask(null, { taskId: tasks[0].id, expectedVersion: tasks[0].version, lotId: 'seed_lot_maropitant_main', idempotencyKey: uniqueKey('t') }, lopez)
    // Make the next day's task exist now (the job materialises 24 h ahead) and try to give it straight away.
    const next = tasks[1] ?? (await prisma.treatmentTask.create({ data: { sheetOrderId: tasks[0].sheetOrderId, stayId: stay.id, patientId: DOG, dueAt: new Date(tasks[0].dueAt.getTime() + 86_400_000), status: 'scheduled' } }))
    await expect(completeTreatmentTask(null, { taskId: next.id, expectedVersion: next.version, lotId: 'seed_lot_maropitant_main', idempotencyKey: uniqueKey('t') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(completeTreatmentTask(null, { taskId: next.id, expectedVersion: next.version, lotId: 'seed_lot_maropitant_main', earlyReason: 'Discharging early, owner collecting at noon', idempotencyKey: uniqueKey('t') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'too_soon' } })
    await expect(prisma.treatmentTask.update({ where: { id: next.id }, data: { status: 'done', doneAt: new Date(), doneById: 'seed_staff_lopez' } })).rejects.toSatisfy(e => /already given/.test(pg(e)))
    // M7: the occupied cage is refused by the application with a readable message.
    const other = await encounter('inpatient_day', 'Observation after sedation', 'seed_pet_006_1')
    await expect(admitPatient(null, { encounterId: other.id, cageId: 'seed_cage_mw03', codeStatus: 'full', idempotencyKey: uniqueKey('adm') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'cage_occupied' } })
    void moveCage
  }, 120_000)

  it('B4: extubation needs intubation; event times are never overwritten; °F typed as °C is refused', async () => {
    const enc = await encounter('dental', 'Dental cleaning and extractions')
    const an = await openAnaesthesia(null, { encounterId: enc.id, procedure: 'Dental cleaning', asaStatus: 'II', fastingConfirmed: true, consentConfirmed: true, anaesthetistId: 'seed_staff_lopez', idempotencyKey: uniqueKey('an') }, lopez)
    const v = async () => (await prisma.anaesthesiaRecord.findUniqueOrThrow({ where: { id: an.id }, select: { version: true } })).version
    await anaesthesiaEvent(null, { recordId: an.id, event: 'induce', expectedVersion: await v(), idempotencyKey: uniqueKey('ev') }, lopez)
    await expect(anaesthesiaEvent(null, { recordId: an.id, event: 'extubate', expectedVersion: await v(), idempotencyKey: uniqueKey('ev') }, lopez)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    await expect(anaesthesiaEvent(null, { recordId: an.id, event: 'induce', expectedVersion: await v(), idempotencyKey: uniqueKey('ev') }, lopez)).rejects.toBeTruthy()
    await expect(prisma.anaesthesiaRecord.update({ where: { id: an.id }, data: { extubatedAt: new Date() } })).rejects.toSatisfy(e => /AnaesthesiaRecord_event_order/.test(pg(e)))
    await expect(prisma.anaesthesiaRecord.update({ where: { id: an.id }, data: { inductionAt: new Date() } })).rejects.toSatisfy(e => /never overwritten/.test(pg(e)))
    await expect(recordMonitoring(null, { recordId: an.id, tempC: '101.2', idempotencyKey: uniqueKey('m') }, lopez)).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'tempC' } })
    await expect(prisma.monitoringReading.create({ data: { recordId: an.id, at: new Date(), tempC: '60' } })).rejects.toSatisfy(e => /MonitoringReading_temp_c/.test(pg(e)))
    // M7: out-of-range vitals are refused with a readable message, not a database error.
    await expect(recordVitals(null, { encounterId: enc.id, temperature: '150', temperatureUnit: 'F', idempotencyKey: uniqueKey('v') }, lopez)).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'temperature' } })
    await expect(recordVitals(null, { encounterId: enc.id, temperature: '101', temperatureUnit: 'X' as never, idempotencyKey: uniqueKey('v') }, lopez)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  }, 120_000)

  it('M2: once signed, the database refuses changes to diagnoses, findings, vitals, dental charts, reports and new sections', async () => {
    const enc = await encounter('outpatient', 'Ear scratching for a week')
    await recordVitals(null, { encounterId: enc.id, temperature: '101.8', temperatureUnit: 'F', heartRate: 104, idempotencyKey: uniqueKey('v') }, lopez)
    await saveSoapSection(null, { encounterId: enc.id, kind: 'subjective', body: 'Scratching both ears for a week; head shaking.', idempotencyKey: uniqueKey('s') }, okafor)
    await saveSoapSection(null, { encounterId: enc.id, kind: 'objective', body: 'Erythema and brown discharge both ear canals; tympanic membranes intact.', idempotencyKey: uniqueKey('s') }, okafor)
    await saveSoapSection(null, { encounterId: enc.id, kind: 'assessment', body: 'Bilateral otitis externa, yeast on cytology.', idempotencyKey: uniqueKey('s') }, okafor)
    await saveSoapSection(null, { encounterId: enc.id, kind: 'plan', body: 'Clean and medicate both ears daily for 14 days; recheck in two weeks.', idempotencyKey: uniqueKey('s') }, okafor)
    await addDiagnosis(null, { encounterId: enc.id, term: 'Otitis externa, bilateral', certainty: 'confirmed', idempotencyKey: uniqueKey('dx') }, okafor)
    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } })
    const sub = await submitEncounter(null, { encounterId: enc.id, expectedVersion: row.version, idempotencyKey: uniqueKey('sub') }, okafor)
    await signEncounter(null, { encounterId: enc.id, expectedVersion: Number(sub.version), idempotencyKey: uniqueKey('sig') }, okafor)
    const frozen = (e: unknown) => /is signed; this entry cannot change/.test(pg(e))
    await expect(prisma.diagnosis.updateMany({ where: { encounterId: enc.id }, data: { term: 'Changed' } })).rejects.toSatisfy(frozen)
    await expect(prisma.diagnosis.deleteMany({ where: { encounterId: enc.id } })).rejects.toSatisfy(frozen)
    await expect(prisma.diagnosis.create({ data: { encounterId: enc.id, patientId: DOG, term: 'Added later', certainty: 'presumptive' } })).rejects.toSatisfy(frozen)
    await expect(prisma.vitalsObservation.create({ data: { encounterId: enc.id, patientId: DOG, heartRate: 90, temperatureUnit: 'F', at: new Date() } })).rejects.toSatisfy(frozen)
    await expect(prisma.dentalChart.create({ data: { encounterId: enc.id, patientId: DOG, teeth: {} } })).rejects.toSatisfy(frozen)
    await expect(prisma.physicalExamFinding.create({ data: { encounterId: enc.id, system: 'ears', status: 'abnormal', text: 'added' } })).rejects.toSatisfy(frozen)
    await expect(prisma.soapSection.create({ data: { encounterId: enc.id, kind: 'plan', ordinal: 1, body: 'added after signing', source: 'typed' } })).rejects.toSatisfy(frozen)
    // M7: the mapper turns the raised message into a readable GUARD_FAILED.
    const err = await prisma.diagnosis.deleteMany({ where: { encounterId: enc.id } }).catch(e => e)
    expect(prismaToDomain(err)).toMatchObject({ code: 'GUARD_FAILED' })
  }, 120_000)

  it('M3: a same-day second rabies dose is refused and never counts as a booster; tags are unique', async () => {
    const enc = await encounter('outpatient', 'Annual wellness and vaccines', 'seed_pet_025_2')
    const first = await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Right hindlimb SC', tagNumber: '26-118804', idempotencyKey: uniqueKey('vx') }, okafor)
    expect(first.durationMonths).toBe(12)
    await expect(administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Left hindlimb SC', tagNumber: '26-118805', idempotencyKey: uniqueKey('vx') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'repeat_same_day' } })
    const cert = await prisma.rabiesCertificate.findFirstOrThrow({ where: { patientId: 'seed_pet_025_2' } })
    await expect(prisma.rabiesCertificate.create({ data: { ref: 'RAB-2026-990001', patientId: DOG, vaccinatedOn: new Date(), durationMonths: 12, nextDueOn: new Date(Date.now() + 365 * 86_400_000), tagNumber: '26-118804', tagJurisdiction: cert.tagJurisdiction, reportedTo: 'none' } })).rejects.toSatisfy(e => /RabiesCertificate_tag_unique|Unique constraint/i.test(pg(e)))
    // The document worker links the rendered PDF to the certificate (the signed-record trigger must allow it).
    await prisma.rabiesCertificate.update({ where: { id: cert.id }, data: { updatedAt: new Date() } })
    await expect(prisma.rabiesCertificate.update({ where: { id: cert.id }, data: { voidedAt: new Date() } })).rejects.toSatisfy(e => /RabiesCertificate_void_reason/.test(pg(e)))
    const va = await prisma.vaccineAdministration.findUniqueOrThrow({ where: { id: first.id } })
    await expect(prisma.vaccineAdministration.create({ data: { ...va, id: undefined, createdAt: undefined, certificateId: null, reason: '', reversesId: null, policyVersions: [] } as never })).rejects.toSatisfy(e => /already given to the patient that day/.test(pg(e)))
  }, 120_000)

  it('M4: an older outside vaccine never satisfies or replaces a newer reminder', async () => {
    const enc = await encounter('outpatient', 'Rabies booster', 'seed_pet_003_1')
    const given = await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Right hindlimb SC', idempotencyKey: uniqueKey('vx') }, okafor)
    const out = await recordOutsideVaccine(null, { patientId: 'seed_pet_003_1', productId: 'seed_vx_rabies3_k9', administeredOn: '2024-03-02', lotNumber: 'RB-22018', evidenceNote: 'Certificate from Sunrise Animal Clinic', idempotencyKey: uniqueKey('out') }, okafor)
    expect(out).toMatchObject({ satisfied: 0, superseded: true })
    const open = await prisma.patientReminder.findMany({ where: { patientId: 'seed_pet_003_1', typeId: 'seed_rt_rabies', status: { not: 'satisfied' } }, select: { dueOn: true } })
    expect(open.map(r => r.dueOn.toISOString().slice(0, 10))).toEqual([given.dueNextOn])
  }, 120_000)

  it('M5: a veterinarian reverses doses and vaccines with a reason; then the record can be voided', async () => {
    const dog = await prisma.patient.findFirstOrThrow({ where: { status: 'active', species: { code: 'canine' }, id: { notIn: [DOG, 'seed_pet_025_2', 'seed_pet_003_1'] }, alerts: { none: {} } }, select: { id: true } })
    const enc = await encounter('outpatient', 'Opened on the wrong patient', dog.id)
    const order = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_ketamine', route: 'iv', frequency: 'once', dose: { doseAmount: '2', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, okafor)
    const before = await prisma.$transaction(tx => containerBalance(tx as never, 'seed_csc_ketamine_1'))
    const given = await recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_ketamine_1', route: 'iv', witnessId: 'seed_staff_okafor', idempotencyKey: uniqueKey('ad') }, lopez)
    const vx = await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_dapp', lotId: 'seed_lot_dapp_main', site: 'Right forelimb SC', idempotencyKey: uniqueKey('vx') }, okafor)
    await expect(reverseAdministration(null, { administrationId: given.id, reason: 'Wrong patient selected', idempotencyKey: uniqueKey('rv') }, lopez)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(reverseAdministration(null, { administrationId: given.id, reason: 'oops', idempotencyKey: uniqueKey('rv') }, okafor)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const rev = await reverseAdministration(null, { administrationId: given.id, reason: 'Wrong patient selected', witnessId: 'seed_staff_lopez', idempotencyKey: uniqueKey('rv') }, okafor)
    expect(rev.orderStatus).toBe('reversed')
    const after = await prisma.$transaction(tx => containerBalance(tx as never, 'seed_csc_ketamine_1'))
    expect(after.toString()).toBe(before.toString())
    const contra = await prisma.csLogEntry.findUniqueOrThrow({ where: { id: rev.contraCsLogEntryId! } })
    expect(contra.reversesId).toBe(given.csLogEntryId)
    await expect(reverseAdministration(null, { administrationId: given.id, reason: 'Wrong patient selected', idempotencyKey: uniqueKey('rv') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await reverseVaccineAdministration(null, { vaccineAdministrationId: vx.id, reason: 'Recorded on the wrong patient', idempotencyKey: uniqueKey('rvv') }, okafor)
    const asked = await requestVoidEncounter(null, { encounterId: enc.id, reason: 'Opened on the wrong patient', idempotencyKey: uniqueKey('void') }, okafor)
    expect(asked.approvalRequestId).toBeTruthy()
  }, 120_000)

  it('B5: dogs, cats, weights, vaccines and history import against the seeded species', async () => {
    const run = async (entity: 'clients' | 'patients' | 'weights' | 'vaccinations' | 'consults', csv: string) => {
      const preview = await previewImport(null, { system: 'avimark', entity, locationId: 'seed_loc_main', fileName: `${entity}.csv`, csv, idempotencyKey: uniqueKey('p') }, marsh)
      return applyImport(null, { batchId: preview.id, idempotencyKey: uniqueKey('a') }, marsh)
    }
    await run('clients', 'Client Number,First Name,Last Name,Email\nAV-3101,Helen,Ortiz,helen.ortiz.av@gmail.com\n')
    const pets = await run('patients', 'Patient Number,Client Number,Name,Species,Breed,Sex\nAP-5101,AV-3101,Biscuit,Dog,Labrador Retriever,male\nAP-5102,AV-3101,Mochi,Cat,Domestic Shorthair,female\nAP-5103,AV-3101,Pepper,Canine,,female\n')
    expect(pets.rowsCreated).toBe(3)
    const ids = (await prisma.externalId.findMany({ where: { system: 'avimark:patients', value: { in: ['AP-5101', 'AP-5102', 'AP-5103'] } }, select: { recordId: true } })).map(e => e.recordId)
    const species = await prisma.patient.findMany({ where: { id: { in: ids } }, select: { name: true, species: { select: { code: true } } }, orderBy: { name: 'asc' } })
    expect(species.map(p => `${p.name}:${p.species?.code}`)).toEqual(['Biscuit:canine', 'Mochi:feline', 'Pepper:canine'])
    expect((await run('weights', 'Patient Number,Date,Weight,Unit\nAP-5101,2026-06-02,31.2,kg\nAP-5102,2026-06-02,9.1,lb\n')).rowsCreated).toBe(2)
    expect((await run('vaccinations', 'Patient Number,Vaccine,Date Given,Due Date\nAP-5101,Rabies,2025-06-02,2026-06-02\n')).rowsCreated).toBe(1)
    expect((await run('consults', 'Medical History ID,Patient Number,Date,Vet,Notes\nMH-9001,AP-5101,2025-06-02,Dr. Alvarez,Annual exam; mild tartar.\n')).rowsCreated).toBe(1)
  }, 180_000)
  it('N1: an amount far from the order is refused; a veterinarian may give it with a reason; the database agrees', async () => {
    const enc = await encounter('outpatient', 'Lameness, right hind')
    const order = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '0.1', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, okafor)
    await expect(recordAdministration(null, { orderId: order.id, lotId: 'seed_lot_meloxicam_main', route: 'sc', qty: '50', idempotencyKey: uniqueKey('ad') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'qty_outside_order' } })
    await expect(recordAdministration(null, { orderId: order.id, lotId: 'seed_lot_meloxicam_main', route: 'sc', qty: '50', idempotencyKey: uniqueKey('ad') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    // The database refuses it on its own, even bypassing the application.
    await expect(prisma.administration.create({ data: { orderId: order.id, qty: '50', unit: 'mL', givenAt: new Date(), givenById: 'seed_staff_lopez', route: 'sc', lotNumber: 'X' } as never })).rejects.toSatisfy(e => /outside the ordered/.test(pg(e)))
    const ok = await recordAdministration(null, { orderId: order.id, lotId: 'seed_lot_meloxicam_main', route: 'sc', idempotencyKey: uniqueKey('ad') }, lopez)
    expect(ok.id).toBeTruthy()
  }, 120_000)

  it('N2: per-m² doses outside the range are refused; a manual quantity outside the range is refused whatever the reason', async () => {
    const enc = await encounter('outpatient', 'Arthritis flare')
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '2', doseUnit: 'mg', dosePer: 'm2', overrideReason: 'Clinician judgement here' }, idempotencyKey: uniqueKey('o') }, okafor)).resolves.toBeTruthy()
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '2', doseUnit: 'mg', dosePer: 'm2' }, idempotencyKey: uniqueKey('o') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '20', doseUnit: 'mg', dosePer: 'm2' }, idempotencyKey: uniqueKey('o') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_meloxicam', route: 'sc', frequency: 'once', dose: { doseAmount: '0.15', doseUnit: 'mg', dosePer: 'kg', manualOverrideQty: '20', overrideReason: 'Clinician chose a larger volume' }, idempotencyKey: uniqueKey('o') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED', details: { reason: 'dose_refused' } })
  }, 120_000)

  it('N3: the legacy rules are validated, and a new row still cannot break them or be backdated into the legacy period', async () => {
    const rows = await prisma.$queryRawUnsafe<{ conname: string; convalidated: boolean }[]>(`SELECT conname::text, convalidated FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND conname IN ('CsLogEntry_witness_required', 'AnaesthesiaRecord_event_order', 'MonitoringReading_temp_c') ORDER BY 1`)
    expect(rows).toEqual([{ conname: 'AnaesthesiaRecord_event_order', convalidated: true }, { conname: 'CsLogEntry_witness_required', convalidated: true }, { conname: 'MonitoringReading_temp_c', convalidated: true }])
    const an = await prisma.anaesthesiaRecord.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
    await expect(prisma.monitoringReading.create({ data: { recordId: an.id, at: new Date('2026-11-01T00:00:00Z'), tempC: '60' } })).rejects.toSatisfy(e => /dated before/.test(pg(e)))
  }, 120_000)

  it('M1: the sheet job moves an undone dose to missed; a missed dose is not given late', async () => {
    const enc = await encounter('inpatient_day', 'Hospitalised for observation', 'seed_pet_007_1')
    const stay = await admitPatient(null, { encounterId: enc.id, cageId: 'seed_cage_mw04', codeStatus: 'full', idempotencyKey: uniqueKey('adm') }, lopez)
    await placeOrder(null, { encounterId: enc.id, kind: 'treatment', description: 'Check incision', route: 'other', frequency: 'q6h', sheet: { stayId: stay.id, frequency: 'Q6H', durationHours: 24 }, idempotencyKey: uniqueKey('o') }, okafor)
    const first = await prisma.treatmentTask.findFirstOrThrow({ where: { stayId: stay.id }, orderBy: { dueAt: 'asc' } })
    const r = await runInTransaction(prisma as never, uow => runTreatmentSheetJob(uow), { now: new Date(first.dueAt.getTime() + 4 * 3_600_000) })
    expect(r.missed).toBeGreaterThanOrEqual(1)
    const missed = await prisma.treatmentTask.findUniqueOrThrow({ where: { id: first.id } })
    expect(missed.status).toBe('missed')
    await expect(completeTreatmentTask(null, { taskId: missed.id, expectedVersion: missed.version, idempotencyKey: uniqueKey('t') }, lopez)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    await expect(prisma.treatmentTask.update({ where: { id: missed.id }, data: { status: 'done', doneAt: new Date(), doneById: 'seed_staff_lopez' } })).rejects.toSatisfy(e => /not given late/.test(pg(e)))
  }, 120_000)
})
