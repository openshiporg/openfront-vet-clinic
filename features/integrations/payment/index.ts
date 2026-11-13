import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Payment adapters (INTEGRATIONS). One interface, three providers:
 *   manual   cash, check, ACH, insurer and financing payments someone recorded by hand;
 *   stripe   Stripe card payments over the REST API. The mode follows the key: a test key takes test cards, a live key takes real money.
 *            The card itself is typed into Stripe's own form (Stripe Elements) in the browser; this app only ever sees the payment method id;
 *   terminal a card reader: the interface exists and takes manual tender only until a reader is attached.
 * Every call that moves money carries an idempotency key. Asking again with the same key can never
 * charge or refund twice, which is how an `unknown` result is resolved. Nothing here runs inside a
 * database transaction; callers record the intent first, call, then record the result.
 */

/** `requires_action` and `processing` are still open (the payment stays pending); only a decline or a cancel is `failed`. */
export type Outcome = 'succeeded' | 'failed' | 'requires_action' | 'processing' | 'unknown'

export type ChargeInput = { amountMinor: bigint; currencyCode: string; idempotencyKey: string; description: string; metadata: Record<string, string>; paymentMethod?: string; customer?: string; offSession?: boolean }
export type ChargeResult = { outcome: Outcome; providerRef: string | null; message: string; /** Only for `requires_action`: lets the cardholder's browser finish 3-D Secure. Never stored. */ clientSecret?: string }
export type RefundInput = { providerRef: string; amountMinor: bigint; idempotencyKey: string; reason: string }
export type RefundResult = { outcome: 'succeeded' | 'failed' | 'unknown'; providerRef: string | null; message: string }
export type WebhookEvent = { id: string; type: string; objectRef: string; outcome: 'succeeded' | 'failed' | 'refunded' | 'ignored' }

export interface PaymentAdapter {
  readonly key: string
  /** Take a card payment now. A network failure is `unknown`, never `failed`. */
  charge(input: ChargeInput): Promise<ChargeResult>
  /** Ask the processor what happened to a charge. Read-only: it never creates or confirms a charge. */
  resolve(input: ChargeInput & { providerRef: string | null }): Promise<ChargeResult>
  refund(input: RefundInput): Promise<RefundResult>
  /** Verify and read a processor event. Throws when the signature is wrong. */
  readEvent(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent
}

const STRIPE = 'https://api.stripe.com/v1'

const SECRET = /^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/
const PUBLISHABLE = /^pk_(test|live)_[A-Za-z0-9_]+$/

function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!SECRET.test(key)) throw new Error('Card payments are not set up on this server yet.')
  return key
}

/** `test` or `live`, from the secret key; null when there is no usable key. */
export const cardMode = (): 'test' | 'live' | null => (SECRET.exec(process.env.STRIPE_SECRET_KEY ?? '')?.[2] as 'test' | 'live' | undefined) ?? null

/** The key the browser's card form uses. Only handed out when it is the same mode as the secret key, so a test form never fronts a live account. */
export function cardPublishableKey(): string | null {
  const key = (process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_KEY ?? '').trim()
  const m = PUBLISHABLE.exec(key)
  return m && m[1] === cardMode() ? key : null
}

/** A payment method id made by Stripe.js from a card typed into Stripe's form. */
export const PAYMENT_METHOD_ID = /^pm_[A-Za-z0-9_]{1,200}$/

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
  const ref = j.error?.payment_intent?.id ?? j.id ?? null
  if (status >= 500 || status === 429 || status === 409) return { outcome: 'unknown', providerRef: ref, message: 'The card processor did not answer. Check the status in a moment.' }
  // The key was already used: a charge may exist. Never a failure; "Check status" reads the intent.
  if (j.error?.type === 'idempotency_error') return { outcome: 'unknown', providerRef: ref, message: 'This payment was already sent to the card processor. Use "Check status".' }
  if (status >= 400) {
    // An error that carries the intent is answered by the intent's own state: open stays open.
    const pi = j.error?.payment_intent
    if (pi?.status && pi.status !== 'requires_payment_method' && pi.status !== 'canceled') return intentResult(200, pi)
    if (j.error?.type === 'card_error' || pi) return { outcome: 'failed', providerRef: ref, message: String(j.error?.message ?? 'The card was declined.') }
    // The processor refused the request itself (bad parameters or key) and created nothing.
    return { outcome: 'failed', providerRef: ref, message: 'The payment could not be started.' }
  }
  switch (j.status) {
    case 'succeeded': return { outcome: 'succeeded', providerRef: j.id, message: 'Paid.' }
    case 'requires_action': case 'requires_confirmation': return { outcome: 'requires_action', providerRef: j.id, message: 'The bank needs the cardholder to confirm.', ...(typeof j.client_secret === 'string' ? { clientSecret: j.client_secret } : {}) }
    case 'processing': case 'requires_capture': return { outcome: 'processing', providerRef: j.id, message: 'The bank is still processing this payment.' }
    case 'canceled': return { outcome: 'failed', providerRef: j.id, message: 'The payment was cancelled.' }
    case 'requires_payment_method': return { outcome: 'failed', providerRef: j.id, message: String(j.last_payment_error?.message ?? 'The card was declined.') }
    default: return { outcome: 'unknown', providerRef: j.id ?? null, message: 'The card processor gave an answer this app does not know. Check the Stripe dashboard.' }
  }
}

