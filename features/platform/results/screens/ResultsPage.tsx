import Link from 'next/link';
import { q, practiceTimeZone, myPermissions } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Order = {
  id: string; ref: string; status: string; version: number; sentAt: string | null; createdAt: string; accessionId: string | null;
  patient: { id: string; name: string } | null; lab: { id: string; name: string; kind: string } | null; tests: { code: string; name: string }[];
};
type Result = { id: string; status: string; worstFlag: string; source: string; receivedAt: string; labOrder: { ref: string; status: string; patient: { id: string; name: string } | null } | null; values: { externalCode: string; valueNumeric: string | null; valueText: string; unit: string; flag: string }[] };
type Lab = { id: string; name: string; kind: string; tests: { id: string; code: string; name: string }[] };
type Patient = { id: string; name: string };

const PATH = '/dashboard/platform/results';
const SPECIMENS = ['whole_blood', 'serum', 'plasma', 'urine', 'feces', 'tissue', 'swab', 'fluid', 'other'].map(v => ({ value: v, label: label(v) }));
const VIA = ['call', 'message', 'in_person', 'portal'].map(v => ({ value: v, label: label(v) }));
const RESULT_STATUS = [{ value: 'final', label: 'Final' }, { value: 'partial', label: 'Partial (more to come)' }];

/**
 * Lab orders and their results. A result is never shown as reviewed until a vet has interpreted it and a second
 * review records the call to the client; corrections show as new rows that supersede the old one.
 * Each button shows only to people whose role lets them do it: ordering and reading for vets, collecting and entering for the team.
 */
