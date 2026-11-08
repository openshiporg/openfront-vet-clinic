import { timingSafeEqual } from 'node:crypto'
import { keystoneContext } from '@/features/keystone/context'
import { runClinicalJobs } from '@/features/keystone/workers/clinical'

/**
 * The clinical clocks (treatment sheets, unsigned-record escalation, daily reminders). Called by the
 * scheduler with "Authorization: Bearer $JOBS_SECRET"; `?only=treatment,records,reminders` narrows it.
 * Reminder texts and rendered documents leave through the outbox (POST /api/jobs/comms).
 */
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new Response('Not authorised', { status: 401 })
  const only = new URL(request.url).searchParams.get('only')?.split(',').map(s => s.trim()).filter(Boolean)
  const results = await runClinicalJobs((keystoneContext as any).prisma, { only })
  return Response.json({ results }, { status: results.some(r => r.error) ? 500 : 200 })
}
