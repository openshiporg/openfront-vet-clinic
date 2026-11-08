import { q, practiceTimeZone, defaultLocation } from '../../lib/server';
import { when, title, label } from '../../lib/format';
import { ENCOUNTER_KINDS } from '../../lib/clinical';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type E = { id: string; ref: string; kind: string; status: string; reason: string; startedAt: string; signedAt: string | null; patient: { id: string; name: string; species: { name: string } | null } | null; attendingDvm: { displayName: string } | null; location: { name: string } | null };

const VIEWS = {
  open: { label: 'Open', where: { status: { in: ['open', 'in_progress'] } } },
  unsigned: { label: 'Waiting for signature', where: { status: { equals: 'pending_signature' } } },
  signed: { label: 'Signed', where: { status: { equals: 'signed' } } },
  all: { label: 'All', where: {} },
} as const;

/**
 * Medical records by state (BUILD-PLAN P2). Unsigned records raise a task for the attending vet
 * after 24 hours and go to the medical director after 72 (the clinical job).
 */
export default async function EncountersPage({ searchParams }: { searchParams?: Promise<{ view?: string; location?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = (sp.view && sp.view in VIEWS ? sp.view : 'open') as keyof typeof VIEWS;
  const [data, tz] = await Promise.all([
    q<{ encounters: E[]; open: number; unsigned: number; locations: { id: string; name: string; kind: string | null }[]; patients: { id: string; name: string; ref: string }[]; staffMembers: { id: string; displayName: string }[] }>(`
      query L($where: EncounterWhereInput!) {
        encounters(where: $where, orderBy: { startedAt: desc }, take: 100) { id ref kind status reason startedAt signedAt patient { id name species { name } } attendingDvm { displayName } location { name } }
        open: encountersCount(where: { status: { in: ["open", "in_progress"] } })
        unsigned: encountersCount(where: { status: { equals: "pending_signature" } })
        locations(where: { active: { equals: true } }, orderBy: { code: asc }) { id name kind }
        patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 400) { id name ref }
        staffMembers(where: { active: { equals: true }, kind: { equals: "dvm" } }, orderBy: { displayName: asc }) { id displayName }
      }`, { where: VIEWS[view].where }),
    practiceTimeZone(),
  ]);
  const location = await defaultLocation(data.locations, sp.location);
  const items = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map(k => ({ key: k, label: VIEWS[k].label, href: `/dashboard/platform/encounters?view=${k}`, count: k === 'open' ? data.open : k === 'unsigned' ? data.unsigned : undefined }));
  return (
    <Page title="Encounters">
      <Tabs items={items} active={view} />
      <Section title={VIEWS[view].label}>
        {data.encounters.length ? data.encounters.map(e => (
          <Row key={e.id} href={`/dashboard/platform/encounters/${e.id}`}>
            <div className="min-w-0 flex-1">
              <span className="font-mono text-xs">{e.ref}</span> <span className="font-medium">{e.patient?.name}</span> <span className="text-muted-foreground">{e.patient?.species?.name}</span>
              <Meta>{title(e.kind)}{e.reason ? ` · ${e.reason}` : ''} · {e.attendingDvm?.displayName ?? 'no attending vet'} · {e.location?.name} · {when(e.startedAt, tz)}</Meta>
            </div>
            <Status value={e.status} />
          </Row>
        )) : <Empty>No {label(VIEWS[view].label)} records.</Empty>}
      </Section>
      {location ? (
        <Section title="Start a visit record">
          <CommandForm op="openEncounter" build="openEncounter" submit="Open record" fixed={{ locationId: location.id }} paths={['/dashboard/platform/encounters']}
            fields={[
              { name: 'patientId', label: 'Patient', width: 'lg', options: data.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.ref}` })) },
              { name: 'kind', label: 'Visit', options: ENCOUNTER_KINDS.map(k => ({ value: k, label: title(k) })) },
              { name: 'attendingDvmId', label: 'Attending vet', options: data.staffMembers.map(s => ({ value: s.id, label: s.displayName })) },
              { name: 'reason', label: 'Reason', width: 'lg', placeholder: 'Annual exam and vaccines' },
            ]} />
        </Section>
      ) : null}
    </Page>
  );
}
