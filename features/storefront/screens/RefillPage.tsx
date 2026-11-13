import { redirect } from 'next/navigation'
import { phoneLabel } from '../lib/format'
import { myMedications, myPets } from '../server/portal'
import { currentClient } from '../server/session'
import { getSite } from '../server/site'
import { RefillForm } from './RefillForm'

export const metadata = { title: 'Refill a prescription' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

export default async function RefillPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const petParam = one((await searchParams).pet)
  const client = await currentClient()
  if (!client) redirect(`/sign-in?next=${encodeURIComponent(`/refill${petParam ? `?pet=${encodeURIComponent(petParam)}` : ''}`)}`)
  const [site, pets] = await Promise.all([getSite(), myPets(client)])
  const medications = await myMedications(client, pets.map(p => p.id))
  const phone = phoneLabel(site.main?.phone)
  const mineFirst = [...site.locations].sort((a, b) => Number(b.id === client.locationId) - Number(a.id === client.locationId))
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">Refill a prescription</h1>
        <p className="sf-lede">Pick your pet and the medication. We’ll have it ready for pickup once a veterinarian approves it.</p>
      </div>
      {!pets.length ? (
        <section className="sf-card"><p>We have no pets on your account yet. Call us{phone ? ` at ${phone}` : ''} and we’ll help.</p></section>
      ) : (
        <RefillForm
          pets={pets.map(p => ({ id: p.id, name: p.name, speciesCode: p.speciesCode, speciesName: p.speciesName, breedName: p.breedName }))}
          medications={medications.map(m => ({ id: m.id, patientId: m.patientId, name: m.name, directions: m.directions }))}
          places={mineFirst.map(l => ({ id: l.id, name: l.name }))}
          initialPetId={petParam}
          phone={phone}
        />
      )}
    </div>
  )
}
