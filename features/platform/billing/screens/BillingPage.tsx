import { q } from '../../lib/server';
import { calendarDay, money, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';
import { ageBucket, AGE_BUCKETS, AGE_LABEL } from '../../lib/ageing';

type Opt = { value: string; label: string };
const PATH = '/dashboard/platform/billing';
const TAX: Opt[] = [
  { value: 'professional_service', label: 'Service, not taxed' }, { value: 'merchandise', label: 'Merchandise' }, { value: 'rx_animal_drug', label: 'Prescription medicine' },
  { value: 'vaccine_administered', label: 'Vaccine given in clinic' }, { value: 'diet', label: 'Diet' },
];
const METHODS: Opt[] = [
  { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'ach', label: 'Bank transfer' }, { value: 'card_present', label: 'Card on the reader' },
  { value: 'financing', label: 'Financing' }, { value: 'insurer_direct', label: 'Insurer payment' },
];

/** Estimates, treatment plans, invoices, payments, receivables, fee schedule and insurance claims (BUILD-PLAN P4). */
export default async function BillingPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const views = ['invoices', 'estimates', 'plans', 'payments', 'receivables', 'fees', 'claims'] as const;
  const view = (views as readonly string[]).includes(sp.view ?? '') ? (sp.view as (typeof views)[number]) : 'invoices';
  const base = await q<{ unpaid: number; waiting: number; claimsOpen: number; refundsWaiting: number }>(`{
    unpaid: invoicesCount(where: { status: { in: ["posted", "partially_paid"] } })
    waiting: estimateVersionsCount(where: { status: { equals: "presented" } })
    claimsOpen: insuranceClaimPacketsCount(where: { status: { in: ["draft", "ready", "submitted", "under_review", "more_info_requested"] } })
    refundsWaiting: refundsCount(where: { status: { in: ["requested", "unknown"] } })
  }`);
  return (
    <Page title="Billing">
      <Tabs
        items={[
          { key: 'invoices', label: 'Checkout & invoices', href: PATH, count: base.unpaid },
          { key: 'estimates', label: 'Estimates', href: `${PATH}?view=estimates`, count: base.waiting },
          { key: 'plans', label: 'Treatment plans', href: `${PATH}?view=plans` },
          { key: 'payments', label: 'Payments & refunds', href: `${PATH}?view=payments`, count: base.refundsWaiting },
          { key: 'receivables', label: 'Who owes', href: `${PATH}?view=receivables` },
          { key: 'fees', label: 'Fee schedule', href: `${PATH}?view=fees` },
          { key: 'claims', label: 'Insurance', href: `${PATH}?view=claims`, count: base.claimsOpen },
        ]}
        active={view}
      />
      {view === 'invoices' ? await Invoices() : null}
      {view === 'estimates' ? await Estimates() : null}
      {view === 'plans' ? await Plans() : null}
      {view === 'payments' ? await Payments() : null}
      {view === 'receivables' ? await Receivables() : null}
      {view === 'fees' ? await Fees() : null}
      {view === 'claims' ? await Claims() : null}
    </Page>
  );
}

type Inv = { id: string; ref: string; status: string; version: number; totalMinor: string; balanceMinor: string; currencyCode: string; postedOn: string | null; client: { id: string; displayName: string } | null; lines: { id: string; description: string; qty: string; extendedMinor: string; discountMinor: string; taxMinor: string; reversedAt: string | null }[] };

