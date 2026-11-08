import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label, quantity } from '../../lib/format';
import { asaText } from '../../lib/clinical';
import { Page, Empty, Status, Meta, Section, Stat } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';
import { DentalChart } from '../components/DentalChart';

type R = {
  id: string; ref: string; status: string; procedure: string; asaStatus: string; fastingConfirmed: boolean; consentConfirmed: boolean; version: number; complications: string;
  inductionAt: string | null; intubatedAt: string | null; extubatedAt: string | null; recoveryEndAt: string | null;
  anaesthetist: { displayName: string } | null; dvm: { displayName: string } | null; preWeight: { value: string; unit: string } | null;
  patient: { id: string; name: string; species: { code: string; name: string } | null } | null;
  encounter: { id: string; ref: string; kind: string; status: string } | null;
  readings: { id: string; at: string; hr: number | null; rr: number | null; spo2: number | null; etco2: number | null; sbp: number | null; map: number | null; tempC: string | null; agentPct: string | null; notes: string; by: { displayName: string } | null }[];
};

/**
 * One anaesthetic (BUILD-PLAN P2): ASA status, fasting and consent, induction to recovery, and the
 * monitoring log every few minutes; with the surgery report or dental chart for the same visit.
 */
export default async function AnaesthesiaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tz] = await Promise.all([
    q<{ anaesthesiaRecord: R | null }>(`
      query A($id: ID!) { anaesthesiaRecord(where: { id: $id }) {
        id ref status procedure asaStatus fastingConfirmed consentConfirmed version complications inductionAt intubatedAt extubatedAt recoveryEndAt
        anaesthetist { displayName } dvm { displayName } preWeight { value unit } patient { id name species { code name } } encounter { id ref kind status }
        readings(orderBy: { at: desc }, take: 200) { id at hr rr spo2 etco2 sbp map tempC agentPct notes by { displayName } } } }`, { id }).catch(() => null),
    practiceTimeZone(),
  ]);
  const r = data?.anaesthesiaRecord;
  if (!r || !r.encounter || !r.patient) notFound();
  const extra = await q<{ surgeryReports: { id: string; procedure: string; technique: string; findings: string; closure: string; sutures: string; surgeon: { displayName: string } | null }[]; dentalCharts: { teeth: Record<string, { findings?: string[]; procedures?: string[] }> | null }[] }>(`
    query X($enc: ID!) { surgeryReports(where: { encounter: { id: { equals: $enc } } }) { id procedure technique findings closure sutures surgeon { displayName } }
      dentalCharts(where: { encounter: { id: { equals: $enc } } }) { teeth } }`, { enc: r.encounter.id });
  const path = `/dashboard/platform/anaesthesia/${r.id}`;
  const paths = [path, `/dashboard/platform/encounters/${r.encounter.id}`];
  const live = r.status === 'open' || r.status === 'monitoring' || r.status === 'recovery';
  const chartable = ['open', 'in_progress', 'pending_signature'].includes(r.encounter.status);
  const report = extra.surgeryReports[0];
  return (
    <Page title={`${r.patient.name} · ${r.ref}`} crumbs={[{ label: 'Encounters', href: '/dashboard/platform/encounters' }, { label: r.encounter.ref, href: `/dashboard/platform/encounters/${r.encounter.id}` }]}>
      <header className="flex flex-wrap items-center gap-3"><span className="font-medium">{r.procedure}</span><Status value={r.status} /><Meta>{asaText(r.asaStatus)} · {r.fastingConfirmed ? 'fasted' : 'not fasted'} · consent {r.consentConfirmed ? 'on file' : 'missing'} · anaesthetist {r.anaesthetist?.displayName ?? 'not named'}</Meta></header>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Induction" value={r.inductionAt ? when(r.inductionAt, tz, 'time') : '—'} />
        <Stat name="Intubated" value={r.intubatedAt ? when(r.intubatedAt, tz, 'time') : '—'} />
        <Stat name="Extubated" value={r.extubatedAt ? when(r.extubatedAt, tz, 'time') : '—'} />
        <Stat name="Weight" value={r.preWeight ? `${quantity(r.preWeight.value)} ${r.preWeight.unit}` : '—'} />
      </div>
      {live ? (
        <div className="flex flex-wrap gap-2">
          {r.status === 'open' ? <ActionButton op="anaesthesiaEvent" vars={{ recordId: r.id, event: 'induce', expectedVersion: r.version }} paths={paths}>Induction</ActionButton> : null}
          {r.status === 'monitoring' && !r.intubatedAt ? <ActionButton op="anaesthesiaEvent" vars={{ recordId: r.id, event: 'intubate', expectedVersion: r.version }} paths={paths}>Intubated</ActionButton> : null}
          {r.status === 'monitoring' ? <ActionButton op="anaesthesiaEvent" vars={{ recordId: r.id, event: 'extubate', expectedVersion: r.version }} paths={paths}>Extubated</ActionButton> : null}
        </div>
      ) : null}

      <Section title="Monitoring">
        {live && r.status !== 'open' ? (
          <CommandForm op="recordMonitoring" build="recordMonitoring" submit="Record reading" fixed={{ recordId: r.id }} paths={paths}
            fields={[
              { name: 'hr', label: 'HR', width: 'sm' }, { name: 'rr', label: 'RR', width: 'sm' }, { name: 'spo2', label: 'SpO₂ %', width: 'sm' }, { name: 'etco2', label: 'EtCO₂', width: 'sm' },
              { name: 'sbp', label: 'Systolic', width: 'sm' }, { name: 'map', label: 'MAP', width: 'sm' }, { name: 'tempC', label: 'Temp °C', width: 'sm' }, { name: 'agentPct', label: 'Agent %', width: 'sm' },
              { name: 'notes', label: 'Notes', width: 'lg' },
            ]} />
        ) : null}
        {r.readings.length ? (
          <>
          <ul className="divide-y rounded-md border md:hidden">
            {r.readings.map(m => (
              <li key={m.id} className="space-y-1 px-3 py-2 text-xs">
                <p className="font-medium">{when(m.at, tz, 'time')} · {m.by?.displayName}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                  {m.hr !== null ? <span>HR {m.hr}</span> : null}
                  {m.rr !== null ? <span>RR {m.rr}</span> : null}
                  {m.spo2 !== null ? <span className={m.spo2 < 90 ? 'text-red-700' : ''}>SpO₂ {m.spo2}</span> : null}
                  {m.etco2 !== null ? <span>EtCO₂ {m.etco2}</span> : null}
                  {m.sbp !== null ? <span>SBP {m.sbp}</span> : null}
                  {m.map !== null ? <span className={m.map < 60 ? 'text-red-700' : ''}>MAP {m.map}</span> : null}
                  {m.tempC ? <span>Temp {quantity(m.tempC)} °C</span> : null}
                  {m.agentPct ? <span>Agent {quantity(m.agentPct)} %</span> : null}
                </p>
                {m.notes ? <p className="break-words text-muted-foreground">{m.notes}</p> : null}
              </li>
            ))}
          </ul>
          <div className="hidden max-w-full overflow-x-auto rounded-md border md:block">
            <table className="min-w-max text-xs">
              <thead><tr className="border-b text-left">{['Time', 'HR', 'RR', 'SpO₂', 'EtCO₂', 'SBP', 'MAP', 'Temp °C', 'Agent %', 'Notes', 'By'].map(h => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{r.readings.map(m => (
                <tr key={m.id} className="border-b last:border-b-0 font-mono">
                  <td className="px-2 py-1.5">{when(m.at, tz, 'time')}</td><td className="px-2 py-1.5">{m.hr ?? ''}</td><td className="px-2 py-1.5">{m.rr ?? ''}</td>
                  <td className={`px-2 py-1.5 ${m.spo2 !== null && m.spo2 < 90 ? 'text-red-700' : ''}`}>{m.spo2 ?? ''}</td><td className="px-2 py-1.5">{m.etco2 ?? ''}</td><td className="px-2 py-1.5">{m.sbp ?? ''}</td>
                  <td className={`px-2 py-1.5 ${m.map !== null && m.map < 60 ? 'text-red-700' : ''}`}>{m.map ?? ''}</td><td className="px-2 py-1.5">{quantity(m.tempC)}</td><td className="px-2 py-1.5">{quantity(m.agentPct)}</td>
                  <td className="max-w-64 whitespace-normal break-words px-2 py-1.5 font-sans">{m.notes}</td><td className="px-2 py-1.5 font-sans">{m.by?.displayName}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          </>
        ) : <Empty>No readings yet. Readings start after induction.</Empty>}
        <p className="text-xs text-muted-foreground">Readings below SpO₂ 90 % or MAP 60 mmHg are shown in red.</p>
      </Section>

      {r.status === 'recovery' ? (
        <Section title="Close the anaesthetic">
          <CommandForm op="closeAnaesthesia" build="closeAnaesthesia" submit="Close record" fixed={{ recordId: r.id, expectedVersion: String(r.version) }} paths={paths}
            fields={[{ name: 'complications', label: 'Complications (leave empty if none)', width: 'full', multiline: 2 }]} />
        </Section>
      ) : r.status === 'closed' ? <Meta>Closed{r.complications ? ` · complications: ${r.complications}` : ' · no complications recorded'}.</Meta> : null}

      {r.encounter.kind !== 'dental' ? (
        <Section title="Surgery report">
          {report ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
              {([['Procedure', report.procedure], ['Technique', report.technique], ['Findings', report.findings], ['Closure', report.closure], ['Sutures', report.sutures], ['Surgeon', report.surgeon?.displayName ?? '']] as const).map(([k, v]) => v ? <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></React.Fragment> : null)}
            </dl>
          ) : <Empty>No surgery report yet.</Empty>}
          {chartable ? (
            <CommandForm key={report?.id ?? 'new'} op="saveSurgeryReport" build="saveSurgeryReport" submit="Save report" fixed={{ encounterId: r.encounter.id }} paths={paths}
              fields={[
                { name: 'procedure', label: 'Procedure', width: 'lg', defaultValue: report?.procedure ?? r.procedure },
                { name: 'technique', label: 'Technique', width: 'full', multiline: 3, defaultValue: report?.technique ?? '' },
                { name: 'findings', label: 'Findings', width: 'full', multiline: 2, defaultValue: report?.findings ?? '' },
                { name: 'closure', label: 'Closure', width: 'lg', defaultValue: report?.closure ?? '' },
                { name: 'sutures', label: 'Sutures', width: 'lg', defaultValue: report?.sutures ?? '', placeholder: '3-0 PDS, intradermal' },
              ]} />
          ) : null}
        </Section>
      ) : null}

      {r.encounter.kind === 'dental' ? (
        <Section title="Dental chart">
          <DentalChart encounterId={r.encounter.id} species={r.patient.species?.code ?? 'canine'} initial={extra.dentalCharts[0]?.teeth ?? {}} paths={paths} readOnly={!chartable} />
        </Section>
      ) : null}
      <p className="text-xs text-muted-foreground"><Link className="underline" href={`/dashboard/platform/encounters/${r.encounter.id}`}>Back to the visit record</Link> · {label(r.encounter.kind)} · signing the visit freezes this record too.</p>
    </Page>
  );
}

