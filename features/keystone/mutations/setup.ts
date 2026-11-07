import { actorFromSession, requirePermission } from '../lib/actor'
import { command } from '../lib/command'
import { seedPractice } from '../seed/platform'
import { seedClinic } from '../seed/clinic'

/** Onboarding: load the Cedar Creek Animal Hospital practice spine. Idempotent per key and per record. */
export async function loadPracticeSetup(_root: unknown, args: { idempotencyKey: string }, context: any) {
  const actor = actorFromSession(context.session)
  requirePermission(actor, 'canManageOnboarding')
  const result = await command(context.prisma, { name: 'setup.load_practice', actor, idempotencyKey: args.idempotencyKey, params: {} }, uow => seedPractice(uow, actor))
  return { replay: result.replay, created: result.value }
}

/** Onboarding step 2: species, rooms, appointment types, schedules, triage protocol, households and patients, the day sheet. */
export async function loadClinicSetup(_root: unknown, args: { idempotencyKey: string }, context: any) {
  const actor = actorFromSession(context.session)
  requirePermission(actor, 'canManageOnboarding')
  const result = await command(context.prisma, { name: 'setup.load_clinic', actor, idempotencyKey: args.idempotencyKey, params: {} }, uow => seedClinic(uow, actor))
  return { replay: result.replay, created: result.value }
}
