import Link from 'next/link'
import { Clock, Stethoscope } from 'lucide-react'
import { Arrow, BottleIcon, CalendarIcon, Chevron, Paw, PetAvatar, Spark, Swoosh } from '../components/art'
import { ageLabel, longDayLabel, money, phoneLabel, timeLabel } from '../lib/format'
import { nextOpenTimes } from '../server/availability'
import { myPets, type Pet } from '../server/portal'
import { currentClient } from '../server/session'
import { getFeaturedVisit, getSite, getWellnessExamPrice } from '../server/site'

/** What is due for a pet. The wide page reads "Due: Wellness exam"; the phone page reads "Wellness exam due". */
function DuePill({ pet }: { pet: Pet }) {
  if (!pet.due) return <span className="sf-pill sf-pill-quiet">Nothing due</span>
  const overdue = pet.due.status === 'overdue'
  return (
    <span className="sf-pill">
      <span className="sf-due-lead"><b>{overdue ? 'Overdue:' : 'Due:'}</b> </span>
      {pet.due.name}
      <span className="sf-due-tail"> {overdue ? 'overdue' : 'due'}</span>
    </span>
  )
}

function RowLink({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="sf-link">
      {icon}
      <span>{children}</span>
      <Arrow />
      <Chevron />
    </Link>
  )
}

const namesOf = (pets: Pet[]) => (pets.length === 1 ? pets[0].name : pets.length === 2 ? `${pets[0].name} and ${pets[1].name}` : 'your pets')

