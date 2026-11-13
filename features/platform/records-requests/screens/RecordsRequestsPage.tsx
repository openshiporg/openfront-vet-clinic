import Link from 'next/link';
import { q, practiceTimeZone, myPermissions } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Req = {
  id: string; ref: string; requesterKind: string; requesterName: string; channel: string; basis: string; scope: string; status: string; version: number; responseDueAt: string | null; createdAt: string;
  verifiedAt: string | null; verificationNote: string;
  client: { id: string; displayName: string } | null; patient: { id: string; name: string } | null; createdByAgent: { name: string } | null;
};
type Refill = { id: string; ref: string; productText: string; channel: string; status: string; slaDueAt: string | null; createdAt: string; client: { id: string; displayName: string } | null; patient: { id: string; name: string } | null; createdByAgent: { name: string } | null };
type Doc = { id: string; title: string; patient: { id: string } | null };
type Contact = { id: string; kind: string; value: string; person: { client: { id: string } | null } | null };

const PATH = '/dashboard/platform/records-requests';
const SHARE = ['email', 'portal', 'fax', 'mail', 'in_person'].map(v => ({ value: v, label: label(v) }));
const OPEN = ['received', 'verifying_authority', 'approved'];

/** Optional reads for the release form: a role without them still gets the page, just not the release choices. */
async function maybe<T>(query: string, fallback: T): Promise<T> {
  try { return await q<T>(query); } catch { return fallback; }
}

/**
 * Records and refill requests taken by phone, portal or the AI receptionist. The AI only takes the
 * request: a DVM decides refills (Phase 3) and staff verify authority before any release, against the
 * policy-pack response clock. The verify, decide and release buttons show only to people who process records requests.
 */
export default async function RecordsRequestsPage() {
  const [data, tz, can] = await Promise.all([
    q<{ recordsRequests: Req[]; refillRequests: Refill[] }>(`{
      recordsRequests(orderBy: { createdAt: desc }, take: 100) { id ref requesterKind requesterName channel basis scope status version responseDueAt createdAt verifiedAt verificationNote client { id displayName } patient { id name } createdByAgent { name } }
      refillRequests(orderBy: { createdAt: desc }, take: 100) { id ref productText channel status slaDueAt createdAt client { id displayName } patient { id name } createdByAgent { name } }
    }`),
    practiceTimeZone(),
    myPermissions(['canProcessRecordsRequests'] as const),
  ]);
  const proc = can.canProcessRecordsRequests;
  const releasing = proc && data.recordsRequests.some(r => r.status === 'approved');
  const [docs, contacts] = releasing ? await Promise.all([
    maybe<{ clinicalDocuments: Doc[] }>(`{ clinicalDocuments(where: { status: { equals: "rendered" } }, orderBy: { createdAt: desc }, take: 300) { id title patient { id } } }`, { clinicalDocuments: [] }),
    maybe<{ contactPoints: Contact[] }>(`{ contactPoints(where: { status: { equals: "active" }, verifiedAt: { not: null } }, take: 500) { id kind value person { client { id } } } }`, { contactPoints: [] }),
  ]) : [{ clinicalDocuments: [] as Doc[] }, { contactPoints: [] as Contact[] }];
  const now = new Date().toISOString();
  const openRec = data.recordsRequests.filter(r => OPEN.includes(r.status));
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
        {data.recordsRequests.length ? data.recordsRequests.map(r => {
          const myDocs = docs.clinicalDocuments.filter(d => d.patient?.id === r.patient?.id);
          const myContacts = contacts.contactPoints.filter(c => c.person?.client?.id === r.client?.id);
          return (
            <Row key={r.id}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{r.ref}</span><span className="font-medium">{r.requesterName || r.client?.displayName}</span>{r.patient ? <Link className="text-muted-foreground hover:underline" href={`/dashboard/platform/patients/${r.patient.id}`}>{r.patient.name}</Link> : null}</div>
                <Meta>{label(r.requesterKind)} · {label(r.basis)} · {label(r.scope)} · via {r.createdByAgent ? `AI receptionist` : label(r.channel)} · {when(r.createdAt, tz, 'day')}{r.responseDueAt ? ` · due ${when(r.responseDueAt, tz, 'day')}` : ''}</Meta>
                {r.verifiedAt ? <Meta>Checked {when(r.verifiedAt, tz)}: {r.verificationNote}</Meta> : null}
                {proc && r.status === 'received' ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton op="startRecordsVerification" vars={{ requestId: r.id, expectedVersion: r.version }} paths={[PATH]}>Start checking who is asking</ActionButton>
                    <ActionButton op="withdrawRecordsRequest" vars={{ requestId: r.id, expectedVersion: r.version }} ask="Why is this request withdrawn?" paths={[PATH]}>Withdrawn</ActionButton>
                  </div>
                ) : null}
                {proc && r.status === 'verifying_authority' ? (
                  <>
                    <CommandForm op="verifyRecordsRequest" build="phase6" submit={r.verifiedAt ? 'Check again' : 'Checked'} fixed={{ requestId: r.id, expectedVersion: String(r.version) }} paths={[PATH]} fields={[
                      { name: 'note', label: 'What you checked', placeholder: 'Called the client on the number on file', width: 'lg' },
                      ...(r.basis !== 'client_of_record' ? [{ name: 'authorisationDocumentId', label: 'Signed authorisation (document id)', hint: 'Not needed for a court order, subpoena or public health request.' }] : []),
                    ]} />
                    {r.verifiedAt ? (
                      <div className="flex flex-wrap gap-2">
                        <ActionButton op="decideRecordsRequest" vars={{ requestId: r.id, decision: 'approve', expectedVersion: r.version }} paths={[PATH]}>Approve</ActionButton>
                        <ActionButton op="decideRecordsRequest" vars={{ requestId: r.id, decision: 'deny', expectedVersion: r.version }} ask="Why is this request refused?" paths={[PATH]}>Refuse</ActionButton>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {proc && r.status === 'approved' ? (
                  myDocs.length ? (
                    <CommandForm op="releaseRecords" build="phase6" submit={r.basis === 'client_of_record' ? 'Release' : 'Ask to release'} fixed={{ requestId: r.id, expectedVersion: String(r.version) }} paths={[PATH]} fields={[
                      { name: 'documentIds', label: 'Document', options: myDocs.map(d => ({ value: d.id, label: d.title })), defaultValue: myDocs[0].id },
                      ...(r.basis === 'client_of_record'
                        ? [{ name: 'contactPointId', label: 'Send to (verified)', options: myContacts.map(c => ({ value: c.id, label: `${label(c.kind)}: ${c.value}` })), defaultValue: myContacts[0]?.id ?? '' }, { name: 'recipient', label: 'Recipient name', defaultValue: r.client?.displayName ?? '' }]
                        : [{ name: 'recipient', label: 'Recipient', defaultValue: r.requesterName }]),
                      { name: 'channel', label: 'How', options: SHARE, defaultValue: 'email' },
                    ]} />
                  ) : <Meta>No finished records for this patient to release yet.</Meta>
                ) : null}
              </div>
              <Status value={r.responseDueAt && r.responseDueAt < now && OPEN.includes(r.status) ? 'overdue' : r.status} />
            </Row>
          );
        }) : <Empty>No records requests.</Empty>}
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
