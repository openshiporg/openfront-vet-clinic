import { NextRequest } from 'next/server';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';
import { practiceTimeZone } from '@/features/platform/lib/server';
import { todayIn } from '@/features/platform/lib/clinic';
import { ageBucket, AGE_LABEL } from '@/features/platform/lib/ageing';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const raw = String(v ?? '');
  const t = /^-?\d+(\.\d+)?$/.test(raw) ? raw : raw.replace(/^([=+\-@\t\r])/, "'$1");
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};
const dollars = (minor: string | bigint) => { const n = BigInt(minor); const neg = n < 0n; const a = neg ? -n : n; return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`; };
const csv = (rows: unknown[][], name: string) => new Response(rows.map(r => r.map(cell).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' } });
const notFound = () => new Response('Not found', { status: 404 });

/** Reports are downloads, never emailed: the ageing list, a client statement, and a claim packet. Read through the signed-in session, so a role without access gets 404. */
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind');
  const today = todayIn(await practiceTimeZone());
  if (kind === 'ageing') {
    const res = await keystoneClient<{ invoices: { ref: string; postedOn: string | null; totalMinor: string; balanceMinor: string; client: { displayName: string } | null }[] }>(`{ invoices(where: { status: { in: ["posted", "partially_paid"] } }, orderBy: { postedOn: asc }, take: 400) { ref postedOn totalMinor balanceMinor client { displayName } } }`);
    if (!res.success) return notFound();
    return csv([['Client', 'Invoice', 'Posted', 'Total', 'Owing', 'Age'], ...res.data.invoices.filter(i => BigInt(i.balanceMinor) > 0n).map(i => [i.client?.displayName, i.ref, i.postedOn?.slice(0, 10), dollars(i.totalMinor), dollars(i.balanceMinor), AGE_LABEL[ageBucket(i.postedOn?.slice(0, 10) ?? today, today)]])], 'who-owes');
  }
  if (kind === 'statement') {
    const clientId = request.nextUrl.searchParams.get('clientId') ?? '';
    const res = await keystoneClient<{ client: { displayName: string } | null; clientLedgerEntries: { postedOn: string; kind: string; memo: string; amountMinor: string; invoice: { ref: string } | null }[] }>(`query S($id: ID!) { client(where: { id: $id }) { displayName } clientLedgerEntries(where: { client: { id: { equals: $id } } }, orderBy: { at: asc }, take: 400) { postedOn kind memo amountMinor invoice { ref } } }`, { id: clientId });
    if (!res.success || !res.data.client) return notFound();
    let running = 0n;
    const rows = res.data.clientLedgerEntries.map(e => { running += BigInt(e.amountMinor); return [e.postedOn?.slice(0, 10), e.invoice?.ref, e.kind.replaceAll('_', ' '), e.memo, dollars(e.amountMinor), dollars(running)]; });
    return csv([[`Statement for ${res.data.client.displayName}`], ['Date', 'Invoice', 'What', 'Note', 'Amount', 'Balance'], ...rows], 'statement');
  }
  if (kind === 'claim') {
    const id = request.nextUrl.searchParams.get('id') ?? '';
    const res = await keystoneClient<{ insuranceClaimPacket: { ref: string; packetBody: string } | null }>(`query C($id: ID!) { insuranceClaimPacket(where: { id: $id }) { ref packetBody } }`, { id });
    if (!res.success || !res.data.insuranceClaimPacket?.packetBody) return notFound();
    return new Response(res.data.insuranceClaimPacket.packetBody, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="claim-${res.data.insuranceClaimPacket.ref}.html"`, 'cache-control': 'no-store' } });
  }
  return notFound();
}
