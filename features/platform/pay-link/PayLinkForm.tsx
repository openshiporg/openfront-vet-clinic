'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CardField, type CardHandle } from '../components/CardField';
import { checkLinkPayment, payByLink } from './actions';

export function PayLinkForm({ token, publishableKey, amount }: { token: string; publishableKey: string | null; amount: string }) {
  const router = useRouter();
  const card = React.useRef<CardHandle | null>(null);
  const attempt = React.useRef<{ pm: string; key: string } | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState('');
  const [done, setDone] = React.useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        start(async () => {
          const made = card.current ? await card.current.create() : { error: 'Card payments are not set up for this practice.' };
          if ('error' in made) { setError(made.error); return; }
          // One key per card typed: pressing Pay again after a lost answer repeats the same request, never a second charge.
          if (attempt.current?.pm !== made.id) attempt.current = { pm: made.id, key: crypto.randomUUID() };
          let r = await payByLink(token, made.id, attempt.current.key);
          if (r.ok && r.payment.clientSecret) {
            const confirmed = await card.current?.confirm(r.payment.clientSecret);
            if (confirmed?.error) setError(confirmed.error);
            r = await checkLinkPayment(token, r.payment.id);
          }
          if (!r.ok) { setError(r.error); return; }
          const p = r.payment;
          if (p.status === 'succeeded') { setDone(`Paid. Your receipt number is ${p.ref}.`); router.refresh(); return; }
          if (p.status === 'failed') { card.current?.reset(); attempt.current = null; setError(p.message || 'The card was declined.'); return; }
          setDone(`Payment ${p.ref} is being processed by the bank. ${p.message ?? ''}`);
        });
      }}
    >
      <CardField publishableKey={publishableKey} handleRef={card} label="Card" />
      <button type="submit" disabled={pending || !publishableKey || !!done} className="h-11 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">
        {pending ? 'Paying' : `Pay ${amount}`}
      </button>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {done ? <p className="text-sm text-emerald-700" data-testid="pay-result">{done}</p> : null}
    </form>
  );
}
