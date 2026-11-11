-- Phase 3: dispensing, counts, discrepancy cases, destruction records and PDMP reports.
-- CreateTable
CREATE TABLE "Dispense" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "prescription" TEXT,
    "line" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "product" TEXT,
    "lot" TEXT,
    "container" TEXT,
    "csLogEntry" TEXT,
    "refillRequest" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantityUnit" TEXT,
    "refillNumber" INTEGER NOT NULL DEFAULT 0,
    "dispensedBy" TEXT,
    "dispensedAt" TIMESTAMP(3) NOT NULL,
    "label" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsCount" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "kind" TEXT NOT NULL,
    "countedBy" TEXT,
    "witness" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'closed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsCountLine" (
    "id" TEXT NOT NULL,
    "count" TEXT,
    "container" TEXT,
    "expectedQty" DECIMAL(18,6) NOT NULL,
    "countedQty" DECIMAL(18,6) NOT NULL,
    "variance" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "discrepancyCase" TEXT,

    CONSTRAINT "CsCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsDiscrepancyCase" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "container" TEXT,
    "kind" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "discoveredBy" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "noticeDueOn" DATE,
    "noticeGivenAt" TIMESTAMP(3),
    "noticeReference" TEXT NOT NULL DEFAULT '',
    "form106DueOn" DATE,
    "form106FiledAt" TIMESTAMP(3),
    "form106Reference" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsDiscrepancyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsDestructionRecord" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "container" TEXT,
    "location" TEXT,
    "csLogEntry" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "method" TEXT NOT NULL DEFAULT '',
    "form41Reference" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT,
    "witnessA" TEXT,
    "witnessB" TEXT,
    "destroyedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsDestructionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdmpReport" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "dispense" TEXT,
    "program" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "dueOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "confirmation" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdmpReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispense_ref_key" ON "Dispense"("ref");

-- CreateIndex
CREATE INDEX "Dispense_prescription_idx" ON "Dispense"("prescription");

-- CreateIndex
CREATE INDEX "Dispense_line_idx" ON "Dispense"("line");

-- CreateIndex
CREATE INDEX "Dispense_patient_idx" ON "Dispense"("patient");

-- CreateIndex
CREATE INDEX "Dispense_client_idx" ON "Dispense"("client");

-- CreateIndex
CREATE INDEX "Dispense_location_idx" ON "Dispense"("location");

-- CreateIndex
CREATE INDEX "Dispense_product_idx" ON "Dispense"("product");

-- CreateIndex
CREATE INDEX "Dispense_lot_idx" ON "Dispense"("lot");

-- CreateIndex
CREATE INDEX "Dispense_container_idx" ON "Dispense"("container");

-- CreateIndex
CREATE INDEX "Dispense_csLogEntry_idx" ON "Dispense"("csLogEntry");

-- CreateIndex
CREATE INDEX "Dispense_refillRequest_idx" ON "Dispense"("refillRequest");

-- CreateIndex
CREATE INDEX "Dispense_dispensedBy_idx" ON "Dispense"("dispensedBy");

-- CreateIndex
CREATE UNIQUE INDEX "CsCount_ref_key" ON "CsCount"("ref");

-- CreateIndex
CREATE INDEX "CsCount_location_idx" ON "CsCount"("location");

-- CreateIndex
CREATE INDEX "CsCount_countedBy_idx" ON "CsCount"("countedBy");

-- CreateIndex
CREATE INDEX "CsCount_witness_idx" ON "CsCount"("witness");

-- CreateIndex
CREATE INDEX "CsCountLine_count_idx" ON "CsCountLine"("count");

-- CreateIndex
CREATE INDEX "CsCountLine_container_idx" ON "CsCountLine"("container");

-- CreateIndex
CREATE INDEX "CsCountLine_discrepancyCase_idx" ON "CsCountLine"("discrepancyCase");

-- CreateIndex
CREATE UNIQUE INDEX "CsDiscrepancyCase_ref_key" ON "CsDiscrepancyCase"("ref");

-- CreateIndex
CREATE INDEX "CsDiscrepancyCase_location_idx" ON "CsDiscrepancyCase"("location");

-- CreateIndex
CREATE INDEX "CsDiscrepancyCase_container_idx" ON "CsDiscrepancyCase"("container");

-- CreateIndex
CREATE INDEX "CsDiscrepancyCase_discoveredBy_idx" ON "CsDiscrepancyCase"("discoveredBy");

