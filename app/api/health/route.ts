import { keystoneContext } from '@/features/keystone/context'

export const dynamic = 'force-dynamic'

/** Health: the database answers. Nothing else is reported: no timers, workers or queues exist. */
export async function GET() {
  try {
    // The app's own pool (one per process, sized by connection_limit in DATABASE_URL); never a second one.
    const prisma = (keystoneContext as any).prisma as import('@prisma/client').PrismaClient
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ status: 'ok', database: 'ok' })
  } catch {
    return Response.json({ status: 'unhealthy', reason: 'database_unavailable' }, { status: 503 })
  }
}
