import { q } from '../../lib/server';
import { label, money } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Settings = { displayName: string; legalName: string; homeTimeZone: string; currencyCode: string; noShowGraceMinutes: number; estimateValidityDays: number; electiveDepositPct: string | null; refundApprovalThresholdMinor: string; discountApprovalThresholdBps: number; writeOffRequiresApproval: boolean; strictAgentOwnerSoD: boolean; features: Record<string, boolean> | null; version: number; medicalDirector: { displayName: string } | null };
type Location = { id: string; code: string; name: string; kind: string; city: string | null; stateCode: string; timeZone: string; phone: string | null; emergencyCoverage: string; active: boolean; calendar: { code: string; coverageThrough: string | null } | null };
type Calendar = { id: string; code: string; name: string; kind: string; timeZone: string; regularOpen: string; regularClose: string; coverageThrough: string | null; source: string | null; exceptionsCount: number };
type Policy = { id: string; action: string; description: string; requiredPermission: string; expiresAfterMinutes: number; thresholdMinor: string | null };

/** Practice profile, locations, business calendars, approval policies, and controls (changed only by maker-checker). */
export default async function SettingsPage() {
  const data = await q<{ practiceSettings: Settings | null; locations: Location[]; businessCalendars: Calendar[]; approvalPolicies: Policy[] }>(`{
    practiceSettings { displayName legalName homeTimeZone currencyCode noShowGraceMinutes estimateValidityDays electiveDepositPct refundApprovalThresholdMinor discountApprovalThresholdBps writeOffRequiresApproval strictAgentOwnerSoD features version medicalDirector { displayName } }
    locations(orderBy: { code: asc }) { id code name kind city stateCode timeZone phone emergencyCoverage active calendar { code coverageThrough } }
    businessCalendars(orderBy: { code: asc }) { id code name kind timeZone regularOpen regularClose coverageThrough source exceptionsCount }
    approvalPolicies(orderBy: { action: asc }) { id action description requiredPermission expiresAfterMinutes thresholdMinor }
  }`);
  const s = data.practiceSettings;
  return (
    <Page title="Practice settings">
      {s ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat name="Practice" value={s.displayName} />
          <Stat name="Medical director" value={s.medicalDirector?.displayName ?? '—'} />
          <Stat name="Time zone" value={s.homeTimeZone} />
          <Stat name="Controls version" value={s.version} />
        </div>
      ) : <Empty>The practice is not set up yet. Load it from the onboarding card.</Empty>}
      {s ? (
        <Section title="Controls (change needs a second person)">
          <Row><span>No-show grace</span><Meta>{s.noShowGraceMinutes} minutes</Meta></Row>
          <Row><span>Estimate validity</span><Meta>{s.estimateValidityDays} days</Meta></Row>
          <Row><span>Elective deposit</span><Meta>{s.electiveDepositPct ? `${s.electiveDepositPct} of the estimate low end` : '—'}</Meta></Row>
          <Row><span>Refunds over</span><Meta>{money(s.refundApprovalThresholdMinor)} need approval</Meta></Row>
          <Row><span>Discounts over</span><Meta>{s.discountApprovalThresholdBps} bps need approval</Meta></Row>
          <Row><span>Agent owner may not approve their agent</span><Meta>{s.strictAgentOwnerSoD ? 'yes' : 'no'}</Meta></Row>
          <Row>
            <span>Features</span>
            <div className="flex flex-wrap gap-2">{Object.entries(s.features ?? {}).map(([k, on]) => <span key={k} className="font-mono text-xs"><Status value={on ? 'active' : 'paused'} /> {k}</span>)}</div>
          </Row>
          <CommandForm
            op="requestPracticeControls" build="practiceControls" submit="Request change" paths={['/dashboard/platform/settings', '/dashboard/platform/approvals']}
            fields={[
              { name: 'noShowGraceMinutes', label: 'No-show grace (min)', width: 'sm' },
              { name: 'estimateValidityDays', label: 'Estimate validity (days)', width: 'sm' },
              { name: 'refundThreshold', label: 'Refund approval over ($)', width: 'md' },
              { name: 'aiVoice', label: 'AI receptionist', options: [{ value: '', label: 'unchanged' }, { value: 'on', label: 'turn on' }, { value: 'off', label: 'turn off' }] },
              { name: 'reason', label: 'Reason', width: 'lg' },
            ]}
          />
        </Section>
      ) : null}
      <Section title="Locations">
        {data.locations.length ? data.locations.map(l => (
          <Row key={l.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{l.name}</span><span className="font-mono text-xs text-muted-foreground">{l.code}</span></div>
              <Meta>{label(l.kind)} · {l.city}, {l.stateCode.replace('US-', '')} · {l.timeZone} · emergencies: {label(l.emergencyCoverage)}{l.calendar ? ` · calendar ${l.calendar.code}` : ''}</Meta>
            </div>
            <Status value={l.active ? 'active' : 'retired'} />
          </Row>
        )) : <Empty>No locations.</Empty>}
      </Section>
      <Section title="Business calendars">
        {data.businessCalendars.map(c => (
          <Row key={c.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <span className="font-medium">{c.name}</span>
              <Meta>{c.code} · {label(c.kind)} · {c.regularOpen}–{c.regularClose} {c.timeZone} · {c.exceptionsCount} holidays/closures · covered through {c.coverageThrough ?? '—'}</Meta>
              {c.source ? <p className="break-words text-xs text-muted-foreground">{c.source}</p> : null}
            </div>
          </Row>
        ))}
      </Section>
      <Section title="Approval policies (maker-checker)">
        {data.approvalPolicies.map(p => (
          <Row key={p.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <span className="font-medium">{label(p.action.replace('.', ' · '))}</span>
              <Meta>{p.description}</Meta>
            </div>
            <Meta>needs {p.requiredPermission.replace(/^can/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()}{p.thresholdMinor ? ` over ${money(p.thresholdMinor)}` : ''} · expires {Math.round(p.expiresAfterMinutes / 60)}h</Meta>
          </Row>
        ))}
      </Section>
    </Page>
  );
}
