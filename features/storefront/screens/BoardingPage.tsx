import { money, phoneLabel } from '../lib/format'
import { getRuns, getSite, getSpecies } from '../server/site'

export const metadata = { title: 'Boarding' }

export default async function BoardingPage() {
  const [site, runs, species] = await Promise.all([getSite(), getRuns(), getSpecies()])
  const speciesName = (code: string) => species.find(s => s.code === code)?.name ?? code
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Boarding</h1>
        <p className="sf-lede">A safe stay with our medical team close by.</p>
      </div>
      <div className="sf-stack-lg">
        <div className="sf-grid-3">
          {runs.map(run => (
            <article key={run.id} className="sf-card sf-stack">
              <h2 className="sf-h3">{run.name}</h2>
              <p className="sf-row">
                {run.speciesCodes.map(code => <span key={code} className="sf-tag sf-tag-mint">{speciesName(code)}</span>)}
                {run.maxWeightKg ? <span className="sf-tag sf-tag-mint">Up to {Math.round(run.maxWeightKg * 2.20462)} lb</span> : null}
              </p>
              <p className="sf-price">{money(run.nightlyRateMinor, site.currencyCode, 'auto')} <small>a night</small></p>
              {BigInt(run.depositMinor) > 0n ? <p className="sf-muted">{money(run.depositMinor, site.currencyCode, 'auto')} deposit holds the stay.</p> : null}
              {run.locationName ? <p className="sf-muted sf-small">{run.locationName}</p> : null}
            </article>
          ))}
        </div>
        {!runs.length ? <p className="sf-card">We are not taking boarding stays right now.</p> : null}
        <section className="sf-card sf-card-yellow sf-between">
          <div>
            <h2 className="sf-h3">Reserve a stay</h2>
            <p>Call us with your dates. Pets need current vaccines to board; we’ll check your pet’s record with you.</p>
          </div>
          {site.main?.phone ? <a href={`tel:${site.main.phone}`} className="sf-btn sf-btn-teal">{phoneLabel(site.main.phone)}</a> : null}
        </section>
      </div>
    </div>
  )
}
