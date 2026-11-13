'use client';

import * as React from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';

/*
 * The card is typed into Stripe's own field (Stripe Elements, as E-commerce's invoice payment does); the number never reaches
 * this app. `create()` turns what was typed into a payment method id for the server to charge, and `confirm()` lets the
 * cardholder finish 3-D Secure when their bank asks. Test or live follows the publishable key the server hands out.
 */

export type CardHandle = {
  /** A payment method id for the card typed in, made once and reused until the card is changed. */
  create: () => Promise<{ id: string } | { error: string }>;
  /** 3-D Secure: show the bank's check for a payment that needs it. */
  confirm: (clientSecret: string) => Promise<{ error?: string }>;
  /** The card was charged (or saved): the next payment needs it typed again. */
  reset: () => void;
};

const stripes = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripes.has(key)) stripes.set(key, loadStripe(key));
  return stripes.get(key)!;
};

export function CardField({ publishableKey, handleRef, label = 'Card' }: { publishableKey: string | null; handleRef: React.MutableRefObject<CardHandle | null>; label?: string }) {
  if (!publishableKey) {
    return <p className="w-full text-xs text-red-600">Card payments are not set up on this server: the practice owner adds the Stripe keys first.</p>;
  }
  return (
    <Elements stripe={stripeFor(publishableKey)}>
      <Inner handleRef={handleRef} label={label} />
    </Elements>
  );
}

function Inner({ handleRef, label }: { handleRef: React.MutableRefObject<CardHandle | null>; label: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const made = React.useRef<string | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    handleRef.current = {
      async create() {
        if (made.current) return { id: made.current };
        const card = elements?.getElement(CardElement);
        if (!stripe || !card) return { error: 'The card form is still loading.' };
        const r = await stripe.createPaymentMethod({ type: 'card', card });
        if (r.error || !r.paymentMethod) return { error: r.error?.message ?? 'The card could not be read.' };
        made.current = r.paymentMethod.id;
        return { id: r.paymentMethod.id };
      },
      async confirm(clientSecret) {
        if (!stripe) return { error: 'The card form is still loading.' };
        const r = await stripe.handleNextAction({ clientSecret });
        return r.error ? { error: r.error.message ?? 'The bank did not confirm the card.' } : {};
      },
      reset() {
        made.current = null;
        elements?.getElement(CardElement)?.clear();
      },
    };
    return () => { handleRef.current = null; };
  }, [stripe, elements, handleRef]);
  return (
    <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:w-96">
      {label}
      <div className="rounded-md border bg-background px-2 py-2.5" data-testid="card-element">
        <CardElement
          options={{ hidePostalCode: false, style: { base: { fontSize: '14px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' } } }}
          onChange={(e) => { made.current = null; setError(e.error?.message ?? ''); }}
        />
      </div>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}
