import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when } from '../../lib/format';
import { Page, Row, Empty, Meta, Section, Stat } from '../../components/ui';

type Event = { id: string; seq: number; at: string; eventType: string; entityType: string; entityId: string; reason: string; hash: string; prevHash: string; actorUser: { name: string } | null; actorAgent: { name: string } | null; approver: { name: string } | null };
type Verify = { ok: boolean; count: number; lastSeq: number; lastHash: string; brokenAtSeq: number | null; problem: string | null };

const PAGE = 50;

/** Hash-chained audit log. Each event's hash covers the previous hash, so editing or removing one breaks every later link. */
export default async function AuditPage({ searchParams }: { searchParams?: Promise<{ before?: string; entity?: string }> }) {
  const params = (await searchParams) ?? {};
  const before = /^\d+$/.test(params.before ?? '') ? Number.parseInt(params.before!, 10) : null;
  const entity = (params.entity ?? '').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 120);
  const where = { AND: [...(before ? [{ seq: { lt: before } }] : []), ...(entity ? [{ OR: [{ entityId: { equals: entity } }, { entityType: { equals: entity } }] }] : [])] };
  const [data, tz] = await Promise.all([
    q<{ auditEvents: Event[]; auditEventsCount: number; verifyAuditChain: Verify }>(`query Audit($where: AuditEventWhereInput!, $take: Int!) {
      auditEvents(where: $where, orderBy: { seq: desc }, take: $take) { id seq at eventType entityType entityId reason hash prevHash actorUser { name } actorAgent { name } approver { name } }
      auditEventsCount
      verifyAuditChain
    }`, { where, take: PAGE }),
    practiceTimeZone(),
  ]);
  const v = data.verifyAuditChain;
  const last = data.auditEvents.at(-1);
  return (
    <Page title="Audit log">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Chain" value={v.ok ? <span className="text-emerald-600">Intact</span> : <span className="text-red-600">Broken at #{v.brokenAtSeq}</span>} />
        <Stat name="Events" value={v.count.toLocaleString('en-US')} />
        <Stat name="Last event" value={v.lastSeq ? `#${v.lastSeq}` : '—'} />
        <Stat name="Head hash" value={<span className="break-all font-mono text-xs">{v.lastHash.slice(0, 16)}</span>} />
      </div>
      {!v.ok && v.problem ? <p role="alert" className="text-sm text-red-600">{v.problem}</p> : null}
      <Section title={entity ? `Events for ${entity}` : 'Latest events'} aside={entity ? <Link href="/dashboard/platform/audit" className="text-xs underline">Show all</Link> : null}>
        {data.auditEvents.length ? data.auditEvents.map(e => (
          <Row key={e.id}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs text-muted-foreground">#{e.seq}</span><span className="font-medium">{e.eventType}</span></div>
              <Meta>
                <Link className="underline underline-offset-2" href={`/dashboard/platform/audit?entity=${encodeURIComponent(e.entityId)}`}>{e.entityType} {e.entityId}</Link>
                {' · '}{e.actorUser?.name ?? (e.actorAgent ? `agent ${e.actorAgent.name}` : 'system')}{e.approver ? ` · approved by ${e.approver.name}` : ''}{e.reason ? ` · ${e.reason}` : ''}
              </Meta>
            </div>
            <div className="text-right">
              <Meta>{when(e.at, tz)}</Meta>
              <p className="font-mono text-[11px] text-muted-foreground">{e.hash.slice(0, 12)}</p>
            </div>
          </Row>
        )) : <Empty>No audit events yet.</Empty>}
      </Section>
      {last && last.seq > 1 && data.auditEvents.length === PAGE ? <Link href={`/dashboard/platform/audit?before=${last.seq}${entity ? `&entity=${encodeURIComponent(entity)}` : ''}`} className="text-sm underline">Older events</Link> : null}
    </Page>
  );
}
