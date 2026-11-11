-- CreateTable
CREATE TABLE "CsWitness" (
    "id" TEXT NOT NULL,
    "entry" TEXT,
    "witness" TEXT,
    "attestedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsWitness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsOrderForm" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "formNumber" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "location" TEXT,
    "supplier" TEXT,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "signedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsOrderForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsOrderFormLine" (
    "id" TEXT NOT NULL,
    "orderForm" TEXT,
    "product" TEXT,
    "packages" INTEGER NOT NULL,
    "packagesReceived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsOrderFormLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsTransfer" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "fromContainer" TEXT,
    "toContainer" TEXT,
    "toRegistration" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "outEntry" TEXT,
    "inEntry" TEXT,
    "sentBy" TEXT,
    "witness" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdmpSubmission" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "format" TEXT NOT NULL DEFAULT '',
    "reportCount" INTEGER DEFAULT 0,
    "fileSha256" TEXT NOT NULL DEFAULT '',
    "generatedBy" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdmpSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetAccessEvent" (
    "id" TEXT NOT NULL,
    "location" TEXT,
    "staff" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CabinetAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispenseLabel" (
    "id" TEXT NOT NULL,
    "dispense" TEXT,
    "fields" JSONB,
    "printedBy" TEXT,
    "printedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispenseLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDispense" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "prescription" TEXT,
    "patient" TEXT,
    "pharmacyName" TEXT NOT NULL DEFAULT '',
    "orderReference" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalDispense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrittenRxExport" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "prescription" TEXT,
    "exportedBy" TEXT,
    "exportedAt" TIMESTAMP(3) NOT NULL,
    "contentSha256" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrittenRxExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "drug" TEXT,
    "vaccine" TEXT,
    "baseUnit" TEXT,
    "sku" TEXT NOT NULL DEFAULT '',
    "coldChain" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemUomConversion" (
    "id" TEXT NOT NULL,
    "item" TEXT,
    "fromUnit" TEXT NOT NULL DEFAULT '',
    "toUnit" TEXT NOT NULL DEFAULT '',
    "factor" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemUomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "kind" TEXT NOT NULL,
    "minTempC" DECIMAL(18,6),
    "maxTempC" DECIMAL(18,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "item" TEXT,
    "lot" TEXT,
    "stockLocation" TEXT,
    "kind" TEXT NOT NULL,
    "qtySigned" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "actor" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "item" TEXT,
    "lot" TEXT,
    "stockLocation" TEXT,
    "onHand" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "deaNumber" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL,
    "supplier" TEXT,
    "item" TEXT,
    "sku" TEXT NOT NULL DEFAULT '',
    "packSize" DECIMAL(18,6),
    "packUnit" TEXT,
    "lastCostMinor" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "supplier" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "orderedBy" TEXT,
    "orderedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrder" TEXT,
    "item" TEXT,
    "qtyOrdered" DECIMAL(18,6) NOT NULL,
    "qtyReceived" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "unitCostMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "purchaseOrder" TEXT,
    "location" TEXT,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "packingSlip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receipt" TEXT,
    "purchaseOrderLine" TEXT,
    "item" TEXT,
    "lot" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderRule" (
    "id" TEXT NOT NULL,
    "item" TEXT,
    "location" TEXT,
    "minQty" DECIMAL(18,6) NOT NULL,
    "targetQty" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReorderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "stockLocation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'closed',
    "countedBy" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "count" TEXT,
    "item" TEXT,
    "lot" TEXT,
    "expectedQty" DECIMAL(18,6) NOT NULL,
    "countedQty" DECIMAL(18,6) NOT NULL,
    "variance" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallCase" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "item" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallExposure" (
    "id" TEXT NOT NULL,
    "recall" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "givenOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'to_contact',
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemperatureLog" (
    "id" TEXT NOT NULL,
    "stockLocation" TEXT,
    "readingC" DECIMAL(18,6) NOT NULL,
    "inRange" BOOLEAN NOT NULL DEFAULT true,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemperatureLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemperatureExcursion" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "stockLocation" TEXT,
    "log" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "quarantinedLots" INTEGER DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemperatureExcursion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsWitness_entry_idx" ON "CsWitness"("entry");

-- CreateIndex
CREATE INDEX "CsWitness_witness_idx" ON "CsWitness"("witness");

-- CreateIndex
CREATE UNIQUE INDEX "CsOrderForm_ref_key" ON "CsOrderForm"("ref");

-- CreateIndex
CREATE INDEX "CsOrderForm_location_idx" ON "CsOrderForm"("location");

-- CreateIndex
CREATE INDEX "CsOrderForm_supplier_idx" ON "CsOrderForm"("supplier");

-- CreateIndex
CREATE INDEX "CsOrderForm_signedBy_idx" ON "CsOrderForm"("signedBy");

-- CreateIndex
CREATE INDEX "CsOrderFormLine_orderForm_idx" ON "CsOrderFormLine"("orderForm");

-- CreateIndex
CREATE INDEX "CsOrderFormLine_product_idx" ON "CsOrderFormLine"("product");

-- CreateIndex
CREATE UNIQUE INDEX "CsTransfer_ref_key" ON "CsTransfer"("ref");

-- CreateIndex
CREATE INDEX "CsTransfer_fromContainer_idx" ON "CsTransfer"("fromContainer");

-- CreateIndex
CREATE INDEX "CsTransfer_toContainer_idx" ON "CsTransfer"("toContainer");

-- CreateIndex
CREATE INDEX "CsTransfer_toRegistration_idx" ON "CsTransfer"("toRegistration");

-- CreateIndex
CREATE INDEX "CsTransfer_outEntry_idx" ON "CsTransfer"("outEntry");

-- CreateIndex
CREATE INDEX "CsTransfer_inEntry_idx" ON "CsTransfer"("inEntry");

-- CreateIndex
CREATE INDEX "CsTransfer_sentBy_idx" ON "CsTransfer"("sentBy");

-- CreateIndex
CREATE INDEX "CsTransfer_witness_idx" ON "CsTransfer"("witness");

-- CreateIndex
CREATE UNIQUE INDEX "PdmpSubmission_ref_key" ON "PdmpSubmission"("ref");

-- CreateIndex
CREATE INDEX "PdmpSubmission_location_idx" ON "PdmpSubmission"("location");

-- CreateIndex
CREATE INDEX "PdmpSubmission_generatedBy_idx" ON "PdmpSubmission"("generatedBy");

-- CreateIndex
CREATE INDEX "CabinetAccessEvent_location_idx" ON "CabinetAccessEvent"("location");

-- CreateIndex
CREATE INDEX "CabinetAccessEvent_staff_idx" ON "CabinetAccessEvent"("staff");

-- CreateIndex
CREATE INDEX "DispenseLabel_dispense_idx" ON "DispenseLabel"("dispense");

-- CreateIndex
CREATE INDEX "DispenseLabel_printedBy_idx" ON "DispenseLabel"("printedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDispense_ref_key" ON "ExternalDispense"("ref");

-- CreateIndex
CREATE INDEX "ExternalDispense_prescription_idx" ON "ExternalDispense"("prescription");

-- CreateIndex
CREATE INDEX "ExternalDispense_patient_idx" ON "ExternalDispense"("patient");

-- CreateIndex
CREATE INDEX "ExternalDispense_decidedBy_idx" ON "ExternalDispense"("decidedBy");

-- CreateIndex
CREATE UNIQUE INDEX "WrittenRxExport_ref_key" ON "WrittenRxExport"("ref");

-- CreateIndex
CREATE INDEX "WrittenRxExport_prescription_idx" ON "WrittenRxExport"("prescription");

-- CreateIndex
CREATE INDEX "WrittenRxExport_exportedBy_idx" ON "WrittenRxExport"("exportedBy");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Item_ref_key" ON "Item"("ref");

-- CreateIndex
CREATE INDEX "Item_drug_idx" ON "Item"("drug");

-- CreateIndex
CREATE INDEX "Item_vaccine_idx" ON "Item"("vaccine");

-- CreateIndex
CREATE INDEX "ItemUomConversion_item_idx" ON "ItemUomConversion"("item");

-- CreateIndex
CREATE INDEX "StockLocation_location_idx" ON "StockLocation"("location");

-- CreateIndex
CREATE INDEX "StockMovement_item_idx" ON "StockMovement"("item");

-- CreateIndex
CREATE INDEX "StockMovement_lot_idx" ON "StockMovement"("lot");

-- CreateIndex
CREATE INDEX "StockMovement_stockLocation_idx" ON "StockMovement"("stockLocation");

-- CreateIndex
CREATE INDEX "StockMovement_actor_idx" ON "StockMovement"("actor");

-- CreateIndex
CREATE INDEX "StockLevel_item_idx" ON "StockLevel"("item");

-- CreateIndex
CREATE INDEX "StockLevel_lot_idx" ON "StockLevel"("lot");

-- CreateIndex
CREATE INDEX "StockLevel_stockLocation_idx" ON "StockLevel"("stockLocation");

-- CreateIndex
CREATE INDEX "SupplierItem_supplier_idx" ON "SupplierItem"("supplier");

-- CreateIndex
CREATE INDEX "SupplierItem_item_idx" ON "SupplierItem"("item");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_ref_key" ON "PurchaseOrder"("ref");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplier_idx" ON "PurchaseOrder"("supplier");

-- CreateIndex
CREATE INDEX "PurchaseOrder_location_idx" ON "PurchaseOrder"("location");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderedBy_idx" ON "PurchaseOrder"("orderedBy");

-- CreateIndex
CREATE INDEX "PurchaseOrder_approvedBy_idx" ON "PurchaseOrder"("approvedBy");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrder_idx" ON "PurchaseOrderLine"("purchaseOrder");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_item_idx" ON "PurchaseOrderLine"("item");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_ref_key" ON "GoodsReceipt"("ref");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrder_idx" ON "GoodsReceipt"("purchaseOrder");

-- CreateIndex
CREATE INDEX "GoodsReceipt_location_idx" ON "GoodsReceipt"("location");

-- CreateIndex
CREATE INDEX "GoodsReceipt_receivedBy_idx" ON "GoodsReceipt"("receivedBy");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receipt_idx" ON "GoodsReceiptLine"("receipt");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_purchaseOrderLine_idx" ON "GoodsReceiptLine"("purchaseOrderLine");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_item_idx" ON "GoodsReceiptLine"("item");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_lot_idx" ON "GoodsReceiptLine"("lot");

-- CreateIndex
CREATE INDEX "ReorderRule_item_idx" ON "ReorderRule"("item");

-- CreateIndex
CREATE INDEX "ReorderRule_location_idx" ON "ReorderRule"("location");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_ref_key" ON "StockCount"("ref");

-- CreateIndex
CREATE INDEX "StockCount_location_idx" ON "StockCount"("location");

-- CreateIndex
CREATE INDEX "StockCount_stockLocation_idx" ON "StockCount"("stockLocation");

-- CreateIndex
CREATE INDEX "StockCount_countedBy_idx" ON "StockCount"("countedBy");

-- CreateIndex
CREATE INDEX "StockCountLine_count_idx" ON "StockCountLine"("count");

-- CreateIndex
CREATE INDEX "StockCountLine_item_idx" ON "StockCountLine"("item");

-- CreateIndex
CREATE INDEX "StockCountLine_lot_idx" ON "StockCountLine"("lot");

-- CreateIndex
CREATE UNIQUE INDEX "RecallCase_ref_key" ON "RecallCase"("ref");

-- CreateIndex
CREATE INDEX "RecallCase_item_idx" ON "RecallCase"("item");

-- CreateIndex
CREATE INDEX "RecallExposure_recall_idx" ON "RecallExposure"("recall");

-- CreateIndex
CREATE INDEX "RecallExposure_patient_idx" ON "RecallExposure"("patient");

-- CreateIndex
CREATE INDEX "RecallExposure_client_idx" ON "RecallExposure"("client");

-- CreateIndex
CREATE INDEX "TemperatureLog_stockLocation_idx" ON "TemperatureLog"("stockLocation");

-- CreateIndex
CREATE INDEX "TemperatureLog_recordedBy_idx" ON "TemperatureLog"("recordedBy");

-- CreateIndex
CREATE UNIQUE INDEX "TemperatureExcursion_ref_key" ON "TemperatureExcursion"("ref");

-- CreateIndex
CREATE INDEX "TemperatureExcursion_stockLocation_idx" ON "TemperatureExcursion"("stockLocation");

-- CreateIndex
CREATE INDEX "TemperatureExcursion_log_idx" ON "TemperatureExcursion"("log");

-- AddForeignKey
ALTER TABLE "CsWitness" ADD CONSTRAINT "CsWitness_entry_fkey" FOREIGN KEY ("entry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsWitness" ADD CONSTRAINT "CsWitness_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsOrderForm" ADD CONSTRAINT "CsOrderForm_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsOrderForm" ADD CONSTRAINT "CsOrderForm_supplier_fkey" FOREIGN KEY ("supplier") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsOrderForm" ADD CONSTRAINT "CsOrderForm_signedBy_fkey" FOREIGN KEY ("signedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsOrderFormLine" ADD CONSTRAINT "CsOrderFormLine_orderForm_fkey" FOREIGN KEY ("orderForm") REFERENCES "CsOrderForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsOrderFormLine" ADD CONSTRAINT "CsOrderFormLine_product_fkey" FOREIGN KEY ("product") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_fromContainer_fkey" FOREIGN KEY ("fromContainer") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_toContainer_fkey" FOREIGN KEY ("toContainer") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_toRegistration_fkey" FOREIGN KEY ("toRegistration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_outEntry_fkey" FOREIGN KEY ("outEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_inEntry_fkey" FOREIGN KEY ("inEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdmpSubmission" ADD CONSTRAINT "PdmpSubmission_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdmpSubmission" ADD CONSTRAINT "PdmpSubmission_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabinetAccessEvent" ADD CONSTRAINT "CabinetAccessEvent_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabinetAccessEvent" ADD CONSTRAINT "CabinetAccessEvent_staff_fkey" FOREIGN KEY ("staff") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLabel" ADD CONSTRAINT "DispenseLabel_dispense_fkey" FOREIGN KEY ("dispense") REFERENCES "Dispense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispenseLabel" ADD CONSTRAINT "DispenseLabel_printedBy_fkey" FOREIGN KEY ("printedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDispense" ADD CONSTRAINT "ExternalDispense_prescription_fkey" FOREIGN KEY ("prescription") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDispense" ADD CONSTRAINT "ExternalDispense_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDispense" ADD CONSTRAINT "ExternalDispense_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrittenRxExport" ADD CONSTRAINT "WrittenRxExport_prescription_fkey" FOREIGN KEY ("prescription") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrittenRxExport" ADD CONSTRAINT "WrittenRxExport_exportedBy_fkey" FOREIGN KEY ("exportedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_drug_fkey" FOREIGN KEY ("drug") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_vaccine_fkey" FOREIGN KEY ("vaccine") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUomConversion" ADD CONSTRAINT "ItemUomConversion_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockLocation_fkey" FOREIGN KEY ("stockLocation") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actor_fkey" FOREIGN KEY ("actor") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_stockLocation_fkey" FOREIGN KEY ("stockLocation") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplier_fkey" FOREIGN KEY ("supplier") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplier_fkey" FOREIGN KEY ("supplier") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orderedBy_fkey" FOREIGN KEY ("orderedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrder_fkey" FOREIGN KEY ("purchaseOrder") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrder_fkey" FOREIGN KEY ("purchaseOrder") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receipt_fkey" FOREIGN KEY ("receipt") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLine_fkey" FOREIGN KEY ("purchaseOrderLine") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderRule" ADD CONSTRAINT "ReorderRule_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_stockLocation_fkey" FOREIGN KEY ("stockLocation") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_countedBy_fkey" FOREIGN KEY ("countedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_count_fkey" FOREIGN KEY ("count") REFERENCES "StockCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallCase" ADD CONSTRAINT "RecallCase_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallExposure" ADD CONSTRAINT "RecallExposure_recall_fkey" FOREIGN KEY ("recall") REFERENCES "RecallCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallExposure" ADD CONSTRAINT "RecallExposure_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallExposure" ADD CONSTRAINT "RecallExposure_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureLog" ADD CONSTRAINT "TemperatureLog_stockLocation_fkey" FOREIGN KEY ("stockLocation") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureLog" ADD CONSTRAINT "TemperatureLog_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureExcursion" ADD CONSTRAINT "TemperatureExcursion_stockLocation_fkey" FOREIGN KEY ("stockLocation") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemperatureExcursion" ADD CONSTRAINT "TemperatureExcursion_log_fkey" FOREIGN KEY ("log") REFERENCES "TemperatureLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ── Phase 3 inventory and register guards: they hold whatever the application does ──────────
-- Stock is movement-only. A movement is immutable; the level is derived from movements by the trigger below
-- and cannot be written any other way; a movement that would take a level below zero is refused.
CREATE UNIQUE INDEX "StockLevel_key" ON "StockLevel" (item, COALESCE(lot, ''), COALESCE("stockLocation", ''));
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_nonnegative" CHECK ("onHand" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_nonzero" CHECK ("qtySigned" <> 0 AND item IS NOT NULL AND "stockLocation" IS NOT NULL);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_direction" CHECK (
  (kind IN ('receive', 'transfer_in', 'return') AND "qtySigned" > 0)
  OR (kind IN ('use', 'dispense', 'dispose', 'transfer_out') AND "qtySigned" < 0)
  OR kind IN ('adjust', 'count'));

CREATE OR REPLACE FUNCTION vc_stock_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lvl_id text; lvl numeric; lot_status text; lot_item text;
BEGIN
  -- Serialise every movement for one item at one place, so parallel uses cannot both pass the check.
  PERFORM pg_advisory_xact_lock(hashtextextended('stock:' || NEW.item || ':' || COALESCE(NEW."stockLocation", ''), 0));
  IF NEW.lot IS NOT NULL AND NEW."qtySigned" < 0 AND NEW.kind IN ('use', 'dispense') THEN
    SELECT status INTO lot_status FROM "InventoryLot" WHERE id = NEW.lot;
    IF lot_status IS DISTINCT FROM 'available' THEN RAISE EXCEPTION 'That lot is % and cannot be used', COALESCE(lot_status, 'unknown') USING ERRCODE = 'check_violation'; END IF;
  END IF;
  SELECT id, "onHand" INTO lvl_id, lvl FROM "StockLevel" WHERE item = NEW.item AND COALESCE(lot, '') = COALESCE(NEW.lot, '') AND COALESCE("stockLocation", '') = COALESCE(NEW."stockLocation", '') FOR UPDATE;
  IF lvl_id IS NULL THEN
    IF NEW."qtySigned" < 0 THEN RAISE EXCEPTION 'Stock cannot go below zero (nothing on hand)' USING ERRCODE = 'check_violation'; END IF;
    PERFORM set_config('vc.stock_write', 'on', true);
    INSERT INTO "StockLevel" (id, item, lot, "stockLocation", "onHand", unit) VALUES ('sl_' || replace(gen_random_uuid()::text, '-', ''), NEW.item, NEW.lot, NEW."stockLocation", NEW."qtySigned", NEW.unit);
  ELSE
    IF lvl + NEW."qtySigned" < 0 THEN RAISE EXCEPTION 'Stock cannot go below zero (% on hand, % requested)', lvl, -NEW."qtySigned" USING ERRCODE = 'check_violation'; END IF;
    PERFORM set_config('vc.stock_write', 'on', true);
    UPDATE "StockLevel" SET "onHand" = lvl + NEW."qtySigned", "updatedAt" = now() WHERE id = lvl_id;
  END IF;
  PERFORM set_config('vc.stock_write', 'off', true);
  RETURN NEW;
END $$;
CREATE TRIGGER "StockMovement_apply" AFTER INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION vc_stock_apply();

CREATE OR REPLACE FUNCTION vc_stock_level_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('vc.stock_write', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Stock levels come from stock movements and cannot be written directly' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "StockLevel_derived" BEFORE INSERT OR UPDATE OR DELETE ON "StockLevel" FOR EACH ROW EXECUTE FUNCTION vc_stock_level_guard();
CREATE TRIGGER "StockLevel_no_truncate" BEFORE TRUNCATE ON "StockLevel" FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change();

-- Immutable evidence.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['StockMovement', 'GoodsReceipt', 'GoodsReceiptLine', 'StockCount', 'StockCountLine', 'TemperatureLog', 'CsWitness', 'PdmpSubmission', 'CabinetAccessEvent', 'DispenseLabel', 'WrittenRxExport'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['PurchaseOrder', 'PurchaseOrderLine', 'CsOrderForm', 'CsOrderFormLine', 'CsTransfer', 'RecallCase', 'RecallExposure', 'TemperatureExcursion', 'ExternalDispense', 'Item', 'StockLocation', 'Supplier'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_no_delete()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- Purchasing: nothing is received beyond what was ordered; a finished order stays finished.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_received" CHECK ("qtyOrdered" > 0 AND "qtyReceived" >= 0 AND "qtyReceived" <= "qtyOrdered" AND "unitCostMinor" >= 0);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_qty" CHECK (qty > 0);
CREATE OR REPLACE FUNCTION vc_po_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('received', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'A % purchase order cannot change', OLD.status USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'draft' AND NEW.supplier IS DISTINCT FROM OLD.supplier THEN RAISE EXCEPTION 'The supplier of a submitted order cannot change' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PurchaseOrder_forward" BEFORE UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION vc_po_forward();

-- Counts: a line's variance is counted minus expected.
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_variance" CHECK (variance = "countedQty" - "expectedQty" AND "countedQty" >= 0 AND "expectedQty" >= 0);

-- Recalls and excursions: closing needs the evidence, and a closed one stays closed.
ALTER TABLE "RecallCase" ADD CONSTRAINT "RecallCase_closed_evidence" CHECK (status <> 'closed' OR ("closedAt" IS NOT NULL AND resolution <> ''));
ALTER TABLE "TemperatureExcursion" ADD CONSTRAINT "TemperatureExcursion_resolved_evidence" CHECK (status <> 'resolved' OR ("resolvedAt" IS NOT NULL AND resolution <> ''));
CREATE OR REPLACE FUNCTION vc_closed_stays_closed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('closed', 'resolved') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'A closed record cannot be reopened' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RecallCase_closed" BEFORE UPDATE ON "RecallCase" FOR EACH ROW EXECUTE FUNCTION vc_closed_stays_closed();
CREATE TRIGGER "TemperatureExcursion_closed" BEFORE UPDATE ON "TemperatureExcursion" FOR EACH ROW EXECUTE FUNCTION vc_closed_stays_closed();
CREATE UNIQUE INDEX "RecallExposure_once" ON "RecallExposure" (recall, "sourceType", "sourceId");

-- DEA Form 222 / CSOS: valid for 60 days from issue; a line is never received beyond what was ordered.
ALTER TABLE "CsOrderForm" ADD CONSTRAINT "CsOrderForm_sixty_days" CHECK ("expiresOn" = "issuedOn" + 60);
CREATE UNIQUE INDEX "CsOrderForm_number" ON "CsOrderForm" (supplier, "formNumber");
ALTER TABLE "CsOrderFormLine" ADD CONSTRAINT "CsOrderFormLine_received" CHECK (packages >= 1 AND "packagesReceived" >= 0 AND "packagesReceived" <= packages);
CREATE OR REPLACE FUNCTION vc_order_form_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('filled', 'expired', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'A % order form cannot change', OLD.status USING ERRCODE = 'check_violation'; END IF;
  IF NEW."issuedOn" IS DISTINCT FROM OLD."issuedOn" OR NEW."expiresOn" IS DISTINCT FROM OLD."expiresOn" OR NEW."formNumber" IS DISTINCT FROM OLD."formNumber" THEN RAISE EXCEPTION 'The number and dates of an order form cannot change' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsOrderForm_guard" BEFORE UPDATE ON "CsOrderForm" FOR EACH ROW EXECUTE FUNCTION vc_order_form_guard();
-- Receiving against a form that has expired is refused, whatever the app does.
CREATE OR REPLACE FUNCTION vc_order_line_in_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exp date; st text;
BEGIN
  IF NEW."packagesReceived" > COALESCE(OLD."packagesReceived", 0) THEN
    SELECT "expiresOn", status INTO exp, st FROM "CsOrderForm" WHERE id = NEW."orderForm";
    IF st IN ('expired', 'cancelled') OR exp < (now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'That order form has expired (valid 60 days)' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsOrderFormLine_in_date" BEFORE UPDATE ON "CsOrderFormLine" FOR EACH ROW EXECUTE FUNCTION vc_order_line_in_date();

-- Transfers: positive amount, between two different containers; received only with its register entry.
ALTER TABLE "CsTransfer" ADD CONSTRAINT "CsTransfer_shape" CHECK (qty > 0 AND "outEntry" IS NOT NULL AND "sentBy" IS NOT NULL AND witness IS NOT NULL AND witness <> "sentBy"
  AND ("toContainer" IS NULL OR "toContainer" <> "fromContainer") AND (status <> 'received' OR "inEntry" IS NOT NULL OR "toContainer" IS NULL));
CREATE OR REPLACE FUNCTION vc_transfer_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'received' THEN RAISE EXCEPTION 'A received transfer cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.qty IS DISTINCT FROM OLD.qty OR NEW."fromContainer" IS DISTINCT FROM OLD."fromContainer" OR NEW."outEntry" IS DISTINCT FROM OLD."outEntry" THEN RAISE EXCEPTION 'What was sent cannot change' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsTransfer_forward" BEFORE UPDATE ON "CsTransfer" FOR EACH ROW EXECUTE FUNCTION vc_transfer_forward();

-- A controlled cabinet event names who.
ALTER TABLE "CabinetAccessEvent" ADD CONSTRAINT "CabinetAccessEvent_who" CHECK (staff IS NOT NULL);
-- A prescription written on paper is exported at most once per prescription per content hash.
CREATE UNIQUE INDEX "WrittenRxExport_once" ON "WrittenRxExport" (prescription, "contentSha256");

-- PDMP submission link
-- AlterTable
ALTER TABLE "PdmpReport" ADD COLUMN     "submission" TEXT;

-- AlterTable
ALTER TABLE "PdmpSubmission" ADD COLUMN     "fileBody" JSONB;

-- CreateIndex
CREATE INDEX "PdmpReport_submission_idx" ON "PdmpReport"("submission");

-- AddForeignKey
ALTER TABLE "PdmpReport" ADD CONSTRAINT "PdmpReport_submission_fkey" FOREIGN KEY ("submission") REFERENCES "PdmpSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
