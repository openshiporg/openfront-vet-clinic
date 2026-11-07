import Link from 'next/link';
import { q, practiceTimeZone, defaultLocation } from '../../lib/server';
import { when, label } from '../../lib/format';
import { addDaysTo, dayBounds, todayIn, validDate } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';
import { BookPanel } from './BookPanel';

type Appt = {
  id: string; ref: string; startsAt: string; endsAt: string; status: string; channel: string; version: number; reason: string;
  appointmentType: { name: string; colour: string } | null; provider: { id: string; displayName: string } | null;
  client: { id: string; displayName: string } | null; patients: { patient: { id: string; name: string } | null }[];
  reservations: { resource: { name: string } | null }[];
};

const FIELDS = 'id ref startsAt endsAt status channel version reason appointmentType { name colour } provider { id displayName } client { id displayName } patients { patient { id name } } reservations { resource { name } }';
const PATHS = ['/dashboard/platform/schedule', '/dashboard/platform/today'];

/**
 * Day sheet by provider (BUILD-PLAN §2 Front desk). Columns are providers with appointments that day
 * at the chosen location; times are in the practice zone. Booking runs the same search and book
 * commands the AI receptionist uses, so slots are signed offers and overlaps are refused by the DB.
 */
export default async function SchedulePage({ searchParams }: { searchParams?: Promise<{ date?: string; location?: string; view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const tz = await practiceTimeZone();
  const date = validDate(sp.date, todayIn(tz));
  const { from, to } = dayBounds(date, tz);
  const meta = await q<{ locations: { id: string; code: string; name: string; kind: string | null }[]; appointmentTypes: { id: string; name: string; requestOnly: boolean; durationMinutes: number }[] }>(`{
    locations(where: { active: { equals: true } }, orderBy: { code: asc }) { id code name kind }
    appointmentTypes(where: { active: { equals: true } }, orderBy: { name: asc }) { id name requestOnly durationMinutes }
  }`);
  const location = await defaultLocation(meta.locations, sp.location);
  const view = sp.view === 'requested' ? 'requested' : 'day';
  const data = await q<{ appointments: Appt[]; requested: Appt[] }>(`
    query Day($from: DateTime!, $to: DateTime!, $loc: ID) {
      appointments(where: { startsAt: { gte: $from, lt: $to }, location: { id: { equals: $loc } }, status: { notIn: ["cancelled", "declined"] } }, orderBy: { startsAt: asc }, take: 400) { ${FIELDS} }
      requested: appointments(where: { status: { equals: "requested" } }, orderBy: { startsAt: asc }, take: 100) { ${FIELDS} }
    }`, { from, to, loc: location?.id ?? null });
  const byProvider = new Map<string, { name: string; rows: Appt[] }>();
  for (const a of data.appointments) {
    const key = a.provider?.id ?? 'none';
    const col = byProvider.get(key) ?? { name: a.provider?.displayName ?? 'Unassigned', rows: [] };
    col.rows.push(a);
    byProvider.set(key, col);
  }
  const href = (patch: Record<string, string>) => `/dashboard/platform/schedule?${new URLSearchParams({ date, location: location?.id ?? '', ...patch })}`;
  return (
    <Page title="Schedule">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs active={view} items={[{ key: 'day', label: 'Day sheet', href: href({ view: 'day' }) }, { key: 'requested', label: 'Requests', href: href({ view: 'requested' }), count: data.requested.length }]} />
        <Tabs active={location?.id ?? ''} items={meta.locations.map(l => ({ key: l.id, label: l.name, href: href({ location: l.id, view }) }))} />
      </div>
      {view === 'requested' ? (
        <Section title="Appointment requests waiting for the front desk">
          {data.requested.length ? data.requested.map(a => (
            <Row key={a.id}>
              <Summary a={a} tz={tz} day />
              <div className="flex flex-wrap gap-2">
                <ActionButton op="acceptAppointmentRequest" vars={{ appointmentId: a.id, expectedVersion: a.version }} paths={PATHS}>Accept</ActionButton>
                <ActionButton op="cancelAppointment" vars={{ appointmentId: a.id, expectedVersion: a.version }} ask="Why decline this request? (the client is told)" paths={PATHS}>Decline</ActionButton>
              </div>
            </Row>
          )) : <Empty>No requests waiting.</Empty>}
        </Section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link className="underline" href={href({ date: addDaysTo(date, -1) })}>← Previous</Link>
            <span className="font-medium">{when(`${date}T20:00:00Z`, tz, 'day')}</span>
            <Link className="underline" href={href({ date: addDaysTo(date, 1) })}>Next →</Link>
            <Link className="text-muted-foreground underline" href={href({ date: todayIn(tz) })}>Today</Link>
            <span className="text-muted-foreground">{data.appointments.length} appointments · {location?.name}</span>
          </div>
          {byProvider.size ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...byProvider.entries()].map(([id, col]) => (
                <section key={id} className="min-w-0 rounded-lg border">
                  <h2 className="border-b px-3 py-2 text-sm font-medium">{col.name} <span className="font-mono text-xs text-muted-foreground">{col.rows.length}</span></h2>
                  <div className="divide-y">
                    {col.rows.map(a => (
                      <div key={a.id} className="space-y-1 px-3 py-2 text-sm" style={{ borderLeft: `3px solid ${a.appointmentType?.colour || 'transparent'}` }}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-xs">{when(a.startsAt, tz, 'time')}–{when(a.endsAt, tz, 'time')}</span>
                          <Status value={a.status} />
                        </div>
                        <div className="flex flex-wrap gap-x-2">
                          {a.patients.map(p => p.patient ? <Link key={p.patient.id} className="font-medium hover:underline" href={`/dashboard/platform/patients/${p.patient.id}`}>{p.patient.name}</Link> : null)}
                          <span className="text-muted-foreground">{a.client?.displayName}</span>
                        </div>
                        <Meta>{a.appointmentType?.name} · {a.reservations.map(r => r.resource?.name).filter(Boolean).join(', ')}{a.channel === 'ai_voice' ? ' · AI' : ''}</Meta>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : <Empty>No appointments at {location?.name} on this day.</Empty>}
        </>
      )}
      {location ? (
        <Section title="Book an appointment">
          <BookPanel locationId={location.id} types={meta.appointmentTypes.map(t => ({ id: t.id, name: `${t.name} · ${t.durationMinutes} min${t.requestOnly ? ' · request' : ''}` }))} defaultDate={date} timeZone={tz} />
        </Section>
      ) : null}
    </Page>
  );
}

function Summary({ a, tz, day }: { a: Appt; tz: string; day?: boolean }) {
  return (
    <div className="min-w-0 flex-1 basis-64 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs">{when(a.startsAt, tz, day ? 'full' : 'time')}</span>
        {a.patients.map(p => p.patient ? <span key={p.patient.id} className="font-medium">{p.patient.name}</span> : null)}
        <span className="text-muted-foreground">{a.client?.displayName}</span>
      </div>
      <Meta>{a.ref} · {a.appointmentType?.name} · {a.provider?.displayName ?? 'unassigned'} · via {label(a.channel)}{a.reason && a.reason !== a.appointmentType?.name ? ` · ${a.reason}` : ''}</Meta>
    </div>
  );
}
