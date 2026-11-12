import Link from 'next/link';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

const PATH = '/dashboard/platform/end-of-life';
const AFTERCARE = [{ value: 'private_cremation', label: 'Private cremation' }, { value: 'communal_cremation', label: 'Communal cremation' }, { value: 'home_burial', label: 'Home burial' }, { value: 'rabies_testing', label: 'Rabies testing' }];
const AUTHORITY = [{ value: 'owner', label: 'Owner' }, { value: 'animal_control', label: 'Animal control' }, { value: 'court_order', label: 'Court order' }, { value: 'shelter_policy', label: 'Shelter policy' }];
const BITE = [{ value: 'no_bite', label: 'No bite in the last 10 days' }, { value: 'bite_in_last_10_days', label: 'Bite in the last 10 days' }];
const STEPS: Record<string, { step: string; text: string }[]> = {
  body_tagged: [{ step: 'store', text: 'Move to cold storage' }, { step: 'release_to_owner', text: 'Release to owner' }, { step: 'hold_for_testing', text: 'Hold for testing' }],
  stored: [{ step: 'pick_up', text: 'Crematory picked up' }, { step: 'release_to_owner', text: 'Release to owner' }, { step: 'hold_for_testing', text: 'Hold for testing' }],
  picked_up: [{ step: 'return_ashes', text: 'Ashes came back' }],
  returned: [{ step: 'close', text: 'Close' }], released_to_owner: [{ step: 'close', text: 'Close' }], held_for_testing: [{ step: 'close', text: 'Close' }],
};

/** End of life: euthanasia consent and record, then the tagged aftercare chain and keepsakes. */
export default async function EndOfLifePage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = sp.view === 'aftercare' ? 'aftercare' : 'consent';
  const tz = await practiceTimeZone();
  return (
    <Page title="End of life">
      <Tabs items={[{ key: 'consent', label: 'Consent & record', href: PATH }, { key: 'aftercare', label: 'Aftercare', href: `${PATH}?view=aftercare` }]} active={view} />
      {view === 'consent' ? await Consent(tz) : await Aftercare(tz)}
    </Page>
  );
}

async function Consent(tz: string) {
  const d = await q<{ consents: { id: string; ref: string; status: string; version: number; aftercare: string; signedAt: string | null; patient: { name: string } | null; client: { displayName: string } | null }[]; patients: { id: string; name: string; ownerships: { client: { displayName: string } | null }[] }[]; people: { id: string; firstName: string; lastName: string; client: { displayName: string } | null }[] }>(`{
    consents: euthanasiaConsents(where: { status: { equals: "signed" } }, orderBy: { createdAt: desc }, take: 30) { id ref status version aftercare signedAt patient { name } client { displayName } }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name ownerships(where: { effectiveTo: null, role: { equals: "primary" } }, take: 1) { client { displayName } } }
    people: clientPeople(orderBy: { lastName: asc }, take: 300) { id firstName lastName client { displayName } }
  }`);
  return (
    <>
      <Section title="Record consent">
        <CommandForm op="signEuthanasiaConsent" build="phase5" submit="Save consent" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.ownerships[0]?.client?.displayName ?? 'no owner on file'}` }))] },
          { name: 'signerId', label: 'Who is signing', options: [{ value: '', label: 'Choose the signer' }, ...d.people.map(p => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.client?.displayName ?? ''}` }))] },
          { name: 'authority', label: 'Authority', options: AUTHORITY, defaultValue: 'owner' },
          { name: 'biteAttestation', label: 'Bite history', options: BITE, defaultValue: 'no_bite' },
          { name: 'aftercare', label: 'Aftercare wanted', options: AFTERCARE, defaultValue: 'private_cremation' },
          { name: 'method', label: 'How it was signed', options: [{ value: 'in_person', label: 'In person' }, { value: 'e_signature', label: 'Electronic signature' }], defaultValue: 'in_person' },
          { name: 'clientPresent', label: 'Signer is here', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], defaultValue: 'true' },
          { name: 'signatureText', label: 'Typed name as signature' },
        ]} />
      </Section>
      <Section title="Signed and waiting">
        {d.consents.length ? d.consents.map(c => (
          <div key={c.id} className="border-b py-2 last:border-0">
            <Row><div className="min-w-0 flex-1"><span className="font-medium">{c.patient?.name}</span> · {c.client?.displayName}<Meta>{c.ref} · {label(c.aftercare)}{c.signedAt ? ` · signed ${when(c.signedAt, tz, 'dayTime')}` : ''}</Meta></div><Status value={c.status} /></Row>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <CommandForm op="recordEuthanasia" build="phase5" submit="Record the death" confirm="This ends the pet's record as living, ends any plan and cancels bookings. Continue?" fixed={{ consentId: c.id, patientId: d.patients.find(p => p.name === c.patient?.name)?.id ?? '', expectedVersion: '1' }} paths={[PATH, `${PATH}?view=aftercare`]} fields={[
                { name: 'tagNumber', label: 'Body tag number', width: 'sm' }, { name: 'causeNote', label: 'Reason' },
              ]} />
              <ActionButton op="revokeEuthanasiaConsent" vars={{ consentId: c.id, expectedVersion: c.version }} ask="Why is the consent withdrawn?" paths={[PATH]}>Withdraw</ActionButton>
            </div>
          </div>
        )) : <Empty>No signed consent is waiting.</Empty>}
      </Section>
    </>
  );
}

