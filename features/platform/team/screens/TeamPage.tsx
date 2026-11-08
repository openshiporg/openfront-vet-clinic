import { q, practiceTimeZone } from '../../lib/server';
import { label, calendarDay } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section, Stat } from '../../components/ui';

type Licence = { id: string; kind: string; stateCode: string; licenseNumber: string; status: string; expiresOn: string; verificationSource: string | null };
type Staff = { id: string; displayName: string; kind: string; credentials: string; employment: string; active: boolean; homeLocation: { code: string } | null; locations: { code: string }[]; licenses: Licence[]; user: { accessExpiresAt: string | null; role: { name: string } | null } | null };
type Dea = { id: string; registrationNumber: string; registrantName: string; registrantKind: string; schedules: string[]; expiresOn: string; status: string; location: { code: string; name: string } | null; staffMember: { displayName: string } | null };

/** Today's date in the practice zone (YYYY-MM-DD). */
const todayIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function expiry(today: string, expiresOn: string) {
  const d = daysBetween(today, expiresOn);
  if (d < 0) return <span className="text-red-600">expired {calendarDay(expiresOn)}</span>;
  if (d <= 60) return <span className="text-amber-600">expires {calendarDay(expiresOn)} · {d} days</span>;
  return <span>expires {calendarDay(expiresOn)}</span>;
}

/** Team, licences and DEA registrations (I-P1, I-P2). A lapsed licence or registration blocks the licensed act it covers. */
export default async function TeamPage() {
  const [data, tz] = await Promise.all([
    q<{ staffMembers: Staff[]; deaRegistrations: Dea[] | null }>(`{
      staffMembers(orderBy: { displayName: asc }, take: 200) { id displayName kind credentials employment active homeLocation { code } locations { code }
        licenses { id kind stateCode licenseNumber status expiresOn verificationSource } user { accessExpiresAt role { name } } }
      deaRegistrations(orderBy: { expiresOn: asc }) { id registrationNumber registrantName registrantKind schedules expiresOn status location { code name } staffMember { displayName } }
    }`),
    practiceTimeZone(),
  ]);
  const today = todayIn(tz);
  const lic = data.staffMembers.flatMap(s => s.licenses);
  const lapsed = lic.filter(l => l.status !== 'active' || l.expiresOn < today).length;
  const soon = lic.filter(l => l.expiresOn >= today && daysBetween(today, l.expiresOn) <= 60).length;
  const dea = data.deaRegistrations ?? [];
  return (
    <Page title="Team & licences">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat name="Staff" value={data.staffMembers.length} />
        <Stat name="Licences" value={lic.length} />
        <Stat name="Lapsed" value={lapsed ? <span className="text-red-600">{lapsed}</span> : 0} />
        <Stat name="Expiring ≤ 60 days" value={soon ? <span className="text-amber-600">{soon}</span> : 0} />
      </div>
      <Section title="Staff">
        {data.staffMembers.length ? data.staffMembers.map(s => (
          <Row key={s.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{s.displayName}</span>{s.credentials ? <span className="text-xs text-muted-foreground">{s.credentials}</span> : null}</div>
              <Meta>{s.user?.role?.name ?? label(s.kind)} · {label(s.employment)} · {s.locations.map(l => l.code).join(', ') || s.homeLocation?.code}{s.user?.accessExpiresAt ? ` · access until ${calendarDay(s.user.accessExpiresAt)}` : ''}</Meta>
              {s.licenses.map(l => (
                <p key={l.id} className="text-xs"><span className="font-mono">{l.licenseNumber}</span> · {label(l.kind)} · {l.stateCode} · {expiry(today, l.expiresOn)}</p>
              ))}
            </div>
            <Status value={s.licenses.some(l => l.expiresOn < today) ? 'expired' : s.active ? 'active' : 'retired'} />
          </Row>
        )) : <Empty>No staff yet. Load the practice from the onboarding card.</Empty>}
      </Section>
      <Section title="DEA registrations (one per location and registrant)">
        {data.deaRegistrations === null ? <Empty>You need controlled-substance access to see DEA registrations.</Empty> : dea.length ? dea.map(r => (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono font-medium">{r.registrationNumber}</span><span>{r.registrantName}</span></div>
              <Meta>{r.location?.name} · schedules {(r.schedules ?? []).join(', ')} · {label(r.registrantKind)} · {expiry(today, r.expiresOn)}</Meta>
            </div>
            <Status value={r.expiresOn < today ? 'expired' : r.status} />
          </Row>
        )) : <Empty>No DEA registrations recorded.</Empty>}
      </Section>
    </Page>
  );
}
