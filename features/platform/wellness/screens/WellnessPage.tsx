import Link from 'next/link';
import { q } from '../../lib/server';
import { calendarDay, money, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

const PATH = '/dashboard/platform/wellness';
const METHODS = [{ value: 'in_person', label: 'In person' }, { value: 'portal', label: 'Online' }, { value: 'phone_recorded', label: 'Phone, recorded' }];

type Plan = { id: string; code: string; name: string; summary: string | null; status: string };
type Version = { id: string; label: string; status: string; monthlyPriceMinor: string; termMonths: number; plan: { id: string; name: string } | null };
type Enr = { id: string; ref: string; status: string; version: number; startedOn: string; termStartsOn: string; termEndsOn: string; cardLabel: string | null; trueUpMinor: string | null; patient: { name: string } | null; client: { displayName: string } | null; plan: { name: string } | null; planVersion: { monthlyPriceMinor: string } | null };
type Attempt = { id: string; periodKey: string; generation: number; status: string; amountMinor: string; message: string | null; enrollment: { ref: string; patient: { name: string } | null } | null };

/** Wellness plans: plan versions, enrolments with consent, monthly billing run, included care. */
export default async function WellnessPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const views = ['members', 'billing', 'plans'] as const;
  const view = (views as readonly string[]).includes(sp.view ?? '') ? (sp.view as (typeof views)[number]) : 'members';
  const base = await q<{ open: number; trouble: number }>(`{
    open: enrollmentsCount(where: { status: { in: ["active", "past_due"] } })
    trouble: planBillingAttemptsCount(where: { status: { in: ["failed", "unknown"] } })
  }`);
  return (
    <Page title="Wellness plans">
      <Tabs
        items={[
          { key: 'members', label: 'Members', href: PATH, count: base.open },
          { key: 'billing', label: 'Monthly billing', href: `${PATH}?view=billing`, count: base.trouble },
          { key: 'plans', label: 'Plans', href: `${PATH}?view=plans` },
        ]}
        active={view}
      />
      {view === 'members' ? await Members() : null}
      {view === 'billing' ? await Billing() : null}
      {view === 'plans' ? await Plans() : null}
    </Page>
  );
}

