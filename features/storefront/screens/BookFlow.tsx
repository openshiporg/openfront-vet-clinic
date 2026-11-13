'use client'

import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, Check } from 'lucide-react'
import { bookVisitAction, openTimesAction } from '../actions'
import { PetAvatar } from '../components/art'
import { calendarDayLabel, longDayLabel, timeLabel } from '../lib/format'

type Pet = { id: string; name: string; speciesCode: string; speciesName: string; breedName: string }
type Visit = { id: string; name: string; description: string; durationMinutes: number; mode: 'book' | 'request' }
type Place = { id: string; name: string; city: string }
type Day = { date: string; times: { startsAt: string; endsAt: string; providerName: string }[] }
type Booked = { ref: string; status: string; startsAt: string }

export function BookFlow(props: {
  pets: Pet[]; visits: Visit[]; places: Place[]; initial: { petId: string | null; visitId: string | null; placeId: string | null; at: string | null }
  /** A new household's first visit is held until the practice confirms it. */
  firstVisitIsRequest: boolean
  phone: string
  timeZone: string
}) {
  const { pets, visits, places, initial } = props
  const [petIds, setPetIds] = React.useState<string[]>(() => (initial.petId && pets.some(p => p.id === initial.petId) ? [initial.petId] : pets.length === 1 ? [pets[0].id] : []))
  const [visitId, setVisitId] = React.useState<string | null>(() => (initial.visitId && visits.some(v => v.id === initial.visitId) ? initial.visitId : visits.length === 1 ? visits[0].id : null))
  const [placeId, setPlaceId] = React.useState<string>(() => (initial.placeId && places.some(p => p.id === initial.placeId) ? initial.placeId : places[0]?.id ?? ''))
  const [days, setDays] = React.useState<Day[]>([])
  const [zone, setZone] = React.useState(props.timeZone)
  const [lastDay, setLastDay] = React.useState('')
  const [date, setDate] = React.useState<string | null>(null)
  const [startsAt, setStartsAt] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [signIn, setSignIn] = React.useState(false)
  const [booked, setBooked] = React.useState<Booked | null>(null)
  const [pending, start] = React.useTransition()
  const attempt = React.useRef<{ sig: string; key: string } | null>(null)
  const wanted = React.useRef<string | null>(initial.at)
  const request = React.useRef(0)

  const visit = visits.find(v => v.id === visitId) ?? null
  const asRequest = visit?.mode === 'request' || props.firstVisitIsRequest

  const load = React.useCallback(async (typeId: string, locationId: string, from: string | null, append: boolean) => {
    const mine = ++request.current
    setLoading(true)
    setError('')
    const r = await openTimesAction({ locationId, appointmentTypeId: typeId, from })
    if (mine !== request.current) return
    setLoading(false)
    if (!r.ok) { setError(r.error); setSignIn(!!r.signIn); return }
    setZone(r.timeZone)
    setLastDay(r.lastDay)
    setDays(previous => (append ? [...previous, ...r.days.filter(d => !previous.some(p => p.date === d.date))] : r.days))
    if (!append) {
      const at = wanted.current
      wanted.current = null
      const match = at ? r.days.find(d => d.times.some(t => t.startsAt === at)) : null
      const first = match ?? r.days.find(d => d.times.length > 0) ?? null
      setDate(first?.date ?? null)
      setStartsAt(match && at ? at : null)
    }
  }, [])

  // A time picked on the home page opens the day it is on; otherwise the search starts today.
  React.useEffect(() => {
    if (!visitId || !placeId) return
    const at = wanted.current
    const from = at && !Number.isNaN(Date.parse(at)) ? new Intl.DateTimeFormat('en-CA', { timeZone: props.timeZone }).format(new Date(at)) : null
    void load(visitId, placeId, from, false)
  }, [visitId, placeId, load, props.timeZone])

  const day = days.find(d => d.date === date) ?? null
  const nextFrom = days.length ? new Date(Date.parse(`${days[days.length - 1].date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null
  const ready = petIds.length > 0 && !!visit && !!placeId && !!startsAt

  const togglePet = (id: string) => setPetIds(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]))

  const submit = () => {
    if (!ready || !visit || !startsAt) return
    setError('')
    const sig = `${placeId}|${visit.id}|${startsAt}|${[...petIds].sort().join(',')}|${reason}`
    // One key per choice: pressing the button again after a lost answer repeats the same request, never a second booking.
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() }
    const key = attempt.current.key
    start(async () => {
      const r = await bookVisitAction({ locationId: placeId, appointmentTypeId: visit.id, startsAt, patientIds: petIds, reason, idempotencyKey: key })
      if (!r.ok) {
        setError(r.error)
        setSignIn(!!r.signIn)
        if (/taken|no longer offered/i.test(r.error)) { setStartsAt(null); void load(visit.id, placeId, date, false) }
        return
      }
      setBooked({ ref: r.visit.ref, status: r.visit.status, startsAt: r.visit.startsAt })
    })
  }

  if (booked) {
    const names = pets.filter(p => petIds.includes(p.id)).map(p => p.name).join(' and ')
    return (
      <section className="sf-done sf-stack" data-testid="booked">
        <h2 className="sf-h2">{booked.status === 'requested' ? 'Request sent.' : 'You’re booked.'}</h2>
        <p style={{ fontSize: 22 }}>
          <b>{visit?.name}</b> for {names} on <b>{longDayLabel(booked.startsAt, zone)}</b> at <b>{timeLabel(booked.startsAt, zone)}</b>.
        </p>
        <p>
          {booked.status === 'requested' ? 'We’re holding this time for you. Our team will confirm it; you can check it any time under My account.' : 'Your time is saved. You can see or cancel it any time under My account.'} Your reference is <b data-testid="booked-ref">{booked.ref}</b>.
        </p>
        <div className="sf-row">
          <Link href="/account" className="sf-btn sf-btn-teal">My account</Link>
          <Link href="/" className="sf-btn sf-btn-line">Back to home</Link>
        </div>
      </section>
    )
  }

  return (
    <div className="sf-stack-lg">
      <section className="sf-card">
        <div className="sf-step"><span className="sf-step-no">1</span><h2 className="sf-h3">Who is the visit for?</h2></div>
        <div className="sf-choices">
          {pets.map(pet => (
            <button key={pet.id} type="button" className="sf-choice" aria-pressed={petIds.includes(pet.id)} onClick={() => togglePet(pet.id)}>
              <PetAvatar speciesCode={pet.speciesCode} speciesName={pet.speciesName} />
              <span>{pet.name}<small>{pet.breedName || pet.speciesName}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="sf-card">
        <div className="sf-step"><span className="sf-step-no">2</span><h2 className="sf-h3">What is the visit for?</h2></div>
        <div className="sf-choices">
          {visits.map(v => (
            <button key={v.id} type="button" className="sf-choice" aria-pressed={visitId === v.id} onClick={() => { setVisitId(v.id); setStartsAt(null) }}>
              <span>{v.name}<small>{v.durationMinutes >= 480 ? 'Drop-off for the day' : `${v.durationMinutes} minutes`}{v.mode === 'request' ? ' · we confirm the day with you' : ''}</small></span>
            </button>
          ))}
        </div>
        <p className="sf-muted sf-small" style={{ marginTop: 14 }}>Is your pet sick or hurt? Call {props.phone || 'us'} so we can see them sooner. For an emergency, call now.</p>
      </section>

      <section className="sf-card">
        <div className="sf-step"><span className="sf-step-no">3</span><h2 className="sf-h3">Pick an open time</h2></div>
        {places.length > 1 ? (
          <div className="sf-row" style={{ marginBottom: 16 }}>
            {places.map(place => (
              <button key={place.id} type="button" className="sf-choice" style={{ width: 'auto' }} aria-pressed={placeId === place.id} onClick={() => { setPlaceId(place.id); setStartsAt(null) }}>
                <span>{place.name}<small>{place.city}</small></span>
              </button>
            ))}
          </div>
        ) : null}
        {!visit ? <p className="sf-muted">Choose what the visit is for and we’ll show the open times.</p> : null}
        {visit && loading && !days.length ? <p className="sf-muted">Finding open times</p> : null}
        {visit && days.length ? (
          <div className="sf-stack">
            <div className="sf-days" role="group" aria-label="Day">
              {days.map(d => (
                <button key={d.date} type="button" className="sf-day" aria-pressed={date === d.date} disabled={!d.times.length} onClick={() => { setDate(d.date); setStartsAt(null) }}>
                  {calendarDayLabel(d.date)}
                  <small>{d.times.length ? `${d.times.length} open` : 'Full'}</small>
                </button>
              ))}
              {nextFrom && nextFrom <= lastDay ? (
                <button type="button" className="sf-day" disabled={loading} onClick={() => visit && void load(visit.id, placeId, nextFrom, true)}>
                  More days<small>{loading ? 'Loading' : 'Next week'}</small>
                </button>
              ) : null}
            </div>
            {day?.times.length ? (
              <div className="sf-slots" role="group" aria-label="Time">
                {day.times.map(t => (
                  <button key={t.startsAt} type="button" className="sf-slot" aria-pressed={startsAt === t.startsAt} onClick={() => setStartsAt(t.startsAt)}>
                    {timeLabel(t.startsAt, zone)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="sf-muted">No open times on the days shown. Try more days, or call {props.phone || 'us'}.</p>
            )}
          </div>
        ) : null}
        {visit && !loading && !days.length && !error ? <p className="sf-muted">No open times online right now. Call {props.phone || 'us'} and we’ll find one.</p> : null}
      </section>

      <section className="sf-card sf-card-yellow sf-stack">
        <div className="sf-step" style={{ marginBottom: 0 }}><span className="sf-step-no"><Check size={20} aria-hidden="true" /></span><h2 className="sf-h3">{asRequest ? 'Request this visit' : 'Book this visit'}</h2></div>
        {ready && visit && startsAt ? (
          <p style={{ fontSize: 21 }}>
            <b>{visit.name}</b> for {pets.filter(p => petIds.includes(p.id)).map(p => p.name).join(' and ')} on <b>{longDayLabel(startsAt, zone)}</b> at <b>{timeLabel(startsAt, zone)}</b>
            {day?.times.find(t => t.startsAt === startsAt)?.providerName ? <> with {day.times.find(t => t.startsAt === startsAt)?.providerName}</> : null}.
          </p>
        ) : (
          <p className="sf-muted">Choose {petIds.length ? '' : 'a pet, '}{visit ? '' : 'the reason, '}{startsAt ? '' : 'a time'} to finish.</p>
        )}
        <label className="sf-field">
          <span>Anything we should know?</span>
          <textarea className="sf-input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="Optional" />
        </label>
        {error ? <p role="alert" className="sf-error">{error} {signIn ? <Link href="/sign-in?next=/book" style={{ textDecoration: 'underline' }}>Sign in</Link> : null}</p> : null}
        <div>
          <button type="button" className="sf-btn sf-btn-teal" disabled={!ready || pending} onClick={submit}>
            <CalendarDays aria-hidden="true" /> {pending ? 'Saving' : asRequest ? 'Request this visit' : 'Book this visit'}
          </button>
        </div>
      </section>
    </div>
  )
}
