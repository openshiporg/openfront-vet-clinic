import { list } from '@keystone-6/core'
import { calendarDay, checkbox, integer, json, text, timestamp } from '@keystone-6/core/fields'
import { relationship } from './guardedRelationship'
import { fixedChoice, lifecycle, minor, qty, readOnly, systemText, unit, versionField } from './domainFields'
import { governed, managed } from './listAccess'
import { trackingFields } from './trackingFields'

/*
 * Inventory (BUILD-PLAN P3). Stock is movement-only: on-hand is never typed in, it is the sum of
 * StockMovement rows, kept per item/lot/place in StockLevel by a database trigger that also refuses a
 * movement that would take a level below zero (migrations/…_phase3_inventory). Receiving, use, counts,
 * transfers, quarantine and disposal are each a movement written in the same transaction as their cause.
 * Cost and supplier prices are readable only by people who order or see finance.
 */

const STOCK_READ = ['canAccessDashboard'] as const
const PURCHASING = ['canOrderStock', 'canManageInventory', 'canApprovePurchase', 'canViewFinance'] as const

export const UnitOfMeasure = list({
  access: managed('signedIn', 'canManageInventory'),
  ui: { labelField: 'name' },
  fields: {
    code: text({ isIndexed: 'unique', validation: { isRequired: true } }),
    name: text({ validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/** Something the practice holds: a drug, a vaccine, a supply or a retail product. */
export const Item = list({
  access: governed([...STOCK_READ]),
  ui: { labelField: 'name', listView: { initialColumns: ['ref', 'name', 'kind', 'baseUnit', 'active'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(['drug', 'vaccine', 'supply', 'retail_food', 'retail_other']),
    drug: relationship({ ref: 'DrugProduct', ...readOnly }),
    vaccine: relationship({ ref: 'VaccineProduct', ...readOnly }),
    baseUnit: unit(),
    sku: systemText(),
    /** Held in a fridge: a lot of it is quarantined when its fridge goes out of range. */
    coldChain: checkbox({ defaultValue: false, ...readOnly }),
    active: checkbox({ defaultValue: true, ...readOnly }),
    ...trackingFields,
  },
})

/** 1 box = 10 vial = 100 mL, written as chained conversions. */
export const ItemUomConversion = list({
  access: governed([...STOCK_READ]),
  fields: {
    item: relationship({ ref: 'Item', ...readOnly }),
    fromUnit: systemText({ required: true }),
    toUnit: systemText({ required: true }),
    factor: qty({ required: true }),
    ...trackingFields,
  },
})

/** A shelf, fridge, freezer, locked cabinet or vehicle where stock is kept. */
export const StockLocation = list({
  access: governed([...STOCK_READ]),
  ui: { labelField: 'name', listView: { initialColumns: ['name', 'location', 'kind', 'active'] } },
  fields: {
    name: systemText({ required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    kind: fixedChoice(['shelf', 'fridge', 'freezer', 'cabinet', 'controlled_cabinet', 'vehicle']),
    minTempC: qty(),
    maxTempC: qty(),
    active: checkbox({ defaultValue: true, ...readOnly }),
    ...trackingFields,
  },
})

/** Every change to stock, forever. Corrections are further movements. */
export const StockMovement = list({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ['occurredAt', 'item', 'kind', 'qtySigned', 'unit', 'stockLocation'] } },
  fields: {
    item: relationship({ ref: 'Item', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    stockLocation: relationship({ ref: 'StockLocation', ...readOnly }),
    kind: fixedChoice(['receive', 'use', 'dispense', 'adjust', 'count', 'transfer_out', 'transfer_in', 'dispose', 'return']),
    qtySigned: qty({ required: true }),
    unit: unit(),
    sourceType: systemText(),
    sourceId: systemText(),
    reason: systemText(),
    actor: relationship({ ref: 'StaffMember', ...readOnly }),
    occurredAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

/** On hand per item, lot and place. Written only by the movement trigger. */
export const StockLevel = list({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ['item', 'lot', 'stockLocation', 'onHand', 'unit'] } },
  fields: {
    item: relationship({ ref: 'Item', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    stockLocation: relationship({ ref: 'StockLocation', ...readOnly }),
    onHand: qty({ required: true }),
    unit: unit(),
    ...trackingFields,
  },
})

export const Supplier = list({
  access: governed([...PURCHASING]),
  ui: { labelField: 'name' },
  fields: {
    name: systemText({ required: true }),
    accountNumber: systemText(),
    phone: systemText(),
    email: systemText(),
    /** Hold DEA registration for suppliers of controlled drugs. */
    deaNumber: systemText(),
    active: checkbox({ defaultValue: true, ...readOnly }),
    ...trackingFields,
  },
})

export const SupplierItem = list({
  access: governed([...PURCHASING]),
  fields: {
    supplier: relationship({ ref: 'Supplier', ...readOnly }),
    item: relationship({ ref: 'Item', ...readOnly }),
    sku: systemText(),
    packSize: qty(),
    packUnit: unit(),
    lastCostMinor: minor(),
    ...trackingFields,
  },
})

export const PurchaseOrder = list({
  access: governed([...PURCHASING]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'supplier', 'location', 'status', 'orderedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    supplier: relationship({ ref: 'Supplier', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    status: lifecycle(['draft', 'submitted', 'partially_received', 'received', 'cancelled']),
    orderedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    orderedAt: timestamp({ ...readOnly }),
    approvedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    note: systemText(),
    lines: relationship({ ref: 'PurchaseOrderLine.purchaseOrder', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const PurchaseOrderLine = list({
  access: governed([...PURCHASING]),
  fields: {
    purchaseOrder: relationship({ ref: 'PurchaseOrder.lines', ...readOnly }),
    item: relationship({ ref: 'Item', ...readOnly }),
    qtyOrdered: qty({ required: true }),
    qtyReceived: qty({ required: true }),
    unit: unit(),
    unitCostMinor: minor({ required: true }),
    ...trackingFields,
  },
})

/** What arrived. Immutable; stock comes from the movements written with it. */
export const GoodsReceipt = list({
  access: governed([...PURCHASING, 'canReceiveStock']),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    purchaseOrder: relationship({ ref: 'PurchaseOrder', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    receivedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    receivedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    packingSlip: systemText(),
    lines: relationship({ ref: 'GoodsReceiptLine.receipt', many: true, ...readOnly }),
    ...trackingFields,
  },
})

export const GoodsReceiptLine = list({
  access: governed([...PURCHASING, 'canReceiveStock']),
  fields: {
    receipt: relationship({ ref: 'GoodsReceipt.lines', ...readOnly }),
    purchaseOrderLine: relationship({ ref: 'PurchaseOrderLine', ...readOnly }),
    item: relationship({ ref: 'Item', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    qty: qty({ required: true }),
    unit: unit(),
    ...trackingFields,
  },
})

/** Re-order when on hand across a location falls to minQty; order up to targetQty. Computed on read. */
export const ReorderRule = list({
  access: governed([...STOCK_READ]),
  fields: {
    item: relationship({ ref: 'Item', ...readOnly }),
    location: relationship({ ref: 'Location', ...readOnly }),
    minQty: qty({ required: true }),
    targetQty: qty({ required: true }),
    ...trackingFields,
  },
})

export const StockCount = list({
  access: governed([...STOCK_READ]),
  ui: { labelField: 'ref' },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    location: relationship({ ref: 'Location', ...readOnly }),
    stockLocation: relationship({ ref: 'StockLocation', ...readOnly }),
    status: lifecycle(['closed']),
    countedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    countedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    lines: relationship({ ref: 'StockCountLine.count', many: true, ...readOnly }),
    ...trackingFields,
  },
})

export const StockCountLine = list({
  access: governed([...STOCK_READ]),
  fields: {
    count: relationship({ ref: 'StockCount.lines', ...readOnly }),
    item: relationship({ ref: 'Item', ...readOnly }),
    lot: relationship({ ref: 'InventoryLot', ...readOnly }),
    expectedQty: qty({ required: true }),
    countedQty: qty({ required: true }),
    variance: qty({ required: true }),
    ...trackingFields,
  },
})

/** A manufacturer or regulator recall for a lot, and the patients who may have received it. */
export const RecallCase = list({
  access: governed([...STOCK_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'title', 'lotNumber', 'status', 'openedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    title: systemText({ required: true }),
    source: systemText(),
    item: relationship({ ref: 'Item', ...readOnly }),
    lotNumber: systemText({ required: true }),
    status: lifecycle(['open', 'closed']),
    openedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    closedAt: timestamp({ ...readOnly }),
    resolution: systemText(),
    exposures: relationship({ ref: 'RecallExposure.recall', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

/** A patient (via a dispense, administration or vaccine) who got a recalled lot. */
export const RecallExposure = list({
  access: governed(['canReadClinical', 'canManageInventory']),
  ui: { listView: { initialColumns: ['recall', 'patient', 'sourceType', 'status'] } },
  fields: {
    recall: relationship({ ref: 'RecallCase.exposures', ...readOnly }),
    patient: relationship({ ref: 'Patient', ...readOnly }),
    client: relationship({ ref: 'Client', ...readOnly }),
    sourceType: fixedChoice(['dispense', 'administration', 'vaccine']),
    sourceId: systemText({ required: true }),
    givenOn: calendarDay({ ...readOnly }),
    status: lifecycle(['to_contact', 'contacted', 'resolved']),
    note: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

/** A fridge or freezer reading. Immutable; an out-of-range one opens a TemperatureExcursion. */
export const TemperatureLog = list({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ['recordedAt', 'stockLocation', 'readingC', 'inRange'] } },
  fields: {
    stockLocation: relationship({ ref: 'StockLocation', ...readOnly }),
    readingC: qty({ required: true }),
    inRange: checkbox({ defaultValue: true, ...readOnly }),
    recordedBy: relationship({ ref: 'StaffMember', ...readOnly }),
    recordedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields,
  },
})

export const TemperatureExcursion = list({
  access: governed([...STOCK_READ]),
  ui: { labelField: 'ref', listView: { initialColumns: ['ref', 'stockLocation', 'status', 'openedAt'] } },
  fields: {
    ref: systemText({ indexed: 'unique', required: true }),
    stockLocation: relationship({ ref: 'StockLocation', ...readOnly }),
    log: relationship({ ref: 'TemperatureLog', ...readOnly }),
    status: lifecycle(['open', 'resolved']),
    openedAt: timestamp({ ...readOnly, validation: { isRequired: true } }),
    quarantinedLots: integer({ ...readOnly, defaultValue: 0 }),
    resolvedAt: timestamp({ ...readOnly }),
    resolution: systemText(),
    version: versionField(),
    ...trackingFields,
  },
})

export const INVENTORY_LISTS = {
  UnitOfMeasure, Item, ItemUomConversion, StockLocation, StockMovement, StockLevel, Supplier, SupplierItem, PurchaseOrder, PurchaseOrderLine,
  GoodsReceipt, GoodsReceiptLine, ReorderRule, StockCount, StockCountLine, RecallCase, RecallExposure, TemperatureLog, TemperatureExcursion,
}
void json
