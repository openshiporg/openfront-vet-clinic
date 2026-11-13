import { PawPrint } from 'lucide-react'
import { getTeam } from '../server/site'

export const metadata = { title: 'Our team' }

const GROUPS: [string, string][] = [['dvm', 'Veterinarians'], ['rvt', 'Veterinary technicians'], ['assistant', 'Veterinary assistants'], ['groomer', 'Groomers'], ['csr', 'Front desk'], ['manager', 'Practice management'], ['kennel', 'Kennel team']]

export default async function TeamPage() {
  const team = await getTeam()
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Our team</h1>
        <p className="sf-lede">The people who look after your pet.</p>
      </div>
      <div className="sf-stack-lg">
        {GROUPS.map(([kind, title]) => {
          const people = team.filter(m => m.kind === kind)
          if (!people.length) return null
          return (
            <section key={kind} className="sf-stack">
              <h2 className="sf-h2">{title}</h2>
              <div className="sf-grid-3">
                {people.map(person => (
                  <article key={person.id} className="sf-card sf-row" style={{ flexWrap: 'nowrap' }}>
                    <span className="sf-avatar sf-avatar-plain" style={{ width: 64, height: 64 }} aria-hidden="true"><PawPrint /></span>
                    <div>
                      <h3 className="sf-h3">{person.name}</h3>
                      <p className="sf-muted">{[person.credentials, person.locationName].filter(Boolean).join(' · ')}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
        {!team.length ? <p className="sf-card">Our team list is being updated.</p> : null}
      </div>
    </div>
  )
}