/** Find the intent a charge created, by the idempotency key (or payment id) written into its metadata. Never creates one. */
async function findIntent(input: ChargeInput): Promise<ChargeResult> {
  const q = (s: string) => s.replace(/['\\]/g, '')
  const ours = (pi: Record<string, any>) => pi.metadata?.idempotencyKey === input.idempotencyKey || (!!input.metadata.payment && pi.metadata?.payment === input.metadata.payment)
  const clauses = [`metadata['idempotencyKey']:'${q(input.idempotencyKey)}'`, ...(input.metadata.payment ? [`metadata['payment']:'${q(input.metadata.payment)}'`] : [])]
  const searched = await stripeCall(`/payment_intents/search?${form({ query: clauses.join(' OR '), limit: '10' })}`, 'GET', null)
  let found = searched.status === 200 && Array.isArray(searched.json.data) ? (searched.json.data as Record<string, any>[]).filter(ours) : null
  // Search lags by about a minute and is not offered everywhere: fall back to the most recent intents.
  if (!found?.length) {
    const listed = await stripeCall(`/payment_intents?limit=100`, 'GET', null)
    if (listed.status === 200 && Array.isArray(listed.json.data)) found = (listed.json.data as Record<string, any>[]).filter(ours)
  }
  if (!found) return { outcome: 'unknown', providerRef: null, message: 'The card processor did not answer. Check the status in a moment.' }
  if (found.length === 0) return { outcome: 'unknown', providerRef: null, message: 'The card processor has no record of this payment yet. Check again in a minute, or look it up in the Stripe dashboard.' }
  if (found.length > 1) return { outcome: 'unknown', providerRef: null, message: 'More than one card charge matches this payment. Look it up in the Stripe dashboard.' }
  return intentResult(200, found[0])
}

export const stripeAdapter: PaymentAdapter = {
  key: 'stripe',
  async charge(input) {
    // There is no default card: the card is the one the cardholder typed into Stripe's form, or one they saved for a plan.
    if (!input.paymentMethod) return { outcome: 'failed', providerRef: null, message: 'No card was entered.' }
    try {
      const { status, json } = await stripeCall('/payment_intents', 'POST', {
        amount: input.amountMinor.toString(), currency: input.currencyCode.toLowerCase(), confirm: 'true',
        payment_method: input.paymentMethod,
        ...(input.customer ? { customer: input.customer } : {}),
        ...(input.offSession ? { off_session: 'true' } : {}),
        'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
        description: input.description,
        ...Object.fromEntries(Object.entries({ ...input.metadata, idempotencyKey: input.idempotencyKey }).map(([k, v]) => [`metadata[${k}]`, v])),
      }, input.idempotencyKey)
      return intentResult(status, json)
    } catch {
      return { outcome: 'unknown', providerRef: null, message: 'The card processor did not answer. Check the status in a moment.' }
    }
  },
  async resolve(input) {
    try {
      // Read only. Re-sending the charge could start a new one (different parameters, or a key the processor has pruned).
      if (input.providerRef) {
        const got = await stripeCall(`/payment_intents/${encodeURIComponent(input.providerRef)}`, 'GET', null)
        if (got.status === 200) return intentResult(got.status, got.json)
        return { outcome: 'unknown', providerRef: input.providerRef, message: 'The card processor did not answer. Check the status in a moment.' }
      }
      return await findIntent(input)
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
export const cardConfigured = () => cardMode() !== null

export type SavedCard = { ok: true; customer: string; paymentMethod: string; setupIntent: string; label: string } | { ok: false; message: string }

/**
 * Keep a card for later plan payments: a customer and a confirmed SetupIntent (off-session use), so the card is
 * checked and the cardholder's agreement is held by the processor. The card is typed into Stripe's form; card numbers never touch this app.
 */
export async function saveCard(input: { idempotencyKey: string; name: string; email?: string; paymentMethod?: string; metadata?: Record<string, string> }): Promise<SavedCard> {
  if (!input.paymentMethod || !PAYMENT_METHOD_ID.test(input.paymentMethod)) return { ok: false, message: 'Enter the card in the card form first.' }
  try {
    const meta = Object.fromEntries(Object.entries(input.metadata ?? {}).map(([k, v]) => [`metadata[${k}]`, v]))
    const cus = await stripeCall('/customers', 'POST', { name: input.name.slice(0, 120), ...(input.email ? { email: input.email } : {}), ...meta }, `${input.idempotencyKey}:customer`)
    if (cus.status >= 400 || !cus.json.id) return { ok: false, message: 'The card processor could not start saving the card.' }
    const seti = await stripeCall('/setup_intents', 'POST', {
      customer: cus.json.id, payment_method: input.paymentMethod, confirm: 'true', usage: 'off_session',
      'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never', ...meta,
    }, `${input.idempotencyKey}:setup`)
    if (seti.status >= 400) return { ok: false, message: String(seti.json.error?.message ?? 'The card was not accepted.') }
    if (seti.json.status !== 'succeeded') return { ok: false, message: 'The bank needs the cardholder to confirm this card. Try another card.' }
    const pmId = String(seti.json.payment_method ?? '')
    const pm = await stripeCall(`/payment_methods/${encodeURIComponent(pmId)}`, 'GET', null)
    const card = pm.json.card as { brand?: string; last4?: string } | undefined
    const brand = card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card'
    return { ok: true, customer: cus.json.id, paymentMethod: pmId, setupIntent: String(seti.json.id), label: card?.last4 ? `${brand} ending ${card.last4}` : brand }
  } catch {
    return { ok: false, message: 'The card processor did not answer. Try again in a moment.' }
  }
}
