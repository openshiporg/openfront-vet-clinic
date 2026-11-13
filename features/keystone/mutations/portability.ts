import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { actorUserId } from '../lib/actor'
import { nextReference } from '../lib/sequence'
import { csvHash, csvCell, money } from '../domain/pay'
import { writeReadAudit, actorFromSession } from '../security/readAudit'
import { gated } from './agentGuard'
import type { Ctx } from './clinical'

/*
 * Data portability and campaign planning.
 *  - exportData: builds the clinic's own data as a CSV (clients, patients, balances) for a person who may manage integrations.
 *    The job row keeps the count and a hash, never the file; every export writes a read audit entry. Humans only.
 *  - planCampaign / approveCampaign / cancelCampaign: a campaign is a plan and an audience snapshot. Nothing here sends
 *    anything (there is no outbox); approval only records that a person agreed the audience. The audience excludes anyone
 *    without the matching consent on a live contact point, and marketing is never aimed at a client without a marketing grant.
 */

const KINDS = ['clients', 'patients', 'balances'] as const
type Kind = (typeof KINDS)[number]
const MAX = 50_000

async function build(tx: any, kind: Kind): Promise<{ header: string[]; rows: string[][] }> {
  if (kind === 'clients') {
    const list = await tx.client.findMany({ take: MAX, orderBy: { ref: 'asc' }, select: { ref: true, displayName: true, status: true, kind: true } })
    return { header: ['client', 'name', 'status', 'kind'], rows: list.map((c: any) => [c.ref, c.displayName, c.status, c.kind]) }
  }
  if (kind === 'patients') {
    const list = await tx.patient.findMany({ take: MAX, orderBy: { ref: 'asc' }, select: { ref: true, name: true, status: true, sex: true, dateOfBirth: true, deceasedAt: true, species: { select: { name: true } } } })
    return { header: ['patient', 'name', 'species', 'sex', 'date_of_birth', 'status', 'deceased_on'], rows: list.map((p: any) => [p.ref, p.name, p.species?.name ?? '', p.sex, p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : '', p.status, p.deceasedAt ? p.deceasedAt.toISOString().slice(0, 10) : '']) }
  }
  const sums: { client: string; total: bigint }[] = await tx.$queryRawUnsafe(`SELECT "client", SUM("amountMinor")::bigint AS total FROM "ClientLedgerEntry" GROUP BY "client" HAVING SUM("amountMinor") <> 0 ORDER BY "client" LIMIT ${MAX}`)
  const clients = await tx.client.findMany({ where: { id: { in: sums.map(s => s.client) } }, select: { id: true, ref: true } })
  const ref = new Map<string, string>(clients.map((c: any) => [c.id, c.ref]))
  return { header: ['client', 'balance'], rows: sums.map(s => [ref.get(s.client) ?? '', money(BigInt(s.total))]).sort((a, b) => a[0].localeCompare(b[0])) }
}

export async function exportData(_root: unknown, args: { kind: Kind; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageIntegrations', 'canReadAudit'], tool: 'data.export', humanOnly: true }, args, async actor => {
    if (!KINDS.includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, 'Choose clients, patients or balances.', { field: 'kind' })
    const result = await command(context.prisma, { name: 'data.export', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const { header, rows } = await build(uow.tx, args.kind)
      const csv = [header, ...rows].map(r => r.map(v => csvCell(String(v ?? ''))).join(',')).join('\n') + '\n'
      const ref = await nextReference(uow.tx, 'EXP', uow.now)
      const job = await uow.tx.exportJob.create({ data: { ref, kind: args.kind, status: 'built', rows: rows.length, contentHash: csvHash(csv), requestedById: actorUserId(actor), at: uow.now } })
      auditCreate(uow, actor, 'ExportJob', job.id, 'data.exported', { kind: args.kind, rows: rows.length, contentHash: job.contentHash })
      return { id: job.id, ref, rows: rows.length, contentHash: job.contentHash, csv }
    })
    // A repeat of the same key returns the stored count and hash only; the file is built again on request, never kept.
    if (!result.replay) {
      const reader = actorFromSession(context.session)
      if (reader) await writeReadAudit(context.prisma, reader, [{ resourceType: 'ExportJob', resourceId: result.value.id, fields: new Set(['kind', 'rows', 'contentHash']) }], 'data_export', args.idempotencyKey)
    }
    return { replay: result.replay, ...result.value, csv: result.replay ? undefined : result.value.csv }
  })
}

