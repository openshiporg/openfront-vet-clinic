'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CardField, type CardHandle } from '@/features/platform/components/CardField'
import { checkLinkPayment, payByLink } from '@/features/platform/pay-link/actions'

/*
 * Paying a bill from the account. The same payment path as the practice's payment link: the card is typed into Stripe's
 * own field, the server charges the invoice's balance, and the bank's extra check (3-D Secure) is finished in the browser.
 */
export function PayForm({ token, publishableKey, amount }: { token: string; publishableKey: string | null; amount: string }) {
  const router = useRouter()
  const card = React.useRef<CardHandle | null>(null)
  const attempt = React.useRef<{ pm: string; key: string } | null>(null)
  const [pending, start] = React.useTransition()
  const [error, setError] = React.useState('')
  const [done, setDone] = React.useState('')
  return (
    <form
      className="sf-stack"
      onSubmit={e => {
        e.preventDefault()
        setError('')
        start(async () => {
          const made = card.current ? await card.current.create() : { error: 'Card payments are not set up for this practice yet. Please pay at the front desk.' }
          if ('error' in made) { setError(made.error); return }
          // One key per card typed: pressing Pay again after a lost answer repeats the same request, never a second charge.
          if (attempt.current?.pm !== made.id) attempt.current = { pm: made.id, key: crypto.randomUUID() }
          let r = await payByLink(token, made.id, attempt.current.key)
          if (r.ok && r.payment.clientSecret) {
            const confirmed = await card.current?.confirm(r.payment.clientSecret)
            if (confirmed?.error) setError(confirmed.error)
            r = await checkLinkPayment(token, r.payment.id)
          }
          if (!r.ok) { setError(r.error); return }
          const p = r.payment
          if (p.status === 'succeeded') { setDone(`Paid. Your receipt number is ${p.ref}.`); router.refresh(); return }
          if (p.status === 'failed') { card.current?.reset(); attempt.current = null; setError(p.message || 'The card was declined.'); return }
          setDone(`Payment ${p.ref} is being processed by the bank. ${p.message ?? ''}`)
        })
      }}
    >
      <div className="sf-field">
        <CardField publishableKey={publishableKey} handleRef={card} label="Card" />
      </div>
      {error ? <p role="alert" className="sf-error">{error}</p> : null}
      {done ? <p className="sf-notice" data-testid="pay-result">{done}</p> : null}
      <button type="submit" className="sf-btn sf-btn-teal sf-btn-wide" disabled={pending || !publishableKey || !!done}>{pending ? 'Paying' : `Pay ${amount}`}</button>
    </form>
  )
}
