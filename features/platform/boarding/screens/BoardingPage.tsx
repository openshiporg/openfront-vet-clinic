import { q, practiceTimeZone } from '../../lib/server';
import { todayIn } from '../../lib/clinic';
import { calendarDay, money, when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

const PATH = '/dashboard/platform/boarding';
type Pet = { id: string; name: string; ownerships: { client: { displayName: string } | null }[] };
const pet = (p: Pet) => ({ value: p.id, label: `${p.name} · ${p.ownerships[0]?.client?.displayName ?? 'no owner on file'}` });
const CARE = [{ value: 'fed', label: 'Fed' }, { value: 'walked', label: 'Walked' }, { value: 'medicated', label: 'Medicated' }, { value: 'played', label: 'Played with' }, { value: 'cleaned', label: 'Cleaned' }, { value: 'observation', label: 'Observation' }];

/** Boarding: reservations that hold nights, check-in with a run card, daily care, check-out charges. */
export default async function BoardingPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const views = ['reservations', 'house', 'runs'] as const;
  const view = (views as readonly string[]).includes(sp.view ?? '') ? (sp.view as (typeof views)[number]) : 'reservations';
  const base = await q<{ inHouse: number; waiting: number }>(`{
    inHouse: boardingStaysCount(where: { status: { equals: "in_house" } })
    waiting: boardingReservationsCount(where: { status: { in: ["requested", "confirmed"] } })
  }`);
  return (
    <Page title="Boarding">
      <Tabs
        items={[
          { key: 'reservations', label: 'Reservations', href: PATH, count: base.waiting },
          { key: 'house', label: 'In the house', href: `${PATH}?view=house`, count: base.inHouse },
          { key: 'runs', label: 'Runs & rates', href: `${PATH}?view=runs` },
        ]}
        active={view}
      />
      {view === 'reservations' ? await Reservations() : null}
      {view === 'house' ? await House() : null}
      {view === 'runs' ? await Runs() : null}
    </Page>
  );
}

async function Reservations() {
  const tz = await practiceTimeZone();
  const d = await q<{ patients: Pet[]; runTypes: { id: string; name: string; nightlyRateMinor: string }[]; reservations: { id: string; ref: string; status: string; version: number; checkInOn: string; checkOutOn: string; holdExpiresAt: string | null; patient: { name: string } | null; client: { displayName: string } | null; runType: { name: string } | null }[] }>(`{
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name ownerships(where: { effectiveTo: null, role: { equals: "primary" } }, take: 1) { client { displayName } } }
    runTypes(where: { active: { equals: true } }, orderBy: { name: asc }, take: 30) { id name nightlyRateMinor }
    reservations: boardingReservations(where: { status: { in: ["requested", "confirmed"] } }, orderBy: { checkInOn: asc }, take: 40) { id ref status version checkInOn checkOutOn holdExpiresAt patient { name } client { displayName } runType { name } }
  }`);
  return (
    <>
      <Section title="Hold nights for a pet">
        <CommandForm op="reserveBoarding" build="phase5" submit="Hold nights" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(pet)] },
          { name: 'runTypeId', label: 'Kind of run', options: [{ value: '', label: 'Choose a run' }, ...d.runTypes.map(r => ({ value: r.id, label: `${r.name} · ${money(r.nightlyRateMinor)} a night` }))] },
          { name: 'checkInOn', label: 'Arrives (YYYY-MM-DD)', width: 'sm' }, { name: 'checkOutOn', label: 'Leaves (YYYY-MM-DD)', width: 'sm' },
          { name: 'notes', label: 'Notes' },
          { name: 'vaccineOverrideReason', label: 'Only if a vaccine is missing: why this pet may stay', width: 'full' },
        ]} />
        <Meta>A hold lasts 24 hours and then gives the nights back.</Meta>
      </Section>
      <Section title="Open reservations">
        {d.reservations.length ? d.reservations.map(r => {
          const lapsed = r.status === 'requested' && r.holdExpiresAt && new Date(r.holdExpiresAt) < new Date();
          return (
            <div key={r.id} className="border-b py-2 last:border-0">
              <Row>
                <div className="min-w-0 flex-1"><span className="font-medium">{r.patient?.name}</span> · {r.client?.displayName}<Meta>{r.ref} · {r.runType?.name} · {calendarDay(r.checkInOn)} to {calendarDay(r.checkOutOn)}{r.status === 'requested' && r.holdExpiresAt ? ` · ${lapsed ? 'hold ran out' : `held until ${when(r.holdExpiresAt, tz, 'dayTime')}`}` : ''}</Meta></div>
                <Status value={lapsed ? 'lapsed' : r.status} />
              </Row>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {r.status === 'requested' ? <ActionButton op="confirmBoarding" vars={{ reservationId: r.id, expectedVersion: r.version }} paths={[PATH]}>Confirm</ActionButton> : null}
                {r.status === 'confirmed' ? (
                  <CommandForm op="checkInBoarding" build="phase5" submit="Check in" fixed={{ reservationId: r.id, expectedVersion: String(r.version) }} paths={[PATH, `${PATH}?view=house`]} fields={[
                    { name: 'emergencyContactName', label: 'Emergency contact' }, { name: 'emergencyContactPhone', label: 'Emergency phone', width: 'sm' },
                    { name: 'feeding', label: 'Feeding' }, { name: 'handling', label: 'Handling' }, { name: 'medications', label: 'Medicines' },
                    { name: 'spendLimit', label: 'Vet care limit (dollars)', width: 'sm' }, { name: 'belongings', label: 'Belongings (comma separated)' },
                  ]} />
                ) : null}
                <ActionButton op="cancelBoarding" vars={{ reservationId: r.id, expectedVersion: r.version }} ask="Why is this reservation being cancelled?" paths={[PATH]}>Cancel</ActionButton>
              </div>
            </div>
          );
        }) : <Empty>No open reservations.</Empty>}
      </Section>
    </>
  );
}

