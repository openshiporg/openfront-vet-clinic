import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Telephony and SMS (INTEGRATIONS §7.1; ported from Openfront Home Services). Business code sends
 * through this interface only; the outbox worker calls it after the send-time guard (I-C3, I-G2).
 * Adapters:
 * - manual (default): nothing leaves the building; the worker raises a Task so a person sends the
 *   text from the office phone, and the Message stays queued until they mark it sent.
 * - twilio: Programmable Messaging REST API with the account's credentials from SecretBox.
 * - recording: an in-memory recorder used by the integration tests (the fake telephony).
 */

export type SmsRequest = { to: string; from: string; body: string; idempotencyKey: string; statusCallbackUrl?: string }
export type SmsResult = { status: 'accepted'; providerMessageId: string } | { status: 'handed_off'; reason: string }

export interface TelephonyAdapter {
  readonly key: string
  sendSms(request: SmsRequest): Promise<SmsResult>
  /** Ring a person (urgent transfer, on-call paging); returns the provider call id, or a hand-off. */
  placeCall(request: { to: string; from: string; say: string; idempotencyKey: string }): Promise<{ status: 'accepted'; providerCallId: string } | { status: 'handed_off'; reason: string }>
}

export const manualTelephony: TelephonyAdapter = {
  key: 'manual',
  async sendSms() {
    return { status: 'handed_off', reason: 'No SMS provider is connected; send this text from the office phone.' }
  },
  async placeCall() {
    return { status: 'handed_off', reason: 'No voice provider is connected; the front desk calls back directly.' }
  },
}

export type TwilioConfig = { accountSid: string; authToken: string; messagingServiceSid?: string; baseUrl?: string; fetch?: typeof fetch }

export function twilioTelephony(config: TwilioConfig): TelephonyAdapter {
  const base = config.baseUrl ?? 'https://api.twilio.com'
  const http = config.fetch ?? fetch
  const auth = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`
  // Exactly-once is ours (the outbox dedupe key and the Message CAS), not the provider's.
  const post = async (path: string, form: Record<string, string>) => {
    const response = await http(`${base}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
    const json = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number }
    if (!response.ok || !json.sid) throw new Error(`Twilio ${path} failed (${response.status}${json.code ? ` code ${json.code}` : ''})`)
    return json.sid
  }
  return {
    key: 'twilio',
    async sendSms(request) {
      const form: Record<string, string> = { To: request.to, Body: request.body }
      if (config.messagingServiceSid) form.MessagingServiceSid = config.messagingServiceSid
      else form.From = request.from
      if (request.statusCallbackUrl) form.StatusCallback = request.statusCallbackUrl
      return { status: 'accepted', providerMessageId: await post('Messages.json', form) }
    },
    async placeCall(request) {
      const twiml = `<Response><Say>${request.say.replace(/[<>&]/g, '')}</Say></Response>`
      return { status: 'accepted', providerCallId: await post('Calls.json', { To: request.to, From: request.from, Twiml: twiml }) }
    },
  }
}

export type Recorded = { kind: 'sms' | 'call'; to: string; from: string; body: string; idempotencyKey: string; id: string }

/** The fake telephony for tests: records every send, answers like a provider, and dedupes by key. */
export function recordingTelephony() {
  const sent: Recorded[] = []
  const byKey = new Map<string, Recorded>()
  const record = (kind: Recorded['kind'], to: string, from: string, body: string, idempotencyKey: string) => {
    const existing = byKey.get(idempotencyKey)
    if (existing) return existing
    const item = { kind, to, from, body, idempotencyKey, id: `${kind === 'sms' ? 'SM' : 'CA'}${String(sent.length + 1).padStart(32, '0')}` }
    sent.push(item)
    byKey.set(idempotencyKey, item)
    return item
  }
  const adapter: TelephonyAdapter = {
    key: 'recording',
    async sendSms(request) {
      return { status: 'accepted', providerMessageId: record('sms', request.to, request.from, request.body, request.idempotencyKey).id }
    },
    async placeCall(request) {
      return { status: 'accepted', providerCallId: record('call', request.to, request.from, request.say, request.idempotencyKey).id }
    },
  }
  return { adapter, sent }
}

let current: TelephonyAdapter = manualTelephony
export const telephony = () => current
export function setTelephony(adapter: TelephonyAdapter) {
  current = adapter
}

// ── Inbound webhooks ──────────────────────────────────────────────────────────────────────

export type InboundSms = { from: string; to: string; body: string; providerId: string }

/**
 * Twilio request signature (X-Twilio-Signature): base64 HMAC-SHA1 of the full URL followed by the
 * POST parameters sorted by name, each name and value appended. Compared in constant time.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('')
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null | undefined) {
  if (!signature) return false
  const expected = Buffer.from(twilioSignature(authToken, url, params))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Parse a provider's inbound-SMS form post into the one shape the inbox command takes. */
export function parseInboundSms(params: Record<string, string>): InboundSms {
  const providerId = params.MessageSid || params.SmsSid || ''
  if (!/^[A-Za-z0-9]{10,64}$/.test(providerId)) throw new Error('Inbound SMS without a valid message id')
  return { from: String(params.From ?? ''), to: String(params.To ?? ''), body: String(params.Body ?? '').slice(0, 1600), providerId }
}
