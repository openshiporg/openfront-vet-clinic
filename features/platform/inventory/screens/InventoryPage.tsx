import { q, practiceTimeZone } from '../../lib/server';
import { calendarDay, money } from '../../lib/format';
import { todayIn, addDaysTo } from '../../lib/clinic';
import { Page, Row, Empty, Status, Meta, Section, Tabs } from '../../components/ui';
import { CommandForm } from '../../components/CommandForm';

type Lot = { id: string; lotNumber: string; expiresOn: string; status: string; version: number; quarantineReason: string; drug: { displayName: string } | null; vaccine: { name: string } | null; location: { name: string } | null };
type Place = { id: string; name: string; kind: string; minTempC: string | null; maxTempC: string | null; location: { name: string } | null };
type Item = { id: string; name: string };

const PLACE_KINDS = [
  { value: 'shelf', label: 'Shelf' }, { value: 'fridge', label: 'Fridge' }, { value: 'freezer', label: 'Freezer' },
  { value: 'cabinet', label: 'Cabinet' }, { value: 'vehicle', label: 'Vehicle' },
];

/** Stock, lots, orders, recalls and fridge temperatures (BUILD-PLAN P3). Stock changes only by movement. */
export default async function InventoryPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const sp = (await searchParams) ?? {};
  const views = ['stock', 'all', 'expiring', 'quarantine', 'orders', 'recalls', 'fridges'] as const;
  const view = (views as readonly string[]).includes(sp.view ?? '') ? (sp.view as (typeof views)[number]) : 'stock';
  const tz = await practiceTimeZone();
  const today = todayIn(tz);
  const soon = addDaysTo(today, 60);
  const path = '/dashboard/platform/inventory';
  const lotWhere = view === 'expiring' ? { status: { equals: 'available' }, expiresOn: { lte: soon } } : view === 'quarantine' ? { status: { equals: 'quarantined' } } : {};
  const base = await q<{ quarantined: number; openRecalls: number; openExcursions: number; stockLocations: Place[]; items: Item[]; locations: { id: string; name: string }[] }>(`{
    quarantined: inventoryLotsCount(where: { status: { equals: "quarantined" } })
    openRecalls: recallCasesCount(where: { status: { equals: "open" } })
    openExcursions: temperatureExcursionsCount(where: { status: { equals: "open" } })
    stockLocations(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name kind minTempC maxTempC location { name } }
    items(where: { active: { equals: true } }, orderBy: { name: asc }, take: 500) { id name }
    locations(orderBy: { name: asc }, take: 10) { id name }
  }`);
  const placeOptions = base.stockLocations.map(p => ({ value: p.id, label: `${p.location?.name ?? ''} · ${p.name}` }));
  const itemOptions = base.items.map(i => ({ value: i.id, label: i.name }));
  return (
    <Page title="Inventory">
      <Tabs
        items={[
          { key: 'stock', label: 'On hand', href: path },
          { key: 'all', label: 'All lots', href: `${path}?view=all` },
          { key: 'expiring', label: 'Expiring in 60 days', href: `${path}?view=expiring` },
          { key: 'quarantine', label: 'Quarantined', href: `${path}?view=quarantine`, count: base.quarantined },
          { key: 'orders', label: 'Orders', href: `${path}?view=orders` },
          { key: 'recalls', label: 'Recalls', href: `${path}?view=recalls`, count: base.openRecalls },
          { key: 'fridges', label: 'Fridges', href: `${path}?view=fridges`, count: base.openExcursions },
        ]}
        active={view}
      />
      {view === 'stock' ? await Stock({ path, placeOptions, itemOptions, locations: base.locations, today }) : null}
      {view === 'all' || view === 'expiring' || view === 'quarantine' ? await Lots({ path, where: lotWhere, today, placeOptions }) : null}
      {view === 'orders' ? await Orders({ path, placeOptions, itemOptions, locations: base.locations }) : null}
      {view === 'recalls' ? await Recalls({ path, itemOptions }) : null}
      {view === 'fridges' ? await Fridges({ path, places: base.stockLocations, locations: base.locations }) : null}
    </Page>
  );
}

