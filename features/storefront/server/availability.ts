import { addDays, localDate } from '@/features/keystone/lib/calendar'
import { findSlots, signSlot, workingIntervals, type Interval } from '@/features/keystone/domain/scheduling'
import { db } from './db'
import { getSite } from './site'

/*
 * Open times for the client site. The same calculation the front desk's search runs (staff schedules minus provider and
 * room reservations, on a 15-minute grid), and the same signed slot tokens, so a time offered here is booked by the
 * same rules. The practice's online notice and booking window (PublicSiteProfile) are applied on top.
 */

export type OpenTime = { startsAt: string; endsAt: string; providerName: string; slotToken: string }
export type OpenDay = { date: string; times: OpenTime[] }

const STEP_MINUTES = 15
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const asInterval = (r: { startsAt: Date; endsAt: Date }): Interval => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() })

/** Open times for a visit type at a location, from a local date, for a number of days. One entry per start time. */
export async function openTimes(input: { locationId: string; appointmentTypeId: string; from?: string | null; days?: number; perDay?: number }): Promise<{ timeZone: string; today: string; lastDay: string; days: OpenDay[] }> {
  const p = db()
  const site = await getSite()
  const [location, type] = await Promise.all([
    p.location.findUnique({ where: { id: input.locationId }, select: { id: true, timeZone: true, active: true } }),
    p.appointmentType.findUnique({ where: { id: input.appointmentTypeId } }),
  ])
  const now = Date.now()
  const timeZone = location?.timeZone || site.timeZone
  const today = localDate({ timeZone }, now)
  const lastDay = addDays(today, Math.max(site.bookingWindowDays, 1))
  if (!location?.active || !type?.active || !site.onlineBooking) return { timeZone, today, lastDay, days: [] }

  const wanted = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) && input.from >= today ? input.from : today
  const from = wanted > lastDay ? lastDay : wanted
  const days = Math.min(Math.max(input.days ?? 1, 1), 14)
  const perDay = Math.min(Math.max(input.perDay ?? 40, 1), 60)
  const notBefore = now + Math.max(site.minimumNoticeMinutes, 15) * 60_000

  const providerKinds = list(type.providerKinds)
  const resourceKinds = list(type.requiredResourceKinds)
  const windowStart = new Date(`${from}T00:00:00Z`).getTime() - 86_400_000
  const windowEnd = new Date(`${addDays(from, days)}T00:00:00Z`).getTime() + 86_400_000
  const range = { startsAt: { lt: new Date(windowEnd) }, endsAt: { gt: new Date(windowStart) }, status: { not: 'released' } }
  const [staff, resources] = await Promise.all([
    p.staffMember.findMany({ where: { active: true, kind: { in: providerKinds.length ? providerKinds : ['dvm'] }, OR: [{ homeLocationId: location.id }, { locations: { some: { id: location.id } } }] }, select: { id: true, displayName: true } }),
    p.resource.findMany({ where: { locationId: location.id, active: true, kind: { in: resourceKinds.length ? resourceKinds : ['exam_room'] } }, select: { id: true } }),
  ])
  const staffIds = staff.map((s: { id: string }) => s.id)
  const [schedules, providerBusy, resourceBusy] = await Promise.all([
    p.staffSchedule.findMany({ where: { staffMemberId: { in: staffIds }, locationId: location.id } }),
    p.providerReservation.findMany({ where: { staffMemberId: { in: staffIds }, ...range }, select: { staffMemberId: true, startsAt: true, endsAt: true } }),
    p.resourceReservation.findMany({ where: { resourceId: { in: resources.map((r: { id: string }) => r.id) }, ...range }, select: { resourceId: true, startsAt: true, endsAt: true } }),
  ])
  const names = new Map<string, string>(staff.map((s: { id: string; displayName: string }) => [s.id, s.displayName]))
  const category = String(type.category)
  const out: OpenDay[] = []
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i)
    if (date > lastDay) break
    const providers = staff.map((s: { id: string }) => ({
      id: s.id,
      working: workingIntervals(
        schedules.filter((b: { staffMemberId: string }) => b.staffMemberId === s.id).map((b: any) => ({
          kind: b.kind, weekday: b.weekday, localDate: isoDay(b.localDate), startTime: b.startTime, endTime: b.endTime,
          categories: list(b.appointmentCategories), effectiveFrom: isoDay(b.effectiveFrom), effectiveTo: isoDay(b.effectiveTo),
        })),
        date, timeZone, category,
      ),
      busy: providerBusy.filter((r: { staffMemberId: string }) => r.staffMemberId === s.id).map(asInterval),
    }))
    const rooms = resources.map((r: { id: string }) => ({ id: r.id, busy: resourceBusy.filter((b: { resourceId: string }) => b.resourceId === r.id).map(asInterval) }))
    // Every provider's free slots, then one per start time (the first provider in the fixed order), so the client picks a time, not a room.
    const slots = findSlots({ minutes: type.durationMinutes, stepMinutes: STEP_MINUTES, notBefore, providers, resources: rooms, limit: 600 })
    const seen = new Set<number>()
    const times: OpenTime[] = []
    for (const s of slots) {
      if (seen.has(s.start) || times.length >= perDay) continue
      seen.add(s.start)
      times.push({
        startsAt: new Date(s.start).toISOString(), endsAt: new Date(s.end).toISOString(), providerName: names.get(s.providerId) ?? '',
        slotToken: signSlot({ providerId: s.providerId, resourceId: s.resourceId, appointmentTypeId: type.id, locationId: location.id, start: s.start, end: s.end }, now),
      })
    }
    out.push({ date, times })
  }
  return { timeZone, today, lastDay, days: out }
}

/** Today's open times for the home page; when today has none left, the next day that has some (within a week). */
export async function nextOpenTimes(locationId: string, appointmentTypeId: string, count = 3): Promise<{ timeZone: string; today: string; date: string | null; times: OpenTime[] }> {
  const found = await openTimes({ locationId, appointmentTypeId, days: 7, perDay: count })
  const day = found.days.find(d => d.times.length > 0)
  return { timeZone: found.timeZone, today: found.today, date: day?.date ?? null, times: day?.times ?? [] }
}