async function Members() {
  const d = await q<{ enrollments: Enr[]; patients: { id: string; name: string; ownerships: { client: { displayName: string } | null }[] }[]; versions: Version[]; people: { id: string; firstName: string; lastName: string; client: { displayName: string } | null }[] }>(`{
    enrollments(orderBy: { createdAt: desc }, take: 40) { id ref status version startedOn termStartsOn termEndsOn cardLabel trueUpMinor patient { name } client { displayName } plan { name } planVersion { monthlyPriceMinor } }
    patients(where: { status: { equals: "active" } }, orderBy: { name: asc }, take: 300) { id name ownerships(where: { effectiveTo: null, role: { equals: "primary" } }, take: 1) { client { displayName } } }
    versions: wellnessPlanVersions(where: { status: { equals: "published" } }, orderBy: { label: asc }, take: 50) { id label status monthlyPriceMinor termMonths plan { id name } }
    people: clientPeople(orderBy: { lastName: asc }, take: 300) { id firstName lastName client { displayName } }
  }`);
  return (
    <>
      <Section title="Enrol a pet">
        <CommandForm op="enrolPatient" build="phase5" submit="Enrol and take first month" paths={[PATH]} fields={[
          { name: 'patientId', label: 'Patient', options: [{ value: '', label: 'Choose a patient' }, ...d.patients.map(p => ({ value: p.id, label: `${p.name} · ${p.ownerships[0]?.client?.displayName ?? 'no owner on file'}` }))] },
          { name: 'planVersionId', label: 'Plan', options: [{ value: '', label: 'Choose a plan' }, ...d.versions.map(v => ({ value: v.id, label: `${v.plan?.name} · ${v.label} · ${money(v.monthlyPriceMinor)} a month` }))] },
          { name: 'signerId', label: 'Who is signing', options: [{ value: '', label: 'Choose the signer' }, ...d.people.map(p => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.client?.displayName ?? ''}` }))] },
          { name: 'method', label: 'How it was signed', options: METHODS, defaultValue: 'in_person' },
          { name: 'affirmed', label: 'Read the renewal terms aloud and the signer agrees', options: [{ value: 'false', label: 'Not yet' }, { value: 'true', label: 'Yes, agreed' }], defaultValue: 'false' },
          { name: 'paymentMethodId', label: 'Card token from the card form', hint: 'Test mode: pm_card_visa', placeholder: 'pm_card_visa' },
        ]} />
        <Meta>The plan renews every term until the client cancels. The renewal terms and cancellation steps are shown to the signer and saved with their agreement.</Meta>
      </Section>
      <Section title="Members" aside={<Link className="inline-flex h-11 items-center px-2 text-sm underline sm:h-8" href="/dashboard/platform/wellness/export?kind=renewals" prefetch={false}>Export renewal notices</Link>}>
        {d.enrollments.length ? d.enrollments.map(e => (
          <div key={e.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{e.patient?.name}</span> · {e.client?.displayName}<Meta>{e.plan?.name} · {e.planVersion ? money(e.planVersion.monthlyPriceMinor) : ''} a month · term {calendarDay(e.termStartsOn)} to {calendarDay(e.termEndsOn)}{e.cardLabel ? ` · ${e.cardLabel}` : ''}</Meta></div>
              <Status value={e.status} />
            </Row>
            {['active', 'past_due'].includes(e.status) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <CommandForm op="useEntitlement" build="phase5" submit="Use included care" fixed={{ enrollmentId: e.id }} paths={[PATH]} fields={[{ name: 'code', label: 'Item code', placeholder: 'EXAM', width: 'sm' }, { name: 'qty', label: 'How many', defaultValue: '1', width: 'sm' }]} />
                <CommandForm op="replacePlanCard" build="phase5" submit="Replace card" fixed={{ enrollmentId: e.id, affirmed: 'true' }} paths={[PATH]} fields={[
                  { name: 'signerId', label: 'Who is signing', options: [{ value: '', label: 'Choose the signer' }, ...d.people.map(p => ({ value: p.id, label: `${p.firstName} ${p.lastName}` }))] },
                  { name: 'paymentMethodId', label: 'New card token', placeholder: 'pm_card_visa' },
                ]} />
                <ActionButton op="cancelEnrollment" vars={{ enrollmentId: e.id, expectedVersion: e.version }} ask="Why is this plan being cancelled?" confirm="Cancel this plan? Care used above what was paid is charged once." paths={[PATH]}>Cancel plan</ActionButton>
              </div>
            ) : null}
          </div>
        )) : <Empty>No one is enrolled yet.</Empty>}
      </Section>
    </>
  );
}

async function Billing() {
  const d = await q<{ runs: { id: string; ref: string; periodKey: string; attemptCount: number; succeededCount: number; failedCount: number; openCount: number; skippedCount: number; totalMinor: string; finishedAt: string | null }[]; attempts: Attempt[] }>(`{
    runs: planBillingRuns(orderBy: { createdAt: desc }, take: 12) { id ref periodKey attemptCount succeededCount failedCount openCount skippedCount totalMinor finishedAt }
    attempts: planBillingAttempts(where: { status: { in: ["failed", "unknown"] } }, orderBy: { startedAt: desc }, take: 40) { id periodKey generation status amountMinor message enrollment { ref patient { name } } }
  }`);
  return (
    <>
      <Section title="Charge this month's plans">
        <CommandForm op="runPlanBilling" build="phase5" submit="Run billing" confirm="Charge every member who has not paid for this month?" paths={[PATH]} fields={[{ name: 'periodKey', label: 'Month (blank for this month)', placeholder: '2026-11', width: 'sm' }]} />
        <Meta>Each member is charged once for a month, even if this is pressed twice. A declined card is not tried again until staff press Retry after the card is replaced.</Meta>
      </Section>
      <Section title="Needs attention">
        {d.attempts.length ? d.attempts.map(a => (
          <Row key={a.id}>
            <div className="min-w-0 flex-1 text-sm">{a.enrollment?.patient?.name} · {a.periodKey}<Meta>{money(a.amountMinor)} · try {a.generation}{a.message ? ` · ${a.message}` : ''}</Meta></div>
            <Status value={a.status} />
            {a.status === 'unknown' ? <ActionButton op="checkPlanCharge" vars={{ attemptId: a.id }} paths={[PATH]}>Check status</ActionButton> : <ActionButton op="retryPlanCharge" vars={{ attemptId: a.id }} confirm="Charge the replacement card now?" paths={[PATH]}>Retry</ActionButton>}
          </Row>
        )) : <Empty>No declined or unconfirmed charges.</Empty>}
      </Section>
      <Section title="Past runs" aside={<Link className="inline-flex h-11 items-center px-2 text-sm underline sm:h-8" href="/dashboard/platform/wellness/export?kind=billing" prefetch={false}>Export</Link>}>
        {d.runs.length ? d.runs.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 text-sm">{r.ref} · {r.periodKey}<Meta>{r.succeededCount} paid · {r.failedCount} declined · {r.openCount} unconfirmed · {r.skippedCount} skipped · {money(r.totalMinor)}</Meta></div>
            <Status value="completed" />
          </Row>
        )) : <Empty>No billing run yet.</Empty>}
      </Section>
    </>
  );
}

async function Plans() {
  const d = await q<{ plans: Plan[]; versions: Version[] }>(`{
    plans: wellnessPlans(orderBy: { name: asc }, take: 30) { id code name summary status }
    versions: wellnessPlanVersions(orderBy: { createdAt: desc }, take: 40) { id label status monthlyPriceMinor termMonths plan { id name } }
  }`);
  return (
    <>
      <Section title="Plans offered">
        {d.plans.length ? d.plans.map(p => (
          <Row key={p.id}>
            <div className="min-w-0 flex-1 text-sm"><span className="font-medium">{p.name}</span><Meta>{p.summary}</Meta>
              {d.versions.filter(v => v.plan?.id === p.id).map(v => <Meta key={v.id}>{v.label} · {money(v.monthlyPriceMinor)} a month · {v.termMonths} months · {label(v.status)}</Meta>)}</div>
            <Status value={p.status} />
          </Row>
        )) : <Empty>No plans yet.</Empty>}
      </Section>
      <Section title="Publish a plan version">
        <CommandForm op="savePlanVersion" build="phase5" submit="Save version" paths={[PATH]} fields={[
          { name: 'code', label: 'Short code', placeholder: 'SENIOR', width: 'sm' }, { name: 'name', label: 'Plan name' }, { name: 'label', label: 'Version name', placeholder: 'Senior 2027' },
          { name: 'monthlyPrice', label: 'Monthly price (dollars)', width: 'sm' }, { name: 'termMonths', label: 'Months in a term', defaultValue: '12', width: 'sm' },
          { name: 'speciesCodes', label: 'Species (comma separated)', placeholder: 'canine, feline' },
          { name: 'entitlements', label: 'Included care, one per line: code | name | how many | retail price', multiline: 4, width: 'full', placeholder: 'EXAM | Wellness exam | 2 | 65' },
          { name: 'trueUpNote', label: 'Cancellation note shown to the client', width: 'full' },
        ]} />
      </Section>
    </>
  );
}