async function Stock({ path, placeOptions, itemOptions, locations, today }: { path: string; placeOptions: { value: string; label: string }[]; itemOptions: { value: string; label: string }[]; locations: { id: string; name: string }[]; today: string }) {
  const d = await q<{ stockLevels: { id: string; onHand: string; item: { id: string; name: string } | null; lot: { id: string; lotNumber: string; expiresOn: string; status: string } | null; stockLocation: { name: string; location: { name: string } | null } | null }[]; reorderRules: { id: string; minQty: string; targetQty: string; item: { id: string; name: string } | null; location: { id: string; name: string } | null }[]; drugProducts: { id: string; displayName: string }[]; vaccineProducts: { id: string; name: string }[] }>(`{
    stockLevels(where: { onHand: { gt: "0" } }, orderBy: { updatedAt: desc }, take: 200) { id onHand item { id name } lot { id lotNumber expiresOn status } stockLocation { name location { name } } }
    reorderRules(orderBy: { createdAt: asc }, take: 200) { id minQty targetQty item { id name } location { id name } }
    drugProducts(where: { active: { equals: true }, csSchedule: { equals: "none" } }, orderBy: { displayName: asc }, take: 200) { id displayName }
    vaccineProducts(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name }
  }`);
  const totals = new Map<string, { name: string; total: number }>();
  for (const l of d.stockLevels) if (l.item && l.lot?.status !== 'quarantined') { const t = totals.get(l.item.id) ?? { name: l.item.name, total: 0 }; t.total += Number(l.onHand); totals.set(l.item.id, t); }
  const low = d.reorderRules.filter(r => r.item && (totals.get(r.item.id)?.total ?? 0) <= Number(r.minQty));
  return (
    <>
      {low.length ? (
        <Section title="Running low">
          {low.map(r => (
            <Row key={r.id}><div className="min-w-0 flex-1"><span className="font-medium">{r.item?.name}</span><Meta>{totals.get(r.item!.id)?.total ?? 0} on hand · re-order at {Number(r.minQty)} · aim for {Number(r.targetQty)} · {r.location?.name}</Meta></div></Row>
          ))}
        </Section>
      ) : null}
      <Section title="On hand, soonest expiry first">
        {d.stockLevels.length ? [...d.stockLevels].sort((a, b) => (a.lot?.expiresOn ?? '9').localeCompare(b.lot?.expiresOn ?? '9')).map(l => (
          <Row key={l.id}>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{l.item?.name}</span>{l.lot ? ` · lot ${l.lot.lotNumber}` : ''}
              <Meta>{l.stockLocation?.location?.name} · {l.stockLocation?.name}{l.lot ? ` · expires ${calendarDay(l.lot.expiresOn)}${l.lot.expiresOn.slice(0, 10) < today ? ' (expired)' : ''}` : ''}</Meta>
            </div>
            <span className="tabular-nums text-sm">{Number(l.onHand)}</span>
            {l.lot && l.item ? <CommandForm op="adjustStock" build="adjustStock" submit="Write off" fixed={{ itemId: l.item.id, lotId: l.lot.id, stockLocationId: placeOptions[0]?.value ?? '', kind: 'dispose' }} paths={[path]} fields={[{ name: 'quantity', label: 'How many', width: 'sm' }, { name: 'reason', label: 'Why', width: 'lg' }]} /> : null}
          </Row>
        )) : <Empty>Nothing is in stock yet. Receive a lot below.</Empty>}
      </Section>
      <Section title="Receive stock">
        <p className="text-xs text-muted-foreground">Controlled drugs are received on the controlled-substances page.</p>
        <CommandForm op="receiveStock" build="receiveStock" submit="Receive" paths={[path]}
          fields={[
            { name: 'stockLocationId', label: 'Store in', width: 'lg', options: placeOptions },
            { name: 'drugId', label: 'Drug', width: 'lg', options: [{ value: '', label: 'None (vaccine)' }, ...d.drugProducts.map(p => ({ value: p.id, label: p.displayName }))] },
            { name: 'vaccineId', label: 'Vaccine', width: 'lg', options: [{ value: '', label: 'None (drug)' }, ...d.vaccineProducts.map(p => ({ value: p.id, label: p.name }))] },
            { name: 'lotNumber', label: 'Lot number', width: 'md' },
            { name: 'expiresOn', label: 'Expires (YYYY-MM-DD)', width: 'md' },
            { name: 'quantity', label: 'Quantity', width: 'sm' },
          ]} />
      </Section>
      <Section title="Count a shelf">
        <p className="text-xs text-muted-foreground">Enter what is really there. The difference is written as a count movement.</p>
        <CommandForm op="countStock" build="countStock" submit="Record count" paths={[path]}
          fields={[
            { name: 'stockLocationId', label: 'Place', width: 'lg', options: placeOptions },
            { name: 'itemId', label: 'Item', width: 'lg', options: itemOptions },
            { name: 'lotId', label: 'Lot', width: 'lg', options: [{ value: '', label: 'No lot' }, ...d.stockLevels.filter(l => l.lot).map(l => ({ value: l.lot!.id, label: `${l.item?.name} · ${l.lot!.lotNumber}` }))] },
            { name: 'countedQty', label: 'Counted', width: 'sm' },
          ]} />
      </Section>
      <Section title="Re-order point">
        <CommandForm op="setReorderRule" build="setReorderRule" submit="Save" paths={[path]}
          fields={[
            { name: 'itemId', label: 'Item', width: 'lg', options: itemOptions },
            { name: 'locationId', label: 'Location', width: 'md', options: locations.map(l => ({ value: l.id, label: l.name })) },
            { name: 'minQty', label: 'Re-order at', width: 'sm' },
            { name: 'targetQty', label: 'Aim for', width: 'sm' },
          ]} />
      </Section>
    </>
  );
}

