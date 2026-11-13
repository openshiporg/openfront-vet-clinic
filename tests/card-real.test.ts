import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cardConfigured, cardMode, cardPublishableKey, saveCard, stripeAdapter, type ChargeInput } from '../features/integrations/payment'
import { signPayLink, verifyPayLink } from '../features/keystone/lib/payLink'
import { fakeStripe } from './helpers/fakeStripe'

/* PAYMENTS ARE REAL: the mode follows the key, there is no default card, and a payment link cannot be forged or reused after it expires. */
let stripe: ReturnType<typeof fakeStripe>
const input = (over: Partial<ChargeInput> = {}): ChargeInput => ({ amountMinor: 7800n, currencyCode: 'USD', idempotencyKey: `vet-pay-${Math.random().toString(36).slice(2)}`, description: 'Payment PAY-1', metadata: { payment: 'pay_1' }, ...over })
const env = { ...process.env }

beforeEach(() => { stripe = fakeStripe() })
afterEach(() => { stripe.restore(); process.env = { ...env } })

describe('the Stripe key decides the mode', () => {
  it('a live key is accepted and used, the same code path as a test key', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_unit'
    expect(cardConfigured()).toBe(true)
    expect(cardMode()).toBe('live')
    const seen: string[] = []
    const inner = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push(String(new Headers(init?.headers).get('authorization'))); return inner(url as never, init) }) as typeof fetch
    expect((await stripeAdapter.charge(input({ paymentMethod: 'pm_1Live' }))).outcome).toBe('succeeded')
    expect(seen).toEqual(['Bearer sk_live_unit'])
    globalThis.fetch = inner
  })

  it('a test key is test mode, a restricted key works, and no or a malformed key means card payments are off', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    expect(cardMode()).toBe('test')
    process.env.STRIPE_SECRET_KEY = 'rk_live_unit'
    expect(cardMode()).toBe('live')
    process.env.STRIPE_SECRET_KEY = ''
    expect(cardConfigured()).toBe(false)
    process.env.STRIPE_SECRET_KEY = 'pk_live_wrong_kind'
    expect(cardConfigured()).toBe(false)
  })

  it('the card form key is handed out only in the same mode as the secret key', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_unit'
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_unit'
    expect(cardPublishableKey()).toBeNull()
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_unit'
    expect(cardPublishableKey()).toBe('pk_live_unit')
    delete process.env.STRIPE_PUBLISHABLE_KEY
    process.env.NEXT_PUBLIC_STRIPE_KEY = 'pk_live_unit'
    expect(cardPublishableKey()).toBe('pk_live_unit')
  })
})

describe('there is no default card', () => {
  it('a charge without a card is refused before the processor is called', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    expect(await stripeAdapter.charge(input())).toMatchObject({ outcome: 'failed', providerRef: null })
    expect(stripe.calls).toEqual([])
  })

  it('saving a plan card without a card from the form is refused before the processor is called', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    expect(await saveCard({ idempotencyKey: 'k-1234567890', name: 'Ana' })).toMatchObject({ ok: false })
    expect(await saveCard({ idempotencyKey: 'k-1234567890', name: 'Ana', paymentMethod: '4242424242424242' })).toMatchObject({ ok: false })
    expect(stripe.calls).toEqual([])
  })

  it('the card sent is exactly the one given', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit'
    await stripeAdapter.charge(input({ paymentMethod: 'pm_1Typed' }))
    expect(stripe.calls).toEqual(['POST /payment_intents pm=pm_1Typed'])
  })
})

describe('payment links', () => {
  beforeEach(() => { process.env.SESSION_SECRET = 'unit-test-secret-that-is-long-enough' })
  const id = 'cmwf43m3g0iyzqw01yywdlmdi'

  it('a signed link names its invoice', () => expect(verifyPayLink(signPayLink(id))).toBe(id))

  it('a link for one invoice cannot be changed to pay another, or signed with another key', () => {
    const [, exp, mac] = signPayLink(id).split('.')
    expect(verifyPayLink(`cmwf43m3g0iyzqw01yywdlmdj.${exp}.${mac}`)).toBeNull()
    expect(verifyPayLink(`${id}.${Number(exp) + 86_400}.${mac}`)).toBeNull()
    const token = signPayLink(id)
    process.env.SESSION_SECRET = 'a-different-secret-also-long-enough'
    expect(verifyPayLink(token)).toBeNull()
  })

  it('a link expires after 30 days', () => {
    const now = Date.UTC(2026, 10, 13)
    const token = signPayLink(id, now)
    expect(verifyPayLink(token, now + 29 * 86_400_000)).toBe(id)
    expect(verifyPayLink(token, now + 31 * 86_400_000)).toBeNull()
  })

  it('rubbish is refused', () => {
    for (const t of ['', 'a.b.c', `${id}.1.x`, `${id}..`, 'x'.repeat(500)]) expect(verifyPayLink(t)).toBeNull()
  })
})
