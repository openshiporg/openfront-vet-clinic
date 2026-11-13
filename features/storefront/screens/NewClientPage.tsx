import Link from 'next/link'
import { redirect } from 'next/navigation'
import { phoneLabel } from '../lib/format'
import { currentClient } from '../server/session'
import { getSite, getSpecies } from '../server/site'
import { NewClientForm } from './NewClientForm'

export const metadata = { title: 'New client' }

export default async function NewClientPage() {
  const [site, client, species] = await Promise.all([getSite(), currentClient(), getSpecies()])
  if (client) redirect('/book')
  const byPhone = site.newClientMode === 'off' || !site.main
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Welcome. Let’s meet your pet.</h1>
        <p className="sf-lede">
          {byPhone ? 'We set up new clients by phone.' : site.newClientMode === 'request' ? 'Tell us about you and your pet, then pick a time. Our team confirms your first visit.' : 'Tell us about you and your pet, then pick a time for your first visit.'}
        </p>
      </div>
      <div className="sf-split">
        <section className="sf-card">
          {byPhone ? (
            <p>Call us{site.main?.phone ? <> at <a href={`tel:${site.main.phone}`} style={{ fontWeight: 700 }}>{phoneLabel(site.main.phone)}</a></> : null} and we’ll get you booked.</p>
          ) : (
            <NewClientForm species={species} locations={site.locations.map(l => ({ id: l.id, name: l.name }))} />
          )}
        </section>
        <aside className="sf-card sf-card-mint sf-stack">
          <h2 className="sf-h3">Already a client?</h2>
          <p>Sign in with the phone number or email we have on file.</p>
          <Link href="/sign-in" className="sf-btn sf-btn-line">Client sign in</Link>
        </aside>
      </div>
    </div>
  )
}
