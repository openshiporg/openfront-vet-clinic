import { canonicalJson, sha256 } from './canonical'
import { advisoryLock, type Tx } from './db'
import { dec, toScale, type DecimalInput } from './decimal'
import { nextReference } from './sequence'

/**
 * The controlled-substance register append (SCHEMA §10, I-CS1). The only way a CsLogEntry is
 * written: one hash chain per container (tamper-evident), Schedule II entries also take the next
 * number in the separate CII sequence (21 CFR 1304.04(f)), and the database trigger refuses any entry
 * that would take the container below zero, whatever the caller does. Phase 3 workflows (administer,
 * waste, count, destroy) call this inside the same transaction as their clinical source.
 */
export type CsEntryInput = {
  containerId: string
  type: 'receive' | 'open_transfer' | 'administer' | 'dispense' | 'waste' | 'transfer_out' | 'transfer_in' | 'return' | 'destroy' | 'adjust' | 'count_variance' | 'theft_loss'
  qtySigned: DecimalInput
  unit: string
  occurredAt: Date
  actorId: string
  patientId?: string | null
  clientId?: string | null
  reason?: string
  id?: string
}

export async function appendCsEntry(tx: Tx, input: CsEntryInput, now: Date) {
  const container = await tx.csContainer.findUnique({ where: { id: input.containerId }, select: { id: true, deaRegistrationId: true, product: { select: { csSchedule: true } } } })
  if (!container?.product) throw new Error('Unknown controlled-substance container')
  const schedule = container.product.csSchedule
  await advisoryLock(tx, `cs-chain:${container.id}`)
  const last = await tx.csLogEntry.findFirst({ where: { containerId: container.id }, orderBy: { recordedAt: 'desc' }, select: { hash: true } })
  const prevHash = last?.hash || '0'.repeat(64)
  const ref = await nextReference(tx, 'CS', now)
  const ciiRef = schedule === 'CII' || schedule === 'CIIN' ? await nextReference(tx, 'CII', now) : null
  const qty = toScale(dec(input.qtySigned), 'qty')
  const body = { ref, ciiRef, containerId: container.id, schedule, type: input.type, qtySigned: qty, unit: input.unit, occurredAt: input.occurredAt.toISOString(), actorId: input.actorId, patientId: input.patientId ?? null }
  const hash = sha256(`${prevHash}\n${canonicalJson(body)}`)
  return tx.csLogEntry.create({
    data: {
      ...(input.id ? { id: input.id } : {}), ref, ciiRef, containerId: container.id, deaRegistrationId: container.deaRegistrationId, schedule, type: input.type, qtySigned: qty, unit: input.unit,
      occurredAt: input.occurredAt, recordedAt: now, actorId: input.actorId, patientId: input.patientId ?? null, clientId: input.clientId ?? null, reason: input.reason ?? '', prevHash, hash,
    },
  })
}

/** Derived balance: Σ qtySigned (never stored, so it can't drift). */
export async function containerBalance(tx: Tx, containerId: string) {
  const sum = await tx.csLogEntry.aggregate({ where: { containerId }, _sum: { qtySigned: true } })
  return dec(sum._sum.qtySigned ?? 0)
}
