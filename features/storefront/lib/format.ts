/* Display helpers for the client site. Money stays in exact minor units (strings or bigint). */

export function money(minor: string | bigint | null | undefined, currency = 'USD', cents: 'always' | 'auto' = 'always') {
  if (minor === null || minor === undefined) return ''
  const text = String(minor)
  if (!/^-?\d+$/.test(text)) return ''
  const negative = text.startsWith('-')
  const abs = text.replace('-', '').padStart(3, '0')
  const whole = abs.slice(0, -2).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = abs.slice(-2)
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${negative ? '-' : ''}${symbol}${whole}${cents === 'auto' && fraction === '00' ? '' : `.${fraction}`}`
}

/** "3:40 PM PT" in the clinic's zone. */
export function timeLabel(iso: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'shortGeneric' }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`.trim()
}

/** "Tue, Nov 17" in the clinic's zone. */
export const dayLabel = (iso: string | Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))

/** "Tuesday, November 17" in the clinic's zone. */
export const longDayLabel = (iso: string | Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso))

/** A calendar day ("2026-11-17") as "Tue, Nov 17" without shifting it across zones. */
export const calendarDayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))

/** "6 years old", "8 months old", "5 weeks old". */
export function ageLabel(dateOfBirth: string | null | undefined, today: string) {
  if (!dateOfBirth) return ''
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number)
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0)
  if (months < 0) months = 0
  if (months >= 12) { const years = Math.floor(months / 12); return `${years} ${years === 1 ? 'year' : 'years'} old` }
  if (months >= 2) return `${months} months old`
  const weeks = Math.max(1, Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(by, bm - 1, bd)) / (7 * 86_400_000)))
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} old`
}

/** "+19165550131" as "(916) 555-0131". */
export function phoneLabel(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(phone ?? '')
}

/** "07:30" as "7:30 AM". */
export function clockLabel(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

export const words = (code: string | null | undefined) => String(code ?? '').replace(/_/g, ' ')
export const sentence = (code: string | null | undefined) => { const w = words(code); return w ? w[0].toUpperCase() + w.slice(1) : '' }
