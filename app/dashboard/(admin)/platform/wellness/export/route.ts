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

/** Plan billing results as a download (read through the signed-in session; a role without access gets 404). */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('kind') !== 'billing') return notFound();
  const res = await keystoneClient<{ planBillingAttempts: { periodKey: string; generation: number; status: string; amountMinor: string; enrollment: { ref: string; patient: { name: string } | null } | null }[] }>(`{ planBillingAttempts(orderBy: { startedAt: desc }, take: 1000) { periodKey generation status amountMinor enrollment { ref patient { name } } } }`);
  if (!res.success) return notFound();
  const rows = [['Month', 'Plan', 'Patient', 'Try', 'Result', 'Amount'], ...res.data.planBillingAttempts.map(a => [a.periodKey, a.enrollment?.ref, a.enrollment?.patient?.name, a.generation, a.status, dollars(a.amountMinor)])];
  return new Response(rows.map(r => r.map(cell).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="plan-billing.csv"' } });
}
