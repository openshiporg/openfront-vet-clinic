import { command } from '../lib/command'
import { auditCreate, lockRow, transition } from '../lib/cas'
import { sha256 } from '../lib/canonical'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { formatMinor } from '../lib/money'
import { gated } from './agentGuard'
import { staffOf, text, type Ctx } from './clinical'
import { minorText, pick } from './billingInput'

/*
 * Insurance (BUILD-PLAN P4). Direct pay: the clinic asks the insurer to authorise an amount against an invoice; a person records the
 * answer. Claims: the clinic builds a packet from a records release (so only released documents can be in it) and the invoice,
 * then a person submits it by hand, or the client does. Nothing is sent from here; the packet is a document to download.
 */

const CLAIMERS = ['canPostInvoices', 'canTakePayments', 'canManagePayments'] as const

export async function requestAuthorization(_root: unknown, args: { invoiceId: string; policyId: string; requestedMinor: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...CLAIMERS], tool: 'payer.authorize.request', humanOnly: true }, args, async actor => {
    const requested = minorText(args.requestedMinor, 'amount')
    const result = await command(context.prisma, { name: 'payer.authorize.request', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const inv = await uow.tx.invoice.findUnique({ where: { id: args.invoiceId }, select: { id: true, status: true, totalMinor: true } })
      if (!inv || !['posted', 'partially_paid'].includes(inv.status)) throw new DomainError(Codes.GUARD_FAILED, 'Post the invoice before asking the insurer to pay it.')
      if (requested > inv.totalMinor) throw new DomainError(Codes.GUARD_FAILED, 'The request is more than the invoice total.')
      const policy = await uow.tx.petInsurancePolicy.findUnique({ where: { id: args.policyId }, select: { insurerId: true, directPayEligible: true, effectiveTo: true } })
      if (!policy) throw new DomainError(Codes.NOT_FOUND, 'Policy not found.')
      if (!policy.directPayEligible) throw new DomainError(Codes.GUARD_FAILED, 'This policy does not pay the clinic directly. Prepare a claim for the client instead.')
      if (policy.effectiveTo && policy.effectiveTo < uow.now) throw new DomainError(Codes.GUARD_FAILED, 'This policy has ended.')
      const ref = await nextReference(uow.tx, 'PAU', uow.now)
      const row = await uow.tx.payerAuthorization.create({ data: { ref, payerId: policy.insurerId, invoiceId: inv.id, policyId: args.policyId, requestedMinor: requested, status: 'requested' } })
      auditCreate(uow, actor, 'PayerAuthorization', row.id, 'payer.authorization.requested', { ref, requestedMinor: requested.toString() })
      return { id: row.id, ref }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Record the insurer's answer. An authorised amount can be less than asked, never more. */
export async function recordAuthorizationDecision(_root: unknown, args: { authorizationId: string; decision: string; authorisedMinor?: string | null; externalRef?: string | null; validUntil?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...CLAIMERS], tool: 'payer.authorize.decide', humanOnly: true }, args, async actor => {
    const decision = pick(args.decision, ['authorised', 'denied'] as const, 'decision')
    const result = await command(context.prisma, { name: 'payer.authorize.decide', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const authorised = decision === 'authorised' ? minorText(args.authorisedMinor, 'authorised amount') : null
      const row = await transition<{ id: string; requestedMinor: bigint; status: string }>(uow, {
        model: 'PayerAuthorization', id: args.authorizationId, from: ['requested'], to: decision, expectedVersion: args.expectedVersion, actor, eventType: `payer.authorization.${decision}`,
        guard: r => { if (authorised !== null && authorised > r.requestedMinor) throw new DomainError(Codes.INVALID_INPUT, 'The insurer cannot authorise more than was asked.', { field: 'authorisedMinor' }) },
        data: { authorisedMinor: authorised, externalRef: String(args.externalRef ?? '').slice(0, 80), validUntil: args.validUntil ? new Date(`${args.validUntil}T23:59:59Z`) : null },
      })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Build the packet: the claim form fields, the invoice, and the documents named by a records release for this patient. The packet
 * body is deterministic and hashed, so what was submitted can be shown again exactly.
 */
export async function buildClaimPacket(_root: unknown, args: { invoiceId: string; policyId: string; recordsReleaseId?: string | null; submitter: string; formFields?: Record<string, string> | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...CLAIMERS], tool: 'claim.build', humanOnly: true }, args, async actor => {
    const submitter = pick(args.submitter, ['client', 'clinic'] as const, 'submitter')
    const result = await command(context.prisma, { name: 'claim.build', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const inv = await uow.tx.invoice.findUnique({ where: { id: args.invoiceId }, include: { lines: { where: { reversedAt: null }, orderBy: { capturedAt: 'asc' } }, client: { select: { displayName: true, ref: true } } } })
      if (!inv || inv.status === 'draft') throw new DomainError(Codes.GUARD_FAILED, 'Post the invoice before preparing a claim.')
      const policy = await uow.tx.petInsurancePolicy.findUnique({ where: { id: args.policyId }, include: { insurer: { select: { name: true } }, patient: { select: { id: true, name: true, ref: true } } } })
      if (!policy?.patient) throw new DomainError(Codes.NOT_FOUND, 'Policy not found.')
      let documents: { documentId: string; title: string; sha256: string }[] = []
      if (args.recordsReleaseId) {
        const rel = await uow.tx.recordsRelease.findUnique({ where: { id: args.recordsReleaseId }, include: { request: { select: { patientId: true } } } })
        if (!rel) throw new DomainError(Codes.NOT_FOUND, 'Records release not found.', { field: 'recordsReleaseId' })
        if (rel.request?.patientId !== policy.patient.id) throw new DomainError(Codes.GUARD_FAILED, 'That release is for a different patient.')
        documents = ((rel.documents as { documentId: string; title?: string; sha256: string }[] | null) ?? []).map(d => ({ documentId: d.documentId, title: d.title ?? 'Document', sha256: d.sha256 }))
      }
      const fields = Object.fromEntries(Object.entries(args.formFields ?? {}).slice(0, 20).map(([k, v]) => [k.slice(0, 60), String(v).slice(0, 300)]))
      const ref = await nextReference(uow.tx, 'CLM', uow.now)
      const money = (m: bigint) => formatMinor(m, inv.currencyCode)
      const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Claim ${esc(ref)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right}h1,h2{margin:16px 0 6px}</style></head><body>
<h1>Insurance claim ${esc(ref)}</h1>
<p>${esc(policy.insurer?.name ?? '')} · Policy ${esc(policy.policyNumber)}</p>
<h2>Pet and owner</h2><p>${esc(policy.patient.name)} (${esc(policy.patient.ref)}) · ${esc(inv.client?.displayName ?? '')}</p>
<h2>Invoice ${esc(inv.ref)}</h2>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Amount</th></tr></thead><tbody>${inv.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="n">${esc(l.qty.toString().replace(/\.?0+$/, ''))}</td><td class="n">${esc(money(l.extendedMinor - l.discountMinor))}</td></tr>`).join('')}</tbody></table>
<p>Subtotal ${esc(money(inv.subtotalMinor - inv.discountMinor))} · Tax ${esc(money(inv.taxMinor))} · <strong>Total ${esc(money(inv.totalMinor))}</strong></p>
${Object.keys(fields).length ? `<h2>Claim details</h2><table><tbody>${Object.entries(fields).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>Attached records</h2>${documents.length ? `<ul>${documents.map(d => `<li>${esc(d.title)}</li>`).join('')}</ul>` : '<p>No records attached.</p>'}
</body></html>`
      const row = await uow.tx.insuranceClaimPacket.create({ data: { ref, policyId: policy.id, patientId: policy.patient.id, invoiceId: inv.id, recordsReleaseId: args.recordsReleaseId ?? null, formFields: fields, documents, submitter, status: 'draft', packetBody: body, packetSha256: sha256(body) } })
      auditCreate(uow, actor, 'InsuranceClaimPacket', row.id, 'claim.built', { ref, documents: documents.length })
      return { id: row.id, ref, documents: documents.length }
    })
    return { replay: result.replay, ...result.value }
  })
}

const NEXT: Record<string, { from: string[]; to: string }> = {
  ready: { from: ['draft'], to: 'ready' },
  submitted: { from: ['ready'], to: 'submitted' },
  under_review: { from: ['submitted', 'more_info_requested'], to: 'under_review' },
  more_info_requested: { from: ['under_review'], to: 'more_info_requested' },
  approved: { from: ['under_review', 'submitted'], to: 'approved' },
  denied: { from: ['under_review', 'submitted'], to: 'denied' },
}

/** Move a claim along. Submitting is recorded by a person; the system sends nothing. */
export async function advanceClaim(_root: unknown, args: { claimId: string; to: string; note?: string | null; approvedMinor?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...CLAIMERS], tool: 'claim.advance', humanOnly: true }, args, async actor => {
    const step = NEXT[args.to]
    if (!step) throw new DomainError(Codes.INVALID_INPUT, 'Choose a valid next step.', { field: 'to' })
    const note = args.to === 'denied' || args.to === 'more_info_requested' ? text(args.note, 'note', 300) : String(args.note ?? '').slice(0, 300)
    const result = await command(context.prisma, { name: 'claim.advance', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      await staffOf(uow, actor).catch(() => null)
      const approved = args.to === 'approved' ? minorText(args.approvedMinor, 'approved amount', true) : null
      const row = await transition<{ id: string; status: string }>(uow, { model: 'InsuranceClaimPacket', id: args.claimId, from: step.from, to: step.to, expectedVersion: args.expectedVersion, actor, eventType: `claim.${step.to}`, reason: note || null, data: { statusNote: note, ...(approved !== null ? { approvedMinor: approved } : {}) } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function lockClaim(uow: { tx: any }, id: string) { return lockRow(uow.tx, 'InsuranceClaimPacket', id) }
