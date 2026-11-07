import type { Db } from '../lib/db'
import { TRANSACTION_OPTIONS } from '../lib/db'
import { localDate } from '../lib/calendar'
import { drainOutbox, type ClaimedMessage, type OutboxHandlers } from '../lib/outbox'
import { appendAuditEvents } from '../lib/audit'
import { loadPolicySnapshot, resolveFromSnapshot } from '../domain/policy'
import { sendDecision, type ConsentRequirement } from '../domain/contact'
import { telephony, type TelephonyAdapter } from '../../integrations/telephony'

/**
 * The comms worker (INTEGRATIONS §1, §7.1). Two steps, never mixed:
 *   1. compose: an outbox topic becomes a queued CommsMessage (in a transaction, no network);
 *   2. send: each queued message passes the send-time guard (deceased, contact status, suppression,
 *      consent for the purpose, quiet hours in the location's zone) and then goes to the telephony
 *      adapter outside any transaction. A block is final (status blocked + reason, never retried); a
 *      quiet-hours deferral waits; a hand-off (manual adapter) raises a staff task.
 */

const fmtWhen = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

const localTime = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)

function render(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => values[key] ?? '')
}

const FALLBACK: Record<string, string> = {
  appointment_booked: '{{practice}}: {{pet}} is booked for {{when}} with {{provider}}. Reply C to confirm, STOP to opt out.',
  appointment_requested: '{{practice}}: we have your request for {{pet}} on {{when}}. The team will confirm shortly. Reply STOP to opt out.',
  stop_confirmation: '{{practice}}: you will no longer receive texts from us. Reply START to opt back in.',
  help_reply: '{{practice}}: for help call {{phone}}. Reply STOP to opt out. Msg & data rates may apply.',
}

async function template(db: Db, code: string) {
  const row = await db.messageTemplate.findFirst({ where: { code, channel: 'sms', active: true }, orderBy: { templateVersion: 'desc' }, select: { body: true, purpose: true } })
  return row ?? { body: FALLBACK[code] ?? '', purpose: 'transactional' }
}

/** Compose an appointment message for the primary person's primary mobile. */
async function composeAppointment(db: Db, message: ClaimedMessage) {
  const { appointmentId, template: code } = message.payload as { appointmentId: string; template: string }
  const appt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true, startsAt: true, clientId: true, location: { select: { name: true, timeZone: true, phone: true } }, provider: { select: { displayName: true } },
      patients: { select: { patientId: true, patient: { select: { name: true } } } },
      client: { select: { people: { where: { isPrimary: true }, select: { contactPoints: { where: { kind: 'mobile', isPrimary: true }, select: { id: true, value: true } } } } } },
    },
  })
  const contact = appt?.client?.people[0]?.contactPoints[0]
  if (!appt || !contact) return null
  const tpl = await template(db, code)
  const tz = appt.location?.timeZone ?? 'America/Los_Angeles'
  const body = render(tpl.body, { practice: appt.location?.name ?? '', pet: appt.patients.map(p => p.patient?.name).filter(Boolean).join(' and '), when: fmtWhen(appt.startsAt, tz), provider: appt.provider?.displayName ?? 'our team', phone: appt.location?.phone ?? '' })
  return db.$transaction(async tx => {
    const thread = (await tx.commsThread.findFirst({ where: { contactPointId: contact.id, channel: 'sms', status: { not: 'closed' } } }))
      ?? (await tx.commsThread.create({ data: { clientId: appt.clientId, contactPointId: contact.id, channel: 'sms', subject: 'Text messages', status: 'open' } }))
    const exists = await tx.commsMessage.findFirst({ where: { threadId: thread.id, appointmentId: appt.id, templateCode: code }, select: { id: true } })
    if (exists) return exists.id
    const row = await tx.commsMessage.create({ data: { threadId: thread.id, direction: 'outbound', purpose: tpl.purpose === 'marketing' ? 'marketing' : tpl.purpose === 'care' ? 'care' : 'transactional', templateCode: code, to: contact.value, body, status: 'queued', patientId: appt.patients[0]?.patientId ?? null, appointmentId: appt.id } })
    return row.id
  }, TRANSACTION_OPTIONS)
}

/** STOP confirmation and HELP reply: the only texts that may go to a suppressed number (CTIA). */
async function composeKeywordReply(db: Db, message: ClaimedMessage) {
  const { kind, to } = message.payload as { kind: 'stop_confirmation' | 'help_reply'; to: string }
  const thread = await db.commsThread.findUnique({ where: { id: message.aggregateId }, select: { id: true } })
  if (!thread) return null
  const location = await db.location.findFirst({ where: { active: true }, orderBy: { code: 'asc' }, select: { name: true, phone: true } })
  const tpl = await template(db, kind)
  const body = render(tpl.body, { practice: location?.name ?? '', phone: location?.phone ?? '' })
  const row = await db.commsMessage.create({ data: { threadId: thread.id, direction: 'outbound', purpose: 'transactional', templateCode: kind, to, body, status: 'queued' } })
  return row.id
}

