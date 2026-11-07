import { timingSafeEqual } from 'node:crypto'
import { keystoneContext } from '@/features/keystone/context'
import { runCommsWorker } from '@/features/keystone/workers/comms'
import { configureTelephonyFromEnv } from '@/features/integrations/telephony/config'

configureTelephonyFromEnv()

/** One comms-worker tick (compose from the outbox, then send through the guard). Called by the scheduler. */
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response('Not authorised', { status: 401 })
  const result = await runCommsWorker((keystoneContext as any).prisma)
  return Response.json({ drained: result.drained, sent: result.sent.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.result]: (acc[s.result] ?? 0) + 1 }), {}) })
}
