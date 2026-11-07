/**
 * Display formatting for exact values. Inputs are the strings GraphQL returns for bigInt and
 * decimal fields; nothing here turns money into a float.
 */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function splitDecimal(value: string) {
  const text = value.trim()
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace(/^[+-]/, '').split('.')
  return { negative, whole: whole.replace(/^0+(?=\d)/, '') || '0', fraction }
}

/** Minor units ("123456") → "$1,234.56". */
export function money(minor: string | bigint | null | undefined, currency = 'USD', digits = 2) {
  if (minor === null || minor === undefined || minor === '') return '—'
  const text = String(minor)
  if (!/^-?\d+$/.test(text)) return '—'
  const negative = text.startsWith('-')
  const abs = text.replace('-', '').padStart(digits + 1, '0')
  const whole = abs.slice(0, abs.length - digits)
  const fraction = digits ? `.${abs.slice(-digits)}` : ''
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${negative ? '−' : ''}${symbol}${group(whole.replace(/^0+(?=\d)/, ''))}${fraction}`
}

/** An exact decimal string trimmed to at most `maxPlaces` (truncating display only) and at least `minPlaces`. */
export function decimalText(value: string | null | undefined, options: { minPlaces?: number; maxPlaces?: number; prefix?: string } = {}) {
  if (value === null || value === undefined || value === '') return '—'
  if (!/^[+-]?\d*(\.\d*)?$/.test(String(value).trim())) return '—'
  const { negative, whole, fraction } = splitDecimal(String(value))
  const max = options.maxPlaces ?? 10
  const min = options.minPlaces ?? 0
  let f = fraction.slice(0, max).replace(/0+$/, '')
  if (f.length < min) f = f.padEnd(min, '0')
  const isZero = /^0*$/.test(whole + f)
  return `${negative && !isZero ? '−' : ''}${options.prefix ?? ''}${group(whole)}${f ? `.${f}` : ''}`
}

/** Quantity (doses, mL, tablets): up to 6 places, as stored. */
export const quantity = (value: string | null | undefined) => decimalText(value, { maxPlaces: 6 })

/** Weight in kg: up to 4 places. */
export const weight = (value: string | null | undefined, unit = 'kg') => (value ? `${decimalText(value, { maxPlaces: 4 })} ${unit}` : '—')

export const bps = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value} bps`)

export function when(iso: string | null | undefined, tz = 'America/Los_Angeles', style: 'full' | 'time' | 'day' | 'seconds' = 'full') {
  if (!iso) return ''
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions =
    style === 'time' ? { hour: 'numeric', minute: '2-digit' }
    : style === 'seconds' ? { hour: 'numeric', minute: '2-digit', second: '2-digit' }
    : style === 'day' ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style === 'day' ? undefined : 'short', ...opts }).format(d)
}

export const label = (value: string | null | undefined) => (value || '').replaceAll('_', ' ')

/** Whole basis points → "−5.92%" (exact: integer arithmetic). */
export function bpsPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isSafeInteger(value)) return '—'
  const abs = Math.abs(value)
  return `${value < 0 ? '−' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`
}

/** An exact decimal fraction string ("0.3333") → "33.3%", truncated to `places` for display. */
export function fractionPercent(value: string | null | undefined, places = 1) {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(String(value))) return '—'
  const { negative, whole, fraction } = splitDecimal(String(value))
  const f = fraction.padEnd(2 + places, '0')
  const percentWhole = `${whole}${f.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const rest = f.slice(2, 2 + places)
  return decimalText(`${negative ? '-' : ''}${percentWhole}${rest ? `.${rest}` : ''}`, { minPlaces: places, maxPlaces: places }) + '%'
}