async function Invoices() {
  const d = await q<{ invoices: Inv[]; chargeLines: { id: string; description: string; extendedMinor: string; taxMinor: string; client: { id: string; displayName: string } | null; patient: { name: string } | null }[]; patients: { id: string; name: string }[]; feeItems: { id: string; name: string; priceMinor: string }[] }>(`{
    invoices(orderBy: { createdAt: desc }, take: 25) { id ref status version totalMinor balanceMinor currencyCode postedOn client { id displayName } lines(where: { reversedAt: { equals: null } }, orderBy: { capturedAt: asc }, take: 30) { id description qty extendedMinor discountMinor taxMinor reversedAt } }
    chargeLines(where: { invoice: null, reversedAt: { equals: null } }, orderBy: { capturedAt: asc }, take: 100) { id description extendedMinor taxMinor client { id displayName } patient { name } }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name }
    feeItems(where: { active: { equals: true }, version: { status: { equals: "published" } } }, orderBy: { name: asc }, take: 300) { id name priceMinor }
  }`);
  const byClient = new Map<string, { name: string; lines: typeof d.chargeLines }>();
  for (const c of d.chargeLines) if (c.client) { const g = byClient.get(c.client.id) ?? { name: c.client.displayName, lines: [] }; g.lines.push(c); byClient.set(c.client.id, g); }
  return (
    <>
      <Section title="Charges not yet on an invoice">
        {byClient.size ? [...byClient.entries()].map(([id, g]) => (
          <div key={id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{g.name}</span><Meta>{g.lines.length} {g.lines.length === 1 ? 'charge' : 'charges'} · {money(String(g.lines.reduce((n, l) => n + BigInt(l.extendedMinor) + BigInt(l.taxMinor), 0n)))}</Meta></div>
              <CommandForm op="draftInvoice" build="billing" submit="Start invoice" fixed={{ clientId: id }} paths={[PATH]} fields={[]} />
            </Row>
            {g.lines.map(l => (
              <Row key={l.id}>
                <div className="min-w-0 flex-1 text-sm">{l.description}<Meta>{l.patient?.name} · {money(l.extendedMinor)}{BigInt(l.taxMinor) > 0n ? ` + ${money(l.taxMinor)} tax` : ''}</Meta></div>
                <ActionButton op="reverseCharge" vars={{ chargeId: l.id }} ask="Why is this charge being removed?" paths={[PATH]}>Remove</ActionButton>
              </Row>
            ))}
          </div>
        )) : <Empty>Everything captured has been invoiced.</Empty>}
      </Section>
      <Section title="Add a charge">
        <CommandForm op="addFeeCharge" build="billing" submit="Add charge" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: p.name }))] },
          { name: 'feeItemId', label: 'Service or item', options: [{ value: '', label: 'Choose from the fee schedule' }, ...d.feeItems.map(f => ({ value: f.id, label: `${f.name} · ${money(f.priceMinor)}` }))] },
          { name: 'qty', label: 'Quantity', defaultValue: '1', width: 'sm' },
        ]} />
        <CommandForm className="mt-3" op="addManualCharge" build="billing" submit="Add custom charge" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: p.name }))] },
          { name: 'description', label: 'What for' }, { name: 'amount', label: 'Amount (dollars)', width: 'sm' },
          { name: 'taxCategory', label: 'Tax', options: TAX, defaultValue: 'professional_service' }, { name: 'reason', label: 'Why it is not on the fee schedule' },
        ]} />
      </Section>
      <Section title="Invoices">
        {d.invoices.length ? d.invoices.map(i => (
          <div key={i.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{i.status === 'draft' ? 'Draft invoice' : i.ref}</span> · {i.client?.displayName}<Meta>{i.postedOn ? `Posted ${calendarDay(i.postedOn)} · ` : ''}Total {money(i.totalMinor, i.currencyCode)}{['posted', 'partially_paid'].includes(i.status) ? ` · Owing ${money(i.balanceMinor, i.currencyCode)}` : ''}</Meta></div>
              <Status value={i.status} />
            </Row>
            {i.lines.map(l => <Row key={l.id}><div className="min-w-0 flex-1 pl-3 text-sm">{l.description}<Meta>{money(String(BigInt(l.extendedMinor) - BigInt(l.discountMinor)), i.currencyCode)}{BigInt(l.taxMinor) > 0n ? ` + ${money(l.taxMinor, i.currencyCode)} tax` : ''}</Meta></div></Row>)}
            {i.status === 'draft' ? (
              <>
                <CommandForm className="mt-2" op="discountInvoice" build="billing" submit="Apply discount" fixed={{ invoiceId: i.id }} paths={[PATH]} fields={[{ name: 'percent', label: 'Percent off', width: 'sm' }, { name: 'reason', label: 'Reason' }]} />
                <div className="mt-2"><ActionButton op="postInvoice" vars={{ invoiceId: i.id, expectedVersion: i.version }} confirm="Post this invoice? Its amounts are fixed once posted." paths={[PATH]}>Post invoice</ActionButton></div>
              </>
            ) : null}
            {['posted', 'partially_paid'].includes(i.status) ? (
              <>
                <CommandForm className="mt-2" op="recordPayment" build="billing" submit="Record payment" fixed={{ invoiceId: i.id, clientId: i.client?.id ?? '' }} paths={[PATH]} fields={[
                  { name: 'method', label: 'Paid by', options: METHODS.filter(m => m.value !== 'insurer_direct'), defaultValue: 'cash' }, { name: 'amount', label: 'Amount (dollars)', defaultValue: (Number(i.balanceMinor) / 100).toFixed(2), width: 'sm' }, { name: 'reference', label: 'Check or reference no.', width: 'sm' },
                ]} />
                <CommandForm className="mt-2" op="takeCardPayment" build="billing" submit="Charge card on file" fixed={{ invoiceId: i.id, clientId: i.client?.id ?? '' }} paths={[PATH]} fields={[{ name: 'amount', label: 'Amount (dollars)', defaultValue: (Number(i.balanceMinor) / 100).toFixed(2), width: 'sm' }]} />
              </>
            ) : null}
            {['posted', 'partially_paid', 'paid'].includes(i.status) ? (
              <CommandForm className="mt-2" op="issueCreditNote" build="billing" submit="Issue credit" fixed={{ invoiceId: i.id }} paths={[PATH]} fields={[{ name: 'amount', label: 'Credit (dollars)', width: 'sm' }, { name: 'reason', label: 'Reason' }]} />
            ) : null}
            {['posted', 'partially_paid'].includes(i.status) ? (
              <div className="mt-2"><ActionButton op="requestWriteOff" vars={{ invoiceId: i.id }} ask="Why is the balance being written off?" paths={[PATH]}>Write off balance</ActionButton></div>
            ) : null}
          </div>
        )) : <Empty>No invoices yet.</Empty>}
      </Section>
    </>
  );
}

