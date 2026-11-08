/*
 * Treatment-sheet schedules (DOMAIN I-O3, STATE-MACHINES §6). Pure: a sheet order's frequency and
 * window give the exact due times; the generator materialises them through a horizon, and the
 * unique (sheetOrder, dueAt) index makes re-running it change nothing.
 */

export const FREQUENCY_HOURS: Record<string, number | null> = {
  q1h: 1, q2h: 2, q4h: 4, q6h: 6, q8h: 8, q12h: 12, q24h: 24, sid: 24, bid: 12, tid: 8, qid: 6, prn: null, cri: null, once: null,
}

/** The sheet frequency as stored: "BID", "q24h ", "SID" → bid, q24h, sid; null if not a sheet frequency. */
export function sheetFrequency(raw: string): string | null {
  const f = raw.trim().toLowerCase()
  return f in FREQUENCY_HOURS ? f : null
}

const HOUR = 3_600_000

/**
 * Due times in [from, to): stepping from the order's start by its interval. `once` yields the start
 * if it falls in the window; PRN and CRI have no scheduled tasks (given on demand or running).
 */
export function dueTimes(input: { frequency: string; startAt: Date; endAt?: Date | null }, from: Date, to: Date): Date[] {
  const hours = FREQUENCY_HOURS[input.frequency]
  const end = input.endAt && input.endAt < to ? input.endAt : to
  if (input.frequency === 'once') return input.startAt >= from && input.startAt < end ? [input.startAt] : []
  if (hours == null) return []
  const step = hours * HOUR
  const out: Date[] = []
  const first = input.startAt.getTime() >= from.getTime() ? input.startAt.getTime() : input.startAt.getTime() + Math.ceil((from.getTime() - input.startAt.getTime()) / step) * step
  for (let t = first; t < end.getTime(); t += step) out.push(new Date(t))
  return out
}

/** Status a scheduled task should show now: due within the hour, overdue after the grace. */
export function taskStatusAt(task: { dueAt: Date; status: string; graceMinutes: number }, now: Date): string {
  if (!['scheduled', 'due', 'overdue'].includes(task.status)) return task.status
  const t = now.getTime()
  if (t >= task.dueAt.getTime() + task.graceMinutes * 60_000) return 'overdue'
  if (t >= task.dueAt.getTime() - HOUR) return 'due'
  return 'scheduled'
}

/** Anaesthesia: the longest gap between readings while monitoring, in minutes (standard ≤ 5). */
export function longestMonitoringGapMinutes(readings: Date[], start: Date, end: Date): number {
  const points = [start, ...readings.filter(r => r >= start && r <= end).sort((a, b) => a.getTime() - b.getTime()), end]
  let gap = 0
  for (let i = 1; i < points.length; i++) gap = Math.max(gap, (points[i].getTime() - points[i - 1].getTime()) / 60_000)
  return Math.round(gap)
}

export const ASA_EMERGENCY = (asa: string) => asa.endsWith('E')
