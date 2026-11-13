import { q, myPermissions } from '../../lib/server';
import { label, money } from '../../lib/format';
import { Page, Row, Empty, Status, Meta, Section } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';
import { ActionButton } from '../../components/ActionButton';

type Test = { id: string; code: string; name: string; status: string; turnaroundHours: number; feeItem: { id: string; code: string; name: string; priceMinor: string } | null; species: { code: string; name: string }[] };
type Map = { id: string; externalCode: string; unitConversion: { factor?: string } | null; analyte: { code: string; name: string; canonicalUnit: string } | null };
type Lab = { id: string; code: string; name: string; kind: string; intake: string; accountNumber: string; status: string; version: number; tests: Test[] };
type Fee = { id: string; code: string; name: string; priceMinor: string };
type Species = { code: string; name: string };

const PATH = '/dashboard/platform/laboratories';
const KINDS = [{ value: 'reference', label: 'Reference lab (sent out)' }, { value: 'in_house', label: 'In-house analyser' }];
const INTAKES = [{ value: 'manual', label: 'Keyed in by staff' }, { value: 'file_drop', label: 'Result file (CSV or HL7)' }, { value: 'adapter', label: "The lab's own connection" }];
const STATES = [{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }];

/**
 * Lab set-up: the practice's own laboratories, the tests each one runs and what each test is charged, and the codes its results
 * arrive under (with the unit conversion). Nothing here is deleted: a lab or test is retired, so past orders and results keep pointing
 * at it. The in-house analyser catalog can be added in one step; it only adds what is missing.
 */
