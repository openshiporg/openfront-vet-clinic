import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label, zoneName } from '../../lib/format';
import { dayBounds, todayIn } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';

type Appt = {
  id: string; ref: string; startsAt: string; status: string; channel: string; version: number; reason: string;
  appointmentType: { name: string } | null; provider: { displayName: string } | null; location: { code: string } | null;
  client: { id: string; displayName: string } | null;
  patients: { patient: { id: string; name: string; alerts: { id: string; severity: string; text: string }[] } | null }[];
};
type Call = { id: string; ref: string; answeredBy: string; disposition: string; status: string; startedAt: string; client: { displayName: string } | null };
type Task = { id: string; title: string; kind: string; priority: string; dueAt: string | null; subjectType: string; subjectId: string };

const OPEN = ['requested', 'booked', 'confirmed', 'checked_in', 'in_progress', 'ready_for_checkout'];
const PATHS = ['/dashboard/platform/today', '/dashboard/platform/whiteboard', '/dashboard/platform/schedule'];

/**
 * The front desk's day (BUILD-PLAN §2 Home). Everything here is today in the practice's zone:
 * appointments by status, the board, calls answered by the AI receptionist and by staff, and the
 * urgent call-backs a person must make. Check-in asks for the patient's alerts to be acknowledged.
 */
export default async function TodayPage() {
  const tz = await practiceTimeZone();
  const today = todayIn(tz);
  const { from, to } = dayBounds(today, tz);
  const data = await q<{ appointments: Appt[]; whiteboardEntries: { status: string }[]; callRecords: Call[]; tasks: Task[]; requested: number; refills: number; records: number }>(`
    query Today($from: DateTime!, $to: DateTime!) {
      appointments(where: { startsAt: { gte: $from, lt: $to } }, orderBy: { startsAt: asc }, take: 300) {
        id ref startsAt status channel version reason appointmentType { name } provider { displayName } location { code } client { id displayName }
        patients { patient { id name alerts(where: { active: { equals: true } }) { id severity text } } }
      }
      whiteboardEntries(where: { status: { notIn: ["discharged"] } }, take: 300) { status }
      callRecords(where: { startedAt: { gte: $from, lt: $to } }, orderBy: { startedAt: desc }, take: 100) { id ref answeredBy disposition status startedAt client { displayName } }
      tasks(where: { status: { in: ["open", "in_progress"] }, priority: { in: ["urgent", "high"] } }, orderBy: { createdAt: desc }, take: 20) { id title kind priority dueAt subjectType subjectId }
      requested: appointmentsCount(where: { status: { equals: "requested" } })
      refills: refillRequestsCount(where: { status: { in: ["received", "in_review"] } })
      records: recordsRequestsCount(where: { status: { in: ["received", "verifying_authority", "approved"] } })
    }`, { from, to });
  const appts = data.appointments;
  const open = appts.filter(a => OPEN.includes(a.status));
  const done = appts.filter(a => !OPEN.includes(a.status));
  const ai = data.callRecords.filter(c => c.answeredBy === 'ai');
  const aiTransferred = ai.filter(c => ['transferred', 'urgent_transfer', 'er_referred'].includes(c.disposition)).length;
  return (
    <Page title="Today">
      <p className="text-sm text-muted-foreground">{when(from, tz, 'day')} · {zoneName(tz)}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat name="Appointments" value={appts.length} />
        <Stat name="Checked in" value={appts.filter(a => ['checked_in', 'in_progress'].includes(a.status)).length} />
        <Stat name="On the board" value={data.whiteboardEntries.length} />
        <Stat name="Requests to accept" value={data.requested ? <Link className="text-amber-600 underline" href="/dashboard/platform/schedule?view=requested">{data.requested}</Link> : 0} />
        <Stat name="AI calls" value={`${ai.length} · ${aiTransferred} transferred`} />
        <Stat name="Refills · records" value={`${data.refills} · ${data.records}`} />
      </div>
      {data.tasks.length ? (
        <Section title="Urgent call-backs and follow-ups">
          {data.tasks.map(t => (
            <Row key={t.id}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <span className={t.priority === 'urgent' ? 'font-medium text-red-700 dark:text-red-400' : 'font-medium'}>{t.title}</span>
                <Meta>{label(t.kind)} · {label(t.subjectType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase())}{t.dueAt ? ` · due ${when(t.dueAt, tz)}` : ''}</Meta>
              </div>
              <Status value={t.priority} />
            </Row>
          ))}
        </Section>
      ) : null}
      <Section title={`Still to see (${open.length})`} aside={<Link href="/dashboard/platform/schedule" className="text-xs underline">Day sheet</Link>}>
        {open.length ? open.map(a => <ApptRow key={a.id} a={a} tz={tz} />) : <Empty>No open appointments today.</Empty>}
      </Section>
      <Section title={`Done or closed (${done.length})`}>
        {done.length ? done.map(a => <ApptRow key={a.id} a={a} tz={tz} />) : <Empty>Nothing closed yet.</Empty>}
      </Section>
      <Section title="Calls today" aside={<Link href="/dashboard/platform/calls" className="text-xs underline">All calls</Link>}>
        {data.callRecords.length ? data.callRecords.slice(0, 8).map(c => (
          <Row key={c.id} href={`/dashboard/platform/calls/${c.id}`}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{c.ref}</span><span>{c.client?.displayName ?? 'Unknown caller'}</span></div>
              <Meta>{when(c.startedAt, tz, 'time')} · answered by {c.answeredBy === 'ai' ? 'AI receptionist' : label(c.answeredBy)} · {label(c.disposition)}</Meta>
            </div>
            <Status value={c.status} />
          </Row>
        )) : <Empty>No calls yet today.</Empty>}
      </Section>
    </Page>
  );
}

