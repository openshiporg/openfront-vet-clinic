'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { label } from '../lib/format';
import { runCommand } from '../actions/commands';
import { pillClass } from './ActionButton';

/*
 * A small form that runs one named command. Fields are plain strings; `build` turns them into the
 * command's variables (money and quantities stay strings, never floats). The idempotency key is made
 * once per intent and reused on retry, like ActionButton.
 */

export type Field = { name: string; label: string; placeholder?: string; defaultValue?: string; options?: { value: string; label: string }[]; hint?: string; width?: 'sm' | 'md' | 'lg' | 'full'; multiline?: number };

export function CommandForm({ op, fields, fixed = {}, build, submit, paths, confirm, className }: {
  op: string;
  fields: Field[];
  /** Values the person does not type (ids, scope keys). */
  fixed?: Record<string, string>;
  build: string;
  submit: string;
  paths?: string[];
  confirm?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState('');
  const [done, setDone] = React.useState('');
  const key = React.useRef<{ key: string; body: string } | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ''])));
  return (
    <form
      className={cn('flex flex-wrap items-end gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        setError('');
        setDone('');
        let variables: Record<string, unknown>;
        try {
          variables = BUILDERS[build]({ ...values, ...fixed });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Check the fields.');
          return;
        }
        const body = JSON.stringify(variables);
        if (key.current?.body !== body) key.current = { key: `${op}:${crypto.randomUUID()}`, body };
        const idempotencyKey = key.current.key;
        start(async () => {
          const r = await runCommand(op, variables, idempotencyKey, paths);
          if (!r.ok) setError(r.error);
          else { key.current = null; setDone(summaryOf(r.data)); router.refresh(); }
        });
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className={cn('flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted-foreground', f.width === 'full' ? 'w-full' : f.width === 'lg' ? 'w-full sm:w-96' : f.options ? (f.width === 'sm' ? 'w-auto min-w-24' : 'w-auto min-w-36') : f.width === 'sm' ? 'w-24' : 'w-36')}>
          {f.label}
          {f.options ? (
            <select className="h-11 w-full max-w-full sm:h-8 rounded-md border bg-background pl-2 pr-7 text-sm text-foreground" value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.multiline ? (
            <textarea rows={f.multiline} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed text-foreground" value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          ) : (
            <input className="h-11 rounded-md sm:h-8 border bg-background px-2 font-mono text-sm text-foreground" value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          )}
          {f.hint ? <span className="text-[11px]">{f.hint}</span> : null}
        </label>
      ))}
      <button type="submit" disabled={pending} className={cn(pillClass, 'border')}>{pending ? 'Working' : submit}</button>
      {error ? <span role="alert" className="w-full break-words text-xs text-red-600">{error}</span> : null}
      {done ? <span className="w-full break-words text-xs text-emerald-700">{done}</span> : null}
    </form>
  );
}

function summaryOf(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return 'Done.';
  if (d.duplicate === true) return 'Already recorded a few minutes ago; kept the one reading.';
  if (typeof d.ref === 'string') return `${d.ref} · ${label(String(d.status ?? 'done'))}`;
  if (typeof d.reference === 'string') return `${d.reference} · ${label(String(d.status ?? 'done'))}`;
  if (typeof d.status === 'string') return d.status === 'pending' ? 'Sent for approval.' : `Done · ${label(d.status)}.`;
  return 'Done.';
}