-- CreateIndex
CREATE UNIQUE INDEX "CsDestructionRecord_ref_key" ON "CsDestructionRecord"("ref");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_container_idx" ON "CsDestructionRecord"("container");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_location_idx" ON "CsDestructionRecord"("location");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_csLogEntry_idx" ON "CsDestructionRecord"("csLogEntry");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_recordedBy_idx" ON "CsDestructionRecord"("recordedBy");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_witnessA_idx" ON "CsDestructionRecord"("witnessA");

-- CreateIndex
CREATE INDEX "CsDestructionRecord_witnessB_idx" ON "CsDestructionRecord"("witnessB");

-- CreateIndex
CREATE UNIQUE INDEX "PdmpReport_ref_key" ON "PdmpReport"("ref");

-- CreateIndex
CREATE INDEX "PdmpReport_location_idx" ON "PdmpReport"("location");

-- CreateIndex
CREATE INDEX "PdmpReport_dispense_idx" ON "PdmpReport"("dispense");

-- CreateIndex
CREATE INDEX "PdmpReport_submittedBy_idx" ON "PdmpReport"("submittedBy");

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_prescription_fkey" FOREIGN KEY ("prescription") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_line_fkey" FOREIGN KEY ("line") REFERENCES "PrescriptionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_product_fkey" FOREIGN KEY ("product") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_container_fkey" FOREIGN KEY ("container") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_csLogEntry_fkey" FOREIGN KEY ("csLogEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_refillRequest_fkey" FOREIGN KEY ("refillRequest") REFERENCES "RefillRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_dispensedBy_fkey" FOREIGN KEY ("dispensedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCount" ADD CONSTRAINT "CsCount_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCount" ADD CONSTRAINT "CsCount_countedBy_fkey" FOREIGN KEY ("countedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCount" ADD CONSTRAINT "CsCount_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCountLine" ADD CONSTRAINT "CsCountLine_count_fkey" FOREIGN KEY ("count") REFERENCES "CsCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCountLine" ADD CONSTRAINT "CsCountLine_container_fkey" FOREIGN KEY ("container") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsCountLine" ADD CONSTRAINT "CsCountLine_discrepancyCase_fkey" FOREIGN KEY ("discrepancyCase") REFERENCES "CsDiscrepancyCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_container_fkey" FOREIGN KEY ("container") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_discoveredBy_fkey" FOREIGN KEY ("discoveredBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_container_fkey" FOREIGN KEY ("container") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_csLogEntry_fkey" FOREIGN KEY ("csLogEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_witnessA_fkey" FOREIGN KEY ("witnessA") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_witnessB_fkey" FOREIGN KEY ("witnessB") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdmpReport" ADD CONSTRAINT "PdmpReport_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdmpReport" ADD CONSTRAINT "PdmpReport_dispense_fkey" FOREIGN KEY ("dispense") REFERENCES "Dispense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdmpReport" ADD CONSTRAINT "PdmpReport_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ── Phase 3 guards: they hold whatever the application does ─────────────────────────────────
-- Immutable once written: what was dispensed, what was counted, what was destroyed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Dispense', 'CsCount', 'CsCountLine', 'CsDestructionRecord'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['CsDiscrepancyCase', 'PdmpReport'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_no_delete()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- Destruction, a transfer out and a theft or loss also name a witness (waste and Schedule II administration already do: Phase 2).
-- NOT VALID only so rows written before this migration are not re-judged; none of these types exist yet.
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_witness_required_p3" CHECK (
  type NOT IN ('destroy', 'transfer_out', 'theft_loss') OR witness IS NOT NULL) NOT VALID;
-- Every register entry names the person who recorded it.
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_actor_required" CHECK (actor IS NOT NULL) NOT VALID;

-- Destruction: two witnesses, distinct from each other and from the person recording (21 CFR 1317.95).
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_two_witnesses" CHECK (
  "witnessA" IS NOT NULL AND "witnessB" IS NOT NULL AND "witnessA" <> "witnessB" AND "witnessA" <> "recordedBy" AND "witnessB" <> "recordedBy");
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_qty_positive" CHECK (qty > 0);
ALTER TABLE "CsDestructionRecord" ADD CONSTRAINT "CsDestructionRecord_entry_required" CHECK ("csLogEntry" IS NOT NULL);

-- Counts: a line's variance is counted minus expected; a count has two different people.
ALTER TABLE "CsCountLine" ADD CONSTRAINT "CsCountLine_variance" CHECK (variance = "countedQty" - "expectedQty" AND "countedQty" >= 0 AND "expectedQty" >= 0);
ALTER TABLE "CsCount" ADD CONSTRAINT "CsCount_two_people" CHECK ("countedBy" IS NOT NULL AND witness IS NOT NULL AND witness <> "countedBy");

-- Discrepancy clocks only move forward: notice, then Form 106; closing needs both for a theft or loss.
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_qty_positive" CHECK (qty > 0);
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_status_evidence" CHECK (
  (status NOT IN ('notified', 'form_filed', 'closed') OR kind = 'count_variance' OR "noticeGivenAt" IS NOT NULL)
  AND (status NOT IN ('form_filed') OR kind = 'count_variance' OR "form106FiledAt" IS NOT NULL)
  AND (status <> 'closed' OR ("closedAt" IS NOT NULL AND resolution <> '')));
ALTER TABLE "CsDiscrepancyCase" ADD CONSTRAINT "CsDiscrepancyCase_theft_loss_closed" CHECK (
  status <> 'closed' OR kind = 'count_variance' OR ("noticeGivenAt" IS NOT NULL AND "form106FiledAt" IS NOT NULL));
CREATE OR REPLACE FUNCTION vc_cs_case_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'A closed discrepancy case cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF OLD."noticeGivenAt" IS NOT NULL AND NEW."noticeGivenAt" IS DISTINCT FROM OLD."noticeGivenAt" THEN RAISE EXCEPTION 'The notice time cannot be changed' USING ERRCODE = 'check_violation'; END IF;
  IF OLD."form106FiledAt" IS NOT NULL AND NEW."form106FiledAt" IS DISTINCT FROM OLD."form106FiledAt" THEN RAISE EXCEPTION 'The Form 106 filing time cannot be changed' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW."discoveredAt" IS DISTINCT FROM OLD."discoveredAt" OR NEW."noticeDueOn" IS DISTINCT FROM OLD."noticeDueOn" OR NEW."form106DueOn" IS DISTINCT FROM OLD."form106DueOn" THEN
    RAISE EXCEPTION 'What was lost, when it was found and its deadlines cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsDiscrepancyCase_forward" BEFORE UPDATE ON "CsDiscrepancyCase" FOR EACH ROW EXECUTE FUNCTION vc_cs_case_forward();

-- A submitted PDMP report keeps who sent it and when.
ALTER TABLE "PdmpReport" ADD CONSTRAINT "PdmpReport_submitted_evidence" CHECK (status <> 'submitted' OR ("submittedAt" IS NOT NULL AND "submittedBy" IS NOT NULL));
CREATE OR REPLACE FUNCTION vc_pdmp_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'A submitted PDMP report cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.dispense IS DISTINCT FROM OLD.dispense OR NEW."dueOn" IS DISTINCT FROM OLD."dueOn" THEN RAISE EXCEPTION 'The dispense and deadline of a PDMP report cannot change' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PdmpReport_forward" BEFORE UPDATE ON "PdmpReport" FOR EACH ROW EXECUTE FUNCTION vc_pdmp_forward();
CREATE UNIQUE INDEX "PdmpReport_one_per_dispense" ON "PdmpReport" (dispense);

-- Dispense: positive quantity; a controlled dispense names its container and its register entry; the refill number respects the line's authorised refills.
ALTER TABLE "Dispense" ADD CONSTRAINT "Dispense_quantity_positive" CHECK (quantity > 0 AND "refillNumber" >= 0);
CREATE UNIQUE INDEX "Dispense_one_fill_number" ON "Dispense" (line, "refillNumber") WHERE line IS NOT NULL;
CREATE OR REPLACE FUNCTION vc_dispense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refills integer; sched text; rx_status text; expires timestamp;
BEGIN
  IF NEW.line IS NULL THEN RETURN NEW; END IF;
  SELECT l."refillsAuthorised", l."csSchedule", l."expiresAt" INTO refills, sched, expires FROM "PrescriptionLine" l WHERE l.id = NEW.line;
  SELECT status INTO rx_status FROM "Prescription" WHERE id = NEW.prescription;
  IF refills IS NULL THEN RAISE EXCEPTION 'A dispense needs a prescription line' USING ERRCODE = 'check_violation'; END IF;
  IF rx_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'The prescription is not active and cannot be dispensed' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."refillNumber" > refills THEN RAISE EXCEPTION 'The prescription allows % refills; this would be refill %', refills, NEW."refillNumber" USING ERRCODE = 'check_violation'; END IF;
  IF NEW."dispensedAt" > expires THEN RAISE EXCEPTION 'The prescription line expired before this dispense' USING ERRCODE = 'check_violation'; END IF;
  IF sched <> 'none' AND (NEW.container IS NULL OR NEW."csLogEntry" IS NULL) THEN RAISE EXCEPTION 'A controlled dispense needs its container and its register entry' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Dispense_guard" BEFORE INSERT ON "Dispense" FOR EACH ROW EXECUTE FUNCTION vc_dispense_guard();
