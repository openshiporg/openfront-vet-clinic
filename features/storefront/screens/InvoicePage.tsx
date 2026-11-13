import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { cardPublishableKey } from '@/features/integrations/payment'
import { calendarDayLabel, money, phoneLabel } from '../lib/format'
import { myBill } from '../server/portal'
import { currentClient } from '../server/session'
import { getSite } from '../server/site'
import { PayForm } from './PayForm'

export const metadata = { title: 'Pay a bill' }

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await currentClient()
  if (!client) redirect(`/sign-in?next=${encodeURIComponent(`/account/invoices/${id}`)}`)
  const [site, bill] = await Promise.all([getSite(), myBill(client, id)])
  if (!bill) notFound()
  const due = BigInt(bill.balanceMinor) > 0n
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">{due ? 'Pay your bill' : 'This bill is paid'}</h1>
        <p className="sf-lede">Invoice {bill.ref}{bill.postedOn ? ` from ${calendarDayLabel(bill.postedOn)}` : ''}.</p>
      </div>
      <div className="sf-split">
        <section className="sf-card sf-stack sf-narrow">
          <div className="sf-between"><span>Invoice total</span><span>{money(bill.totalMinor, bill.currencyCode)}</span></div>
          <div className="sf-between"><span className="sf-h3">Amount due</span><span className="sf-price" data-testid="amount-due">{money(bill.balanceMinor, bill.currencyCode)}</span></div>
          {due && bill.payToken ? (
            <PayForm token={bill.payToken} publishableKey={cardPublishableKey()} amount={money(bill.balanceMinor, bill.currencyCode)} />
          ) : due ? (
            <p className="sf-notice">Your sign-in can’t pay bills for this household. Call us{site.main?.phone ? ` at ${phoneLabel(site.main.phone)}` : ''} and we’ll help.</p>
          ) : (
            <p className="sf-notice" data-testid="paid">Thank you. Nothing more to pay on this invoice.</p>
          )}
        </section>
        <aside className="sf-card sf-card-mint sf-stack">
          <h2 className="sf-h3">Questions about this bill?</h2>
          <p>Call us{site.main?.phone ? <> at <a href={`tel:${site.main.phone}`} style={{ fontWeight: 700 }}>{phoneLabel(site.main.phone)}</a></> : null} and we’ll go through it with you.</p>
          <Link href="/account" className="sf-btn sf-btn-line">Back to my account</Link>
        </aside>
      </div>
    </div>
  )
}