export default async function LabSetupPage() {
  const [data, can] = await Promise.all([
    q<{ laboratories: Omit<Lab, 'tests'>[]; labTests: (Test & { lab: { id: string } | null })[]; labAnalyteMaps: Map[]; feeItems: Fee[]; speciesList: Species[] }>(`{
      laboratories(orderBy: { name: asc }, take: 50) { id code name kind intake accountNumber status version }
      labTests(orderBy: { name: asc }, take: 500) { id code name status turnaroundHours lab { id } feeItem { id code name priceMinor } species(take: 5) { code name } }
      labAnalyteMaps(orderBy: { externalCode: asc }, take: 500) { id externalCode unitConversion lab { id } analyte { code name canonicalUnit } }
      feeItems(where: { version: { status: { equals: "published" } }, category: { equals: "laboratory" } }, orderBy: { name: asc }, take: 300) { id code name priceMinor }
      speciesList(orderBy: { name: asc }, take: 50) { code name }
    }`),
    myPermissions(['canManagePractice', 'canManageIntegrations'] as const),
  ]);
  const canSetUp = can.canManagePractice || can.canManageIntegrations;
  const labs: Lab[] = data.laboratories.map(l => ({ ...l, tests: data.labTests.filter(t => t.lab?.id === l.id) }));
  const mapsOf = (labId: string) => (data.labAnalyteMaps as (Map & { lab: { id: string } | null })[]).filter(m => m.lab?.id === labId);
  const fees = [{ value: '', label: 'Not charged' }, ...data.feeItems.map(f => ({ value: f.id, label: `${f.name} · ${money(f.priceMinor)}` }))];
  const speciesHint = `Species codes, comma separated: ${data.speciesList.map(s => s.code).join(', ')}. Blank = every species.`;
  const hasInHouse = labs.some(l => l.code === 'INHOUSE');
  return (
    <Page title="Lab set-up">
      {canSetUp && !hasInHouse ? (
        <Section title="In-house analysers">
          <p className="text-sm text-muted-foreground">Add the in-house catalog: blood glucose and PCV/total protein priced from your fee list, ten analytes with their codes, and typical dog and cat reference ranges you can change. Only missing records are added.</p>
          <ActionButton op="loadInHouseLabCatalog" vars={{}} paths={[PATH, '/dashboard/platform/results']}>Add the in-house catalog</ActionButton>
        </Section>
      ) : null}

      {labs.length ? labs.map(l => (
        <Section key={l.id} title={`${l.name} · ${l.code}`} aside={<Status value={l.status} />}>
          <Meta>{label(l.kind)} · results {INTAKES.find(i => i.value === l.intake)?.label.toLowerCase() ?? l.intake}{l.accountNumber ? ` · account ${l.accountNumber}` : ''}</Meta>
          {l.tests.length ? l.tests.map(t => (
            <Row key={t.id}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs">{t.code}</span><span className="font-medium">{t.name}</span></div>
                <Meta>{t.feeItem ? `${t.feeItem.name} · ${money(t.feeItem.priceMinor)}` : 'not charged'} · back in {t.turnaroundHours} h · {t.species.length ? t.species.map(s => s.name).join(', ') : 'every species'}</Meta>
                {canSetUp ? (
                  <CommandForm op="saveLabTest" build="labSetup" submit="Save test" fixed={{ testId: t.id, labId: l.id }} paths={[PATH, '/dashboard/platform/results']} fields={[
                    { name: 'name', label: 'Name', defaultValue: t.name, width: 'md' },
                    { name: 'feeItemId', label: 'Charge', options: fees, defaultValue: t.feeItem?.id ?? '' },
                    { name: 'turnaroundHours', label: 'Hours', defaultValue: String(t.turnaroundHours), width: 'sm' },
                    { name: 'status', label: 'Status', options: STATES, defaultValue: t.status },
                  ]} />
                ) : null}
              </div>
              <Status value={t.status} />
            </Row>
          )) : <Empty>No tests yet.</Empty>}
          {canSetUp ? (
            <>
              <CommandForm op="saveLabTest" build="labSetup" submit="Add test" fixed={{ labId: l.id }} paths={[PATH, '/dashboard/platform/results']} fields={[
                { name: 'code', label: 'Code', placeholder: 'CBC', width: 'sm' },
                { name: 'name', label: 'Name', placeholder: 'Complete blood count', width: 'md' },
                { name: 'feeItemId', label: 'Charge', options: fees, defaultValue: '' },
                { name: 'turnaroundHours', label: 'Hours', defaultValue: '24', width: 'sm' },
                { name: 'speciesCodes', label: 'Species', placeholder: 'canine, feline', hint: speciesHint, width: 'md' },
              ]} />
              <div className="space-y-1 pt-2">
                <p className="text-xs font-medium text-muted-foreground">Result codes</p>
                {mapsOf(l.id).length ? (
                  <p className="break-words font-mono text-xs text-muted-foreground">{mapsOf(l.id).map(m => `${m.externalCode} → ${m.analyte?.code ?? '?'}${m.unitConversion?.factor ? ` ×${m.unitConversion.factor}` : ''}`).join(' · ')}</p>
                ) : <Meta>No codes yet: results with unknown codes are kept but not flagged against a range.</Meta>}
                <CommandForm op="mapLabCode" build="labSetup" submit="Save code" fixed={{ labId: l.id }} paths={[PATH]} fields={[
                  { name: 'externalCode', label: "Lab's code", placeholder: 'GLUC', width: 'sm' },
                  { name: 'analyteCode', label: 'Our analyte', placeholder: 'GLU', width: 'sm' },
                  { name: 'factor', label: 'Times', placeholder: '1', hint: 'Their unit × this = ours', width: 'sm' },
                  { name: 'analyteName', label: 'New analyte name', placeholder: 'only for a new one', width: 'md' },
                  { name: 'unit', label: 'Unit', placeholder: 'mmol/L', width: 'sm' },
                ]} />
              </div>
              <details className="pt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Change this laboratory</summary>
                <CommandForm className="pt-2" op="saveLaboratory" build="labSetup" submit="Save laboratory" fixed={{ labId: l.id, expectedVersion: String(l.version) }} paths={[PATH, '/dashboard/platform/results']} fields={[
                  { name: 'name', label: 'Name', defaultValue: l.name, width: 'md' },
                  { name: 'kind', label: 'Kind', options: KINDS, defaultValue: l.kind },
                  { name: 'intake', label: 'Results arrive', options: INTAKES, defaultValue: l.intake },
                  { name: 'accountNumber', label: 'Account number', defaultValue: l.accountNumber, width: 'sm' },
                  { name: 'status', label: 'Status', options: STATES, defaultValue: l.status },
                ]} />
              </details>
            </>
          ) : null}
        </Section>
      )) : <Empty>No laboratories yet.</Empty>}

      {canSetUp ? (
        <Section title="Add a laboratory">
          <CommandForm op="saveLaboratory" build="labSetup" submit="Add laboratory" paths={[PATH, '/dashboard/platform/results']} fields={[
            { name: 'code', label: 'Code', placeholder: 'IDEXX', width: 'sm' },
            { name: 'name', label: 'Name', placeholder: 'IDEXX Reference Laboratories', width: 'md' },
            { name: 'kind', label: 'Kind', options: KINDS, defaultValue: 'reference' },
            { name: 'intake', label: 'Results arrive', options: INTAKES, defaultValue: 'file_drop' },
            { name: 'accountNumber', label: 'Account number', width: 'sm' },
          ]} />
        </Section>
      ) : null}
    </Page>
  );
}
