import { q, practiceTimeZone } from '../../lib/server';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';
import { calendarDay, label, when } from '../../lib/format';
import { todayIn } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';
import OrdersTransfers from './OrdersTransfers';

type Container = { id: string; ref: string; status: string; version: number; lotNumber: string; lotExpiresOn: string | null; labelUnit: string; balance: string | null; product: { displayName: string; csSchedule: string } | null; location: { id: string } | null };
type Entry = { id: string; ref: string; type: string; qtySigned: string; unit: string | null; occurredAt: string; reason: string; container: { ref: string } | null; actor: { displayName: string } | null; witness: { displayName: string } | null };
type Case = { id: string; ref: string; kind: string; status: string; version: number; qty: string; unit: string | null; description: string; noticeDueOn: string | null; form106DueOn: string | null; noticeReference: string; form106Reference: string; container: { ref: string } | null };
type Pdmp = { id: string; ref: string; status: string; version: number; dueOn: string | null; program: string; dispense: { ref: string } | null };
type Staff = { id: string; displayName: string };

const VIEWS = [['register', 'Register'], ['containers', 'Containers'], ['cases', 'Discrepancies'], ['pdmp', 'State reports'], ['orders', 'Orders and transfers']] as const;
const CS_UNITS = ['mg', 'mL', 'tablet', 'capsule', 'g', 'unit'];
const signed = (v: string) => (v.startsWith('-') ? v : `+${v}`);
const clean = (v: string | null) => (v ? String(Number(v)) : '0');

