import { createHash } from 'node:crypto'
import { DomainError, Codes } from '../lib/errors'

/**
 * Contact normalisation and the send-time guard (I-C3, I-G2). Pure functions: the commands load the
 * facts and these decide. Phones are stored E.164 (+1…); emails lower-cased. The hash is what
 * duplicate detection and caller lookup use, so no query scans contact values.
 */

export type ContactKind = 'mobile' | 'landline' | 'email'

export function normalisePhone(raw: string): string {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '')
  const plain = digits.replace(/\+/g, '')
  if (digits.startsWith('+') && /^\d{8,15}$/.test(plain)) return `+${plain}`
  if (/^\d{10}$/.test(plain)) return `+1${plain}`
  if (/^1\d{10}$/.test(plain)) return `+${plain}`
  throw new DomainError(Codes.INVALID_INPUT, 'Enter a phone number with area code.', { field: 'phone' })
}

export function normaliseEmail(raw: string): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || value.length > 254) throw new DomainError(Codes.INVALID_INPUT, 'Enter a valid email address.', { field: 'email' })
  return value
}

export const normaliseContact = (kind: ContactKind, raw: string) => (kind === 'email' ? normaliseEmail(raw) : normalisePhone(raw))
export const contactHash = (normalised: string) => createHash('sha256').update(`contact:${normalised}`).digest('hex')

/** ISO 11784 chips are 15 digits; legacy AVID chips are 9 or 10 characters. */
export function microchipStandard(number: string): 'iso_11784' | 'avid_9' | 'avid_10' {
  const n = String(number ?? '').replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{15}$/.test(n)) return 'iso_11784'
  if (/^[0-9A-F]{9}$/.test(n)) return 'avid_9'
  if (/^[0-9A-F]{10}$/.test(n)) return 'avid_10'
  throw new DomainError(Codes.INVALID_INPUT, 'A microchip number is 15 digits (ISO) or 9-10 characters (legacy).', { field: 'microchip' })
}

export type Purpose = 'care' | 'transactional' | 'marketing' | 'ai_voice' | 'recording'
export type ConsentRow = { purpose: string; action: string; at: Date | string }
export type ConsentRequirement = 'implied' | 'express' | 'express_written'

/** Effective consent = the latest row per purpose. Implied purposes are allowed unless revoked. */
export function effectiveConsent(rows: ConsentRow[], purpose: Purpose, requirement: ConsentRequirement) {
  const latest = rows.filter(r => r.purpose === purpose).sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
  if (latest?.action === 'revoke') return { allowed: false, basis: 'revoked' as const }
  if (latest?.action === 'grant') return { allowed: true, basis: 'granted' as const }
  return requirement === 'implied' ? { allowed: true, basis: 'implied' as const } : { allowed: false, basis: 'no_consent' as const }
}

/** Is `local` (HH:mm) inside the quiet window [start, end) that may wrap midnight? */
export function inQuietHours(local: string, window: { start: string; end: string }) {
  const { start, end } = window
  return start > end ? local >= start || local < end : local >= start && local < end
}

export type SendFacts = {
  purpose: 'care' | 'transactional' | 'marketing'
  patientStatus?: string | null
  contactStatus: string
  consentRows: ConsentRow[]
  requirement: ConsentRequirement
  suppressed: boolean
  localTime: string
  quietHours: { start: string; end: string }
}

export type SendDecision = { action: 'send' } | { action: 'block'; reason: string } | { action: 'defer'; reason: string }

/**
 * The send-time guard (INTEGRATIONS §7.1). Order matters: a deceased patient blocks first, so a
 * grieving client never gets "Biscuit is due for vaccines". Quiet hours defer rather than block.
 */
export function sendDecision(f: SendFacts): SendDecision {
  if (f.patientStatus === 'deceased') return { action: 'block', reason: 'patient_deceased' }
  if (f.contactStatus !== 'active') return { action: 'block', reason: `contact_${f.contactStatus}` }
  if (f.suppressed) return { action: 'block', reason: 'suppressed' }
  const consent = effectiveConsent(f.consentRows, f.purpose, f.requirement)
  if (!consent.allowed) return { action: 'block', reason: consent.basis === 'revoked' ? 'consent_revoked' : 'consent_missing' }
  if (inQuietHours(f.localTime, f.quietHours)) return { action: 'defer', reason: 'quiet_hours' }
  return { action: 'send' }
}

/** Inbound SMS keywords (CTIA): opt-out words revoke first; C confirms the next appointment. */
export function smsKeyword(body: string): 'stop' | 'start' | 'help' | 'confirm' | null {
  const word = String(body ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'].includes(word)) return 'stop'
  if (['START', 'UNSTOP', 'YES', 'OPTIN'].includes(word)) return 'start'
  if (['HELP', 'INFO'].includes(word)) return 'help'
  if (['C', 'CONFIRM'].includes(word)) return 'confirm'
  return null
}
