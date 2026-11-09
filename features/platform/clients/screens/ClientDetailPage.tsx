import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label, money } from '../../lib/format';
import { ageText, todayIn } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Stat, LoadError } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';

type Detail = {
  id: string; ref: string; displayName: string; kind: string; status: string; source: string; version: number; creditLimitMinor: string;
  addressLine1: string; city: string; stateCode: string; postalCode: string; createdAt: string; primaryLocation: { name: string } | null;
  people: {
    id: string; firstName: string; lastName: string; relationship: string; isPrimary: boolean; canBook: boolean; canApproveTreatment: boolean; canReceiveRecords: boolean; canPay: boolean; canAuthoriseEuthanasia: boolean;
    contactPoints: { id: string; kind: string; value: string; isPrimary: boolean; canText: boolean; status: string; consents: { purpose: string; action: string; method: string; at: string }[] }[];
  }[];
  ownerships: { role: string; effectiveFrom: string; patient: { id: string; ref: string; name: string; status: string; sex: string; reproductiveStatus: string; dateOfBirth: string | null; species: { name: string } | null; breed: { name: string } | null; alerts: { severity: string; text: string }[] } | null }[];
  appointments: { id: string; ref: string; startsAt: string; status: string; appointmentType: { name: string } | null; channel: string }[];
  suppressions: { id: string; reason: string; active: boolean; contactPoint: { value: string } | null; patient: { name: string } | null }[];
  calls: { id: string; ref: string; startedAt: string; answeredBy: string; disposition: string }[];
};

