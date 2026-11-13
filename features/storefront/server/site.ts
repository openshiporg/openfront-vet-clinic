import { cache } from 'react'
import { STANDARD_SCHEDULE } from '@/features/keystone/lib/pricing'
import { db } from './db'

/* What anyone may see on the client site: the practice, its locations and hours, the visit types it offers online, published prices and plans. */

export type SiteLocation = {
  id: string; name: string; kind: string; addressLine1: string; addressLine2: string; city: string; postalCode: string; stateCode: string
  timeZone: string; phone: string; email: string; openHours: Record<string, [string, string] | null> | null; emergencyCoverage: string
}

export type Site = {
  name: string
  timeZone: string
  currencyCode: string
  locations: SiteLocation[]
  /** The location the site opens on: the first general practice, else the first active location. */
  main: SiteLocation | null
  onlineBooking: boolean
  newClientMode: 'book' | 'request' | 'off'
  bookingWindowDays: number
  minimumNoticeMinutes: number
}

export const getSite = cache(async (): Promise<Site> => {
  const p = db()
  const [practice, profile, locations] = await Promise.all([
    p.practiceSettings.findUnique({ where: { id: 1 }, select: { displayName: true, homeTimeZone: true, currencyCode: true } }),
    p.publicSiteProfile.findFirst({ select: { headline: true, onlineBookingEnabled: true, newClientBookingMode: true, bookingWindowDays: true, minimumNoticeMinutes: true } }),
    p.location.findMany({
      where: { active: true }, orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, kind: true, addressLine1: true, addressLine2: true, city: true, postalCode: true, stateCode: true, timeZone: true, phone: true, email: true, openHours: true, emergencyCoverage: true },
    }),
  ])
  const main = locations.find((l: SiteLocation) => l.kind === 'general_practice') ?? locations[0] ?? null
  const ordered = main ? [main, ...locations.filter((l: SiteLocation) => l.id !== main.id)] : []
  return {
    name: practice?.displayName || profile?.headline || main?.name || 'Animal hospital',
    timeZone: main?.timeZone || practice?.homeTimeZone || 'America/Los_Angeles',
    currencyCode: practice?.currencyCode || 'USD',
    locations: ordered,
    main,
    onlineBooking: profile ? profile.onlineBookingEnabled !== false : true,
    newClientMode: (['book', 'request', 'off'].includes(profile?.newClientBookingMode) ? profile.newClientBookingMode : 'request') as Site['newClientMode'],
    bookingWindowDays: profile?.bookingWindowDays ?? 60,
    minimumNoticeMinutes: profile?.minimumNoticeMinutes ?? 120,
  }
})

export type VisitType = {
  /** The appointment type's id (what a booking names). */
  id: string
  name: string
  description: string
  category: string
  durationMinutes: number
  /** `book` takes a time straight away; `request` holds the time until the practice accepts it. */
  mode: 'book' | 'request'
  newClients: boolean
}

/** Visit types the practice offers on its site, in its own order. */
export const getVisitTypes = cache(async (): Promise<VisitType[]> => {
  const rows = await db().publicAppointmentType.findMany({
    where: { active: true, appointmentType: { active: true } },
    orderBy: [{ sortOrder: 'asc' }, { publicName: 'asc' }],
    select: { publicName: true, description: true, mode: true, newClients: true, appointmentType: { select: { id: true, name: true, category: true, durationMinutes: true, portalBookable: true, requestOnly: true, newClientAllowed: true } } },
  })
  return rows
    .filter((r: any) => r.appointmentType && (r.appointmentType.portalBookable || r.appointmentType.requestOnly))
    .map((r: any) => ({
      id: r.appointmentType.id, name: r.publicName || r.appointmentType.name, description: r.description || '', category: r.appointmentType.category, durationMinutes: r.appointmentType.durationMinutes,
      mode: r.appointmentType.requestOnly || r.mode === 'request' ? 'request' : 'book', newClients: r.newClients === true && r.appointmentType.newClientAllowed === true,
    }))
})

/** The visit type the home page leads with: the first wellness visit offered online, else the first one. */
export const getFeaturedVisit = cache(async (): Promise<VisitType | null> => {
  const types = (await getVisitTypes()).filter(t => t.mode === 'book')
  return types.find(t => t.category === 'wellness' && !t.newClients) ?? types.find(t => t.category === 'wellness') ?? types[0] ?? null
})

export type Price = { code: string; name: string; category: string; priceMinor: string; currencyCode: string; unit: string }

