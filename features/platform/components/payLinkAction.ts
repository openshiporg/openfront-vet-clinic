'use server';

import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

export async function makeInvoicePayLink(invoiceId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const r = await keystoneClient<{ invoicePayLink: string }>(`query ($id: ID!) { invoicePayLink(invoiceId: $id) }`, { id: invoiceId });
  return r.success && r.data.invoicePayLink ? { ok: true, token: r.data.invoicePayLink } : { ok: false, error: r.success ? 'No link was made.' : r.error };
}
