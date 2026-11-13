import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * A payment link for one invoice: `<invoiceId>.<expiry>.<mac>`, signed with a key derived from SESSION_SECRET for this purpose only.
 * The link is the client's permission to pay that invoice's balance and to see its reference and amount; nothing else.
 * The practice sends it however it already talks to the client (this app sends nothing).
 */

const DEVELOPMENT_SECRET = 'this secret should only be used in testing'
export const PAY_LINK_DAYS = 30

function key() {
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : DEVELOPMENT_SECRET)
  if (secret.length < 16) throw new Error('SESSION_SECRET is required to sign payment links')
  return createHmac('sha256', secret).update('vc-invoice-pay-link', 'utf8').digest()
}

const mac = (body: string) => createHmac('sha256', key()).update(body, 'utf8').digest('base64url')

export function signPayLink(invoiceId: string, now = Date.now()): string {
  const body = `${invoiceId}.${Math.floor(now / 1000) + PAY_LINK_DAYS * 86_400}`
  return `${body}.${mac(body)}`
}

/** The invoice id, or null when the link was altered or has expired. */
export function verifyPayLink(token: string, now = Date.now()): string | null {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3 || !/^[a-z0-9]{10,40}$/.test(parts[0]) || !/^\d{9,11}$/.test(parts[1])) return null
  const body = `${parts[0]}.${parts[1]}`
  const given = Buffer.from(parts[2], 'base64url')
  const expected = Buffer.from(mac(body), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  if (Number(parts[1]) * 1000 <= now) return null
  return parts[0]
}
