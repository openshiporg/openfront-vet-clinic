import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { signOutAction } from '../actions'
import { BottleIcon, CalendarIcon, Paw, PetAvatar } from '../components/art'
import { ageLabel, calendarDayLabel, longDayLabel, money, sentence, timeLabel } from '../lib/format'
import { myBills, myPets, myRefills, myVisits } from '../server/portal'
import { currentClient } from '../server/session'
import { getSite } from '../server/site'
import { CancelVisitButton } from './CancelVisitButton'

export const metadata = { title: 'My account' }

const VISIT_STATUS: Record<string, string> = { requested: 'Waiting for us to confirm', booked: 'Booked', confirmed: 'Confirmed', checked_in: 'Checked in', in_progress: 'In progress', ready_for_checkout: 'Ready for checkout' }
const REFILL_STATUS: Record<string, string> = { received: 'Received', in_review: 'With the veterinarian', fulfilled_under_existing_rx: 'Approved', approved_new_rx: 'Approved', denied: 'Not approved: we’ll call you', needs_exam: 'Needs an exam first', merged: 'Combined with another request' }

export default async function AccountPage() {
  const client = await currentClient()
  if (!client) redirect('/sign-in?next=/account')
  const [site, pets, visits, refills, bills] = await Promise.all([getSite(), myPets(client), myVisits(client), myRefills(client), myBills(client)])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: site.timeZone }).format(new Date())
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead sf-between">
        <div>
          <h1 className="sf-h1">Hi {client.firstName}.</h1>
          <p className="sf-lede">{client.clientStatus === 'prospect' ? 'Welcome. Our team will confirm your details at your first visit.' : 'Your pets, visits, refills and bills in one place.'}</p>
        </div>
        <form action={signOutAction}><button type="submit" className="sf-btn sf-btn-line sf-btn-small">Sign out</button></form>
      </div>

      <div className="sf-split">
        <div className="sf-stack-lg">
          <section className="sf-card">
            <h2 className="sf-card-head"><CalendarIcon /> Upcoming visits</h2>
            {visits.length ? (
              <ul className="sf-list">
                {visits.map(v => (
                  <li key={v.id} data-testid="visit">
                    <div>
                      <p className="sf-h3">{longDayLabel(v.startsAt, v.timeZone)} at {timeLabel(v.startsAt, v.timeZone)}</p>
                      <p>{v.typeName}{v.petNames.length ? ` for ${v.petNames.join(' and ')}` : ''}{v.providerName ? ` with ${v.providerName}` : ''}</p>
                      <p className="sf-muted sf-small">{v.locationName} · {v.ref}</p>
                    </div>
                    <div className="sf-row">
                      <span className={`sf-tag${v.status === 'requested' ? '' : ' sf-tag-mint'}`}>{VISIT_STATUS[v.status] ?? sentence(v.status)}</span>
                      {v.canCancel && client.canBook ? <CancelVisitButton appointmentId={v.id} version={v.version} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-muted">No upcoming visits.</p>
            )}
            <p style={{ marginTop: '0.8em' }}><Link href="/book" className="sf-btn sf-btn-yellow sf-btn-small"><CalendarIcon /> Book a visit</Link></p>
          </section>

          <section className="sf-card">
            <h2 className="sf-card-head"><Paw className="sf-icon" /> Your pets</h2>
            {pets.length ? (
              <ul className="sf-list">
                {pets.map(pet => (
                  <li key={pet.id}>
                    <div className="sf-row">
                      <PetAvatar speciesCode={pet.speciesCode} speciesName={pet.speciesName} photoUrl={pet.photoUrl} name={pet.name} small />
                      <div>
                        <p className="sf-h3">{pet.name}</p>
                        <p className="sf-muted">{[pet.breedName || pet.speciesName, ageLabel(pet.dateOfBirth, today)].filter(Boolean).join(' • ')}</p>
                        {pet.due ? <p className="sf-tag" style={{ marginTop: '0.35em' }}>{pet.due.name} {pet.due.status === 'overdue' ? 'overdue' : 'due'}</p> : null}
                      </div>
                    </div>
                    <div className="sf-row">
                      <Link href={`/book?pet=${pet.id}`} className="sf-textbtn">Book a visit</Link>
                      <Link href={`/refill?pet=${pet.id}`} className="sf-textbtn">Refill</Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-muted">We have no pets on your account yet.</p>
            )}
          </section>
        </div>

        <div className="sf-stack-lg">
          <section className="sf-card">
            <h2 className="sf-card-head"><Receipt aria-hidden="true" /> Bills to pay</h2>
            {bills.length ? (
              <ul className="sf-list">
                {bills.map(bill => (
                  <li key={bill.id} data-testid="bill">
                    <div>
                      <p className="sf-price">{money(bill.balanceMinor, bill.currencyCode)}</p>
                      <p className="sf-muted sf-small">{bill.ref}{bill.postedOn ? ` · ${calendarDayLabel(bill.postedOn)}` : ''}</p>
                    </div>
                    <Link href={`/account/invoices/${bill.id}`} className="sf-btn sf-btn-yellow sf-btn-small">Pay</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-muted">Nothing to pay.</p>
            )}
          </section>

          <section className="sf-card">
            <h2 className="sf-card-head"><BottleIcon /> Refill requests</h2>
            {refills.length ? (
              <ul className="sf-list">
                {refills.map(r => (
                  <li key={r.id} data-testid="refill">
                    <div>
                      <p style={{ fontWeight: 600 }}>{r.productText}</p>
                      <p className="sf-muted sf-small">{r.petName} · {r.ref}</p>
                    </div>
                    <span className="sf-tag sf-tag-mint">{REFILL_STATUS[r.status] ?? sentence(r.status)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-muted">No refill requests yet.</p>
            )}
            <p style={{ marginTop: '0.8em' }}><Link href="/refill" className="sf-btn sf-btn-line sf-btn-small"><BottleIcon /> Refill a prescription</Link></p>
          </section>
        </div>
      </div>
    </div>
  )
}
