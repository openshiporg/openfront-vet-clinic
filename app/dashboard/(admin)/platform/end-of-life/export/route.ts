import { NextRequest } from 'next/server';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const t = String(v ?? '').replace(/^([=+\-@\t\r])/, "'$1");
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};
const notFound = () => new Response('Not found', { status: 404 });

/** The custody log as a download. Read through the signed-in session; a role without access gets 404. */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('kind') !== 'custody') return notFound();
  type E = { kind: string; tagNumber: string; place: string | null; at: string; order: { ref: string; patient: { name: string } | null } | null; by: { displayName: string } | null };
  const events: E[] = [];
  for (let skip = 0; skip < 50_000; skip += 500) {
    const res = await keystoneClient<{ custodyEvents: E[] }>(`{ custodyEvents(orderBy: [{ at: desc }, { id: asc }], take: 500, skip: ${skip}) { kind tagNumber place at order { ref patient { name } } by { displayName } } }`);
    if (!res.success) return notFound();
    events.push(...res.data.custodyEvents);
    if (res.data.custodyEvents.length < 500) break;
  }
  const rows = [['When', 'Order', 'Patient', 'Tag', 'Step', 'Place', 'By'], ...events.map(e => [e.at, e.order?.ref, e.order?.patient?.name, e.tagNumber, e.kind, e.place, e.by?.displayName])];
  return new Response(rows.map(r => r.map(cell).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="custody-log.csv"' } });
}
