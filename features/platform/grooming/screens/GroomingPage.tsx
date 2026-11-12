import { q, practiceTimeZone } from '../../lib/server';
import { when, money } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

const PATH = '/dashboard/platform/grooming';
const NEXT: Record<string, { to: string; text: string }[]> = {
  booked: [{ to: 'checked_in', text: 'Check in' }, { to: 'no_show', text: 'No show' }],
  checked_in: [{ to: 'in_progress', text: 'Start' }],
  in_progress: [{ to: 'ready', text: 'Ready for pickup' }],
  ready: [{ to: 'completed', text: 'Complete and charge' }],
};

/** Grooming: bookings, per-pet style notes that keep their history, completion charges from the price list. */
export default async function GroomingPage() {
  const tz = await practiceTimeZone();
  const d = await q<{ grooms: { id: string; ref: string; status: string; version: number; startsAt: string; service: string; priceMinor: string; patient: { id: string; name: string } | null; client: { displayName: string } | null; groomer: { displayName: string } | null }[]; patients: { id: string; name: string; ownerships: { client: { displayName: string } | null }[] }[]; groomers: { id: string; displayName: string }[]; items: { code: string; name: string; priceMinor: string }[]; notes: { id: string; versionNo: number; blade: string | null; style: string | null; behaviour: string | null; notes: string | null; patient: { id: string } | null }[] }>(`{
    grooms: groomAppointments(where: { status: { in: ["booked", "checked_in", "in_progress", "ready"] } }, orderBy: { startsAt: asc }, take: 60) { id ref status version startsAt service priceMinor patient { id name } client { displayName } groomer { displayName } }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name ownerships(where: { effectiveTo: null, role: { equals: "primary" } }, take: 1) { client { displayName } } }
    groomers: staffMembers(where: { active: { equals: true } }, orderBy: { displayName: asc }, take: 50) { id displayName }
    items: serviceItems(where: { area: { equals: "grooming" }, active: { equals: true } }, orderBy: { name: asc }, take: 20) { code name priceMinor }
    notes: groomNotes(orderBy: { createdAt: desc }, take: 200) { id versionNo blade style behaviour notes patient { id } }
  }`);
  const services = d.items.map(i => ({ value: i.code.replace(/^GROOM-/, '').toLowerCase(), label: `${i.name} · ${money(i.priceMinor)}` }));
  return (
    <Page title="Grooming">
      <Section title="Book a groom">
        <CommandForm op="bookGroom" build="phase5" submit="Book" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.ownerships[0]?.client?.displayName ?? 'no owner on file'}` }))] },
          { name: 'groomerId', label: 'Groomer', options: [{ value: '', label: 'Choose a groomer' }, ...d.groomers.map(g => ({ value: g.id, label: g.displayName }))] },
          { name: 'service', label: 'Service', options: [{ value: '', label: 'Choose a service' }, ...services] },
          { name: 'startsAt', label: 'Starts (YYYY-MM-DDTHH:MM)', placeholder: '2026-11-20T10:00', width: 'sm' },
        ]} />
      </Section>
      <Section title="Today and coming up">
        {d.grooms.length ? d.grooms.map(g => {
          const last = d.notes.find(n => n.patient?.id === g.patient?.id);
          return (
            <div key={g.id} className="border-b py-2 last:border-0">
              <Row>
                <div className="min-w-0 flex-1"><span className="font-medium">{g.patient?.name}</span> · {g.client?.displayName}<Meta>{g.ref} · {when(g.startsAt, tz, 'dayTime')} · {g.service.replaceAll('_', ' ')} · {money(g.priceMinor)} · {g.groomer?.displayName}</Meta>
                  {last ? <Meta>Last style: {[last.blade && `blade ${last.blade}`, last.style, last.behaviour].filter(Boolean).join(' · ')}</Meta> : null}</div>
                <Status value={g.status} />
              </Row>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {(NEXT[g.status] ?? []).map(n => (
                  n.to === 'no_show' ? <ActionButton key={n.to} op="advanceGroom" vars={{ groomId: g.id, to: n.to, expectedVersion: g.version }} ask="What happened?" paths={[PATH]}>{n.text}</ActionButton>
                    : <ActionButton key={n.to} op="advanceGroom" vars={{ groomId: g.id, to: n.to, expectedVersion: g.version }} paths={[PATH]}>{n.text}</ActionButton>
                ))}
                {['booked', 'checked_in'].includes(g.status) ? <ActionButton op="advanceGroom" vars={{ groomId: g.id, to: 'cancelled', expectedVersion: g.version }} ask="Why is this groom cancelled?" paths={[PATH]}>Cancel</ActionButton> : null}
                <CommandForm op="saveGroomNote" build="phase5" submit="Save style note" fixed={{ patientId: g.patient?.id ?? '', groomId: g.id }} paths={[PATH]} fields={[
                  { name: 'blade', label: 'Blade', width: 'sm' }, { name: 'style', label: 'Style' }, { name: 'behaviour', label: 'Behaviour' }, { name: 'notes', label: 'Notes' },
                ]} />
              </div>
            </div>
          );
        }) : <Empty>No grooms booked.</Empty>}
      </Section>
    </Page>
  );
}
