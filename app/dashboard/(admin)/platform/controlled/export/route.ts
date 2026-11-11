import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const t = String(v ?? '').replace(/^([=+\-@\t\r])/, "'$1");
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
};

/** The register as a CSV, read through the same permission-scoped API as the page. A role without register access gets 404. */
export async function GET() {
  const res = await keystoneClient<{ csLogEntries: { ref: string; type: string; schedule: string; qtySigned: string; unit: string | null; occurredAt: string; reason: string; container: { ref: string } | null; actor: { displayName: string } | null; witness: { displayName: string } | null }[] }>(`{
    csLogEntries(orderBy: { recordedAt: desc }, take: 500) { ref type schedule qtySigned unit occurredAt reason container { ref } actor { displayName } witness { displayName } }
  }`);
  if (!res.success) return new Response('Not found', { status: 404 });
  const rows = [['Entry', 'Container', 'Type', 'Schedule', 'Change', 'Unit', 'When', 'Recorded by', 'Witness', 'Reason'],
    ...res.data.csLogEntries.map(e => [e.ref, e.container?.ref, e.type.replaceAll('_', ' '), e.schedule, e.qtySigned, e.unit, e.occurredAt, e.actor?.displayName, e.witness?.displayName, e.reason])];
  return new Response(rows.map(r => r.map(cell).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="controlled-substance-register.csv"', 'cache-control': 'no-store' } });
}
