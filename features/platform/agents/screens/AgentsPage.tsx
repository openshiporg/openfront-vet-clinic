import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';

type Agent = {
  id: string; name: string; kind: string; model: string; provider: string; status: string; killSwitch: boolean; version: number; limits: unknown;
  owner: { name: string } | null; oauthApp: { clientId: string; status: string } | null;
  grants: { id: string; scope: string; status: string; createdAt: string; revokedAt: string | null }[];
};
type Action = { id: string; tool: string; outcome: string; errorCode: string; at: string; agent: { name: string } | null };

const PATHS = ['/dashboard/platform/agents'];

/**
 * Agents (BUILD-PLAN §2 Agents). Each agent has an owner, scope grants, a kill switch, and a log of
 * every tool call, allowed or refused (arguments kept as a hash). The voice receptionist also needs
 * the practice's aiVoice flag, which only changes by maker-checker in Practice settings.
 */
export default async function AgentsPage() {
  const [data, tz] = await Promise.all([
    q<{ agentIdentities: Agent[]; agentActions: Action[]; practiceSettings: { features: Record<string, boolean> | null } | null; refused: number; ok: number }>(`{
      agentIdentities(orderBy: { name: asc }, take: 50) { id name kind model provider status killSwitch version limits owner { name } oauthApp { clientId status } grants(orderBy: { scope: asc }, take: 50) { id scope status createdAt revokedAt } }
      agentActions(orderBy: { at: desc }, take: 40) { id tool outcome errorCode at agent { name } }
      practiceSettings { features }
      ok: agentActionsCount(where: { outcome: { equals: "ok" } })
      refused: agentActionsCount(where: { outcome: { not: { equals: "ok" } } })
    }`),
    practiceTimeZone(),
  ]);
  const aiVoice = !!data.practiceSettings?.features?.aiVoice;
  return (
    <Page title="Agents">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Agents" value={data.agentIdentities.length} />
        <Stat name="AI receptionist" value={aiVoice ? <span className="text-emerald-600">on</span> : <span className="text-muted-foreground">off</span>} />
        <Stat name="Tool calls allowed" value={data.ok} />
        <Stat name="Refused" value={data.refused} />
      </div>
      {!aiVoice ? <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">The AI receptionist is off for this practice. Turn it on in Practice settings; a second person approves the change.</p> : null}
      {data.agentIdentities.length ? data.agentIdentities.map(a => (
        <Section key={a.id} title={a.name} aside={a.killSwitch
          ? <ActionButton op="setAgentKillSwitch" vars={{ agentId: a.id, killSwitch: false, expectedVersion: a.version }} ask="Why can this agent act again?" paths={PATHS}>Switch back on</ActionButton>
          : <ActionButton op="setAgentKillSwitch" vars={{ agentId: a.id, killSwitch: true, expectedVersion: a.version }} confirm={`Stop ${a.name} now? Every tool call will be refused until someone switches it back on.`} paths={PATHS} className="text-red-700">Kill switch</ActionButton>}>
          <Row>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <Meta>{label(a.kind)} · owner {a.owner?.name ?? '—'} · OAuth client <span className="font-mono">{a.oauthApp?.clientId ?? '—'}</span> · {a.provider || 'provider not set'} {a.model}</Meta>
            </div>
            <Status value={a.killSwitch ? 'killed' : a.status} />
          </Row>
          {a.grants.map(g => (
            <Row key={g.id}><span className="font-mono text-sm">{g.scope}</span><Meta>since {when(g.createdAt, tz, 'day')}{g.revokedAt ? ` · revoked ${when(g.revokedAt, tz, 'day')}` : ''}</Meta><Status value={g.status} /></Row>
          ))}
          <p className="text-xs text-muted-foreground">Never available to any agent: prescribing, controlled substances, euthanasia, refunds, record signing, releasing records, approvals and outbound AI calls.</p>
        </Section>
      )) : <Empty>No agents. Load the clinic from the onboarding card to add the AI receptionist.</Empty>}
      <Section title="Recent tool calls">
        {data.agentActions.length ? data.agentActions.map(x => (
          <Row key={x.id}><span className="font-mono text-sm">{x.tool}</span><Meta>{x.agent?.name} · {when(x.at, tz, 'seconds')}{x.errorCode ? ` · ${x.errorCode}` : ''}</Meta><Status value={x.outcome === 'ok' ? 'ok' : x.outcome === 'killed' ? 'killed' : 'denied'} /></Row>
        )) : <Empty>No tool calls yet.</Empty>}
      </Section>
    </Page>
  );
}
