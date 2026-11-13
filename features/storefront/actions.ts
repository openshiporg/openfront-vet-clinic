'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isDomainError } from '@/features/keystone/lib/errors'
import { openTimes, type OpenDay } from './server/availability'
import { bookVisit, cancelVisit, registerNewClient, requestRefill, type BookedVisit, type RefillReceipt } from './server/portal'
import { countOne, currentClient, signInClient, signOutClient, startSession, visitorAddress } from './server/session'
import { getSite } from './server/site'

/* The client site's server actions. Each one checks the signed-in client itself; nothing here trusts an id sent by the browser. */

type Fail = { ok: false; error: string; signIn?: boolean }
const SIGN_IN: Fail = { ok: false, error: 'Your sign-in has ended. Sign in again to continue.', signIn: true }

function failure(error: unknown): Fail {
  if (isDomainError(error)) return { ok: false, error: error.message }
  console.error('Client site action failed:', error instanceof Error ? error.message.slice(0, 300).replace(/postgres(ql)?:\/\/\S+/g, '<url>') : 'unknown error')
  return { ok: false, error: 'We could not complete that just now. Please try again, or call us.' }
}

/** Only same-site paths are followed after sign-in. */
const safeNext = (next: unknown) => {
  const path = String(next ?? '')
  return /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/.test(path) && !path.startsWith('/dashboard') && !path.startsWith('/api') ? path : '/'
}

export async function signInAction(_prev: Fail | null, form: FormData): Promise<Fail | null> {
  let result: Awaited<ReturnType<typeof signInClient>>
  try {
    result = await signInClient({ contact: String(form.get('contact') ?? ''), petName: String(form.get('petName') ?? ''), petDateOfBirth: String(form.get('petDateOfBirth') ?? '') })
  } catch (error) {
    return failure(error)
  }
  if (!result.ok) return { ok: false, error: result.error }
  redirect(safeNext(form.get('next')))
}

export async function signOutAction() {
  await signOutClient()
  redirect('/')
}

export async function registerAction(_prev: Fail | null, form: FormData): Promise<Fail | null> {
  try {
    // A new household is real work for the front desk: at most 4 from one address in an hour.
    if ((await countOne(`client-register:addr:${await visitorAddress()}`, 60)) > 4) return { ok: false, error: 'Too many registrations from here. Please call us and we will set you up.' }
    const site = await getSite()
    const locationId = String(form.get('locationId') ?? '') || site.main?.id || ''
    const made = await registerNewClient({
      firstName: String(form.get('firstName') ?? ''), lastName: String(form.get('lastName') ?? ''), phone: String(form.get('phone') ?? ''), email: String(form.get('email') ?? ''),
      petName: String(form.get('petName') ?? ''), speciesCode: String(form.get('speciesCode') ?? ''), breedName: String(form.get('breedName') ?? ''), petDateOfBirth: String(form.get('petDateOfBirth') ?? ''),
      locationId, idempotencyKey: String(form.get('key') ?? ''),
    })
    await startSession(made.personId, made.contactPointId)
  } catch (error) {
    return failure(error)
  }
  redirect('/book')
}

export async function openTimesAction(input: { locationId: string; appointmentTypeId: string; from: string | null }): Promise<{ ok: true; timeZone: string; today: string; lastDay: string; days: OpenDay[] } | Fail> {
  try {
    if (!(await currentClient())) return SIGN_IN
    const found = await openTimes({ locationId: String(input.locationId), appointmentTypeId: String(input.appointmentTypeId), from: input.from, days: 7, perDay: 40 })
    // The signed slot stays on the server: the browser picks a start time and booking finds the slot again.
    return { ok: true, timeZone: found.timeZone, today: found.today, lastDay: found.lastDay, days: found.days.map(d => ({ date: d.date, times: d.times.map(t => ({ ...t, slotToken: '' })) })) }
  } catch (error) {
    return failure(error)
  }
}

export async function bookVisitAction(input: { locationId: string; appointmentTypeId: string; startsAt: string; patientIds: string[]; reason: string; idempotencyKey: string }): Promise<{ ok: true; visit: BookedVisit } | Fail> {
  try {
    const client = await currentClient()
    if (!client) return SIGN_IN
    const visit = await bookVisit(client, input)
    revalidatePath('/')
    revalidatePath('/account')
    return { ok: true, visit }
  } catch (error) {
    return failure(error)
  }
}

export async function cancelVisitAction(input: { appointmentId: string; expectedVersion: number; idempotencyKey: string }): Promise<{ ok: true } | Fail> {
  try {
    const client = await currentClient()
    if (!client) return SIGN_IN
    await cancelVisit(client, input)
    revalidatePath('/')
    revalidatePath('/account')
    return { ok: true }
  } catch (error) {
    return failure(error)
  }
}

export async function requestRefillAction(input: { patientId: string; productText: string; pharmacyNote: string; idempotencyKey: string }): Promise<{ ok: true; refill: RefillReceipt } | Fail> {
  try {
    const client = await currentClient()
    if (!client) return SIGN_IN
    const refill = await requestRefill(client, input)
    revalidatePath('/account')
    return { ok: true, refill }
  } catch (error) {
    return failure(error)
  }
}
