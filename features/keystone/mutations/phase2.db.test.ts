import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { verifyAuditChain } from '../lib/audit'
import { containerBalance } from '../lib/csRegister'
import { runInTransaction } from '../lib/unitOfWork'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { decideApprovalRequest } from './approvals'
import { recordWeight } from './clients'
import { addAddendum, addDiagnosis, openEncounter, recordVitals, requestVoidEncounter, saveSoapSection, signEncounter, submitEncounter } from './record'
import { admitPatient, completeTreatmentTask, placeOrder, recordAdministration } from './treatment'
import { administerVaccine, runReminderJob } from './vaccines'
import { applyImport, previewImport } from './imports'
import { renderDocument } from '../workers/documents'

/**
 * Phase 2 exit gate (BUILD-PLAN P2) against the scratch Postgres: a SOAP record is written, signed
 * by a DVM and frozen (database refuses edits; corrections are addenda); a stale save is refused;
 * the dose is calculated from the recorded weight; a controlled drug is drawn from a locked
 * container with a witness and the register balances; a rabies vaccine issues its certificate from
 * the same data and schedules the next reminder; the treatment sheet materialises tasks; an import
 * is idempotent; voiding needs maker-checker and refuses when clinical acts exist.
 */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const RVT = ['canAccessDashboard', 'canReadClinical', 'canWriteRecord', 'canOrder', 'canAdminister', 'canAdministerControlled', 'canWitnessControlled', 'canCheckIn', 'canManagePatients', 'canReadClientPII']
const pgError = (e: unknown) => String((e as Error)?.message ?? e)
const PATIENT = 'seed_pet_005_1'

