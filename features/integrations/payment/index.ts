import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Payment adapters (INTEGRATIONS). One interface, three providers:
 *   manual   cash, check, ACH, insurer and financing payments someone recorded by hand;
 *   stripe   Stripe in TEST mode only (a live key is refused), card payments over the REST API;
 *   terminal a card reader: the interface exists and takes manual tender only until a reader is attached.
 * Every call that moves money carries an idempotency key. Asking again with the same key can never
 * charge or refund twice, which is how an `unknown` result is resolved. Nothing here runs inside a
 * database transaction; callers record the intent first, call, then record the result.
 */

export type Outcome = 'succeeded' | 'failed' | 'requires_action' | 'unknown'

export type ChargeInput = { amountMinor: bigint; currencyCode: string; idempotencyKey: string; description: string; metadata: Record<string, string>; paymentMethod?: string }
export type ChargeResult = { outcome: Outcome; providerRef: string | null; message: string }
export type RefundInput = { providerRef: string; amountMinor: bigint; idempotencyKey: string; reason: string }
export type RefundResult = { outcome: 'succeeded' | 'failed' | 'unknown'; providerRef: string | null; message: string }
export type WebhookEvent = { id: string; type: string; objectRef: string; outcome: 'succeeded' | 'failed' | 'refunded' | 'ignored' }

export interface PaymentAdapter {
  readonly key: string
  /** Take a card payment now. A network failure is `unknown`, never `failed`. */
  charge(input: ChargeInput): Promise<ChargeResult>
  /** Ask the processor what happened to a charge. Repeats the same idempotency key, so it can never charge twice. */
  resolve(input: ChargeInput & { providerRef: string | null }): Promise<ChargeResult>
  refund(input: RefundInput): Promise<RefundResult>
  /** Verify and read a processor event. Throws when the signature is wrong. */
  readEvent(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent
}

const STRIPE = 'https://api.stripe.com/v1'

function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!key) throw new Error('Card payments are not set up on this server yet.')
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) throw new Error('Only Stripe test keys are accepted here.')
  return key
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString()