function ApptRow({ a, tz }: { a: Appt; tz: string }) {
  const alerts = a.patients.flatMap(p => p.patient?.alerts ?? []);
  const toAck = alerts.filter(x => x.severity !== 'info').map(x => x.id);
  return (
    <Row>
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs">{when(a.startsAt, tz, 'time')}</span>
          {a.patients.map(p => p.patient ? <Link key={p.patient.id} href={`/dashboard/platform/patients/${p.patient.id}`} className="font-medium underline-offset-2 hover:underline">{p.patient.name}</Link> : null)}
          {a.client ? <Link href={`/dashboard/platform/clients/${a.client.id}`} className="text-muted-foreground hover:underline">{a.client.displayName}</Link> : null}
        </div>
        <Meta>{a.ref} · {a.appointmentType?.name} · {a.provider?.displayName ?? 'unassigned'} · {a.location?.code}{a.channel === 'ai_voice' ? ' · booked by AI receptionist' : ''}{a.reason && a.reason !== a.appointmentType?.name ? ` · ${a.reason}` : ''}</Meta>
        {alerts.length ? <p className="text-xs text-red-700 dark:text-red-400">⚠ {alerts.map(x => x.text).join(' · ')}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Status value={a.status} />
        {a.status === 'requested' ? <ActionButton op="acceptAppointmentRequest" vars={{ appointmentId: a.id, expectedVersion: a.version }} paths={PATHS}>Accept</ActionButton> : null}
        {['booked', 'confirmed'].includes(a.status) ? (
          <ActionButton op="checkInAppointment" vars={{ appointmentId: a.id, expectedVersion: a.version, acknowledgedAlertIds: toAck }} paths={PATHS}
            confirm={toAck.length ? `Check in and acknowledge: ${alerts.filter(x => x.severity !== 'info').map(x => x.text).join('; ')}` : undefined}>Check in</ActionButton>
        ) : null}
        {a.status === 'booked' ? <ActionButton op="confirmAppointment" vars={{ appointmentId: a.id, expectedVersion: a.version }} paths={PATHS}>Confirm</ActionButton> : null}
        {['booked', 'confirmed'].includes(a.status) ? <ActionButton op="markNoShow" vars={{ appointmentId: a.id, expectedVersion: a.version }} paths={PATHS} confirm="Mark as no-show?">No-show</ActionButton> : null}
      </div>
    </Row>
  );
}
