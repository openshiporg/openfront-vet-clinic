import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { label } from '../../lib/format';
import { ageText, todayIn } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Tabs } from '../../components/ui';

type Pt = {
  id: string; ref: string; name: string; status: string; sex: string; reproductiveStatus: string; dateOfBirth: string | null; species: { name: string } | null; breed: { name: string } | null;
  alerts: { severity: string; text: string }[]; vcprs: { expiresAt: string }[]; ownerships: { client: { displayName: string } | null }[];
};

const PAGE = 50;

/** Patients: search by name, P-ref or microchip; alerts and the VCPR state show in the list. */
export default async function PatientsPage({ searchParams }: { searchParams?: Promise<{ q?: string; view?: string; page?: string }> }) {
  const sp = (await searchParams) ?? {};
  const text = (sp.q ?? '').trim().slice(0, 80);
  const view = sp.view === 'alerts' ? 'alerts' : sp.view === 'vcpr' ? 'vcpr' : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date().toISOString();
  const parts = ['status: { in: ["active", "pending"] }'];
  if (text) parts.push('OR: [{ name: { contains: $t, mode: insensitive } }, { ref: { equals: $t } }, { microchips: { some: { number: { equals: $chip } } } }]');
  if (view === 'alerts') parts.push('alerts: { some: { active: { equals: true }, severity: { in: ["warn", "block"] } } }');
  if (view === 'vcpr') parts.push('vcprs: { none: { status: { equals: "active" }, expiresAt: { gt: $now } } }');
  const where = `{ ${parts.join(', ')} }`;
  const [data, tz] = await Promise.all([
    q<{ patients: Pt[]; count: number }>(`
      query Pts(${text ? '$t: String!, $chip: String!, ' : ''}$now: DateTime!, $skip: Int!) {
        patients(where: ${where}, orderBy: { name: asc }, take: ${PAGE}, skip: $skip) {
          id ref name status sex reproductiveStatus dateOfBirth species { name } breed { name }
          alerts(where: { active: { equals: true } }) { id severity text }
          vcprs(where: { status: { equals: "active" }, expiresAt: { gt: $now } }, take: 1) { id expiresAt }
          ownerships(where: { effectiveTo: null }, take: 1) { id client { id displayName } }
        }
        count: patientsCount(where: ${where})
      }`, { ...(text ? { t: text, chip: text.replace(/[\s-]/g, '').toUpperCase() } : {}), now, skip: (page - 1) * PAGE }),
    practiceTimeZone(),
  ]);
  const today = todayIn(tz);
  const href = (patch: Record<string, string>) => `/dashboard/platform/patients?${new URLSearchParams({ view, ...(text ? { q: text } : {}), ...patch })}`;
  return (
    <Page title="Patients">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs active={view} items={[{ key: 'all', label: 'All', href: href({ view: 'all' }) }, { key: 'alerts', label: 'With alerts', href: href({ view: 'alerts' }) }, { key: 'vcpr', label: 'No VCPR in force', href: href({ view: 'vcpr' }) }]} />
        <form className="flex w-full min-w-0 gap-2 sm:w-auto" action="/dashboard/platform/patients">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={text} placeholder="Name, P-ref or microchip" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:w-64 sm:flex-none" />
          <button className="h-8 shrink-0 rounded-md border px-3 text-sm">Search</button>
        </form>
        <span className="text-sm text-muted-foreground">{data.count} patients</span>
      </div>
      <div>
        {data.patients.length ? data.patients.map(p => (
          <Row key={p.id} href={`/dashboard/platform/patients/${p.id}`}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{p.name}</span><span className="font-mono text-xs text-muted-foreground">{p.ref}</span><span className="text-sm text-muted-foreground">{p.ownerships[0]?.client?.displayName}</span></div>
              <Meta>{p.species?.name} · {p.breed?.name ?? '—'} · {p.sex} {label(p.reproductiveStatus)} · {ageText(p.dateOfBirth, today)}{p.vcprs.length ? '' : ' · no VCPR in force'}</Meta>
              {p.alerts.length ? <p className="text-xs text-red-700 dark:text-red-400">⚠ {p.alerts.map(a => a.text).join(' · ')}</p> : null}
            </div>
            <Status value={p.status} />
          </Row>
        )) : <Empty>{text ? `No patients match “${text}”.` : 'No patients.'}</Empty>}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {page > 1 ? <Link className="underline" href={href({ page: String(page - 1) })}>← Previous</Link> : null}
        {page * PAGE < data.count ? <Link className="underline" href={href({ page: String(page + 1) })}>Next →</Link> : null}
      </div>
    </Page>
  );
}
