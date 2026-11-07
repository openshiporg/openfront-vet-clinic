import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type Req = {
  id: string; ref: string; requesterKind: string; requesterName: string; channel: string; basis: string; scope: string; status: string; responseDueAt: string | null; createdAt: string;
  client: { id: string; displayName: string } | null; patient: { id: string; name: string } | null; createdByAgent: { name: string } | null;
};
type Refill = { id: string; ref: string; productText: string; channel: string; status: string; slaDueAt: string | null; createdAt: string; client: { id: string; displayName: string } | null; patient: { id: string; name: string } | null; createdByAgent: { name: string } | null };

/**
 * Records and refill requests taken by phone, portal or the AI receptionist. The AI only takes the
 * request: a DVM decides refills (Phase 3) and staff verify authority before any release, against the
 * policy-pack response clock.
 */
export default async function RecordsRequestsPage() {
  const [data, tz] = await Promise.all([
    q<{ recordsRequests: Req[]; refillRequests: Refill[] }>(`{
      recordsRequests(orderBy: { createdAt: desc }, take: 100) { id ref requesterKind requesterName channel basis scope status responseDueAt createdAt client { id displayName } patient { id name } createdByAgent { name } }
      refillRequests(orderBy: { createdAt: desc }, take: 100) { id ref productText channel status slaDueAt createdAt client { id displayName } patient { id name } createdByAgent { name } }
    }`),
    practiceTimeZone(),
  ]);
  const now = new Date().toISOString();
  const openRec = data.recordsRequests.filter(r => !['released', 'denied', 'withdrawn'].includes(r.status));
  const openRx = data.refillRequests.filter(r => ['received', 'in_review'].includes(r.status));
  const overdue = openRec.filter(r => r.responseDueAt && r.responseDueAt < now).length + openRx.filter(r => r.slaDueAt && r.slaDueAt < now).length;
  return (
    <Page title="Records requests">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Records open" value={openRec.length} />
        <Stat name="Refills open" value={openRx.length} />
        <Stat name="Past due" value={overdue ? <span className="text-red-600">{overdue}</span> : 0} />
        <Stat name="Taken by AI" value={[...data.recordsRequests, ...data.refillRequests].filter(r => r.createdByAgent).length} />
      </div>
      <Section title="Records requests">
        {data.recordsRequests.length ? data.recordsRequests.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{r.ref}</span><span className="font-medium">{r.requesterName || r.client?.displayName}</span>{r.patient ? <Link className="text-muted-foreground hover:underline" href={`/dashboard/platform/patients/${r.patient.id}`}>{r.patient.name}</Link> : null}</div>
              <Meta>{label(r.requesterKind)} · {label(r.basis)} · {label(r.scope)} · via {r.createdByAgent ? `AI receptionist` : label(r.channel)} · {when(r.createdAt, tz, 'day')}{r.responseDueAt ? ` · due ${when(r.responseDueAt, tz, 'day')}` : ''}</Meta>
            </div>
            <Status value={r.responseDueAt && r.responseDueAt < now && !['released', 'denied', 'withdrawn'].includes(r.status) ? 'overdue' : r.status} />
          </Row>
        )) : <Empty>No records requests.</Empty>}
      </Section>
      <Section title="Refill requests (a DVM decides)">
        {data.refillRequests.length ? data.refillRequests.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{r.ref}</span><span className="font-medium">{r.productText}</span>{r.patient ? <Link className="text-muted-foreground hover:underline" href={`/dashboard/platform/patients/${r.patient.id}`}>{r.patient.name}</Link> : null}</div>
              <Meta>{r.client?.displayName} · via {r.createdByAgent ? 'AI receptionist' : label(r.channel)} · {when(r.createdAt, tz)}{r.slaDueAt ? ` · due ${when(r.slaDueAt, tz)}` : ''}</Meta>
            </div>
            <Status value={r.status} />
          </Row>
        )) : <Empty>No refill requests.</Empty>}
      </Section>
    </Page>
  );
}