const PURPOSES = ['transactional', 'reminder', 'marketing'] as const

export async function planCampaign(_root: unknown, args: { name: string; purpose: (typeof PURPOSES)[number]; templateId?: string | null; locationId?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canMessageClients', 'canManagePractice'], tool: 'campaign.plan', humanOnly: true }, args, async actor => {
    if (!PURPOSES.includes(args.purpose)) throw new DomainError(Codes.INVALID_INPUT, 'Choose a purpose.', { field: 'purpose' })
    const name = args.name?.trim()
    if (!name) throw new DomainError(Codes.INVALID_INPUT, 'Name the campaign.', { field: 'name' })
    const result = await command(context.prisma, { name: 'campaign.plan', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      if (args.templateId) {
        const t = await uow.tx.messageTemplate.findUnique({ where: { id: args.templateId }, select: { purpose: true, active: true, channel: true } })
        if (!t || !t.active) throw new DomainError(Codes.NOT_FOUND, 'Template not found or switched off.')
        if (t.channel === 'voice') throw new DomainError(Codes.GUARD_FAILED, 'A campaign cannot use an outbound voice template.')
        if (args.purpose === 'marketing' && t.purpose !== 'marketing') throw new DomainError(Codes.GUARD_FAILED, 'A marketing campaign needs a marketing template.')
      }
      // Audience: clients with a live contact point that has a grant for the purpose and no later withdrawal.
      const consentPurpose = args.purpose === 'marketing' ? 'marketing' : 'transactional'
      const points = await uow.tx.contactPoint.findMany({ where: { status: 'active', kind: { in: ['mobile', 'email'] }, person: { client: { status: 'active', ...(args.locationId ? { primaryLocationId: args.locationId } : {}) } } }, select: { id: true, person: { select: { clientId: true } } }, take: MAX })
      const consents = await uow.tx.consentRecord.findMany({ where: { contactPointId: { in: points.map(p => p.id) }, purpose: consentPurpose }, orderBy: [{ at: 'asc' }, { id: 'asc' }], select: { contactPointId: true, action: true } })
      const state = new Map<string, string>()
      for (const c of consents) state.set(c.contactPointId!, c.action)
      const clientIds = new Set<string>()
      let excluded = 0
      for (const p of points) { if (state.get(p.id) === 'grant' && p.person?.clientId) clientIds.add(p.person.clientId); else excluded++ }
      const audience = { consentPurpose, clients: clientIds.size, contactPointsExcluded: excluded, locationId: args.locationId ?? null, builtAt: uow.now.toISOString() }
      const row = await uow.tx.campaign.create({ data: { name, purpose: args.purpose, templateId: args.templateId ?? null, audience: audience as never, status: 'draft', outboundVoice: false } })
      auditCreate(uow, actor, 'Campaign', row.id, 'campaign.planned', { purpose: args.purpose, clients: audience.clients })
      return { id: row.id, status: 'draft', audience }
    })
    return { replay: result.replay, ...result.value }
  })
}

async function move(args: { campaignId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx, to: 'approved' | 'cancelled', from: string[], tool: string, perms: string[]) {
  return gated(context, { permissions: perms as never, tool, humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: tool, actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const cur = await lockRow<Record<string, any>>(uow.tx, 'Campaign', args.campaignId)
      if (to === 'approved' && !(cur.audience as { clients?: number } | null)?.clients) throw new DomainError(Codes.GUARD_FAILED, 'The audience is empty; nothing to approve.')
      const row = await transition<Record<string, any>>(uow, { model: 'Campaign', id: args.campaignId, from, to, expectedVersion: args.expectedVersion, actor, eventType: `campaign.${to}`, data: {}, metadata: {} })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}
export const approveCampaign = (_r: unknown, args: { campaignId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) => move(args, context, 'approved', ['draft'], 'campaign.approve', ['canMessageClients', 'canManagePractice'])
export const cancelCampaign = (_r: unknown, args: { campaignId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) => move(args, context, 'cancelled', ['draft', 'approved'], 'campaign.cancel', ['canMessageClients'])
