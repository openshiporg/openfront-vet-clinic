'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../../actions/commands';
import { pillClass } from '../../components/ActionButton';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/heic,image/webp';

/** The file as base64, read in the browser (no data: prefix). */
async function base64Of(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Record what was checked about who is asking. For a third party the person checking attaches the proof they were given (the
 * client's signed authorisation, or the order) here: it is stored first, then the check is recorded against that document.
 * A file already attached is reused when the check is retried.
 */
export function VerifyRequestForm({ requestId, expectedVersion, needsProof, proofOptional, again, path }: {
  requestId: string; expectedVersion: number; needsProof: boolean; proofOptional: boolean; again: boolean; path: string;
}) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState('');
  const [pending, start] = React.useTransition();
  const attached = React.useRef<{ name: string; size: number; key: string; id?: string } | null>(null);
  const verifyKey = React.useRef<string | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      setError('');
      if (!note.trim()) { setError('Say what you checked.'); return; }
      if (needsProof && !proofOptional && !file) { setError('Attach the signed authorisation you were given.'); return; }
      if (file && file.size > 4_000_000) { setError('The file must be under 4 MB.'); return; }
      start(async () => {
        let authorisationDocumentId: string | undefined;
        if (file) {
          if (!attached.current || attached.current.name !== file.name || attached.current.size !== file.size) attached.current = { name: file.name, size: file.size, key: `attachRecordsProof:${crypto.randomUUID()}` };
          if (!attached.current.id) {
            const up = await runCommand('attachRecordsProof', { requestId, fileName: file.name, mimeType: file.type, contentBase64: await base64Of(file) }, attached.current.key);
            if (!up.ok) { setError(up.error); return; }
            attached.current.id = String((up.data as { id: string }).id);
          }
          authorisationDocumentId = attached.current.id;
        }
        verifyKey.current ??= `verifyRecordsRequest:${crypto.randomUUID()}`;
        const r = await runCommand('verifyRecordsRequest', { requestId, note: note.trim(), authorisationDocumentId, expectedVersion }, verifyKey.current, [path]);
        if (!r.ok) { setError(r.error); return; }
        verifyKey.current = null; attached.current = null; setFile(null); setNote('');
        router.refresh();
      });
    }}>
      <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:w-96">
        What you checked
        <input className="h-11 rounded-md border bg-background px-2 text-sm text-foreground sm:h-8" value={note} placeholder="Called the client on the number on file" onChange={(e) => setNote(e.target.value)} />
      </label>
      {needsProof ? (
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted-foreground">
          {proofOptional ? 'The order or request (optional)' : 'Signed authorisation'}
          <input type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); attached.current = null; }} className="block max-w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
          <span className="text-[11px]">PDF or photo, under 4 MB. Kept with the request.</span>
        </label>
      ) : null}
      <button type="submit" disabled={pending} className={cn(pillClass, 'border')}>{pending ? 'Saving' : again ? 'Check again' : 'Checked'}</button>
      {error ? <span role="alert" className="w-full break-words text-xs text-red-600">{error}</span> : null}
    </form>
  );
}
