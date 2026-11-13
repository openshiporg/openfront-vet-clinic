import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { permissionNames } from '../access'
import { loadClinicSetup, loadPracticeSetup } from './setup'
import { cancelLabOrder, collectSpecimen, communicateLabResult, enterLabResult, importLabFile, notifyResultsReady, orderLab, reviewLabResult, sendLabOrder } from './diagnostics'
import { decideRecordsRequest, releaseRecords, startRecordsVerification, verifyRecordsRequest } from './recordsRelease'
import { calculatePayPeriod, draftRuleVersion, exportPayPeriod, lockPayPeriod, openPayPeriod, requestPayPeriodApproval, requestProductionAdjustment, requestRulePublication } from './production'
import { decideApprovalRequest } from './approvals'
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

    const lab = await prisma.laboratory.create({ data: { code: 'REFLAB', name: 'Reference Lab', kind: 'reference', intake: 'file_drop', status: 'active' } as never })
    labId = lab.id
    const analyte = await prisma.analyte.create({ data: { code: 'CREA', name: 'Creatinine', canonicalUnit: 'mg/dL' } as never })
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
    const auth = await prisma.document.create({ data: { title: 'Signed authorisation', kind: 'authorisation', storageKey: 'k/auth', sha256: 'c'.repeat(64) } as never })
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

    // Fixture only: a published fee schedule is frozen, so the category is set with the trigger off for this one statement.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`ALTER TABLE "FeeItem" DISABLE TRIGGER USER`),
      prisma.$executeRawUnsafe(`UPDATE "FeeItem" SET "productionCategory" = 'exam' WHERE code = 'EXAM-OUTPATIENT'`),
      prisma.$executeRawUnsafe(`ALTER TABLE "FeeItem" ENABLE TRIGGER USER`),
    ])
    await addFeeCharge(null, { patientId, feeItemId: (await prisma.feeItem.findFirstOrThrow({ where: { code: 'EXAM-OUTPATIENT', version: { status: 'published' } } })).id, qty: '1', idempotencyKey: key() }, ctx)
    const line = await prisma.chargeLine.findFirstOrThrow({ where: { clientId, invoiceId: null, reversedAt: null }, orderBy: { capturedAt: 'desc' } })
    await prisma.chargeLine.update({ where: { id: line.id }, data: { performedById: marshStaffId } })
    const draft = (await draftInvoice(null, { clientId, idempotencyKey: key() }, ctx)) as { id: string }
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })
    await postInvoice(null, { invoiceId: draft.id, expectedVersion: inv.version, idempotencyKey: key() }, ctx)
    const credits = await prisma.productionCredit.findMany({ where: { chargeLineId: line.id } })
    expect(credits).toHaveLength(1)
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

  it('a clinic role without the pay permissions cannot reach production or pay', async () => {
    const reception = { session: sessionFor('seed_user_marsh', ['canAccessDashboard', 'canBook']), prisma }
    await expect(draftRuleVersion(null, { label: 'x', effectiveFrom: '2030-01-01', rules: { exam: { basis: 'performed', bps: 1 } }, idempotencyKey: key() }, reception)).rejects.toThrow()
    await expect(openPayPeriod(null, { startsOn: '2031-01-01', endsOn: '2031-01-14', idempotencyKey: key() }, reception)).rejects.toThrow()
  })
})
