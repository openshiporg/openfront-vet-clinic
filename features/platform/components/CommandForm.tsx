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

export type Field = { name: string; label: string; placeholder?: string; defaultValue?: string; options?: { value: string; label: string }[]; hint?: string; width?: 'sm' | 'md' | 'lg' };

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
        <label key={f.name} className={cn('flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted-foreground', f.width === 'lg' ? 'w-full sm:w-80' : f.options ? (f.width === 'sm' ? 'w-auto min-w-24' : 'w-auto min-w-36') : f.width === 'sm' ? 'w-24' : 'w-36')}>
          {f.label}
          {f.options ? (
            <select className="h-8 w-full max-w-full rounded-md border bg-background pl-2 pr-7 text-sm text-foreground" value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className="h-8 rounded-md border bg-background px-2 font-mono text-sm text-foreground" value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
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
const required = (v: Record<string, string>, ...names: string[]) => { for (const n of names) if (!v[n]?.trim()) throw new Error(`Fill in ${n}.`); };

/** Variable builders, by name (functions cannot cross the server → client boundary). */
const BUILDERS: Record<string, (v: Record<string, string>) => Record<string, unknown>> = {
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
  killSwitch: (v) => ({ agentId: v.agentId, killSwitch: v.killSwitch === 'on', reason: v.reason?.trim() || undefined, expectedVersion: Number(v.expectedVersion) }),
};