async function Aftercare(tz: string) {
  const d = await q<{ orders: { id: string; ref: string; status: string; version: number; choice: string; tagNumber: string; crematory: string | null; patient: { name: string } | null; client: { displayName: string } | null }[]; events: { id: string; kind: string; place: string | null; at: string; order: { id: string } | null; tagNumber: string }[] }>(`{
    orders: aftercareOrders(where: { status: { not: { equals: "closed" } } }, orderBy: { createdAt: desc }, take: 40) { id ref status version choice tagNumber crematory patient { name } client { displayName } }
    events: custodyEvents(orderBy: { at: desc }, take: 200) { id kind place at tagNumber order { id } }
  }`);
  return (
    <Section title="Open aftercare" aside={<Link className="inline-flex h-11 items-center px-2 text-sm underline sm:h-8" href="/dashboard/platform/end-of-life/export?kind=custody" prefetch={false}>Export</Link>}>
      {d.orders.length ? d.orders.map(o => (
        <div key={o.id} className="border-b py-2 last:border-0">
          <Row><div className="min-w-0 flex-1"><span className="font-medium">{o.patient?.name}</span> · {o.client?.displayName}<Meta>{o.ref} · tag {o.tagNumber} · {label(o.choice)}{o.crematory ? ` · ${o.crematory}` : ''}</Meta></div><Status value={o.status} /></Row>
          {d.events.filter(e => e.order?.id === o.id).slice(0, 4).map(e => <Meta key={e.id}>{label(e.kind)} · tag {e.tagNumber} · {when(e.at, tz, 'dayTime')}</Meta>)}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {(STEPS[o.status] ?? []).map(s => (
              <CommandForm key={s.step} op="advanceAftercare" build="phase5" submit={s.text} fixed={{ orderId: o.id, step: s.step, expectedVersion: String(o.version) }} paths={[`${PATH}?view=aftercare`]} fields={[
                { name: 'tagNumber', label: 'Tag on the body', width: 'sm' },
                ...(s.step === 'pick_up' ? [{ name: 'crematory', label: 'Crematory' }, { name: 'manifestRef', label: 'Manifest number', width: 'sm' as const }] : []),
                ...(s.step === 'return_ashes' ? [{ name: 'crematoryRef', label: 'Number on the ashes', width: 'sm' as const }, { name: 'receivedBy', label: 'Received by' }] : []),
              ]} />
            ))}
            {o.choice === 'private_cremation' || o.choice === 'communal_cremation' ? (
              <CommandForm op="addMemorialItem" build="phase5" submit="Add keepsake" fixed={{ orderId: o.id, kind: 'paw_print' }} paths={[`${PATH}?view=aftercare`]} fields={[{ name: 'description', label: 'Keepsake note' }]} />
            ) : null}
          </div>
        </div>
      )) : <Empty>No open aftercare.</Empty>}
     <Meta>Prices come from the price list and appear on the invoice.</Meta>
    </Section>
  );
}
