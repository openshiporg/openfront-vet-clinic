import Link from 'next/link'
import { CalendarIcon } from '../components/art'
import { money, phoneLabel, sentence } from '../lib/format'
import { getPrices, getSite, getVisitTypes } from '../server/site'

export const metadata = { title: 'Services' }

const lengthOf = (minutes: number) => (minutes >= 480 ? 'Drop-off for the day' : minutes >= 60 ? `${Math.round(minutes / 6) / 10} hours` : `${minutes} minutes`)

export default async function ServicesPage() {
  const [site, visits, prices] = await Promise.all([getSite(), getVisitTypes(), getPrices()])
  const groups = new Map<string, typeof prices>()
  for (const price of prices) groups.set(price.category, [...(groups.get(price.category) ?? []), price])
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Services</h1>
        <p className="sf-lede">Visits you can book online, and what our care costs.</p>
      </div>
      <div className="sf-stack-lg">
        <section>
          <div className="sf-grid-3">
            {visits.map(v => (
              <article key={v.id} id={`visit-${v.id}`} className="sf-card sf-stack">
                <h2 className="sf-h3">{v.name}</h2>
                <p className="sf-row"><span className="sf-tag sf-tag-mint">{lengthOf(v.durationMinutes)}</span>{v.mode === 'request' ? <span className="sf-tag">We confirm the day</span> : null}{v.newClients ? <span className="sf-tag">New clients welcome</span> : null}</p>
                {v.description ? <p>{v.description}</p> : null}
                <p style={{ marginTop: 'auto' }}><Link href={`/book?type=${v.id}`} className="sf-btn sf-btn-yellow sf-btn-small"><CalendarIcon /> {v.mode === 'request' ? 'Request' : 'Book'}</Link></p>
              </article>
            ))}
          </div>
          {!visits.length ? <p className="sf-card">Call us{site.main?.phone ? ` at ${phoneLabel(site.main.phone)}` : ''} to book a visit.</p> : null}
        </section>

        {prices.length ? (
          <section className="sf-stack">
            <h2 className="sf-h2">Prices</h2>
            <div className="sf-grid-2">
              {[...groups.entries()].map(([category, items]) => (
                <article key={category} className="sf-card">
                  <h3 className="sf-card-head">{sentence(category)}</h3>
                  <ul className="sf-list">
                    {items.map(item => (
                      <li key={item.code}><span>{item.name}</span><b style={{ color: 'var(--sf-ink)' }}>{money(item.priceMinor, item.currencyCode, 'auto')}</b></li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <p className="sf-muted sf-small">Prices are before tax. Your veterinarian gives you a written estimate before any treatment.</p>
          </section>
        ) : null}

        <section className="sf-card sf-card-yellow sf-between">
          <div>
            <h2 className="sf-h3">Is your pet sick or hurt?</h2>
            <p>Call us so we can see them sooner. For an emergency, call now.</p>
          </div>
          {site.main?.phone ? <a href={`tel:${site.main.phone}`} className="sf-btn sf-btn-teal">{phoneLabel(site.main.phone)}</a> : null}
        </section>
      </div>
    </div>
  )
}
