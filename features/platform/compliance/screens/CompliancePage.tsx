import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat, Tabs } from '../../components/ui';

type Clock = { id: string; kind: string; title: string; dueAt: string; startedAt: string | null; status: string; subjectType: string | null; subjectId: string | null; location: { code: string } | null };
type Incident = { id: string; kind: string; title: string; ref: string | null; status: string; discoveredAt: string | null; location: { code: string } | null };

/**
 * Legal and regulatory clocks (D§6.3): DEA theft/loss notice (1 business day), Form 106 (45 days),
 * biennial inventory, 222 validity (60 days), CURES reporting (7 days), licence and registration
 * expiry, records-request deadlines. A clock starts with the event that triggers it.
 */
export default async function CompliancePage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = (await searchParams)?.view === 'closed' ? 'closed' : 'open';
  const where = view === 'open' ? '{ status: { in: ["open", "overdue"] } }' : '{ status: { in: ["done", "waived"] } }';
  const [data, tz] = await Promise.all([
    q<{ complianceTasks: Clock[]; open: number; closed: number; overdue: number; incidents: Incident[] }>(`{
      complianceTasks(where: ${where}, orderBy: { dueAt: asc }, take: 200) { id kind title dueAt startedAt status subjectType subjectId location { code } }
      open: complianceTasksCount(where: { status: { in: ["open", "overdue"] } })
      closed: complianceTasksCount(where: { status: { in: ["done", "waived"] } })
      overdue: complianceTasksCount(where: { status: { equals: "overdue" } })
      incidents(orderBy: { createdAt: desc }, take: 20) { id kind title ref status discoveredAt location { code } }
    }`),
    practiceTimeZone(),
  ]);
  const now = Date.now();
  return (
    <Page title="Compliance">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Open clocks" value={data.open} />
        <Stat name="Overdue" value={data.overdue ? <span className="text-red-600">{data.overdue}</span> : 0} />
        <Stat name="Closed" value={data.closed} />
        <Stat name="Incidents" value={data.incidents.length} />
      </div>
      <Tabs active={view} items={[
        { key: 'open', label: 'Open', href: '/dashboard/platform/compliance', count: data.open },
        { key: 'closed', label: 'Closed', href: '/dashboard/platform/compliance?view=closed', count: data.closed },
      ]} />
      <Section title={view === 'open' ? 'Clocks running' : 'Clocks closed'}>
        {data.complianceTasks.length ? data.complianceTasks.map(c => {
          const late = c.status !== 'done' && Date.parse(c.dueAt) < now;
          return (
            <Row key={c.id}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <span className="font-medium">{c.title}</span>
                <Meta>{label(c.kind)}{c.location ? ` · ${c.location.code}` : ''}{c.startedAt ? ` · started ${when(c.startedAt, tz)}` : ''}</Meta>
              </div>
              <div className="text-right">
                <p className={late ? 'text-sm text-red-600' : 'text-sm'}>due {when(c.dueAt, tz)}</p>
                <Status value={late ? 'overdue' : c.status} />
              </div>
            </Row>
          );
        }) : <Empty>{view === 'open' ? 'No clocks running. Clocks start when a controlled-substance loss, a records request or an expiring licence needs action.' : 'Nothing closed yet.'}</Empty>}
      </Section>
      <Section title="Incidents">
        {data.incidents.length ? data.incidents.map(i => (
          <Row key={i.id}><div className="min-w-0 flex-1"><span className="font-medium">{i.title}</span><br /><Meta>{i.ref ? `${i.ref} · ` : ''}{label(i.kind)}{i.location ? ` · ${i.location.code}` : ''}{i.discoveredAt ? ` · discovered ${when(i.discoveredAt, tz)}` : ''}</Meta></div><Status value={i.status} /></Row>
        )) : <Empty>No incidents recorded.</Empty>}
      </Section>
    </Page>
  );
}
