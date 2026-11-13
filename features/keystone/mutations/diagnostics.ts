import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { actorAgentId, actorUserId, type Actor } from '../lib/actor'
import { nextReference } from '../lib/sequence'
import { dec, toScale } from '../lib/decimal'
import { requireLicence } from '../domain/licensure'
import { ageOn } from '../domain/wellness'
import { ageClassOf, convertValue, flagFor, isAbnormal, parseLabFile, pickRange, resultHash, reviewSlaHours, worstFlag, type Flag, type ParsedReport, type Range } from '../domain/lab'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { createCharge, clientOfPatient } from './billing'
import { activePatient, locationDay, staffOf, text, type Ctx } from './clinical'
import { pick } from './billingInput'

/*
 * Diagnostics (STATE-MACHINES §9). One order, one lab, one accession. A result is a new row each time the lab speaks; a correction
 * points at the one it replaces and reopens review. The reference range used is copied onto each value so a later range edit never
 * changes a past result. The lab notifier agent can only say "your pet's results are ready, the doctor will call", never the values.
 */

const ORDERERS = ['canOrder'] as const
const REVIEWERS = ['canOrder', 'canSignRecord'] as const
const TECHS = ['canOrder', 'canWriteRecord'] as const
const COMMUNICATORS = ['canOrder', 'canMessageClients', 'canBook'] as const
export const RESULTS_READY_TEXT = 'Your pet\'s test results are ready. The doctor will call you to go over them.'

const OPEN_RESULT_STATES = ['sent', 'partial', 'final', 'corrected', 'reviewed', 'communicated']

/** Close the open tasks that point at a result or order (review done, superseded or cancelled). */
async function closeTasks(uow: UnitOfWork, kind: string, subjectType: string, subjectId: string, status: 'done' | 'cancelled' = 'done') {
  await uow.tx.task.updateMany({ where: { kind, subjectType, subjectId, status: { in: ['open', 'in_progress'] } }, data: { status, completedAt: uow.now, version: { increment: 1 } } })
}

/** Order a lab test panel for a patient. Each test brings its own charge, once. */
export async function orderLab(_root: unknown, args: { patientId: string; labId: string; testIds: string[]; encounterId?: string | null; locationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...ORDERERS], tool: 'lab.order', humanOnly: true }, args, async actor => {
    if (!Array.isArray(args.testIds) || !args.testIds.length || args.testIds.length > 20) throw new DomainError(Codes.INVALID_INPUT, 'Choose between 1 and 20 tests.', { field: 'testIds' })
    const result = await command(context.prisma, { name: 'lab.order', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const vet = await staffOf(uow, actor)
      const patient = await activePatient(uow, args.patientId)
      const full = await uow.tx.patient.findUniqueOrThrow({ where: { id: patient.id }, select: { speciesId: true, name: true } })
      const enc = args.encounterId ? await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, patientId: true, locationId: true, status: true } }) : null
      if (args.encounterId && (!enc || enc.patientId !== patient.id)) throw new DomainError(Codes.NOT_FOUND, 'That visit is not for this patient.', { field: 'encounterId' })
      const locationId = enc?.locationId ?? args.locationId ?? vet.homeLocationId
      if (!locationId) throw new DomainError(Codes.INVALID_INPUT, 'Say which location the order is for.', { field: 'locationId' })
      const lab = await uow.tx.laboratory.findUnique({ where: { id: args.labId }, select: { id: true, status: true, name: true, kind: true } })
      if (!lab || lab.status !== 'active') throw new DomainError(Codes.NOT_FOUND, 'Laboratory not found or retired.', { field: 'labId' })
      const licence = await requireLicence(uow.tx, { staffMemberId: vet.id, locationId, action: 'diagnose', at: uow.now })
      const tests = await uow.tx.labTest.findMany({ where: { id: { in: args.testIds }, labId: lab.id, status: 'active' }, include: { species: { select: { id: true } } } })
      if (tests.length !== new Set(args.testIds).size) throw new DomainError(Codes.GUARD_FAILED, 'Every test must be an active test of this laboratory.', { field: 'testIds' })
      for (const t of tests) {
        if (t.species.length && !t.species.some(s => s.id === full.speciesId)) throw new DomainError(Codes.GUARD_FAILED, `${t.name} is not offered for this species.`, { field: 'testIds' })
      }
      const clientId = await clientOfPatient(uow, patient.id)
      const ref = await nextReference(uow.tx, 'LAB', uow.now)
      const ordRef = await nextReference(uow.tx, 'ORD', uow.now)
      const clinicalOrder = await uow.tx.clinicalOrder.create({ data: { ref: ordRef, encounterId: enc?.id ?? null, patientId: patient.id, locationId, kind: 'lab', description: tests.map(t => t.name).join(', ').slice(0, 300), status: 'ordered', orderedById: vet.id, licenseEvaluationId: licence.evaluationId, route: 'n/a' } })
      const order = await uow.tx.labOrder.create({ data: { ref, orderId: clinicalOrder.id, patientId: patient.id, encounterId: enc?.id ?? null, locationId, labId: lab.id, orderedById: vet.id, status: 'ordered', tests: { connect: tests.map(t => ({ id: t.id })) } } })
      let first: string | null = null
      for (const t of tests) {
        if (!t.feeItemId) continue
        const line = await createCharge(uow, actor, { patientId: patient.id, clientId, locationId, encounterId: enc?.id ?? null, feeItemId: t.feeItemId, qty: '1', sourceType: 'lab_order', sourceId: `${order.id}:${t.id}`, description: `${lab.name}: ${t.name}`, performedById: vet.id } as never)
        first ??= line.id
      }
      if (first) await uow.tx.labOrder.update({ where: { id: order.id }, data: { chargeLineId: first } })
      auditCreate(uow, actor, 'LabOrder', order.id, 'lab.ordered', { ref, lab: lab.name, tests: tests.map(t => t.code), patientId: patient.id })
      return { id: order.id, ref, status: 'ordered', tests: tests.map(t => t.code) }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** The sample is taken (reference lab) or run on site. */
