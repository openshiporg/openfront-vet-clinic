import { q, practiceTimeZone } from '../../lib/server';
import { when } from '../../lib/format';
import { money } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type Period = { id: string; ref: string; startsOn: string; endsOn: string; status: string; totalsHash: string; calculatedAt: string | null; approvedAt: string | null; totals: { staffId: string; productionMinor: string; commissionMinor: string }[] | null };
type Rule = { id: string; versionNo: number; label: string; status: string; effectiveFrom: string };

/** Production and pay periods. Only people who manage payments can open this; rule changes and adjustments need a second person. */
export default async function PayPage() {
  const [data, tz] = await Promise.all([
    q<{ payPeriods: Period[]; productionRuleVersions: Rule[] }>(`{
      payPeriods(orderBy: { startsOn: desc }, take: 50) { id ref startsOn endsOn status totalsHash calculatedAt approvedAt totals }
      productionRuleVersions(orderBy: { versionNo: desc }, take: 20) { id versionNo label status effectiveFrom }
    }`),
    practiceTimeZone(),
  ]);
  const sum = (p: Period, k: 'productionMinor' | 'commissionMinor') => (p.totals ?? []).reduce((a, t) => a + BigInt(t[k]), 0n).toString();
  return (
    <Page title="Production and pay">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat name="Periods" value={data.payPeriods.length} />
        <Stat name="Open or calculated" value={data.payPeriods.filter(p => ['open', 'calculated'].includes(p.status)).length} />
        <Stat name="Rule versions" value={data.productionRuleVersions.length} />
      </div>
      <Section title="Pay periods">
        {data.payPeriods.length ? data.payPeriods.map(p => (
          <Row key={p.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{p.ref}</span><span className="font-medium">{p.startsOn.slice(0, 10)} to {p.endsOn.slice(0, 10)}</span></div>
              <Meta>{p.totals ? `Production ${money(sum(p, 'productionMinor'))} · Commission ${money(sum(p, 'commissionMinor'))}` : 'Not calculated'}{p.approvedAt ? ` · approved ${when(p.approvedAt, tz, 'day')}` : ''}</Meta>
            </div>
            <Status value={p.status} />
          </Row>
        )) : <Empty>No pay periods.</Empty>}
      </Section>
      <Section title="Rule versions">
        {data.productionRuleVersions.length ? data.productionRuleVersions.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1"><span className="font-medium">v{r.versionNo} {r.label}</span><Meta>From {r.effectiveFrom.slice(0, 10)}</Meta></div>
            <Status value={r.status} />
          </Row>
        )) : <Empty>No rule versions.</Empty>}
      </Section>
    </Page>
  );
}
