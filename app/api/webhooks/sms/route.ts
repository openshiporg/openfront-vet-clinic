import { keystoneContext } from '@/features/keystone/context'
import { parseInboundSms, verifyTwilioSignature } from '@/features/integrations/telephony'
import { receiveInboundSms } from '@/features/keystone/mutations/reception'

/**
 * Inbound SMS webhook (INTEGRATIONS §7.1). The provider's signature is checked against the
 * practice's auth token before anything is read; opt-out keywords are handled first inside the
 * command. The body is stored as received and never rendered as HTML.
 */
export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token) return new Response('SMS provider not configured', { status: 503 })
  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of form.entries()) if (typeof value === 'string') params[key] = value
  const publicUrl = process.env.TWILIO_WEBHOOK_URL || request.url
  if (!verifyTwilioSignature(token, publicUrl, params, request.headers.get('x-twilio-signature'))) return new Response('Invalid signature', { status: 403 })
  try {
    const sms = parseInboundSms(params)
    await receiveInboundSms((keystoneContext as any).prisma, sms)
  } catch (error) {
    console.error('Inbound SMS failed:', error instanceof Error ? error.message.slice(0, 200) : 'unknown')
    return new Response('Retry later', { status: 500 })
  }
  // An empty TwiML response: replies go through the outbox worker and its send-time guard.
  return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
