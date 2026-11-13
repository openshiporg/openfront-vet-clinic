import Link from 'next/link'
import { signOutAction } from '../actions'
import { clockLabel, phoneLabel } from '../lib/format'
import { currentClient } from '../server/session'
import { getSite, type SiteLocation } from '../server/site'

const DAYS: [string, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]

/** Hours as the practice entered them, with equal neighbouring days joined ("Monday to Friday"). */
export function hoursRows(location: SiteLocation): { days: string; hours: string }[] {
  const open = location.openHours
  if (!open || typeof open !== 'object') return []
  const rows: { from: string; to: string; hours: string }[] = []
  for (const [key, label] of DAYS) {
    const value = open[key]
    const hours = Array.isArray(value) && value.length === 2 ? `${clockLabel(String(value[0]))} to ${clockLabel(String(value[1]))}` : 'Closed'
    const last = rows[rows.length - 1]
    if (last && last.hours === hours) last.to = label
    else rows.push({ from: label, to: label, hours })
  }
  return rows.map(r => ({ days: r.from === r.to ? r.from : `${r.from} to ${r.to}`, hours: r.hours }))
}

export async function Footer() {
  const [site, client] = await Promise.all([getSite(), currentClient()])
  return (
    <footer className="sf-foot">
      <div className="sf-wrap">
        <div className="sf-foot-grid">
          {site.locations.map(location => (
            <section key={location.id}>
              <h2>{location.name}</h2>
              <p>{[location.addressLine1, location.addressLine2].filter(Boolean).join(', ')}</p>
              <p>{[location.city, location.stateCode.replace(/^US-/, ''), location.postalCode].filter(Boolean).join(' ')}</p>
              {location.phone ? <p><a href={`tel:${location.phone}`}>{phoneLabel(location.phone)}</a></p> : null}
              <dl style={{ marginTop: 8 }}>
                {hoursRows(location).map(row => (
                  <div key={row.days} style={{ display: 'contents' }}>
                    <dt>{row.days}</dt>
                    <dd>{row.hours}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section>
            <h2>Visit</h2>
            <ul>
              <li><Link href="/book">Book a visit</Link></li>
              <li><Link href="/refill">Refill a prescription</Link></li>
              <li><Link href="/services">Services</Link></li>
              <li><Link href="/wellness-plans">Wellness plans</Link></li>
              <li><Link href="/boarding">Boarding</Link></li>
              <li><Link href="/team">Our team</Link></li>
            </ul>
          </section>
          <section>
            <h2>Your account</h2>
            {client ? (
              <ul>
                <li><Link href="/account">My account</Link></li>
                <li>
                  <form action={signOutAction}>
                    <button type="submit" className="sf-textbtn">Sign out</button>
                  </form>
                </li>
              </ul>
            ) : (
              <ul>
                <li><Link href="/sign-in">Client sign in</Link></li>
                {site.newClientMode !== 'off' ? <li><Link href="/new-client">New client</Link></li> : null}
              </ul>
            )}
            <p style={{ marginTop: 10 }}><Link href="/dashboard">Staff sign in</Link></p>
          </section>
        </div>
        <p className="sf-foot-base">
          If your pet is having an emergency, call {site.main?.phone ? <a href={`tel:${site.main.phone}`}>{phoneLabel(site.main.phone)}</a> : 'us'} now. Online booking is for routine visits.
        </p>
      </div>
    </footer>
  )
}
