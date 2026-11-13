import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type Order = {
  id: string; ref: string; status: string; sentAt: string | null; createdAt: string; accessionId: string;
  patient: { id: string; name: string } | null; lab: { name: string } | null;
};
type Result = { id: string; status: string; worstFlag: string; source: string; receivedAt: string; labOrder: { ref: string; patient: { id: string; name: string } | null } | null };

/**
 * Lab orders and their results. A result is never shown as reviewed until a vet has interpreted it and a second
 * review records the call to the client; corrections show as new rows that supersede the old one.
 */
export default async function ResultsPage() {
  const [data, tz] = await Promise.all([
    q<{ labOrders: Order[]; labResults: Result[] }>(`{
      labOrders(orderBy: { createdAt: desc }, take: 100) { id ref status sentAt createdAt accessionId patient { id name } lab { name } }
      labResults(orderBy: { receivedAt: desc }, take: 100) { id status worstFlag source receivedAt labOrder { ref patient { id name } } }
    }`),
    practiceTimeZone(),
  ]);
  const waiting = data.labOrders.filter(o => ['sent', 'specimen_collected', 'partial'].includes(o.status)).length;
  const unreviewed = data.labResults.filter(r => ['partial', 'final', 'corrected'].includes(r.status)).length;
  const critical = data.labResults.filter(r => r.worstFlag.startsWith('critical')).length;
  return (
    <Page title="Results">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Orders" value={data.labOrders.length} />
        <Stat name="Waiting on the lab" value={waiting} />
        <Stat name="Results to look at" value={unreviewed} />
        <Stat name="Critical" value={critical ? <span className="text-red-600">{critical}</span> : 0} />
      </div>
      <Section title="Results">
        {data.labResults.length ? data.labResults.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{r.labOrder?.ref}</span>{r.labOrder?.patient ? <Link className="font-medium hover:underline" href={`/dashboard/platform/patients/${r.labOrder.patient.id}`}>{r.labOrder.patient.name}</Link> : null}</div>
              <Meta>{label(r.source)} · {label(r.worstFlag || 'normal')} · {when(r.receivedAt, tz)}</Meta>
            </div>
            <Status value={r.status} />
          </Row>
        )) : <Empty>No results yet.</Empty>}
      </Section>
      <Section title="Lab orders">
        {data.labOrders.length ? data.labOrders.map(o => (
          <Row key={o.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{o.ref}</span>{o.patient ? <span className="font-medium">{o.patient.name}</span> : null}</div>
              <Meta>{o.lab?.name} · {o.accessionId ? `accession ${o.accessionId} · ` : ''}{o.sentAt ? `sent ${when(o.sentAt, tz)}` : `ordered ${when(o.createdAt, tz)}`}</Meta>
            </div>
            <Status value={o.status} />
          </Row>
        )) : <Empty>No lab orders.</Empty>}
      </Section>
    </Page>
  );
}
