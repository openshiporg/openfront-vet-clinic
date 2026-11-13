import { q, practiceTimeZone, myPermissions } from '../../lib/server';
import { when } from '../../lib/format';
import { money } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Period = { id: string; ref: string; startsOn: string; endsOn: string; status: string; version: number; calculatedAt: string | null; approvedAt: string | null; totals: { staffId: string; productionMinor: string; commissionMinor: string }[] | null; exports: { ref: string; rows: number }[] };
type Rule = { id: string; versionNo: number; label: string; status: string; effectiveFrom: string; rules: Record<string, { basis: string; bps: number }> | null };

const PATH = '/dashboard/platform/pay';

/**
 * Production and pay periods. Only people who see finance or manage payments can open this; the buttons show only to them.
 * Rule changes and period approval need a second person (they go to Approvals).
 */
export default async function PayPage() {
  const [data, tz, can] = await Promise.all([
    q<{ payPeriods: Period[]; productionRuleVersions: Rule[] }>(`{
      payPeriods(orderBy: { startsOn: desc }, take: 50) { id ref startsOn endsOn status version calculatedAt approvedAt totals exports { ref rows } }
      productionRuleVersions(orderBy: { versionNo: desc }, take: 20) { id versionNo label status effectiveFrom rules }
    }`),
    practiceTimeZone(),
    myPermissions(['canViewFinance', 'canManagePayments'] as const),
  ]);
  const pay = can.canViewFinance || can.canManagePayments;
  const sum = (p: Period, k: 'productionMinor' | 'commissionMinor') => (p.totals ?? []).reduce((a, t) => a + BigInt(t[k]), 0n).toString();
  const rulesText = (r: Rule) => Object.entries(r.rules ?? {}).map(([g, x]) => `${g} ${x.bps / 100}%${x.basis === 'ordered' ? ' (ordering vet)' : ''}`).join(' · ');
  return (
    <Page title="Production and pay">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat name="Periods" value={data.payPeriods.length} />
        <Stat name="Open or calculated" value={data.payPeriods.filter(p => ['open', 'calculated'].includes(p.status)).length} />
        <Stat name="Rule versions" value={data.productionRuleVersions.length} />
      </div>
      <Section title="Pay periods">
        {pay ? <CommandForm className="mb-2" op="openPayPeriod" build="phase6" submit="Open a pay period" paths={[PATH]} fields={[{ name: 'startsOn', label: 'From', placeholder: '2026-11-01' }, { name: 'endsOn', label: 'To', placeholder: '2026-11-15' }]} /> : null}
        {data.payPeriods.length ? data.payPeriods.map(p => (
          <Row key={p.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{p.ref}</span><span className="font-medium">{p.startsOn.slice(0, 10)} to {p.endsOn.slice(0, 10)}</span></div>
              <Meta>{p.totals ? `Production ${money(sum(p, 'productionMinor'))} · Commission ${money(sum(p, 'commissionMinor'))}` : 'Not calculated'}{p.approvedAt ? ` · approved ${when(p.approvedAt, tz, 'day')}` : ''}{p.exports[0] ? ` · payroll file ${p.exports[0].ref} (${p.exports[0].rows} people)` : ''}</Meta>
              {pay ? (
                <div className="flex flex-wrap gap-2">
                  {p.status === 'open' ? <ActionButton op="calculatePayPeriod" vars={{ periodId: p.id, expectedVersion: p.version }} paths={[PATH]}>Calculate</ActionButton> : null}
                  {p.status === 'calculated' ? <ActionButton op="requestPayPeriodApproval" vars={{ periodId: p.id }} paths={[PATH]}>Ask to approve</ActionButton> : null}
                  {p.status === 'calculated' ? <ActionButton op="reopenPayPeriod" vars={{ periodId: p.id, expectedVersion: p.version }} ask="Why reopen these totals?" paths={[PATH]}>Reopen</ActionButton> : null}
                  {p.status === 'approved' ? <ActionButton op="exportPayPeriod" vars={{ periodId: p.id }} paths={[PATH]}>Make payroll file</ActionButton> : null}
                  {p.status === 'exported' ? <ActionButton op="lockPayPeriod" vars={{ periodId: p.id, expectedVersion: p.version }} confirm="Lock this period? Nothing can be added to it afterwards." paths={[PATH]}>Lock</ActionButton> : null}
                </div>
              ) : null}
            </div>
            <Status value={p.status} />
          </Row>
        )) : <Empty>No pay periods.</Empty>}
      </Section>
      <Section title="Rule versions">
        {data.productionRuleVersions.length ? data.productionRuleVersions.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <span className="font-medium">v{r.versionNo} {r.label}</span><Meta>From {r.effectiveFrom.slice(0, 10)}{rulesText(r) ? ` · ${rulesText(r)}` : ''}</Meta>
              {pay && r.status === 'draft' ? <ActionButton op="requestRulePublication" vars={{ ruleVersionId: r.id }} paths={[PATH]}>Ask to publish</ActionButton> : null}
            </div>
            <Status value={r.status} />
          </Row>
        )) : <Empty>No rule versions.</Empty>}
        {pay ? (
          <CommandForm className="mt-2" op="draftRuleVersion" build="phase6" submit="Draft new rules" paths={[PATH]} fields={[
            { name: 'label', label: 'Name', placeholder: 'Rules from December' },
            { name: 'effectiveFrom', label: 'From', placeholder: '2026-12-01' },
            { name: 'rules', label: 'One per line: group percent', multiline: 4, width: 'lg', defaultValue: 'exam 20\nsurgery 20\ndental 20\nlaboratory 10 ordered\nimaging 10 ordered', hint: 'Groups are the fee groups (exam, surgery, dental, laboratory…). Add "ordered" to credit the ordering vet.' },
          ]} />
        ) : null}
      </Section>
    </Page>
  );
}
