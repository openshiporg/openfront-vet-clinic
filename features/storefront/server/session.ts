import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { contactHash, normaliseEmail, normalisePhone } from '@/features/keystone/domain/contact'
import { isDomainError } from '@/features/keystone/lib/errors'
import { runInTransaction } from '@/features/keystone/lib/unitOfWork'
import { clientAddress } from '@/features/keystone/security/signInLimit'
import { db } from './db'

/*
 * Client sign-in. The practice sends no texts or emails, so a client proves who they are the way the front desk and
 * the AI receptionist already check a caller: a phone number or email on file, plus a pet's name and date of birth
 * (verification method `pet_name_dob`). A sign-in is a PortalSession row; the browser holds a random token in an
 * http-only cookie and the database holds only its hash.
 *
 * Guessing is limited by the same rule as staff sign-in (AGENTS.md), counted in RateLimitBucket:
 * - per address: 20 tries in 15 minutes;
 * - per contact and address: 5 wrong tries in 15 minutes (only that address is refused, so nobody can lock a client out
 *   from somewhere else);
 * - per contact from addresses that never signed in with it: after 10 wrong tries in 15 minutes, each further new
 *   address gets one try per 15 minutes (a delay, never a block: a first try always runs);
 * - an address that signed in with the contact in the last 90 days skips the address count and the slow-down.
 */

const COOKIE = 'vc_client'
const SESSION_DAYS = 14
const WINDOW_MINUTES = 15
const ADDRESS_ATTEMPTS = 20
const PAIR_FAILURES = 5
const CONTACT_SLOW_AFTER = 10
const KNOWN_DAYS = 90

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const tokenHash = (token: string) => sha(`client-session:${token}`)

export type SignedInClient = {
  sessionId: string
  personId: string
  firstName: string
  lastName: string
  canBook: boolean
  canPay: boolean
  clientId: string
  clientRef: string
  /** `prospect` is a new household staff have not confirmed yet. */
  clientStatus: 'active' | 'prospect'
  locationId: string | null
}

/** The signed-in client for this request, or null. */
export const currentClient = cache(async (): Promise<SignedInClient | null> => {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null
  const row = await db().portalSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true, status: true, expiresAt: true,
      person: { select: { id: true, firstName: true, lastName: true, canBook: true, canPay: true, client: { select: { id: true, ref: true, status: true, primaryLocationId: true } } } },
    },
  })
  const client = row?.person?.client
  if (!row || row.status !== 'verified' || row.expiresAt <= new Date() || !client) return null
  if (client.status !== 'active' && client.status !== 'prospect') return null
  return {
    sessionId: row.id, personId: row.person.id, firstName: row.person.firstName, lastName: row.person.lastName, canBook: row.person.canBook, canPay: row.person.canPay,
    clientId: client.id, clientRef: client.ref, clientStatus: client.status, locationId: client.primaryLocationId ?? null,
  }
})

/** The visitor's address as the staff sign-in limiter identifies it (a hash; one shared value when there is none). */
export async function visitorAddress() {
  const h = await headers()
  return clientAddress({ headers: Object.fromEntries(h.entries()) })
}