/** Household 360: people and their rights, contact points with consent history, pets, visits, calls, suppressions. */
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, tz] = await Promise.all([
    q<{ client: Detail | null; appointments: Detail['appointments']; suppressions: Detail['suppressions']; callRecords: Detail['calls'] }>(`
      query C($id: ID!) { client(where: { id: $id }) {
        id ref displayName kind status source version creditLimitMinor addressLine1 city stateCode postalCode createdAt primaryLocation { name }
        people(orderBy: { isPrimary: desc }, take: 10) { id firstName lastName relationship isPrimary canBook canApproveTreatment canReceiveRecords canPay canAuthoriseEuthanasia
          contactPoints(take: 10) { id kind value isPrimary canText status consents(orderBy: { at: desc }, take: 5) { purpose action method at } } }
        ownerships(where: { effectiveTo: null }, take: 50) { role effectiveFrom patient { id ref name status sex reproductiveStatus dateOfBirth species { name } breed { name } alerts(where: { active: { equals: true } }, take: 10) { severity text } } }
      }
      appointments(where: { client: { id: { equals: $id } } }, orderBy: { startsAt: desc }, take: 20) { id ref startsAt status channel appointmentType { name } }
      suppressions(where: { client: { id: { equals: $id } } }, take: 20) { id reason active contactPoint { value } patient { name } }
      callRecords(where: { client: { id: { equals: $id } } }, orderBy: { startedAt: desc }, take: 10) { id ref startedAt answeredBy disposition }
      }`, { id }).then(d => ({ ok: true as const, d }), (error: unknown) => ({ ok: false as const, error })),
    practiceTimeZone(),
  ]);
  // Review r6 #1: a failed read shows its error; only a client that is not there (or not visible) is a 404.
  if (!res.ok) return <LoadError title="Client" error={res.error} />;
  const data = res.d;
  if (!data.client) notFound();
  const c: Detail = { ...data.client, appointments: data.appointments, suppressions: data.suppressions, calls: data.callRecords };
  const today = todayIn(tz);
  const rights = (p: Detail['people'][number]) => [p.canBook && 'book', p.canApproveTreatment && 'approve treatment', p.canReceiveRecords && 'records', p.canPay && 'pay', p.canAuthoriseEuthanasia && 'euthanasia'].filter(Boolean).join(', ');
  return (
    <Page title={c.displayName} crumbs={[{ label: 'Clients', href: '/dashboard/platform/clients' }]}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm">{c.ref}</span><Status value={c.status} />
        <Meta>{label(c.kind)} · {c.primaryLocation?.name} · since {when(c.createdAt, tz, 'day')} · via {label(c.source)}</Meta>
        {c.status === 'prospect' ? <ActionButton op="confirmRegistration" vars={{ clientId: c.id, expectedVersion: c.version }} paths={[`/dashboard/platform/clients/${c.id}`, '/dashboard/platform/clients']}>Confirm registration</ActionButton> : null}
      </div>
      {c.status === 'prospect' ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">Registered by {label(c.source)}. Check the details with the client before confirming; a phone match is not identity.</p> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Patients" value={c.ownerships.length} />
        <Stat name="Visits" value={c.appointments.length} />
        <Stat name="Credit limit" value={money(c.creditLimitMinor)} />
        <Stat name="Address" value={<span className="text-sm font-normal">{[c.addressLine1, c.city, c.postalCode].filter(Boolean).join(', ') || '—'}</span>} />
      </div>
      <Section title="Patients">
        {c.ownerships.length ? c.ownerships.map(o => o.patient ? (
          <Row key={o.patient.id} href={`/dashboard/platform/patients/${o.patient.id}`}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{o.patient.name}</span><span className="font-mono text-xs text-muted-foreground">{o.patient.ref}</span></div>
              <Meta>{o.patient.species?.name} · {o.patient.breed?.name ?? 'breed not recorded'} · {o.patient.sex} {label(o.patient.reproductiveStatus)} · {ageText(o.patient.dateOfBirth, today)} · {label(o.role)}</Meta>
              {o.patient.alerts.length ? <p className="text-xs text-red-700 dark:text-red-400">⚠ {o.patient.alerts.map(a => a.text).join(' · ')}</p> : null}
            </div>
            <Status value={o.patient.status} />
          </Row>
        ) : null) : <Empty>No patients.</Empty>}
      </Section>
      <Section title="People, contact points and consent">
        {c.people.map(p => (
          <div key={p.id} className="space-y-2 border-b py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{p.firstName} {p.lastName}</span><Meta>{label(p.relationship)}{p.isPrimary ? ' · primary' : ''} · may {rights(p) || 'nothing yet'}</Meta></div>
            {p.contactPoints.map(cp => (
              <div key={cp.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-mono">{cp.value}</span><Meta>{label(cp.kind)}{cp.isPrimary ? ' · primary' : ''}{cp.kind === 'mobile' ? (cp.canText ? ' · texts ok' : ' · no texts') : ''}</Meta>
                <Meta>{cp.consents.map(x => `${x.action} ${label(x.purpose)} (${label(x.method)}, ${when(x.at, tz, 'day')})`).join(' · ')}</Meta>
              </div>
            ))}
          </div>
        ))}
      </Section>
      {c.suppressions.length ? (
        <Section title="Suppressions">
          {c.suppressions.map(s => <Row key={s.id}><span>{label(s.reason)}</span><Meta>{s.contactPoint?.value ?? ''}{s.patient ? ` · ${s.patient.name}` : ''}</Meta><Status value={s.active ? 'blocked' : 'released'} /></Row>)}
        </Section>
      ) : null}
      <Section title="Appointments">
        {c.appointments.length ? c.appointments.map(a => (
          <Row key={a.id}><div className="min-w-0 flex-1"><span className="font-mono text-xs">{a.ref}</span> <span>{when(a.startsAt, tz)}</span> <Meta>· {a.appointmentType?.name} · {label(a.channel)}</Meta></div><Status value={a.status} /></Row>
        )) : <Empty>No appointments.</Empty>}
      </Section>
      <Section title="Calls">
        {c.calls.length ? c.calls.map(k => (
          <Row key={k.id} href={`/dashboard/platform/calls/${k.id}`}><span className="font-mono text-xs">{k.ref}</span><Meta>{when(k.startedAt, tz)} · {k.answeredBy === 'ai' ? 'AI receptionist' : label(k.answeredBy)} · {label(k.disposition)}</Meta></Row>
        )) : <Empty>No calls.</Empty>}
      </Section>
    </Page>
  );
}
