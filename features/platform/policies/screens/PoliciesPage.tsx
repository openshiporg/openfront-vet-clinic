import { q } from '../../lib/server';
import { title, policyRule, policyLayer, calendarDay } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type MatrixRow = { location: string; locationName: string; kind: string; on: string; ok: boolean; verified?: boolean; versions?: { id: string; packCode: string; layer: string; verified: boolean }[]; unverifiedRules?: string[]; code?: string; message?: string };
type Version = { id: string; label: string; status: string; verified: boolean; unverifiedRules: string[]; sourceRefs: { ref: string; title: string; url?: string; section?: string }[]; effectiveFrom: string; effectiveTo: string | null; rulesHash: string; pack: { code: string; kind: string; jurisdiction: string; name: string } | null };

/**
 * Policy packs (D§7): federal and state rules as effective-dated data with their sources. A rule we
 * could not check against a primary text is marked (verify) and the version shows a banner. Each
 * location resolves every kind or the action that needs it is refused (fail closed).
 */
export default async function PoliciesPage() {
  const data = await q<{ policyMatrix: MatrixRow[]; policyVersions: Version[] }>(`{
    policyMatrix
    policyVersions(orderBy: { effectiveFrom: desc }, take: 200) { id label status verified unverifiedRules sourceRefs effectiveFrom effectiveTo rulesHash pack { code kind jurisdiction name } }
  }`);
  const rows = data.policyMatrix ?? [];
  const failing = rows.filter(r => !r.ok);
  const unverified = data.policyVersions.filter(v => !v.verified);
  const locations = [...new Set(rows.map(r => r.location))];
  return (
    <Page title="Policy packs">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Versions" value={data.policyVersions.length} />
        <Stat name="Resolving" value={`${rows.length - failing.length}/${rows.length}`} />
        <Stat name="Fail closed" value={failing.length ? <span className="text-red-600">{failing.length}</span> : 0} />
        <Stat name="(verify) banners" value={unverified.length ? <span className="text-amber-600">{unverified.length}</span> : 0} />
      </div>
      {unverified.length ? (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {unverified.length} policy versions contain rules not yet checked against the primary source. They apply as written; confirm them with counsel or the regulator before relying on them.
        </p>
      ) : null}
      {locations.map(code => (
        <Section key={code} title={`In force today · ${rows.find(r => r.location === code)?.locationName ?? code}`}>
          {rows.filter(r => r.location === code).map(r => (
            <Row key={`${code}-${r.kind}`}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <p className="font-medium">{title(r.kind)}</p>
                <Meta>{r.ok ? (r.versions ?? []).map(v => policyLayer(v.layer, v.packCode)).join(' → ') : r.message}</Meta>
                {r.ok && r.unverifiedRules?.length ? <p className="break-words text-xs text-amber-700">verify: {r.unverifiedRules.map(policyRule).join('; ')}</p> : null}
              </div>
              <Status value={!r.ok ? 'failed' : r.verified ? 'active' : 'unverified'} />
            </Row>
          ))}
        </Section>
      ))}
      <Section title="Versions and sources">
        {data.policyVersions.length ? data.policyVersions.map(v => (
          <Row key={v.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{v.pack?.name ?? v.label}</span><span className="text-xs text-muted-foreground">{v.pack ? `${v.pack.jurisdiction === 'US' ? 'Federal' : v.pack.jurisdiction} · ${title(v.pack.kind)}` : ''}</span></div>
              <Meta>from {calendarDay(v.effectiveFrom)}{v.effectiveTo ? ` to ${calendarDay(v.effectiveTo)}` : ''} · hash {v.rulesHash.slice(0, 12)}</Meta>
              <ul className="space-y-0.5 text-xs">
                {(v.sourceRefs ?? []).map(s => <li key={s.ref + s.title} className="break-words">{s.url ? <a className="underline underline-offset-2" href={s.url} target="_blank" rel="noreferrer">{s.ref}</a> : s.ref} · {s.title}{s.section ? ` ${s.section}` : ''}</li>)}
              </ul>
              {!v.verified && v.unverifiedRules?.length ? <p className="break-words text-xs text-amber-700">(verify) {v.unverifiedRules.map(policyRule).join('; ')}</p> : null}
            </div>
            <Status value={v.verified ? v.status : 'unverified'} />
          </Row>
        )) : <Empty>No policy packs yet. Load the practice from the onboarding card.</Empty>}
      </Section>
    </Page>
  );
}
