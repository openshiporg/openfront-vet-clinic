import { Codes, DomainError } from '../lib/errors'
import { systemActor } from '../lib/actor'
import { balanceOfInvoice } from '../lib/ledger'
import { signPayLink, verifyPayLink } from '../lib/payLink'
import { gated } from './agentGuard'
import { payInvoiceByLink, resolveUnknownPayment } from './billing'

/*
 * Payment links. Staff with payment rights get a signed link for a posted invoice and send it to the client however they already
 * reach them (this app sends nothing). Whoever holds the link can see that one invoice's ref, date and amount due, and pay its
 * balance with a card typed into Stripe's form. No sign-in: the signed link is the permission, checked on every call, and it
 * names exactly one invoice and expires.
 */

type Ctx = { prisma: any; session: unknown }
const TAKERS = ['canTakePayments', 'canManagePayments'] as const
const KEY = /^[A-Za-z0-9-]{16,64}$/
const invalid = () => new DomainError(Codes.NOT_FOUND, 'This payment link is not valid or has expired. Ask the practice for a new one.')

/** Staff: the link for one posted invoice. */
export async function invoicePayLink(_root: unknown, args: { invoiceId: string }, context: Ctx) {
  return gated(context, { permissions: [...TAKERS], tool: 'payment.link', humanOnly: true }, args, async () => {
    const inv = await context.prisma.invoice.findUnique({ where: { id: String(args.invoiceId) }, select: { id: true, status: true } })
    if (!inv) throw new DomainError(Codes.NOT_FOUND, 'Invoice not found.')
    if (!['posted', 'partially_paid'].includes(inv.status)) throw new DomainError(Codes.GUARD_FAILED, 'Only a posted invoice with a balance can be paid by link.')
    return signPayLink(inv.id)
  })
}

/** Public: what the link shows. Nothing about the client or the patient, only the invoice and what is due. */
export async function payLink(_root: unknown, args: { token: string }, context: Ctx) {
  const invoiceId = verifyPayLink(String(args.token ?? ''))
  if (!invoiceId) return null
  const inv = await context.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, ref: true, status: true, totalMinor: true, currencyCode: true, postedOn: true } })
  if (!inv) return null
  const practice = await context.prisma.practiceSettings.findUnique({ where: { id: 1 }, select: { displayName: true } })
  const balance = ['posted', 'partially_paid'].includes(inv.status) ? await balanceOfInvoice(context.prisma, inv.id) : 0n
  return { practice: practice?.displayName ?? null, ref: inv.ref, status: inv.status, postedOn: inv.postedOn ? inv.postedOn.toISOString().slice(0, 10) : null, totalMinor: String(inv.totalMinor), balanceMinor: String(balance), currencyCode: inv.currencyCode }
}

const shown = (r: { id: string; ref: string; status: string; message?: string; clientSecret?: string }) => ({ id: r.id, ref: r.ref, status: r.status, message: r.message ?? null, ...(r.clientSecret ? { clientSecret: r.clientSecret } : {}) })

/** Public: pay the invoice's balance with the card typed into Stripe's form. */
export async function payByLink(_root: unknown, args: { token: string; paymentMethodId: string; idempotencyKey: string }, context: Ctx) {
  const invoiceId = verifyPayLink(String(args.token ?? ''))
  if (!invoiceId) throw invalid()
  if (!KEY.test(String(args.idempotencyKey ?? ''))) throw new DomainError(Codes.INVALID_INPUT, 'Reload the page and try again.')
  return shown((await payInvoiceByLink(context.prisma, { invoiceId, paymentMethodId: String(args.paymentMethodId ?? ''), idempotencyKey: args.idempotencyKey })) as never)
}

/** Public: after the bank's check (3-D Secure), the processor's answer on that same link payment. */
export async function checkLinkPayment(_root: unknown, args: { token: string; paymentId: string }, context: Ctx) {
  const invoiceId = verifyPayLink(String(args.token ?? ''))
  if (!invoiceId) throw invalid()
  const pay = await context.prisma.payment.findUnique({ where: { id: String(args.paymentId ?? '') }, select: { forInvoiceId: true, method: true } })
  if (!pay || pay.forInvoiceId !== invoiceId || pay.method !== 'payment_link') throw new DomainError(Codes.NOT_FOUND, 'Payment not found.')
  return shown((await resolveUnknownPayment(context.prisma, systemActor('payment-link'), String(args.paymentId))) as never)
}
