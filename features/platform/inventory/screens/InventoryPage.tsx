import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay } from '../../lib/format';
import { todayIn, addDaysTo } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Lot = { id: string; lotNumber: string; expiresOn: string; status: string; version: number; quarantineReason: string; drug: { displayName: string } | null; vaccine: { name: string } | null; location: { name: string } | null };

/** Stock lots at each location (BUILD-PLAN P3): receive, see what expires soon, quarantine and release. */
export default async function InventoryPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const view = sp.view === 'expiring' ? 'expiring' : sp.view === 'quarantine' ? 'quarantine' : 'all';
  const tz = await practiceTimeZone();
  const today = todayIn(tz);
  const soon = addDaysTo(today, 60);
  const where = view === 'expiring' ? { status: { equals: 'available' }, expiresOn: { lte: soon } } : view === 'quarantine' ? { status: { equals: 'quarantined' } } : {};
  const d = await q<{ inventoryLots: Lot[]; quarantined: number; drugProducts: { id: string; displayName: string }[]; vaccineProducts: { id: string; name: string }[]; locations: { id: string; name: string }[] }>(`query I($where: InventoryLotWhereInput!) {
    inventoryLots(where: $where, orderBy: { expiresOn: asc }, take: 200) { id lotNumber expiresOn status version quarantineReason drug { displayName } vaccine { name } location { name } }
    quarantined: inventoryLotsCount(where: { status: { equals: "quarantined" } })
    drugProducts(where: { active: { equals: true }, csSchedule: { equals: "none" } }, orderBy: { displayName: asc }, take: 200) { id displayName }
    vaccineProducts(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name }
    locations(orderBy: { name: asc }, take: 10) { id name }
  }`, { where });
  const path = '/dashboard/platform/inventory';
  return (
    <Page title="Inventory">
      <Tabs items={[{ key: 'all', label: 'All lots', href: path }, { key: 'expiring', label: 'Expiring in 60 days', href: `${path}?view=expiring` }, { key: 'quarantine', label: 'Quarantined', href: `${path}?view=quarantine`, count: d.quarantined }]} active={view} />
      <Section title="Lots">
        {d.inventoryLots.length ? d.inventoryLots.map(l => (
          <Row key={l.id}>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{l.drug?.displayName ?? l.vaccine?.name}</span> · lot {l.lotNumber}
              <Meta>{l.location?.name} · expires {calendarDay(l.expiresOn)}{l.expiresOn.slice(0, 10) < today ? ' (expired)' : ''}{l.quarantineReason ? ` · ${l.quarantineReason}` : ''}</Meta>
            </div>
            <Status value={l.status} />
            {l.status === 'available' ? <CommandForm op="setLotQuarantine" build="quarantine" submit="Quarantine" fixed={{ lotId: l.id, quarantine: 'yes', expectedVersion: String(l.version) }} paths={[path]} fields={[{ name: 'reason', label: 'Why', width: 'lg' }]} /> : null}
            {l.status === 'quarantined' ? <CommandForm op="setLotQuarantine" build="quarantine" submit="Release" fixed={{ lotId: l.id, quarantine: 'no', expectedVersion: String(l.version) }} paths={[path]} fields={[{ name: 'reason', label: 'Why it is safe to use', width: 'lg' }]} /> : null}
          </Row>
        )) : <Empty>No lots here.</Empty>}
      </Section>
      <Section title="Receive a lot">
        <p className="text-xs text-muted-foreground">Controlled drugs are received on the controlled-substances page.</p>
        <CommandForm op="receiveStockLot" build="receiveStockLot" submit="Receive" paths={[path]}
          fields={[
            { name: 'locationId', label: 'Location', width: 'lg', options: d.locations.map(l => ({ value: l.id, label: l.name })) },
            { name: 'drugId', label: 'Drug', width: 'lg', options: [{ value: '', label: 'None (vaccine)' }, ...d.drugProducts.map(p => ({ value: p.id, label: p.displayName }))] },
            { name: 'vaccineId', label: 'Vaccine', width: 'lg', options: [{ value: '', label: 'None (drug)' }, ...d.vaccineProducts.map(p => ({ value: p.id, label: p.name }))] },
            { name: 'lotNumber', label: 'Lot number', width: 'md' },
            { name: 'expiresOn', label: 'Expires (YYYY-MM-DD)', width: 'md' },
          ]} />
      </Section>
    </Page>
  );
}