/**
 * An urgent or emergency screen raises an urgent staff task (one per assessment) so a person calls
 * the client back or takes the transfer; the on-call phone is paged by the telephony adapter in the
 * send step when the practice configures it (manual: the task is the page).
 */
async function raiseUrgentTask(db: Db, message: ClaimedMessage) {
  const { level, callRecordId } = message.payload as { level: string; callRecordId: string | null }
  const triage = await db.triageAssessment.findUnique({ where: { id: message.aggregateId }, select: { id: true, complaint: true, callRecord: { select: { locationId: true, from: true } }, patient: { select: { name: true } } } })
  if (!triage) return
  await db.$transaction(async tx => {
    const open = await tx.task.findFirst({ where: { subjectType: 'TriageAssessment', subjectId: triage.id }, select: { id: true } })
    if (open) return
    const who = triage.patient?.name ? `${triage.patient.name}: ` : ''
    const task = await tx.task.create({
      data: {
        kind: 'call_back', priority: 'urgent', status: 'open', dueAt: new Date(), subjectType: 'TriageAssessment', subjectId: triage.id, locationId: triage.callRecord?.locationId ?? null, roleName: 'csr',
        title: level === 'emergency_now' ? `EMERGENCY call: ${who}transfer or confirm ER referral now` : `Urgent call-back today: ${who}${triage.complaint.slice(0, 80)}`,
        detail: callRecordId ? `Call ${callRecordId}` : '',
      },
    })
    await appendAuditEvents(tx, [{ eventType: 'task.raised', entityType: 'Task', entityId: task.id, after: { kind: 'call_back', priority: 'urgent', level }, metadata: { system: 'comms-worker' } }], new Date())
  }, TRANSACTION_OPTIONS)
}

/** A cancellation frees a slot: the matching waitlist entries become a staff task (offers are made by people or the portal API). */
async function noteFreedSlot(db: Db, message: ClaimedMessage) {
  const appt = await db.appointment.findUnique({ where: { id: message.aggregateId }, select: { id: true, ref: true, startsAt: true, locationId: true, appointmentTypeId: true } })
  if (!appt) return
  const waiting = await db.waitlistEntry.count({ where: { status: 'waiting', locationId: appt.locationId, OR: [{ appointmentTypeId: appt.appointmentTypeId }, { appointmentTypeId: null }] } })
  if (!waiting) return
  await db.$transaction(async tx => {
    const open = await tx.task.findFirst({ where: { subjectType: 'Appointment', subjectId: appt.id, kind: 'follow_up' }, select: { id: true } })
    if (!open) await tx.task.create({ data: { kind: 'follow_up', priority: 'normal', status: 'open', dueAt: new Date(), subjectType: 'Appointment', subjectId: appt.id, locationId: appt.locationId, roleName: 'csr', title: `Slot freed (${appt.ref}): ${waiting} waiting`, detail: `Offer ${appt.startsAt.toISOString()} to the waitlist.` } })
  }, TRANSACTION_OPTIONS)
}

export const composeHandlers = (db: Db): OutboxHandlers => ({
  'comms.appointment_booked': async message => { await composeAppointment(db, message) },
  'comms.send': async message => { await composeKeywordReply(db, message) },
  'notify.urgent_call': async message => { await raiseUrgentTask(db, message) },
  'waitlist.slot_freed': async message => { await noteFreedSlot(db, message) },
  // The approvals inbox reads ApprovalRequest directly; the event is the push hook for a notifier adapter.
  'notify.approval': async () => undefined,
})

export type SendOutcome = { id: string; result: 'sent' | 'blocked' | 'deferred' | 'handed_off'; reason?: string }