async function Lots({ path, where, today, placeOptions }: { path: string; where: Record<string, unknown>; today: string; placeOptions: { value: string; label: string }[] }) {
  void placeOptions;
  const d = await q<{ inventoryLots: Lot[] }>(`query I($where: InventoryLotWhereInput!) {
    inventoryLots(where: $where, orderBy: { expiresOn: asc }, take: 200) { id lotNumber expiresOn status version quarantineReason drug { displayName } vaccine { name } location { name } }
  }`, { where });
  return (
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
  );
}

async function Orders({ path, placeOptions, itemOptions, locations }: { path: string; placeOptions: { value: string; label: string }[]; itemOptions: { value: string; label: string }[]; locations: { id: string; name: string }[] }) {
  const d = await q<{ suppliers: { id: string; name: string }[]; purchaseOrders: { id: string; ref: string; status: string; version: number; supplier: { name: string } | null; location: { name: string } | null; lines: { id: string; qtyOrdered: string; qtyReceived: string; unitCostMinor: string; item: { name: string } | null }[] }[] }>(`{
    suppliers(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name }
    purchaseOrders(orderBy: { createdAt: desc }, take: 50) { id ref status version supplier { name } location { name } lines { id qtyOrdered qtyReceived unitCostMinor item { name } } }
  }`);
  return (
    <>
      <Section title="Purchase orders">
        {d.purchaseOrders.length ? d.purchaseOrders.map(o => (
          <div key={o.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{o.ref}</span> · {o.supplier?.name}<Meta>{o.location?.name}</Meta></div>
              <Status value={o.status} />
              {o.status === 'draft' ? <CommandForm op="submitPurchaseOrder" build="orderStep" submit="Send order" fixed={{ orderId: o.id, expectedVersion: String(o.version) }} paths={[path]} fields={[]} /> : null}
              {o.status === 'draft' || o.status === 'submitted' ? <CommandForm op="cancelPurchaseOrder" build="orderStep" submit="Cancel order" fixed={{ orderId: o.id, expectedVersion: String(o.version) }} paths={[path]} fields={[{ name: 'reason', label: 'Why', width: 'lg' }]} /> : null}
            </Row>
            {o.lines.map(l => (
              <Row key={l.id}>
                <div className="min-w-0 flex-1 pl-3 text-sm">{l.item?.name}<Meta>{Number(l.qtyReceived)} of {Number(l.qtyOrdered)} received · {money(l.unitCostMinor)} each</Meta></div>
                {o.status === 'submitted' || o.status === 'partially_received' ? (
                  <CommandForm op="receivePurchaseOrder" build="receivePurchaseOrder" submit="Receive" fixed={{ orderId: o.id, lineId: l.id }} paths={[path]}
                    fields={[{ name: 'stockLocationId', label: 'Store in', width: 'lg', options: placeOptions }, { name: 'lotNumber', label: 'Lot number', width: 'md' }, { name: 'expiresOn', label: 'Expires (YYYY-MM-DD)', width: 'md' }, { name: 'quantity', label: 'Arrived', width: 'sm' }, { name: 'packingSlip', label: 'Packing slip', width: 'md' }]} />
                ) : null}
              </Row>
            ))}
          </div>
        )) : <Empty>No orders yet.</Empty>}
      </Section>
      <Section title="New order">
        <CommandForm op="draftPurchaseOrder" build="draftPurchaseOrder" submit="Save draft" paths={[path]}
          fields={[
            { name: 'supplierId', label: 'Supplier', width: 'lg', options: d.suppliers.map(s => ({ value: s.id, label: s.name })) },
            { name: 'locationId', label: 'Deliver to', width: 'md', options: locations.map(l => ({ value: l.id, label: l.name })) },
            { name: 'itemId', label: 'Item', width: 'lg', options: itemOptions },
            { name: 'quantity', label: 'Quantity', width: 'sm' },
            { name: 'cost', label: 'Cost each ($)', width: 'sm' },
          ]} />
      </Section>
      <Section title="New supplier">
        <CommandForm op="addSupplier" build="addSupplier" submit="Add supplier" paths={[path]}
          fields={[{ name: 'name', label: 'Name', width: 'lg' }, { name: 'accountNumber', label: 'Account number', width: 'md' }, { name: 'phone', label: 'Phone', width: 'md' }, { name: 'email', label: 'Email', width: 'lg' }]} />
      </Section>
    </>
  );
}

async function Recalls({ path, itemOptions }: { path: string; itemOptions: { value: string; label: string }[] }) {
  const d = await q<{ recallCases: { id: string; ref: string; title: string; lotNumber: string; status: string; version: number; resolution: string; item: { name: string } | null; exposures: { id: string; status: string; version: number; givenOn: string; note: string; patient: { name: string } | null; client: { displayName: string } | null }[] }[] }>(`{
    recallCases(orderBy: { openedAt: desc }, take: 8) { id ref title lotNumber status version resolution item { name } exposures(orderBy: { givenOn: asc }, take: 60) { id status version givenOn note patient { name } client { displayName } } }
  }`);
  return (
    <>
      <Section title="Recalls">
        {d.recallCases.length ? d.recallCases.map(r => (
          <div key={r.id} className="border-b py-2 last:border-0">
            <Row>
              <div className="min-w-0 flex-1"><span className="font-medium">{r.title}</span><Meta>{r.ref} · {r.item?.name} · lot {r.lotNumber}{r.resolution ? ` · ${r.resolution}` : ''}</Meta></div>
              <Status value={r.status} />
              {r.status === 'open' ? <CommandForm op="closeRecall" build="closeRecall" submit="Close recall" fixed={{ recallId: r.id, expectedVersion: String(r.version) }} paths={[path]} fields={[{ name: 'resolution', label: 'What was done', width: 'lg' }]} /> : null}
            </Row>
            {r.exposures.length ? r.exposures.map(e => (
              <Row key={e.id}>
                <div className="min-w-0 flex-1 pl-3 text-sm">{e.patient?.name ?? 'Unknown patient'}{e.client ? ` · ${e.client.displayName}` : ''}<Meta>Received {calendarDay(e.givenOn)}{e.note ? ` · ${e.note}` : ''}</Meta></div>
                <Status value={e.status} />
                {e.status === 'to_contact' ? <CommandForm op="markRecallExposure" build="recallExposure" submit="Mark contacted" fixed={{ exposureId: e.id, status: 'contacted', expectedVersion: String(e.version) }} paths={[path]} fields={[{ name: 'note', label: 'Note', width: 'lg' }]} /> : null}
                {e.status !== 'resolved' && r.status === 'open' ? <CommandForm op="markRecallExposure" build="recallExposure" submit="Resolved" fixed={{ exposureId: e.id, status: 'resolved', expectedVersion: String(e.version) }} paths={[path]} fields={[{ name: 'note', label: 'Outcome', width: 'lg' }]} /> : null}
              </Row>
            )) : <div className="pl-3 text-xs text-muted-foreground">No patient received this lot.</div>}
          </div>
        )) : <Empty>No recalls.</Empty>}
      </Section>
      <Section title="Open a recall">
        <p className="text-xs text-muted-foreground">Quarantines every matching lot and lists the patients who received it.</p>
        <CommandForm op="openRecall" build="openRecall" submit="Open recall" paths={[path]}
          fields={[{ name: 'itemId', label: 'Item', width: 'lg', options: itemOptions }, { name: 'lotNumber', label: 'Lot number', width: 'md' }, { name: 'title', label: 'Notice', width: 'lg' }, { name: 'source', label: 'Issued by', width: 'md' }]} />
      </Section>
    </>
  );
}

async function Fridges({ path, places, locations }: { path: string; places: Place[]; locations: { id: string; name: string }[] }) {
  const d = await q<{ temperatureLogs: { id: string; readingC: string; inRange: boolean; recordedAt: string; stockLocation: { id: string } | null }[]; temperatureExcursions: { id: string; ref: string; status: string; version: number; openedAt: string; quarantinedLots: number; resolution: string; stockLocation: { name: string } | null }[] }>(`{
    temperatureLogs(orderBy: { recordedAt: desc }, take: 100) { id readingC inRange recordedAt stockLocation { id } }
    temperatureExcursions(orderBy: { openedAt: desc }, take: 30) { id ref status version openedAt quarantinedLots resolution stockLocation { name } }
  }`);
  const cold = places.filter(p => p.kind === 'fridge' || p.kind === 'freezer');
  return (
    <>
      <Section title="Fridges and freezers">
        {cold.length ? cold.map(p => {
          const last = d.temperatureLogs.find(l => l.stockLocation?.id === p.id);
          return (
            <Row key={p.id}>
              <div className="min-w-0 flex-1"><span className="font-medium">{p.name}</span><Meta>{p.location?.name} · allowed {Number(p.minTempC)} to {Number(p.maxTempC)} °C{last ? ` · last ${Number(last.readingC)} °C` : ' · no reading yet'}</Meta></div>
              {last ? <Status value={last.inRange ? 'in_range' : 'out_of_range'} /> : null}
              <CommandForm op="logTemperature" build="logTemperature" submit="Log reading" fixed={{ stockLocationId: p.id }} paths={[path]} fields={[{ name: 'readingC', label: 'Reading (°C)', width: 'sm' }]} />
            </Row>
          );
        }) : <Empty>No fridge has been set up yet.</Empty>}
      </Section>
      <Section title="Excursions">
        {d.temperatureExcursions.length ? d.temperatureExcursions.map(e => (
          <Row key={e.id}>
            <div className="min-w-0 flex-1"><span className="font-medium">{e.stockLocation?.name}</span> · {e.ref}<Meta>Opened {calendarDay(e.openedAt)} · {e.quarantinedLots} {e.quarantinedLots === 1 ? 'lot' : 'lots'} quarantined{e.resolution ? ` · ${e.resolution}` : ''}</Meta></div>
            <Status value={e.status} />
            {e.status === 'open' ? <CommandForm op="resolveExcursion" build="resolveExcursion" submit="Resolve" fixed={{ excursionId: e.id, expectedVersion: String(e.version) }} paths={[path]} fields={[{ name: 'resolution', label: 'What was decided', width: 'lg' }]} /> : null}
          </Row>
        )) : <Empty>No excursions.</Empty>}
      </Section>
      <Section title="Add a storage place">
        <CommandForm op="addStockLocation" build="addStockLocation" submit="Add" paths={[path]}
          fields={[
            { name: 'locationId', label: 'Location', width: 'md', options: locations.map(l => ({ value: l.id, label: l.name })) },
            { name: 'name', label: 'Name', width: 'md' },
            { name: 'kind', label: 'Kind', width: 'md', options: PLACE_KINDS },
            { name: 'minTempC', label: 'Lowest allowed (°C)', width: 'sm' },
            { name: 'maxTempC', label: 'Highest allowed (°C)', width: 'sm' },
          ]} />
      </Section>
    </>
  );
}
