import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label, title, options, weight, calendarDay } from '../../lib/format';
import { ALERT_TONE, ageText, todayIn } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Stat, LoadError } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type P = {
  id: string; ref: string; name: string; kind: string; status: string; sex: string; reproductiveStatus: string; dateOfBirth: string | null; dobEstimated: boolean;
  colourMarkings: string; deceasedAt: string | null; codeStatus: string; groupSize: number | null; version: number;
  species: { name: string; defaultWeightUnit: string } | null; breed: { name: string; geneticFlags: unknown } | null; preferredDvm: { displayName: string } | null;
  ownerships: { role: string; effectiveFrom: string; effectiveTo: string | null; client: { id: string; ref: string; displayName: string } | null }[];
  alerts: { id: string; kind: string; severity: string; text: string; createdAt: string }[];
  weights: { id: string; value: string; unit: string; valueKg: string; method: string; bodyConditionScore: number | null; measuredAt: string }[];
  microchips: { number: string; standard: string; registry: string; active: boolean }[];
  vcprs: { id: string; scope: string; status: string; establishedAt: string; expiresAt: string; dvm: { displayName: string } | null; location: { name: string } | null }[];
  insurancePolicies: { policyNumber: string; plan: string; insurer: { name: string } | null }[];
};
type Extra = {
  encounters: { id: string; ref: string; kind: string; status: string; reason: string; startedAt: string; attendingDvm: { displayName: string } | null; diagnoses: { term: string }[] }[];
  problems: { id: string; term: string; status: string; chronic: boolean }[];
  patientReminders: { id: string; dueOn: string; status: string; type: { name: string } | null }[];
};

const SEVERITY_TONE: Record<string, string> = { block: ALERT_TONE.critical, warn: ALERT_TONE.warning, info: ALERT_TONE.info };

/**
 * The patient chart header (BUILD-PLAN P1): alerts on every header, the VCPR in force (a lapsed one
 * says so: prescribing needs a new exam), weight history, microchip and owners. Reading it writes a
 * ReadAudit row (PHI-grade). Phase 2 adds the problem list, the visit timeline and reminders due.
 */