async function stripeCall(path: string, method: 'GET' | 'POST', body: Record<string, string> | null, idempotencyKey?: string) {
  const res = await fetch(`${STRIPE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${stripeKey()}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body ? { body: form(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, any>
  return { status: res.status, json }
}

function intentResult(status: number, j: Record<string, any>): ChargeResult {
  if (status >= 500 || status === 429) return { outcome: 'unknown', providerRef: j.id ?? null, message: 'The card processor did not answer. Check the status in a moment.' }
  if (status >= 400) {
    const declined = j.error?.type === 'card_error'
    return { outcome: declined ? 'failed' : 'failed', providerRef: j.error?.payment_intent?.id ?? null, message: declined ? String(j.error?.message ?? 'The card was declined.') : 'The payment could not be started.' }
  }
  switch (j.status) {
    case 'succeeded': return { outcome: 'succeeded', providerRef: j.id, message: 'Paid.' }
    case 'requires_action': case 'requires_confirmation': return { outcome: 'requires_action', providerRef: j.id, message: 'The bank needs the cardholder to confirm.' }
    case 'processing': return { outcome: 'unknown', providerRef: j.id, message: 'The bank is still processing this payment.' }
    case 'canceled': return { outcome: 'failed', providerRef: j.id, message: 'The payment was cancelled.' }
    default: return { outcome: 'failed', providerRef: j.id ?? null, message: String(j.last_payment_error?.message ?? 'The card was declined.') }
  }
}

export const stripeAdapter: PaymentAdapter = {
  key: 'stripe',
  async charge(input) {
    try {
      const { status, json } = await stripeCall('/payment_intents', 'POST', {
        amount: input.amountMinor.toString(), currency: input.currencyCode.toLowerCase(), confirm: 'true',
        payment_method: input.paymentMethod || 'pm_card_visa',
        'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
        description: input.description,
        ...Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`metadata[${k}]`, v])),
      }, input.idempotencyKey)
      return intentResult(status, json)
    } catch {
      return { outcome: 'unknown', providerRef: null, message: 'The card processor did not answer. Check the status in a moment.' }
    }
  },
  async resolve(input) {
    try {
      if (input.providerRef) {
        const got = await stripeCall(`/payment_intents/${encodeURIComponent(input.providerRef)}`, 'GET', null)
        if (got.status === 200) return intentResult(got.status, got.json)
      }
      // No reference yet: ask again with the very same key. The processor returns the first answer instead of charging again.
      return await stripeAdapter.charge(input)
    } catch {
      return { outcome: 'unknown', providerRef: input.providerRef, message: 'The card processor still did not answer.' }
    }
  },
  async refund(input) {
    try {
      const { status, json } = await stripeCall('/refunds', 'POST', {
        payment_intent: input.providerRef, amount: input.amountMinor.toString(), 'metadata[reason]': input.reason.slice(0, 200),
      }, input.idempotencyKey)
      if (status >= 500 || status === 429) return { outcome: 'unknown', providerRef: json.id ?? null, message: 'The card processor did not answer.' }
      if (status >= 400) return { outcome: 'failed', providerRef: null, message: String(json.error?.message ?? 'The refund was refused.') }
      if (json.status === 'succeeded') return { outcome: 'succeeded', providerRef: json.id, message: 'Refunded.' }
      if (json.status === 'pending') return { outcome: 'unknown', providerRef: json.id, message: 'The refund is on its way.' }
      return { outcome: 'failed', providerRef: json.id ?? null, message: 'The refund did not go through.' }
    } catch {
      return { outcome: 'unknown', providerRef: null, message: 'The card processor did not answer.' }
    }
  },
  readEvent(rawBody, headers) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
    if (!secret) throw new Error('Card events are not set up on this server.')
    const header = headers['stripe-signature'] ?? ''
    const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
    const t = parts.t
    const v1 = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3))
    if (!t || !v1.length) throw new Error('The event signature is missing.')
    if (Math.abs(Date.now() / 1000 - Number(t)) > 600) throw new Error('The event is too old.')
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
    const ok = v1.some(sig => { const b = Buffer.from(sig, 'hex'); return b.length === expected.length && timingSafeEqual(b, expected) })
    if (!ok) throw new Error('The event signature does not match.')
    const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: { id: string; payment_intent?: string } } }
    const o = event.data.object
    const outcome = event.type === 'payment_intent.succeeded' ? 'succeeded' : event.type === 'payment_intent.payment_failed' ? 'failed' : event.type === 'charge.refunded' ? 'refunded' : 'ignored'
    return { id: event.id, type: event.type, objectRef: event.type.startsWith('charge.') ? (o.payment_intent ?? o.id) : o.id, outcome }
  },
}

/** Cash, check, ACH, insurer and financing: recorded by a person, so there is nothing to call. */
export const manualAdapter: PaymentAdapter = {
  key: 'manual',
  async charge() { return { outcome: 'failed', providerRef: null, message: 'This tender is recorded by hand, not charged.' } },
  async resolve() { return { outcome: 'failed', providerRef: null, message: 'Nothing to check for a hand-recorded payment.' } },
  async refund(input) { return { outcome: 'succeeded', providerRef: `manual-${input.idempotencyKey.slice(-12)}`, message: 'Refund recorded; hand the money back.' } },
  readEvent() { throw new Error('A hand-recorded tender has no events.') },
}

/** Card reader (Terminal, Tap to Pay): the interface is here; until a reader is attached it accepts manual tender only. */
export const terminalAdapter: PaymentAdapter = {
  key: 'terminal',
  async charge() { return { outcome: 'failed', providerRef: null, message: 'No card reader is attached. Record the card payment by hand or use the card form.' } },
  resolve: async () => ({ outcome: 'failed', providerRef: null, message: 'No card reader is attached.' }),
  refund: input => stripeAdapter.refund(input),
  readEvent: (raw, headers) => stripeAdapter.readEvent(raw, headers),
}

const ADAPTERS: Record<string, PaymentAdapter> = { stripe: stripeAdapter, manual: manualAdapter, terminal: terminalAdapter }
export const adapterFor = (key: string): PaymentAdapter => ADAPTERS[key] ?? manualAdapter
export const cardConfigured = () => /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')
