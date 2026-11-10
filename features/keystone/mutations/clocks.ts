import { command } from '../lib/command'
import { requirePermission, actorFromSession } from '../lib/actor'
import { runUnsignedRecordClock } from './record'
import { runTreatmentSheetJob } from './treatment'
import { runReminderJob } from './vaccines'

/**
 * The time-based clocks (treatment sheets due/overdue, unsigned-record tasks, vaccine reminder
 * status) run when a staff member presses "Refresh" on the hospital, records or vaccines screen.
 * Nothing runs on a timer: no scheduler, no cron, no worker. Every step is idempotent.
 */
export async function refreshClinicalClocks(_root: unknown, args: { idempotencyKey: string }, context: { session: unknown; prisma: any }) {
  const actor = actorFromSession(context.session as never)
  requirePermission(actor, 'canAdminister', 'canSignRecord', 'canBook', 'canManagePractice')
  const result = await command(context.prisma, { name: 'clocks.refresh', actor, idempotencyKey: args.idempotencyKey, params: {} }, async uow => {
    const treatment = await runTreatmentSheetJob(uow)
    const records = await runUnsignedRecordClock(uow)
    const locations = await uow.tx.location.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { id: true } })
    const reminders = []
    for (const loc of locations) reminders.push(await runReminderJob(uow, loc.id))
    return { treatment, records, reminders }
  })
  return { replay: result.replay, ...result.value }
}
