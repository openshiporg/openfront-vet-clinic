import { q } from '../../lib/server';
import { calendarDay, when } from '../../lib/format';
import { Row, Empty, Status, Meta, Section } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Form = { id: string; ref: string; formNumber: string; kind: string; status: string; issuedOn: string; expiresOn: string; supplier: { name: string } | null; lines: { id: string; packages: number; packagesReceived: number; product: { displayName: string } | null }[] };
type Transfer = { id: string; ref: string; status: string; version: number; qty: string; unit: string | null; sentAt: string; fromContainer: { ref: string } | null; toRegistration: { registrantName: string } | null; witness: { displayName: string } | null };
type Cabinet = { id: string; kind: string; occurredAt: string; note: string; staff: { displayName: string } | null };
type Submission = { id: string; ref: string; reportCount: number; generatedAt: string; fileSha256: string; generatedBy: { displayName: string } | null };

const KINDS = [{ value: 'form_222', label: 'DEA Form 222' }, { value: 'csos', label: 'CSOS electronic order' }];
const CAB = [{ value: 'opened', label: 'Opened' }, { value: 'closed', label: 'Closed' }, { value: 'failed_attempt', label: 'Failed attempt' }];
const UNITS = ['mg', 'mL', 'tablet', 'capsule', 'g', 'unit'].map(u => ({ value: u, label: u }));

