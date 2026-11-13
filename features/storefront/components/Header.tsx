import Link from 'next/link'
import { CalendarDays, Phone, PillBottle } from 'lucide-react'
import { phoneLabel } from '../lib/format'
import { currentClient } from '../server/session'
import { getSite, getVisitTypes } from '../server/site'
import { Logo } from './art'
import { NavLinks } from './NavLinks'

/** "Cedar Creek Animal Hospital" reads as two lines: the place, then what it is. */
function splitName(name: string): [string, string] {
  const words = name.trim().split(/\s+/)
  if (words.length < 3) return [name, '']
  const cut = words.length >= 4 ? Math.ceil(words.length / 2) : 1
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
}

export async function Header() {
  const [site, client, visits] = await Promise.all([getSite(), currentClient(), getVisitTypes()])
  const [first, second] = splitName(site.name)
  const phone = site.main?.phone ?? ''
  return (
    <header className="sf-wrap">
      <div className="sf-top">
        <Link href="/" className="sf-brand" aria-label={`${site.name} home`}>
          <Logo />
          <span className="sf-brand-text">
            <span className="sf-brand-name">{first}</span>
            {second ? <span className="sf-brand-sub">{second}</span> : null}
            {site.main?.city ? <span className="sf-brand-city">{site.main.city}</span> : null}
          </span>
        </Link>
        {phone ? (
          <a className="sf-phone" href={`tel:${phone}`}>
            <Phone aria-hidden="true" /> {phoneLabel(phone)}
          </a>
        ) : null}
      </div>
      <div className="sf-navrow">
        <NavLinks services={visits.map(v => ({ id: v.id, name: v.name }))} signedIn={!!client} />
        <div className="sf-cta">
          <Link href="/book" className="sf-btn sf-btn-yellow">
            <CalendarDays aria-hidden="true" /> Book a visit
          </Link>
          <Link href="/refill" className="sf-btn sf-btn-line">
            <PillBottle aria-hidden="true" /> Refill a prescription
          </Link>
        </div>
      </div>
    </header>
  )
}
