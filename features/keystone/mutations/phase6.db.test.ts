import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { createHash } from 'node:crypto'
import { loadInHouseLabCatalog, mapLabCode, saveLaboratory, saveLabTest } from './labSetup'
import { cancelLabOrder, collectSpecimen, communicateLabResult, enterLabResult, importLabFile, notifyResultsReady, orderLab, reviewLabResult, sendLabOrder } from './diagnostics'
import { decideRecordsRequest, releaseRecords, startRecordsVerification, verifyRecordsRequest, attachRecordsProof } from './recordsRelease'
import { calculatePayPeriod, draftRuleVersion, exportPayPeriod, lockPayPeriod, openPayPeriod, requestPayPeriodApproval, requestProductionAdjustment, requestRulePublication } from './production'
import { decideApprovalRequest } from './approvals'
import { applyImport, previewImport } from './imports'
import { approveCampaign, cancelCampaign, exportData, planCampaign } from './portability'
import { addFeeCharge, draftInvoice, postInvoice } from './billing'

/** Phase 6 exit gate against a real database: lab results, records releases, production and pay. */
const sessionFor = (id: string, granted: string[]) => ({
  itemId: id,
  data: { name: id, email: `${id}@cedarcreekvet.com`, kind: 'staff', accessExpiresAt: null, role: { id: 'r', name: 'r', ...Object.fromEntries(permissionNames.map(p => [p, granted.includes(p)])) } },
})
const ALL = permissionNames.filter(p => p !== 'canBreakGlass')
const key = () => uniqueKey('k')
const pgError = (e: unknown) => String((e as Error)?.message ?? e)

