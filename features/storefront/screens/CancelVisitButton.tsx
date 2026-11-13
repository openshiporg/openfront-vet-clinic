'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cancelVisitAction } from '../actions'

export function CancelVisitButton({ appointmentId, version }: { appointmentId: string; version: number }) {
  const router = useRouter()
  const [asking, setAsking] = React.useState(false)
  const [error, setError] = React.useState('')
  const [pending, start] = React.useTransition()
  const key = React.useRef<string | null>(null)
  if (!asking) return <button type="button" className="sf-textbtn" onClick={() => setAsking(true)}>Cancel visit</button>
  return (
    <span className="sf-row">
      <button
        type="button" className="sf-btn sf-btn-small sf-btn-teal" disabled={pending}
        onClick={() => {
          setError('')
          key.current ??= crypto.randomUUID()
          const k = key.current
          start(async () => {
            const r = await cancelVisitAction({ appointmentId, expectedVersion: version, idempotencyKey: k })
            if (!r.ok) { setError(r.error); key.current = null; router.refresh(); return }
            router.refresh()
          })
        }}
      >
        {pending ? 'Cancelling' : 'Yes, cancel it'}
      </button>
      <button type="button" className="sf-btn sf-btn-small sf-btn-line" disabled={pending} onClick={() => setAsking(false)}>Keep it</button>
      {error ? <span role="alert" className="sf-error">{error}</span> : null}
    </span>
  )
}
