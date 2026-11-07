import Link from 'next/link';
import { q, practiceTimeZone, defaultLocation } from '../../lib/server';
import { when } from '../../lib/format';
import { Page, Empty, Meta, Tabs } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';

type Entry = {
  id: string; status: string; version: number; since: string; flags: Record<string, unknown> | null;
  location: { id: string; name: string } | null; room: { name: string } | null; assignedDvm: { displayName: string } | null; assignedTech: { displayName: string } | null;
  patient: { id: string; name: string; species: { name: string } | null; alerts: { severity: string; text: string }[] } | null;
  appointment: { ref: string; appointmentType: { name: string } | null; client: { displayName: string } | null } | null;
};

/** Board columns in the order a patient moves (STATE-MACHINES §4); moves are checked by the server. */
const COLUMNS = ['waiting', 'in_exam', 'diagnostics', 'treatment', 'surgery', 'recovery', 'hospitalised', 'boarding', 'ready_for_discharge'] as const;
const NEXT: Record<string, string[]> = {
  waiting: ['in_exam', 'treatment'], in_exam: ['diagnostics', 'treatment', 'ready_for_discharge'], diagnostics: ['in_exam', 'treatment', 'ready_for_discharge'],
  treatment: ['in_exam', 'hospitalised', 'ready_for_discharge'], surgery: ['recovery'], recovery: ['hospitalised', 'ready_for_discharge'],
  hospitalised: ['treatment', 'ready_for_discharge'], boarding: ['ready_for_discharge'], ready_for_discharge: ['discharged'],
};
const TITLE: Record<string, string> = { waiting: 'Waiting', in_exam: 'In exam', diagnostics: 'Diagnostics', treatment: 'Treatment', surgery: 'Surgery', recovery: 'Recovery', hospitalised: 'Hospitalised', boarding: 'Boarding', ready_for_discharge: 'Ready to go', discharged: 'Discharge' };

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** Live patient flow (BUILD-PLAN §2 Front desk): who is where, with whom, for how long, and their alerts. */
export default async function WhiteboardPage({ searchParams }: { searchParams?: Promise<{ location?: string }> }) {
  const sp = (await searchParams) ?? {};
  const [data, tz] = await Promise.all([
    q<{ whiteboardEntries: Entry[]; locations: { id: string; name: string; kind: string | null }[] }>(`{
      locations(where: { active: { equals: true } }, orderBy: { code: asc }) { id name kind }
      whiteboardEntries(where: { status: { notIn: ["discharged"] } }, orderBy: { since: asc }, take: 300) {
        id status version since flags location { id name } room { name } assignedDvm { displayName } assignedTech { displayName }
        patient { id name species { name } alerts(where: { active: { equals: true } }) { severity text } }
        appointment { ref appointmentType { name } client { displayName } }
      }
    }`),
    practiceTimeZone(),
  ]);
  const location = await defaultLocation(data.locations, sp.location);
  const entries = data.whiteboardEntries.filter(e => !location || e.location?.id === location.id);
  const shown = COLUMNS.filter(c => ['waiting', 'in_exam', 'treatment', 'ready_for_discharge'].includes(c) || entries.some(e => e.status === c));
  return (
    <Page title="Whiteboard">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs active={location?.id ?? ''} items={data.locations.map(l => ({ key: l.id, label: l.name, href: `/dashboard/platform/whiteboard?location=${l.id}`, count: data.whiteboardEntries.filter(e => e.location?.id === l.id).length }))} />
        <span className="text-xs text-muted-foreground">Updated {when(new Date().toISOString(), tz, 'time')}</span>
      </div>
      {entries.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map(col => {
            const cards = entries.filter(e => e.status === col);
            return (
              <section key={col} className="min-w-0 rounded-lg border bg-muted/30">
                <h2 className="flex items-center justify-between border-b px-3 py-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">{TITLE[col]}<span>{cards.length}</span></h2>
                <div className="space-y-2 p-2">
                  {cards.length ? cards.map(e => (
                    <article key={e.id} className="space-y-1.5 rounded-md border bg-background p-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        {e.patient ? <Link className="font-medium hover:underline" href={`/dashboard/platform/patients/${e.patient.id}`}>{e.patient.name}</Link> : <span>—</span>}
                        <span className={minutesSince(e.since) > 30 && col === 'waiting' ? 'font-mono text-xs text-red-600' : 'font-mono text-xs text-muted-foreground'}>{minutesSince(e.since)} min</span>
                      </div>
                      <Meta>{e.patient?.species?.name} · {e.appointment?.client?.displayName} · {e.appointment?.appointmentType?.name}</Meta>
                      <Meta>{[e.room?.name, e.assignedDvm?.displayName, e.assignedTech?.displayName].filter(Boolean).join(' · ') || 'No room yet'}</Meta>
                      {e.patient?.alerts.length ? <p className="text-xs text-red-700 dark:text-red-400">⚠ {e.patient.alerts.map(a => a.text).join(' · ')}</p> : null}
                      <div className="flex flex-wrap gap-1">
                        {(NEXT[col] ?? []).map(to => (
                          <ActionButton key={to} className="h-7 px-2 text-xs" op="moveWhiteboardEntry" vars={{ entryId: e.id, to, expectedVersion: e.version }} paths={['/dashboard/platform/whiteboard', '/dashboard/platform/today']}>→ {TITLE[to]}</ActionButton>
                        ))}
                      </div>
                    </article>
                  )) : <p className="px-1 py-3 text-xs text-muted-foreground">Empty</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : <Empty>No patients on the board at {location?.name}. Checking in an appointment puts the patient in Waiting.</Empty>}
    </Page>
  );
}