export async function collectSpecimen(_root: unknown, args: { labOrderId: string; kind: string; containerId?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TECHS], tool: 'lab.collect', humanOnly: true }, args, async actor => {
    const kind = pick(args.kind, ['whole_blood', 'serum', 'plasma', 'urine', 'feces', 'tissue', 'swab', 'fluid', 'other'] as const, 'specimen kind')
    const result = await command(context.prisma, { name: 'lab.collect', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      // An in-house test never goes to a lab, so it takes its own order reference as its accession: results are entered against it.
      const current = await lockRow<Record<string, any>>(uow.tx, 'LabOrder', args.labOrderId)
      const lab = await uow.tx.laboratory.findUnique({ where: { id: current.labId }, select: { kind: true } })
      const inHouse = lab?.kind === 'in_house'
      const row = await transition<Record<string, any>>(uow, { model: 'LabOrder', id: args.labOrderId, from: ['ordered'], to: 'specimen_collected', expectedVersion: args.expectedVersion, actor, eventType: 'lab.collected', ...(inHouse ? { data: { accessionId: current.ref } } : {}) })
      const specimen = await uow.tx.specimen.create({ data: { labOrderId: row.id, kind, collectedAt: uow.now, collectedById: staff.id, containerId: String(args.containerId ?? '').slice(0, 60) } })
      return { id: row.id, status: row.status, specimenId: specimen.id, accessionId: inHouse ? current.ref : null }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Submit to the reference lab. The accession number comes from the requisition the lab gives back; it is unique within that lab. */
export async function sendLabOrder(_root: unknown, args: { labOrderId: string; accessionId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TECHS], tool: 'lab.send', humanOnly: true }, args, async actor => {
    const accession = text(args.accessionId, 'accession', 60)
    const result = await command(context.prisma, { name: 'lab.send', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const current = await lockRow<Record<string, any>>(uow.tx, 'LabOrder', args.labOrderId)
      const lab = await uow.tx.laboratory.findUniqueOrThrow({ where: { id: current.labId }, select: { kind: true } })
      if (lab.kind === 'in_house') throw new DomainError(Codes.GUARD_FAILED, 'An in-house test is run on site: enter its results instead.')
      const row = await transition<Record<string, any>>(uow, { model: 'LabOrder', id: args.labOrderId, from: ['specimen_collected'], to: 'sent', expectedVersion: args.expectedVersion, actor, eventType: 'lab.sent', data: { accessionId: accession, sentAt: uow.now } })
      return { id: row.id, status: row.status, accessionId: accession }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Cancel before the lab has the sample's results. An unposted charge is reversed; a posted one is left for finance with a task. */
export async function cancelLabOrder(_root: unknown, args: { labOrderId: string; reason: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...ORDERERS], tool: 'lab.cancel', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'lab.cancel', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'LabOrder', id: args.labOrderId, from: ['ordered', 'specimen_collected'], to: 'cancelled', expectedVersion: args.expectedVersion, actor, eventType: 'lab.cancelled', reason, data: { cancelReason: reason } })
      const lines = await uow.tx.chargeLine.findMany({ where: { sourceType: 'lab_order', sourceId: { startsWith: `${row.id}:` }, reversedAt: null }, select: { id: true, invoiceId: true, invoice: { select: { status: true } } } })
      let credited = 0
      for (const l of lines) {
        if (!l.invoiceId || l.invoice?.status === 'draft') await uow.tx.chargeLine.update({ where: { id: l.id }, data: { reversedAt: uow.now, reversalReason: `Lab order cancelled: ${reason}`.slice(0, 300), invoiceId: null } })
        else credited++
      }
      if (credited) await uow.tx.task.create({ data: { kind: 'follow_up', title: `Credit the client for cancelled lab order ${row.ref}`, detail: reason, subjectType: 'LabOrder', subjectId: row.id, locationId: row.locationId, roleName: 'finance', priority: 'normal', status: 'open', createdByUserId: actorUserId(actor) } })
      return { id: row.id, status: row.status, chargesReversed: lines.length - credited, needsCreditNote: credited }
    })
    return { replay: result.replay, ...result.value }
  })
}