/** Order forms, transfers to other registrants, cabinet access and the state-report files (BUILD-PLAN P3). */
export default async function OrdersTransfers({ path, tz, today, location, witnesses, containers }: { path: string; tz: string; today: string; location?: { id: string; name: string }; witnesses: { value: string; label: string }[]; containers: { value: string; label: string }[] }) {
  const d = await q<{ csOrderForms: Form[]; csTransfers: Transfer[]; cabinetAccessEvents: Cabinet[]; pdmpSubmissions: Submission[]; suppliers: { id: string; name: string }[]; deaRegistrations: { id: string; registrantName: string; registrationNumber: string }[]; drugProducts: { id: string; displayName: string }[]; pending: number }>(`{
    csOrderForms(orderBy: { issuedOn: desc }, take: 12) { id ref formNumber kind status issuedOn expiresOn supplier { name } lines(take: 6) { id packages packagesReceived product { displayName } } }
    csTransfers(orderBy: { sentAt: desc }, take: 15) { id ref status version qty unit sentAt fromContainer { ref } toRegistration { registrantName } witness { displayName } }
    cabinetAccessEvents(orderBy: { occurredAt: desc }, take: 20) { id kind occurredAt note staff { displayName } }
    pdmpSubmissions(orderBy: { generatedAt: desc }, take: 20) { id ref reportCount generatedAt fileSha256 generatedBy { displayName } }
    suppliers(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name }
    deaRegistrations(where: { status: { equals: "active" } }, orderBy: { registrantName: asc }, take: 100) { id registrantName registrationNumber }
    drugProducts(where: { active: { equals: true }, csSchedule: { in: ["CII", "CIIN"] } }, orderBy: { displayName: asc }, take: 100) { id displayName }
    pending: pdmpReportsCount(where: { status: { equals: "pending" }, submission: null })
  }`);
  const here = `${path}?view=orders`;
  return (
    <>
      <Section title="Order forms (Schedule II)">
        <p className="text-xs text-muted-foreground">A Form 222 or CSOS order is good for 60 days from the day it is issued.</p>
        {d.csOrderForms.length ? d.csOrderForms.map(f => (
          <div key={f.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{f.formNumber}</span> · {f.supplier?.name}<Meta>{f.ref} · issued {calendarDay(f.issuedOn)} · good until {calendarDay(f.expiresOn)}{f.status === 'open' && f.expiresOn.slice(0, 10) < today ? ' (expired)' : ''}</Meta></div>
              <Status value={f.status} />
            </Row>
            {f.lines.map(l => (
              <Row key={l.id}>
                <div className="min-w-0 flex-1 pl-3 text-sm">{l.product?.displayName}<Meta>{l.packagesReceived} of {l.packages} packages received</Meta></div>
                {(f.status === 'open' || f.status === 'partially_filled') && l.packagesReceived < l.packages && f.expiresOn.slice(0, 10) >= today ? (
                  <CommandForm op="receiveOnOrderForm" build="receiveOnOrderForm" submit="Receive a package" fixed={{ lineId: l.id }} paths={[here]}
                    fields={[{ name: 'lotNumber', label: 'Lot number', width: 'md' }, { name: 'lotExpiresOn', label: 'Expires (YYYY-MM-DD)', width: 'md' }, { name: 'labelQty', label: 'Amount on the label', width: 'sm' }, { name: 'labelUnit', label: 'Unit', width: 'sm', options: UNITS }]} />
                ) : null}
              </Row>
            ))}
          </div>
        )) : <Empty>No order forms recorded.</Empty>}
        <CommandForm op="issueOrderForm" build="issueOrderForm" submit="Record order form" paths={[here]} fixed={location ? { locationId: location.id } : {}}
          fields={[{ name: 'supplierId', label: 'Supplier', width: 'lg', options: d.suppliers.map(s => ({ value: s.id, label: s.name })) }, { name: 'kind', label: 'Kind', width: 'md', options: KINDS }, { name: 'formNumber', label: 'Form number', width: 'md' }, { name: 'issuedOn', label: 'Issued (YYYY-MM-DD)', width: 'md' }, { name: 'productId', label: 'Drug', width: 'lg', options: d.drugProducts.map(p => ({ value: p.id, label: p.displayName })) }, { name: 'packages', label: 'Packages', width: 'sm' }]} />
      </Section>
      <Section title="Transfers to other registrants">
        {d.csTransfers.length ? d.csTransfers.map(t => (
          <Row key={t.id}>
            <div className="min-w-0 flex-1"><span className="font-medium">{t.fromContainer?.ref}</span> to {t.toRegistration?.registrantName}<Meta>{Number(t.qty)} {t.unit} · sent {when(t.sentAt, tz, 'day')} · witnessed by {t.witness?.displayName}</Meta></div>
            <Status value={t.status} />
            {t.status === 'sent' ? <CommandForm op="confirmTransfer" build="orderStep" submit="Mark received" fixed={{ transferId: t.id, expectedVersion: String(t.version) }} paths={[here]} fields={[]} /> : null}
          </Row>
        )) : <Empty>No transfers.</Empty>}
        <CommandForm op="transferControlled" build="transferControlled" submit="Record transfer" confirm="Record this transfer? It leaves the register and cannot be edited." paths={[here]}
          fields={[{ name: 'containerId', label: 'Container', width: 'lg', options: containers }, { name: 'qty', label: 'Amount', width: 'sm' }, { name: 'toRegistrationId', label: 'Send to', width: 'lg', options: d.deaRegistrations.map(r => ({ value: r.id, label: `${r.registrantName} · ${r.registrationNumber}` })) }, { name: 'witnessId', label: 'Witness', width: 'md', options: witnesses }]} />
      </Section>
      <Section title="Cabinet access">
        {d.cabinetAccessEvents.length ? d.cabinetAccessEvents.map(e => (
          <Row key={e.id}><div className="min-w-0 flex-1">{e.staff?.displayName}<Meta>{when(e.occurredAt, tz, 'dayTime')}{e.note ? ` · ${e.note}` : ''}</Meta></div><Status value={e.kind} /></Row>
        )) : <Empty>No cabinet events logged.</Empty>}
        <CommandForm op="logCabinetAccess" build="logCabinetAccess" submit="Log" paths={[here]} fixed={location ? { locationId: location.id } : {}}
          fields={[{ name: 'kind', label: 'Event', width: 'md', options: CAB }, { name: 'note', label: 'Note', width: 'lg' }]} />
      </Section>
      <Section title="State report files">
        <p className="text-xs text-muted-foreground">{d.pending} {d.pending === 1 ? 'report is' : 'reports are'} waiting for a file. Download it, upload it on the state site, then record the confirmation under State reports.</p>
        {d.pdmpSubmissions.length ? d.pdmpSubmissions.map(s => (
          <Row key={s.id}>
            <div className="min-w-0 flex-1"><span className="font-medium">{s.ref}</span><Meta>{s.reportCount} {s.reportCount === 1 ? 'report' : 'reports'} · {when(s.generatedAt, tz, 'dayTime')} · {s.generatedBy?.displayName}</Meta></div>
            <a className="inline-flex min-h-11 items-center text-sm underline" href={`${path}/pdmp-file?id=${encodeURIComponent(s.id)}`}>Download file</a>
          </Row>
        )) : <Empty>No files generated.</Empty>}
        {location && d.pending ? <CommandForm op="generatePdmpFile" build="generatePdmpFile" submit="Create file" fixed={{ locationId: location.id }} paths={[here]} fields={[]} /> : null}
      </Section>
    </>
  );
}
