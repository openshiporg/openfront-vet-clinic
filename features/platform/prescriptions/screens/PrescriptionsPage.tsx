import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay, label, when } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Line = { id: string; directions: string; quantity: string; quantityUnit: string | null; refillsAuthorised: number; expiresAt: string; csSchedule: string; product: { displayName: string } | null; from_Dispense_line: { id: string }[] };
type Rx = { id: string; ref: string; status: string; issuedAt: string; patient: { id: string; name: string } | null; prescriber: { displayName: string } | null; lines: Line[] };
type Refill = { id: string; ref: string; status: string; version: number; productText: string; channel: string; slaDueAt: string | null; patient: { name: string } | null; client: { displayName: string } | null };

const DECISIONS = [
  { value: 'fulfil_existing', label: 'Fill from the current prescription' },
  { value: 'approve_new', label: 'Approve a new prescription' },
  { value: 'needs_exam', label: 'Needs an exam first' },
  { value: 'deny', label: 'Deny' },
];

/** Prescriptions, the refill queue and dispensing (BUILD-PLAN P3). A veterinarian decides refills; staff dispense. */
export default async function PrescriptionsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = sp.view === 'refills' ? 'refills' : 'active';
  const tz = await practiceTimeZone();
  const data = await q<{ prescriptions: Rx[]; refillRequests: Refill[]; pending: number; drugProducts: { id: string; displayName: string }[]; patients: { id: string; name: string }[]; locations: { id: string; name: string }[]; inventoryLots: { id: string; lotNumber: string; expiresOn: string; drug: { displayName: string } | null }[] }>(`{
    prescriptions(where: { status: { equals: "active" } }, orderBy: { issuedAt: desc }, take: 100) { id ref status issuedAt patient { id name } prescriber { displayName } lines(take: 10) { id directions quantity quantityUnit refillsAuthorised expiresAt csSchedule product { displayName } from_Dispense_line(take: 20) { id } } }
    refillRequests(where: { status: { in: ["received", "in_review"] } }, orderBy: { slaDueAt: asc }, take: 100) { id ref status version productText channel slaDueAt patient { name } client { displayName } }
    pending: refillRequestsCount(where: { status: { in: ["received", "in_review"] } })
    drugProducts(where: { active: { equals: true }, csSchedule: { equals: "none" } }, orderBy: { displayName: asc }, take: 200) { id displayName }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name }
    locations(orderBy: { name: asc }, take: 10) { id name }
    inventoryLots(where: { status: { equals: "available" } }, take: 200) { id lotNumber expiresOn drug { displayName } }
  }`);
  const path = '/dashboard/platform/prescriptions';
  return (
    <Page title="Prescriptions">
      <Tabs items={[{ key: 'active', label: 'Active prescriptions', href: path }, { key: 'refills', label: 'Refill requests', href: `${path}?view=refills`, count: data.pending }]} active={view} />
      {view === 'refills' ? (
        <Section title="Refill requests">
          {data.refillRequests.length ? data.refillRequests.map(r => (
            <Row key={r.id}>
              <div className="min-w-0 flex-1">
                <span className="font-medium">{r.patient?.name ?? 'Unknown patient'}</span> · {r.productText || 'Refill'}
                <Meta>{r.client?.displayName} · asked by {label(r.channel)}{r.slaDueAt ? ` · answer by ${when(r.slaDueAt, tz, 'dayTime')}` : ''}</Meta>
              </div>
              <Status value={r.status} />
              <CommandForm op="decideRefill" build="decideRefill" submit="Decide" fixed={{ requestId: r.id, expectedVersion: String(r.version) }} paths={[`${path}?view=refills`]}
                fields={[{ name: 'decision', label: 'Decision', width: 'lg', options: DECISIONS }, { name: 'reason', label: 'Reason for the client', width: 'lg' }]} />
            </Row>
          )) : <Empty>No refill requests are waiting.</Empty>}
        </Section>
      ) : (
        <>
          <Section title="Active prescriptions">
            {data.prescriptions.length ? data.prescriptions.map(rx => (
              <Row key={rx.id}>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{rx.patient?.name}</span> · {rx.ref}
                  <Meta>written {when(rx.issuedAt, tz, 'day')} by {rx.prescriber?.displayName}</Meta>
                  {rx.lines.map(l => {
                    const fills = l.from_Dispense_line.length;
                    const left = Math.max(l.refillsAuthorised + 1 - fills, 0);
                    return (
                      <div key={l.id} className="mt-1 flex min-w-0 flex-col gap-1 text-sm">
                        <span className="break-words">{l.product?.displayName} · {l.directions} · {Number(l.quantity)} {label(l.quantityUnit)}</span>
                        <Meta>{left} {left === 1 ? 'fill' : 'fills'} left · good until {calendarDay(l.expiresAt)}{l.csSchedule !== 'none' ? ' · controlled: dispense it from the controlled register page' : ''}</Meta>
                        {left > 0 && l.csSchedule === 'none' ? (
                          <CommandForm op="dispenseFill" build="dispenseFill" submit="Dispense" fixed={{ lineId: l.id }} paths={[path]}
                            fields={[{ name: 'quantity', label: 'Amount', defaultValue: String(Number(l.quantity)), width: 'sm' }, { name: 'lotId', label: 'Lot', width: 'lg', options: [{ value: '', label: 'Earliest expiry' }, ...data.inventoryLots.filter(x => x.drug?.displayName === l.product?.displayName).map(x => ({ value: x.id, label: `${x.lotNumber} · expires ${calendarDay(x.expiresOn)}` }))] }]} />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <Status value={rx.status} />
              </Row>
            )) : <Empty>No active prescriptions.</Empty>}
          </Section>
          <Section title="Write a prescription">
            <p className="text-xs text-muted-foreground">Needs a veterinarian with a current licence and a current veterinarian-client-patient relationship. Controlled drugs need your DEA registration and follow the refill limits.</p>
            <CommandForm op="writePrescription" build="writePrescription" submit="Sign prescription" paths={[path]}
              fields={[
                { name: 'patientId', label: 'Patient', width: 'lg', options: [{ value: '', label: 'Choose a patient' }, ...data.patients.map(p => ({ value: p.id, label: p.name }))] },
                { name: 'locationId', label: 'Location', width: 'lg', options: data.locations.map(l => ({ value: l.id, label: l.name })) },
                { name: 'productId', label: 'Drug', width: 'lg', options: [{ value: '', label: 'Choose a drug' }, ...data.drugProducts.map(p => ({ value: p.id, label: p.displayName }))] },
                { name: 'directions', label: 'Directions', width: 'full', placeholder: 'Give 1 tablet by mouth every 12 hours with food' },
                { name: 'quantity', label: 'Amount to dispense', width: 'sm', placeholder: '30' },
                { name: 'refills', label: 'Refills', width: 'sm', defaultValue: '0' },
              ]} />
          </Section>
        </>
      )}
    </Page>
  );
}
