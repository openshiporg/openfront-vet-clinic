import { NextRequest } from 'next/server';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const raw = String(v ?? '');
  const t = /^-?\d+(\.\d+)?$/.test(raw) ? raw : raw.replace(/^([=+\-@\t\r])/, "'$1");
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};
const dollars = (minor: string | bigint) => { const n = BigInt(minor); return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`; };
const notFound = () => new Response('Not found', { status: 404 });

const PAGE = 500; // API_MAX_TAKE: a bigger page is refused by the API

/** Every row of a list, read a page at a time through the signed-in session. Returns null when the role may not read it. */
async function pages<T>(field: string, order: string, selection: string, where = ''): Promise<T[] | null> {
  const out: T[] = [];
  for (let skip = 0; skip < 50_000; skip += PAGE) {
    const res = await keystoneClient<Record<string, T[]>>(`{ ${field}(${where ? `where: ${where}, ` : ''}orderBy: ${order}, take: ${PAGE}, skip: ${skip}) { ${selection} } }`);
    if (!res.success) return null;
    out.push(...res.data[field]);
    if (res.data[field].length < PAGE) break;
  }
  return out;
}
const csv = (rows: unknown[][], name: string) => new Response(rows.map(r => r.map(cell).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });

/** Plan billing results, or the renewal notices that are due, as a download (read through the signed-in session; a role without access gets 404). */
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind');
  if (kind === 'renewals') {
    type R = { ref: string; termEndsOn: string; patient: { name: string } | null; client: { displayName: string } | null; plan: { name: string } | null; planVersion: { monthlyPriceMinor: string } | null; cardLabel: string | null; consent: { terms: { renewalNoticeDays?: number } | null } | null };
    const list = await pages<R>('enrollments', '[{ termEndsOn: asc }, { id: asc }]', 'ref termEndsOn cardLabel patient { name } client { displayName } plan { name } planVersion { monthlyPriceMinor } consent { terms }', '{ status: { equals: "active" }, autoRenew: { equals: true } }');
    if (!list) return notFound();
    const active = list.filter(e => e.termEndsOn);
    const rows = [['Plan', 'Client', 'Patient', 'Plan name', 'Renews on', 'Send notice by', 'Monthly price', 'Card'], ...active.map(e => {
      const days = Number(e.consent?.terms?.renewalNoticeDays ?? 30);
      const by = new Date(`${e.termEndsOn}T00:00:00Z`); by.setUTCDate(by.getUTCDate() - days);
      return [e.ref, e.client?.displayName, e.patient?.name, e.plan?.name, e.termEndsOn, by.toISOString().slice(0, 10), dollars(e.planVersion?.monthlyPriceMinor ?? '0'), e.cardLabel];
    })];
    return csv(rows, 'renewal-notices.csv');
  }
  if (kind !== 'billing') return notFound();
  type A = { periodKey: string; generation: number; status: string; amountMinor: string; enrollment: { ref: string; patient: { name: string } | null } | null };
  const list = await pages<A>('planBillingAttempts', '[{ startedAt: desc }, { id: asc }]', 'periodKey generation status amountMinor enrollment { ref patient { name } }');
  if (!list) return notFound();
  return csv([['Month', 'Plan', 'Patient', 'Try', 'Result', 'Amount'], ...list.map(a => [a.periodKey, a.enrollment?.ref, a.enrollment?.patient?.name, a.generation, a.status, dollars(a.amountMinor)])], 'plan-billing.csv');
}
