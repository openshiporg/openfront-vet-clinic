'use client'

import React, { useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { GraphQLClient } from 'graphql-request'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { completeOnboarding, startOnboarding } from '../actions/onboarding'
import { SETUP_SECTIONS } from '../config/sections'

type Step = 'review' | 'running' | 'done'

const errorText = (e: any) => e?.response?.errors?.map((x: any) => x.message).join('\n') || e?.message || 'Setup did not finish.'

const OnboardingDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<Step>('review')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Record<string, number> | null>(null)
  // Optional sections (the in-house lab catalog) are offered ticked; unticked ones are not run.
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  // One key per dialog: a retry after a dropped connection replays instead of running twice.
  const key = useRef(`setup-${crypto.randomUUID()}`)
  const running = useRef(false)

  if (!isOpen) return null

  const run = async () => {
    if (running.current) return
    running.current = true
    setError(null)
    setStep('running')
    try {
      const started = await startOnboarding()
      if (!started.success) throw new Error(started.error || 'Could not record setup progress')
      const client = new GraphQLClient(`${window.location.origin}/api/graphql`, { headers: { 'Content-Type': 'application/json' } })
      for (const section of SETUP_SECTIONS.filter(x => !skipped.has(x.id))) {
        const result: any = await client.request(section.mutation, { idempotencyKey: `${key.current}:${section.id}` })
        const payload = result?.[section.field]
        if (!payload?.created) throw new Error(`${section.title} did not return a result`)
        setCreated(prev => ({ ...(prev ?? {}), ...payload.created }))
      }
      const completed = await completeOnboarding()
      if (!completed.success) throw new Error(completed.error || 'Could not complete setup')
      setStep('done')
    } catch (e) {
      setError(errorText(e))
      setStep('review')
    } finally {
      running.current = false
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
          <DialogTitle>Practice setup</DialogTitle>
          <DialogDescription>Loads Cedar Creek Animal Hospital, a fictitious practice in Sacramento with a satellite clinic in Elk Grove, so you can explore every screen with real-looking records. Every person, licence and DEA number is made up. Existing records are kept; loading again changes nothing.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {SETUP_SECTIONS.map(section => (
            <div key={section.id} className="space-y-2">
              {'optional' in section && section.optional ? (
                <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <input type="checkbox" className="h-4 w-4" disabled={step !== 'review'} checked={!skipped.has(section.id)} onChange={e => setSkipped(prev => { const next = new Set(prev); if (e.target.checked) next.delete(section.id); else next.add(section.id); return next })} />
                  {section.title} <span className="normal-case tracking-normal">(optional)</span>
                </label>
              ) : <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</p>}
              <ul className={`grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 ${skipped.has(section.id) ? 'opacity-50' : ''}`}>
                {section.items.map(item => (
                  <li key={item} className="flex min-w-0 items-center gap-2">
                    {skipped.has(section.id) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" /> : step === 'done' ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : step === 'running' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
                    <span className="truncate">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {step === 'done' && created ? (
            <p className="text-sm text-muted-foreground">
              Created {Object.entries(created).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(', ') || 'nothing new (already loaded)'}.
            </p>
          ) : null}
          {step === 'done' ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="/dashboard/platform/settings" className="font-medium underline underline-offset-4" onClick={onClose}>Practice settings</Link>
              <Link href="/dashboard/platform/policies" className="font-medium underline underline-offset-4" onClick={onClose}>Policy packs</Link>
              <Link href="/dashboard/platform/approvals" className="font-medium underline underline-offset-4" onClick={onClose}>Approvals</Link>
              <Link href="/dashboard/platform/laboratories" className="font-medium underline underline-offset-4" onClick={onClose}>Lab set-up</Link>
              <Link href="/dashboard/AuditEvents" className="font-medium underline underline-offset-4" onClick={onClose}>Audit log</Link>
            </div>
          ) : null}
        </div>
        {error ? <p className="break-words border-t px-4 py-3 text-sm text-red-600 sm:px-6">{error} Saved records are reused when you retry.</p> : null}
        <div className="flex shrink-0 gap-2 border-t p-4">
          {step === 'done' ? (
            <DialogClose asChild><Button className="flex-1">Close</Button></DialogClose>
          ) : (
            <>
              <DialogClose asChild><Button variant="ghost" disabled={step === 'running'} className="flex-1">Cancel</Button></DialogClose>
              {step === 'running' ? <Button disabled className="flex-1"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading</Button> : <Button onClick={run} className="flex-1">{error ? 'Retry setup' : 'Load Cedar Creek Animal Hospital'}</Button>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default OnboardingDialog
