/**
 * Next.js server start hook: starts the in-app job scheduler (clinical clocks + comms/document worker)
 * and loads release reference data. See features/keystone/workers/scheduler.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { schedulerEnabled, startScheduler } = await import('./features/keystone/workers/scheduler')
  if (!schedulerEnabled()) return
  const { keystoneContext } = await import('./features/keystone/context')
  const { configureTelephonyFromEnv } = await import('./features/integrations/telephony/config')
  configureTelephonyFromEnv()
  startScheduler((keystoneContext as any).prisma)
}