/** The published fee schedule in force. */
export const getPrices = cache(async (): Promise<Price[]> => {
  // The same version billing prices from (lib/pricing activeFeeVersion): the standard schedule's latest published version.
  const version = await db().feeScheduleVersion.findFirst({ where: { status: 'published', schedule: { code: STANDARD_SCHEDULE } }, orderBy: { versionNo: 'desc' }, select: { id: true } })
  if (!version) return []
  const items = await db().feeItem.findMany({
    where: { versionId: version.id, active: true, category: { in: ['exam', 'consultation', 'vaccine', 'dental', 'grooming', 'boarding', 'laboratory', 'imaging'] } },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { code: true, name: true, category: true, priceMinor: true, currencyCode: true, unit: true },
    take: 200,
  })
  return items.map((i: any) => ({ code: i.code, name: i.name, category: i.category, priceMinor: String(i.priceMinor), currencyCode: i.currencyCode, unit: i.unit || '' }))
})

/** The published exam fee a wellness visit is charged at, when the fee schedule has one. */
export const getWellnessExamPrice = cache(async (): Promise<Price | null> => {
  const exams = (await getPrices()).filter(p => p.category === 'exam' && BigInt(p.priceMinor) > 0n)
  return exams.find(p => /wellness/i.test(p.name)) ?? null
})

export type Plan = { id: string; name: string; summary: string; label: string; monthlyPriceMinor: string; termMonths: number; speciesCodes: string[]; entitlements: { label: string; qty: number }[]; discountBps: number }

/** Wellness plans with a published version. */
export const getPlans = cache(async (): Promise<Plan[]> => {
  const rows = await db().wellnessPlanVersion.findMany({
    where: { status: 'published', plan: { status: 'active' } },
    orderBy: [{ monthlyPriceMinor: 'asc' }, { versionNo: 'desc' }],
    select: { id: true, label: true, monthlyPriceMinor: true, termMonths: true, speciesCodes: true, entitlements: true, otherServicesDiscountBps: true, versionNo: true, plan: { select: { id: true, name: true, summary: true } } },
  })
  const seen = new Set<string>()
  const out: Plan[] = []
  for (const r of rows) {
    if (!r.plan || seen.has(r.plan.id)) continue
    seen.add(r.plan.id)
    const entitlements = Array.isArray(r.entitlements) ? r.entitlements.filter((e: any) => e && typeof e.label === 'string').map((e: any) => ({ label: String(e.label), qty: Number.parseInt(String(e.qty ?? 1), 10) || 1 })) : []
    out.push({ id: r.id, name: r.plan.name, summary: r.plan.summary || '', label: r.label || '', monthlyPriceMinor: String(r.monthlyPriceMinor), termMonths: r.termMonths, speciesCodes: Array.isArray(r.speciesCodes) ? r.speciesCodes.map(String) : [], entitlements, discountBps: r.otherServicesDiscountBps ?? 0 })
  }
  return out
})

export type Run = { id: string; name: string; locationName: string; speciesCodes: string[]; maxWeightKg: number | null; nightlyRateMinor: string; depositMinor: string }

/** Boarding run types and their nightly rates. */
export const getRuns = cache(async (): Promise<Run[]> => {
  const rows = await db().runType.findMany({ where: { active: true }, orderBy: [{ nightlyRateMinor: 'asc' }], select: { id: true, name: true, speciesCodes: true, maxWeightKg: true, nightlyRateMinor: true, depositMinor: true, location: { select: { name: true } } } })
  return rows.map((r: any) => ({ id: r.id, name: r.name, locationName: r.location?.name ?? '', speciesCodes: Array.isArray(r.speciesCodes) ? r.speciesCodes.map(String) : [], maxWeightKg: r.maxWeightKg ?? null, nightlyRateMinor: String(r.nightlyRateMinor), depositMinor: String(r.depositMinor ?? 0) }))
})

export type TeamMember = { id: string; name: string; kind: string; credentials: string; locationName: string }

const TEAM_ORDER = ['dvm', 'rvt', 'assistant', 'groomer', 'csr', 'manager', 'kennel']

/** The people clients meet: doctors first, then nurses, assistants, groomers and the front desk. */
export const getTeam = cache(async (): Promise<TeamMember[]> => {
  const rows = await db().staffMember.findMany({ where: { active: true, kind: { in: TEAM_ORDER } }, orderBy: [{ displayName: 'asc' }], select: { id: true, displayName: true, kind: true, credentials: true, homeLocation: { select: { name: true } } }, take: 200 })
  return rows
    .map((r: any) => ({ id: r.id, name: r.displayName, kind: r.kind, credentials: r.credentials || '', locationName: r.homeLocation?.name ?? '' }))
    .sort((a: TeamMember, b: TeamMember) => TEAM_ORDER.indexOf(a.kind) - TEAM_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))
})

export const getSpecies = cache(async (): Promise<{ code: string; name: string }[]> =>
  db().species.findMany({ where: { active: true }, orderBy: [{ name: 'asc' }], select: { code: true, name: true } }))
