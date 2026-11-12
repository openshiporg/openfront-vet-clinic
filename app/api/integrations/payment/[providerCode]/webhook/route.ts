import { NextRequest, NextResponse } from 'next/server'
import { keystoneContext } from '@/features/keystone/context'
import { adapterFor } from '@/features/integrations/payment'
import { applyPaymentEvent } from '@/features/keystone/mutations/billing'
import { systemActor } from '@/features/keystone/lib/actor'

export const dynamic = 'force-dynamic'

/**
 * The payment processor's events, on the one payment route (the same shape Restaurant uses). The signature is checked against the raw
 * body, the event is recorded once by its own id, and a repeat is acknowledged and does nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ providerCode: string }> }) {
  const { providerCode } = await params
  if (providerCode !== 'stripe') return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  let event
  try {
    event = adapterFor(providerCode).readEvent(rawBody, headers)
  } catch {
    return NextResponse.json({ error: 'The event could not be verified.' }, { status: 400 })
  }
  try {
    const prisma = (keystoneContext as unknown as { prisma: never }).prisma
    const result = await applyPaymentEvent(prisma, systemActor('payment-webhook'), { provider: providerCode, id: event.id, type: event.type, objectRef: event.objectRef, outcome: event.outcome })
    return NextResponse.json({ ok: true, duplicate: result.duplicate })
  } catch {
    return NextResponse.json({ error: 'The event could not be applied.' }, { status: 500 })
  }
}
