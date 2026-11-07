import Link from 'next/link';
import { q, defaultLocation } from '../../lib/server';
import { label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Tabs, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Client = {
  id: string; ref: string; displayName: string; kind: string; status: string; source: string; city: string;
  people: { firstName: string; lastName: string; isPrimary: boolean; contactPoints: { kind: string; value: string }[] }[];
  ownerships: { patient: { id: string; name: string; status: string; species: { name: string } | null } | null }[];
};

const PAGE = 50;

/**
 * Clients (households). Search by name, client ref, phone digits or email; prospects registered by
 * the AI receptionist or the portal wait here for the front desk to confirm (pending → active).
 */
export default async function ClientsPage({ searchParams }: { searchParams?: Promise<{ q?: string; view?: string; page?: string }> }) {
  const sp = (await searchParams) ?? {};
  const text = (sp.q ?? '').trim().slice(0, 80);
  const view = sp.view === 'prospect' ? 'prospect' : sp.view === 'inactive' ? 'inactive' : 'active';
  const page = Math.max(1, Number(sp.page) || 1);
  const digits = text.replace(/\D/g, '');
  const search = text ? `OR: [{ displayName: { contains: $t, mode: insensitive } }, { ref: { equals: $t } }, { people: { some: { contactPoints: { some: { value: { contains: $c, mode: insensitive } } } } } }]` : '';
  const data = await q<{ clients: Client[]; count: number; active: number; prospect: number; inactive: number; locations: { id: string; kind: string | null }[] }>(`
    query Clients(${text ? '$t: String!, $c: String!, ' : ''}$skip: Int!, $status: [String!]) {
      locations(where: { active: { equals: true } }, orderBy: { code: asc }) { id kind }
      clients(where: { status: { in: $status } ${search ? `, ${search}` : ''} }, orderBy: { displayName: asc }, take: ${PAGE}, skip: $skip) {
        id ref displayName kind status source city
        people(where: { isPrimary: { equals: true } }) { id firstName lastName isPrimary contactPoints(where: { isPrimary: { equals: true } }) { id kind value } }
        ownerships(where: { effectiveTo: null }) { id patient { id name status species { name } } }
      }
      count: clientsCount(where: { status: { in: $status } ${search ? `, ${search}` : ''} })
      active: clientsCount(where: { status: { equals: "active" } })
      prospect: clientsCount(where: { status: { equals: "prospect" } })
      inactive: clientsCount(where: { status: { in: ["inactive", "merged", "closed"] } })
    }`, { ...(text ? { t: text, c: digits.length >= 4 ? digits : text.includes('@') ? text.toLowerCase() : '__none__' } : {}), skip: (page - 1) * PAGE, status: view === 'inactive' ? ['inactive', 'merged', 'closed'] : [view] });
  const home = await defaultLocation(data.locations);
  const href = (patch: Record<string, string>) => `/dashboard/platform/clients?${new URLSearchParams({ view, ...(text ? { q: text } : {}), ...patch })}`;
  return (
    <Page title="Clients">
      <div className="grid grid-cols-3 gap-4 sm:w-1/2">
        <Stat name="Active" value={data.active} />
        <Stat name="To confirm" value={data.prospect ? <span className="text-amber-600">{data.prospect}</span> : 0} />
        <Stat name="Inactive" value={data.inactive} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs active={view} items={[{ key: 'active', label: 'Active', href: href({ view: 'active' }) }, { key: 'prospect', label: 'To confirm', href: href({ view: 'prospect' }), count: data.prospect }, { key: 'inactive', label: 'Inactive', href: href({ view: 'inactive' }) }]} />
        <form className="flex w-full min-w-0 gap-2 sm:w-auto" action="/dashboard/platform/clients">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={text} placeholder="Name, C-ref, phone or email" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:w-64 sm:flex-none" />
          <button className="h-8 shrink-0 rounded-md border px-3 text-sm">Search</button>
        </form>
      </div>
      <div>
        {data.clients.length ? data.clients.map(c => {
          const p = c.people[0];
          return (
            <Row key={c.id} href={`/dashboard/platform/clients/${c.id}`}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{c.displayName}</span><span className="font-mono text-xs text-muted-foreground">{c.ref}</span>{c.kind !== 'individual' ? <span className="text-xs text-muted-foreground">{label(c.kind)}</span> : null}</div>
                <Meta>{p ? `${p.firstName} ${p.lastName}` : ''}{p?.contactPoints.map(cp => ` · ${cp.value}`).join('')}{c.city ? ` · ${c.city}` : ''}{c.source !== 'csr' ? ` · via ${label(c.source)}` : ''}</Meta>
                <Meta>{c.ownerships.map(o => o.patient ? `${o.patient.name}${o.patient.status === 'deceased' ? ' †' : ''}` : '').filter(Boolean).join(', ') || 'No patients'}</Meta>
              </div>
              <Status value={c.status} />
            </Row>
          );
        }) : <Empty>{text ? `No clients match “${text}”.` : 'No clients yet. Load the clinic from the onboarding card or register one below.'}</Empty>}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {page > 1 ? <Link className="underline" href={href({ page: String(page - 1) })}>← Previous</Link> : null}
        <span className="text-muted-foreground">{data.count ? `${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, data.count)} of ${data.count}` : ''}</span>
        {page * PAGE < data.count ? <Link className="underline" href={href({ page: String(page + 1) })}>Next →</Link> : null}
      </div>
      <section className="space-y-3">
        <h2 className="border-b pb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">Register a client</h2>
        <CommandForm op="registerClient" build="registerClient" submit="Register" paths={['/dashboard/platform/clients']} fixed={{ locationId: home?.id ?? '' }}
          fields={[
            { name: 'firstName', label: 'First name' }, { name: 'lastName', label: 'Last name' },
            { name: 'phone', label: 'Mobile', placeholder: '916-555-0123' }, { name: 'email', label: 'Email', width: 'md' },
            { name: 'petName', label: 'Pet name' },
            { name: 'species', label: 'Species', options: [{ value: 'canine', label: 'Dog' }, { value: 'feline', label: 'Cat' }, { value: 'rabbit', label: 'Rabbit' }, { value: 'ferret', label: 'Ferret' }, { value: 'avian', label: 'Bird' }, { value: 'reptile', label: 'Reptile' }] },
            { name: 'sex', label: 'Sex', width: 'sm', options: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'unknown', label: 'Unknown' }] },
            { name: 'dateOfBirth', label: 'Born (YYYY-MM-DD)' },
          ]} />
      </section>
    </Page>
  );
}
