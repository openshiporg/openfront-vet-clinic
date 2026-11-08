'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../../actions/commands';
import { pillClass } from '../../components/ActionButton';

type Tooth = { findings?: string[]; procedures?: string[] };

/** Modified Triadan numbering: quadrant 1–4, tooth 01–11. Cats lack 105, 305 and 306 and the upper molar 110. */
function teethFor(species: string) {
  const feline = species === 'feline';
  const upper = feline ? ['01', '02', '03', '04', '06', '07', '08', '09'] : ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
  const lower = feline ? ['01', '02', '03', '04', '07', '08', '09'] : ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];
  return { upperRight: upper.map(t => `1${t}`).reverse(), upperLeft: upper.map(t => `2${t}`), lowerRight: lower.map(t => `4${t}`).reverse(), lowerLeft: lower.map(t => `3${t}`) };
}

const FINDINGS: [string, string][] = [['missing', 'Missing'], ['fracture', 'Fractured'], ['resorption', 'Resorption'], ['mobility', 'Mobile'], ['furcation', 'Furcation exposed'], ['calculus', 'Calculus'], ['gingivitis', 'Gingivitis'], ['pocket', 'Periodontal pocket'], ['recession', 'Gingival recession']];
const PROCEDURES: [string, string][] = [['extraction', 'Extraction'], ['surgical_extraction', 'Surgical extraction'], ['root_planing', 'Root planing'], ['restoration', 'Restoration'], ['sealant', 'Sealant'], ['radiograph', 'Radiograph']];

/**
 * The dental chart for one visit: click a tooth, tick what was found and done, save. The whole
 * chart is saved at once (dental.chart), and the server rejects any tooth number outside Triadan.
 */
export function DentalChart({ encounterId, species, initial, paths, readOnly }: { encounterId: string; species: string; initial: Record<string, Tooth>; paths: string[]; readOnly?: boolean }) {
  const router = useRouter();
  const [teeth, setTeeth] = React.useState<Record<string, Tooth>>(initial);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState('');
  const key = React.useRef<{ key: string; body: string } | null>(null);
  const map = teethFor(species);
  const toggle = (tooth: string, list: 'findings' | 'procedures', code: string) => setTeeth(t => {
    const cur = t[tooth]?.[list] ?? [];
    const next = cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code];
    const tt = { ...t[tooth], [list]: next };
    const out = { ...t, [tooth]: tt };
    if (!tt.findings?.length && !tt.procedures?.length) delete out[tooth];
    return out;
  });
  const save = () => {
    const body = JSON.stringify(teeth);
    if (key.current?.body !== body) key.current = { key: `dental:${crypto.randomUUID()}`, body };
    setError('');
    start(async () => {
      const r = await runCommand('saveDentalChart', { encounterId, teeth }, key.current!.key, paths);
      if (!r.ok) setError(r.error); else router.refresh();
    });
  };
  const cell = (t: string) => {
    const marked = teeth[t];
    return (
      <button key={t} type="button" disabled={readOnly} onClick={() => setChosen(chosen === t ? null : t)}
        className={cn('h-9 min-w-9 rounded border px-1 font-mono text-xs', marked?.procedures?.includes('extraction') || marked?.procedures?.includes('surgical_extraction') ? 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : marked ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : '', chosen === t && 'ring-2 ring-primary')}>
        {t}
      </button>
    );
  };
  const row = (a: string[], b: string[]) => (
    <div className="flex flex-wrap justify-center gap-1">
      <div className="flex flex-wrap justify-end gap-1">{a.map(cell)}</div>
      <div className="w-2 border-l" aria-hidden />
      <div className="flex flex-wrap gap-1">{b.map(cell)}</div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="space-y-2 overflow-x-auto">
        <div className="text-center text-xs text-muted-foreground">Upper · patient&apos;s right on the left</div>
        {row(map.upperRight, map.upperLeft)}
        {row(map.lowerRight, map.lowerLeft)}
        <div className="text-center text-xs text-muted-foreground">Lower</div>
      </div>
      {chosen ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Tooth {chosen}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{FINDINGS.map(([c, l]) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={teeth[chosen]?.findings?.includes(c) ?? false} onChange={() => toggle(chosen, 'findings', c)} />{l}</label>)}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{PROCEDURES.map(([c, l]) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={teeth[chosen]?.procedures?.includes(c) ?? false} onChange={() => toggle(chosen, 'procedures', c)} />{l}</label>)}</div>
        </div>
      ) : null}
      <ul className="space-y-1 text-sm">
        {Object.keys(teeth).sort().map(t => (
          <li key={t} className="break-words"><span className="font-mono">{t}</span> · {[...(teeth[t].findings ?? []).map(c => FINDINGS.find(f => f[0] === c)?.[1] ?? c), ...(teeth[t].procedures ?? []).map(c => PROCEDURES.find(f => f[0] === c)?.[1] ?? c)].join(', ')}</li>
        ))}
      </ul>
      {!readOnly ? <button type="button" disabled={pending} onClick={save} className={cn(pillClass, 'border')}>{pending ? 'Saving' : 'Save dental chart'}</button> : null}
      {error ? <p role="alert" className="break-words text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