/** Pass every queued outbound message through the guard and the adapter. */
export async function sendQueued(db: Db, options: { adapter?: TelephonyAdapter; now?: Date; limit?: number; from?: string } = {}): Promise<SendOutcome[]> {
  const adapter = options.adapter ?? telephony()
  const now = options.now ?? new Date()
  const queued = await db.commsMessage.findMany({
    where: { status: 'queued', direction: 'outbound' }, orderBy: { createdAt: 'asc' }, take: options.limit ?? 50,
    select: {
      id: true, version: true, purpose: true, to: true, body: true, templateCode: true, patient: { select: { status: true } },
      thread: { select: { contactPointId: true, contactPoint: { select: { status: true, consents: { select: { purpose: true, action: true, at: true } } } }, client: { select: { primaryLocationId: true } } } },
    },
  })
  if (!queued.length) return []
  const snapshot = await loadPolicySnapshot(db as never, ['contact'])
  const contactIds = queued.map(m => m.thread?.contactPointId).filter((id): id is string => !!id)
  const suppressed = new Set((await db.suppression.findMany({ where: { active: true, contactPointId: { in: contactIds } }, select: { contactPointId: true } })).map(s => s.contactPointId))
  const fallbackLocation = await db.location.findFirst({ where: { active: true }, orderBy: { code: 'asc' }, select: { id: true, timeZone: true } })
  const out: SendOutcome[] = []
  for (const m of queued) {
    const locationId = m.thread?.client?.primaryLocationId ?? fallbackLocation?.id
    const location = locationId ? await db.location.findUnique({ where: { id: locationId }, select: { id: true, timeZone: true } }) : null
    const tz = location?.timeZone ?? 'America/Los_Angeles'
    const finish = async (status: 'blocked' | 'sent' | 'queued', data: Record<string, unknown>, event: string, after: Record<string, unknown>) => {
      await db.$transaction(async tx => {
        const updated = await tx.commsMessage.updateMany({ where: { id: m.id, version: m.version, status: 'queued' }, data: { ...data, status, version: { increment: 1 } } })
        if (updated.count === 1) await appendAuditEvents(tx, [{ eventType: event, entityType: 'CommsMessage', entityId: m.id, after, metadata: { system: 'comms-worker' } }], now)
      }, TRANSACTION_OPTIONS)
    }
    // Keyword replies are the CTIA exception: they go even to a number that just opted out.
    const keywordReply = m.templateCode === 'stop_confirmation' || m.templateCode === 'help_reply'
    let decision: ReturnType<typeof sendDecision>
    try {
      const policy = resolveFromSnapshot(snapshot, 'contact', { locationId: location!.id, on: localDate({ timeZone: tz }, now) })
      const purpose = (m.purpose as 'care' | 'transactional' | 'marketing')
      decision = keywordReply
        ? { action: 'send' }
        : sendDecision({
          purpose, patientStatus: m.patient?.status ?? null, contactStatus: m.thread?.contactPoint?.status ?? 'invalid',
          consentRows: m.thread?.contactPoint?.consents ?? [], requirement: (policy.rules.consentPurposes[purpose] ?? 'express_written') as ConsentRequirement,
          suppressed: !!m.thread?.contactPointId && suppressed.has(m.thread.contactPointId), localTime: localTime(now, tz), quietHours: policy.rules.quietHours,
        })
    } catch {
      decision = { action: 'block', reason: 'policy_unresolved' }
    }
    if (decision.action === 'block') {
      await finish('blocked', { blockedReason: decision.reason }, 'comms.blocked', { reason: decision.reason })
      out.push({ id: m.id, result: 'blocked', reason: decision.reason })
      continue
    }
    if (decision.action === 'defer') {
      out.push({ id: m.id, result: 'deferred', reason: decision.reason })
      continue
    }
    // Claim before the network call so a second worker cannot send it too.
    const claimed = await db.commsMessage.updateMany({ where: { id: m.id, version: m.version, status: 'queued' }, data: { status: 'sending', version: { increment: 1 } } })
    if (claimed.count !== 1) continue
    try {
      const result = await adapter.sendSms({ to: m.to, from: options.from ?? '', body: m.body, idempotencyKey: `comms:${m.id}` })
      if (result.status === 'accepted') {
        await db.$transaction(async tx => {
          await tx.commsMessage.update({ where: { id: m.id }, data: { status: 'sent', providerId: result.providerMessageId, sentAt: now, version: { increment: 1 } } })
          await appendAuditEvents(tx, [{ eventType: 'comms.sent', entityType: 'CommsMessage', entityId: m.id, after: { adapter: adapter.key }, metadata: { system: 'comms-worker' } }], now)
        }, TRANSACTION_OPTIONS)
        out.push({ id: m.id, result: 'sent' })
      } else {
        await db.$transaction(async tx => {
          await tx.commsMessage.update({ where: { id: m.id }, data: { status: 'queued', version: { increment: 1 } } })
          const open = await tx.task.findFirst({ where: { subjectType: 'CommsMessage', subjectId: m.id, status: 'open' }, select: { id: true } })
          if (!open) await tx.task.create({ data: { kind: 'follow_up', title: `Send text to ${m.to.slice(0, 2)}…${m.to.slice(-4)} by hand`, detail: result.reason, subjectType: 'CommsMessage', subjectId: m.id, priority: 'normal', status: 'open', dueAt: now } })
        }, TRANSACTION_OPTIONS)
        out.push({ id: m.id, result: 'handed_off', reason: result.reason })
      }
    } catch (error) {
      await db.commsMessage.update({ where: { id: m.id }, data: { status: 'failed', version: { increment: 1 } } })
      out.push({ id: m.id, result: 'blocked', reason: error instanceof Error ? error.message.slice(0, 120) : 'send_failed' })
    }
  }
  return out
}

/** One worker tick: compose from the outbox, then send. */
export async function runCommsWorker(db: Db, options: { workerId?: string; adapter?: TelephonyAdapter; now?: () => Date } = {}) {
  const drained = await drainOutbox(db, { workerId: options.workerId ?? 'comms-worker', handlers: composeHandlers(db), topics: Object.keys(composeHandlers(db)), now: options.now })
  const sent = await sendQueued(db, { adapter: options.adapter, now: options.now?.() })
  return { drained, sent }
}