type Line = { code: string; value?: string | null; text?: string | null; unit?: string | null }

/**
 * Take one report for one order: the shared core of manual entry, file drop and any lab adapter. Safe to run twice on the same report
 * (its hash is remembered), and a later final that differs from an earlier final is treated as a correction.
 */
export async function ingestLabReport(uow: UnitOfWork, actor: Actor, input: { labId: string; accessionId: string; status: 'partial' | 'final' | 'corrected'; lines: Line[]; source: 'manual' | 'file_drop' | 'adapter' }) {
  const order = await uow.tx.labOrder.findFirst({ where: { labId: input.labId, accessionId: input.accessionId }, select: { id: true, ref: true, status: true, version: true, patientId: true, locationId: true, orderedById: true, encounterId: true, lab: { select: { code: true, kind: true } } } })
  if (!order) return { outcome: 'unmatched' as const, accessionId: input.accessionId }
  await uow.tx.$executeRawUnsafe(`SELECT 1 FROM "LabOrder" WHERE id = $1 FOR UPDATE`, order.id)
  const fresh = await uow.tx.labOrder.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, version: true } })
  if (['cancelled', 'ordered'].includes(fresh.status)) return { outcome: 'refused' as const, accessionId: input.accessionId, reason: `The order is ${fresh.status}.` }
  if (fresh.status === 'specimen_collected' && order.lab?.kind !== 'in_house') return { outcome: 'refused' as const, accessionId: input.accessionId, reason: 'The order has not been sent to the lab.' }

  const clean = input.lines.filter(l => l.code && (l.value || l.text)).map(l => ({ code: String(l.code).trim().slice(0, 40), value: l.value ? String(l.value).trim() : '', text: String(l.text ?? '').slice(0, 300), unit: String(l.unit ?? '').trim().slice(0, 20) }))
  if (!clean.length) return { outcome: 'refused' as const, accessionId: input.accessionId, reason: 'The report has no results.' }
  const hash = resultHash(input.accessionId, input.status, clean.map(l => ({ code: l.code, value: l.value || l.text, unit: l.unit })))
  const source = `lab:${order.lab?.code ?? input.labId}`
  if (await uow.tx.providerObservation.findFirst({ where: { source, contentHash: hash }, select: { id: true } })) return { outcome: 'duplicate' as const, accessionId: input.accessionId }

  const latest = await uow.tx.labResult.findFirst({ where: { labOrderId: order.id, supersededBy: { none: {} } }, orderBy: { receivedAt: 'desc' }, select: { id: true, status: true, contentHash: true } })
  let status = input.status
  if (latest && status === 'partial' && latest.status !== 'partial') return { outcome: 'stale' as const, accessionId: input.accessionId, reason: 'A fuller report is already on file.' }
  if (latest && latest.status !== 'partial' && status === 'final') status = 'corrected'
  if (status === 'corrected' && (!latest || latest.status === 'partial')) status = 'final'
  const supersedes = latest && (status === 'corrected' || latest.status === 'partial') ? latest : null
  // A partial replaced by a final or another partial: the new row supersedes it. Only a correction asks for review again.
  const rowStatus: 'partial' | 'final' | 'corrected' = status
  if (supersedes && rowStatus !== 'corrected' && supersedes.status !== 'partial') return { outcome: 'stale' as const, accessionId: input.accessionId }

  const patient = await uow.tx.patient.findUniqueOrThrow({ where: { id: order.patientId! }, select: { speciesId: true, dateOfBirth: true } })
  const { on } = await locationDay(uow, order.locationId!, uow.now)
  const ageClass = ageClassOf(ageOn(patient.dateOfBirth, on))
  const maps = await uow.tx.labAnalyteMap.findMany({ where: { labId: input.labId, externalCode: { in: clean.map(l => l.code) } }, include: { analyte: { select: { id: true, code: true, canonicalUnit: true } } } })
  const byCode = new Map(maps.map(m => [m.externalCode, m]))
  const analyteIds = maps.map(m => m.analyteId).filter(Boolean) as string[]
  const rangeRows = analyteIds.length ? await uow.tx.referenceRange.findMany({ where: { analyteId: { in: analyteIds }, speciesId: patient.speciesId }, select: { analyteId: true, speciesId: true, ageClass: true, labId: true, low: true, high: true, criticalLow: true, criticalHigh: true, unit: true } }) : []
  const unmapped: string[] = []
  const prepared = clean.map(l => {
    const map = byCode.get(l.code)
    if (!map?.analyte) unmapped.push(l.code)
    let value: string | null = null
    let unit = l.unit
    if (l.value) {
      value = map?.analyte ? convertValue(l.value, map.unitConversion as never) : toScale(dec(l.value), 'qty')
      if (map?.analyte) unit = map.analyte.canonicalUnit
    }
    const ranges: Range[] = rangeRows.filter(r => r.analyteId === map?.analyteId).map(r => ({ speciesId: r.speciesId!, ageClass: r.ageClass, labId: r.labId, low: r.low?.toString() ?? null, high: r.high?.toString() ?? null, criticalLow: r.criticalLow?.toString() ?? null, criticalHigh: r.criticalHigh?.toString() ?? null, unit: r.unit }))
    const range = value !== null && patient.speciesId ? pickRange(ranges, patient.speciesId, ageClass, input.labId) : null
    const flag: Flag = value !== null ? flagFor(value, range) : 'normal'
    return { map, l, value, unit, range, flag }
  })
  const worst = worstFlag(prepared.map(p => p.flag))

  const obs = await uow.tx.providerObservation.create({ data: { source, connectionId: input.labId, externalId: `${input.accessionId}:${hash.slice(0, 16)}`, contentHash: hash, payload: { accessionId: input.accessionId, status: rowStatus, lines: clean } as never, receivedAt: uow.now, processedAt: uow.now, status: 'processed' } })
  const result = await uow.tx.labResult.create({ data: { labOrderId: order.id, observationId: obs.id, status: rowStatus, supersedesId: supersedes?.id ?? null, worstFlag: worst, source: input.source, contentHash: hash, receivedAt: uow.now } })
  for (const p of prepared) {
    await uow.tx.labResultValue.create({ data: { resultId: result.id, analyteId: p.map?.analyteId ?? null, externalCode: p.l.code, valueNumeric: p.value, valueText: p.l.text, unit: p.unit, refLow: p.range?.low ?? null, refHigh: p.range?.high ?? null, flag: p.flag } })
  }

  const to = rowStatus === 'partial' ? 'partial' : rowStatus
  const from = rowStatus === 'corrected' ? ['final', 'reviewed', 'communicated', 'corrected'] : rowStatus === 'final' ? ['sent', 'partial', 'specimen_collected'] : ['sent', 'partial']
  await transition(uow, { model: 'LabOrder', id: order.id, from, to, expectedVersion: fresh.version, actor, eventType: `lab.${rowStatus}`, metadata: { resultId: result.id, worstFlag: worst, accessionId: input.accessionId } })

  let taskId: string | null = null
  if (rowStatus !== 'partial' || isAbnormal(worst)) {
    if (supersedes) {
      await closeTasks(uow, 'result_review', 'LabResult', supersedes.id, 'cancelled')
    }
    const hours = reviewSlaHours(worst)
    const task = await uow.tx.task.create({ data: {
      kind: 'result_review', title: `${worst === 'normal' ? 'Review' : 'Abnormal'} ${rowStatus === 'corrected' ? 'corrected ' : ''}results for ${order.ref}`.slice(0, 200), detail: rowStatus === 'corrected' ? 'A corrected result replaced an earlier one. Review it again.' : '',
      subjectType: 'LabResult', subjectId: result.id, locationId: order.locationId, assigneeId: order.orderedById, priority: worst.startsWith('critical') ? 'urgent' : isAbnormal(worst) ? 'high' : 'normal',
      dueAt: new Date(uow.now.getTime() + hours * 3_600_000), status: 'open', createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor),
    } })
    taskId = task.id
  }
  if (isAbnormal(worst) && order.patientId) {
    const board = await uow.tx.whiteboardEntry.findFirst({ where: { patientId: order.patientId, status: { not: 'discharged' } }, select: { id: true, flags: true } })
    if (board) {
      const flags = Array.isArray(board.flags) ? (board.flags as string[]) : []
      if (!flags.includes('result_abnormal')) await uow.tx.whiteboardEntry.update({ where: { id: board.id }, data: { flags: [...flags, 'result_abnormal'], version: { increment: 1 } } })
    }
  }
  auditCreate(uow, actor, 'LabResult', result.id, `lab.result_${rowStatus}`, { orderRef: order.ref, worstFlag: worst, values: prepared.length, unmapped, supersedes: supersedes?.id ?? null, source: input.source })
  return { outcome: 'stored' as const, accessionId: input.accessionId, resultId: result.id, status: rowStatus, worstFlag: worst, taskId, unmapped }
}

