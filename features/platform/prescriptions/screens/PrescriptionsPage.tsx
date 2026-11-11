import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay, label, when } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Line = { id: string; directions: string; quantity: string; quantityUnit: string | null; refillsAuthorised: number; expiresAt: string; csSchedule: string; product: { displayName: string } | null; };
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
  const view = sp.view === 'refills' ? 'refills' : sp.view === 'outside' ? 'outside' : sp.view === 'dispensed' ? 'dispensed' : 'active';
  const tz = await practiceTimeZone();
  const data = await q<{ dispenses: { id: string; ref: string; quantity: string; quantityUnit: string | null; dispensedAt: string; patient: { name: string } | null; product: { displayName: string } | null; dispensedBy: { displayName: string } | null; line: { id: string } | null }[]; dispenseLabels: { id: string; dispense: { id: string } | null }[]; externalDispenses: { id: string; ref: string; status: string; version: number; pharmacyName: string; orderReference: string; note: string; prescription: { ref: string } | null }[]; prescriptions: Rx[]; refillRequests: Refill[]; pending: number; drugProducts: { id: string; displayName: string }[]; patients: { id: string; name: string; ref: string; species: { name: string } | null }[]; locations: { id: string; name: string }[]; inventoryLots: { id: string; lotNumber: string; expiresOn: string; drug: { displayName: string } | null }[] }>(`{
    dispenses(orderBy: { dispensedAt: desc }, take: 500) { id ref quantity quantityUnit dispensedAt patient { name } product { displayName } dispensedBy { displayName } line { id } }
    dispenseLabels(orderBy: { printedAt: desc }, take: 300) { id dispense { id } }
    externalDispenses(orderBy: { createdAt: desc }, take: 50) { id ref status version pharmacyName orderReference note prescription { ref } }
    prescriptions(where: { status: { equals: "active" } }, orderBy: { issuedAt: desc }, take: 100) { id ref status issuedAt patient { id name } prescriber { displayName } lines(take: 10) { id directions quantity quantityUnit refillsAuthorised expiresAt csSchedule product { displayName } } }
    refillRequests(where: { status: { in: ["received", "in_review"] } }, orderBy: { slaDueAt: asc }, take: 100) { id ref status version productText channel slaDueAt patient { name } client { displayName } }
    pending: refillRequestsCount(where: { status: { in: ["received", "in_review"] } })
    drugProducts(where: { active: { equals: true }, csSchedule: { equals: "none" } }, orderBy: { displayName: asc }, take: 200) { id displayName }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name ref species { name } }
    locations(orderBy: { name: asc }, take: 10) { id name }
    inventoryLots(where: { status: { equals: "available" } }, take: 200) { id lotNumber expiresOn drug { displayName } }
  }`);
  const path = '/dashboard/platform/prescriptions';
  return (
    <Page title="Prescriptions">
      <Tabs items={[{ key: 'active', label: 'Active prescriptions', href: path }, { key: 'refills', label: 'Refill requests', href: `${path}?view=refills`, count: data.pending }, { key: 'dispensed', label: 'Dispensed', href: `${path}?view=dispensed` }, { key: 'outside', label: 'Outside pharmacies', href: `${path}?view=outside` }]} active={view} />
      {view === 'dispensed' ? (
        <Section title="Recently dispensed">
          {data.dispenses.length ? data.dispenses.map(x => (
            <Row key={x.id}>
              <div className="min-w-0 flex-1"><span className="font-medium">{x.patient?.name}</span> · {x.product?.displayName}<Meta>{x.ref} · {Number(x.quantity)} {label(x.quantityUnit)} · {when(x.dispensedAt, tz, 'dayTime')} · {x.dispensedBy?.displayName}{data.dispenseLabels.some(b => b.dispense?.id === x.id) ? ' · label printed' : ''}</Meta></div>
              <ActionButton op="printDispenseLabel" vars={{ dispenseId: x.id }} paths={[`${path}?view=dispensed`]}>Print label</ActionButton>
            </Row>
          )) : <Empty>Nothing dispensed yet.</Empty>}
        </Section>
      ) : null}
      {view === 'outside' ? (
        <>
          <Section title="Filled by an outside pharmacy">
            {data.externalDispenses.length ? data.externalDispenses.map(x => (
              <Row key={x.id}>
                <div className="min-w-0 flex-1"><span className="font-medium">{x.pharmacyName}</span> · {x.prescription?.ref}<Meta>{x.ref}{x.orderReference ? ` · order ${x.orderReference}` : ''}{x.note ? ` · ${x.note}` : ''}</Meta></div>
                <Status value={x.status} />
                {x.status === 'requested' ? <CommandForm op="decideExternalFill" build="decideExternalFill" submit="Approve" fixed={{ externalId: x.id, status: 'approved', expectedVersion: String(x.version) }} paths={[`${path}?view=outside`]} fields={[{ name: 'note', label: 'Note', width: 'lg' }]} /> : null}
                {x.status === 'requested' ? <CommandForm op="decideExternalFill" build="decideExternalFill" submit="Decline" fixed={{ externalId: x.id, status: 'declined', expectedVersion: String(x.version) }} paths={[`${path}?view=outside`]} fields={[{ name: 'note', label: 'Why', width: 'lg' }]} /> : null}
                {x.status === 'approved' ? <CommandForm op="decideExternalFill" build="decideExternalFill" submit="Mark filled" fixed={{ externalId: x.id, status: 'filled', expectedVersion: String(x.version) }} paths={[`${path}?view=outside`]} fields={[]} /> : null}
              </Row>
            )) : <Empty>No outside-pharmacy requests.</Empty>}
          </Section>
          <Section title="Send a prescription to an outside pharmacy">
            <CommandForm op="requestExternalFill" build="requestExternalFill" submit="Record request" paths={[`${path}?view=outside`]}
              fields={[{ name: 'prescriptionId', label: 'Prescription', width: 'lg', options: data.prescriptions.filter(r => r.lines.every(l => l.csSchedule === 'none')).map(r => ({ value: r.id, label: `${r.patient?.name} · ${r.ref}` })) }, { name: 'pharmacyName', label: 'Pharmacy', width: 'lg' }, { name: 'orderReference', label: 'Their order number', width: 'md' }]} />
          </Section>
        </>
      ) : null}
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
                    const fills = data.dispenses.filter(x => x.line?.id === l.id).length;
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
                {rx.lines.every(l => l.csSchedule === 'none') ? <ActionButton op="exportWrittenRx" vars={{ prescriptionId: rx.id }} paths={[path]}>Written copy</ActionButton> : null}
              </Row>
            )) : <Empty>No active prescriptions.</Empty>}
          </Section>
          <Section title="Write a prescription">
            <p className="text-xs text-muted-foreground">Needs a veterinarian with a current licence and a current veterinarian-client-patient relationship. Controlled drugs need your DEA registration and follow the refill limits.</p>
            <CommandForm op="writePrescription" build="writePrescription" submit="Sign prescription" paths={[path]}
              fields={[
                { name: 'patientId', label: 'Patient', width: 'lg', options: [{ value: '', label: 'Choose a patient' }, ...data.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.species?.name ?? 'Patient'} · ${p.ref}` }))] },
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
