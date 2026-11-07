import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';

type Request = {
  id: string; action: string; summary: string; targetList: string; targetId: string; payloadHash: string; requiredPermission: string;
  status: string; version: number; createdAt: string; expiresAt: string | null; consumedAt: string | null;
  requestedBy: { id: string; name: string } | null; requestedByAgent: { name: string } | null;
  decisions: { decision: string; reason: string; at: string; decidedBy: { name: string } | null }[];
};

const FIELDS = 'id action summary targetList targetId payloadHash requiredPermission status version createdAt expiresAt consumedAt requestedBy { id name } requestedByAgent { name } decisions { decision reason at decidedBy { name } }';

/**
 * Maker-checker queue. The server enforces every rule (a different person, the right permission,
 * not an agent, unexpired, the exact payload); the buttons here only send the decision.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = (await searchParams)?.view === 'decided' ? 'decided' : 'pending';
  const where = view === 'pending' ? '{ status: { equals: "pending" } }' : '{ status: { not: { equals: "pending" } } }';
  const [data, tz] = await Promise.all([
    q<{ approvalRequests: Request[]; pending: number; decided: number; authenticatedItem: { id: string } | null }>(`{
      approvalRequests(where: ${where}, orderBy: { createdAt: desc }, take: 100) { ${FIELDS} }
      pending: approvalRequestsCount(where: { status: { equals: "pending" } })
      decided: approvalRequestsCount(where: { status: { not: { equals: "pending" } } })
      authenticatedItem { ... on User { id } }
    }`),
    practiceTimeZone(),
  ]);
  const me = data.authenticatedItem?.id;
  const now = Date.now();
  return (
    <Page title="Approvals">
      <Tabs active={view} items={[
        { key: 'pending', label: 'Waiting', href: '/dashboard/platform/approvals', count: data.pending },
        { key: 'decided', label: 'Decided', href: '/dashboard/platform/approvals?view=decided', count: data.decided },
      ]} />
      <Section title={view === 'pending' ? 'Waiting for a second person' : 'Decided, withdrawn or expired'}>
        {data.approvalRequests.length ? data.approvalRequests.map(r => {
          const expired = r.status === 'pending' && r.expiresAt !== null && new Date(r.expiresAt).getTime() <= now;
          const mine = r.requestedBy?.id === me;
          return (
            <Row key={r.id}>
              <div className="min-w-0 flex-1 space-y-1">
                <span className="font-medium">{label(r.action.replace('.', ' · '))}</span>
                {r.summary ? <p className="break-words text-sm">{r.summary}</p> : null}
                <Meta>
                  Asked by {r.requestedBy?.name ?? (r.requestedByAgent ? `agent ${r.requestedByAgent.name}` : 'the system')} · {when(r.createdAt, tz)}
                  {r.expiresAt ? ` · ${expired ? 'expired' : 'expires'} ${when(r.expiresAt, tz)}` : ''} · needs {r.requiredPermission.replace(/^can/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()}
                </Meta>
                {r.decisions.map((d, i) => <Meta key={i}><br />{d.decision === 'approve' ? 'Approved' : 'Rejected'} by {d.decidedBy?.name ?? 'someone'} · {when(d.at, tz)}{d.reason ? ` · ${d.reason}` : ''}</Meta>)}
                {r.consumedAt ? <Meta><br />Carried out {when(r.consumedAt, tz)}</Meta> : null}
                <p className="break-all font-mono text-[11px] text-muted-foreground">{r.targetList} {r.targetId} · payload {r.payloadHash.slice(0, 12)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Status value={expired ? 'expired' : r.status} />
                {r.status === 'pending' && !expired && !mine ? (
                  <>
                    <ActionButton op="decideApprovalRequest" vars={{ requestId: r.id, decision: 'approve', expectedVersion: r.version }} paths={['/dashboard/platform/approvals']}>Approve</ActionButton>
                    <ActionButton op="decideApprovalRequest" vars={{ requestId: r.id, decision: 'reject', expectedVersion: r.version }} ask="Why are you rejecting this?" paths={['/dashboard/platform/approvals']}>Reject</ActionButton>
                  </>
                ) : null}
                {r.status === 'pending' && mine ? <ActionButton op="cancelApprovalRequest" vars={{ requestId: r.id, expectedVersion: r.version }} confirm="Withdraw this request?" paths={['/dashboard/platform/approvals']}>Withdraw</ActionButton> : null}
              </div>
            </Row>
          );
        }) : <Empty>{view === 'pending' ? 'Nothing is waiting for approval.' : 'No decided requests yet.'}</Empty>}
      </Section>
    </Page>
  );
}
