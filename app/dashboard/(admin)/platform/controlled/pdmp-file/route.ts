import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

export const dynamic = 'force-dynamic';

/** The exact ASAP 4.2B file that was generated, read through the permission-scoped API. A role without register access, or an unknown id, gets 404. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return new Response('Not found', { status: 404 });
  const res = await keystoneClient<{ pdmpSubmission: { ref: string; fileBody: { text?: string } | null } | null }>(`query F($id: ID!) { pdmpSubmission(where: { id: $id }) { ref fileBody } }`, { id });
  const sub = res.success ? res.data.pdmpSubmission : null;
  if (!sub?.fileBody?.text) return new Response('Not found', { status: 404 });
  return new Response(sub.fileBody.text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${sub.ref}.asap"`, 'cache-control': 'no-store' } });
}
