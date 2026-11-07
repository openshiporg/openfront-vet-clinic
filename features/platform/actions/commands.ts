'use server';

import { revalidatePath } from 'next/cache';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

/**
 * The only custom operations the dashboard screens can call. Each takes an idempotency key that the
 * client makes once per intent and reuses on retry, so a lost response never acts twice.
 */
const OPS: Record<string, Record<string, string>> = {
  decideApprovalRequest: { requestId: 'ID!', decision: 'String!', reason: 'String', expectedVersion: 'Int!' },
  cancelApprovalRequest: { requestId: 'ID!', expectedVersion: 'Int!', reason: 'String' },
  requestPracticeControls: { changes: 'JSON!', reason: 'String!' },
};

const KEY = /^[A-Za-z0-9._:-]{8,200}$/;

export async function runCommand(op: string, variables: Record<string, unknown>, idempotencyKey: string, paths: string[] = []) {
  const spec = OPS[op];
  if (!spec) return { ok: false as const, error: 'Unknown action' };
  if (!KEY.test(idempotencyKey)) return { ok: false as const, error: 'Missing request key. Reload the page and try again.' };
  const keys = Object.keys(variables).filter((k) => k in spec && variables[k] !== undefined && variables[k] !== '');
  const decl = [...keys.map((k) => `$${k}: ${spec[k]}`), '$idempotencyKey: String!'];
  const args = [...keys.map((k) => `${k}: $${k}`), 'idempotencyKey: $idempotencyKey'];
  const vars: Record<string, unknown> = { ...Object.fromEntries(keys.map((k) => [k, variables[k]])), idempotencyKey };
  const res = await keystoneClient(`mutation Run(${decl.join(', ')}) { ${op}(${args.join(', ')}) }`, vars);
  if (!res.success) return { ok: false as const, error: res.error || 'Action failed' };
  for (const p of paths) revalidatePath(p);
  return { ok: true as const, data: (res.data as Record<string, unknown>)?.[op] };
}
