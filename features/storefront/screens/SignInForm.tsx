'use client'

import * as React from 'react'
import { signInAction } from '../actions'

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = React.useActionState(signInAction, null)
  return (
    <form action={action} className="sf-stack">
      <input type="hidden" name="next" value={next} />
      <label className="sf-field">
        <span>Phone number or email</span>
        <input className="sf-input" name="contact" autoComplete="username" inputMode="email" required placeholder="(916) 555-0131" />
        <small>The one we have on file for you.</small>
      </label>
      <label className="sf-field">
        <span>Your pet’s name</span>
        <input className="sf-input" name="petName" autoComplete="off" required />
      </label>
      <label className="sf-field">
        <span>Your pet’s date of birth</span>
        <input className="sf-input" name="petDateOfBirth" type="date" required />
        <small>As on your pet’s record. Any one of your pets will do.</small>
      </label>
      {state?.error ? <p role="alert" className="sf-error">{state.error}</p> : null}
      <button type="submit" className="sf-btn sf-btn-teal sf-btn-wide" disabled={pending}>{pending ? 'Checking' : 'Sign in'}</button>
    </form>
  )
}
