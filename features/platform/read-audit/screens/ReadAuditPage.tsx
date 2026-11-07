import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Meta, Section, Stat } from '../../components/ui';

type Read = { id: string; at: string; actorKind: string; actorId: string; actorLabel: string | null; resourceType: string; resourceId: string | null; purpose: string; fields: string[] | null; requestId: string | null };

/** Who read which client or patient record, when, for what purpose and which fields (names only). Rows cannot be changed or deleted. */
export default async function ReadAuditPage({ searchParams }: { searchParams?: Promise<{ resource?: string; actor?: string }> }) {
  const params = (await searchParams) ?? {};
  const resource = (params.resource ?? '').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 120);
  const actor = (params.actor ?? '').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 120);
  const where = { AND: [...(resource ? [{ resourceId: { equals: resource } }] : []), ...(actor ? [{ actorId: { equals: actor } }] : [])] };
  const [data, tz] = await Promise.all([
    q<{ readAudits: Read[]; total: number; agents: number }>(`query R($where: ReadAuditWhereInput!) {
      readAudits(where: $where, orderBy: { at: desc }, take: 100) { id at actorKind actorId actorLabel resourceType resourceId purpose fields requestId }
      total: readAuditsCount
      agents: readAuditsCount(where: { actorKind: { equals: "agent" } })
    }`, { where }),
    practiceTimeZone(),
  ]);
  return (
    <Page title="Read audit">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Reads recorded" value={data.total.toLocaleString('en-US')} />
        <Stat name="By agents" value={data.agents.toLocaleString('en-US')} />
      </div>
      <Section title={resource ? `Reads of ${resource}` : actor ? `Reads by ${actor}` : 'Latest reads'} aside={resource || actor ? <Link href="/dashboard/platform/read-audit" className="text-xs underline">Show all</Link> : null}>
        {data.readAudits.length ? data.readAudits.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link className="font-medium underline-offset-2 hover:underline" href={`/dashboard/platform/read-audit?actor=${encodeURIComponent(r.actorId)}`}>{r.actorLabel ?? r.actorId}</Link>
                <span className="text-xs text-muted-foreground">{r.actorKind}</span>
              </div>
              <Meta>
                read <Link className="underline underline-offset-2" href={`/dashboard/platform/read-audit?resource=${encodeURIComponent(r.resourceId ?? '')}`}>{r.resourceType} {r.resourceId}</Link> · {label(r.purpose)} · {(r.fields ?? []).join(', ')}
              </Meta>
            </div>
            <Meta>{when(r.at, tz, 'seconds')}</Meta>
          </Row>
        )) : <Empty>No clinical or client reads recorded yet. Every GraphQL read of a client or patient record writes a row here.</Empty>}
      </Section>
    </Page>
  );
}
