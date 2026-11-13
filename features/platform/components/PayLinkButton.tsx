'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { pillClass } from './ActionButton';
import { makeInvoicePayLink } from './payLinkAction';

/**
 * A payment link for one invoice, made when staff ask for it. The practice sends it to the client however it already reaches
 * them (this app sends nothing).
 */
export function PayLinkButton({ invoiceId, origin, className }: { invoiceId: string; origin: string; className?: string }) {
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [pending, start] = React.useTransition();
  if (!url) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <button type="button" disabled={pending} className={cn(pillClass, 'border')} onClick={() => start(async () => {
          const r = await makeInvoicePayLink(invoiceId);
          if (r.ok) setUrl(`${origin}/pay/${r.token}`); else setError(r.error);
        })}>{pending ? 'Making link' : 'Payment link for the client'}</button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:w-96">
        Payment link (send it to the client)
        <input readOnly value={url} data-testid="pay-link" onFocus={(e) => e.currentTarget.select()} className="h-11 rounded-md border bg-background px-2 font-mono text-xs text-foreground sm:h-8" />
      </label>
      <button type="button" className={cn(pillClass, 'border')} onClick={async () => { await navigator.clipboard.writeText(url).catch(() => undefined); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  );
}