/** Count one against a key and return the count in its current window (one atomic statement, like the staff limiter). */
export async function countOne(key: string, windowMinutes = WINDOW_MINUTES): Promise<number> {
  const rows = (await db().$queryRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES (${randomUUID()}, ${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${windowMinutes}::int) THEN 1 ELSE COALESCE("RateLimitBucket"."count", 0) + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${windowMinutes}::int) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`) as { count: number }[]
  return Number(rows[0]?.count ?? 0)
}

/** The count in a key's current window, without adding to it. */
async function countOf(key: string, windowMinutes = WINDOW_MINUTES) {
  const row = await db().rateLimitBucket.findUnique({ where: { key }, select: { windowStart: true, count: true } })
  return row && Date.now() - row.windowStart.getTime() < windowMinutes * 60_000 ? row.count ?? 0 : 0
}

/** Delete this site's expired limiter rows (the staff limiter sweeps only its own). */
async function sweep() {
  await db().rateLimitBucket.deleteMany({ where: { key: { startsWith: 'client-' }, windowStart: { lt: new Date(Date.now() - 60 * 60_000) } } })
}

/** Start a signed-in session for a person and set the cookie. */
export async function startSession(personId: string, contactPointId: string | null) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  await db().portalSession.create({ data: { personId, contactPointId, tokenHash: tokenHash(token), status: 'verified', verifiedAt: now, expiresAt, ipHash: await visitorAddress() } })
  ;(await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAYS * 86_400 })
}

const WRONG = 'Those details do not match our records. Check the phone number or email we have on file, your pet’s name and their date of birth, or call us.'
const SLOW = 'Too many tries. Wait 15 minutes and try again, or call us.'

export async function signInClient(input: { contact: string; petName: string; petDateOfBirth: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = String(input.contact ?? '').trim()
  const petName = String(input.petName ?? '').trim()
  const dob = String(input.petDateOfBirth ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter the phone number or email we have on file.' }
  if (!petName) return { ok: false, error: 'Enter your pet’s name.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(`${dob}T00:00:00Z`))) return { ok: false, error: 'Enter your pet’s date of birth.' }
  let contact: string
  try {
    contact = raw.includes('@') ? normaliseEmail(raw) : normalisePhone(raw)
  } catch (error) {
    return { ok: false, error: isDomainError(error) ? error.message : 'Enter a phone number with area code, or an email address.' }
  }
  const address = await visitorAddress()
  const hash = contactHash(contact)
  const short = hash.slice(0, 40)
  const addressKey = `client-signin:addr:${address}`
  const pairKey = `client-signin:pair:${short}:${address}`
  const contactKey = `client-signin:contact:${short}`

  await sweep().catch(() => undefined)
  // An address that signed in with this contact in the last 90 days is known: it skips the address count and the slow-down.
  const known = (await db().portalSession.count({ where: { ipHash: address, contactPoint: { valueHash: hash }, verifiedAt: { gte: new Date(Date.now() - KNOWN_DAYS * 86_400_000) } } })) > 0
  if (!known && (await countOne(addressKey)) > ADDRESS_ATTEMPTS) return { ok: false, error: SLOW }
  const pairFailures = await countOf(pairKey)
  if (pairFailures >= PAIR_FAILURES) return { ok: false, error: SLOW }
  if (!known && pairFailures >= 1 && (await countOf(contactKey)) >= CONTACT_SLOW_AFTER) return { ok: false, error: SLOW }

  const points: { id: string; person: { id: string; clientId: string | null; client: { status: string } | null } | null }[] = await db().contactPoint.findMany({
    where: { valueHash: hash, status: 'active' },
    select: { id: true, person: { select: { id: true, clientId: true, client: { select: { status: true } } } } },
    take: 10,
  })
  for (const point of points) {
    const person = point.person
    if (!person?.clientId || !person.client || !['active', 'prospect'].includes(person.client.status)) continue
    const pet = await db().patient.findFirst({
      where: { name: { equals: petName, mode: 'insensitive' }, dateOfBirth: new Date(`${dob}T00:00:00Z`), status: { in: ['active', 'pending'] }, ownerships: { some: { clientId: person.clientId, effectiveTo: null } } },
      select: { id: true },
    })
    if (!pet) continue
    await startSession(person.id, point.id)
    await db().rateLimitBucket.deleteMany({ where: { key: { in: [pairKey, contactKey] } } })
    await runInTransaction(db(), async uow => {
      uow.audit({ eventType: 'client_site.signed_in', entityType: 'ClientPerson', entityId: person.id, after: { method: 'pet_name_dob' }, metadata: { system: 'client-site' } })
    })
    return { ok: true }
  }
  await countOne(pairKey)
  await countOne(contactKey)
  return { ok: false, error: WRONG }
}

export async function signOutClient() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) await db().portalSession.updateMany({ where: { tokenHash: tokenHash(token), status: 'verified' }, data: { status: 'revoked' } })
  jar.delete(COOKIE)
}
