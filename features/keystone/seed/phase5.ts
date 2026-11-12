import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { auditCreate } from '../lib/cas'

/*
 * Phase 5 starting data: the service price list (grooming, euthanasia, aftercare, keepsakes), the boarding run sizes and their runs,
 * and two wellness plans. Prices are cents. Boarding and grooming are not taxed in California (the sales-tax policy says so);
 * keepsakes and urns are goods and are.
 */
const SERVICES = [
  { code: 'GROOM-BATH_BRUSH', area: 'grooming', name: 'Bath and brush', price: 5500, minutes: 60, tax: 'grooming' },
  { code: 'GROOM-FULL_GROOM', area: 'grooming', name: 'Full groom', price: 9500, minutes: 120, tax: 'grooming' },
  { code: 'GROOM-NAIL_TRIM', area: 'grooming', name: 'Nail trim', price: 2000, minutes: 15, tax: 'grooming' },
  { code: 'GROOM-DE_SHED', area: 'grooming', name: 'De-shedding treatment', price: 7500, minutes: 75, tax: 'grooming' },
  { code: 'GROOM-DENTAL_SCALE', area: 'grooming', name: 'Teeth brushing and breath care', price: 3500, minutes: 30, tax: 'grooming' },
  { code: 'EUTH-STANDARD', area: 'euthanasia', name: 'Euthanasia', price: 18500, minutes: null, tax: 'professional_service' },
  { code: 'AFTER-PRIVATE', area: 'aftercare', name: 'Private cremation, ashes returned', price: 24500, minutes: null, tax: 'professional_service' },
  { code: 'AFTER-COMMUNAL', area: 'aftercare', name: 'Communal cremation', price: 8500, minutes: null, tax: 'professional_service' },
  { code: 'MEM-PAW_PRINT', area: 'aftercare', name: 'Ink paw print', price: 2500, minutes: null, tax: 'merchandise' },
  { code: 'MEM-CLAY_IMPRESSION', area: 'aftercare', name: 'Clay paw impression', price: 4500, minutes: null, tax: 'merchandise' },
  { code: 'MEM-FUR_CLIPPING', area: 'aftercare', name: 'Fur clipping in a keepsake envelope', price: 1500, minutes: null, tax: 'merchandise' },
  { code: 'MEM-URN', area: 'aftercare', name: 'Wooden urn', price: 11000, minutes: null, tax: 'merchandise' },
  { code: 'MEM-KEEPSAKE', area: 'aftercare', name: 'Engraved keepsake', price: 6500, minutes: null, tax: 'merchandise' },
] as const

const RUN_TYPES = [
  { id: 'seed_rt_small', code: 'dog_small', name: 'Small dog suite', species: ['canine'], maxKg: 10, rate: 4800, deposit: 5000, runs: 4 },
  { id: 'seed_rt_large', code: 'dog_large', name: 'Large dog run', species: ['canine'], maxKg: 60, rate: 6500, deposit: 6500, runs: 3 },
  { id: 'seed_rt_cat', code: 'cat_condo', name: 'Cat condo', species: ['feline'], maxKg: 15, rate: 3600, deposit: 3600, runs: 4 },
] as const

const PLANS = [
  {
    code: 'PUPPY', name: 'Puppy wellness plan', summary: 'The first year of exams, vaccines and parasite care in twelve payments.', label: 'Puppy plan 2026', price: 3900, species: ['canine'], minAgeWeeks: 6, maxAgeMonths: 12,
    entitlements: [
      { code: 'EXAM', label: 'Wellness exams', qty: 4, retailValueMinor: '7800' },
      { code: 'VACCINE', label: 'Core vaccines', qty: 6, retailValueMinor: '3800' },
      { code: 'FECAL', label: 'Fecal tests', qty: 2, retailValueMinor: '4200' },
      { code: 'NAIL', label: 'Nail trims', qty: 12, retailValueMinor: '2000' },
    ],
  },
  {
    code: 'ADULT', name: 'Adult wellness plan', summary: 'A yearly exam, vaccines, blood work and dental care spread over twelve months.', label: 'Adult plan 2026', price: 4900, species: ['canine', 'feline'], minAgeWeeks: null, maxAgeMonths: null,
    entitlements: [
      { code: 'EXAM', label: 'Wellness exams', qty: 2, retailValueMinor: '7800' },
      { code: 'VACCINE', label: 'Core vaccines', qty: 3, retailValueMinor: '3800' },
      { code: 'BLOOD', label: 'Annual blood panel', qty: 1, retailValueMinor: '14500' },
      { code: 'NAIL', label: 'Nail trims', qty: 12, retailValueMinor: '2000' },
    ],
  },
] as const

export async function seedPhase5(uow: UnitOfWork, actor: Actor, count: (k: string, n: number) => void) {
  const { tx, now } = uow
  if (await tx.serviceItem.findFirst({ select: { id: true } })) return
  await tx.serviceItem.createMany({ data: SERVICES.map(s => ({ code: s.code, area: s.area, name: s.name, priceMinor: BigInt(s.price), minutes: s.minutes, taxCategory: s.tax, active: true })) })
  count('serviceItems', SERVICES.length)
  const places = new Set((await tx.location.findMany({ select: { id: true } })).map(l => l.id))
  const types: object[] = []
  const runs: object[] = []
  for (const loc of ['seed_loc_main', 'seed_loc_elkgrove']) {
    if (!places.has(loc)) continue
    const main = loc === 'seed_loc_main'
    for (const t of RUN_TYPES) {
      const id = main ? t.id : `${t.id}_eg`
      ;types.push({ id, code: main ? t.code : `${t.code}_eg`, name: t.name, locationId: loc, speciesCodes: [...t.species], maxWeightKg: t.maxKg, nightlyRateMinor: BigInt(t.rate), depositMinor: BigInt(t.deposit), active: true })
      const n = main ? t.runs : Math.max(1, t.runs - 2)
      for (let i = 1; i <= n; i += 1) runs.push({ label: `${t.name} ${i}`, runTypeId: id, locationId: loc, status: 'available' })
    }
  }
  await tx.runType.createMany({ data: types as never })
  await tx.run.createMany({ data: runs as never })
  for (const p of PLANS) {
    const plan = await tx.wellnessPlan.create({ data: { code: p.code, name: p.name, summary: p.summary, status: 'active' } })
    const v = await tx.wellnessPlanVersion.create({
      data: { planId: plan.id, versionNo: 1, label: p.label, status: 'published', monthlyPriceMinor: BigInt(p.price), termMonths: 12, speciesCodes: [...p.species], minAgeWeeks: p.minAgeWeeks, maxAgeMonths: p.maxAgeMonths, entitlements: p.entitlements.map(e => ({ ...e })), otherServicesDiscountBps: 1000, trueUpNote: '', disclosure: '', publishedAt: now },
    })
    auditCreate(uow, actor, 'WellnessPlanVersion', v.id, 'wellness.plan_published', { code: p.code, versionNo: 1, seeded: true })
  }
  count('wellnessPlans', PLANS.length)
}
