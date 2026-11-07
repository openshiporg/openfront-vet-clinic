'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../../actions/commands';
import { findClients, searchSlots, type ClientHit, type Slot } from '../../actions/booking';
import { pillClass } from '../../components/ActionButton';

const input = 'h-8 rounded-md border bg-background px-2 text-sm';

/**
 * Front-desk booking: find the client, pick their patients, search slots for the visit type, book.
 * The slot is a signed offer from the server; the server re-checks it under locks and the database
 * refuses any overlap, so a slot taken meanwhile comes back as "That time was just taken".
 */
export function BookPanel({ locationId, types, defaultDate, timeZone }: { locationId: string; types: { id: string; name: string }[]; defaultDate: string; timeZone: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [text, setText] = React.useState('');
  const [hits, setHits] = React.useState<ClientHit[]>([]);
  const [client, setClient] = React.useState<ClientHit | null>(null);
  const [pets, setPets] = React.useState<string[]>([]);
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? '');
  const [from, setFrom] = React.useState(defaultDate);
  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');
  const [done, setDone] = React.useState('');
  const key = React.useRef<{ key: string; body: string } | null>(null);
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Client (name, ref or phone)
          <input className={cn(input, 'w-64')} value={text} onChange={e => setText(e.target.value)} placeholder="Garcia or 916-555-0102" />
        </label>
        <button type="button" className={cn(pillClass, 'border')} disabled={pending} onClick={() => start(async () => {
          setError(''); const r = await findClients(text); if (!r.ok) setError(r.error); else setHits(r.clients);
        })}>Find</button>
      </div>
      {hits.length && !client ? (
        <ul className="divide-y rounded-md border">
          {hits.map(h => (
            <li key={h.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-muted/50" onClick={() => { setClient(h); setPets(h.patients.filter(p => p.status === 'active').slice(0, 1).map(p => p.id)); }}>
              <span className="font-medium">{h.displayName}</span> <span className="font-mono text-xs text-muted-foreground">{h.ref}</span> <span className="text-xs text-muted-foreground">{h.patients.map(p => p.name).join(', ')}</span>
            </button></li>
          ))}
        </ul>
      ) : null}
      {client ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{client.displayName}</span><span className="font-mono text-xs text-muted-foreground">{client.ref}</span>
            <button type="button" className="text-xs underline" onClick={() => { setClient(null); setSlots(null); }}>change</button></div>
          <div className="flex flex-wrap gap-3">
            {client.patients.map(p => (
              <label key={p.id} className={cn('inline-flex items-center gap-1.5', p.status !== 'active' && 'text-muted-foreground line-through')}>
                <input type="checkbox" disabled={p.status !== 'active'} checked={pets.includes(p.id)} onChange={e => setPets(v => e.target.checked ? [...v, p.id] : v.filter(x => x !== p.id))} />{p.name}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Visit type
              <select className={cn(input, 'w-72')} value={typeId} onChange={e => setTypeId(e.target.value)}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">From
              <input type="date" className={input} value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Reason
              <input className={cn(input, 'w-56')} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <button type="button" className={cn(pillClass, 'border')} disabled={pending} onClick={() => start(async () => {
              setError(''); setDone(''); const r = await searchSlots(locationId, typeId, from); if (!r.ok) setError(r.error); else setSlots(r.slots);
            })}>Find times</button>
          </div>
          {slots ? (slots.length ? (
            <div className="flex flex-wrap gap-2">
              {slots.map(s => (
                <button key={s.slotToken} type="button" disabled={pending || !pets.length} className={cn(pillClass, 'h-auto flex-col items-start border py-1.5 text-left')} onClick={() => {
                  const variables = { input: { slotToken: s.slotToken, clientId: client.id, patientIds: pets, reason: reason.trim() || null, channel: 'csr' } };
                  const body = JSON.stringify(variables);
                  if (key.current?.body !== body) key.current = { key: `bookAppointment:${crypto.randomUUID()}`, body };
                  const idempotencyKey = key.current.key;
                  start(async () => {
                    setError('');
                    const r = await runCommand('bookAppointment', variables, idempotencyKey, ['/dashboard/platform/schedule', '/dashboard/platform/today']);
                    if (!r.ok) { setError(r.error); return; }
                    key.current = null; setSlots(null);
                    const d = r.data as { ref?: string; status?: string };
                    setDone(`${d.ref ?? 'Booked'} · ${String(d.status ?? '').replaceAll('_', ' ')}`); router.refresh();
                  });
                }}>
                  <span className="text-sm">{fmt(s.startsAt)}</span><span className="text-xs text-muted-foreground">{s.providerName} · {s.resourceName}</span>
                </button>
              ))}
            </div>
          ) : <p className="text-muted-foreground">No open times in the next 7 days.</p>) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      {done ? <p className="text-xs text-emerald-700">{done}</p> : null}
    </div>
  );
}
