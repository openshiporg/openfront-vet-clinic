import { notFound } from 'next/navigation'
import { Check } from 'lucide-react'
import { money, phoneLabel } from '../lib/format'
import { getPlans, getSite, getSpecies } from '../server/site'

export const metadata = { title: 'Wellness plans' }

export default async function WellnessPlansPage() {
  const [site, plans, species] = await Promise.all([getSite(), getPlans(), getSpecies()])
  if (!site.offers.wellnessPlans) notFound()
  const speciesName = (code: string) => species.find(s => s.code === code)?.name ?? code
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Wellness plans</h1>
        <p className="sf-lede">A year of routine care for one monthly price.</p>
      </div>
      <div className="sf-stack-lg">
        <div className="sf-grid-3">
          {plans.map(plan => (
            <article key={plan.id} className="sf-card sf-stack">
              <h2 className="sf-h3">{plan.name}</h2>
              {plan.speciesCodes.length ? <p className="sf-row">{plan.speciesCodes.map(code => <span key={code} className="sf-tag sf-tag-mint">{speciesName(code)}</span>)}</p> : null}
              <p className="sf-price">{money(plan.monthlyPriceMinor, site.currencyCode, 'auto')} <small>a month for {plan.termMonths} months</small></p>
              {plan.summary ? <p>{plan.summary}</p> : null}
              <ul className="sf-ticks">
                {plan.entitlements.map(e => (
                  <li key={e.label}><Check aria-hidden="true" /><span>{e.qty > 1 ? `${e.qty} ` : ''}{e.qty > 1 ? e.label.toLowerCase() : e.label}</span></li>
                ))}
                {plan.discountBps > 0 ? <li><Check aria-hidden="true" /><span>{plan.discountBps / 100}% off other services</span></li> : null}
              </ul>
            </article>
          ))}
        </div>
        {!plans.length ? <p className="sf-card">We have no wellness plans open for enrolment right now.</p> : null}
        <section className="sf-card sf-card-yellow sf-between">
          <div>
            <h2 className="sf-h3">Ready to enrol?</h2>
            <p>We enrol your pet at the front desk, where you sign the plan agreement and choose the card for the monthly payment.</p>
          </div>
          {site.main?.phone ? <a href={`tel:${site.main.phone}`} className="sf-btn sf-btn-teal">{phoneLabel(site.main.phone)}</a> : null}
        </section>
      </div>
    </div>
  )
}
