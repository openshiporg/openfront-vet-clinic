'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../../actions/commands';
import { pillClass } from '../../components/ActionButton';

type Block = { index: number; title: string; body: string; accepted: boolean };

/**
 * A scribe draft, block by block: the clinician edits a block if needed and accepts it into that
 * SOAP section, or rejects the whole draft with a reason. Nothing is written until they do.
 */
export function AcceptDraft({ draftId, sections, paths }: { draftId: string; sections: Block[]; paths: string[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState('');
  const [bodies, setBodies] = React.useState<Record<number, string>>(() => Object.fromEntries(sections.map(s => [s.index, s.body])));
  const keys = React.useRef<Record<string, string>>({});
  const keyFor = (intent: string) => (keys.current[intent] ??= `scribe:${crypto.randomUUID()}`);
  const run = (op: string, vars: Record<string, unknown>, intent: string) => {
    setError('');
    start(async () => {
      const r = await runCommand(op, vars, keyFor(intent), paths);
      if (!r.ok) setError(r.error);
      else { delete keys.current[intent]; router.refresh(); }
    });
  };
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Scribe draft: check each block before it goes in the record</p>
      {sections.map(s => (
        <div key={s.index} className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{s.title}{s.accepted ? ' · accepted' : ''}</div>
          <textarea rows={3} disabled={s.accepted} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed disabled:opacity-60" value={bodies[s.index]} onChange={e => setBodies(b => ({ ...b, [s.index]: e.target.value }))} />
          {!s.accepted ? (
            <button type="button" disabled={pending} className={cn(pillClass, 'border')} onClick={() => run('acceptScribeDraft', { draftId, blocks: [{ index: s.index, body: bodies[s.index] }] }, `accept:${s.index}:${bodies[s.index]}`)}>
              {pending ? 'Working' : `Accept into ${s.title.toLowerCase()}`}
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" disabled={pending} className={cn(pillClass, 'border')} onClick={() => {
        const reason = window.prompt('Why reject this draft?');
        if (reason?.trim()) run('rejectScribeDraft', { draftId, reason: reason.trim() }, `reject:${reason.trim()}`);
      }}>Reject draft</button>
      {error ? <p role="alert" className="break-words text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
