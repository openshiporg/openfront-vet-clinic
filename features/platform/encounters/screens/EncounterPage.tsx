import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone, corrections } from '../../lib/server';
import { when, label, title, options, weight, quantity, calendarDay } from '../../lib/format';
import { ALERT_TONE, ageText, todayIn } from '../../lib/clinic';
import { DOSE_WARNING, EXAM_SYSTEMS, FREQUENCIES, ORDER_KINDS, ROUTES, SECTION_KINDS, SECTION_TITLE, asaText } from '../../lib/clinical';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';
import { ENCOUNTER_QUERY } from './encounterQuery';
import { AcceptDraft } from '../components/AcceptDraft';

type Staff = { id: string; displayName: string } | null;
type Enc = {
  id: string; ref: string; kind: string; status: string; reason: string; version: number; startedAt: string; submittedAt: string | null; signedAt: string | null; contentHash: string | null;
  completeness: { complete?: boolean; missing?: { field: string; message: string }[] } | null; voidReason: string;
  patient: { id: string; ref: string; name: string; status: string; dateOfBirth: string | null; sex: string; reproductiveStatus: string; species: { code: string; name: string } | null; breed: { name: string } | null; alerts: { id: string; severity: string; kind: string; text: string }[]; weights: { id: string; value: string; unit: string; valueKg: string; measuredAt: string }[]; } | null;
  location: { id: string; name: string } | null; attendingDvm: Staff; signedBy: Staff; stay: { id: string; ref: string; status: string } | null;
  sections: { id: string; kind: string; ordinal: number; body: string; source: string; version: number; lockedAt: string | null; lastAuthor: Staff; revisionsCount: number }[];
  addenda: { id: string; sectionKind: string; reason: string; body: string; signedAt: string; authorIsDvm: boolean; author: Staff }[];
  vitals: { id: string; at: string; temperature: string | null; temperatureUnit: string; heartRate: number | null; respRate: number | null; mucousMembranes: string; crtSeconds: string | null; painScore: number | null; by: Staff }[];
  findings: { id: string; system: string; status: string; text: string }[];
  diagnoses: { id: string; term: string; certainty: string; code: { code: string } | null }[];
  orders: { id: string; ref: string; kind: string; description: string; status: string; route: string; frequency: string; version: number; warnings: { code: string; message?: string }[] | null; overrideReason: string; drug: { id: string; csSchedule: string } | null; orderedBy: Staff; administrations: { id: string; qty: string | null; unit: string; givenAt: string; givenBy: Staff; witness: Staff; lotNumber: string; reason: string; qtyOverrideReason: string; reverses: { id: string } | null }[] }[];
};

/**
 * The medical record for one visit (BUILD-PLAN P2): SOAP sections with revisions and conflict
 * checks, vitals, exam by system, diagnoses, orders with the dose calculated from the recorded
 * weight, vaccines, signing by the veterinarian (which freezes the record), addenda, and the scribe.
 * Reading it writes a ReadAudit row.
 */