async function Estimates() {
  const d = await q<{ estimates: { id: string; ref: string; title: string; status: string; elective: boolean; patient: { name: string } | null; client: { id: string; displayName: string } | null; versions: { id: string; versionNo: number; status: string; version: number; quoteHash: string; validUntil: string | null; options: { id: string; label: string; lowTotalMinor: string; highTotalMinor: string; recommended: boolean; currencyCode: string; lines: { id: string; description: string; qtyLow: string; qtyHigh: string; lowMinor: string; highMinor: string }[] }[] }[] }[]; patients: { id: string; name: string }[]; locations: { id: string; name: string }[]; feeItems: { id: string; name: string; priceMinor: string }[]; people: { id: string; firstName: string; lastName: string; client: { id: string } | null }[] }>(`{
    estimates(orderBy: { createdAt: desc }, take: 20) { id ref title status elective patient { name } client { id displayName } versions(orderBy: { versionNo: desc }, take: 1) { id versionNo status version quoteHash validUntil options(orderBy: { createdAt: asc }, take: 4) { id label lowTotalMinor highTotalMinor recommended currencyCode lines(orderBy: { sortOrder: asc }, take: 20) { id description qtyLow qtyHigh lowMinor highMinor } } } }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name }
    locations(orderBy: { name: asc }, take: 10) { id name }
    feeItems(where: { active: { equals: true }, version: { status: { equals: "published" } } }, orderBy: { name: asc }, take: 300) { id name priceMinor }
    people: clientPeople(where: { canApproveTreatment: { equals: true } }, take: 300) { id firstName lastName client { id } }
  }`);
  const fee: Opt[] = [{ value: '', label: 'None' }, ...d.feeItems.map(f => ({ value: f.id, label: `${f.name} · ${money(f.priceMinor)}` }))];
  return (
    <>
      <Section title="Estimates">
        <CommandForm op="refreshEstimates" build="billing" submit="Check for expired estimates" paths={[PATH]} fields={[]} />
        {d.estimates.length ? d.estimates.map(e => {
          const v = e.versions[0];
          const signers = d.people.filter(p => p.client?.id === e.client?.id);
          return (
            <div key={e.id} className="border-b py-2 last:border-0">
              <Row>
                <div className="min-w-0 flex-1"><span className="font-medium">{e.title}</span> · {e.patient?.name}<Meta>{e.ref} · {e.client?.displayName}{v ? ` · version ${v.versionNo}` : ''}{v?.validUntil ? ` · good until ${calendarDay(v.validUntil.slice(0, 10))}` : ''}</Meta></div>
                <Status value={v?.status ?? e.status} />
              </Row>
              {v?.options.map(o => (
                <div key={o.id} className="pl-3 text-sm">
                  <div className="font-medium">{o.label}{o.recommended ? ' (recommended)' : ''}: {money(o.lowTotalMinor, o.currencyCode)} to {money(o.highTotalMinor, o.currencyCode)}</div>
                  {o.lines.map(l => <Meta key={l.id}>{l.description} · {Number(l.qtyLow) === Number(l.qtyHigh) ? Number(l.qtyLow) : `${Number(l.qtyLow)} to ${Number(l.qtyHigh)}`} · {money(l.lowMinor)} to {money(l.highMinor)}</Meta>)}
                  {v.status === 'presented' && signers.length ? (
                    <CommandForm className="mt-2" op="acceptEstimate" build="billing" submit="Client accepts this option" fixed={{ versionId: v.id, optionId: o.id, quoteHash: v.quoteHash, expectedVersion: String(v.version) }} paths={[PATH]} fields={[
                      { name: 'signerId', label: 'Who agreed', options: signers.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` })) },
                      { name: 'method', label: 'How', options: [{ value: 'in_person_signature', label: 'Signed in person' }, { value: 'verbal_witnessed', label: 'Said yes, staff witnessed' }, { value: 'esign_link', label: 'Signed on a link' }] },
                      { name: 'signatureText', label: 'Name as signed or given' },
                    ]} />
                  ) : null}
                </div>
              ))}
              {v?.status === 'draft' ? <div className="mt-2"><ActionButton op="presentEstimate" vars={{ versionId: v.id, expectedVersion: v.version }} paths={[PATH]}>Show to client</ActionButton></div> : null}
              {v && ['presented', 'expired'].includes(v.status) ? <div className="mt-2 flex flex-wrap gap-2"><ActionButton op="reviseEstimate" vars={{ estimateId: e.id }} paths={[PATH]}>Make a new version</ActionButton>{v.status === 'presented' ? <ActionButton op="declineEstimate" vars={{ versionId: v.id, expectedVersion: v.version }} ask="Why did the client decline?" paths={[PATH]}>Client declined</ActionButton> : null}</div> : null}
            </div>
          );
        }) : <Empty>No estimates yet.</Empty>}
      </Section>
      <Section title="New estimate">
        <CommandForm op="startEstimate" build="estimate" submit="Create estimate" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: p.name }))] },
          { name: 'locationId', label: 'Location', options: d.locations.map(l => ({ value: l.id, label: l.name })) },
          { name: 'title', label: 'Title', placeholder: 'Dental cleaning and extractions' }, { name: 'elective', label: 'Planned procedure (asks for a deposit)', options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], width: 'sm' },
          { name: 'fee1', label: 'Line 1', options: fee }, { name: 'low1', label: 'Least', defaultValue: '1', width: 'sm' }, { name: 'high1', label: 'Most', defaultValue: '1', width: 'sm' },
          { name: 'fee2', label: 'Line 2', options: fee }, { name: 'low2', label: 'Least', width: 'sm' }, { name: 'high2', label: 'Most', width: 'sm' },
          { name: 'fee3', label: 'Line 3', options: fee }, { name: 'low3', label: 'Least', width: 'sm' }, { name: 'high3', label: 'Most', width: 'sm' },
        ]} />
      </Section>
    </>
  );
}

async function Plans() {
  const d = await q<{ treatmentPlans: { id: string; ref: string; status: string; version: number; acceptedLowMinor: string; acceptedHighMinor: string; spentMinor: string; currencyCode: string; patient: { name: string } | null; client: { id: string; displayName: string } | null; items: { id: string; description: string; status: string; projectedMinor: string }[]; overages: { id: string; newHighMinor: string; method: string; reason: string }[] }[]; deposits: { id: string; ref: string; status: string; version: number; requestedMinor: string; client: { id: string; displayName: string } | null }[]; people: { id: string; firstName: string; lastName: string; client: { id: string } | null }[] }>(`{
    treatmentPlans(orderBy: { createdAt: desc }, take: 30) { id ref status version acceptedLowMinor acceptedHighMinor spentMinor currencyCode patient { name } client { id displayName } items(orderBy: { createdAt: asc }, take: 20) { id description status projectedMinor } overages(orderBy: { createdAt: asc }, take: 5) { id newHighMinor method reason } }
    deposits(where: { status: { in: ["requested", "paid"] } }, orderBy: { createdAt: desc }, take: 40) { id ref status version requestedMinor client { id displayName } }
    people: clientPeople(where: { canApproveTreatment: { equals: true } }, take: 300) { id firstName lastName client { id } }
  }`);
  return (
    <>
      <Section title="Treatment plans">
        {d.treatmentPlans.length ? d.treatmentPlans.map(p => {
          const pct = Math.min(100, Math.round(Number(p.spentMinor) * 100 / Math.max(1, Number(p.acceptedHighMinor))));
          const signers = d.people.filter(x => x.client?.id === p.client?.id);
          return (
            <div key={p.id} className="border-b py-2 last:border-0">
              <Row>
                <div className="min-w-0 flex-1"><span className="font-medium">{p.patient?.name}</span> · {p.client?.displayName}<Meta>{p.ref} · agreed {money(p.acceptedLowMinor, p.currencyCode)} to {money(p.acceptedHighMinor, p.currencyCode)} · used {money(p.spentMinor, p.currencyCode)} ({pct}%)</Meta></div>
                <Status value={p.status} />
              </Row>
              {p.items.map(i => <Row key={i.id}><div className="min-w-0 flex-1 pl-3 text-sm">{i.description}<Meta>{money(i.projectedMinor, p.currencyCode)}</Meta></div><Status value={i.status} /></Row>)}
              {p.overages.map(o => <Meta key={o.id}>Raised to {money(o.newHighMinor, p.currencyCode)} · {label(o.method)} · {o.reason}</Meta>)}
              {p.status === 'active' ? (
                <>
                  <CommandForm className="mt-2" op="recordOverageApproval" build="billing" submit="Record the higher amount" fixed={{ planId: p.id, expectedVersion: String(p.version) }} paths={[PATH]} fields={[
                    { name: 'newHigh', label: 'New most (dollars)', width: 'sm' },
                    { name: 'method', label: 'How', options: [{ value: 'in_person', label: 'In person' }, { value: 'phone_witnessed', label: 'By phone, staff witnessed' }, { value: 'esign_link', label: 'Signed on a link' }, { value: 'emergency_override', label: 'Vet override, emergency' }] },
                    { name: 'approverId', label: 'Who agreed', options: [{ value: '', label: 'Nobody (emergency)' }, ...signers.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))] },
                    { name: 'reason', label: 'Reason' },
                  ]} />
                  <div className="mt-2 flex flex-wrap gap-2"><ActionButton op="closePlan" vars={{ planId: p.id, expectedVersion: p.version }} paths={[PATH]}>Finish plan</ActionButton><ActionButton op="closePlan" vars={{ planId: p.id, expectedVersion: p.version, cancel: true }} ask="Why is the plan being cancelled?" paths={[PATH]}>Cancel plan</ActionButton></div>
                </>
              ) : null}
            </div>
          );
        }) : <Empty>No treatment plans yet. A plan opens when a client accepts an estimate.</Empty>}
      </Section>
      <Section title="Deposits">
        {d.deposits.length ? d.deposits.map(x => (
          <Row key={x.id}><div className="min-w-0 flex-1"><span className="font-medium">{x.client?.displayName}</span><Meta>{x.ref} · {money(x.requestedMinor)}</Meta></div><Status value={x.status} />
            {x.status === 'requested' ? <CommandForm op="recordPayment" build="billing" submit="Take deposit" fixed={{ depositId: x.id, clientId: x.client?.id ?? '', amount: (Number(x.requestedMinor) / 100).toFixed(2) }} paths={[PATH]} fields={[{ name: 'method', label: 'Paid by', options: METHODS.filter(m => m.value !== 'insurer_direct'), defaultValue: 'card_present' }]} /> : null}
          </Row>
        )) : <Empty>No deposits waiting.</Empty>}
      </Section>
    </>
  );
}

async function Payments() {
  const d = await q<{ payments: { id: string; ref: string; method: string; status: string; amountMinor: string; refundedMinor: string; currencyCode: string; receivedAt: string | null; createdAt: string; client: { displayName: string } | null; forInvoice: { id: string; ref: string } | null }[]; refunds: { id: string; ref: string; status: string; amountMinor: string; reason: string; message: string; approval: { id: string; status: string } | null; payment: { ref: string; client: { displayName: string } | null } | null }[] }>(`{
    payments(orderBy: { createdAt: desc }, take: 40) { id ref method status amountMinor refundedMinor currencyCode receivedAt createdAt client { displayName } forInvoice { id ref } }
    refunds(orderBy: { createdAt: desc }, take: 30) { id ref status amountMinor reason message approval { id status } payment { ref client { displayName } } }
  }`);
  return (
    <>
      <Section title="Payments">
        {d.payments.length ? d.payments.map(p => (
          <div key={p.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{money(p.amountMinor, p.currencyCode)}</span> · {p.client?.displayName}<Meta>{p.ref} · {label(p.method)}{p.forInvoice ? ` · ${p.forInvoice.ref}` : ''}{BigInt(p.refundedMinor) > 0n ? ` · refunded ${money(p.refundedMinor, p.currencyCode)}` : ''}</Meta></div>
              <Status value={p.status} />
              {['unknown', 'pending'].includes(p.status) ? <ActionButton op="checkPaymentStatus" vars={{ paymentId: p.id }} paths={[PATH]}>Check status</ActionButton> : null}
            </Row>
            {p.status === 'succeeded' ? <CommandForm className="mt-2" op="requestRefund" build="billing" submit="Refund" fixed={{ paymentId: p.id, invoiceId: p.forInvoice?.id ?? '' }} paths={[PATH]} fields={[{ name: 'amount', label: 'Refund (dollars)', width: 'sm' }, { name: 'reason', label: 'Reason' }]} /> : null}
          </div>
        )) : <Empty>No payments yet.</Empty>}
      </Section>
      <Section title="Refunds">
        {d.refunds.length ? d.refunds.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1"><span className="font-medium">{money(r.amountMinor)}</span> · {r.payment?.client?.displayName}<Meta>{r.ref} · {r.reason}{r.message ? ` · ${r.message}` : ''}</Meta></div>
            <Status value={r.status} />
            {r.status === 'requested' && r.approval?.status === 'approved' ? <ActionButton op="issueApprovedRefund" vars={{ refundId: r.id }} paths={[PATH]}>Send refund</ActionButton> : null}
            {r.status === 'requested' && r.approval && r.approval.status !== 'approved' ? <Meta>Waiting for an approver in Approvals</Meta> : null}
            {r.status === 'unknown' ? <ActionButton op="checkRefundStatus" vars={{ refundId: r.id }} paths={[PATH]}>Check status</ActionButton> : null}
          </Row>
        )) : <Empty>No refunds.</Empty>}
      </Section>
    </>
  );
}

async function Receivables() {
  const d = await q<{ invoices: { id: string; ref: string; postedOn: string | null; balanceMinor: string; client: { id: string; displayName: string } | null }[]; arPeriods: { id: string; label: string; status: string; version: number }[] }>(`{
    invoices(where: { status: { in: ["posted", "partially_paid"] } }, orderBy: { postedOn: asc }, take: 400) { id ref postedOn balanceMinor client { id displayName } }
    arPeriods(orderBy: { startsOn: desc }, take: 18) { id label status version }
  }`);
  const today = new Date().toISOString().slice(0, 10);
  const totals = new Map<string, bigint>(AGE_BUCKETS.map(b => [b, 0n]));
  const byClient = new Map<string, { name: string; owing: bigint; oldest: string }>();
  for (const i of d.invoices) {
    const bal = BigInt(i.balanceMinor);
    if (bal <= 0n) continue;
    const b = ageBucket(i.postedOn?.slice(0, 10) ?? today, today);
    totals.set(b, (totals.get(b) ?? 0n) + bal);
    if (i.client) { const c = byClient.get(i.client.id) ?? { name: i.client.displayName, owing: 0n, oldest: i.postedOn ?? today }; c.owing += bal; byClient.set(i.client.id, c); }
  }
  return (
    <>
      <Section title="Owing by age" aside={<a className="inline-flex h-11 items-center text-sm underline" href={`${PATH}/export?kind=ageing`}>Export</a>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{AGE_BUCKETS.map(b => <Stat key={b} name={AGE_LABEL[b]} value={money(String(totals.get(b) ?? 0n))} />)}</div>
      </Section>
      <Section title="Clients with a balance">
        {byClient.size ? [...byClient.entries()].sort((a, b) => (b[1].owing > a[1].owing ? 1 : -1)).map(([id, c]) => (
          <Row key={id}><div className="min-w-0 flex-1"><span className="font-medium">{c.name}</span><Meta>Owing {money(String(c.owing))}</Meta></div><a className="inline-flex h-11 items-center text-sm underline" href={`${PATH}/export?kind=statement&clientId=${id}`}>Statement</a></Row>
        )) : <Empty>Nobody owes the practice anything.</Empty>}
      </Section>
      <Section title="Months">
        {d.arPeriods.length ? d.arPeriods.map(p => (
          <Row key={p.id}><div className="min-w-0 flex-1 font-medium">{p.label}</div><Status value={p.status} />
            {p.status === 'open' ? <ActionButton op="closeArPeriod" vars={{ periodId: p.id, expectedVersion: p.version }} confirm="Close this month? Nothing can be posted into it afterwards." paths={[PATH]}>Close month</ActionButton> : <ActionButton op="reopenArPeriod" vars={{ periodId: p.id, expectedVersion: p.version }} ask="Why is this month being reopened?" paths={[PATH]}>Reopen</ActionButton>}
          </Row>
        )) : <Empty>Months appear as the first invoice is posted in each.</Empty>}
      </Section>
    </>
  );
}

async function Fees() {
  const d = await q<{ feeScheduleVersions: { id: string; versionNo: number; label: string; status: string; version: number; effectiveFrom: string | null; items: { id: string; code: string; name: string; category: string; priceMinor: string; taxCategory: string }[] }[] }>(`{
    feeScheduleVersions(orderBy: { versionNo: desc }, take: 5) { id versionNo label status version effectiveFrom items(where: { active: { equals: true } }, orderBy: [{ category: asc }, { name: asc }], take: 300) { id code name category priceMinor taxCategory } }
  }`);
  const draft = d.feeScheduleVersions.find(v => v.status === 'draft');
  const live = d.feeScheduleVersions.find(v => v.status === 'published');
  return (
    <>
      {draft ? (
        <Section title={`Draft: ${draft.label}`}>
          <Row><div className="min-w-0 flex-1"><Meta>{draft.items.length} items. Publishing needs a second person to approve.</Meta></div>
            <ActionButton op="requestFeePublish" vars={{ versionId: draft.id, expectedVersion: draft.version }} paths={[PATH]}>Ask to publish</ActionButton>
            <ActionButton op="discardFeeDraft" vars={{ versionId: draft.id, expectedVersion: draft.version }} confirm="Throw away this draft?" paths={[PATH]}>Discard</ActionButton></Row>
          <CommandForm className="mt-2" op="saveFeeItem" build="billing" submit="Add or change item" fixed={{ versionId: draft.id }} paths={[PATH]} fields={[
            { name: 'code', label: 'Code' }, { name: 'name', label: 'Name' }, { name: 'category', label: 'Group', placeholder: 'exam' }, { name: 'price', label: 'Price (dollars)', width: 'sm' },
            { name: 'taxCategory', label: 'Tax', options: TAX, defaultValue: 'professional_service' },
          ]} />
        </Section>
      ) : (
        <Section title="Change prices"><CommandForm op="startFeeDraft" build="billing" submit="Start a new draft from the current fees" paths={[PATH]} fields={[{ name: 'label', label: 'Name for this change', placeholder: 'Fees from July' }]} /></Section>
      )}
      <Section title={live ? `In use: ${live.label}${live.effectiveFrom ? ` (from ${calendarDay(live.effectiveFrom.slice(0, 10))})` : ''}` : 'In use'}>
        {live?.items.length ? live.items.map(i => <Row key={i.id}><div className="min-w-0 flex-1"><span className="font-medium">{i.name}</span><Meta>{i.code} · {label(i.category)} · {label(i.taxCategory)}</Meta></div><span className="font-mono text-sm">{money(i.priceMinor)}</span></Row>) : <Empty>No published fees.</Empty>}
      </Section>
    </>
  );
}

async function Claims() {
  const d = await q<{ insuranceClaimPackets: { id: string; ref: string; status: string; version: number; submitter: string; approvedMinor: string | null; statusNote: string; patient: { name: string } | null; invoice: { ref: string } | null; policy: { policyNumber: string; insurer: { name: string } | null } | null; documents: { title: string }[] }[]; invoices: { id: string; ref: string; patient: null; client: { displayName: string } | null; encounter: { patient: { id: string } | null } | null }[]; petInsurancePolicies: { id: string; policyNumber: string; insurer: { name: string } | null; patient: { name: string } | null }[]; recordsReleases: { id: string; recipient: string; at: string }[]; payerAuthorizations: { id: string; ref: string; status: string; version: number; requestedMinor: string; authorisedMinor: string | null; invoice: { ref: string } | null }[] }>(`{
    insuranceClaimPackets(orderBy: { createdAt: desc }, take: 30) { id ref status version submitter approvedMinor statusNote patient { name } invoice { ref } policy { policyNumber insurer { name } } documents }
    invoices(where: { status: { in: ["posted", "partially_paid", "paid"] } }, orderBy: { createdAt: desc }, take: 60) { id ref client { displayName } encounter { patient { id } } }
    petInsurancePolicies(orderBy: { createdAt: desc }, take: 100) { id policyNumber insurer { name } patient { name } }
    recordsReleases(orderBy: { at: desc }, take: 40) { id recipient at }
    payerAuthorizations(orderBy: { createdAt: desc }, take: 20) { id ref status version requestedMinor authorisedMinor invoice { ref } }
  }`);
  const NEXT: Record<string, { to: string; text: string }[]> = {
    draft: [{ to: 'ready', text: 'Mark ready' }], ready: [{ to: 'submitted', text: 'Mark as submitted' }],
    submitted: [{ to: 'under_review', text: 'Under review' }, { to: 'approved', text: 'Approved' }, { to: 'denied', text: 'Denied' }],
    under_review: [{ to: 'more_info_requested', text: 'More information asked' }, { to: 'approved', text: 'Approved' }, { to: 'denied', text: 'Denied' }],
    more_info_requested: [{ to: 'under_review', text: 'Back under review' }],
  };
  return (
    <>
      <Section title="Claims">
        {d.insuranceClaimPackets.length ? d.insuranceClaimPackets.map(c => (
          <div key={c.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{c.patient?.name}</span> · {c.policy?.insurer?.name}<Meta>{c.ref} · {c.invoice?.ref} · policy {c.policy?.policyNumber} · {c.documents.length} {c.documents.length === 1 ? 'record' : 'records'} attached · sent by the {c.submitter}{c.approvedMinor ? ` · approved ${money(c.approvedMinor)}` : ''}{c.statusNote ? ` · ${c.statusNote}` : ''}</Meta></div>
              <Status value={c.status} />
              <a className="inline-flex h-11 items-center text-sm underline" href={`${PATH}/export?kind=claim&id=${c.id}`}>Download</a>
            </Row>
            <div className="mt-2 flex flex-wrap gap-2">
              {(NEXT[c.status] ?? []).map(n => (
                <ActionButton key={n.to} op="advanceClaim" vars={{ claimId: c.id, to: n.to, expectedVersion: c.version }} {...(['denied', 'more_info_requested'].includes(n.to) ? { ask: 'What did the insurer say?' } : {})} paths={[PATH]}>{n.text}</ActionButton>
              ))}
            </div>
          </div>
        )) : <Empty>No claims yet.</Empty>}
      </Section>
      <Section title="Prepare a claim">
        <CommandForm op="buildClaimPacket" build="billing" submit="Prepare claim" paths={[PATH]} fields={[
          { name: 'invoiceId', label: 'Invoice', options: [{ value: '', label: 'Choose an invoice' }, ...d.invoices.map(i => ({ value: i.id, label: `${i.ref} · ${i.client?.displayName ?? ''}` }))] },
          { name: 'policyId', label: 'Policy', options: [{ value: '', label: 'Choose a policy' }, ...d.petInsurancePolicies.map(p => ({ value: p.id, label: `${p.patient?.name} · ${p.insurer?.name ?? ''} · ${p.policyNumber}` }))] },
          { name: 'recordsReleaseId', label: 'Records released for it', options: [{ value: '', label: 'No records' }, ...d.recordsReleases.map(r => ({ value: r.id, label: `${r.recipient} · ${calendarDay(r.at.slice(0, 10))}` }))] },
          { name: 'submitter', label: 'Sent by', options: [{ value: 'client', label: 'The client' }, { value: 'clinic', label: 'The clinic' }] },
        ]} />
      </Section>
      <Section title="Direct payment from the insurer">
        {d.payerAuthorizations.length ? d.payerAuthorizations.map(a => (
          <Row key={a.id}><div className="min-w-0 flex-1"><span className="font-medium">{a.invoice?.ref}</span><Meta>{a.ref} · asked {money(a.requestedMinor)}{a.authorisedMinor ? ` · authorised ${money(a.authorisedMinor)}` : ''}</Meta></div><Status value={a.status} />
            {a.status === 'requested' ? <CommandForm op="recordAuthorizationDecision" build="billing" submit="Record answer" fixed={{ authorizationId: a.id, expectedVersion: String(a.version), authorised: (Number(a.requestedMinor) / 100).toFixed(2) }} paths={[PATH]} fields={[{ name: 'decision', label: 'Insurer said', options: [{ value: 'authorised', label: 'Authorised' }, { value: 'denied', label: 'Denied' }] }, { name: 'externalRef', label: 'Their reference', width: 'sm' }]} /> : null}
          </Row>
        )) : <Empty>No direct-pay requests.</Empty>}
        <CommandForm className="mt-2" op="requestAuthorization" build="billing" submit="Ask the insurer to pay" paths={[PATH]} fields={[
          { name: 'invoiceId', label: 'Invoice', options: [{ value: '', label: 'Choose an invoice' }, ...d.invoices.map(i => ({ value: i.id, label: `${i.ref} · ${i.client?.displayName ?? ''}` }))] },
          { name: 'policyId', label: 'Policy', options: [{ value: '', label: 'Choose a policy' }, ...d.petInsurancePolicies.map(p => ({ value: p.id, label: `${p.patient?.name} · ${p.policyNumber}` }))] },
          { name: 'requested', label: 'Amount (dollars)', width: 'sm' },
        ]} />
      </Section>
    </>
  );
}