async function House() {
  const tz = await practiceTimeZone();
  const d = await q<{ stays: { id: string; ref: string; version: number; checkedInAt: string; patient: { name: string } | null; client: { displayName: string } | null; run: { id: string; label: string } | null }[]; runs: { id: string; label: string; runType: { name: string } | null }[]; belongings: { id: string; description: string; version: number; stay: { id: string } | null }[]; logs: { id: string; kind: string; note: string | null; at: string; stay: { id: string } | null }[] }>(`{
    stays: boardingStays(where: { status: { equals: "in_house" } }, orderBy: { checkedInAt: asc }, take: 60) { id ref version checkedInAt patient { name } client { displayName } run { id label } }
    runs(where: { status: { equals: "available" } }, orderBy: { label: asc }, take: 100) { id label runType { name } }
    belongings: belongingItems(where: { returnedAt: { equals: null }, stay: { status: { equals: "in_house" } } }, take: 200) { id description version stay { id } }
    logs: dailyCareLogs(where: { stay: { status: { equals: "in_house" } } }, orderBy: { at: desc }, take: 200) { id kind note at stay { id } }
  }`);
  return (
    <Section title="In the house">
      {d.stays.length ? d.stays.map(s => (
        <div key={s.id} className="border-b py-2 last:border-0">
          <Row>
            <div className="min-w-0 flex-1"><span className="font-medium">{s.patient?.name}</span> · {s.client?.displayName}<Meta>{s.ref} · {s.run?.label} · in since {when(s.checkedInAt, tz, 'dayTime')}</Meta></div>
            <Status value="in_house" />
          </Row>
          {d.logs.filter(l => l.stay?.id === s.id).slice(0, 3).map(l => <Meta key={l.id}>{label(l.kind)}{l.note ? `: ${l.note}` : ''} · {when(l.at, tz, 'dayTime')}</Meta>)}
          {d.belongings.filter(b => b.stay?.id === s.id).map(b => (
            <Row key={b.id}><div className="min-w-0 flex-1 text-sm">{b.description}</div><ActionButton op="returnBelonging" vars={{ itemId: b.id, expectedVersion: b.version }} paths={[PATH, `${PATH}?view=house`]}>Mark returned</ActionButton></Row>
          ))}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <CommandForm op="logBoardingCare" build="phase5" submit="Log care" fixed={{ stayId: s.id }} paths={[`${PATH}?view=house`]} fields={[{ name: 'kind', label: 'What was done', options: CARE, defaultValue: 'fed' }, { name: 'note', label: 'Note' }]} />
            <CommandForm op="moveBoardingRun" build="phase5" submit="Move" fixed={{ stayId: s.id }} paths={[`${PATH}?view=house`]} fields={[{ name: 'runId', label: 'Move to', options: [{ value: '', label: 'Choose a run' }, ...d.runs.filter(r => r.id !== s.run?.id).map(r => ({ value: r.id, label: `${r.label} · ${r.runType?.name}` }))] }]} />
            <ActionButton op="checkOutBoarding" vars={{ stayId: s.id, expectedVersion: s.version }} confirm="Check out and charge each night?" paths={[PATH, `${PATH}?view=house`]}>Check out</ActionButton>
          </div>
        </div>
      )) : <Empty>No pets are boarding.</Empty>}
    </Section>
  );
}

