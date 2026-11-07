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

const yearIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(d)

/**
 * A date or time in the practice time zone. Dates outside the current year carry the year, so a
 * one-year span (a VCPR, a licence) reads as one ("Sep 21, 2025 … Sep 21, 2026").
 */
export function when(iso: string | null | undefined, tz = 'America/Los_Angeles', style: 'full' | 'time' | 'day' | 'date' | 'seconds' | 'dayTime' = 'full', now: Date = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  const otherYear = yearIn(d, tz) !== yearIn(now, tz)
  const opts: Intl.DateTimeFormatOptions =
    style === 'time' ? { hour: 'numeric', minute: '2-digit' }
    : style === 'seconds' ? { hour: 'numeric', minute: '2-digit', second: '2-digit' }
    : style === 'day' ? { weekday: 'short', month: 'short', day: 'numeric', ...(otherYear ? { year: 'numeric' } : {}) }
    : style === 'date' ? { month: 'short', day: 'numeric', year: 'numeric' }
    : style === 'dayTime' ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(otherYear ? { year: 'numeric' } : {}) }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(otherYear ? { year: 'numeric' } : {}) }
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style === 'day' || style === 'date' ? undefined : 'short', ...opts }).format(d)
}

/**
 * Human wording for stored codes. Screens never show a raw enum: `label()` is the lower-case phrase
 * for use inside a sentence ("via AI voice"), `title()` the same phrase capitalised for a list item,
 * an option or a column ("Behaviour caution", "Warning").
 */
const WORDS: Record<string, string> = {
  // alert severities and kinds
  info: 'information', warn: 'warning', block: 'blocking', behaviour_caution: 'behaviour caution', drug_sensitivity: 'drug sensitivity',
  // acronyms and roles
  ai: 'AI', ai_voice: 'AI voice', sms: 'SMS', mms: 'MMS', vcpr: 'VCPR', dvm: 'DVM', relief_dvm: 'relief DVM', rvt: 'RVT', csr: 'CSR', dea: 'DEA', cures: 'CURES', er_referred: 'referred to ER', urgent_transfer: 'urgent transfer', pims: 'PIMS', ivr: 'IVR', otp: 'one-time code', dob: 'date of birth',
  // reproductive status
  intact: 'intact', spayed: 'spayed', neutered: 'neutered', unknown: 'unknown',
  // channels and sources
  phone: 'phone', walk_in: 'walk-in', online: 'online booking', portal: 'client portal', staff: 'staff', api: 'API', import: 'import',
  // misc
  general_practice: 'general practice', checked_in: 'checked in', in_progress: 'in progress', ready_for_checkout: 'ready for checkout', no_show: 'no-show',
  refill_request: 'refill request', records_request: 'records request', callback_task: 'callback task', full_time: 'full-time', part_time: 'part-time',
  emergency_now: 'emergency now', urgent_today: 'urgent today', routine: 'routine',
}

export const label = (value: string | null | undefined) => (value ? (WORDS[value] ?? value.replaceAll('_', ' ')) : '')

export const title = (value: string | null | undefined) => {
  const text = label(value)
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

/** Options for a select from stored codes, worded by `title()`. */
export const options = (values: readonly string[]) => values.map(value => ({ value, label: title(value) }))

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


/** A camelCase / dotted / snake_case code as words: "exemptCategories.rx_animal_drug" → "exempt categories, rx animal drug". */
export const words = (code: string) => label(code.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replaceAll('.', ', '))

/** A policy rule marked (verify): "US-CA/sales_tax:baseRate (note)" → "Base rate (note)". The pack is shown alongside. */
export function policyRule(path: string) {
  const [, rest = path] = path.match(/^[^:]*:(.*)$/s) ?? []
  const m = rest.match(/^([^\s(]+)\s*(.*)$/s)
  const text = words(m ? m[1] : rest)
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${m && m[2] ? ` ${m[2]}` : ''}`
}

const LAYER: Record<string, string> = { federal: 'Federal', state: 'State', local: 'Practice' }
export const policyLayer = (layer: string, packCode: string) => `${LAYER[layer] ?? title(layer)} (${packCode.split('/')[0]})`

/** Audit event types read as sentences: "patient.weight_recorded" → "Patient weight recorded". */
export const eventText = (eventType: string) => {
  const text = eventType.split('.').map(part => label(part)).join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const RED_FLAGS: Record<string, string> = {
  rf_breathing: 'breathing difficulty', rf_collapse: 'collapse', rf_toxin: 'possible poisoning', rf_bloat: 'possible bloat (GDV)', rf_bleeding: 'uncontrolled bleeding',
  rf_seizure: 'seizure', rf_urinary: 'unable to urinate', rf_trauma: 'major trauma', rf_labour: 'difficult birth', rf_heat: 'heatstroke', rf_vomiting: 'repeated vomiting',
}
export const redFlag = (id: string) => RED_FLAGS[id] ?? label(id.replace(/^rf_/, ''))

/** "America/Los_Angeles" → "Pacific Time". */
export const zoneName = (tz: string) => {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')
  return part?.value ?? tz
}