/** Controlled-substance register (BUILD-PLAN P3). Balances are summed from the entries; nothing here edits a past entry. */
export default async function ControlledPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = VIEWS.find(v => v[0] === sp.view)?.[0] ?? 'register';
  const path = '/dashboard/platform/controlled';
  const me = await keystoneClient<{ authenticatedItem: { role: { canViewControlled: boolean | null } | null } | null }>(`{ authenticatedItem { ... on User { role { canViewControlled } } } }`);
  if (!me.success || !me.data.authenticatedItem?.role?.canViewControlled) {
    return <Page title="Controlled substances"><Empty>The controlled-substance register is open to the veterinarians, technicians and managers who hold the controlled-substance permission.</Empty></Page>;
  }
  const tz = await practiceTimeZone();
  const today = todayIn(tz);
  const d = await q<{ csContainers: Container[]; csLogEntries: Entry[]; csDiscrepancyCases: Case[]; pdmpReports: Pdmp[]; openCases: number; duePdmp: number; staffMembers: Staff[]; drugProducts: { id: string; displayName: string }[]; locations: { id: string; name: string }[] }>(`{
    csContainers(where: { status: { in: ["sealed", "open", "emptied", "quarantined"] } }, orderBy: { ref: asc }, take: 200) { id ref status version lotNumber lotExpiresOn labelUnit balance product { displayName csSchedule } location { id } }
    csLogEntries(orderBy: { recordedAt: desc }, take: 60) { id ref type qtySigned unit occurredAt reason container { ref } actor { displayName } witness { displayName } }
    csDiscrepancyCases(orderBy: { discoveredAt: desc }, take: 50) { id ref kind status version qty unit description noticeDueOn form106DueOn noticeReference form106Reference container { ref } }
    pdmpReports(orderBy: { dueOn: asc }, take: 100) { id ref status version dueOn program dispense { ref } }
    openCases: csDiscrepancyCasesCount(where: { status: { not: { equals: "closed" } } })
    duePdmp: pdmpReportsCount(where: { status: { equals: "pending" } })
    staffMembers(where: { active: { equals: true }, kind: { in: ["dvm", "rvt"] } }, orderBy: { displayName: asc }, take: 100) { id displayName }
    drugProducts(where: { active: { equals: true }, csSchedule: { not: { equals: "none" } } }, orderBy: { displayName: asc }, take: 100) { id displayName }
    locations(orderBy: { name: asc }, take: 10) { id name }
  }`);
  const witnesses = [{ value: '', label: 'Choose a witness' }, ...d.staffMembers.map(s => ({ value: s.id, label: s.displayName }))];
  const open = d.csContainers.filter(c => c.status === 'open');
  const location = d.locations[0];
  const overdue = (due: string | null) => !!due && due.slice(0, 10) < today;
  return (
    <Page title="Controlled substances">
      <Tabs items={VIEWS.map(([k, l]) => ({ key: k, label: l, href: `${path}?view=${k}`, count: k === 'cases' ? d.openCases : k === 'pdmp' ? d.duePdmp : undefined }))} active={view} />
      {view === 'register' ? (
        <>
          <Section title="Latest entries" aside={<a className="inline-flex min-h-11 items-center text-sm underline" href={`${path}/export`}>Export register</a>}>
            {d.csLogEntries.length ? d.csLogEntries.map(e => (
              <Row key={e.id}>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{label(e.type)}</span> {signed(clean(e.qtySigned))} {e.unit} · {e.container?.ref}
                  <Meta>{when(e.occurredAt, tz, 'dayTime')} · {e.actor?.displayName}{e.witness ? ` · witness ${e.witness.displayName}` : ''}{e.reason ? ` · ${e.reason}` : ''}</Meta>
                </div>
              </Row>
            )) : <Empty>No entries yet.</Empty>}
          </Section>
          <Section title="Waste a dose">
            <p className="text-xs text-muted-foreground">Waste needs a second person who watched. The register entry cannot be changed afterwards.</p>
            <CommandForm op="wasteControlled" build="wasteControlled" submit="Record waste" paths={[path]}
              fields={[{ name: 'containerId', label: 'Container', width: 'lg', options: [{ value: '', label: 'Choose a container' }, ...open.map(c => ({ value: c.id, label: `${c.ref} · ${c.product?.displayName} · ${clean(c.balance)} ${c.labelUnit} left` }))] }, { name: 'qty', label: 'Amount', width: 'sm' }, { name: 'reason', label: 'Reason', width: 'lg' }, { name: 'witnessId', label: 'Witness', width: 'lg', options: witnesses }]} />
          </Section>
          <Section title="Report a theft or loss">
            <p className="text-xs text-muted-foreground">Starts the clocks for the DEA notice and Form 106.</p>
            <CommandForm op="reportCsLoss" build="reportCsLoss" submit="Report" paths={[path]} confirm="Record this in the register and start the DEA reporting clocks?"
              fields={[{ name: 'containerId', label: 'Container', width: 'lg', options: [{ value: '', label: 'Choose a container' }, ...d.csContainers.map(c => ({ value: c.id, label: `${c.ref} · ${clean(c.balance)} ${c.labelUnit}` }))] }, { name: 'kind', label: 'What happened', width: 'md', options: [{ value: 'loss', label: 'Loss' }, { value: 'theft', label: 'Theft' }] }, { name: 'qty', label: 'Amount', width: 'sm' }, { name: 'description', label: 'What was found', width: 'full' }, { name: 'witnessId', label: 'Witness', width: 'lg', options: witnesses }]} />
          </Section>
        </>
      ) : null}
      {view === 'containers' ? (
        <>
          <Section title="Containers">
            {d.csContainers.length ? d.csContainers.map(c => (
              <Row key={c.id}>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{c.ref}</span> · {c.product?.displayName} · {clean(c.balance)} {c.labelUnit} on the register
                  <Meta>lot {c.lotNumber}{c.lotExpiresOn ? ` · expires ${calendarDay(c.lotExpiresOn)}` : ''}</Meta>
                </div>
                <Status value={c.status} />
                {c.status === 'sealed' ? <ActionButton op="openControlled" vars={{ containerId: c.id, expectedVersion: c.version }} paths={[`${path}?view=containers`]}>Open</ActionButton> : null}
              </Row>
            )) : <Empty>No containers.</Empty>}
          </Section>
          <Section title="Receive a bottle">
            <CommandForm op="receiveControlled" build="receiveControlled" submit="Receive" paths={[`${path}?view=containers`]} fixed={location ? { locationId: location.id } : {}}
              fields={[{ name: 'productId', label: 'Drug', width: 'lg', options: [{ value: '', label: 'Choose a drug' }, ...d.drugProducts.map(p => ({ value: p.id, label: p.displayName }))] }, { name: 'lotNumber', label: 'Lot number', width: 'md' }, { name: 'lotExpiresOn', label: 'Expires (YYYY-MM-DD)', width: 'md' }, { name: 'labelQty', label: 'Amount on the label', width: 'sm' }, { name: 'labelUnit', label: 'Unit', width: 'sm', options: CS_UNITS.map(u => ({ value: u, label: u })) }, { name: 'orderFormReference', label: 'Order form number (Schedule II)', width: 'md' }]} />
          </Section>
          <Section title="Count every open container">
            <p className="text-xs text-muted-foreground">Count what is physically in each open container. A difference is recorded in the register and opens a discrepancy case.</p>
            {open.length ? (
              <CommandForm op="countControlled" build="countControlled" submit="Record count" paths={[`${path}?view=containers`]} fixed={location ? { locationId: location.id } : {}}
                fields={[{ name: 'kind', label: 'Kind of count', width: 'md', options: [{ value: 'periodic', label: 'Periodic' }, { value: 'spot', label: 'Spot check' }, { value: 'biennial', label: 'Biennial' }, { value: 'initial', label: 'Initial' }] }, { name: 'witnessId', label: 'Witness', width: 'lg', options: witnesses }, ...open.map(c => ({ name: `count_${c.id}`, label: `${c.ref} · ${c.product?.displayName} (${c.labelUnit})`, width: 'md' as const }))]} />
            ) : <Empty>No open containers to count.</Empty>}
          </Section>
          <Section title="Destroy stock">
            <CommandForm op="destroyControlled" build="destroyControlled" submit="Record destruction" paths={[`${path}?view=containers`]} confirm="Record this destruction? Two witnesses are required and it cannot be undone."
              fields={[{ name: 'containerId', label: 'Container', width: 'lg', options: [{ value: '', label: 'Choose a container' }, ...d.csContainers.map(c => ({ value: c.id, label: `${c.ref} · ${clean(c.balance)} ${c.labelUnit}` }))] }, { name: 'qty', label: 'Amount (blank for all)', width: 'sm' }, { name: 'method', label: 'Method', width: 'lg', placeholder: 'Reverse distributor pickup' }, { name: 'form41Reference', label: 'Form 41 reference', width: 'md' }, { name: 'witnessAId', label: 'First witness', width: 'lg', options: witnesses }, { name: 'witnessBId', label: 'Second witness', width: 'lg', options: witnesses }]} />
          </Section>
        </>
      ) : null}
      {view === 'cases' ? (
        <Section title="Discrepancies, thefts and losses">
          {d.csDiscrepancyCases.length ? d.csDiscrepancyCases.map(c => (
            <Row key={c.id}>
              <div className="min-w-0 flex-1">
                <span className="font-medium">{c.ref}</span> · {label(c.kind)} · {clean(c.qty)} {c.unit} · {c.container?.ref}
                <Meta>{c.description}</Meta>
                <Meta>
                  DEA notice {c.noticeReference ? `given (${c.noticeReference})` : `due ${calendarDay(c.noticeDueOn)}${overdue(c.noticeDueOn) && c.status === 'open' ? ', overdue' : ''}`} · Form 106 {c.form106Reference ? `filed (${c.form106Reference})` : `due ${calendarDay(c.form106DueOn)}${overdue(c.form106DueOn) && c.status !== 'form_filed' && c.status !== 'closed' ? ', overdue' : ''}`}
                </Meta>
                {c.status !== 'closed' ? (
                  <CommandForm className="mt-2" op="advanceDiscrepancy" build="advanceDiscrepancyStep" submit={c.status === 'open' ? 'Record notice' : c.status === 'notified' ? 'Record Form 106' : 'Close case'} fixed={{ caseId: c.id, expectedVersion: String(c.version), step: c.status === 'open' ? 'notice' : c.status === 'notified' ? 'form106' : 'close' }} paths={[`${path}?view=cases`]}
                    fields={c.status === 'form_filed' || (c.kind === 'count_variance' && false) ? [{ name: 'resolution', label: 'How it was resolved', width: 'full' }] : [{ name: 'reference', label: c.status === 'open' ? 'Notice confirmation' : 'Form 106 confirmation', width: 'lg' }]} />
                ) : null}
              </div>
              <Status value={c.status} />
            </Row>
          )) : <Empty>No discrepancies. Counts that match the register open nothing.</Empty>}
        </Section>
      ) : null}
      {view === 'orders' ? <OrdersTransfers path={path} tz={tz} today={today} location={location} witnesses={witnesses.filter(w => w.value)} containers={d.csContainers.filter(c => c.status === 'open' || c.status === 'sealed').map(c => ({ value: c.id, label: `${c.ref} · ${c.product?.displayName}` }))} /> : null}
      {view === 'pdmp' ? (
        <Section title="State prescription-monitoring reports">
          <p className="text-xs text-muted-foreground">Upload on the state programme&apos;s site, then record the confirmation here.</p>
          {d.pdmpReports.length ? d.pdmpReports.map(r => (
            <Row key={r.id}>
              <div className="min-w-0 flex-1"><span className="font-medium">{r.ref}</span> · {r.dispense?.ref}<Meta>{r.program} · due {calendarDay(r.dueOn)}{r.status === 'pending' && overdue(r.dueOn) ? ', overdue' : ''}</Meta></div>
              <Status value={r.status} />
              {r.status === 'pending' ? <CommandForm op="submitPdmp" build="submitPdmp" submit="Record upload" fixed={{ reportId: r.id, expectedVersion: String(r.version) }} paths={[`${path}?view=pdmp`]} fields={[{ name: 'confirmation', label: 'Confirmation number', width: 'md' }]} /> : null}
            </Row>
          )) : <Empty>No reports.</Empty>}
        </Section>
      ) : null}
    </Page>
  );
}
