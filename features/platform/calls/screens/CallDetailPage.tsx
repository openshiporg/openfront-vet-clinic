import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone } from '../../lib/server';
import { when, label } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section } from '../../components/ui';

type Turn = { role?: string; speaker?: string; text?: string; at?: string };
type Call = {
  id: string; ref: string; direction: string; from: string; to: string; answeredBy: string; adapterKey: string; providerCallId: string; disposition: string; status: string;
  startedAt: string; endedAt: string | null; durationSeconds: number | null; disclosurePlayedAt: string | null; recordingConsent: string; verificationMethod: string; callerVerifiedAt: string | null;
  transcript: Turn[] | null; summary: string; transferTo: string; recordingRef: string;
  client: { id: string; displayName: string } | null; person: { firstName: string; lastName: string } | null; agent: { name: string } | null; location: { name: string } | null;
};

/** One call: the disclosure, verification, triage, what was done, and the transcript (redacted text only). */
export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tz] = await Promise.all([
    q<{ callRecord: Call | null; triageAssessments: { id: string; level: string; outcome: string; complaint: string; redFlagsHit: string[] | null; at: string; referredTo: { name: string; phone: string } | null }[]; appointments: { id: string; ref: string; startsAt: string; status: string; appointmentType: { name: string } | null }[]; refillRequests: { ref: string; productText: string; status: string }[]; recordsRequests: { ref: string; status: string; scope: string }[] }>(`
      query Call($id: ID!) {
        callRecord(where: { id: $id }) {
          id ref direction from to answeredBy adapterKey providerCallId disposition status startedAt endedAt durationSeconds disclosurePlayedAt recordingConsent verificationMethod callerVerifiedAt
          transcript summary transferTo recordingRef client { id displayName } person { firstName lastName } agent { name } location { name }
        }
        triageAssessments(where: { callRecord: { id: { equals: $id } } }, orderBy: { at: asc }) { id level outcome complaint redFlagsHit at referredTo { name phone } }
        appointments(where: { callRecord: { id: { equals: $id } } }) { id ref startsAt status appointmentType { name } }
        refillRequests(where: { callRecord: { id: { equals: $id } } }) { ref productText status }
        recordsRequests(where: { callRecord: { id: { equals: $id } } }) { ref status scope }
      }`, { id }).catch(() => ({ callRecord: null, triageAssessments: [], appointments: [], refillRequests: [], recordsRequests: [] })),
    practiceTimeZone(),
  ]);
  const c = data.callRecord;
  if (!c) notFound();
  const turns = Array.isArray(c.transcript) ? c.transcript : [];
  return (
    <Page title={c.ref} crumbs={[{ label: 'Calls', href: '/dashboard/platform/calls' }]}>
      <div className="flex flex-wrap items-center gap-3">
        <Status value={c.status} /><span className="font-mono text-xs uppercase">{label(c.disposition)}</span>
        <Meta>{when(c.startedAt, tz)} · {label(c.direction)} · {c.from} → {c.to} · {c.location?.name} · {c.answeredBy === 'ai' ? `AI receptionist (${c.agent?.name ?? ''})` : label(c.answeredBy)} · via {c.adapterKey || 'manual'}</Meta>
      </div>
      <Section title="Safeguards">
        <Row><span>AI and recording disclosure</span><Meta>{c.answeredBy !== 'ai' ? 'staff call' : c.disclosurePlayedAt ? `played ${when(c.disclosurePlayedAt, tz, 'seconds')}` : 'not played'}</Meta></Row>
        <Row><span>Recording</span><Meta>{label(c.recordingConsent)}{c.recordingRef ? ' · stored' : ''}</Meta></Row>
        <Row><span>Caller</span><Meta>{c.client ? <Link className="underline" href={`/dashboard/platform/clients/${c.client.id}`}>{c.client.displayName}</Link> : 'unknown number'}{c.person ? ` · ${c.person.firstName} ${c.person.lastName}` : ''} · {c.callerVerifiedAt ? `verified by ${label(c.verificationMethod)} at ${when(c.callerVerifiedAt, tz, 'seconds')}` : 'not verified (no patient details given)'}</Meta></Row>
        {c.transferTo ? <Row><span>Transferred to</span><Meta>{c.transferTo}</Meta></Row> : null}
      </Section>
      <Section title="Urgency screen">
        {data.triageAssessments.length ? data.triageAssessments.map(t => (
          <Row key={t.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1"><span>{t.complaint}</span><Meta>{label(t.outcome)}{t.redFlagsHit?.length ? ` · red flags: ${t.redFlagsHit.join(', ')}` : ''}{t.referredTo ? ` · referred to ${t.referredTo.name} ${t.referredTo.phone}` : ''}</Meta></div>
            <Status value={t.level === 'emergency_now' ? 'urgent' : t.level === 'urgent_today' ? 'overdue' : 'ok'} /><span className="font-mono text-xs uppercase">{label(t.level)}</span>
          </Row>
        )) : <Empty>No urgency screen on this call.</Empty>}
      </Section>
      {data.appointments.length || data.refillRequests.length || data.recordsRequests.length ? (
        <Section title="What the call did">
          {data.appointments.map(a => <Row key={a.id}><span>Booked {a.ref}</span><Meta>{a.appointmentType?.name} · {when(a.startsAt, tz)}</Meta><Status value={a.status} /></Row>)}
          {data.refillRequests.map(r => <Row key={r.ref}><span>Refill request {r.ref}</span><Meta>{r.productText}</Meta><Status value={r.status} /></Row>)}
          {data.recordsRequests.map(r => <Row key={r.ref}><span>Records request {r.ref}</span><Meta>{label(r.scope)}</Meta><Status value={r.status} /></Row>)}
        </Section>
      ) : null}
      {c.summary ? <Section title="Summary"><p className="text-sm">{c.summary}</p></Section> : null}
      <Section title="Transcript">
        {turns.length ? (
          <ol className="space-y-2 text-sm">
            {turns.map((t, i) => (
              <li key={i} className="flex gap-3"><span className="w-20 shrink-0 font-mono text-xs uppercase text-muted-foreground">{t.role ?? t.speaker}</span><span className="min-w-0 break-words">{t.text}</span></li>
            ))}
          </ol>
        ) : <Empty>No transcript stored.</Empty>}
      </Section>
    </Page>
  );
}
