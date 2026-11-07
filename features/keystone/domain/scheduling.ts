import { createHmac, timingSafeEqual } from 'node:crypto'
import { DomainError, Codes } from '../lib/errors'
import { addDays, zonedInstant } from '../lib/calendar'

/**
 * Availability and slot tokens (STATE-MACHINES §3; medspa scheduling port). Pure: commands load
 * schedules and reservations, these compute. Times are wall-clock in the location's zone and become
 * UTC instants through zonedInstant (DST-safe).
 */

export type Interval = { start: number; end: number }
export type SegmentTemplate = { kind: string; offset: number; minutes: number; resourceKind?: string | null }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
export function minutesOf(hhmm: string) {
  const m = HHMM.exec(hhmm)
  if (!m) throw new DomainError(Codes.INVALID_INPUT, `Invalid time ${hhmm}.`)
  return Number(m[1]) * 60 + Number(m[2])
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

/** Subtract busy intervals from free intervals (both sorted or not), dropping empty pieces. */
export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  let out = free.slice()
  for (const b of busy) {
    out = out.flatMap(f => {
      if (!overlaps(f, b)) return [f]
      const parts: Interval[] = []
      if (b.start > f.start) parts.push({ start: f.start, end: b.start })
      if (b.end < f.end) parts.push({ start: b.end, end: f.end })
      return parts
    })
  }
  return out.sort((x, y) => x.start - y.start)
}

export type WorkingBlock = { kind: 'recurring' | 'one_time' | 'time_off'; weekday: number | null; localDate: string | null; startTime: string; endTime: string; categories?: string[] | null; effectiveFrom?: string | null; effectiveTo?: string | null }

/** A staff member's working intervals on a local date: recurring + one-time, minus time off. */
export function workingIntervals(blocks: WorkingBlock[], date: string, timeZone: string, category?: string | null): Interval[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const inEffect = (b: WorkingBlock) => (!b.effectiveFrom || b.effectiveFrom <= date) && (!b.effectiveTo || b.effectiveTo >= date)
  const allows = (b: WorkingBlock) => !category || !b.categories?.length || b.categories.includes(category)
  const toInterval = (b: WorkingBlock): Interval => ({ start: zonedInstant(timeZone, date, b.startTime).getTime(), end: zonedInstant(timeZone, date, b.endTime).getTime() })
  const work = blocks.filter(b => inEffect(b) && allows(b) && ((b.kind === 'recurring' && b.weekday === weekday) || (b.kind === 'one_time' && b.localDate === date))).map(toInterval)
  const off = blocks.filter(b => inEffect(b) && b.kind === 'time_off' && b.localDate === date).map(toInterval)
  return subtract(work.filter(i => i.end > i.start), off)
}

export type Candidate = { providerId: string; resourceId: string; start: number; end: number }

/**
 * Slots of `minutes` on a grid of `stepMinutes` where a provider and a resource of the needed kind
 * are both free. Deterministic order: time, then provider id, then resource id.
 */
export function findSlots(input: {
  minutes: number
  stepMinutes: number
  notBefore: number
  providers: { id: string; working: Interval[]; busy: Interval[] }[]
  resources: { id: string; busy: Interval[] }[]
  limit: number
}): Candidate[] {
  const step = input.stepMinutes * 60_000
  const length = input.minutes * 60_000
  const out: Candidate[] = []
  const resources = [...input.resources].sort((a, b) => a.id.localeCompare(b.id))
  const providers = [...input.providers].sort((a, b) => a.id.localeCompare(b.id))
  const candidates: Candidate[] = []
  for (const p of providers) {
    const free = subtract(p.working, p.busy)
    for (const f of free) {
      const first = Math.max(f.start, Math.ceil(input.notBefore / step) * step)
      for (let t = Math.ceil(first / step) * step; t + length <= f.end; t += step) {
        const slot = { start: t, end: t + length }
        const room = resources.find(r => !r.busy.some(b => overlaps(b, slot)))
        if (room) candidates.push({ providerId: p.id, resourceId: room.id, ...slot })
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || a.providerId.localeCompare(b.providerId) || a.resourceId.localeCompare(b.resourceId))
  for (const c of candidates) {
    if (out.length >= input.limit) break
    out.push(c)
  }
  return out
}

/** Segment instants from an appointment type's template (drop-off → procedure → pick-up). */
export function buildSegments(template: SegmentTemplate[] | null | undefined, start: number, totalMinutes: number) {
  const list = template?.length ? template : [{ kind: 'exam', offset: 0, minutes: totalMinutes }]
  return list.map(s => ({ kind: s.kind, startsAt: new Date(start + s.offset * 60_000), endsAt: new Date(start + (s.offset + s.minutes) * 60_000) }))
}

export function localDatesBetween(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d)
  return out
}

// ── Slot tokens ───────────────────────────────────────────────────────────────────────────
// A slot offered to a caller is a signed token (provider, resource, type, start, end, expiry), so
// booking can't be steered to a slot that was never offered, and an old offer expires (5 minutes).

const SLOT_TTL_MS = 5 * 60_000
const DEVELOPMENT_SECRET = 'this secret should only be used in testing'
function key() {
  const secret = process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required to sign slot offers')
  return `slot-token:${secret || DEVELOPMENT_SECRET}`
}

export type SlotClaims = { providerId: string; resourceId: string; appointmentTypeId: string; locationId: string; start: number; end: number; exp: number }

export function signSlot(claims: Omit<SlotClaims, 'exp'>, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: now + SLOT_TTL_MS })).toString('base64url')
  const mac = createHmac('sha256', key()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifySlot(token: string, now = Date.now()): SlotClaims {
  const [body, mac] = String(token ?? '').split('.')
  if (!body || !mac) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That time slot is not valid. Search availability again.')
  const expected = createHmac('sha256', key()).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That time slot is not valid. Search availability again.')
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlotClaims
  if (!(claims.exp > now)) throw new DomainError(Codes.SLOT_TOKEN_INVALID, 'That time slot offer has expired. Search availability again.')
  return claims
}