export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tz] = await Promise.all([
    q<{ encounter: Enc | null; drugProducts: { id: string; displayName: string; csSchedule: string }[]; diagnosisCodes: { id: string; code: string; term: string }[]; witnesses: { id: string; displayName: string }[]; staffMembers: { id: string; displayName: string; kind: string }[]; vaccineProducts: { id: string; name: string; isRabies: boolean }[]; vaccineLots: { id: string; lotNumber: string; expiresOn: string; vaccine: { id: string } | null; location: { id: string } | null }[]; csContainers: { id: string; ref: string; product: { id: string } | null; location: { id: string } | null }[]; inventoryLots: { id: string; lotNumber: string; expiresOn: string; drug: { id: string } | null; location: { id: string } | null }[]; scribeSessions: { id: string; status: string; clientConsent: { id: string } | null; drafts: { id: string; status: string; sections: { kind: string; body: string }[] | null; acceptedBlocks: number[] | null; version: number }[] }[]; anaesthesiaRecords: { id: string; ref: string; status: string; asaStatus: string; procedure: string }[]; practiceSettings: { features: Record<string, boolean> | null } | null; vaccineAdministrations: { id: string; source: string; reason: string; lotNumber: string; site: string; doseSeries: number; dueNextOn: string | null; product: { name: string } | null; vaccinatedBy: Staff; reverses: { id: string } | null; certificate: { id: string; ref: string; tagNumber: string; voidedAt: string | null } | null }[] }>(ENCOUNTER_QUERY, { id }),
    practiceTimeZone(),
  ]);
  const e = data?.encounter;
  if (!data || !e || !e.patient) notFound();
  const p = e.patient;
  const path = `/dashboard/platform/encounters/${e.id}`;
  const paths = [path, `/dashboard/platform/patients/${p.id}`];
  const today = todayIn(tz);
  const signed = e.status === 'signed';
  const open = ['open', 'in_progress', 'pending_signature'].includes(e.status);
  const latest = p.weights[0];
  const dvms = data.staffMembers.filter(s => s.kind === 'dvm');
  const people = data.staffMembers;
  const locId = e.location?.id;
  const bySection = new Map(e.sections.map(s => [`${s.kind}:${s.ordinal}`, s]));
  const missing = e.completeness?.missing ?? [];
  const scribeOn = data.practiceSettings?.features?.scribe === true;
  const fix = await corrections([
    { type: 'Administration', ids: e.orders.flatMap(o => o.administrations.filter(a => a.reverses).map(a => a.id)) },
    { type: 'VaccineAdministration', ids: data.vaccineAdministrations.filter(v => v.reverses).map(v => v.id) },
  ]);
  return (
    <Page title={`${p.name} · ${e.ref}`} crumbs={[{ label: 'Encounters', href: '/dashboard/platform/encounters' }, { label: p.name, href: `/dashboard/platform/patients/${p.id}` }]}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm">{e.ref}</span><Status value={e.status} />
          <Meta>{title(e.kind)} · {e.location?.name} · started {when(e.startedAt, tz)}{e.attendingDvm ? ` · attending ${e.attendingDvm.displayName}` : ''}</Meta>
        </div>
        <Meta>{p.species?.name} · {p.breed?.name ?? 'breed not recorded'} · {label(p.sex)} {label(p.reproductiveStatus)} · {p.dateOfBirth ? `${ageText(p.dateOfBirth, today)} · born ${calendarDay(p.dateOfBirth)}` : 'age unknown'}{e.reason ? ` · ${e.reason}` : ''}</Meta>
        {p.alerts.map(a => <p key={a.id} className={`rounded-md border px-3 py-2 text-sm ${a.severity === 'block' ? ALERT_TONE.critical : a.severity === 'warn' ? ALERT_TONE.warning : ALERT_TONE.info}`}><span className="font-medium">{title(a.kind)}</span> · {a.text}</p>)}
        {signed ? (
          <p className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.info}`}>Signed by {e.signedBy?.displayName} on {when(e.signedAt, tz)}. The record is frozen; corrections are addenda below.</p>
        ) : null}
        {e.status === 'voided' ? <p className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.critical}`}>Voided: {e.voidReason}</p> : null}
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Weight used for doses" value={latest ? weight(latest.value, latest.unit) : 'not weighed'} />
        <Stat name="Weighed" value={latest ? when(latest.measuredAt, tz, 'dayTime') : '—'} />
        <Stat name="Orders" value={e.orders.length} />
        <Stat name="Hospital stay" value={e.stay ? <Link className="underline" href={`/dashboard/platform/hospital?stay=${e.stay.id}`}>{e.stay.ref}</Link> : 'none'} />
      </div>

      <Section title="Vitals">
        {e.vitals.length ? e.vitals.map(v => (
          <Row key={v.id}>
            <span className="font-mono text-sm">{[v.temperature ? `T ${quantity(v.temperature)} °${v.temperatureUnit}` : null, v.heartRate ? `HR ${v.heartRate}` : null, v.respRate ? `RR ${v.respRate}` : null, v.crtSeconds ? `CRT ${quantity(v.crtSeconds)} s` : null, v.painScore !== null ? `pain ${v.painScore}/10` : null].filter(Boolean).join(' · ')}</span>
            <Meta>{v.mucousMembranes ? `MM ${v.mucousMembranes} · ` : ''}{v.by?.displayName} · {when(v.at, tz, 'time')}</Meta>
          </Row>
        )) : <Empty>No vitals yet.</Empty>}
        {open ? (
          <CommandForm op="recordVitals" build="recordVitals" submit="Record vitals" fixed={{ encounterId: e.id }} paths={paths}
            fields={[
              { name: 'temperature', label: 'Temperature', width: 'sm', placeholder: '101.5' },
              { name: 'temperatureUnit', label: 'Unit', width: 'sm', defaultValue: 'F', options: [{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }] },
              { name: 'heartRate', label: 'Heart rate', width: 'sm', placeholder: '100' },
              { name: 'respRate', label: 'Resp. rate', width: 'sm', placeholder: '24' },
              { name: 'crtSeconds', label: 'CRT (s)', width: 'sm', placeholder: '1.5' },
              { name: 'mucousMembranes', label: 'Mucous membranes', placeholder: 'pink, moist' },
              { name: 'painScore', label: 'Pain (0–10)', width: 'sm' },
            ]} />
        ) : null}
      </Section>

      <Section title="SOAP record">
        {[...(e.sections.some(x => x.kind === 'history') ? ['history'] : []), ...SECTION_KINDS].map(kind => {
          const rows = e.sections.filter(s => s.kind === kind);
          const s = bySection.get(`${kind}:1`);
          const repeat = kind === 'communication';
          if (!open && !rows.length) return null;
          return (
            <div key={kind} className="space-y-2 border-b pb-4 last:border-b-0">
              <h3 className="text-sm font-medium">{SECTION_TITLE[kind]}</h3>
              {rows.map(r => (
                <div key={r.id} className="space-y-1">
                  <p className="whitespace-pre-wrap break-words text-sm">{r.body}</p>
                  <Meta>{r.lastAuthor?.displayName ?? 'unknown author'} · {r.revisionsCount} {r.revisionsCount === 1 ? 'revision' : 'revisions'}{r.source === 'scribe' ? ' · accepted from the scribe' : r.source === 'template' ? ' · from a template' : r.source === 'import' ? ' · imported' : ''}{r.lockedAt ? ' · locked' : ''}</Meta>
                </div>
              ))}
              {open && !repeat && kind !== 'history' ? (
                <CommandForm key={`${kind}-${s?.version ?? 0}`} op="saveSoapSection" build="saveSoapSection" submit={s ? 'Save changes' : 'Save'} fixed={{ encounterId: e.id, kind, expectedVersion: s ? String(s.version) : '' }} paths={paths}
                  fields={[{ name: 'body', label: s ? 'Edit' : 'Write', width: 'full', multiline: 4, defaultValue: s?.body ?? '' }]} />
              ) : null}
              {open && repeat ? (
                <CommandForm op="saveSoapSection" build="saveSoapSection" submit="Add note" fixed={{ encounterId: e.id, kind }} paths={paths}
                  fields={[{ name: 'body', label: 'Call or message with the client', width: 'full', multiline: 2 }]} />
              ) : null}
            </div>
          );
        })}
      </Section>

      <Section title="Physical exam">
        {e.findings.length ? e.findings.map(f => (
          <Row key={f.id}><span>{title(f.system)}</span><Meta>{title(f.status)}{f.text ? ` · ${f.text}` : ''}</Meta></Row>
        )) : <Empty>No body systems recorded yet.</Empty>}
        {open ? (
          <CommandForm op="setExamFinding" build="setExamFinding" submit="Record finding" fixed={{ encounterId: e.id }} paths={paths}
            fields={[
              { name: 'system', label: 'Body system', width: 'lg', options: options(EXAM_SYSTEMS) },
              { name: 'status', label: 'Finding', width: 'sm', options: options(['normal', 'abnormal', 'not_examined']) },
              { name: 'text', label: 'Detail', width: 'lg' },
            ]} />
        ) : null}
      </Section>

      <Section title="Diagnoses">
        {e.diagnoses.length ? e.diagnoses.map(d => (
          <Row key={d.id}><span>{d.term}</span><Meta>{title(d.certainty)}{d.code ? ` · ${d.code.code}` : ''}</Meta></Row>
        )) : <Empty>No diagnosis yet.</Empty>}
        {open ? (
          <CommandForm op="addDiagnosis" build="addDiagnosis" submit="Add diagnosis" fixed={{ encounterId: e.id }} paths={paths}
            fields={[
              { name: 'codeId', label: 'Diagnosis', width: 'lg', options: [{ value: '', label: 'Type below instead' }, ...data.diagnosisCodes.map(c => ({ value: c.id, label: c.term }))] },
              { name: 'term', label: 'Or type it', width: 'lg' },
              { name: 'certainty', label: 'Certainty', width: 'sm', options: options(['presumptive', 'differential', 'confirmed', 'ruled_out']) },
              { name: 'addToProblems', label: 'Problem list', width: 'sm', options: [{ value: 'no', label: 'This visit only' }, { value: 'yes', label: 'Add to problems' }] },
            ]} />
        ) : null}
      </Section>

      <Section title="Orders and treatments">
        {e.orders.length ? e.orders.map(o => (
          <div key={o.id} className="space-y-2 border-b py-3 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><span className="font-mono text-xs">{o.ref}</span> <span className="text-sm">{o.description}</span>
                <Meta>{title(o.kind)}{o.route && o.route !== 'other' ? ` · ${label(o.route)}` : ''}{o.frequency ? ` · ${label(o.frequency.toLowerCase())}` : ''}{o.drug?.csSchedule && o.drug.csSchedule !== 'none' ? ` · controlled (${o.drug.csSchedule})` : ''} · ordered by {o.orderedBy?.displayName}</Meta>
              </div>
              <Status value={o.status} />
            </div>
            {(o.warnings ?? []).map(w => <p key={w.code} className={`rounded-md border px-3 py-1.5 text-xs ${ALERT_TONE.warning}`}>{DOSE_WARNING[w.code] ?? w.message ?? label(w.code)}{o.overrideReason ? ` Override: ${o.overrideReason}` : ''}</p>)}
            {o.administrations.map(a => {
              const reversal = Boolean(a.reverses);
              const reversed = !reversal && o.administrations.some(r => r.reverses?.id === a.id);
              return (
                <div key={a.id} className="space-y-1">
                  <Meta>{reversal ? `Reversed ${a.qty ? `${quantity(a.qty.replace(/^-/, ''))} ${a.unit}` : ''} by ${a.givenBy?.displayName ?? 'unknown'} · ${fix('Administration', a.id, 'reason', a.reason)}` : `Given ${a.qty ? `${quantity(a.qty)} ${a.unit}` : ''} by ${a.givenBy?.displayName ?? 'unknown'}${a.witness ? `, witnessed by ${a.witness.displayName}` : ''}${a.lotNumber ? ` · lot ${a.lotNumber}` : ''}${a.qtyOverrideReason ? ` · not the ordered amount: ${a.qtyOverrideReason}` : ''}`}{reversed ? ' · reversed' : ''} · {when(a.givenAt, tz, 'dayTime')}</Meta>
                  {!reversal && !reversed && e.status !== 'voided' ? (
                    <Reverse>
                      <CommandForm op="reverseAdministration" build="reverseAdministration" submit="Reverse this dose" fixed={{ administrationId: a.id }} paths={paths}
                        fields={[
                          { name: 'reason', label: 'Why (veterinarian only)', width: 'lg', placeholder: 'Recorded on the wrong patient' },
                          ...(o.drug && o.drug.csSchedule !== 'none' ? [{ name: 'witnessId', label: 'Witness', options: [{ value: '', label: 'No witness' }, ...data.witnesses.map(s => ({ value: s.id, label: s.displayName }))] }] : []),
                        ]} />
                    </Reverse>
                  ) : null}
                </div>
              );
            })}
            {o.status === 'ordered' || o.status === 'in_progress' ? (
              o.drug ? (
                <CommandForm op="recordAdministration" build="recordAdministration" submit="Record given" fixed={{ orderId: o.id }} paths={paths}
                  fields={o.drug.csSchedule !== 'none' ? [
                    { name: 'csContainerId', label: 'Controlled container', width: 'lg', options: data.csContainers.filter(c => c.product?.id === o.drug!.id && c.location?.id === locId).map(c => ({ value: c.id, label: c.ref })) },
                    { name: 'witnessId', label: 'Witness', options: [{ value: '', label: 'No witness' }, ...data.witnesses.map(s => ({ value: s.id, label: s.displayName }))] },
                    { name: 'wasteQty', label: 'Wasted (mL)', width: 'sm', placeholder: '0' },
                    { name: 'site', label: 'Site', placeholder: 'left cephalic' },
                    ...GIVEN_FIELDS,
                  ] : [
                    { name: 'lotId', label: 'Lot', width: 'lg', options: data.inventoryLots.filter(l => l.drug?.id === o.drug!.id && l.location?.id === locId && l.expiresOn >= today).map(l => ({ value: l.id, label: `${l.lotNumber} · expires ${calendarDay(l.expiresOn)}` })) },
                    { name: 'site', label: 'Site', placeholder: 'right flank SC' },
                    ...GIVEN_FIELDS,
                  ]} />
              ) : (
                <ActionButton op="completeOrder" vars={{ orderId: o.id, expectedVersion: o.version }} paths={paths}>Mark done</ActionButton>
              )
            ) : null}
          </div>
        )) : <Empty>No orders yet.</Empty>}
        {open ? (
          <div className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-medium">Order a medication</h3>
            <p className="text-xs text-muted-foreground">The dose is calculated on the server from the recorded weight{latest ? ` (${weight(latest.value, latest.unit)})` : ''}, checked against the formulary range for {p.species?.name.toLowerCase() ?? 'the species'} and rounded to a measurable amount.</p>
            <CommandForm op="placeOrder" build="placeOrder" submit="Place order" fixed={{ encounterId: e.id, kind: 'medication', stayId: e.stay?.id ?? '' }} paths={paths}
              fields={[
                { name: 'drugId', label: 'Drug', width: 'lg', options: data.drugProducts.map(d => ({ value: d.id, label: `${d.displayName.replace(/ (injection|tablets?|capsules?|solution)$/, '')}${d.csSchedule !== 'none' ? ` · ${d.csSchedule}` : ''}` })) },
                { name: 'doseAmount', label: 'Dose', width: 'sm', placeholder: '2.2' },
                { name: 'doseUnit', label: 'Unit', width: 'sm', options: [{ value: 'mg', label: 'mg' }, { value: 'mcg', label: 'mcg' }, { value: 'mL', label: 'mL' }, { value: 'IU', label: 'IU' }, { value: 'tablet', label: 'tablets' }] },
                { name: 'dosePer', label: 'Per', width: 'sm', options: [{ value: 'kg', label: 'per kg' }, { value: 'm2', label: 'per m²' }, { value: 'animal', label: 'per animal' }] },
                { name: 'route', label: 'Route', width: 'lg', options: ROUTES.map(r => ({ value: r, label: title(r) })) },
                { name: 'frequency', label: 'Frequency', width: 'lg', options: FREQUENCIES.map(f => ({ value: f, label: title(f) })) },
                { name: 'overrideReason', label: 'Reason if outside range', width: 'lg' },
              ]} />
            <h3 className="pt-2 text-sm font-medium">Order a procedure, test or nursing task</h3>
            <CommandForm op="placeOrder" build="placeOrder" submit="Place order" fixed={{ encounterId: e.id }} paths={paths}
              fields={[{ name: 'kind', label: 'Kind', width: 'lg', options: options(ORDER_KINDS.filter(k => k !== 'medication')) }, { name: 'description', label: 'What', width: 'lg', placeholder: 'Radiographs, right stifle, 2 views' }]} />
          </div>
        ) : null}
      </Section>

      <Section title="Vaccines">
        {data.vaccineAdministrations.filter(v => v.source !== 'reversal').map(v => {
          const reversal = data.vaccineAdministrations.find(r => r.reverses?.id === v.id);
          return (
            <div key={v.id} className="space-y-1 border-b py-2 last:border-b-0">
              <Row>
                <div className="min-w-0">
                  <p className={`text-sm ${reversal ? 'text-muted-foreground line-through' : ''}`}>{v.product?.name ?? 'Vaccine'}</p>
                  <Meta>Dose {v.doseSeries} · lot {v.lotNumber}{v.site ? ` · ${v.site}` : ''} · {v.vaccinatedBy?.displayName ?? 'unknown'}{!reversal && v.dueNextOn ? ` · next due ${calendarDay(v.dueNextOn)}` : ''}{reversal ? ` · reversed: ${fix('VaccineAdministration', reversal.id, 'reason', reversal.reason)}` : ''}</Meta>
                </div>
                {v.certificate ? <Link href={`/dashboard/platform/vaccines/certificates/${v.certificate.id}`} className="inline-flex min-h-11 shrink-0 items-center text-xs underline">Certificate {v.certificate.ref}{v.certificate.tagNumber ? ` · tag ${v.certificate.tagNumber}` : ''}{v.certificate.voidedAt ? ' · void' : ''}</Link> : null}
              </Row>
              {!reversal && e.status !== 'voided' ? (
                <Reverse>
                  <CommandForm op="reverseVaccineAdministration" build="reverseVaccineAdministration" submit="Reverse this vaccine" fixed={{ vaccineAdministrationId: v.id }} paths={paths}
                    fields={[{ name: 'reason', label: 'Why (veterinarian only)', width: 'lg', placeholder: 'Second dose entered in error' }]} />
                </Reverse>
              ) : null}
            </div>
          );
        })}
        {open ? (
          <CommandForm op="administerVaccine" build="administerVaccine" submit="Record vaccine" fixed={{ encounterId: e.id }} paths={paths}
            fields={[
              { name: 'productId', label: 'Vaccine', width: 'lg', options: data.vaccineProducts.map(v => ({ value: v.id, label: v.name })) },
              { name: 'lotId', label: 'Lot', width: 'lg', options: data.vaccineLots.filter(l => l.location?.id === locId && l.expiresOn >= today).map(l => ({ value: l.id, label: `${data.vaccineProducts.find(v => v.id === l.vaccine?.id)?.name.split(' (')[0] ?? 'Vaccine'} · lot ${l.lotNumber}` })) },
              { name: 'site', label: 'Site', placeholder: 'right hindlimb SC' },
              { name: 'supervisingDvmId', label: 'Supervising DVM', width: 'lg', options: [{ value: '', label: 'I am the veterinarian' }, ...dvms.map(s => ({ value: s.id, label: s.displayName }))] },
              { name: 'tagNumber', label: 'Rabies tag', width: 'sm' },
              { name: 'repeatReason', label: 'Reason if repeating within 14 days', width: 'lg' },
            ]} />
        ) : null}
        <p className="text-xs text-muted-foreground">A rabies vaccine issues its certificate from this same entry; expired lots and under-age patients are refused. <Link href={`/dashboard/platform/vaccines?patient=${p.id}`} className="underline">Vaccine history and reminders</Link>.</p>
      </Section>

      {['surgery', 'dental', 'emergency', 'inpatient_day'].includes(e.kind) || data.anaesthesiaRecords.length ? (
        <Section title="Anaesthesia">
          {data.anaesthesiaRecords.map(r => (
            <Row key={r.id} href={`/dashboard/platform/anaesthesia/${r.id}`}><span><span className="font-mono text-xs">{r.ref}</span> {r.procedure}</span><Meta>{asaText(r.asaStatus)} · {label(r.status)}</Meta></Row>
          ))}
          {open && !data.anaesthesiaRecords.some(r => r.status !== 'closed') ? (
            <CommandForm op="openAnaesthesia" build="openAnaesthesia" submit="Open anaesthesia record" fixed={{ encounterId: e.id }} paths={paths}
              fields={[
                { name: 'procedure', label: 'Procedure', width: 'lg', placeholder: 'TPLO right stifle' },
                { name: 'asaStatus', label: 'ASA status', width: 'lg', options: ['I', 'II', 'III', 'IV', 'V', 'IE', 'IIE', 'IIIE', 'IVE', 'VE'].map(a => ({ value: a, label: asaText(a) })) },
                { name: 'fastingConfirmed', label: 'Fasted', width: 'sm', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No (emergency)' }] },
                { name: 'consentConfirmed', label: 'Signed consent', width: 'sm', options: [{ value: 'no', label: 'Not yet' }, { value: 'yes', label: 'On file' }] },
                { name: 'anaesthetistId', label: 'Anaesthetist', width: 'lg', options: people.map(s => ({ value: s.id, label: s.displayName })) },
              ]} />
          ) : null}
        </Section>
      ) : null}

      {open && (scribeOn || data.scribeSessions.length) ? (
        <Section title="Scribe">
          <p className="text-xs text-muted-foreground">The scribe drafts from the visit conversation; nothing reaches the record until a person accepts it block by block, and a veterinarian still signs. California requires every party&apos;s consent to record.</p>
          {data.scribeSessions.map(s => (
            <div key={s.id} className="space-y-2 border-b py-2 last:border-b-0">
              <Meta>Session · {label(s.status)} · client consent {s.clientConsent ? 'recorded' : 'not recorded'}</Meta>
              {s.status === 'recording' ? (
                <CommandForm op="draftScribeSession" build="draftScribeSession" submit="Draft from transcript" fixed={{ sessionId: s.id }} paths={paths}
                  fields={[{ name: 'pastedTranscript', label: 'Transcript (paste, or the audio adapter fills it)', width: 'full', multiline: 5 }]} />
              ) : null}
              {s.drafts.filter(d => ['proposed', 'partly_accepted'].includes(d.status)).map(d => (
                <AcceptDraft key={d.id} draftId={d.id} sections={(d.sections ?? []).map((b, i) => ({ index: i, title: SECTION_TITLE[b.kind] ?? title(b.kind), body: b.body, accepted: (d.acceptedBlocks ?? []).includes(i) }))} paths={paths} />
              ))}
            </div>
          ))}
          {scribeOn && !data.scribeSessions.some(s => s.status === 'recording') ? (
            <CommandForm op="startScribeSession" build="startScribeSession" submit="Start scribe" fixed={{ encounterId: e.id }} paths={paths}
              fields={[
                { name: 'clientConsent', label: 'Client consent to record', width: 'lg', options: [{ value: 'no', label: 'Not asked' }, { value: 'yes', label: 'Client agreed (verbal)' }] },
                { name: 'staffAcknowledged', label: 'Team informed', width: 'lg', options: [{ value: 'no', label: 'Not yet' }, { value: 'yes', label: 'Everyone in the room knows' }] },
              ]} />
          ) : null}
        </Section>
      ) : null}

      <Section title="Sign">
        {missing.length && !signed ? (
          <div className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.warning}`}>
            <p className="font-medium">Before signing, the California records rule needs:</p>
            <ul className="mt-1 list-disc pl-5">{missing.map(m => <li key={m.field}>{m.message}</li>)}</ul>
          </div>
        ) : null}
        {e.status === 'open' || e.status === 'in_progress' ? (
          <ActionButton op="submitEncounter" vars={{ encounterId: e.id, expectedVersion: e.version }} paths={paths}>Send for signature</ActionButton>
        ) : null}
        {e.status === 'pending_signature' || e.status === 'in_progress' ? (
          <ActionButton op="signEncounter" vars={{ encounterId: e.id, expectedVersion: e.version }} paths={paths} confirm="Sign and freeze this record? Later changes become addenda.">Sign as veterinarian</ActionButton>
        ) : null}
        {e.status === 'pending_signature' ? (
          <ActionButton op="returnEncounter" vars={{ encounterId: e.id, expectedVersion: e.version }} paths={paths} ask="What needs changing before it is signed?">Return for changes</ActionButton>
        ) : null}
        {signed ? <Meta>Signed {when(e.signedAt, tz)} by {e.signedBy?.displayName}.</Meta> : null}
      </Section>

      {signed ? (
        <Section title="Addenda">
          {e.addenda.length ? e.addenda.map(a => (
            <div key={a.id} className="space-y-1 border-b py-2 last:border-b-0">
              <p className="whitespace-pre-wrap break-words text-sm">{a.body}</p>
              <Meta>{SECTION_TITLE[a.sectionKind] ?? title(a.sectionKind)} · {a.reason} · {a.author?.displayName}{a.authorIsDvm ? ' (DVM)' : ''} · {when(a.signedAt, tz)}</Meta>
            </div>
          )) : <Empty>No addenda.</Empty>}
          <CommandForm op="addAddendum" build="addAddendum" submit="Add addendum" fixed={{ encounterId: e.id }} paths={paths}
            fields={[
              { name: 'sectionKind', label: 'Amends', width: 'lg', options: ['general', 'subjective', 'objective', 'assessment', 'plan', 'discharge'].map(k => ({ value: k, label: SECTION_TITLE[k] })) },
              { name: 'reason', label: 'Reason', width: 'lg', placeholder: 'Lab results received' },
              { name: 'body', label: 'Addendum', width: 'full', multiline: 3 },
            ]} />
        </Section>
      ) : null}

      {open && !e.orders.length ? (
        <Section title="Opened in error?">
          <ActionButton op="requestVoidEncounter" vars={{ encounterId: e.id }} paths={paths} ask="Why should this record be voided? A second person approves.">Ask to void</ActionButton>
        </Section>
      ) : null}
      <p className="text-xs text-muted-foreground">Opening this record is recorded in the <Link href="/dashboard/platform/read-audit" className="underline">read audit</Link>.</p>
    </Page>
  );
}

/** N1: blank means the ordered amount; anything outside it needs a veterinarian's reason. */
const GIVEN_FIELDS = [
  { name: 'qty', label: 'Amount given', width: 'md' as const, placeholder: 'as ordered' },
  { name: 'qtyOverrideReason', label: 'Reason if not the ordered amount (veterinarian)', width: 'lg' as const },
];

/** A collapsed correction form: reversals are rare and veterinarian-only, so they stay out of the way. */
function Reverse({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Reverse…</summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}