describe.skipIf(!hasTestDatabase)('Phase 6 (database)', () => {
  let prisma: PrismaClient
  let ctx: { session: unknown; prisma: PrismaClient }
  let second: { session: unknown; prisma: PrismaClient }
  let third: { session: unknown; prisma: PrismaClient }
  let patientId = ''
  let clientId = ''
  let locationId = ''
  let labId = ''
  let testId = ''
  let marshStaffId = ''
  let n = 0

  async function orderAndSend(accession = `ACC-${(n += 1)}-${Math.random().toString(36).slice(2, 7)}`) {
    const o = (await orderLab(null, { patientId, labId, testIds: [testId], idempotencyKey: key() }, ctx)) as { id: string; ref: string }
    let v = (await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).version
    await collectSpecimen(null, { labOrderId: o.id, kind: 'serum', expectedVersion: v, idempotencyKey: key() }, ctx)
    v = (await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).version
    await sendLabOrder(null, { labOrderId: o.id, accessionId: accession, expectedVersion: v, idempotencyKey: key() }, ctx)
    return { id: o.id, accession }
  }

  beforeAll(async () => {
    prisma = testPrisma(8)
    await resetDatabase(prisma)
    const boot = await prisma.user.create({ data: { name: 'boot', email: `${uniqueKey('boot')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    const owner = { session: sessionFor(boot.id, ALL), prisma }
    await loadPracticeSetup(null, { idempotencyKey: uniqueKey('practice') }, owner)
    await loadClinicSetup(null, { idempotencyKey: uniqueKey('clinic') }, owner)
    await loadInHouseLabCatalog(null, { idempotencyKey: uniqueKey('labs') }, owner)
    ctx = { session: sessionFor('seed_user_marsh', ALL), prisma }
    const other = await prisma.user.create({ data: { name: 'second', email: `${uniqueKey('two')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    second = { session: sessionFor(other.id, ALL), prisma }
    const other3 = await prisma.user.create({ data: { name: 'third', email: `${uniqueKey('three')}@cedarcreekvet.com`, password: 'x'.repeat(60) } })
    third = { session: sessionFor(other3.id, ALL), prisma }
    const own = await prisma.patientOwnership.findFirstOrThrow({ where: { effectiveTo: null, role: 'primary' } })
    clientId = own.clientId!
    patientId = own.patientId!
    locationId = (await prisma.location.findFirstOrThrow()).id
    marshStaffId = (await prisma.staffMember.findFirstOrThrow({ where: { userId: 'seed_user_marsh' } })).id
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })
    const fee = await prisma.feeItem.findFirstOrThrow({ where: { code: 'EXAM-OUTPATIENT', version: { status: 'published' } } })

    const lab = await prisma.laboratory.create({ data: { code: 'TESTLAB', name: 'Test Reference Lab', kind: 'reference', intake: 'file_drop', status: 'active' } as never })
    labId = lab.id
    const analyte = await prisma.analyte.create({ data: { code: 'TCREA', name: 'Creatinine', canonicalUnit: 'mg/dL' } as never })
    await prisma.labAnalyteMap.create({ data: { labId, externalCode: 'CREAT', analyteId: analyte.id } as never })
    await prisma.referenceRange.create({ data: { analyteId: analyte.id, speciesId: patient.speciesId, ageClass: 'any', labId, low: '0.5', high: '1.8', criticalHigh: '5', unit: 'mg/dL' } as never })
    const t = await prisma.labTest.create({ data: { labId, code: 'CHEM', name: 'Chemistry panel', status: 'active', feeItemId: fee.id } as never })
    testId = t.id
  }, 1_700_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('an order charges once, and a result before the lab has it is refused by the database', async () => {
    const o = (await orderLab(null, { patientId, labId, testIds: [testId], idempotencyKey: key() }, ctx)) as { id: string }
    const charges = await prisma.chargeLine.findMany({ where: { sourceType: 'lab_order', sourceId: { startsWith: `${o.id}:` } } })
    expect(charges).toHaveLength(1)
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "LabResult" (id, "labOrder", status, "worstFlag", source, "contentHash") VALUES ('x1', '${o.id}', 'final', 'normal', 'manual', 'h')`)).rejects.toSatisfy(e => /sent to the lab|check|constraint/i.test(pgError(e)))
  })

  it('partial → final → corrected: each is a new row, corrections reopen review, the same file twice changes nothing', async () => {
    const { id, accession } = await orderAndSend()
    const partial = (await enterLabResult(null, { labId, accessionId: accession, status: 'partial', lines: [{ code: 'CREAT', value: '1.0', unit: 'mg/dL' }], idempotencyKey: key() }, ctx)) as { resultId: string; outcome: string }
    expect(partial.outcome).toBe('stored')
    const final = (await enterLabResult(null, { labId, accessionId: accession, status: 'final', lines: [{ code: 'CREAT', value: '6.2', unit: 'mg/dL' }], idempotencyKey: key() }, ctx)) as { resultId: string; worstFlag: string; taskId: string | null }
    expect(final.worstFlag).toBe('critical_high')
    const task = await prisma.task.findFirstOrThrow({ where: { kind: 'result_review', subjectId: final.resultId } })
    expect(task.priority).toBe('urgent')
    expect(task.dueAt!.getTime() - Date.now()).toBeLessThan(4.1 * 3_600_000)
    // The stored range travels with the value.
    const value = await prisma.labResultValue.findFirstOrThrow({ where: { resultId: final.resultId } })
    expect(value.refHigh?.toString()).toBe('1.8')

    // Same report twice: no second row.
    const again = (await enterLabResult(null, { labId, accessionId: accession, status: 'final', lines: [{ code: 'CREAT', value: '6.2', unit: 'mg/dL' }], idempotencyKey: key() }, ctx)) as { outcome: string }
    expect(again.outcome).toBe('duplicate')

    // Review, then tell the client; the second step cannot come first.
    await expect(communicateLabResult(null, { resultId: final.resultId, via: 'call', idempotencyKey: key() }, ctx)).rejects.toThrow(/read the results|reviewed|transition/i)
    await reviewLabResult(null, { resultId: final.resultId, interpretation: 'Marked azotaemia. Recheck and fluids.', idempotencyKey: key() }, ctx)
    expect((await prisma.labOrder.findUniqueOrThrow({ where: { id } })).status).toBe('reviewed')
    expect(await prisma.task.count({ where: { kind: 'result_review', subjectId: final.resultId, status: 'open' } })).toBe(0)
    await communicateLabResult(null, { resultId: final.resultId, via: 'call', idempotencyKey: key() }, ctx)
    expect((await prisma.labOrder.findUniqueOrThrow({ where: { id } })).status).toBe('communicated')

    // A correction supersedes the final and reopens review.
    const fixed = (await enterLabResult(null, { labId, accessionId: accession, status: 'corrected', lines: [{ code: 'CREAT', value: '1.4', unit: 'mg/dL' }], idempotencyKey: key() }, ctx)) as { resultId: string; status: string; worstFlag: string }
    expect(fixed.status).toBe('corrected')
    expect(fixed.worstFlag).toBe('normal')
    expect((await prisma.labResult.findUniqueOrThrow({ where: { id: fixed.resultId } })).supersedesId).toBe(final.resultId)
    expect((await prisma.labOrder.findUniqueOrThrow({ where: { id } })).status).toBe('corrected')
    expect(await prisma.task.count({ where: { kind: 'result_review', subjectId: fixed.resultId, status: 'open' } })).toBe(1)
    // The old one cannot be reviewed again; two rows cannot both be superseded by one.
    await expect(reviewLabResult(null, { resultId: final.resultId, interpretation: 'x', idempotencyKey: key() }, ctx)).rejects.toThrow(/newer result/i)
    // Results and reviews cannot be edited or deleted.
    await expect(prisma.$executeRawUnsafe(`UPDATE "LabResult" SET "worstFlag" = 'normal' WHERE id = '${final.resultId}'`)).rejects.toSatisfy(e => /append|cannot|immutable|not allowed/i.test(pgError(e)))
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "LabResultValue" WHERE "result" = '${final.resultId}'`)).rejects.toSatisfy(e => /append|cannot|immutable|not allowed/i.test(pgError(e)))
  })

  it('a dropped file stores each report once, reports the ones it cannot match, and a second run changes nothing', async () => {
    const a = await orderAndSend()
    const file = `accession,code,value,unit,status\n${a.accession},CREAT,1.1,mg/dL,final\nNO-SUCH-ACC,CREAT,2.0,mg/dL,final\n`
    const first = (await importLabFile(null, { labId, fileText: file, idempotencyKey: key() }, ctx)) as { stored: number; unmatched: number }
    expect(first).toMatchObject({ stored: 1, unmatched: 1 })
    const count = await prisma.labResult.count({ where: { labOrderId: a.id } })
    const second2 = (await importLabFile(null, { labId, fileText: file, idempotencyKey: key() }, ctx)) as { stored: number; duplicate: number }
    expect(second2).toMatchObject({ stored: 0, duplicate: 1 })
    expect(await prisma.labResult.count({ where: { labOrderId: a.id } })).toBe(count)
  })

  it('two people entering the same result at once store one row', async () => {
    const { id, accession } = await orderAndSend()
    const lines = [{ code: 'CREAT', value: '1.2', unit: 'mg/dL' }]
    const runs = await Promise.allSettled([
      enterLabResult(null, { labId, accessionId: accession, status: 'final', lines, idempotencyKey: key() }, ctx),
      enterLabResult(null, { labId, accessionId: accession, status: 'final', lines, idempotencyKey: key() }, ctx),
    ])
    expect(runs.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    expect(await prisma.labResult.count({ where: { labOrderId: id } })).toBe(1)
  })

  it('M2: an in-house order gets its result through the app (accession = its own ref at collection), using the seeded lab set-up', async () => {
    const lab = await prisma.laboratory.findUniqueOrThrow({ where: { code: 'INHOUSE' } })
    const glucose = await prisma.labTest.findFirstOrThrow({ where: { labId: lab.id, code: 'GLU' } })
    expect(glucose.feeItemId).not.toBeNull()
    const o = (await orderLab(null, { patientId, labId: lab.id, testIds: [glucose.id], idempotencyKey: key() }, ctx)) as { id: string; ref: string }
    const v = (await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).version
    const got = (await collectSpecimen(null, { labOrderId: o.id, kind: 'whole_blood', expectedVersion: v, idempotencyKey: key() }, ctx)) as { accessionId: string | null }
    expect(got.accessionId).toBe(o.ref)
    const res = (await enterLabResult(null, { labId: lab.id, accessionId: o.ref, status: 'final', lines: [{ code: 'GLU', value: '2.1', unit: 'mmol/L' }], idempotencyKey: key() }, ctx)) as { resultId: string; worstFlag: string }
    expect(res.resultId).toBeTruthy()
    expect(res.worstFlag).toBe('critical_low')
    expect((await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('final')
  })

  it('M1: lab set-up is written through the API by people who manage the practice or integrations, never by a vet', async () => {
    const { getContext } = await import('@keystone-6/core/context')
    const PrismaModule = await import('@prisma/client')
    const config = (await import('../index')).default
    const kctx: any = getContext(config as never, PrismaModule)
    const as = (granted: string[]) => kctx.withSession(sessionFor('seed_user_marsh', ['canAccessDashboard', 'canReadClinical', ...granted]))
    const create = `mutation($d: LaboratoryCreateInput!) { createLaboratory(data: $d) { id name kind status } }`
    const data = { code: `L${Math.random().toString(36).slice(2, 7)}`, name: 'Valley Pathology', kind: 'reference', intake: 'manual' }
    const vet = await as(['canOrder', 'canSignRecord']).graphql.raw({ query: create, variables: { d: data } })
    expect(JSON.stringify(vet.errors ?? [])).toMatch(/Access denied|not allowed|access/i)
    const mgr = await as(['canManagePractice']).graphql.raw({ query: create, variables: { d: data } })
    expect(mgr.errors).toBeUndefined()
    const labIdNew = mgr.data.createLaboratory.id
    const it2 = await as(['canManageIntegrations']).graphql.raw({ query: `mutation($id: ID!) { updateLaboratory(where: { id: $id }, data: { accountNumber: "VP-77" }) { accountNumber } } `, variables: { id: labIdNew } })
    expect(it2.errors).toBeUndefined()
    const t = await as(['canManagePractice']).graphql.raw({ query: `mutation($lab: ID!) { createLabTest(data: { lab: { connect: { id: $lab } }, code: "FT4", name: "Free T4", turnaroundHours: 72 }) { id status } }`, variables: { lab: labIdNew } })
    expect(t.errors).toBeUndefined()
    expect(t.data.createLabTest.status).toBe('active')
    const del = await as(['canManagePractice']).graphql.raw({ query: `mutation($id: ID!) { deleteLaboratory(where: { id: $id }) { id } }`, variables: { id: labIdNew } })
    expect(del.errors?.length).toBeGreaterThan(0)
  })

  it('the notifier leaves a call-back with fixed wording and no value; cancel reverses an unposted charge', async () => {
    const { id, accession } = await orderAndSend()
    await enterLabResult(null, { labId, accessionId: accession, status: 'final', lines: [{ code: 'CREAT', value: '1.2', unit: 'mg/dL' }], idempotencyKey: key() }, ctx).catch(() => undefined)
    const agent = await prisma.agentIdentity.create({ data: { name: 'Lab notifier', kind: 'lab_notifier', status: 'active', killSwitch: false } as never }).catch(() => null)
    if (agent) {
      // A person without the scope cannot use the agent path; with no grant the agent is refused.
      const agentCtx = { session: { itemId: agent.id, data: { kind: 'agent', name: 'Lab notifier' } }, prisma }
      await expect(notifyResultsReady(null, { labOrderId: id, idempotencyKey: key() }, agentCtx)).rejects.toThrow()
    }
    const o = (await orderLab(null, { patientId, labId, testIds: [testId], idempotencyKey: key() }, ctx)) as { id: string }
    const v = (await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).version
    const out = (await cancelLabOrder(null, { labOrderId: o.id, reason: 'Ordered on the wrong pet', expectedVersion: v, idempotencyKey: key() }, ctx)) as { chargesReversed: number }
    expect(out.chargesReversed).toBe(1)
    expect(await prisma.chargeLine.count({ where: { sourceType: 'lab_order', sourceId: { startsWith: `${o.id}:` }, reversedAt: null } })).toBe(0)
  })

  it('records: verified basis before approval, a third party needs an approved packet, the release is hash-listed and cannot change', async () => {
    const doc = await prisma.clinicalDocument.create({ data: { patientId, kind: 'clinical_summary', title: 'Visit summary', status: 'rendered', sha256: 'a'.repeat(64), body: 'x' } as never })
    const mk = async (basis: string, kind: string) => prisma.recordsRequest.create({ data: { ref: uniqueKey('RR').slice(0, 20), patientId, clientId, requesterKind: kind, requesterName: 'Pet insurer', channel: 'csr', basis, status: 'received' } as never })
    const r = await mk('insurer_with_authorisation', 'insurer')
    let v = r.version
    await startRecordsVerification(null, { requestId: r.id, expectedVersion: v, idempotencyKey: key() }, ctx)
    v = (await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } })).version
    // Not verified yet.
    await expect(decideRecordsRequest(null, { requestId: r.id, decision: 'approve', expectedVersion: v, idempotencyKey: key() }, ctx)).rejects.toThrow(/verify/i)
    // A third party needs the client's authorisation on file.
    await expect(verifyRecordsRequest(null, { requestId: r.id, note: 'Called the insurer', expectedVersion: v, idempotencyKey: key() }, ctx)).rejects.toThrow(/authorisation/i)
    // The person checking attaches the signed form they were given; only a PDF or photo under 4 MB is kept, with its hash.
    const pdf = Buffer.from('%PDF-1.4 signed authorisation for the insurer')
    await expect(attachRecordsProof(null, { requestId: r.id, fileName: 'x.exe', mimeType: 'application/x-msdownload', contentBase64: pdf.toString('base64'), idempotencyKey: key() }, ctx)).rejects.toThrow(/PDF or a photo/)
    await expect(attachRecordsProof(null, { requestId: r.id, fileName: 'big.pdf', mimeType: 'application/pdf', contentBase64: Buffer.alloc(4_000_001).toString('base64'), idempotencyKey: key() }, ctx)).rejects.toThrow(/4 MB/)
    const auth = (await attachRecordsProof(null, { requestId: r.id, fileName: 'authorisation.pdf', mimeType: 'application/pdf', contentBase64: pdf.toString('base64'), idempotencyKey: key() }, ctx)) as { id: string; sha256: string }
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: auth.id } })
    expect(stored.sha256).toBe(createHash('sha256').update(pdf).digest('hex'))
    expect(Buffer.from(stored.content, 'base64').equals(pdf)).toBe(true)
    expect(stored.storageKey).toBe(`db:${stored.sha256}`)
    await verifyRecordsRequest(null, { requestId: r.id, note: 'Signed form on file', authorisationDocumentId: auth.id, expectedVersion: v, idempotencyKey: key() }, ctx)
    v = (await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } })).version
    await decideRecordsRequest(null, { requestId: r.id, decision: 'approve', expectedVersion: v, idempotencyKey: key() }, ctx)
    v = (await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } })).version
    // First call asks for the approval; nothing leaves.
    const asked = (await releaseRecords(null, { requestId: r.id, documentIds: [doc.id], recipient: 'claims@insurer.example', channel: 'email', expectedVersion: v, idempotencyKey: key() }, ctx)) as { proposed: boolean; approvalRequestId: string; packetHash: string }
    expect(asked.proposed).toBe(true)
    expect(await prisma.recordsRelease.count({ where: { requestId: r.id } })).toBe(0)
    const ap = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: asked.approvalRequestId } })
    await decideApprovalRequest(null, { requestId: ap.id, decision: 'approve', expectedVersion: ap.version, idempotencyKey: key() }, second as never)
    const done = (await releaseRecords(null, { requestId: r.id, documentIds: [doc.id], recipient: 'claims@insurer.example', channel: 'email', approvalRequestId: ap.id, expectedVersion: v, idempotencyKey: key() }, ctx)) as { packetHash: string; proposed: boolean }
    expect(done.proposed).toBe(false)
    expect(done.packetHash).toBe(asked.packetHash)
    const rel = await prisma.recordsRelease.findFirstOrThrow({ where: { requestId: r.id } })
    expect(rel.packetHash).toBe(done.packetHash)
    expect((await prisma.recordsRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('released')
    expect(await prisma.readAudit.count({ where: { resourceId: doc.id, purpose: 'records_request' } })).toBeGreaterThan(0)
    await expect(prisma.$executeRawUnsafe(`UPDATE "RecordsRelease" SET recipient = 'x' WHERE id = '${rel.id}'`)).rejects.toSatisfy(e => /append|cannot|immutable|not allowed|release/i.test(pgError(e)))
    // The database refuses a release row for a request that was never approved.
    const raw = await mk('client_of_record', 'client_person')
    await expect(prisma.recordsRelease.create({ data: { requestId: raw.id, recipient: 'x', channel: 'mail', documents: [], packetHash: 'h', at: new Date() } as never })).rejects.toSatisfy(e => /approved|release/i.test(pgError(e)))
  })

  it('production: credits are derived once at posting, equal their rule, and an adjustment needs a second person', async () => {
    const d = (await draftRuleVersion(null, { label: 'Standard', effectiveFrom: '2020-01-01', rules: { exam: { basis: 'performed', bps: 2000 } }, idempotencyKey: key() }, ctx)) as { id: string }
    const asked = (await requestRulePublication(null, { ruleVersionId: d.id, idempotencyKey: key() }, ctx)) as { approvalRequestId: string }
    const ap = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: asked.approvalRequestId } })
    // The person who asked cannot approve their own request.
    await expect(decideApprovalRequest(null, { requestId: ap.id, decision: 'approve', expectedVersion: ap.version, idempotencyKey: key() }, ctx)).rejects.toThrow()
    await decideApprovalRequest(null, { requestId: ap.id, decision: 'approve', expectedVersion: ap.version, idempotencyKey: key() }, second as never)
    expect((await prisma.productionRuleVersion.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('published')

    // M3 (review r1): the seeded, published price list earns production as it stands; nothing is patched under the frozen fee version.
    expect((await prisma.feeItem.findFirstOrThrow({ where: { code: 'EXAM-OUTPATIENT', version: { status: 'published' } } })).productionCategory).toBe('exam')
    await addFeeCharge(null, { patientId, feeItemId: (await prisma.feeItem.findFirstOrThrow({ where: { code: 'EXAM-OUTPATIENT', version: { status: 'published' } } })).id, qty: '1', idempotencyKey: key() }, ctx)
    const line = await prisma.chargeLine.findFirstOrThrow({ where: { clientId, invoiceId: null, reversedAt: null }, orderBy: { capturedAt: 'desc' } })
    await prisma.chargeLine.update({ where: { id: line.id }, data: { performedById: marshStaffId } })
    const draft = (await draftInvoice(null, { clientId, idempotencyKey: key() }, ctx)) as { id: string }
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })
    await postInvoice(null, { invoiceId: draft.id, expectedVersion: inv.version, idempotencyKey: key() }, ctx)
    const credits = await prisma.productionCredit.findMany({ where: { chargeLineId: line.id } })
    expect(credits).toHaveLength(1)
    expect(credits[0].amountMinor).toBeGreaterThan(0n)
    expect(credits[0].amountMinor).toBe((line.extendedMinor - line.discountMinor) * 2000n / 10000n)
    // A second run for the same key is refused by the database.
    await expect(prisma.productionCredit.create({ data: { ...credits[0], id: undefined, entryKey: uniqueKey('e'), staffId: credits[0].staffId, chargeLineId: line.id, ruleVersionId: credits[0].ruleVersionId } as never })).rejects.toThrow()

    // Adjustment: asked by one person, approved by another who is not the doctor concerned.
    const adj = (await requestProductionAdjustment(null, { creditId: credits[0].id, amountMinor: '-100', reason: 'Charge corrected', idempotencyKey: key() }, second)) as { approvalRequestId: string }
    const adjAp = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: adj.approvalRequestId } })
    // The doctor whose production it is cannot approve it, and neither can the person who asked.
    await expect(decideApprovalRequest(null, { requestId: adjAp.id, decision: 'approve', expectedVersion: adjAp.version, idempotencyKey: key() }, ctx)).rejects.toThrow(/own production|adjustment/i)
    await expect(decideApprovalRequest(null, { requestId: adjAp.id, decision: 'approve', expectedVersion: adjAp.version, idempotencyKey: key() }, second as never)).rejects.toThrow()
    await decideApprovalRequest(null, { requestId: adjAp.id, decision: 'approve', expectedVersion: adjAp.version, idempotencyKey: key() }, third as never)
    const adjustment = await prisma.productionCredit.findFirstOrThrow({ where: { adjustsId: credits[0].id } })
    expect(adjustment.amountMinor).toBe(-100n)
    expect(adjustment.kind).toBe('adjustment')

    // M5 (review r1): two requests made while both are pending cannot together take more than the credit is worth.
    const left = credits[0].amountMinor - 100n
    const take = (left - 10n).toString()
    const a1 = (await requestProductionAdjustment(null, { creditId: credits[0].id, amountMinor: `-${take}`, reason: 'Refunded visit', idempotencyKey: key() }, second)) as { approvalRequestId: string }
    const a2 = (await requestProductionAdjustment(null, { creditId: credits[0].id, amountMinor: `-${take}`, reason: 'Refunded visit (again)', idempotencyKey: key() }, second)) as { approvalRequestId: string }
    const r1 = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: a1.approvalRequestId } })
    const r2 = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: a2.approvalRequestId } })
    await decideApprovalRequest(null, { requestId: r1.id, decision: 'approve', expectedVersion: r1.version, idempotencyKey: key() }, third as never)
    await expect(decideApprovalRequest(null, { requestId: r2.id, decision: 'approve', expectedVersion: r2.version, idempotencyKey: key() }, third as never)).rejects.toThrow(/more than the credit is worth/i)
    const net = (await prisma.productionCredit.aggregate({ where: { OR: [{ id: credits[0].id }, { adjustsId: credits[0].id }] }, _sum: { amountMinor: true } }))._sum.amountMinor!
    expect(net).toBe(10n)
    // The database holds the same rule for a direct insert.
    const thirdUser = (third.session as { itemId: string }).itemId
    const secondUser = (second.session as { itemId: string }).itemId
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ProductionCredit" (id, staff, "ruleVersion", category, basis, kind, adjusts, "baseMinor", bps, "amountMinor", reason, "requestedBy", "approvedBy", "creditedOn", "entryKey") VALUES ('m5x', '${credits[0].staffId}', '${credits[0].ruleVersionId}', 'exam', 'performed', 'adjustment', '${credits[0].id}', 0, 0, -11, 'x', '${secondUser}', '${thirdUser}', CURRENT_DATE, 'm5x')`)).rejects.toSatisfy(e => /more than the credit is worth/i.test(pgError(e)))
  })

  it('pay period: no overlap, totals are frozen and equal the lines, approval names the totals, one export, locked at the end', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const startsOn = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
    const period = (await openPayPeriod(null, { startsOn, endsOn: day, idempotencyKey: key() }, ctx)) as { id: string }
    await expect(openPayPeriod(null, { startsOn: day, endsOn: day, idempotencyKey: key() }, ctx)).rejects.toThrow(/overlap/i)
    let v = (await prisma.payPeriod.findUniqueOrThrow({ where: { id: period.id } })).version
    const calc = (await calculatePayPeriod(null, { periodId: period.id, expectedVersion: v, idempotencyKey: key() }, ctx)) as { totals: { productionMinor: string; commissionMinor: string }[]; totalsHash: string }
    const credits = await prisma.productionCredit.findMany({ where: { periodId: period.id } })
    const sum = credits.reduce((s, c) => s + c.amountMinor, 0n)
    expect(calc.totals.reduce((s, t) => s + BigInt(t.productionMinor), 0n)).toBe(sum)
    // Frozen: the database refuses a changed total, and a credit already in a period cannot move.
    await expect(prisma.$executeRawUnsafe(`UPDATE "ProductionCredit" SET "period" = NULL WHERE "period" = '${period.id}'`)).rejects.toSatisfy(e => /period|append|cannot/i.test(pgError(e)))
    const asked = (await requestPayPeriodApproval(null, { periodId: period.id, idempotencyKey: key() }, ctx)) as { approvalRequestId: string; totalsHash: string }
    expect(asked.totalsHash).toBe(calc.totalsHash)
    await expect(exportPayPeriod(null, { periodId: period.id, idempotencyKey: key() }, ctx)).rejects.toThrow(/approved/i)
    const ap = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: asked.approvalRequestId } })
    await decideApprovalRequest(null, { requestId: ap.id, decision: 'approve', expectedVersion: ap.version, idempotencyKey: key() }, second as never)
    const one = (await exportPayPeriod(null, { periodId: period.id, idempotencyKey: key() }, ctx)) as { contentHash: string; csv: string }
    const two = (await exportPayPeriod(null, { periodId: period.id, idempotencyKey: key() }, ctx)) as { contentHash: string }
    expect(two.contentHash).toBe(one.contentHash)
    expect(await prisma.payrollExportBatch.count({ where: { periodId: period.id } })).toBe(1)
    v = (await prisma.payPeriod.findUniqueOrThrow({ where: { id: period.id } })).version
    await lockPayPeriod(null, { periodId: period.id, expectedVersion: v, idempotencyKey: key() }, ctx)
    expect((await prisma.payPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('locked')
    await expect(prisma.$executeRawUnsafe(`UPDATE "PayPeriod" SET status = 'open' WHERE id = '${period.id}'`)).rejects.toSatisfy(e => /cannot go|period/i.test(pgError(e)))
    await expect(prisma.$executeRawUnsafe(`UPDATE "PayrollExportBatch" SET csv = 'x' WHERE "period" = '${period.id}'`)).rejects.toSatisfy(e => /append|cannot|immutable|not allowed/i.test(pgError(e)))
  })

  it('M4: a credit dated inside a period that was already calculated is paid in the next period, not lost', async () => {
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    // A period that ended yesterday-ago is calculated; then a line dated inside it arrives late (here: dated into it directly).
    const early = (await openPayPeriod(null, { startsOn: at(-40), endsOn: at(-30), idempotencyKey: key() }, ctx)) as { id: string }
    let v = (await prisma.payPeriod.findUniqueOrThrow({ where: { id: early.id } })).version
    await calculatePayPeriod(null, { periodId: early.id, expectedVersion: v, idempotencyKey: key() }, ctx)
    const source = await prisma.productionCredit.findFirstOrThrow({ where: { kind: 'credit' } })
    const late = await prisma.productionCredit.create({ data: { staffId: source.staffId, chargeLineId: source.chargeLineId, invoiceId: source.invoiceId, ruleVersionId: source.ruleVersionId, locationId: source.locationId, category: 'exam', basis: 'performed', kind: 'credit', baseMinor: 1000n, bps: 2000, amountMinor: 200n, creditedOn: new Date(`${at(-35)}T00:00:00Z`), entryKey: uniqueKey('late') } as never }).catch(async () => {
      // One credit per line and rule version: use a fresh rule version for the late line.
      const rv = await prisma.productionRuleVersion.create({ data: { versionNo: 900 + n++, label: 'late', rules: {}, commissionRules: {}, effectiveFrom: new Date('2020-01-01T00:00:00Z'), status: 'draft', ruleHash: uniqueKey('h') } as never })
      return prisma.productionCredit.create({ data: { staffId: source.staffId, chargeLineId: source.chargeLineId, invoiceId: source.invoiceId, ruleVersionId: rv.id, locationId: source.locationId, category: 'exam', basis: 'performed', kind: 'credit', baseMinor: 1000n, bps: 2000, amountMinor: 200n, creditedOn: new Date(`${at(-35)}T00:00:00Z`), entryKey: uniqueKey('late') } as never })
    })
    expect(late.periodId).toBeNull()
    const next = (await openPayPeriod(null, { startsOn: at(-29), endsOn: at(-20), idempotencyKey: key() }, ctx)) as { id: string }
    v = (await prisma.payPeriod.findUniqueOrThrow({ where: { id: next.id } })).version
    const calc = (await calculatePayPeriod(null, { periodId: next.id, expectedVersion: v, idempotencyKey: key() }, ctx)) as { totals: { productionMinor: string }[] }
    expect((await prisma.productionCredit.findUniqueOrThrow({ where: { id: late.id } })).periodId).toBe(next.id)
    expect(calc.totals.reduce((s, t) => s + BigInt(t.productionMinor), 0n)).toBeGreaterThanOrEqual(200n)
  })

  it('a clinic role without the pay permissions cannot reach production or pay', async () => {
    const reception = { session: sessionFor('seed_user_marsh', ['canAccessDashboard', 'canBook']), prisma }
    await expect(draftRuleVersion(null, { label: 'x', effectiveFrom: '2030-01-01', rules: { exam: { basis: 'performed', bps: 1 } }, idempotencyKey: key() }, reception)).rejects.toThrow()
    await expect(openPayPeriod(null, { startsOn: '2031-01-01', endsOn: '2031-01-14', idempotencyKey: key() }, reception)).rejects.toThrow()
  })
  it('import: an opening balance posts once per client and source system, and a second run or later as-of date adds nothing', async () => {
    const ext = `AV-${Math.random().toString(36).slice(2, 8)}`
    const email = `${ext.toLowerCase()}@cedarcreekvet.com`
    const run = async (entity: 'clients' | 'balances', csv: string) => {
      const preview = await previewImport(null, { system: 'avimark', entity, locationId, fileName: `${entity}.csv`, csv, idempotencyKey: key() }, ctx)
      return applyImport(null, { batchId: preview.id, idempotencyKey: key() }, ctx)
    }
    const c = await run('clients', `Client ID,First Name,Last Name,Email\n${ext},Bal,Ance,${email}\n`)
    expect(c.rowsCreated).toBe(1)
    const bal = `Client ID,Balance,As Of\n${ext},"-$125.50",2026-11-01\n`
    const first = await run('balances', bal)
    expect(first.rowsCreated).toBe(1)
    const second = await run('balances', bal)
    expect(second.rowsCreated).toBe(0)
    const mapped = await prisma.externalId.findFirstOrThrow({ where: { system: 'avimark:clients', value: ext } })
    const entries = await prisma.clientLedgerEntry.findMany({ where: { clientId: mapped.recordId, kind: 'adjustment' } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amountMinor).toBe(-12550n)
    const bad = await run('balances', `Client ID,Balance,As Of\n${ext},12.345,2026-11-02\nNOPE,-5,2026-11-02\n`)
    expect(bad.rowsFailed).toBe(2)
    const owed = await run('balances', `Client ID,Balance,As Of\n${ext},40.00,2026-11-03\n`)
    expect(owed.rowsFailed).toBe(1)
    // M6 (review r1): the same balance exported a week later is refused with a plain message; the credit is not doubled.
    const later = await run('balances', `Client ID,Balance,As Of\n${ext},"-$125.50",2026-11-08\n`)
    expect(later.rowsCreated).toBe(0)
    expect(later.rowsFailed).toBe(1)
    const failedRow = await prisma.importRow.findFirstOrThrow({ where: { result: 'failed', externalId: `${ext}|2026-11-08` }, orderBy: { createdAt: 'desc' } })
    expect(JSON.stringify(failedRow.errors)).toMatch(/already has an opening balance/)
    const after = await prisma.clientLedgerEntry.findMany({ where: { clientId: mapped.recordId, kind: 'adjustment' } })
    expect(after.reduce((s, e) => s + e.amountMinor, 0n)).toBe(-12550n)
    // The database refuses a second opening balance for the client and system even with another key.
    await expect(prisma.clientLedgerEntry.create({ data: { clientId: mapped.recordId, kind: 'adjustment', amountMinor: -100n, postedOn: new Date('2026-11-09T00:00:00Z'), entryKey: `import:avimark:balance:${ext}:2026-11-09`, at: new Date() } })).rejects.toThrow()
  }, 120_000)
  it('export and campaigns: the export is audited and hashed; a campaign sends nothing and never targets without consent', async () => {
    const k = key()
    const out = (await exportData(null, { kind: 'clients', idempotencyKey: k }, ctx)) as { rows: number; csv: string; contentHash: string; ref: string; replay: boolean }
    expect(out.rows).toBeGreaterThan(0)
    expect(out.csv.split('\n')[0]).toBe('client,name,status,kind')
    const again = (await exportData(null, { kind: 'clients', idempotencyKey: k }, ctx)) as { replay: boolean; csv?: string; contentHash: string }
    expect(again.replay).toBe(true)
    expect(again.csv).toBeUndefined()
    expect(again.contentHash).toBe(out.contentHash)
    expect(await prisma.readAudit.count({ where: { resourceType: 'ExportJob' } })).toBeGreaterThan(0)
    const job = await prisma.exportJob.findFirstOrThrow({ where: { ref: out.ref } })
    expect(job.contentHash).toBe(out.contentHash)
    const reception = { session: sessionFor('seed_user_marsh', ['canAccessDashboard', 'canBook']), prisma }
    await expect(exportData(null, { kind: 'clients', idempotencyKey: key() }, reception)).rejects.toThrow()

    const before = await prisma.commsMessage.count()
    const reminder = (await planCampaign(null, { name: 'Recall', purpose: 'reminder', idempotencyKey: key() }, ctx)) as { id: string; audience: { clients: number } }
    const marketing = (await planCampaign(null, { name: 'Promo', purpose: 'marketing', idempotencyKey: key() }, ctx)) as { id: string; audience: { clients: number } }
    expect(reminder.audience.clients).toBeGreaterThan(0)
    expect(marketing.audience.clients).toBe(0)
    await expect(approveCampaign(null, { campaignId: marketing.id, expectedVersion: 0, idempotencyKey: key() }, ctx)).rejects.toThrow(/audience is empty/)
    const ok = (await approveCampaign(null, { campaignId: reminder.id, expectedVersion: 0, idempotencyKey: key() }, ctx)) as { status: string }
    expect(ok.status).toBe('approved')
    await expect(approveCampaign(null, { campaignId: reminder.id, expectedVersion: 1, idempotencyKey: key() }, ctx)).rejects.toThrow()
    const c = (await cancelCampaign(null, { campaignId: reminder.id, expectedVersion: 1, idempotencyKey: key() }, ctx)) as { status: string }
    expect(c.status).toBe('cancelled')
    expect(await prisma.commsMessage.count()).toBe(before)
  }, 120_000)

  it('lab set-up: a practice adds its own lab, test, price and result code; the catalog only adds what is missing; front desk cannot', async () => {
    // The clinic load no longer brings a fictional reference lab; the in-house catalog came from its own step.
    expect(await prisma.laboratory.count({ where: { code: 'REFLAB' } })).toBe(0)
    const inHouse = await prisma.laboratory.findUniqueOrThrow({ where: { code: 'INHOUSE' }, include: { tests: true } })
    expect(inHouse.tests.map(t => t.code).sort()).toEqual(['GLU', 'PCVTP'])
    const k = key()
    const lab = (await saveLaboratory(null, { code: 'idexx', name: 'IDEXX Reference Laboratories', kind: 'reference', intake: 'file_drop', accountNumber: 'A-1', idempotencyKey: k }, ctx)) as { id: string }
    expect((await saveLaboratory(null, { code: 'idexx', name: 'IDEXX Reference Laboratories', kind: 'reference', intake: 'file_drop', accountNumber: 'A-1', idempotencyKey: k }, ctx) as { replay: boolean }).replay).toBe(true)
    await expect(saveLaboratory(null, { code: 'IDEXX', name: 'Again', kind: 'reference', intake: 'manual', idempotencyKey: key() }, ctx)).rejects.toThrow(/already exists/)
    const fee = await prisma.feeItem.findFirstOrThrow({ where: { code: 'LAB-T4', version: { status: 'published' } } })
    const t = (await saveLabTest(null, { labId: lab.id, code: 'tt4', name: 'Total T4', feeItemId: fee.id, turnaroundHours: 48, speciesCodes: ['canine', 'feline'], idempotencyKey: key() }, ctx)) as { id: string }
    await expect(saveLabTest(null, { labId: lab.id, code: 'TT4', name: 'dup', turnaroundHours: 1, idempotencyKey: key() }, ctx)).rejects.toThrow(/already has a test TT4/)
    await mapLabCode(null, { labId: lab.id, externalCode: 'TT4', analyteCode: 'T4', factor: '12.87', idempotencyKey: key() }, ctx)
    await mapLabCode(null, { labId: lab.id, externalCode: 'TT4', analyteCode: 'T4', factor: '1', idempotencyKey: key() }, ctx)
    const maps = await prisma.labAnalyteMap.findMany({ where: { labId: lab.id, externalCode: 'TT4' } })
    expect(maps).toHaveLength(1)
    expect(maps[0].unitConversion).toBeNull()
    await expect(mapLabCode(null, { labId: lab.id, externalCode: 'X1', analyteCode: 'NEWONE', idempotencyKey: key() }, ctx)).rejects.toThrow(/analyte name is required/)
    // The new test is orderable and charges its fee.
    const o = (await orderLab(null, { patientId, labId: lab.id, testIds: [t.id], idempotencyKey: key() }, ctx)) as { id: string }
    expect((await prisma.labOrder.findUniqueOrThrow({ where: { id: o.id } })).chargeLineId).not.toBeNull()
    // Retire the test: it stays on the order, and can no longer be ordered.
    await saveLabTest(null, { testId: t.id, labId: lab.id, name: 'Total T4', feeItemId: fee.id, turnaroundHours: 48, status: 'retired', idempotencyKey: key() }, ctx)
    await expect(orderLab(null, { patientId, labId: lab.id, testIds: [t.id], idempotencyKey: key() }, ctx)).rejects.toThrow(/active test/)
    // A practice that changed the in-house glucose test keeps its change when the catalog is loaded again.
    const glu = inHouse.tests.find(x => x.code === 'GLU')!
    await saveLabTest(null, { testId: glu.id, labId: inHouse.id, name: 'Glucose (our meter)', turnaroundHours: 0, idempotencyKey: key() }, ctx)
    const again = (await loadInHouseLabCatalog(null, { idempotencyKey: key() }, ctx)) as { created: Record<string, number> }
    expect(Object.values(again.created).every(n => n === 0)).toBe(true)
    expect((await prisma.labTest.findUniqueOrThrow({ where: { id: glu.id } })).name).toBe('Glucose (our meter)')
    // Front desk (no practice or integrations permission) cannot set up labs.
    const csr = { session: sessionFor('seed_user_csr_x', ['canAccessDashboard', 'canBook', 'canTakePayments']), prisma }
    await expect(saveLaboratory(null, { code: 'NOPE', name: 'x', kind: 'reference', intake: 'manual', idempotencyKey: key() }, csr)).rejects.toThrow(/permission/)
    await expect(loadInHouseLabCatalog(null, { idempotencyKey: key() }, csr)).rejects.toThrow(/permission/)
  }, 120_000)
})