/** Key a result in by hand (an in-house analyser printout, or a phoned-in report). */
export async function enterLabResult(_root: unknown, args: { labId: string; accessionId: string; status: string; lines: Line[]; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TECHS], tool: 'lab.result.enter', humanOnly: true }, args, async actor => {
    const status = pick(args.status, ['partial', 'final', 'corrected'] as const, 'status')
    if (!Array.isArray(args.lines) || args.lines.length > 200) throw new DomainError(Codes.INVALID_INPUT, 'Give between 1 and 200 result lines.', { field: 'lines' })
    for (const l of args.lines) if (l.value && !/^-?\d{1,12}(\.\d{1,6})?$/.test(String(l.value).trim())) throw new DomainError(Codes.INVALID_INPUT, `"${String(l.value).slice(0, 20)}" is not a number. Put words in the text column.`, { field: 'lines' })
    const result = await command(context.prisma, { name: 'lab.result.enter', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const out = await ingestLabReport(uow, actor, { labId: args.labId, accessionId: text(args.accessionId, 'accession', 60), status, lines: args.lines, source: 'manual' })
      if (out.outcome === 'unmatched') throw new DomainError(Codes.NOT_FOUND, `No order with accession ${out.accessionId} at this laboratory.`, { field: 'accessionId' })
      if (out.outcome === 'refused') throw new DomainError(Codes.GUARD_FAILED, out.reason)
      return out
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Take a file the lab dropped (CSV or HL7 text). Each report is its own transaction; a bad one never blocks the rest, and the same file twice changes nothing. */
export async function importLabFile(_root: unknown, args: { labId: string; fileText: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TECHS, 'canManageIntegrations'], tool: 'lab.file.import', humanOnly: true }, args, async actor => {
    if (String(args.fileText ?? '').length > 2_000_000) throw new DomainError(Codes.INVALID_INPUT, 'The file is too large (2 MB at most).', { field: 'fileText' })
    let reports: ParsedReport[]
    try { reports = parseLabFile(String(args.fileText ?? '')) } catch (error) { throw new DomainError(Codes.INVALID_INPUT, (error as Error).message, { field: 'fileText' }) }
    const outcomes: Record<string, unknown>[] = []
    for (const report of reports) {
      try {
        const r = await command(context.prisma, { name: 'lab.file.report', actor, idempotencyKey: `${args.idempotencyKey}:${report.accession}`.slice(0, 200), params: { labId: args.labId, report } }, uow =>
          ingestLabReport(uow, actor, { labId: args.labId, accessionId: report.accession, status: report.status, lines: report.lines, source: 'file_drop' }))
        outcomes.push(r.value)
      } catch (error) {
        outcomes.push({ outcome: 'failed', accessionId: report.accession, reason: error instanceof DomainError ? error.message : 'The report could not be saved.' })
      }
    }
    const count = (o: string) => outcomes.filter(x => x.outcome === o).length
    return { reports: reports.length, stored: count('stored'), duplicate: count('duplicate'), unmatched: count('unmatched'), refused: count('refused') + count('stale') + count('failed'), outcomes }
  })
}

/** The DVM reads the result and writes an interpretation. Only the newest result of an order can be reviewed; a correction needs its own review. */
export async function reviewLabResult(_root: unknown, args: { resultId: string; interpretation: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...REVIEWERS], tool: 'lab.review', humanOnly: true }, args, async actor => {
    const interpretation = text(args.interpretation, 'interpretation', 4000)
    const result = await command(context.prisma, { name: 'lab.review', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const vet = await staffOf(uow, actor)
      const res = await uow.tx.labResult.findUnique({ where: { id: args.resultId }, include: { labOrder: { select: { id: true, ref: true, status: true, version: true, patientId: true, locationId: true } }, supersededBy: { select: { id: true } } } })
      if (!res?.labOrder) throw new DomainError(Codes.NOT_FOUND, 'Result not found.')
      if (res.supersededBy.length) throw new DomainError(Codes.GUARD_FAILED, 'A newer result has replaced this one. Review the newer one.')
      if (res.status === 'partial') throw new DomainError(Codes.GUARD_FAILED, 'This is a partial report. Review it when the lab sends the final one.')
      if (!['final', 'corrected'].includes(res.labOrder.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The order is ${res.labOrder.status.replaceAll('_', ' ')}.`, { currentStatus: res.labOrder.status })
      const licence = await requireLicence(uow.tx, { staffMemberId: vet.id, locationId: res.labOrder.locationId!, action: 'diagnose', at: uow.now })
      await uow.tx.readAudit.create({ data: { actorKind: 'user', actorId: actorUserId(actor) ?? '', actorLabel: vet.displayName, patientId: res.labOrder.patientId ?? '', resourceType: 'LabResult', resourceId: res.id, purpose: 'treatment', fields: ['values', 'interpretation'] } })
      const review = await uow.tx.resultReview.create({ data: { resultId: res.id, dvmId: vet.id, kind: 'interpretation', interpretation, communicatedVia: 'none', at: uow.now } })
      await transition(uow, { model: 'LabOrder', id: res.labOrder.id, from: ['final', 'corrected'], to: 'reviewed', actor, eventType: 'lab.reviewed', metadata: { resultId: res.id, licenseEvaluationId: licence.evaluationId } })
      await closeTasks(uow, 'result_review', 'LabResult', res.id)
      const task = await uow.tx.task.create({ data: { kind: 'call_back', title: `Tell the client about the results for ${res.labOrder.ref}`, detail: 'The doctor has read the results. Call the client and record how they were told.', subjectType: 'LabResult', subjectId: res.id, locationId: res.labOrder.locationId, roleName: 'csr', priority: res.worstFlag === 'normal' ? 'normal' : 'high', dueAt: new Date(uow.now.getTime() + 24 * 3_600_000), status: 'open', createdByUserId: actorUserId(actor) } })
      auditCreate(uow, actor, 'ResultReview', review.id, 'lab.review_recorded', { resultId: res.id, licenseEvaluationId: licence.evaluationId })
      return { id: review.id, orderStatus: 'reviewed', communicationTaskId: task.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Record that the client was told (call, message, in person, portal). Needs a review of this very result first. */
export async function communicateLabResult(_root: unknown, args: { resultId: string; via: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...COMMUNICATORS], tool: 'lab.communicate', humanOnly: true }, args, async actor => {
    const via = pick(args.via, ['call', 'message', 'in_person', 'portal'] as const, 'how the client was told')
    const result = await command(context.prisma, { name: 'lab.communicate', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const res = await uow.tx.labResult.findUnique({ where: { id: args.resultId }, include: { labOrder: { select: { id: true, status: true } } } })
      if (!res?.labOrder) throw new DomainError(Codes.NOT_FOUND, 'Result not found.')
      if (res.labOrder.status !== 'reviewed') throw new DomainError(Codes.INVALID_TRANSITION, 'The doctor has to read the results before the client is told.', { currentStatus: res.labOrder.status })
      const row = await uow.tx.resultReview.create({ data: { resultId: res.id, dvmId: staff.id, kind: 'communication', interpretation: '', communicatedVia: via, at: uow.now } })
      await transition(uow, { model: 'LabOrder', id: res.labOrder.id, from: ['reviewed'], to: 'communicated', actor, eventType: 'lab.communicated', metadata: { resultId: res.id, via } })
      await closeTasks(uow, 'call_back', 'LabResult', res.id)
      return { id: row.id, orderStatus: 'communicated' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * The lab notifier agent (scope results.notify). It can say one thing: the results are ready and the doctor will call. It is given an
 * order id only, never free text, and never sees a value. Once per result. It leaves a call-back task for staff; nothing is sent from here.
 */
export async function notifyResultsReady(_root: unknown, args: { labOrderId: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...COMMUNICATORS], scope: 'results.notify', tool: 'results.notify_ready' }, args, async actor => {
    const result = await command(context.prisma, { name: 'results.notify_ready', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const order = await uow.tx.labOrder.findUnique({ where: { id: args.labOrderId }, select: { id: true, ref: true, status: true, patientId: true } })
      if (!order?.patientId) throw new DomainError(Codes.NOT_FOUND, 'Order not found.')
      if (!['final', 'corrected', 'reviewed'].includes(order.status)) throw new DomainError(Codes.GUARD_FAILED, 'The results are not in yet.')
      const latest = await uow.tx.labResult.findFirst({ where: { labOrderId: order.id, supersededBy: { none: {} } }, select: { id: true } })
      if (!latest) throw new DomainError(Codes.GUARD_FAILED, 'The results are not in yet.')
      const prior = await uow.tx.task.findFirst({ where: { kind: 'call_back', subjectType: 'LabResultNotice', subjectId: latest.id }, select: { id: true, status: true } })
      if (prior) return { id: prior.id, status: prior.status, alreadyNotified: true }
      const patient = await uow.tx.patient.findUniqueOrThrow({ where: { id: order.patientId }, select: { status: true, name: true } })
      if (patient.status === 'deceased') throw new DomainError(Codes.GUARD_FAILED, 'This patient has died. Call the owner in person.')
      // No message is sent from here: the agent leaves staff a call-back with fixed wording. It carries no values.
      const task = await uow.tx.task.create({ data: { kind: 'call_back', title: `Results ready for ${patient.name} (${order.ref})`, detail: RESULTS_READY_TEXT, subjectType: 'LabResultNotice', subjectId: latest.id, roleName: 'csr', priority: 'normal', status: 'open', createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } })
      auditCreate(uow, actor, 'Task', task.id, 'results.notice_left', { orderRef: order.ref })
      return { id: task.id, status: 'open', alreadyNotified: false }
    })
    return { replay: result.replay, ...result.value }
  })
}

/* ───────── Imaging ───────── */

export async function orderImaging(_root: unknown, args: { patientId: string; modality: string; region?: string | null; reason?: string | null; encounterId?: string | null; locationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...ORDERERS], tool: 'imaging.order', humanOnly: true }, args, async actor => {
    const modality = pick(args.modality, ['DX', 'US', 'CT', 'MR', 'ECG', 'ENDO'] as const, 'modality')
    const result = await command(context.prisma, { name: 'imaging.order', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const vet = await staffOf(uow, actor)
      const patient = await activePatient(uow, args.patientId)
      const locationId = args.locationId ?? vet.homeLocationId
      if (!locationId) throw new DomainError(Codes.INVALID_INPUT, 'Say which location the order is for.', { field: 'locationId' })
      await requireLicence(uow.tx, { staffMemberId: vet.id, locationId, action: 'diagnose', at: uow.now })
      const ref = await nextReference(uow.tx, 'IMG', uow.now)
      const ordRef = await nextReference(uow.tx, 'ORD', uow.now)
      const co = await uow.tx.clinicalOrder.create({ data: { ref: ordRef, encounterId: args.encounterId ?? null, patientId: patient.id, locationId, kind: 'imaging', description: `${modality} ${String(args.region ?? '')}`.trim().slice(0, 300), status: 'ordered', orderedById: vet.id, route: 'n/a' } })
      const row = await uow.tx.imagingOrder.create({ data: { ref, orderId: co.id, patientId: patient.id, encounterId: args.encounterId ?? null, locationId, orderedById: vet.id, modality, region: String(args.region ?? '').slice(0, 120), reason: String(args.reason ?? '').slice(0, 300), status: 'ordered' } })
      auditCreate(uow, actor, 'ImagingOrder', row.id, 'imaging.ordered', { ref, modality })
      return { id: row.id, ref, status: 'ordered' }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** The study exists in the image store: keep its UID and count, not the pictures. */
export async function recordImagingStudy(_root: unknown, args: { imagingOrderId: string; studyInstanceUid: string; images?: number | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...TECHS], tool: 'imaging.study', humanOnly: true }, args, async actor => {
    const uid = text(args.studyInstanceUid, 'study UID', 64)
    if (!/^[0-9]+(\.[0-9]+)*$/.test(uid)) throw new DomainError(Codes.INVALID_INPUT, 'A study UID is numbers separated by dots.', { field: 'studyInstanceUid' })
    const result = await command(context.prisma, { name: 'imaging.study', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'ImagingOrder', id: args.imagingOrderId, from: ['ordered'], to: 'acquired', expectedVersion: args.expectedVersion, actor, eventType: 'imaging.acquired' })
      const study = await uow.tx.imagingStudy.create({ data: { orderId: row.id, studyInstanceUid: uid, modality: row.modality, acquiredAt: uow.now, images: Math.max(0, Math.min(100_000, Number(args.images ?? 0) | 0)) } })
      return { id: row.id, studyId: study.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addImagingReport(_root: unknown, args: { imagingOrderId: string; author: string; authorName?: string | null; text: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...REVIEWERS], tool: 'imaging.report', humanOnly: true }, args, async actor => {
    const author = pick(args.author, ['in_house_dvm', 'teleradiology'] as const, 'author')
    const body = text(args.text, 'report', 20_000)
    const result = await command(context.prisma, { name: 'imaging.report', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const order = await lockRow<Record<string, any>>(uow.tx, 'ImagingOrder', args.imagingOrderId)
      if (author === 'in_house_dvm') await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: order.locationId, action: 'diagnose', at: uow.now })
      else text(args.authorName ?? '', 'reading radiologist', 120)
      const study = await uow.tx.imagingStudy.findFirst({ where: { orderId: order.id }, select: { id: true } })
      if (!study) throw new DomainError(Codes.GUARD_FAILED, 'There is no study to report on yet.')
      await transition(uow, { model: 'ImagingOrder', id: order.id, from: ['acquired', 'read'], to: 'read', expectedVersion: args.expectedVersion, actor, eventType: 'imaging.read' })
      const row = await uow.tx.imagingReport.create({ data: { studyId: study.id, author, authorStaffId: author === 'in_house_dvm' ? staff.id : null, authorName: author === 'in_house_dvm' ? staff.displayName : String(args.authorName).slice(0, 120), text: body, reportedAt: uow.now } })
      auditCreate(uow, actor, 'ImagingReport', row.id, 'imaging.reported', { orderRef: order.ref, author })
      return { id: row.id, status: 'read' }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function communicateImaging(_root: unknown, args: { imagingOrderId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...COMMUNICATORS], tool: 'imaging.communicate', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'imaging.communicate', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition<Record<string, any>>(uow, { model: 'ImagingOrder', id: args.imagingOrderId, from: ['read'], to: 'communicated', expectedVersion: args.expectedVersion, actor, eventType: 'imaging.communicated' })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}
