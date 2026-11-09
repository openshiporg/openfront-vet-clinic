import Link from 'next/link';
import { q, practiceTimeZone, defaultLocation } from '../../lib/server';
import { when, title, label, calendarDay } from '../../lib/format';
import { ALERT_TONE } from '../../lib/clinic';
import { CODE_STATUS } from '../../lib/clinical';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Stay = {
  id: string; ref: string; status: string; codeStatus: string; reason: string; admittedAt: string; version: number;
  patient: { id: string; name: string; species: { name: string } | null; alerts: { severity: string; text: string }[] } | null;
  cage: { id: string; code: string; ward: { name: string } | null } | null; attendingDvm: { displayName: string } | null; encounter: { id: string; ref: string } | null;
};
type Task = {
  id: string; dueAt: string; status: string; version: number; doneAt: string | null; observation: string; skipReason: string;
  doneBy: { displayName: string } | null;
  sheetOrder: { id: string; frequency: string; instructions: string; order: { id: string; ref: string; description: string; drug: { id: string; csSchedule: string } | null } | null } | null;
};

/** "9a", "12p": compact hour headings for the sheet, in the practice's zone. */
const hourLabel = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: true }).format(d).replace(' AM', 'a').replace(' PM', 'p');

/** Ward kinds in plain words; left out when the ward's name already says it ("ICU · ICU"). */
const WARD_KIND: Record<string, string> = { general: 'General', icu: 'ICU', isolation: 'Isolation', surgery_recovery: 'Surgery recovery', exotics: 'Exotics' };
const wardKind = (w: { name: string; kind: string }) => {
  const k = WARD_KIND[w.kind] ?? title(w.kind);
  return k && !w.name.toLowerCase().includes(k.toLowerCase()) ? k : '';
};
const CODE_TONE: Record<string, string> = { dnr: 'text-red-700 dark:text-red-300', closed_chest_only: 'text-amber-700 dark:text-amber-300', full: 'text-muted-foreground' };

/**
 * The hospital (BUILD-PLAN P2): wards and cages with who is in them and their resuscitation code,
 * and for one stay the treatment sheet as an hourly grid. Tasks are materialised by the clinical
 * job; a medication task records the administration (with lot or controlled container) when done.
 */
