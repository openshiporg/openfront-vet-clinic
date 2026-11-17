import { addDays } from './wellness'

/* Boarding night arithmetic that needs no database. Days are `YYYY-MM-DD` strings in the clinic's own calendar. */

export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = []
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * The nights a stay is charged for. All four are clinic-local days: the day the pet arrived (never the UTC date, which is
 * already tomorrow for an evening check-in), the reserved first and last day, and today.
 * The night of the day they leave is not charged; a same-day pick-up is charged one night.
 */
export function nightsStayed(arrivedOn: string, checkInOn: string, checkOutOn: string, today: string): string[] {
  const startedOn = arrivedOn < checkInOn ? checkInOn : arrivedOn
  const lastNight = today < checkOutOn ? today : checkOutOn
  return startedOn >= lastNight ? [startedOn] : nightsBetween(startedOn, lastNight)
}
