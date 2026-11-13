import { cardPublishableKey } from '@/features/integrations/payment';
import { q } from '../lib/server';
import { money } from '../lib/format';
import { PayLinkForm } from './PayLinkForm';

type Link = { practice: string | null; ref: string; status: string; postedOn: string | null; totalMinor: string; balanceMinor: string; currencyCode: string } | null

/** The page a client opens from a payment link: the invoice, what is due, and Stripe's card form. No sign-in; the link is the permission. */
export default async function PayLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const token = decodeURIComponent((await params).token);
  const inv = await q<{ payLink: Link }>(`query ($t: String!) { payLink(token: $t) }`, { t: token }).then(d => d.payLink).catch(() => null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">{inv?.practice || 'Pay your invoice'}</h1>
      {!inv ? (
        <p className="text-sm text-muted-foreground">This payment link is not valid or has expired. Ask the practice for a new one.</p>
      ) : (
        <>
          <section className="rounded-lg border p-4 text-sm">
            <div className="flex justify-between"><span>Invoice</span><span className="font-medium">{inv.ref}</span></div>
            {inv.postedOn ? <div className="flex justify-between text-muted-foreground"><span>Date</span><span>{inv.postedOn}</span></div> : null}
            <div className="flex justify-between text-muted-foreground"><span>Invoice total</span><span>{money(inv.totalMinor, inv.currencyCode)}</span></div>
            <div className="mt-2 flex justify-between text-base font-semibold"><span>Amount due</span><span data-testid="amount-due">{money(inv.balanceMinor, inv.currencyCode)}</span></div>
          </section>
          {BigInt(inv.balanceMinor) > 0n ? (
            <PayLinkForm token={token} publishableKey={cardPublishableKey()} amount={money(inv.balanceMinor, inv.currencyCode)} />
          ) : (
            <p className="text-sm" data-testid="paid">{inv.status === 'paid' ? 'This invoice is paid. Thank you.' : 'There is nothing to pay on this invoice.'}</p>
          )}
        </>
      )}
    </main>
  );
}
