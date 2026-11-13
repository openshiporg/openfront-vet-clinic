'use client'

import * as React from 'react'
import { registerAction } from '../actions'

export function NewClientForm({ species, locations }: { species: { code: string; name: string }[]; locations: { id: string; name: string }[] }) {
  const [state, action, pending] = React.useActionState(registerAction, null)
  // One key for this form: sending it twice makes one household, never two.
  const [key] = React.useState(() => crypto.randomUUID())
  return (
    <form action={action} className="sf-stack">
      <input type="hidden" name="key" value={key} />
      <h2 className="sf-h3">About you</h2>
      <div className="sf-grid-2">
        <label className="sf-field"><span>First name</span><input className="sf-input" name="firstName" autoComplete="given-name" required maxLength={80} /></label>
        <label className="sf-field"><span>Last name</span><input className="sf-input" name="lastName" autoComplete="family-name" required maxLength={80} /></label>
        <label className="sf-field"><span>Mobile phone</span><input className="sf-input" name="phone" type="tel" autoComplete="tel" required placeholder="(916) 555-0131" /></label>
        <label className="sf-field"><span>Email</span><input className="sf-input" name="email" type="email" autoComplete="email" /><small>Optional.</small></label>
      </div>
      <h2 className="sf-h3" style={{ marginTop: 8 }}>About your pet</h2>
      <div className="sf-grid-2">
        <label className="sf-field"><span>Pet’s name</span><input className="sf-input" name="petName" required maxLength={80} /></label>
        <label className="sf-field">
          <span>Kind of animal</span>
          <select className="sf-input" name="speciesCode" required defaultValue="">
            <option value="" disabled>Choose</option>
            {species.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="sf-field"><span>Breed</span><input className="sf-input" name="breedName" maxLength={80} /><small>Optional.</small></label>
        <label className="sf-field"><span>Date of birth</span><input className="sf-input" name="petDateOfBirth" type="date" required /><small>A best guess is fine. You’ll use it to sign in.</small></label>
      </div>
      {locations.length > 1 ? (
        <label className="sf-field">
          <span>Which location?</span>
          <select className="sf-input" name="locationId" defaultValue={locations[0].id}>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      ) : null}
      {state?.error ? <p role="alert" className="sf-error">{state.error}</p> : null}
      <button type="submit" className="sf-btn sf-btn-teal" disabled={pending}>{pending ? 'Saving' : 'Continue to pick a time'}</button>
    </form>
  )
}
