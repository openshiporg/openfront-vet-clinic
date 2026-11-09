import Link from 'next/link';
import { notFound } from 'next/navigation';
import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay, when } from '../../lib/format';
import { ALERT_TONE } from '../../lib/clinic';
import { Page, Meta, Section } from '../../components/ui';

const FIELD_LABEL: Record<string, string> = {
  owner_name_address: 'Owner name and address',
  animal_name_species_breed_sex_age_colour: 'Animal',
  microchip: 'Microchip',
  vaccine_manufacturer_product_lot: 'Vaccine (manufacturer, product, lot)',
  date_given: 'Date given',
  duration: 'Duration of immunity',
  next_due: 'Next due',
  tag_number: 'Rabies tag',
  veterinarian_name_licence_signature: 'Veterinarian',
};
const DATE_FIELDS = new Set(['date_given', 'next_due']);

/**
 * A rabies vaccination certificate (NASPHV Form 51 equivalent), built from the vaccine entry
 * itself so the certificate and the record cannot disagree. Missing fields are listed, not invented.
 */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tz] = await Promise.all([
    q<{ rabiesCertificate: { id: string; ref: string; vaccinatedOn: string; nextDueOn: string; durationMonths: number; tagNumber: string; tagJurisdiction: string; fields: Record<string, string> | null; missingFields: string[] | null; createdAt: string; voidedAt: string | null; voidReason: string; patient: { id: string; name: string } | null; document: { id: string; status: string; sha256: string | null; renderedAt: string | null } | null } | null }>(`
      query C($id: ID!) { rabiesCertificate(where: { id: $id }) { id ref vaccinatedOn nextDueOn durationMonths tagNumber tagJurisdiction fields missingFields createdAt voidedAt voidReason patient { id name } document { id status sha256 renderedAt } } }`, { id }).catch(() => null),
    practiceTimeZone(),
  ]);
  const c = data?.rabiesCertificate;
  if (!c) notFound();
  const fields = c.fields ?? {};
  const missing = c.missingFields ?? [];
  return (
    <Page title={`Rabies certificate ${c.ref}`} crumbs={[{ label: 'Vaccines', href: '/dashboard/platform/vaccines' }, { label: c.patient?.name ?? 'Patient', href: `/dashboard/platform/vaccines?patient=${c.patient?.id}` }]}>
      {c.voidedAt ? (
        <div className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.critical}`}>
          Void since {when(c.voidedAt, tz)}: {c.voidReason}. This certificate is not valid proof of vaccination.
        </div>
      ) : null}
      {missing.length ? (
        <div className={`rounded-md border px-3 py-2 text-sm ${ALERT_TONE.warning}`}>
          The certificate is missing: {missing.map(m => FIELD_LABEL[m] ?? m).join(', ')}. Complete the patient or licence record, then re-issue from the vaccine entry.
        </div>
      ) : null}
      <Section title="Certificate">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[16rem_1fr]">
          {Object.keys(FIELD_LABEL).filter(k => fields[k]).map(k => (
            <div key={k} className="contents"><dt className="text-muted-foreground">{FIELD_LABEL[k]}</dt><dd className="break-words">{DATE_FIELDS.has(k) ? calendarDay(fields[k]) : fields[k]}</dd></div>
          ))}
          {c.tagNumber ? <div className="contents"><dt className="text-muted-foreground">Tag jurisdiction</dt><dd>{c.tagJurisdiction}</dd></div> : null}
        </dl>
      </Section>
      <Section title="Document">
        {c.document ? <Meta>{c.document.status === 'rendered' ? `Rendered ${when(c.document.renderedAt, tz)}; the document is fingerprinted so any later change shows.` : 'Being prepared by the document worker.'}</Meta> : <Meta>Not rendered yet.</Meta>}
        <Meta>Issued {when(c.createdAt, tz)} · vaccinated {calendarDay(c.vaccinatedOn)} (clinic date) · valid {c.durationMonths} months, to {calendarDay(c.nextDueOn)}.</Meta>
        <Meta>Times are clinic time ({tz}).</Meta>
      </Section>
      <p className="text-xs text-muted-foreground"><Link className="underline" href={`/dashboard/platform/vaccines?patient=${c.patient?.id}`}>All vaccines for {c.patient?.name}</Link></p>
    </Page>
  );
}
