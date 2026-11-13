import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PawPrint } from 'lucide-react'
import { phoneLabel } from '../lib/format'
import { currentClient } from '../server/session'
import { getSite } from '../server/site'
import { SignInForm } from './SignInForm'

const safeNext = (next: unknown) => {
  const path = Array.isArray(next) ? String(next[0] ?? '') : String(next ?? '')
  return /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/.test(path) && !path.startsWith('/dashboard') && !path.startsWith('/api') ? path : '/'
}

export const metadata = { title: 'Client sign in' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next)
  const [site, client] = await Promise.all([getSite(), currentClient()])
  if (client) redirect(next)
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Client sign in</h1>
        <p className="sf-lede">See what your pets are due for, book a visit and refill a prescription.</p>
      </div>
      <div className="sf-split">
        <section className="sf-card sf-narrow">
          <SignInForm next={next} />
        </section>
        <aside className="sf-stack">
          {site.newClientMode !== 'off' ? (
            <section className="sf-card sf-card-yellow sf-stack">
              <h2 className="sf-h3">New to {site.name}?</h2>
              <p>Tell us about you and your pet and pick a time for your first visit.</p>
              <Link href="/new-client" className="sf-btn sf-btn-yellow"><PawPrint aria-hidden="true" /> I’m a new client</Link>
            </section>
          ) : null}
          <section className="sf-card sf-card-mint sf-stack">
            <h2 className="sf-h3">Can’t sign in?</h2>
            <p>We check the same details our front desk asks for on the phone. If yours have changed, call us{site.main?.phone ? <> at <a href={`tel:${site.main.phone}`} style={{ fontWeight: 700 }}>{phoneLabel(site.main.phone)}</a></> : null} and we’ll update them.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