export default async function HomePage() {
  const [site, client, featured, price] = await Promise.all([getSite(), currentClient(), getFeaturedVisit(), getWellnessExamPrice()])
  const pets = client ? await myPets(client) : []
  const location = site.locations.find(l => l.id === client?.locationId) ?? site.main
  const open = location && featured && site.onlineBooking ? await nextOpenTimes(location.id, featured.id, 2) : null
  const today = open?.today ?? new Intl.DateTimeFormat('en-CA', { timeZone: site.timeZone }).format(new Date())
  const isToday = !!open?.date && open.date === today
  const anythingDue = pets.some(p => p.due)
  const bookHref = (startsAt: string) => {
    const q = new URLSearchParams({ type: featured?.id ?? '', loc: location?.id ?? '', at: startsAt })
    if (pets.length === 1) q.set('pet', pets[0].id)
    return `/book?${q.toString()}`
  }
  const calendar = <CalendarIcon className="sf-link-icon" />
  const bottle = <BottleIcon className="sf-link-icon" />

  return (
    <div className="sf-wrap">
      <div className="sf-hero">
        <Spark />
        {client ? (
          <h1>
            Hi {client.firstName}. {pets.length === 0 ? <>Let’s <span className="sf-under">add your pet.<Swoosh /></span></> : anythingDue ? <>Here’s <span className="sf-under">what’s due.<Swoosh /></span></> : <>Everyone’s <span className="sf-under">up to date.<Swoosh /></span></>}
          </h1>
        ) : (
          <h1>
            Hi there. Sign in to see <span className="sf-under">what’s due.<Swoosh /></span>
          </h1>
        )}
      </div>

      <div className="sf-home">
        <div className="sf-pets">
          {client && pets.map(pet => (
            <article key={pet.id} className="sf-pet">
              <PetAvatar speciesCode={pet.speciesCode} speciesName={pet.speciesName} photoUrl={pet.photoUrl} name={pet.name} />
              <span className="sf-pet-rule" aria-hidden="true" />
              <div className="sf-pet-info">
                <h2 className="sf-pet-name">{pet.name} <Paw /></h2>
                <p className="sf-pet-breed">
                  {pet.breedName || pet.speciesName}
                  {pet.dateOfBirth ? <span className="sf-age"> • {ageLabel(pet.dateOfBirth, today)}</span> : null}
                </p>
                <DuePill pet={pet} />
              </div>
              <div className="sf-pet-links">
                <RowLink href={`/book?pet=${pet.id}`} icon={calendar}>Book a visit</RowLink>
                <RowLink href={`/refill?pet=${pet.id}`} icon={bottle}>Refill a prescription</RowLink>
              </div>
            </article>
          ))}
          {client && pets.length === 0 ? (
            <article className="sf-pet sf-pet-entry">
              <span className="sf-avatar sf-avatar-plain" aria-hidden="true"><Paw className="sf-avatar-paw" /></span>
              <span className="sf-pet-rule" aria-hidden="true" />
              <div className="sf-pet-info">
                <h2 className="sf-pet-name">No pets yet</h2>
                <p className="sf-pet-breed">We have no pets on your account. Call us and we’ll add them.</p>
              </div>
              <div className="sf-pet-links">
                {location?.phone ? <a className="sf-link" href={`tel:${location.phone}`}><span>{phoneLabel(location.phone)}</span></a> : null}
              </div>
            </article>
          ) : null}
          {!client ? (
            <>
              <article className="sf-pet sf-pet-entry">
                <span className="sf-avatar sf-avatar-plain" aria-hidden="true"><CalendarIcon /></span>
                <span className="sf-pet-rule" aria-hidden="true" />
                <div className="sf-pet-info">
                  <h2 className="sf-pet-name">Book a visit</h2>
                  <p className="sf-pet-breed">Pick a pet, a reason and an open time.</p>
                </div>
                <div className="sf-pet-links">
                  <RowLink href="/sign-in?next=/book" icon={calendar}>Sign in to book</RowLink>
                  {site.newClientMode !== 'off' ? <RowLink href="/new-client" icon={<Paw className="sf-link-icon" />}>I’m a new client</RowLink> : null}
                </div>
              </article>
              <article className="sf-pet sf-pet-entry">
                <span className="sf-avatar sf-avatar-plain" aria-hidden="true"><BottleIcon /></span>
                <span className="sf-pet-rule" aria-hidden="true" />
                <div className="sf-pet-info">
                  <h2 className="sf-pet-name">Refill a prescription</h2>
                  <p className="sf-pet-breed">Pick a pet and the medication to pick up.</p>
                </div>
                <div className="sf-pet-links">
                  <RowLink href="/sign-in?next=/refill" icon={bottle}>Sign in to refill</RowLink>
                </div>
              </article>
            </>
          ) : null}
        </div>

        <section className="sf-times" aria-label="Open times">
          <h2 className="sf-times-head"><Clock aria-hidden="true" /> {isToday || !open?.date ? 'Today’s open times' : 'Next open times'}</h2>
          <h2 className="sf-times-phonehead"><CalendarIcon /> {isToday || !open?.date ? 'Open times today' : 'Next open times'}</h2>
          <div className="sf-times-body">
            {open?.times.map(time => (
              <Link key={time.startsAt} href={client ? bookHref(time.startsAt) : `/sign-in?next=${encodeURIComponent(bookHref(time.startsAt))}`} className="sf-time">
                {timeLabel(time.startsAt, open.timeZone)} <Chevron />
              </Link>
            ))}
            {open?.date && !isToday ? <p className="sf-times-note">On {longDayLabel(open.times[0].startsAt, open.timeZone)}.</p> : null}
            {!open?.times.length ? (
              <p className="sf-times-note">
                {site.onlineBooking && featured ? 'No open times online this week.' : 'Online booking is not open right now.'}
                {location?.phone ? <> Call <a href={`tel:${location.phone}`} style={{ fontWeight: 700, color: 'var(--sf-teal)' }}>{phoneLabel(location.phone)}</a>.</> : null}
              </p>
            ) : null}
          </div>
        </section>

        {featured ? (
          <Link href={client ? `/book?type=${featured.id}` : `/sign-in?next=${encodeURIComponent(`/book?type=${featured.id}`)}`} className="sf-band">
            <span className="sf-band-icon"><Stethoscope aria-hidden="true" /><Spark /></span>
            <span className="sf-band-rule" aria-hidden="true" />
            <span className="sf-band-title">{featured.name}{price ? <span className="sf-band-amount">: {money(price.priceMinor, price.currencyCode, 'auto')}</span> : null}</span>
            <span className="sf-band-text">
              {featured.description ? featured.description : (
                <>
                  <span className="sf-long">A complete checkup to keep {client && pets.length ? namesOf(pets) : 'your pet'} healthy and happy.</span>
                  <span className="sf-short">A thorough checkup to keep your pet healthy.</span>
                </>
              )}
            </span>
            {price ? <span className="sf-band-price">{money(price.priceMinor, price.currencyCode, 'auto')}</span> : null}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
