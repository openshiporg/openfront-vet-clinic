'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { runCommand } from '../../actions/commands';
import { pillClass } from '../../components/ActionButton';

const SYSTEMS = [{ value: 'avimark', label: 'Avimark' }, { value: 'ezyvet', label: 'ezyVet' }, { value: 'csv', label: 'Other (CSV with our column names)' }];
const ENTITIES = [{ value: 'clients', label: 'Clients' }, { value: 'patients', label: 'Patients' }, { value: 'weights', label: 'Weights' }, { value: 'vaccinations', label: 'Vaccinations' }, { value: 'reminders', label: 'Reminders' }, { value: 'consults', label: 'Visit records' }];
const select = 'h-9 w-full rounded-md border bg-background px-2 text-sm sm:w-64';

/**
 * Choose the export file from the old practice system; it is read in the browser and sent for a
 * preview. Nothing is written to the practice until the preview is applied.
 */
export function ImportUpload({ locations }: { locations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [system, setSystem] = React.useState('avimark');
  const [entity, setEntity] = React.useState('clients');
  const [locationId, setLocation] = React.useState(locations[0]?.id ?? '');
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <form className="space-y-3" onSubmit={e => {
      e.preventDefault();
      setError('');
      if (!file) { setError('Choose the export file.'); return; }
      if (file.size > 5_000_000) { setError('The file is over 5 MB; split it by year or use the ezyVet connection.'); return; }
      start(async () => {
        const csv = await file.text();
        const r = await runCommand('previewImport', { system, entity, locationId, fileName: file.name, csv, source: 'manual-csv' }, `import:${crypto.randomUUID()}`, ['/dashboard/platform/imports']);
        if (!r.ok) setError(r.error); else { setFile(null); router.refresh(); }
      });
    }}>
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">From</span><select className={select} value={system} onChange={e => setSystem(e.target.value)}>{SYSTEMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">The file holds</span><select className={select} value={entity} onChange={e => setEntity(e.target.value)}>{ENTITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">Location</span><select className={select} value={locationId} onChange={e => setLocation(e.target.value)}>{locations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      </div>
      <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full max-w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
      <button type="submit" disabled={pending} className={cn(pillClass, 'border')}>{pending ? 'Checking the file' : 'Preview import'}</button>
      {error ? <p role="alert" className="break-words text-xs text-red-600">{error}</p> : null}
    </form>
  );
}