export default async function HospitalPage({ searchParams }: { searchParams?: Promise<{ location?: string; stay?: string }> }) {
  const sp = (await searchParams) ?? {};
  const base = await q<{ locations: { id: string; name: string; kind: string | null }[] }>(`{ locations(where: { active: { equals: true } }, orderBy: { code: asc }, take: 50) { id name kind } }`);
  const location = await defaultLocation(base.locations, sp.location);
  const locId = location?.id ?? '';
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 3_600_000);
  const to = new Date(now.getTime() + 24 * 3_600_000);
  const [data, tz] = await Promise.all([
    q<{ wards: { id: string; name: string; kind: string; cages: { id: string; code: string; size: string }[] }[]; hospitalStays: Stay[]; witnesses: { id: string; displayName: string }[]; staffMembers: { id: string; displayName: string }[]; inventoryLots: { id: string; lotNumber: string; expiresOn: string; drug: { id: string } | null }[]; csContainers: { id: string; ref: string; product: { id: string } | null }[]; encounters: { id: string; ref: string; patient: { name: string } | null }[] }>(`
      query H($loc: ID!) {
        wards(where: { location: { id: { equals: $loc } } }, orderBy: { name: asc }, take: 20) { id name kind cages(where: { active: { equals: true } }, orderBy: { code: asc }, take: 60) { id code size } }
        hospitalStays(where: { location: { id: { equals: $loc } }, status: { in: ["admitted", "in_care", "ready_for_discharge"] } }, orderBy: { admittedAt: asc }, take: 100) {
          id ref status codeStatus reason admittedAt version patient { id name species { name } alerts(where: { active: { equals: true } }, take: 10) { severity text } }
          cage { id code ward { name } } attendingDvm { displayName } encounter { id ref } }
        witnesses: staffMembers(where: { active: { equals: true }, kind: { in: ["dvm", "rvt"] } }, orderBy: { displayName: asc }, take: 100) { id displayName }
        staffMembers(where: { active: { equals: true }, kind: { in: ["dvm", "rvt", "assistant"] } }, orderBy: { displayName: asc }, take: 100) { id displayName }
        inventoryLots(where: { status: { equals: "available" }, location: { id: { equals: $loc } }, NOT: { drug: null } }, orderBy: { expiresOn: asc }, take: 300) { id lotNumber expiresOn drug { id } }
        csContainers(where: { status: { equals: "open" }, location: { id: { equals: $loc } } }, orderBy: { ref: asc }, take: 100) { id ref product { id } }
        encounters(where: { location: { id: { equals: $loc } }, status: { in: ["open", "in_progress"] }, stay: null }, orderBy: { startedAt: desc }, take: 50) { id ref patient { name } }
      }`, { loc: locId }),
    practiceTimeZone(),
  ]);
  const stays = data.hospitalStays;
  const stay = stays.find(s => s.id === sp.stay) ?? stays[0];
  const occupied = new Map(stays.map(s => [s.cage?.id, s]));
  const free = data.wards.flatMap(w => w.cages.filter(c => !occupied.has(c.id)).map(c => ({ value: c.id, label: `${c.code} · ${w.name} · ${label(c.size)}` })));
  const TASK = 'id dueAt status version doneAt observation skipReason doneBy { displayName } sheetOrder { id frequency instructions order { id ref description drug { id csSchedule } } }';
  const sheet = stay ? await q<{ treatmentTasks: Task[]; missed: Task[] }>(`
      query T($stay: ID!, $from: DateTime!, $to: DateTime!, $since: DateTime!) {
        treatmentTasks(where: { stay: { id: { equals: $stay } }, dueAt: { gte: $from, lt: $to } }, orderBy: { dueAt: asc }, take: 300) { ${TASK} }
        missed: treatmentTasks(where: { stay: { id: { equals: $stay } }, status: { equals: "missed" }, dueAt: { gte: $since } }, orderBy: { dueAt: desc }, take: 100) { ${TASK} }
      }`, { stay: stay.id, from: from.toISOString(), to: to.toISOString(), since: new Date(now.getTime() - 24 * 3_600_000).toISOString() }) : null;
  const tasks = sheet?.treatmentTasks ?? [];
  // Missed doses fall off the left of the grid soon after; they stay listed here for a day.
  const missed = sheet?.missed ?? [];
  const hours = Array.from({ length: 26 }, (_, i) => new Date(Math.floor(from.getTime() / 3_600_000) * 3_600_000 + i * 3_600_000));
  const rows = new Map<string, { label: string; frequency: string; tasks: Task[] }>();
  for (const t of tasks) {
    const key = t.sheetOrder?.id ?? 'other';
    if (!rows.has(key)) rows.set(key, { label: t.sheetOrder?.order?.description ?? 'Task', frequency: t.sheetOrder?.frequency ?? '', tasks: [] });
    rows.get(key)!.tasks.push(t);
  }
  const path = '/dashboard/platform/hospital';
  const dueNow = tasks.filter(t => ['scheduled', 'due', 'overdue'].includes(t.status) && Date.parse(t.dueAt) <= now.getTime() + 3_600_000);
  return (
    <Page title="Hospital">
      {base.locations.length > 1 ? <Tabs items={base.locations.map(l => ({ key: l.id, label: l.name, href: `${path}?location=${l.id}` }))} active={locId} /> : null}
      <Section title={`In hospital · ${stays.length}`}>
        {stays.length ? stays.map(s => (
          <Row key={s.id} href={`${path}?location=${locId}&stay=${s.id}`} className={s.id === stay?.id ? 'bg-muted/40' : undefined}>
            <div className="min-w-0 flex-1">
              <span className="font-mono text-xs">{s.cage?.code}</span> <span className="font-medium">{s.patient?.name}</span> <span className="text-muted-foreground">{s.patient?.species?.name}</span>
              <Meta>{s.cage?.ward?.name} · {s.reason || 'no reason recorded'} · {s.attendingDvm?.displayName ?? 'no attending vet'} · in since {when(s.admittedAt, tz, 'dayTime')}</Meta>
            </div>
            <span className={`text-xs font-medium ${CODE_TONE[s.codeStatus] ?? ''}`}>{title(s.codeStatus)}</span>
          </Row>
        )) : <Empty>No patients in hospital.</Empty>}
      </Section>

      {stay ? (
        <Section title={`Treatment sheet · ${stay.patient?.name} · ${stay.ref}`} aside={stay.encounter ? <Link className="text-xs underline" href={`/dashboard/platform/encounters/${stay.encounter.id}`}>Record {stay.encounter.ref}</Link> : null}>
          {stay.patient?.alerts.map((a, i) => <p key={i} className={`rounded-md border px-3 py-2 text-sm ${a.severity === 'block' ? ALERT_TONE.critical : ALERT_TONE.warning}`}>{a.text}</p>)}
          {rows.size ? (
            <>
            <ul className="divide-y rounded-md border md:hidden">
              {[...rows.entries()].map(([key, r]) => {
                const inWindow = r.tasks.filter(x => { const d = Date.parse(x.dueAt); return d >= hours[0].getTime() && d < hours[hours.length - 1].getTime() + 3_600_000; }).sort((x, y) => Date.parse(x.dueAt) - Date.parse(y.dueAt));
                return (
                  <li key={key} className="space-y-1 px-3 py-2 text-xs">
                    <p className="break-words font-medium">{r.label}</p>
                    <p className="text-muted-foreground">{title(r.frequency)}</p>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                      {inWindow.length ? inWindow.map(t => {
                        const mark = t.status === 'done' ? '✓' : t.status === 'skipped' ? '—' : t.status === 'missed' ? '✕' : t.status === 'overdue' ? '!' : '○';
                        const tone = t.status === 'done' ? 'text-emerald-700' : t.status === 'overdue' || t.status === 'missed' ? 'text-red-700' : t.status === 'skipped' ? 'text-muted-foreground' : 'text-amber-700';
                        return <span key={t.id} className={tone}>{mark} {hourLabel(new Date(t.dueAt), tz)}</span>;
                      }) : <span className="font-sans text-muted-foreground">Nothing in the next 24 hours.</span>}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="hidden max-w-full overflow-x-auto rounded-md border md:block">
              <table className="min-w-max border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-48 border-b bg-background px-2 py-1.5 text-left font-medium">Order</th>
                    {hours.map(h => <th key={h.toISOString()} className={`border-b border-l px-1.5 py-1.5 text-center font-mono font-normal ${Math.abs(h.getTime() - now.getTime()) < 3_600_000 && h <= now ? 'bg-amber-50 dark:bg-amber-950' : ''}`}>{hourLabel(h, tz)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...rows.entries()].map(([key, r]) => (
                    <tr key={key}>
                      <td className="sticky left-0 z-10 max-w-64 border-b bg-background px-2 py-1.5 align-top"><div className="break-words">{r.label}</div><div className="text-muted-foreground">{title(r.frequency)}</div></td>
                      {hours.map(h => {
                        const t = r.tasks.find(x => { const d = Date.parse(x.dueAt); return d >= h.getTime() && d < h.getTime() + 3_600_000; });
                        const mark = !t ? '' : t.status === 'done' ? '✓' : t.status === 'skipped' ? '—' : t.status === 'missed' ? '✕' : t.status === 'overdue' ? '!' : '○';
                        const tone = !t ? '' : t.status === 'done' ? 'text-emerald-700' : t.status === 'overdue' || t.status === 'missed' ? 'bg-red-50 text-red-700 dark:bg-red-950' : t.status === 'skipped' ? 'text-muted-foreground' : 'text-amber-700';
                        return <td key={h.toISOString()} title={t ? `${title(t.status)}${t.doneBy ? ` · ${t.doneBy.displayName}` : ''}${t.observation ? ` · ${t.observation}` : ''}` : undefined} className={`border-b border-l px-1.5 py-1.5 text-center ${tone}`}>{mark}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : <Empty>No treatments scheduled for the next 24 hours. Order from the visit record with a sheet frequency.</Empty>}
          <p className="text-xs text-muted-foreground">○ due · ✓ done · ! overdue · ✕ missed · — skipped</p>

          {missed.length ? (
            <div className="space-y-1">
              <h3 className="pt-2 text-sm font-medium text-red-700 dark:text-red-300">Missed in the last 24 hours</h3>
              {missed.map(t => <Row key={t.id}><span className="text-sm">✕ {t.sheetOrder?.order?.description}</span><Meta>was due {when(t.dueAt, tz)} · {t.sheetOrder?.order?.ref} · not given; reschedule or record the reason in the visit record</Meta></Row>)}
            </div>
          ) : null}
          <h3 className="pt-2 text-sm font-medium">Due now</h3>
          {dueNow.length ? dueNow.map(t => {
            const drug = t.sheetOrder?.order?.drug;
            const cs = drug && drug.csSchedule !== 'none';
            return (
              <div key={t.id} className="space-y-2 border-b py-2 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{t.sheetOrder?.order?.description}</span><Meta>due {when(t.dueAt, tz, 'time')} · {label(t.status)}</Meta></div>
                <CommandForm op="completeTreatmentTask" build="completeTreatmentTask" submit="Done" fixed={{ taskId: t.id, expectedVersion: String(t.version) }} paths={[path]}
                  fields={[
                    ...(drug && !cs ? [{ name: 'lotId', label: 'Lot', width: 'lg' as const, options: data.inventoryLots.filter(l => l.drug?.id === drug.id && l.expiresOn.slice(0, 10) >= now.toISOString().slice(0, 10)).map(l => ({ value: l.id, label: `${l.lotNumber} · expires ${calendarDay(l.expiresOn)}` })) }] : []),
                    ...(cs ? [
                      { name: 'csContainerId', label: 'Controlled container', width: 'lg' as const, options: data.csContainers.filter(c => c.product?.id === drug!.id).map(c => ({ value: c.id, label: c.ref })) },
                      { name: 'witnessId', label: 'Witness', width: 'lg' as const, options: [{ value: '', label: 'No witness' }, ...data.witnesses.map(s => ({ value: s.id, label: s.displayName }))] },
                      { name: 'wasteQty', label: 'Wasted (mL)', width: 'sm' as const },
                    ] : []),
                    ...(drug ? [
                      { name: 'qty', label: 'Amount given', width: 'md' as const, placeholder: 'as ordered' },
                      { name: 'qtyOverrideReason', label: 'Reason if not the ordered amount (veterinarian)', width: 'lg' as const },
                    ] : []),
                    { name: 'observation', label: 'Observation', width: 'lg' as const, placeholder: 'Ate half, BAR' },
                    ...(Date.parse(t.dueAt) > now.getTime() ? [{ name: 'earlyReason', label: 'Reason if early (veterinarian)', width: 'lg' as const }] : []),
                  ]} />
                <ActionButton op="skipTreatmentTask" vars={{ taskId: t.id, expectedVersion: t.version }} paths={[path]} ask="Why is this treatment skipped?">Skip</ActionButton>
              </div>
            );
          }) : <Empty>Nothing due in the next hour.</Empty>}

          <h3 className="pt-2 text-sm font-medium">Move or discharge</h3>
          <CommandForm op="moveCage" build="moveCage" submit="Move" fixed={{ stayId: stay.id }} paths={[path]} fields={[{ name: 'cageId', label: 'To cage', width: 'lg' as const, options: free }]} />
          <CommandForm op="dischargePatient" build="dischargePatient" submit="Discharge" fixed={{ stayId: stay.id, expectedVersion: String(stay.version) }} paths={[path]}
            fields={[{ name: 'instructions', label: 'Discharge instructions for the client', width: 'full', multiline: 4 }, { name: 'recheckOn', label: 'Recheck (YYYY-MM-DD)', placeholder: '2026-11-22' }]} />
        </Section>
      ) : null}

      <Section title="Wards">
        {data.wards.map(w => (
          <div key={w.id} className="space-y-2 border-b pb-3 last:border-b-0">
            <h3 className="text-sm font-medium">{w.name}{wardKind(w) ? <span className="font-normal text-muted-foreground"> · {wardKind(w)}</span> : null}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {w.cages.map(c => {
                const s = occupied.get(c.id);
                return (
                  <div key={c.id} className={`min-w-0 rounded-md border px-2 py-1.5 text-xs ${s ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950' : ''}`}>
                    <div className="font-mono">{c.code}</div>
                    <div className="break-words text-muted-foreground">{s ? s.patient?.name : `empty · ${label(c.size)}`}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {data.encounters.length && free.length ? (
          <CommandForm op="admitPatient" build="admitPatient" submit="Admit" paths={[path]}
            fields={[
              { name: 'encounterId', label: 'From visit record', width: 'lg', options: data.encounters.map(e => ({ value: e.id, label: `${e.patient?.name} · ${e.ref}` })) },
              { name: 'cageId', label: 'Cage', width: 'lg' as const, options: free },
              { name: 'codeStatus', label: 'Resuscitation', width: 'lg' as const, options: CODE_STATUS.map(c => ({ value: c, label: title(c) })) },
              { name: 'reason', label: 'Reason', width: 'lg' },
            ]} />
        ) : null}
      </Section>
    </Page>
  );
}