export default async function ResultsPage() {
  const [data, tz, can] = await Promise.all([
    q<{ labOrders: Order[]; labResults: Result[]; laboratories: Lab[]; patients: Patient[] }>(`{
      labOrders(orderBy: { createdAt: desc }, take: 60) { id ref status version sentAt createdAt accessionId patient { id name } lab { id name kind } tests(take: 10) { code name } }
      labResults(orderBy: { receivedAt: desc }, take: 60) { id status worstFlag source receivedAt labOrder { ref status patient { id name } } values(take: 20) { externalCode valueNumeric valueText unit flag } }
      laboratories(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 20) { id name kind tests(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 50) { id code name } }
      patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name }
    }`),
    practiceTimeZone(),
    myPermissions(['canOrder', 'canWriteRecord', 'canSignRecord', 'canMessageClients', 'canBook'] as const),
  ]);
  const canOrder = can.canOrder;
  const canWork = can.canOrder || can.canWriteRecord;
  const canReview = can.canOrder || can.canSignRecord;
  const canTell = can.canOrder || can.canMessageClients || can.canBook;
  const waiting = data.labOrders.filter(o => ['sent', 'specimen_collected', 'partial'].includes(o.status)).length;
  const unreviewed = data.labResults.filter(r => ['partial', 'final', 'corrected'].includes(r.status) && ['final', 'corrected'].includes(r.labOrder?.status ?? '')).length;
  const critical = data.labResults.filter(r => r.worstFlag.startsWith('critical')).length;
  const testList = (l: Lab) => l.tests.map(t => `${t.code} (${t.name})`).join(', ');
  return (
    <Page title="Results">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Orders" value={data.labOrders.length} />
        <Stat name="Waiting on the lab" value={waiting} />
        <Stat name="Results to look at" value={unreviewed} />
        <Stat name="Critical" value={critical ? <span className="text-red-600">{critical}</span> : 0} />
      </div>
      {canOrder ? (
        <Section title="Order lab work">
          {data.laboratories.length ? data.laboratories.map(l => (
            <div key={l.id} className="space-y-1 border-b py-2 last:border-0">
              <Meta>{l.name} ({l.kind === 'in_house' ? 'run here' : 'sent out'}): {testList(l) || 'no active tests'}</Meta>
              {l.tests.length ? (
                <CommandForm op="orderLab" build="phase6" submit="Order" fixed={{ labId: l.id }} paths={[PATH]} fields={[
                  { name: 'patientId', label: 'Patient', options: data.patients.map(p => ({ value: p.id, label: p.name })), defaultValue: data.patients[0]?.id ?? '' },
                  { name: 'testIds', label: 'Test', options: l.tests.map(t => ({ value: t.id, label: t.name })), defaultValue: l.tests[0].id },
                ]} />
              ) : null}
            </div>
          )) : <Empty>No laboratories are set up yet. Add one under Laboratory in the admin lists.</Empty>}
        </Section>
      ) : null}
      <Section title="Results">
        {data.labResults.length ? data.labResults.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{r.labOrder?.ref}</span>{r.labOrder?.patient ? <Link className="font-medium hover:underline" href={`/dashboard/platform/patients/${r.labOrder.patient.id}`}>{r.labOrder.patient.name}</Link> : null}</div>
              <Meta>{label(r.source)} · {label(r.worstFlag || 'normal')} · {when(r.receivedAt, tz)}</Meta>
              {r.values.length ? <Meta>{r.values.map(v => `${v.externalCode} ${v.valueNumeric !== null ? String(Number(v.valueNumeric)) : v.valueText}${v.unit ? ` ${v.unit}` : ''}${v.flag && v.flag !== 'normal' ? ` (${label(v.flag)})` : ''}`).join(' · ')}</Meta> : null}
              {canReview && r.status !== 'partial' && ['final', 'corrected'].includes(r.labOrder?.status ?? '') ? (
                <CommandForm op="reviewLabResult" build="phase6" submit="Sign my reading" fixed={{ resultId: r.id }} paths={[PATH]} fields={[{ name: 'interpretation', label: 'What it means', width: 'lg' }]} />
              ) : null}
              {canTell && r.labOrder?.status === 'reviewed' ? (
                <CommandForm op="communicateLabResult" build="phase6" submit="Client told" fixed={{ resultId: r.id }} paths={[PATH]} fields={[{ name: 'via', label: 'How', options: VIA, defaultValue: 'call' }]} />
              ) : null}
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
              <Meta>{o.lab?.name} · {o.tests.map(t => t.name).join(', ')} · {o.accessionId ? `accession ${o.accessionId} · ` : ''}{o.sentAt ? `sent ${when(o.sentAt, tz)}` : `ordered ${when(o.createdAt, tz)}`}</Meta>
              {canWork && o.status === 'ordered' ? (
                <CommandForm op="collectSpecimen" build="phase6" submit="Sample taken" fixed={{ labOrderId: o.id, expectedVersion: String(o.version) }} paths={[PATH]} fields={[{ name: 'kind', label: 'Sample', options: SPECIMENS, defaultValue: 'serum' }, { name: 'containerId', label: 'Tube label', width: 'sm' }]} />
              ) : null}
              {canWork && o.status === 'specimen_collected' && o.lab?.kind !== 'in_house' ? (
                <CommandForm op="sendLabOrder" build="phase6" submit="Sent to the lab" fixed={{ labOrderId: o.id, expectedVersion: String(o.version) }} paths={[PATH]} fields={[{ name: 'accessionId', label: 'Lab accession number' }]} />
              ) : null}
              {canWork && o.lab && o.accessionId && ['specimen_collected', 'sent', 'partial'].includes(o.status) && (o.status !== 'specimen_collected' || o.lab.kind === 'in_house') ? (
                <CommandForm op="enterLabResult" build="phase6" submit="Enter results" fixed={{ labId: o.lab.id, accessionId: o.accessionId }} paths={[PATH]} fields={[
                  { name: 'lines', label: 'One per line: code value unit', placeholder: 'GLU 6.2 mmol/L', multiline: 3, width: 'lg' },
                  { name: 'status', label: 'Report', options: RESULT_STATUS, defaultValue: 'final' },
                ]} />
              ) : null}
              {canOrder && ['ordered', 'specimen_collected'].includes(o.status) ? (
                <ActionButton op="cancelLabOrder" vars={{ labOrderId: o.id, expectedVersion: o.version }} ask="Why is this order cancelled?" paths={[PATH]}>Cancel order</ActionButton>
              ) : null}
            </div>
            <Status value={o.status} />
          </Row>
        )) : <Empty>No lab orders.</Empty>}
      </Section>
    </Page>
  );
}
