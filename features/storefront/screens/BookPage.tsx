import { redirect } from 'next/navigation'
import { phoneLabel } from '../lib/format'
import { myPets } from '../server/portal'
import { currentClient } from '../server/session'
import { getSite, getVisitTypes } from '../server/site'
import { BookFlow } from './BookFlow'

export const metadata = { title: 'Book a visit' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const client = await currentClient()
  if (!client) {
    const q = new URLSearchParams()
    for (const key of ['pet', 'type', 'loc', 'at']) { const v = one(params[key]); if (v) q.set(key, v) }
    redirect(`/sign-in?next=${encodeURIComponent(`/book${q.size ? `?${q.toString()}` : ''}`)}`)
  }
  const [site, pets, allVisits] = await Promise.all([getSite(), myPets(client), getVisitTypes()])
  const prospect = client.clientStatus === 'prospect'
  const visits = prospect ? allVisits.filter(v => v.newClients) : allVisits
  const phone = phoneLabel(site.main?.phone)
  const closed = !site.onlineBooking || !site.main || (prospect && site.newClientMode === 'off')

  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Book a visit</h1>
        <p className="sf-lede">{prospect ? 'Welcome. Pick a time for your first visit.' : 'Pick your pet, the reason and an open time.'}</p>
      </div>
      {closed ? (
        <section className="sf-card"><p>Online booking is not open right now. Call us{phone ? ` at ${phone}` : ''} and we’ll book your visit.</p></section>
      ) : !client.canBook ? (
        <section className="sf-card"><p>Your sign-in can’t book visits for this household. Call us{phone ? ` at ${phone}` : ''} and we’ll help.</p></section>
      ) : !pets.length ? (
        <section className="sf-card"><p>We have no pets on your account yet. Call us{phone ? ` at ${phone}` : ''} and we’ll add them.</p></section>
      ) : !visits.length ? (
        <section className="sf-card"><p>No visits can be booked online right now. Call us{phone ? ` at ${phone}` : ''} and we’ll book you in.</p></section>
      ) : (
        <BookFlow
          pets={pets.map(p => ({ id: p.id, name: p.name, speciesCode: p.speciesCode, speciesName: p.speciesName, breedName: p.breedName }))}
          visits={visits.map(v => ({ id: v.id, name: v.name, description: v.description, durationMinutes: v.durationMinutes, mode: v.mode }))}
          places={site.locations.map(l => ({ id: l.id, name: l.name, city: l.city }))}
          initial={{ petId: one(params.pet), visitId: one(params.type), placeId: one(params.loc) ?? client.locationId, at: one(params.at) }}
          firstVisitIsRequest={prospect && site.newClientMode === 'request'}
          phone={phone}
          timeZone={site.timeZone}
        />
      )}
    </div>
  )
}
