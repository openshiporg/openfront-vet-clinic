'use server';

import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

/* The pay-link form's two calls, through GraphQL like every screen. The signed link is checked by the server on each. */

export type LinkPayment = { id: string; ref: string; status: string; message: string | null; clientSecret?: string };
type Result = { ok: true; payment: LinkPayment } | { ok: false; error: string };

export async function payByLink(token: string, paymentMethodId: string, idempotencyKey: string): Promise<Result> {
  const r = await keystoneClient<{ payByLink: LinkPayment }>(`mutation ($t: String!, $p: String!, $k: String!) { payByLink(token: $t, paymentMethodId: $p, idempotencyKey: $k) }`, { t: token, p: paymentMethodId, k: idempotencyKey });
  return r.success ? { ok: true, payment: r.data.payByLink } : { ok: false, error: r.error };
}

export async function checkLinkPayment(token: string, paymentId: string): Promise<Result> {
  const r = await keystoneClient<{ checkLinkPayment: LinkPayment }>(`mutation ($t: String!, $p: ID!) { checkLinkPayment(token: $t, paymentId: $p) }`, { t: token, p: paymentId });
  return r.success ? { ok: true, payment: r.data.checkLinkPayment } : { ok: false, error: r.error };
}
