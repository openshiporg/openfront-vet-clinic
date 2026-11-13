import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stripeAdapter, type ChargeInput } from '../features/integrations/payment'
import { fakeStripe } from './helpers/fakeStripe'

/* "Check status" (resolve) only ever reads the processor; it never creates or confirms a charge. */
let stripe: ReturnType<typeof fakeStripe>
const input = (over: Partial<ChargeInput> = {}): ChargeInput => ({ amountMinor: 7800n, currencyCode: 'USD', idempotencyKey: `vet-pay-${Math.random().toString(36).slice(2)}`, description: 'Payment PAY-1', metadata: { payment: `pay_${Math.random().toString(36).slice(2)}` }, ...over })

beforeEach(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_unit'; stripe = fakeStripe() })
afterEach(() => { stripe.restore(); delete process.env.STRIPE_SECRET_KEY })

describe('stripeAdapter.resolve', () => {
  it('a lost reply on a named card: resolve finds the captured intent by its key and never POSTs', async () => {
    const i = input({ paymentMethod: 'pm_card_mastercard' })
    stripe.loseNextReply()
    expect((await stripeAdapter.charge(i)).outcome).toBe('unknown')
    const posts = stripe.posts()
    const r = await stripeAdapter.resolve({ ...i, paymentMethod: undefined, providerRef: null })
    expect(r).toMatchObject({ outcome: 'succeeded', providerRef: 'pi_fake_1' })
    expect(stripe.posts()).toBe(posts)
    expect(stripe.calls.some(c => c.includes('pm_card_visa'))).toBe(false)
    expect(stripe.captured).toBe(7800)
  })

  it('a pruned key with no intent found is unknown, and nothing is charged', async () => {
    const i = input()
    const r = await stripeAdapter.resolve({ ...i, providerRef: null })
    expect(r.outcome).toBe('unknown')
    expect(stripe.posts()).toBe(0)
    expect(stripe.captured).toBe(0)
  })

  it('a pruned key after a lost reply, with the intent missing from search and the recent list, is unknown with no new charge', async () => {
    const i = input({ paymentMethod: 'pm_card_visa' })
    stripe.loseNextReply()
    await stripeAdapter.charge(i)
    stripe.prune(); stripe.hide('pi_fake_1')
    const r = await stripeAdapter.resolve({ ...i, providerRef: null })
    expect(r.outcome).toBe('unknown')
    expect(stripe.posts()).toBe(1)
  })

  it('a 3DS intent (requires_action) and a processing intent are open, never failed', async () => {
    stripe.restore(); stripe = fakeStripe({ status: () => 'requires_action' })
    const i = input({ paymentMethod: 'pm_card_threeDSecure2Required' })
    const first = await stripeAdapter.charge(i)
    expect(first).toMatchObject({ outcome: 'requires_action', providerRef: 'pi_fake_1' })
    expect((await stripeAdapter.resolve({ ...i, providerRef: first.providerRef })).outcome).toBe('requires_action')
    expect((await stripeAdapter.resolve({ ...i, providerRef: null })).outcome).toBe('requires_action')
    stripe.setStatus('pi_fake_1', 'processing')
    expect((await stripeAdapter.resolve({ ...i, providerRef: 'pi_fake_1' })).outcome).toBe('processing')
    expect(stripe.posts()).toBe(1)
  })

  it('a 400 idempotency_error from the charge is unknown, not failed', async () => {
    const i = input({ paymentMethod: 'pm_card_mastercard' })
    await stripeAdapter.charge(i)
    const again = await stripeAdapter.charge({ ...i, paymentMethod: 'pm_card_visa' })
    expect(again.outcome).toBe('unknown')
    expect(stripe.captured).toBe(7800)
  })

  it('only a decline or a cancel is failed', async () => {
    stripe.restore(); stripe = fakeStripe({ status: () => 'requires_payment_method' })
    const i = input({ paymentMethod: 'pm_card_chargeDeclined' })
    expect((await stripeAdapter.charge(i)).outcome).toBe('failed')
    stripe.setStatus('pi_fake_1', 'canceled')
    expect((await stripeAdapter.resolve({ ...i, providerRef: 'pi_fake_1' })).outcome).toBe('failed')
  })

  it('a reference the processor does not answer for is unknown, and resolve never falls back to charging', async () => {
    const r = await stripeAdapter.resolve({ ...input(), providerRef: 'pi_missing' })
    expect(r.outcome).toBe('unknown')
    expect(stripe.posts()).toBe(0)
  })
})
