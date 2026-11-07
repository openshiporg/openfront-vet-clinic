import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Tabs, Stat } from '../../components/ui';

type Call = {
  id: string; ref: string; direction: string; from: string; answeredBy: string; disposition: string; status: string; startedAt: string; durationSeconds: number | null;
  recordingConsent: string; verificationMethod: string; callerVerifiedAt: string | null; summary: string; client: { displayName: string } | null; location: { code: string } | null;
};

const TRANSFERRED = ['transferred', 'urgent_transfer', 'er_referred'];

/**
 * Calls (BUILD-PLAN §2 Communications): AI receptionist and staff side by side. Every AI call shows
 * the disclosure, the recording answer, whether the caller was verified, and how it ended. Outbound
 * AI calls do not exist in this version (refused by the command and by the database).
 */
export default async function CallsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = (await searchParams)?.view ?? 'all';
  const where = view === 'ai' ? '{ answeredBy: { equals: "ai" } }' : view === 'staff' ? '{ answeredBy: { equals: "staff" } }' : view === 'urgent' ? '{ disposition: { in: ["urgent_transfer", "er_referred"] } }' : '{}';
  const [data, tz] = await Promise.all([
    q<{ callRecords: Call[]; ai: number; staff: number; urgent: number; all: number; aiTransferred: number }>(`{
      callRecords(where: ${where}, orderBy: { startedAt: desc }, take: 100) {
        id ref direction from answeredBy disposition status startedAt durationSeconds recordingConsent verificationMethod callerVerifiedAt summary client { displayName } location { code }
      }
      all: callRecordsCount
      ai: callRecordsCount(where: { answeredBy: { equals: "ai" } })
      staff: callRecordsCount(where: { answeredBy: { equals: "staff" } })
      urgent: callRecordsCount(where: { disposition: { in: ["urgent_transfer", "er_referred"] } })
      aiTransferred: callRecordsCount(where: { answeredBy: { equals: "ai" }, disposition: { in: ${JSON.stringify(TRANSFERRED)} } })
    }`),
    practiceTimeZone(),
  ]);
  return (
    <Page title="Calls">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Calls" value={data.all} />
        <Stat name="AI receptionist" value={data.ai} />
        <Stat name="AI handed to staff" value={data.aiTransferred} />
        <Stat name="Urgent / ER" value={data.urgent ? <span className="text-red-600">{data.urgent}</span> : 0} />
      </div>
      <Tabs active={view} items={[
        { key: 'all', label: 'All', href: '/dashboard/platform/calls', count: data.all },
        { key: 'ai', label: 'AI', href: '/dashboard/platform/calls?view=ai', count: data.ai },
        { key: 'staff', label: 'Staff', href: '/dashboard/platform/calls?view=staff', count: data.staff },
        { key: 'urgent', label: 'Urgent', href: '/dashboard/platform/calls?view=urgent', count: data.urgent },
      ]} />
      <div>
        {data.callRecords.length ? data.callRecords.map(c => (
          <Row key={c.id} href={`/dashboard/platform/calls/${c.id}`}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{c.ref}</span><span className="font-medium">{c.client?.displayName ?? c.from}</span><span className="text-xs text-muted-foreground">{c.answeredBy === 'ai' ? 'AI receptionist' : label(c.answeredBy)}</span></div>
              <Meta>{when(c.startedAt, tz)} · {c.location?.code} · {label(c.direction)}{c.durationSeconds ? ` · ${Math.round(c.durationSeconds / 60)} min` : ''} · recording {label(c.recordingConsent)} · {c.callerVerifiedAt ? `verified (${label(c.verificationMethod)})` : 'not verified'}</Meta>
              {c.summary ? <p className="text-xs">{c.summary}</p> : null}
            </div>
            <div className="flex items-center gap-3"><Status value={TRANSFERRED.includes(c.disposition) ? 'urgent' : undefined} /><span className="font-mono text-xs uppercase">{label(c.disposition)}</span></div>
          </Row>
        )) : <Empty>No calls yet. Inbound calls appear here when the telephony adapter is connected, or when staff log them.</Empty>}
      </div>
    </Page>
  );
}