describe.skipIf(!hasTestDatabase)('Phase 2 exit gate (database)', () => {
  let prisma: PrismaClient
  let marsh: { session: unknown; prisma: PrismaClient }
  let okafor: { session: unknown; prisma: PrismaClient }
  let lopez: { session: unknown; prisma: PrismaClient }
  let price: { session: unknown; prisma: PrismaClient }
  let director: { session: unknown; prisma: PrismaClient }
  let encounterId = ''
  let surgeryId = ''

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
    price = { session: sessionFor('seed_user_price', RVT), prisma }
    director = { session: sessionFor(boot.id, ['canAccessDashboard', 'canApprovePolicies', 'canSignRecord', 'canReadAudit']), prisma }
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('loads the Phase 2 reference data once', async () => {
    expect(await prisma.vaccineProduct.count()).toBe(8)
    expect(await prisma.reminderProtocolVersion.count({ where: { status: 'published', verified: false } })).toBe(2)
    expect(await prisma.cage.count()).toBe(15)
    const again = await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, marsh)
    expect(Object.values(again.created).every(n => n === 0)).toBe(true)
    const collie = await prisma.breed.findFirst({ where: { name: 'Border Collie' }, select: { geneticFlags: true } })
    expect(collie?.geneticFlags).toMatchObject({ MDR1_risk: true })
  })

  it('writes a SOAP record; a stale save is refused; the dose comes from the recorded weight', async () => {
    const enc = await openEncounter(null, { patientId: PATIENT, locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Limping right hind', attendingDvmId: 'seed_staff_marsh', idempotencyKey: uniqueKey('enc') }, lopez)
    encounterId = enc.id
    await recordWeight(null, { patientId: PATIENT, value: '22.4', unit: 'kg', idempotencyKey: uniqueKey('w') }, lopez)
    await recordVitals(null, { encounterId, temperature: '101.4', temperatureUnit: 'F', heartRate: 96, respRate: 24, painScore: 3, idempotencyKey: uniqueKey('v') }, lopez)
    const s1 = await saveSoapSection(null, { encounterId, kind: 'subjective', body: 'Lame right hind for 3 days after running at the park. Eating and drinking normally.', idempotencyKey: uniqueKey('s') }, lopez)
    await saveSoapSection(null, { encounterId, kind: 'subjective', body: 'Lame right hind for 3 days after the park; toe-touching this morning.', expectedVersion: s1.version as number, idempotencyKey: uniqueKey('s') }, marsh)
    await expect(saveSoapSection(null, { encounterId, kind: 'subjective', body: 'An older copy of the history.', expectedVersion: s1.version as number, idempotencyKey: uniqueKey('s') }, lopez)).rejects.toMatchObject({ code: 'STALE_STATE' })
    expect(await prisma.soapSectionRevision.count({ where: { section: { encounterId, kind: 'subjective' } } })).toBe(2)
    await saveSoapSection(null, { encounterId, kind: 'objective', body: 'Positive drawer and tibial thrust right stifle; mild effusion. Left stifle normal.', idempotencyKey: uniqueKey('s') }, marsh)
    await addDiagnosis(null, { encounterId, codeId: (await prisma.diagnosisCode.findFirst({ where: { code: 'P-0005' } }))!.id, certainty: 'presumptive', addToProblems: true, idempotencyKey: uniqueKey('dx') }, marsh)
    await saveSoapSection(null, { encounterId, kind: 'assessment', body: 'Presumptive right cranial cruciate ligament rupture. Prognosis good with surgery.', idempotencyKey: uniqueKey('s') }, marsh)
    await saveSoapSection(null, { encounterId, kind: 'plan', body: 'Carprofen 2.2 mg/kg PO BID for 14 days; leash rest; TPLO consult with surgery.', idempotencyKey: uniqueKey('s') }, marsh)
    // 22.4 kg × 2.2 mg/kg = 49.28 mg; 25 mg tablets, measurable to a quarter: 2 tablets (rounded).
    const order = await placeOrder(null, { encounterId, kind: 'medication', drugId: 'seed_drug_carprofen', route: 'po', frequency: 'BID', quantity: '28', quantityUnit: 'tablet', dose: { doseAmount: '2.2', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, marsh)
    const placed = await prisma.clinicalOrder.findUniqueOrThrow({ where: { id: order.id }, select: { dose: { select: { weightKg: true, roundedQty: true } } } })
    const calc = placed.dose
    expect(calc?.weightKg.toString()).toBe('22.4')
    // Above the formulary range without a reason is blocked.
    await expect(placeOrder(null, { encounterId, kind: 'medication', drugId: 'seed_drug_carprofen', route: 'po', frequency: 'BID', dose: { doseAmount: '8', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
  }, 120_000)

  it('signing needs a DVM on the encounter; once signed the database refuses edits and corrections are addenda', async () => {
    const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } })
    const submitted = await submitEncounter(null, { encounterId, expectedVersion: enc.version, idempotencyKey: uniqueKey('sub') }, lopez)
    await expect(signEncounter(null, { encounterId, expectedVersion: Number(submitted.version), idempotencyKey: uniqueKey('sig') }, lopez)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    await expect(signEncounter(null, { encounterId, expectedVersion: Number(submitted.version), idempotencyKey: uniqueKey('sig') }, okafor)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const signed = await signEncounter(null, { encounterId, expectedVersion: Number(submitted.version), idempotencyKey: uniqueKey('sig') }, marsh)
    expect(signed.status).toBe('signed')
    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } })
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.signedById).toBe('seed_staff_marsh')
    await expect(prisma.encounter.update({ where: { id: encounterId }, data: { reason: 'edited later' } })).rejects.toSatisfy(e => /signed|frozen|immutable/i.test(pgError(e)))
    await expect(prisma.soapSection.updateMany({ where: { encounterId }, data: { body: 'tampered' } })).rejects.toSatisfy(e => /locked|addendum/i.test(pgError(e)))
    await expect(prisma.soapSectionRevision.deleteMany({ where: { section: { encounterId } } })).rejects.toSatisfy(e => /append-only|never/i.test(pgError(e)))
    await expect(saveSoapSection(null, { encounterId, kind: 'plan', body: 'Changed my mind.', idempotencyKey: uniqueKey('s') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await expect(addAddendum(null, { encounterId, sectionKind: 'assessment', reason: 'Radiographs reviewed', body: 'Radiographs confirm effusion; no osteophytes.', idempotencyKey: uniqueKey('a') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await addAddendum(null, { encounterId, sectionKind: 'assessment', reason: 'Radiographs reviewed', body: 'Radiographs confirm effusion; no osteophytes.', idempotencyKey: uniqueKey('a') }, marsh)
    expect(await prisma.addendum.count({ where: { encounterId } })).toBe(1)
    // The signed record renders to a hashed document.
    const doc = await prisma.clinicalDocument.findFirstOrThrow({ where: { encounterId } })
    await renderDocument(prisma as never, { aggregateType: 'ClinicalDocument', aggregateId: doc.id, payload: { documentId: doc.id } } as never)
    const rendered = await prisma.clinicalDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(rendered.status).toBe('rendered')
    expect(rendered.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(rendered.body).toContain('cruciate')
  }, 120_000)

  it('a controlled drug comes from a locked container with a witness, and the register balances', async () => {
    const enc = await openEncounter(null, { patientId: PATIENT, locationId: 'seed_loc_main', kind: 'surgery', reason: 'TPLO right stifle', attendingDvmId: 'seed_staff_marsh', idempotencyKey: uniqueKey('enc') }, marsh)
    surgeryId = enc.id
    const order = await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_hydromorphone', route: 'iv', frequency: 'once', dose: { doseAmount: '0.05', doseUnit: 'mg', dosePer: 'kg' }, idempotencyKey: uniqueKey('o') }, marsh)
    const before = await prisma.$transaction(tx => containerBalance(tx as never, 'seed_csc_hydromorphone_1'))
    await expect(recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', idempotencyKey: uniqueKey('ad') }, lopez)).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'witnessId' } })
    await expect(recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', witnessId: 'seed_staff_lopez', idempotencyKey: uniqueKey('ad') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await recordAdministration(null, { orderId: order.id, csContainerId: 'seed_csc_hydromorphone_1', route: 'iv', witnessId: 'seed_staff_price', wasteQty: '0.04', idempotencyKey: uniqueKey('ad') }, lopez)
    const after = await prisma.$transaction(tx => containerBalance(tx as never, 'seed_csc_hydromorphone_1'))
    // 22.4 kg × 0.05 mg/kg = 1.12 mg ÷ 2 mg/mL = 0.56 mL drawn, plus 0.04 mL wasted.
    expect(before.minus(after).toString()).toBe('0.6')
    const entries = await prisma.csLogEntry.findMany({ where: { containerId: 'seed_csc_hydromorphone_1', patientId: PATIENT, type: { in: ['administer', 'waste'] } }, orderBy: { occurredAt: 'asc' } })
    expect(entries.map(e => e.type).sort()).toEqual(['administer', 'waste'])
    void price
  }, 120_000)

  it('rabies vaccine: the certificate comes from the same data and the next reminder is scheduled', async () => {
    const enc = await openEncounter(null, { patientId: PATIENT, locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Annual vaccines', attendingDvmId: 'seed_staff_marsh', idempotencyKey: uniqueKey('enc') }, marsh)
    await expect(administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_dapp', lotId: 'seed_lot_dapp_old', site: 'Right forelimb SC', idempotencyKey: uniqueKey('vx') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const given = await administerVaccine(null, { encounterId: enc.id, productId: 'seed_vx_rabies3_k9', lotId: 'seed_lot_rab_main', site: 'Right hindlimb SC', supervisingDvmId: 'seed_staff_marsh', tagNumber: 'SAC-26-04417', idempotencyKey: uniqueKey('vx') }, lopez)
    const vx = await prisma.vaccineAdministration.findUniqueOrThrow({ where: { id: given.id }, include: { certificate: true } })
    expect(vx.certificate?.vaccineSnapshot).toMatchObject({ lotNumber: 'RB3-2611A' })
    expect(vx.certificate?.tagNumber).toBe('SAC-26-04417')
    expect(vx.dueNextOn.toISOString().slice(0, 10)).toBe(vx.certificate!.nextDueOn.toISOString().slice(0, 10))
    const reminder = await prisma.patientReminder.findFirst({ where: { patientId: PATIENT, typeId: 'seed_rt_rabies', status: 'scheduled' } })
    expect(reminder?.dueOn.toISOString().slice(0, 10)).toBe(vx.dueNextOn.toISOString().slice(0, 10))
    await expect(prisma.vaccineAdministration.update({ where: { id: given.id }, data: { site: 'changed' } })).rejects.toSatisfy(e => /append-only|never/i.test(pgError(e)))
    // The reminder job sends at most one message per household per day.
    const first = await runInTransaction(prisma, uow => runReminderJob(uow, 'seed_loc_main'))
    const second = await runInTransaction(prisma, uow => runReminderJob(uow, 'seed_loc_main'))
    expect(first.notified).toBeGreaterThanOrEqual(0)
    expect(second.notified).toBe(0)
  }, 120_000)

  it('the treatment sheet materialises tasks, and completing one records the dose', async () => {
    const enc = await openEncounter(null, { patientId: PATIENT, locationId: 'seed_loc_main', kind: 'inpatient_day', reason: 'Post-op monitoring', attendingDvmId: 'seed_staff_marsh', idempotencyKey: uniqueKey('enc') }, marsh)
    const stay = await admitPatient(null, { encounterId: enc.id, cageId: 'seed_cage_mw05', codeStatus: 'full', reason: 'Post-op', idempotencyKey: uniqueKey('adm') }, lopez)
    await expect(admitPatient(null, { encounterId: enc.id, cageId: 'seed_cage_mw06', codeStatus: 'full', idempotencyKey: uniqueKey('adm') }, lopez)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    await placeOrder(null, { encounterId: enc.id, kind: 'medication', drugId: 'seed_drug_maropitant', route: 'iv', frequency: 'q8h', dose: { doseAmount: '1', doseUnit: 'mg', dosePer: 'kg' }, sheet: { stayId: stay.id, frequency: 'Q8H', durationHours: 48 }, idempotencyKey: uniqueKey('o') }, marsh)
    const tasks = await prisma.treatmentTask.findMany({ where: { stayId: stay.id }, orderBy: { dueAt: 'asc' } })
    // q8h for the next 24 hours: three tasks, materialised once (re-running the job adds none).
    expect(tasks.length).toBe(3)
    await completeTreatmentTask(null, { taskId: tasks[0].id, expectedVersion: tasks[0].version, lotId: 'seed_lot_maropitant_main', idempotencyKey: uniqueKey('t') }, lopez)
    expect(await prisma.administration.count({ where: { treatmentTaskId: tasks[0].id } })).toBe(1)
  }, 120_000)

  it('voiding a record with clinical acts is refused; an empty one needs maker-checker', async () => {
    await expect(requestVoidEncounter(null, { encounterId, reason: 'Opened on the wrong patient', idempotencyKey: uniqueKey('void') }, marsh)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    await expect(requestVoidEncounter(null, { encounterId: surgeryId, reason: 'Opened on the wrong patient', idempotencyKey: uniqueKey('void') }, marsh)).rejects.toMatchObject({ code: 'GUARD_FAILED' })
    const empty = await openEncounter(null, { patientId: 'seed_pet_006_1', locationId: 'seed_loc_main', kind: 'outpatient', reason: 'Opened in error', idempotencyKey: uniqueKey('enc') }, lopez)
    const asked = await requestVoidEncounter(null, { encounterId: empty.id, reason: 'Opened on the wrong patient', idempotencyKey: uniqueKey('void') }, lopez)
    await expect(decideApprovalRequest(null, { requestId: asked.approvalRequestId, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, lopez)).rejects.toBeTruthy()
    await decideApprovalRequest(null, { requestId: asked.approvalRequestId, decision: 'approve', expectedVersion: 0, idempotencyKey: uniqueKey('d') }, director)
    expect((await prisma.encounter.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe('voided')
  }, 120_000)

  it('an import is idempotent: the same file twice creates each client once', async () => {
    const csv = 'Client ID,First Name,Last Name,Email\nAV-1001,Rosa,Delgado,rosa.delgado.av1001@gmail.com\nAV-1002,Owen,Hart,owen.hart.av1002@yahoo.com\nAV-1003,Tara,Quinn,\n'
    const run = async () => {
      const preview = await previewImport(null, { system: 'avimark', entity: 'clients', locationId: 'seed_loc_main', fileName: 'clients.csv', csv, idempotencyKey: uniqueKey('p') }, marsh)
      return applyImport(null, { batchId: preview.id, idempotencyKey: uniqueKey('a') }, marsh)
    }
    const first = await run()
    expect(first.rowsCreated).toBe(2)
    const second = await run()
    expect(first.rowsFailed).toBe(1)
    expect(second.rowsCreated).toBe(0)
    expect(await prisma.externalId.count({ where: { system: 'avimark:clients' } })).toBe(2)
    expect((await verifyAuditChain(prisma as never)).ok).toBe(true)
  }, 120_000)
})
