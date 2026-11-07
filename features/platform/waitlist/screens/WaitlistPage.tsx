import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type Entry = {
  id: string; urgency: string; status: string; note: string; createdAt: string; offerExpiresAt: string | null; preferredWindows: unknown;
  client: { id: string; displayName: string } | null; patients: { id: string; name: string }[]; location: { name: string } | null; appointmentType: { name: string } | null;
  bookedAppointment: { ref: string; startsAt: string } | null;
};

/**
 * Waitlist (BUILD-PLAN §2 Front desk). When an appointment is cancelled the worker raises a
 * follow-up task with the number waiting for that slot; offers are signed slot tokens with expiry.
 */
export default async function WaitlistPage() {
  const [data, tz] = await Promise.all([
    q<{ waitlistEntries: Entry[]; tasks: { id: string; title: string; createdAt: string }[] }>(`{
      waitlistEntries(orderBy: { createdAt: asc }, take: 200) {
        id urgency status note createdAt offerExpiresAt preferredWindows client { id displayName } patients { id name } location { name } appointmentType { name } bookedAppointment { ref startsAt }
      }
      tasks(where: { kind: { equals: "follow_up" }, subjectType: { equals: "Appointment" }, status: { in: ["open", "in_progress"] } }, orderBy: { createdAt: desc }, take: 20) { id title createdAt }
    }`),
    practiceTimeZone(),
  ]);
  const waiting = data.waitlistEntries.filter(e => ['waiting', 'offered'].includes(e.status));
  const closed = data.waitlistEntries.filter(e => !['waiting', 'offered'].includes(e.status));
  return (
    <Page title="Waitlist">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Waiting" value={waiting.filter(e => e.status === 'waiting').length} />
        <Stat name="Offered" value={waiting.filter(e => e.status === 'offered').length} />
        <Stat name="Urgent" value={waiting.filter(e => e.urgency === 'urgent').length} />
        <Stat name="Freed slots to offer" value={data.tasks.length} />
      </div>
      {data.tasks.length ? (
        <Section title="Freed slots">
          {data.tasks.map(t => <Row key={t.id}><span>{t.title}</span><Meta>{when(t.createdAt, tz)}</Meta></Row>)}
        </Section>
      ) : null}
      <Section title="Waiting">
        {waiting.length ? waiting.map(e => (
          <Row key={e.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {e.client ? <Link className="font-medium hover:underline" href={`/dashboard/platform/clients/${e.client.id}`}>{e.client.displayName}</Link> : null}
                <span className="text-muted-foreground">{e.patients.map(p => p.name).join(', ')}</span>
              </div>
              <Meta>{e.appointmentType?.name} · {e.location?.name} · since {when(e.createdAt, tz, 'day')}{e.offerExpiresAt ? ` · offer expires ${when(e.offerExpiresAt, tz)}` : ''}{e.note ? ` · ${e.note}` : ''}</Meta>
            </div>
            <div className="flex items-center gap-3"><Status value={e.urgency === 'urgent' ? 'urgent' : undefined} /><Status value={e.status} /></div>
          </Row>
        )) : <Empty>Nobody is waiting. The front desk and the AI receptionist add people when no time suits.</Empty>}
      </Section>
      {closed.length ? (
        <Section title="Closed">
          {closed.slice(0, 50).map(e => (
            <Row key={e.id}>
              <div className="min-w-0 flex-1"><span>{e.client?.displayName}</span> <Meta>· {e.appointmentType?.name}{e.bookedAppointment ? ` · booked ${e.bookedAppointment.ref}` : ''} · {label(e.urgency)}</Meta></div>
              <Status value={e.status} />
            </Row>
          ))}
        </Section>
      ) : null}
    </Page>
  );
}
