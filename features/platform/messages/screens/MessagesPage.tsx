import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Tabs, Stat, Section } from '../../components/ui';

type Msg = {
  id: string; direction: string; purpose: string; templateCode: string; to: string; from: string; body: string; status: string; blockedReason: string; sentAt: string | null; createdAt: string;
  thread: { client: { id: string; displayName: string } | null } | null; patient: { name: string } | null; appointment: { ref: string } | null;
};

/**
 * Messages (BUILD-PLAN §2 Communications). Every outbound text passes the send-time guard: a live
 * patient, consent for the purpose, no suppression, not in quiet hours. Blocked messages say why.
 */
export default async function MessagesPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = (await searchParams)?.view ?? 'all';
  const where = view === 'inbound' ? '{ direction: { equals: "inbound" } }' : view === 'blocked' ? '{ status: { equals: "blocked" } }' : view === 'queued' ? '{ status: { in: ["queued", "sending"] } }' : '{}';
  const [data, tz] = await Promise.all([
    q<{ commsMessages: Msg[]; all: number; inbound: number; blocked: number; queued: number; suppressions: number }>(`{
      commsMessages(where: ${where}, orderBy: { createdAt: desc }, take: 100) {
        id direction purpose templateCode to from body status blockedReason sentAt createdAt thread { client { id displayName } } patient { name } appointment { ref }
      }
      all: commsMessagesCount
      inbound: commsMessagesCount(where: { direction: { equals: "inbound" } })
      blocked: commsMessagesCount(where: { status: { equals: "blocked" } })
      queued: commsMessagesCount(where: { status: { in: ["queued", "sending"] } })
      suppressions: suppressionsCount(where: { active: { equals: true } })
    }`),
    practiceTimeZone(),
  ]);
  return (
    <Page title="Messages">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Messages" value={data.all} />
        <Stat name="Waiting to send" value={data.queued} />
        <Stat name="Blocked by the guard" value={data.blocked} />
        <Stat name="Active suppressions" value={data.suppressions} />
      </div>
      <Tabs active={view} items={[
        { key: 'all', label: 'All', href: '/dashboard/platform/messages', count: data.all },
        { key: 'inbound', label: 'From clients', href: '/dashboard/platform/messages?view=inbound', count: data.inbound },
        { key: 'queued', label: 'Queued', href: '/dashboard/platform/messages?view=queued', count: data.queued },
        { key: 'blocked', label: 'Blocked', href: '/dashboard/platform/messages?view=blocked', count: data.blocked },
      ]} />
      <Section title={view === 'blocked' ? 'Blocked (never sent)' : 'Messages'}>
        {data.commsMessages.length ? data.commsMessages.map(m => (
          <Row key={m.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs uppercase text-muted-foreground">{m.direction === 'inbound' ? '← in' : '→ out'}</span>
                {m.thread?.client ? <Link className="font-medium hover:underline" href={`/dashboard/platform/clients/${m.thread.client.id}`}>{m.thread.client.displayName}</Link> : <span className="font-mono">{m.direction === 'inbound' ? m.from : m.to}</span>}
                {m.patient ? <span className="text-xs text-muted-foreground">re {m.patient.name}</span> : null}
              </div>
              <p className="break-words text-sm">{m.body}</p>
              <Meta>{when(m.sentAt ?? m.createdAt, tz)} · {label(m.purpose)}{m.templateCode ? ` · ${label(m.templateCode)}` : ''}{m.appointment ? ` · ${m.appointment.ref}` : ''}{m.blockedReason ? ` · blocked: ${label(m.blockedReason)}` : ''}</Meta>
            </div>
            <Status value={m.status} />
          </Row>
        )) : <Empty>No messages here.</Empty>}
      </Section>
    </Page>
  );
}
