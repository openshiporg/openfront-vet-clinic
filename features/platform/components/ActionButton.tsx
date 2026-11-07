'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../actions/commands';

export function PillTrack({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1', className)}>{children}</div>;
}

export const pillClass = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md bg-background px-3 text-sm font-medium shadow-sm transition disabled:opacity-50';

const newKey = (op: string) => `${op}:${crypto.randomUUID()}`;

/**
 * Runs one named command. The idempotency key is made once per intent and kept until the command
 * succeeds, so retrying after a timeout replays the first result instead of acting twice.
 */
export function ActionButton({ op, vars, children, paths, confirm, ask, onDone, className }: {
  op: string; vars: Record<string, unknown>; children: React.ReactNode; paths?: string[]; confirm?: string;
  /** Prompt for a reason; the answer goes in vars.reason. */
  ask?: string;
  onDone?: (data: unknown) => void; className?: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState('');
  const key = React.useRef<{ key: string; body: string } | null>(null);
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={cn(pillClass, className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          let reason: string | undefined;
          if (ask) {
            const answer = window.prompt(ask);
            if (answer === null) return;
            reason = answer.trim();
          }
          setError('');
          const variables = reason !== undefined ? { ...vars, reason } : vars;
          const body = JSON.stringify(variables);
          // Same intent, same key; a changed reason or target is a new intent.
          if (key.current?.body !== body) key.current = { key: newKey(op), body };
          const idempotencyKey = key.current.key;
          start(async () => {
            const r = await runCommand(op, variables, idempotencyKey, paths);
            if (!r.ok) setError(r.error);
            else { key.current = null; onDone?.(r.data); router.refresh(); }
          });
        }}
      >
        {pending ? 'Working' : children}
      </button>
      {error ? <span role="alert" className="max-w-xs break-words text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
