import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay, label } from '../../lib/format';
import { ALERT_TONE, todayIn, addDaysTo } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Reminder = { id: string; dueOn: string; status: string; source: string; suppressedReason: string; lastNotifiedAt: string | null; version: number; patient: { id: string; name: string; species: { name: string } | null } | null; type: { name: string } | null };
type Vaccine = { id: string; administeredOn: string; lotNumber: string; site: string; route: string; doseSeries: string; dueNextOn: string | null; durationMonths: number | null; source: string; product: { name: string } | null; vaccinatedBy: { displayName: string } | null; certificate: { id: string; ref: string } | null; patient: { id: string; name: string } | null };

const VIEWS = {
  due: { label: 'Due in 30 days', status: ['scheduled', 'due'] },
  overdue: { label: 'Overdue', status: ['overdue'] },
  all: { label: 'All reminders', status: ['scheduled', 'due', 'overdue', 'satisfied', 'suppressed', 'lapsed'] },
} as const;

/**
 * Vaccines and reminders (BUILD-PLAN P2). Staff press Refresh to move reminders from scheduled to due to
 * overdue (nothing is sent); a vaccine given
 * satisfies the matching reminder and opens the next one from the protocol.
 */
export default async function VaccinesPage({ searchParams }: { searchParams?: Promise<{ view?: string; patient?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = (sp.view && sp.view in VIEWS ? sp.view : 'due') as keyof typeof VIEWS;
  const tz = await practiceTimeZone();
  const today = todayIn(tz);
  const until = view === 'due' ? addDaysTo(today, 30) : addDaysTo(today, 3650);
  const patientFilter = sp.patient ? { patient: { id: { equals: sp.patient } } } : {};
  const data = await q<{ patientReminders: Reminder[]; vaccineAdministrations: Vaccine[]; overdue: number; patient: { id: string; name: string } | null; reminderTypes: { id: string; name: string }[]; vaccineProducts: { id: string; name: string }[]; patients: { id: string; name: string; ref: string }[] }>(`
    query V($r: PatientReminderWhereInput!, $v: VaccineAdministrationWhereInput!, $pid: ID) {
      patientReminders(where: $r, orderBy: { dueOn: asc }, take: 200) { id dueOn status source suppressedReason lastNotifiedAt version patient { id name species { name } } type { name } }
      vaccineAdministrations(where: $v, orderBy: { administeredOn: desc }, take: 100) { id administeredOn lotNumber site route doseSeries dueNextOn durationMonths source product { name } vaccinatedBy { displayName } certificate { id ref } patient { id name } }
      overdue: patientRemindersCount(where: { status: { equals: "overdue" } })
      patient(where: { id: $pid }) { id name }
      reminderTypes(where: { active: { equals: true } }, orderBy: { name: asc }) { id name }
      vaccineProducts(where: { active: { equals: true } }, orderBy: { name: asc }) { id name }
      patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 400) { id name ref }
    }`, {
    r: { ...patientFilter, status: { in: VIEWS[view].status }, ...(view === 'all' || sp.patient ? {} : { dueOn: { lte: until } }) },
    v: patientFilter,
    pid: sp.patient ?? '__none__',
  });
  const qs = sp.patient ? `&patient=${sp.patient}` : '';
  const path = '/dashboard/platform/vaccines';
  return (
    <Page title={data.patient ? `Vaccines · ${data.patient.name}` : 'Vaccines and reminders'} crumbs={data.patient ? [{ label: 'Vaccines', href: path }] : []}>
      <Tabs items={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map(k => ({ key: k, label: VIEWS[k].label, href: `${path}?view=${k}${qs}`, count: k === 'overdue' ? data.overdue : undefined }))} active={view} />
      <div><ActionButton op="refreshClinicalClocks" vars={{}} paths={[path]}>Refresh due and overdue</ActionButton></div>
      <Section title={VIEWS[view].label}>
        {data.patientReminders.length ? data.patientReminders.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1">
              <Link href={`${path}?patient=${r.patient?.id}`} className="font-medium hover:underline">{r.patient?.name}</Link> <span className="text-muted-foreground">{r.patient?.species?.name}</span> · {r.type?.name}
              <Meta>due {calendarDay(r.dueOn)}{r.source !== 'protocol' ? ` · ${label(r.source)}` : ''}{r.suppressedReason ? ` · ${r.suppressedReason}` : ''}</Meta>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Status value={r.status} />
              {['scheduled', 'due', 'overdue'].includes(r.status) ? <ActionButton op="suppressReminder" vars={{ reminderId: r.id, expectedVersion: r.version }} paths={[path]} ask="Why stop this reminder? (e.g. moved away, medical exemption)">Stop</ActionButton> : null}
            </div>
          </Row>
        )) : <Empty>No reminders here.</Empty>}
      </Section>

      <Section title={data.patient ? 'Vaccine history' : 'Recent vaccines'}>
        {data.vaccineAdministrations.length ? data.vaccineAdministrations.map(v => (
          <Row key={v.id}>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{v.product?.name}</span>{!data.patient ? <> · <Link href={`${path}?patient=${v.patient?.id}`} className="hover:underline">{v.patient?.name}</Link></> : null}
              <Meta>given {calendarDay(v.administeredOn)}{v.lotNumber ? ` · lot ${v.lotNumber}` : ''}{v.site ? ` · ${v.site}` : ''}{v.vaccinatedBy ? ` · ${v.vaccinatedBy.displayName}` : ''}{v.source !== 'administered' ? ` · ${label(v.source)}` : ''}{v.dueNextOn ? ` · next due ${calendarDay(v.dueNextOn)}` : ''}</Meta>
            </div>
            {v.certificate ? <Link className="text-xs underline" href={`/dashboard/platform/vaccines/certificates/${v.certificate.id}`}>Rabies certificate {v.certificate.ref}</Link> : null}
          </Row>
        )) : <Empty>No vaccines recorded.</Empty>}
      </Section>

      <Section title="Record a vaccine given elsewhere">
        <p className="text-xs text-muted-foreground">A vaccine from another clinic counts toward reminders once you have proof (certificate, invoice or the other clinic&apos;s record). Vaccines given here are recorded from the visit record.</p>
        <CommandForm op="recordOutsideVaccine" build="recordOutsideVaccine" submit="Record" fixed={sp.patient ? { patientId: sp.patient } : {}} paths={[path]}
          fields={[
            ...(sp.patient ? [] : [{ name: 'patientId', label: 'Patient', width: 'lg' as const, options: data.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.ref}` })) }]),
            { name: 'productId', label: 'Vaccine', width: 'lg', options: data.vaccineProducts.map(v => ({ value: v.id, label: v.name })) },
            { name: 'administeredOn', label: 'Given on (YYYY-MM-DD)', placeholder: '2026-03-14' },
            { name: 'lotNumber', label: 'Lot', width: 'sm' },
            { name: 'evidenceNote', label: 'Proof', width: 'lg', placeholder: 'Certificate from Midtown Animal Hospital' },
          ]} />
      </Section>

      {sp.patient ? (
        <Section title="Add a reminder by hand">
          <CommandForm op="addManualReminder" build="addManualReminder" submit="Add reminder" fixed={{ patientId: sp.patient }} paths={[path]}
            fields={[{ name: 'typeId', label: 'Reminder', options: data.reminderTypes.map(t => ({ value: t.id, label: t.name })) }, { name: 'dueOn', label: 'Due (YYYY-MM-DD)', placeholder: addDaysTo(today, 30) }]} />
        </Section>
      ) : null}
      <p className={`rounded-md border px-3 py-2 text-xs ${ALERT_TONE.info}`}>The vaccine intervals come from the practice&apos;s reminder protocols. Only rabies is cited to the state compendium; the medical director reviews the rest under <Link className="underline" href="/dashboard/platform/policies">Policies</Link>.</p>
    </Page>
  );
}
