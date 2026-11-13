import { DomainError, Codes } from '../lib/errors'
import { auditCreate } from '../lib/cas'
import { adjustBps, taxOn } from '../domain/billing'
import { taxRulesFor } from '../lib/pricing'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { locationDay } from './clinical'

/** The other-services discount of the patient's active wellness plan, in basis points (0 for a non-member). Applied once, on the charge line. */
export async function memberDiscountBps(tx: UnitOfWork['tx'], patientId: string): Promise<number> {
  const e = await tx.enrollment.findFirst({ where: { patientId, status: 'active' }, select: { planVersion: { select: { otherServicesDiscountBps: true } } } })
  return e?.planVersion?.otherServicesDiscountBps ?? 0
}

/**
 * One charge for a practice-priced service (boarding night, groom, euthanasia, aftercare, keepsake). The price is the practice's own
 * (the service price list or the run type's rate), never typed at the desk, and tax follows the location's sales-tax policy.
 * The source id is unique per live charge, so the same night or service can only ever be charged once.
 */
export async function serviceCharge(uow: UnitOfWork, actor: Actor, input: { unitPriceMinor: bigint; taxCategory: string; description: string; patientId: string; clientId: string; locationId: string; sourceType: string; sourceId: string; performedById?: string | null; qty?: number }) {
  if (input.unitPriceMinor < 0n) throw new DomainError(Codes.GUARD_FAILED, 'A price cannot be negative.')
  const { on } = await locationDay(uow, input.locationId, uow.now)
  const qty = BigInt(input.qty ?? 1)
  const net = input.unitPriceMinor * qty
  const client = await uow.tx.client.findUnique({ where: { id: input.clientId }, select: { taxExempt: true } })
  const bps = await memberDiscountBps(uow.tx, input.patientId)
  const discount = bps ? -adjustBps(net, -bps) : 0n
  const tax = client?.taxExempt ? 0n : taxOn(await taxRulesFor(uow.tx, input.locationId, on), input.taxCategory, net - discount)
  const row = await uow.tx.chargeLine.create({
    data: { clientId: input.clientId, patientId: input.patientId, locationId: input.locationId, description: input.description.slice(0, 200), qty: qty.toString(), unitPriceMinor: input.unitPriceMinor, extendedMinor: net, discountMinor: discount, taxMinor: tax, taxCategory: input.taxCategory, sourceType: input.sourceType, sourceId: input.sourceId, performedById: input.performedById ?? null, capturedAt: uow.now },
  })
  auditCreate(uow, actor, 'ChargeLine', row.id, 'charge.captured', { source: input.sourceType, extendedMinor: net.toString(), discountMinor: discount.toString(), taxMinor: tax.toString() })
  return row
}

export async function serviceItemCharge(uow: UnitOfWork, actor: Actor, code: string, rest: { patientId: string; clientId: string; locationId: string; performedById?: string | null; sourceType: string; sourceId: string; description?: string }) {
  const item = await uow.tx.serviceItem.findFirst({ where: { code, active: true } })
  if (!item) throw new DomainError(Codes.GUARD_FAILED, 'That service has no price in the price list.', { code })
  return serviceCharge(uow, actor, { ...rest, unitPriceMinor: item.priceMinor, taxCategory: item.taxCategory, description: rest.description ?? item.name })
}
