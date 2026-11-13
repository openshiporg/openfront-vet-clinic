import { command } from '../lib/command'
import { auditCreate } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { actorAgentId } from '../lib/actor'
import { payloadHash } from '../lib/canonical'
import { gated } from './agentGuard'
import type { Ctx } from './clinical'

/*
 * The wider agent set. Both tools only read or propose; neither moves money, signs or sends.
 *  - charges.suggest: finds closed visits that have no charge at all and leaves one Proposal per visit for a person to look at.
 *  - insights.read: counts of what is late right now, computed on the call (no timers).
 */

export async function suggestCharges(_root: unknown, args: { locationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canPostInvoices'], scope: 'charges.suggest', tool: 'charges.suggest' }, args, async actor => {
    const result = await command(context.prisma, { name: 'charges.suggest', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const since = new Date(uow.now.getTime() - 14 * 86_400_000)
      const visits = await uow.tx.encounter.findMany({
        where: { status: { in: ['signed', 'submitted'] }, updatedAt: { gte: since }, ...(args.locationId ? { locationId: args.locationId } : {}) },
        select: { id: true, ref: true, patientId: true }, take: 200, orderBy: { updatedAt: 'desc' },
      })
      const made: string[] = []
      for (const v of visits) {
        if (await uow.tx.chargeLine.findFirst({ where: { encounterId: v.id, reversedAt: null }, select: { id: true } })) continue
        const payload = { encounterId: v.id, note: 'This closed visit has no charges. Open it and capture the charges.' }
        const hash = payloadHash(payload)
        if (await uow.tx.proposal.findFirst({ where: { kind: 'charge.add', targetId: v.id, payloadHash: hash, status: 'proposed' }, select: { id: true } })) continue
        const p = await uow.tx.proposal.create({ data: { kind: 'charge.add', payload: payload as never, payloadHash: hash, status: 'proposed', targetList: 'Encounter', targetId: v.id, proposedByAgentId: actorAgentId(actor) } })
        made.push(p.id)
      }
      auditCreate(uow, actor, 'Proposal', made[0] ?? 'none', 'charges.suggested', { visits: visits.length, proposals: made.length })
      return { visitsChecked: visits.length, proposals: made.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** What is late right now. Counts only: no names, values or notes. */
export async function clinicInsights(_root: unknown, _args: Record<string, never>, context: Ctx) {
  return gated(context, { permissions: ['canViewFinance'], scope: 'insights.read', tool: 'insights.read' }, {}, async () => {
    const now = new Date()
    const p = context.prisma
    const [reviewsLate, abnormalOpen, recordsDue, recordsLate, unsignedOld] = await Promise.all([
      p.task.count({ where: { kind: 'result_review', status: { in: ['open', 'in_progress'] }, dueAt: { lt: now } } }),
      p.task.count({ where: { kind: 'result_review', status: { in: ['open', 'in_progress'] }, priority: { in: ['urgent', 'high'] } } }),
      p.recordsRequest.count({ where: { status: { in: ['received', 'verifying_authority', 'approved'] } } }),
      p.recordsRequest.count({ where: { status: { in: ['received', 'verifying_authority', 'approved'] }, responseDueAt: { lt: now } } }),
      p.task.count({ where: { kind: 'record_unsigned', status: { in: ['open', 'in_progress'] }, dueAt: { lt: now } } }),
    ])
    if (!context.prisma) throw new DomainError(Codes.NOT_FOUND, 'No database.')
    return { asOf: now.toISOString(), resultReviewsLate: reviewsLate, abnormalResultsWaiting: abnormalOpen, recordsRequestsOpen: recordsDue, recordsRequestsLate: recordsLate, unsignedRecordsLate: unsignedOld }
  })
}
