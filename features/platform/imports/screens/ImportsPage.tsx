import { q, practiceTimeZone } from '../../lib/server';
import { when, label, title } from '../../lib/format';
import { ALERT_TONE } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section } from '../../components/ui';
import { ActionButton } from '../../components/ActionButton';
import { ImportUpload } from '../components/ImportUpload';

type Batch = {
  id: string; ref: string; system: string; channel: string; entity: string; fileName: string; status: string; rowsTotal: number; rowsCreated: number; rowsSkipped: number; rowsFailed: number; createdAt: string; finishedAt: string | null;
  location: { name: string } | null; startedBy: { name: string } | null;
  rows: { id: string; rowNumber: number; externalId: string; result: string | null; errors: string[] | null }[];
};

/**
 * Bring records over from the old practice system (BUILD-PLAN P2): Avimark and ezyVet exports, or
 * the ezyVet API where the practice has a key. Each file is previewed row by row; applying writes
 * one row at a time keyed by the old system's id, so a re-run never duplicates.
 */
export default async function ImportsPage({ searchParams }: { searchParams?: Promise<{ batch?: string }> }) {
  const sp = (await searchParams) ?? {};
  const [data, tz] = await Promise.all([
    q<{ importBatches: Batch[]; locations: { id: string; name: string }[] }>(`{
      importBatches(orderBy: { createdAt: desc }, take: 30) {
        id ref system channel entity fileName status rowsTotal rowsCreated rowsSkipped rowsFailed createdAt finishedAt location { name } startedBy { name }
        rows(where: { result: { equals: "failed" } }, orderBy: { rowNumber: asc }, take: 50) { id rowNumber externalId result errors } }
      locations(where: { active: { equals: true } }, orderBy: { code: asc }) { id name } }`),
    practiceTimeZone(),
  ]);
  const chosen = data.importBatches.find(b => b.id === sp.batch) ?? data.importBatches.find(b => b.status === 'validated');
  const path = '/dashboard/platform/imports';
  return (
    <Page title="Import from your old system">
      <Section title="New import">
        <p className="text-sm text-muted-foreground">Export clients, patients, weights, vaccinations, reminders and visit records from Avimark or ezyVet as CSV and load them in that order. Imported visit records arrive signed by the original veterinarian and read-only.</p>
        <ImportUpload locations={data.locations} />
      </Section>

      {chosen ? (
        <Section title={`Batch ${chosen.ref}`}>
          <Meta>{title(chosen.system)} · {label(chosen.entity)} · {chosen.fileName || label(chosen.channel)} · {chosen.location?.name} · {when(chosen.createdAt, tz)}</Meta>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Rows</div>{chosen.rowsTotal}</div>
            <div><div className="text-xs text-muted-foreground">Created</div>{chosen.rowsCreated}</div>
            <div><div className="text-xs text-muted-foreground">Already here</div>{chosen.rowsSkipped}</div>
            <div><div className="text-xs text-muted-foreground">With problems</div>{chosen.rowsFailed}</div>
          </div>
          {chosen.rows.filter(r => r.errors?.length).length ? (
            <div className={`space-y-1 rounded-md border px-3 py-2 text-sm ${ALERT_TONE.warning}`}>
              <p className="font-medium">Rows that will not be imported</p>
              {chosen.rows.filter(r => r.errors?.length).map(r => <p key={r.id} className="break-words">Row {r.rowNumber} ({r.externalId}): {r.errors!.join(' ')}</p>)}
            </div>
          ) : null}
          {chosen.status === 'validated' ? (
            <ActionButton op="applyImport" vars={{ batchId: chosen.id }} paths={[path]} confirm={`Import ${chosen.rowsTotal - chosen.rowsFailed} rows into the practice? Rows with problems are skipped.`}>Apply import</ActionButton>
          ) : null}
        </Section>
      ) : null}

      <Section title="Past imports">
        {data.importBatches.length ? data.importBatches.map(b => (
          <Row key={b.id} href={`${path}?batch=${b.id}`}>
            <div className="min-w-0 flex-1"><span className="font-mono text-xs">{b.ref}</span> {title(b.system)} · {label(b.entity)}<Meta>{b.fileName || label(b.channel)} · {b.rowsCreated} created, {b.rowsSkipped} already here, {b.rowsFailed} with problems · {b.startedBy?.name ?? 'system'} · {when(b.createdAt, tz)}</Meta></div>
            <Status value={b.status} />
          </Row>
        )) : <Empty>No imports yet.</Empty>}
      </Section>
    </Page>
  );
}
