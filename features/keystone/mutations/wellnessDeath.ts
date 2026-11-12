import { transition } from '../lib/cas'
import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'

/**
 * A death ends the plan with no true-up and no further charge: every charge path checks the enrolment status and the patient
 * inside its own lock, so a billing run that races with this finds `ended_by_death` and skips.
 */
export async function cancelEnrollmentByDeath(uow: UnitOfWork, actor: Actor, enrollmentId: string) {
  await transition(uow, {
    model: 'Enrollment', id: enrollmentId, from: ['pending_payment', 'active', 'cancelling', 'suspended'], to: 'ended_by_death', actor, eventType: 'wellness.ended_by_death',
    reason: 'The patient died', data: { endedAt: uow.now, autoRenew: false, cancelReason: 'The patient died' },
  })
}