export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, tz] = await Promise.all([
    q<Extra & { patient: P | null; appointments: { id: string; ref: string; startsAt: string; status: string; appointmentType: { name: string } | null }[] }>(`
      query P($id: ID!) {
        patient(where: { id: $id }) {
          id ref name kind status sex reproductiveStatus dateOfBirth dobEstimated colourMarkings deceasedAt codeStatus groupSize version
          species { name defaultWeightUnit } breed { name geneticFlags } preferredDvm { displayName }
          ownerships(orderBy: { effectiveFrom: desc }, take: 20) { role effectiveFrom effectiveTo client { id ref displayName } }
          alerts(where: { active: { equals: true } }, orderBy: { createdAt: desc }, take: 50) { id kind severity text createdAt }
          weights(orderBy: { measuredAt: desc }, take: 12) { id value unit valueKg method bodyConditionScore measuredAt }
          microchips(take: 10) { number standard registry active }
          vcprs(orderBy: { expiresAt: desc }, take: 5) { id scope status establishedAt expiresAt dvm { displayName } location { name } }
          insurancePolicies(take: 10) { policyNumber plan insurer { name } }
        }
        encounters(where: { patient: { id: { equals: $id } } }, orderBy: { startedAt: desc }, take: 30) { id ref kind status reason startedAt attendingDvm { displayName } diagnoses(take: 5) { term } }
        problems(where: { patient: { id: { equals: $id } }, status: { equals: "active" } }, take: 100) { id term status chronic }
        patientReminders(where: { patient: { id: { equals: $id } }, status: { in: ["scheduled", "due", "overdue"] } }, orderBy: { dueOn: asc }, take: 10) { id dueOn status type { name } }
        appointments(where: { patients: { some: { patient: { id: { equals: $id } } } } }, orderBy: { startsAt: desc }, take: 12) { id ref startsAt status appointmentType { name } }
      }`, { id }).then(d => ({ ok: true as const, d }), (error: unknown) => ({ ok: false as const, error })),
    practiceTimeZone(),
  ]);
  // Review r6 #1: a failed read shows its error; only a patient that is not there (or not visible) is a 404.
  if (!res.ok) return <LoadError title="Patient" error={res.error} />;
  const data = res.d;
  const p = data.patient;
  if (!p) notFound();
  const today = todayIn(tz);
  const now = new Date().toISOString();
  const vcpr = p.vcprs.find(v => v.status === 'active' && v.expiresAt > now);
  const lastVcpr = p.vcprs[0];
  const owners = p.ownerships.filter(o => !o.effectiveTo);
  const latest = p.weights[0];
  const chip = p.microchips.find(m => m.active);
  const unit = p.species?.defaultWeightUnit ?? 'kg';
  return (
    <Page title={p.name} crumbs={[{ label: 'Clients', href: '/dashboard/platform/clients' }, ...(owners[0]?.client ? [{ label: owners[0].client.displayName, href: `/dashboard/platform/clients/${owners[0].client.id}` }] : [])]}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm">{p.ref}</span><Status value={p.status} />
          <Meta>{p.species?.name} · {p.breed?.name ?? 'breed not recorded'} · {label(p.sex)} {label(p.reproductiveStatus)} · {p.dateOfBirth ? `${ageText(p.dateOfBirth, today)}${p.dobEstimated ? ' (est.)' : ''} · born ${calendarDay(p.dateOfBirth)}` : 'age unknown'}{p.colourMarkings ? ` · ${p.colourMarkings}` : ''}{p.kind === 'group' ? ` · group of ${p.groupSize}` : ''}</Meta>
        </div>
        {p.status === 'deceased' ? <p className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.info}`}>Died {p.deceasedAt ? when(p.deceasedAt, tz, 'day') : ''}. Reminders and marketing to this household about {p.name} are suppressed.</p> : null}
        {p.alerts.map(a => (
          <p key={a.id} className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_TONE[a.severity] ?? ALERT_TONE.info}`}><span className="font-medium">{title(a.kind)}</span> · {a.text}</p>
        ))}
        <div className={`rounded-md border px-3 py-2 text-sm ${vcpr ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : ALERT_TONE.critical}`}>
          {vcpr
            ? <>VCPR in force ({label(vcpr.scope)}) · {vcpr.dvm?.displayName ?? vcpr.location?.name} · {when(vcpr.establishedAt, tz, 'date')} to {when(vcpr.expiresAt, tz, 'date')}</>
            : lastVcpr
              ? <>VCPR lapsed {when(lastVcpr.expiresAt, tz, 'date')}. An exam is needed before prescribing or refills.</>
              : <>No VCPR on file. An exam is needed before prescribing.</>}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Weight" value={latest ? `${weight(latest.value, latest.unit)}` : '—'} />
        <Stat name="Body condition" value={latest?.bodyConditionScore ? `${latest.bodyConditionScore}/9` : '—'} />
        <Stat name="Microchip" value={chip ? <span className="font-mono text-sm">{chip.number}</span> : 'none'} />
        <Stat name="Preferred DVM" value={p.preferredDvm?.displayName ?? '—'} />
      </div>
      <Section title="Problems">
        {data.problems.length ? data.problems.map(pr => <Row key={pr.id}><span>{pr.term}</span><Meta>{pr.chronic ? 'chronic' : 'active'}</Meta></Row>) : <Empty>No active problems.</Empty>}
      </Section>
      <Section title="Visit records" aside={<Link className="text-xs underline" href={`/dashboard/platform/vaccines?patient=${p.id}`}>Vaccines and reminders</Link>}>
        {data.encounters.length ? data.encounters.map(e => (
          <Row key={e.id} href={`/dashboard/platform/encounters/${e.id}`}>
            <div className="min-w-0 flex-1"><span className="font-mono text-xs">{e.ref}</span> {title(e.kind)}{e.reason ? ` · ${e.reason}` : ''}<Meta>{when(e.startedAt, tz, 'day')} · {e.attendingDvm?.displayName ?? 'no attending vet'}{e.diagnoses.length ? ` · ${e.diagnoses.map(d => d.term).join(', ')}` : ''}</Meta></div>
            <Status value={e.status} />
          </Row>
        )) : <Empty>No visit records yet.</Empty>}
      </Section>
      {data.patientReminders.length ? (
        <Section title="Reminders due">
          {data.patientReminders.map(r => <Row key={r.id}><span>{r.type?.name}</span><Meta>{calendarDay(r.dueOn)} · {label(r.status)}</Meta></Row>)}
        </Section>
      ) : null}
      <Section title="Owners">
        {owners.map(o => o.client ? (
          <Row key={o.client.id} href={`/dashboard/platform/clients/${o.client.id}`}><span>{o.client.displayName}</span><Meta>{o.client.ref} · {label(o.role)} since {when(o.effectiveFrom, tz, 'day')}</Meta></Row>
        ) : null)}
      </Section>
      <Section title="Weight history">
        {p.weights.length ? p.weights.map(w => (
          <Row key={w.id}><span className="font-mono">{weight(w.value, w.unit)}</span><Meta>{w.unit !== 'kg' ? `${weight(w.valueKg, 'kg')} · ` : ''}{label(w.method)}{w.bodyConditionScore ? ` · BCS ${w.bodyConditionScore}/9` : ''} · {when(w.measuredAt, tz, 'dayTime')}</Meta></Row>
        )) : <Empty>No weights yet.</Empty>}
        {p.status === 'active' ? (
          <CommandForm op="recordWeight" build="recordWeight" submit="Record weight" fixed={{ patientId: p.id }} paths={[`/dashboard/platform/patients/${p.id}`]}
            fields={[{ name: 'value', label: 'Weight', width: 'sm', placeholder: '4.2' }, { name: 'unit', label: 'Unit', width: 'sm', defaultValue: unit, options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }, { value: 'g', label: 'g' }] }]} />
        ) : null}
      </Section>
      <Section title="Appointments">
        {data.appointments.length ? data.appointments.map(a => (
          <Row key={a.id}><div className="min-w-0 flex-1"><span className="font-mono text-xs">{a.ref}</span> {when(a.startsAt, tz)} <Meta>· {a.appointmentType?.name}</Meta></div><Status value={a.status} /></Row>
        )) : <Empty>No appointments.</Empty>}
      </Section>
      {p.status !== 'deceased' ? (
        <Section title="Add an alert">
          <CommandForm op="addPatientAlert" build="addPatientAlert" submit="Add alert" fixed={{ patientId: p.id }} paths={[`/dashboard/platform/patients/${p.id}`]}
            fields={[
              { name: 'kind', label: 'Kind', options: options(['behaviour_caution', 'allergy', 'drug_sensitivity', 'medical', 'genetic', 'handling', 'financial']) },
              { name: 'severity', label: 'Severity', width: 'sm', options: [{ value: 'warn', label: 'Warning' }, { value: 'block', label: 'Blocking (stop and check)' }, { value: 'info', label: 'Information' }] },
              { name: 'text', label: 'Alert', width: 'lg' },
            ]} />
        </Section>
      ) : null}
      <p className="text-xs text-muted-foreground">Opening this chart is recorded in the <Link href="/dashboard/platform/read-audit" className="underline">read audit</Link>.</p>
    </Page>
  );
}