async function Runs() {
  const today = todayIn(await practiceTimeZone());
  const d = await q<{ runTypes: { id: string; code: string; name: string; nightlyRateMinor: string; depositMinor: string | null; location: { id: string; name: string } | null }[]; runs: { id: string; label: string; status: string; version: number; runType: { id: string } | null }[]; locations: { id: string; name: string }[]; free: { runType: { id: string } | null; capacity: number; sold: number }[] }>(`{
    runTypes(orderBy: { name: asc }, take: 30) { id code name nightlyRateMinor depositMinor location { id name } }
    runs(orderBy: { label: asc }, take: 200) { id label status version runType { id } }
    locations(orderBy: { name: asc }, take: 10) { id name }
    free: nightlyRunInventories(where: { night: { equals: "${today}" } }, take: 60) { runType { id } capacity sold }
  }`);
  return (
    <>
      <Section title="Kinds of run">
        {d.runTypes.map(t => {
          const inv = d.free.find(f => f.runType?.id === t.id);
          return (
            <div key={t.id} className="border-b py-2 last:border-0">
              <Row><div className="min-w-0 flex-1"><span className="font-medium">{t.name}</span><Meta>{t.location?.name} · {money(t.nightlyRateMinor)} a night{inv ? ` · ${inv.capacity - inv.sold} of ${inv.capacity} open tonight` : ''}</Meta></div></Row>
              {d.runs.filter(r => r.runType?.id === t.id).map(r => (
                <Row key={r.id}><div className="min-w-0 flex-1 pl-3 text-sm">{r.label}</div><Status value={r.status} />
                  <ActionButton op="setRunStatus" vars={{ runId: r.id, status: r.status === 'available' ? 'out_of_service' : 'available', expectedVersion: r.version }} paths={[`${PATH}?view=runs`]}>{r.status === 'available' ? 'Take out of service' : 'Put back in service'}</ActionButton></Row>
              ))}
            </div>
          );
        })}
      </Section>
      <Section title="Add or change a kind of run">
        <CommandForm op="saveRunType" build="phase5" submit="Save" paths={[`${PATH}?view=runs`]} fields={[
          { name: 'locationId', label: 'Location', options: [{ value: '', label: 'Choose a location' }, ...d.locations.map(l => ({ value: l.id, label: l.name }))] },
          { name: 'code', label: 'Short code', placeholder: 'SUITE_XL', width: 'sm' }, { name: 'name', label: 'Name' },
          { name: 'nightlyRate', label: 'Nightly rate (dollars)', width: 'sm' }, { name: 'deposit', label: 'Deposit (dollars)', width: 'sm' },
          { name: 'runs', label: 'How many runs', defaultValue: '4', width: 'sm' }, { name: 'speciesCodes', label: 'Species (comma separated)', placeholder: 'canine' },
        ]} />
      </Section>
    </>
  );
}