const DOLLARS = /^\d+(\.\d{1,2})?$/;
/** Dollars typed by a person → whole cents as a string (never through floating point). */
export const cents = (text: string, field: string) => {
  const t = text.trim().replace(/[$,]/g, '');
  if (!DOLLARS.test(t)) throw new Error(`${field}: enter dollars and cents, e.g. 250 or 2500.50`);
  const [whole, fraction = ''] = t.split('.');
  return `${BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))}`;
};
const ints = (text: string, field: string, min = 0, max = 100_000) => {
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${field} must be a whole number from ${min} to ${max}`);
  return n;
};
/** An amount given (blank = the ordered amount). */
const qtyText = (text: string | undefined) => {
  const t = text?.trim();
  if (!t) return undefined;
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(t)) throw new Error('Amount given: a number like 0.32');
  return t;
};
const required = (v: Record<string, string>, ...names: string[]) => { for (const n of names) if (!v[n]?.trim()) throw new Error(`Fill in ${n}.`); };

/** Variable builders, by name (functions cannot cross the server → client boundary). */
const BUILDERS: Record<string, (v: Record<string, string>) => Record<string, unknown>> = {
  // Phase 4: money screens. Dollars typed by a person become whole cents; version numbers become numbers.
  billing: (v) => {
    const DOLLAR: Record<string, string> = { amount: 'amountMinor', requested: 'requestedMinor', authorised: 'authorisedMinor', newHigh: 'newHighMinor', price: 'priceMinor', minimum: 'minimumChargeMinor', approved: 'approvedMinor', deductible: 'deductibleMinor' };
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(v)) {
      const t = (raw ?? '').trim();
      if (!t) continue;
      if (DOLLAR[k]) out[DOLLAR[k]] = cents(t, k);
      else if (k === 'expectedVersion') out[k] = Number(t);
      else if (k === 'percent') { const n = Number(t); if (!Number.isFinite(n)) throw new Error('Percent must be a number'); out[k] = n; }
      else if (k === 'elective' || k === 'allowOverpay' || k === 'cancel') out[k] = t === 'true';
      else out[k] = t;
    }
    return out;
  },
  // A simple estimate: one recommended option with up to three fee lines, each with a low and a high quantity.
  estimate: (v) => {
    required(v, 'patientId', 'locationId', 'title', 'fee1');
    const lines = [1, 2, 3].filter((i) => v[`fee${i}`]?.trim()).map((i) => ({ feeItemId: v[`fee${i}`], qtyLow: v[`low${i}`]?.trim() || '1', qtyHigh: v[`high${i}`]?.trim() || v[`low${i}`]?.trim() || '1' }));
    return { patientId: v.patientId, locationId: v.locationId, title: v.title, elective: v.elective === 'true', options: [{ label: v.optionLabel?.trim() || 'Recommended', recommended: true, lines }] };
  },
  practiceControls: (v) => {
    required(v, 'reason');
    const changes: Record<string, unknown> = {};
    if (v.noShowGraceMinutes?.trim()) changes.noShowGraceMinutes = ints(v.noShowGraceMinutes, 'No-show grace', 0, 240);
    if (v.estimateValidityDays?.trim()) changes.estimateValidityDays = ints(v.estimateValidityDays, 'Estimate validity', 1, 365);
    if (v.refundThreshold?.trim()) changes.refundApprovalThresholdMinor = cents(v.refundThreshold, 'Refund approval threshold');
    if (v.aiVoice === 'on' || v.aiVoice === 'off') changes.features = { aiVoice: v.aiVoice === 'on' };
    if (!Object.keys(changes).length) throw new Error('Change at least one control.');
    return { changes, reason: v.reason.trim() };
  },
  /** Front-desk registration: one person, a mobile and/or email, and the first pet (I-C1 duplicate check runs on the server). */
  registerClient: (v) => {
    required(v, 'firstName', 'lastName', 'petName', 'species', 'locationId');
    const contacts = [
      ...(v.phone?.trim() ? [{ kind: 'mobile', value: v.phone.trim() }] : []),
      ...(v.email?.trim() ? [{ kind: 'email', value: v.email.trim() }] : []),
    ];
    if (!contacts.length) throw new Error('Add a mobile number or an email.');
    if (v.dateOfBirth?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth.trim())) throw new Error('Born: use YYYY-MM-DD.');
    return {
      input: {
        locationId: v.locationId,
        people: [{ firstName: v.firstName.trim(), lastName: v.lastName.trim(), contacts }],
        patients: [{ name: v.petName.trim(), speciesCode: v.species, sex: v.sex || 'unknown', dateOfBirth: v.dateOfBirth?.trim() || null }],
      },
    };
  },
  /** A weight as typed (exact decimal string, never a float). */
  recordWeight: (v) => {
    required(v, 'patientId', 'value', 'unit');
    if (!/^\d{1,4}(\.\d{1,4})?$/.test(v.value.trim())) throw new Error('Weight: a number like 4.2');
    return { patientId: v.patientId, value: v.value.trim(), unit: v.unit, method: 'scale' };
  },
  addPatientAlert: (v) => {
    required(v, 'patientId', 'kind', 'severity', 'text');
    return { patientId: v.patientId, kind: v.kind, severity: v.severity, text: v.text.trim() };
  },
  // ── Phase 2: the medical record ──
  openEncounter: (v) => {
    required(v, 'patientId', 'locationId', 'kind');
    return { patientId: v.patientId, locationId: v.locationId, kind: v.kind, reason: v.reason?.trim() || undefined, attendingDvmId: v.attendingDvmId || undefined, appointmentId: v.appointmentId || undefined };
  },
  saveSoapSection: (v) => {
    required(v, 'encounterId', 'kind', 'body');
    return { encounterId: v.encounterId, kind: v.kind, body: v.body.trim(), ...(v.expectedVersion ? { expectedVersion: Number(v.expectedVersion) } : {}), ...(v.ordinal ? { ordinal: Number(v.ordinal) } : {}) };
  },
  recordVitals: (v) => {
    required(v, 'encounterId');
    const n = (name: string, field: string, min: number, max: number) => (v[name]?.trim() ? ints(v[name], field, min, max) : undefined);
    const d = (name: string, field: string) => { const t = v[name]?.trim(); if (!t) return undefined; if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw new Error(`${field}: a number like 101.5`); return t; };
    const out = { encounterId: v.encounterId, temperature: d('temperature', 'Temperature'), temperatureUnit: v.temperature?.trim() ? (v.temperatureUnit || 'F') : undefined, heartRate: n('heartRate', 'Heart rate', 10, 400), respRate: n('respRate', 'Respiratory rate', 2, 200), painScore: n('painScore', 'Pain score', 0, 10), mucousMembranes: v.mucousMembranes?.trim() || undefined, crtSeconds: d('crtSeconds', 'CRT') };
    if (Object.values(out).filter(x => x !== undefined).length <= 1) throw new Error('Enter at least one reading.');
    return out;
  },
  setExamFinding: (v) => { required(v, 'encounterId', 'system', 'status'); return { encounterId: v.encounterId, system: v.system, status: v.status, text: v.text?.trim() || undefined }; },
  addDiagnosis: (v) => {
    required(v, 'encounterId', 'certainty');
    if (!v.codeId && !v.term?.trim()) throw new Error('Choose a diagnosis or type one.');
    return { encounterId: v.encounterId, codeId: v.codeId || undefined, term: v.codeId ? undefined : v.term.trim(), certainty: v.certainty, addToProblems: v.addToProblems === 'yes' };
  },
  addAddendum: (v) => { required(v, 'encounterId', 'sectionKind', 'reason', 'body'); return { encounterId: v.encounterId, sectionKind: v.sectionKind, reason: v.reason.trim(), body: v.body.trim() }; },
  /** A medication order: the dose is typed per kg (or m², or per animal); the server calculates from the recorded weight. */
  placeOrder: (v) => {
    required(v, 'encounterId', 'kind');
    if (v.kind !== 'medication') { required(v, 'description'); return { encounterId: v.encounterId, kind: v.kind, description: v.description.trim() }; }
    required(v, 'drugId', 'doseAmount', 'route', 'frequency');
    if (!/^\d{1,5}(\.\d{1,6})?$/.test(v.doseAmount.trim())) throw new Error('Dose: a number like 2.2');
    const dose = { doseAmount: v.doseAmount.trim(), doseUnit: v.doseUnit || 'mg', dosePer: v.dosePer || 'kg', ...(v.overrideReason?.trim() ? { overrideReason: v.overrideReason.trim() } : {}) };
    const sheet = v.stayId ? { stayId: v.stayId, frequency: v.frequency, durationHours: v.durationHours ? ints(v.durationHours, 'Duration', 1, 720) : null } : undefined;
    return { encounterId: v.encounterId, kind: 'medication', drugId: v.drugId, route: v.route, frequency: v.frequency, dose, ...(v.quantity?.trim() ? { quantity: v.quantity.trim(), quantityUnit: v.quantityUnit || '' } : {}), ...(sheet ? { sheet } : {}), extralabel: v.extralabel === 'yes' };
  },
  recordAdministration: (v) => {
    required(v, 'orderId');
    return { orderId: v.orderId, route: v.route || undefined, site: v.site?.trim() || undefined, lotId: v.lotId || undefined, csContainerId: v.csContainerId || undefined, witnessId: v.witnessId || undefined, wasteQty: v.wasteQty?.trim() || undefined, qty: qtyText(v.qty), qtyOverrideReason: v.qtyOverrideReason?.trim() || undefined };
  },
  /** M5: a veterinarian reverses a dose (wrong patient, not actually given); the original stays on record. */
  reverseAdministration: (v) => {
    required(v, 'administrationId', 'reason');
    if (v.reason.trim().length < 8) throw new Error('Reason: say why in a few words (at least 8 characters).');
    return { administrationId: v.administrationId, reason: v.reason.trim(), witnessId: v.witnessId || undefined };
  },
  reverseVaccineAdministration: (v) => {
    required(v, 'vaccineAdministrationId', 'reason');
    if (v.reason.trim().length < 8) throw new Error('Reason: say why in a few words (at least 8 characters).');
    return { vaccineAdministrationId: v.vaccineAdministrationId, reason: v.reason.trim() };
  },
  admitPatient: (v) => { required(v, 'encounterId', 'cageId', 'codeStatus'); return { encounterId: v.encounterId, cageId: v.cageId, codeStatus: v.codeStatus, reason: v.reason?.trim() || undefined }; },
  moveCage: (v) => { required(v, 'stayId', 'cageId'); return { stayId: v.stayId, cageId: v.cageId }; },
  dischargePatient: (v) => {
    required(v, 'stayId', 'expectedVersion', 'instructions');
    if (v.recheckOn?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(v.recheckOn.trim())) throw new Error('Recheck: use YYYY-MM-DD.');
    return { stayId: v.stayId, expectedVersion: Number(v.expectedVersion), instructions: v.instructions.trim(), recheckOn: v.recheckOn?.trim() || undefined };
  },
  completeTreatmentTask: (v) => {
    required(v, 'taskId', 'expectedVersion');
    return { taskId: v.taskId, expectedVersion: Number(v.expectedVersion), observation: v.observation?.trim() || undefined, lotId: v.lotId || undefined, csContainerId: v.csContainerId || undefined, witnessId: v.witnessId || undefined, wasteQty: v.wasteQty?.trim() || undefined, earlyReason: v.earlyReason?.trim() || undefined, qty: qtyText(v.qty), qtyOverrideReason: v.qtyOverrideReason?.trim() || undefined };
  },
  openAnaesthesia: (v) => {
    required(v, 'encounterId', 'procedure', 'asaStatus');
    if (v.consentConfirmed !== 'yes') throw new Error('Confirm the signed anaesthesia consent first.');
    return { encounterId: v.encounterId, procedure: v.procedure.trim(), asaStatus: v.asaStatus, fastingConfirmed: v.fastingConfirmed === 'yes', consentConfirmed: true, anaesthetistId: v.anaesthetistId || undefined };
  },
  recordMonitoring: (v) => {
    required(v, 'recordId');
    const n = (name: string, field: string, min: number, max: number) => (v[name]?.trim() ? ints(v[name], field, min, max) : undefined);
    const d = (name: string, field: string) => { const t = v[name]?.trim(); if (!t) return undefined; if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw new Error(`${field}: a number like 37.8`); return t; };
    return { recordId: v.recordId, hr: n('hr', 'Heart rate', 10, 400), rr: n('rr', 'Resp. rate', 0, 200), spo2: n('spo2', 'SpO₂', 0, 100), etco2: n('etco2', 'EtCO₂', 0, 150), sbp: n('sbp', 'Systolic', 0, 400), map: n('map', 'MAP', 0, 300), tempC: d('tempC', 'Temperature'), agentPct: d('agentPct', 'Agent %'), notes: v.notes?.trim() || undefined };
  },
  closeAnaesthesia: (v) => { required(v, 'recordId', 'expectedVersion'); return { recordId: v.recordId, expectedVersion: Number(v.expectedVersion), complications: v.complications?.trim() || undefined }; },
  saveSurgeryReport: (v) => { required(v, 'encounterId', 'procedure'); return { encounterId: v.encounterId, procedure: v.procedure.trim(), technique: v.technique?.trim() || undefined, findings: v.findings?.trim() || undefined, closure: v.closure?.trim() || undefined, sutures: v.sutures?.trim() || undefined }; },
  administerVaccine: (v) => {
    required(v, 'encounterId', 'productId', 'lotId', 'site');
    return { encounterId: v.encounterId, productId: v.productId, lotId: v.lotId, site: v.site.trim(), route: v.route || undefined, supervisingDvmId: v.supervisingDvmId || undefined, tagNumber: v.tagNumber?.trim() || undefined, repeatReason: v.repeatReason?.trim() || undefined };
  },
  recordOutsideVaccine: (v) => {
    required(v, 'patientId', 'productId', 'administeredOn', 'evidenceNote');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.administeredOn.trim())) throw new Error('Given on: use YYYY-MM-DD.');
    return { patientId: v.patientId, productId: v.productId, administeredOn: v.administeredOn.trim(), lotNumber: v.lotNumber?.trim() || undefined, evidenceNote: v.evidenceNote.trim() };
  },
  addManualReminder: (v) => {
    required(v, 'patientId', 'typeId', 'dueOn');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueOn.trim())) throw new Error('Due: use YYYY-MM-DD.');
    return { patientId: v.patientId, typeId: v.typeId, dueOn: v.dueOn.trim() };
  },
  startScribeSession: (v) => {
    required(v, 'encounterId');
    if (v.staffAcknowledged !== 'yes') throw new Error('Confirm that the team in the room knows the visit is being recorded.');
    return { encounterId: v.encounterId, clientConsent: v.clientConsent === 'yes', consentMethod: v.clientConsent === 'yes' ? 'verbal_recorded' : undefined, staffAcknowledged: true };
  },
  draftScribeSession: (v) => { required(v, 'sessionId', 'pastedTranscript'); return { sessionId: v.sessionId, pastedTranscript: v.pastedTranscript.trim() }; },
  rejectScribeDraft: (v) => { required(v, 'draftId', 'reason'); return { draftId: v.draftId, reason: v.reason.trim() }; },
  previewImport: (v) => {
    required(v, 'system', 'entity', 'locationId', 'csv');
    if (v.csv.length > 5_000_000) throw new Error('The file is over 5 MB; split it or use the ezyVet API source.');
    return { system: v.system, entity: v.entity, locationId: v.locationId, fileName: v.fileName?.trim() || undefined, csv: v.csv, source: 'manual-csv' };
  },
  // ── Phase 3: pharmacy, stock and the controlled-substance register ──
  writePrescription: (v) => {
    required(v, 'patientId', 'locationId', 'productId', 'directions', 'quantity');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v.quantity.trim())) throw new Error('Quantity: a number like 30');
    const refills = v.refills?.trim() ? ints(v.refills, 'Refills', 0, 5) : 0;
    return { patientId: v.patientId, locationId: v.locationId, lines: [{ productId: v.productId, directions: v.directions.trim(), route: v.route?.trim() || undefined, frequency: v.frequency?.trim() || undefined, quantity: v.quantity.trim(), quantityUnit: v.quantityUnit || undefined, refillsAuthorised: refills }] };
  },
  dispenseFill: (v) => {
    required(v, 'lineId', 'quantity');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v.quantity.trim())) throw new Error('Quantity: a number like 30');
    return { lineId: v.lineId, quantity: v.quantity.trim(), lotId: v.lotId || undefined, csContainerId: v.csContainerId || undefined, refillRequestId: v.refillRequestId || undefined };
  },
  receiveStockLot: (v) => {
    required(v, 'locationId', 'lotNumber', 'expiresOn');
    if (!v.drugId && !v.vaccineId) throw new Error('Choose a drug or a vaccine.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn.trim())) throw new Error('Expires: use YYYY-MM-DD.');
    return { drugId: v.drugId || undefined, vaccineId: v.drugId ? undefined : v.vaccineId || undefined, locationId: v.locationId, lotNumber: v.lotNumber.trim(), expiresOn: v.expiresOn.trim() };
  },
  receiveControlled: (v) => {
    required(v, 'productId', 'locationId', 'lotNumber', 'lotExpiresOn', 'labelQty', 'labelUnit');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.lotExpiresOn.trim())) throw new Error('Expires: use YYYY-MM-DD.');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v.labelQty.trim())) throw new Error('Amount on the label: a number like 10');
    return { productId: v.productId, locationId: v.locationId, lotNumber: v.lotNumber.trim(), lotExpiresOn: v.lotExpiresOn.trim(), labelQty: v.labelQty.trim(), labelUnit: v.labelUnit, orderFormReference: v.orderFormReference?.trim() || undefined };
  },
  wasteControlled: (v) => {
    required(v, 'containerId', 'qty', 'reason', 'witnessId');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v.qty.trim())) throw new Error('Amount: a number like 0.2');
    return { containerId: v.containerId, qty: v.qty.trim(), reason: v.reason.trim(), witnessId: v.witnessId };
  },
  /** One count per open container: fields named count_<containerId>. */
  countControlled: (v) => {
    required(v, 'locationId', 'kind', 'witnessId');
    const counts = Object.entries(v).filter(([k]) => k.startsWith('count_')).map(([k, value]) => {
      if (!/^\d{1,6}(\.\d{1,6})?$/.test((value ?? '').trim())) throw new Error('Enter every counted amount as a number like 7.5 (zero if empty).');
      return { containerId: k.slice(6), countedQty: value.trim() };
    });
    if (!counts.length) throw new Error('There are no open containers to count.');
    return { locationId: v.locationId, kind: v.kind, witnessId: v.witnessId, counts };
  },
  reportCsLoss: (v) => {
    required(v, 'containerId', 'kind', 'qty', 'description', 'witnessId');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(v.qty.trim())) throw new Error('Amount: a number like 0.2');
    return { containerId: v.containerId, kind: v.kind, qty: v.qty.trim(), description: v.description.trim(), witnessId: v.witnessId };
  },
  destroyControlled: (v) => {
    required(v, 'containerId', 'method', 'witnessAId', 'witnessBId');
    if (v.qty?.trim() && !/^\d{1,6}(\.\d{1,6})?$/.test(v.qty.trim())) throw new Error('Amount: a number like 2.5, or leave blank for everything left.');
    return { containerId: v.containerId, qty: v.qty?.trim() || undefined, method: v.method.trim(), form41Reference: v.form41Reference?.trim() || undefined, witnessAId: v.witnessAId, witnessBId: v.witnessBId };
  },
  quarantine: (v) => { required(v, 'lotId', 'reason', 'expectedVersion'); return { lotId: v.lotId, quarantine: v.quarantine === 'yes', reason: v.reason.trim(), expectedVersion: Number(v.expectedVersion) }; },
  submitPdmp: (v) => { required(v, 'reportId', 'confirmation', 'expectedVersion'); return { reportId: v.reportId, confirmation: v.confirmation.trim(), expectedVersion: Number(v.expectedVersion) }; },
  decideRefill: (v) => { required(v, 'requestId', 'decision', 'expectedVersion'); return { requestId: v.requestId, decision: v.decision, reason: v.reason?.trim() || undefined, expectedVersion: Number(v.expectedVersion) }; },
  advanceDiscrepancyStep: (v) => {
    required(v, 'caseId', 'step', 'expectedVersion');
    return { caseId: v.caseId, step: v.step, reference: v.reference?.trim() || undefined, resolution: v.resolution?.trim() || undefined, expectedVersion: Number(v.expectedVersion) };
  },
  addStockLocation: (v) => { required(v, 'locationId', 'name', 'kind'); return { locationId: v.locationId, name: v.name.trim(), kind: v.kind, minTempC: v.minTempC?.trim() || undefined, maxTempC: v.maxTempC?.trim() || undefined }; },
  receiveStock: (v) => {
    required(v, 'stockLocationId', 'lotNumber', 'expiresOn', 'quantity');
    if (!v.drugId && !v.vaccineId) throw new Error('Choose a drug or a vaccine.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn.trim())) throw new Error('Expires: use YYYY-MM-DD.');
    return { drugId: v.drugId || undefined, vaccineId: v.drugId ? undefined : v.vaccineId || undefined, stockLocationId: v.stockLocationId, lotNumber: v.lotNumber.trim(), expiresOn: v.expiresOn.trim(), quantity: v.quantity.trim() };
  },
  adjustStock: (v) => { required(v, 'itemId', 'stockLocationId', 'kind', 'quantity', 'reason'); return { itemId: v.itemId, lotId: v.lotId || undefined, stockLocationId: v.stockLocationId, kind: v.kind, quantity: v.quantity.trim(), reason: v.reason.trim() }; },
  addSupplier: (v) => { required(v, 'name'); return { name: v.name.trim(), accountNumber: v.accountNumber?.trim() || undefined, phone: v.phone?.trim() || undefined, email: v.email?.trim() || undefined, deaNumber: v.deaNumber?.trim() || undefined }; },
  draftPurchaseOrder: (v) => {
    required(v, 'supplierId', 'locationId', 'itemId', 'quantity', 'cost');
    return { supplierId: v.supplierId, locationId: v.locationId, note: v.note?.trim() || undefined, lines: [{ itemId: v.itemId, quantity: v.quantity.trim(), unitCostMinor: String(cents(v.cost, 'Cost each')) }] };
  },
  orderStep: (v) => { required(v, 'orderId', 'expectedVersion'); return { orderId: v.orderId, expectedVersion: Number(v.expectedVersion), reason: v.reason?.trim() || undefined }; },
  receivePurchaseOrder: (v) => {
    required(v, 'orderId', 'stockLocationId', 'lineId', 'lotNumber', 'expiresOn', 'quantity');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.expiresOn.trim())) throw new Error('Expires: use YYYY-MM-DD.');
    return { orderId: v.orderId, stockLocationId: v.stockLocationId, packingSlip: v.packingSlip?.trim() || undefined, lines: [{ lineId: v.lineId, lotNumber: v.lotNumber.trim(), expiresOn: v.expiresOn.trim(), quantity: v.quantity.trim() }] };
  },
  setReorderRule: (v) => { required(v, 'itemId', 'locationId', 'minQty', 'targetQty'); return { itemId: v.itemId, locationId: v.locationId, minQty: v.minQty.trim(), targetQty: v.targetQty.trim() }; },
  countStock: (v) => { required(v, 'stockLocationId', 'itemId', 'countedQty'); return { stockLocationId: v.stockLocationId, counts: [{ itemId: v.itemId, lotId: v.lotId || undefined, countedQty: v.countedQty.trim() }] }; },
  openRecall: (v) => { required(v, 'itemId', 'lotNumber', 'title'); return { itemId: v.itemId, lotNumber: v.lotNumber.trim(), title: v.title.trim(), source: v.source?.trim() || undefined }; },
  recallExposure: (v) => { required(v, 'exposureId', 'status', 'expectedVersion'); return { exposureId: v.exposureId, status: v.status, note: v.note?.trim() || undefined, expectedVersion: Number(v.expectedVersion) }; },
  closeRecall: (v) => { required(v, 'recallId', 'resolution', 'expectedVersion'); return { recallId: v.recallId, resolution: v.resolution.trim(), expectedVersion: Number(v.expectedVersion) }; },
  logTemperature: (v) => { required(v, 'stockLocationId', 'readingC'); return { stockLocationId: v.stockLocationId, readingC: v.readingC.trim() }; },
  resolveExcursion: (v) => { required(v, 'excursionId', 'resolution', 'expectedVersion'); return { excursionId: v.excursionId, resolution: v.resolution.trim(), expectedVersion: Number(v.expectedVersion) }; },
  issueOrderForm: (v) => {
    required(v, 'supplierId', 'locationId', 'formNumber', 'kind', 'issuedOn', 'productId', 'packages');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.issuedOn.trim())) throw new Error('Issued: use YYYY-MM-DD.');
    return { supplierId: v.supplierId, locationId: v.locationId, formNumber: v.formNumber.trim(), kind: v.kind, issuedOn: v.issuedOn.trim(), lines: [{ productId: v.productId, packages: ints(v.packages, 'Packages', 1, 1000) }] };
  },
  receiveOnOrderForm: (v) => {
    required(v, 'lineId', 'lotNumber', 'lotExpiresOn', 'labelQty', 'labelUnit');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.lotExpiresOn.trim())) throw new Error('Expires: use YYYY-MM-DD.');
    return { lineId: v.lineId, lotNumber: v.lotNumber.trim(), lotExpiresOn: v.lotExpiresOn.trim(), labelQty: v.labelQty.trim(), labelUnit: v.labelUnit };
  },
  transferControlled: (v) => { required(v, 'containerId', 'qty', 'toRegistrationId', 'witnessId'); return { containerId: v.containerId, qty: v.qty.trim(), toRegistrationId: v.toRegistrationId, witnessId: v.witnessId }; },
  logCabinetAccess: (v) => { required(v, 'locationId', 'kind'); return { locationId: v.locationId, kind: v.kind, note: v.note?.trim() || undefined }; },
  requestExternalFill: (v) => { required(v, 'prescriptionId', 'pharmacyName'); return { prescriptionId: v.prescriptionId, pharmacyName: v.pharmacyName.trim(), orderReference: v.orderReference?.trim() || undefined }; },
  decideExternalFill: (v) => { required(v, 'externalId', 'status', 'expectedVersion'); return { externalId: v.externalId, status: v.status, note: v.note?.trim() || undefined, expectedVersion: Number(v.expectedVersion) }; },
  generatePdmpFile: (v) => { required(v, 'locationId'); return { locationId: v.locationId }; },
  killSwitch: (v) => ({ agentId: v.agentId, killSwitch: v.killSwitch === 'on', reason: v.reason?.trim() || undefined, expectedVersion: Number(v.expectedVersion) }),
};
