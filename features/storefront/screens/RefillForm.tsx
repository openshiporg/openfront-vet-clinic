'use client'

import * as React from 'react'
import Link from 'next/link'
import { PillBottle } from 'lucide-react'
import { requestRefillAction } from '../actions'
import { PetAvatar } from '../components/art'

type Pet = { id: string; name: string; speciesCode: string; speciesName: string; breedName: string }
type Medication = { id: string; patientId: string; name: string; directions: string }
type Place = { id: string; name: string }

export function RefillForm({ pets, medications, places, initialPetId, phone }: { pets: Pet[]; medications: Medication[]; places: Place[]; initialPetId: string | null; phone: string }) {
  const [petId, setPetId] = React.useState<string | null>(() => (initialPetId && pets.some(p => p.id === initialPetId) ? initialPetId : pets.length === 1 ? pets[0].id : null))
  const [product, setProduct] = React.useState('')
  const [placeId, setPlaceId] = React.useState(places[0]?.id ?? '')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState('')
  const [signIn, setSignIn] = React.useState(false)
  const [done, setDone] = React.useState<{ ref: string; existing: boolean } | null>(null)
  const [pending, start] = React.useTransition()
  const attempt = React.useRef<{ sig: string; key: string } | null>(null)

  const pet = pets.find(p => p.id === petId) ?? null
  const mine = medications.filter(m => m.patientId === petId)
  const ready = !!pet && product.trim().length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || !pet) return
    setError('')
    const place = places.find(p => p.id === placeId)
    const pharmacyNote = [place ? `Pickup at ${place.name}.` : '', note.trim()].filter(Boolean).join(' ')
    const sig = `${pet.id}|${product.trim()}|${pharmacyNote}`
    // One key per request: pressing the button again after a lost answer repeats the same request, never a second one.
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() }
    const key = attempt.current.key
    start(async () => {
      const r = await requestRefillAction({ patientId: pet.id, productText: product.trim(), pharmacyNote, idempotencyKey: key })
      if (!r.ok) { setError(r.error); setSignIn(!!r.signIn); return }
      setDone({ ref: r.refill.ref, existing: r.refill.existing })
    })
  }

  if (done && pet) {
    return (
      <section className="sf-done sf-stack" data-testid="refill-sent">
        <h2 className="sf-h2">{done.existing ? 'We already have this request.' : 'Refill request sent.'}</h2>
        <p style={{ fontSize: 22 }}><b>{product.trim()}</b> for {pet.name}.</p>
        <p>
          A veterinarian reviews every refill, usually within one business day. We’ll call you if {pet.name} needs an exam first. Your reference is <b data-testid="refill-ref">{done.ref}</b>; you can follow it under My account.
        </p>
        <div className="sf-row">
          <Link href="/account" className="sf-btn sf-btn-teal">My account</Link>
          <Link href="/" className="sf-btn sf-btn-line">Back to home</Link>
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={submit} className="sf-stack-lg">
      <section className="sf-card">
        <div className="sf-step"><span className="sf-step-no">1</span><h2 className="sf-h3">Which pet?</h2></div>
        <div className="sf-choices">
          {pets.map(p => (
            <button key={p.id} type="button" className="sf-choice" aria-pressed={petId === p.id} onClick={() => { setPetId(p.id); setProduct('') }}>
              <PetAvatar speciesCode={p.speciesCode} speciesName={p.speciesName} />
              <span>{p.name}<small>{p.breedName || p.speciesName}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="sf-card sf-stack">
        <div className="sf-step" style={{ marginBottom: 0 }}><span className="sf-step-no">2</span><h2 className="sf-h3">Which medication?</h2></div>
        {pet && mine.length ? (
          <div className="sf-choices">
            {mine.map(m => (
              <button key={m.id} type="button" className="sf-choice" aria-pressed={product === m.name} onClick={() => setProduct(m.name)}>
                <span>{m.name}{m.directions ? <small>{m.directions}</small> : null}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label className="sf-field">
          <span>{pet && mine.length ? 'Or type the medication' : 'Medication'}</span>
          <input className="sf-input" value={product} maxLength={300} onChange={e => setProduct(e.target.value)} placeholder="Name and strength, as on the label" disabled={!pet} />
          {!pet ? <small>Choose a pet first.</small> : null}
        </label>
      </section>

      <section className="sf-card sf-card-yellow sf-stack">
        <div className="sf-step" style={{ marginBottom: 0 }}><span className="sf-step-no">3</span><h2 className="sf-h3">Pickup</h2></div>
        {places.length > 1 ? (
          <div className="sf-row">
            {places.map(place => (
              <button key={place.id} type="button" className="sf-choice" style={{ width: 'auto' }} aria-pressed={placeId === place.id} onClick={() => setPlaceId(place.id)}>
                <span>{place.name}</span>
              </button>
            ))}
          </div>
        ) : places[0] ? <p>Pickup at <b>{places[0].name}</b>.</p> : null}
        <label className="sf-field">
          <span>Anything we should know?</span>
          <textarea className="sf-input" value={note} maxLength={400} onChange={e => setNote(e.target.value)} placeholder="Optional: how many you have left, or another pharmacy you want it sent to" />
        </label>
        {error ? <p role="alert" className="sf-error">{error} {signIn ? <Link href="/sign-in?next=/refill" style={{ textDecoration: 'underline' }}>Sign in</Link> : null}</p> : null}
        <div>
          <button type="submit" className="sf-btn sf-btn-teal" disabled={!ready || pending}>
            <PillBottle aria-hidden="true" /> {pending ? 'Sending' : 'Request this refill'}
          </button>
        </div>
        <p className="sf-muted sf-small">A veterinarian reviews every request. Some medications need a recent exam.{phone ? ` Questions? Call ${phone}.` : ''}</p>
      </section>
    </form>
  )
}
