-- ── Phase 4 guards: money, estimates, fee schedules, insurance ───────────────────────────────
-- Invariants that hold whatever the application does. A correction is a new row, never an edit.
-- Messages say "never", "cannot", "needs" or "frozen" so they reach the caller as a plain sentence.

-- Append-only: the client ledger, payment allocations, acceptances, overage approvals, credit notes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ClientLedgerEntry', 'PaymentAllocation', 'EstimateAcceptance', 'OverageApproval', 'CreditNote'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ── Amounts ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_amount_nonzero" CHECK ("amountMinor" <> 0 AND "client" IS NOT NULL AND "period" IS NOT NULL);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_positive" CHECK ("amountMinor" > 0 AND ("invoice" IS NOT NULL OR "deposit" IS NOT NULL) AND NOT ("invoice" IS NOT NULL AND "deposit" IS NOT NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive" CHECK ("amountMinor" > 0 AND ("status" <> 'succeeded' OR "receivedAt" IS NOT NULL));
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_positive" CHECK ("requestedMinor" > 0 AND ("status" <> 'applied' OR ("appliedInvoice" IS NOT NULL AND "appliedAt" IS NOT NULL)));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0 AND "discountMinor" <= "subtotalMinor"
  AND ("status" = 'draft' OR ("postedAt" IS NOT NULL AND "postedOn" IS NOT NULL AND "period" IS NOT NULL AND "ref" <> '')));
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_amounts" CHECK ("qty" > 0 AND "unitPriceMinor" >= 0 AND "extendedMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "extendedMinor" AND "taxMinor" >= 0);
-- I-M1: a charge names its clinical source, or a manual charge gives a reason.
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_source_required" CHECK (("sourceType" = 'manual' AND "manualReason" <> '') OR ("sourceType" <> 'manual' AND "sourceId" <> ''));
CREATE UNIQUE INDEX "ChargeLine_one_live_per_source" ON "ChargeLine" ("sourceType", "sourceId") WHERE "reversedAt" IS NULL AND "sourceType" <> 'manual';
ALTER TABLE "EstimateOption" ADD CONSTRAINT "EstimateOption_range" CHECK ("lowTotalMinor" >= 0 AND "lowTotalMinor" <= "highTotalMinor");
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_range" CHECK ("qtyLow" >= 0 AND "qtyLow" <= "qtyHigh" AND "unitPriceMinor" >= 0 AND "lowMinor" >= 0 AND "lowMinor" <= "highMinor");
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_presented_has_hash" CHECK ("status" = 'draft' OR "quoteHash" <> '');
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_range" CHECK ("acceptedLowMinor" >= 0 AND "acceptedLowMinor" <= "acceptedHighMinor");
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_amounts" CHECK ("projectedMinor" >= 0 AND ("chargedMinor" IS NULL OR "chargedMinor" >= 0));
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_raises" CHECK ("newHighMinor" > "previousHighMinor" AND "reason" <> '');
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_price" CHECK ("priceMinor" >= 0 AND COALESCE("minimumChargeMinor", 0) >= 0 AND COALESCE("dispensingFeeMinor", 0) >= 0 AND COALESCE("injectionFeeMinor", 0) >= 0);
ALTER TABLE "PayerAuthorization" ADD CONSTRAINT "PayerAuthorization_amounts" CHECK ("requestedMinor" > 0 AND ("authorisedMinor" IS NULL OR ("authorisedMinor" >= 0 AND "authorisedMinor" <= "requestedMinor")));
ALTER TABLE "InsuranceClaimPacket" ADD CONSTRAINT "InsuranceClaimPacket_ready_has_hash" CHECK ("status" = 'draft' OR "packetSha256" <> '');

-- One accepted version per estimate, one acceptance per version, one plan per accepted version, one published fee schedule version.
CREATE UNIQUE INDEX "EstimateVersion_one_accepted" ON "EstimateVersion" ("estimate") WHERE "status" = 'accepted';
CREATE UNIQUE INDEX "EstimateVersion_number" ON "EstimateVersion" ("estimate", "versionNo");
CREATE UNIQUE INDEX "EstimateAcceptance_once" ON "EstimateAcceptance" ("estimateVersion");
CREATE UNIQUE INDEX "TreatmentPlan_one_per_version" ON "TreatmentPlan" ("estimateVersion");
CREATE UNIQUE INDEX "FeeScheduleVersion_one_published" ON "FeeScheduleVersion" ("schedule") WHERE "status" = 'published';
CREATE UNIQUE INDEX "FeeScheduleVersion_number" ON "FeeScheduleVersion" ("schedule", "versionNo");
-- A deposit is funded by exactly one allocation.
CREATE UNIQUE INDEX "PaymentAllocation_one_per_deposit" ON "PaymentAllocation" ("deposit") WHERE "deposit" IS NOT NULL;
ALTER TABLE "ArPeriod" ADD CONSTRAINT "ArPeriod_dates" CHECK ("startsOn" <= "endsOn");

-- ── The ledger takes entries only into an open period, on a day inside it ─────────────────────
CREATE OR REPLACE FUNCTION vc_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  SELECT status, "startsOn", "endsOn", label INTO p FROM "ArPeriod" WHERE id = NEW."period" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A ledger entry needs an accounting period' USING ERRCODE = 'check_violation'; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION '% is closed; a closed period never takes a back-dated posting', p.label USING ERRCODE = 'check_violation'; END IF;
  IF NEW."postedOn" < p."startsOn" OR NEW."postedOn" > p."endsOn" THEN RAISE EXCEPTION 'The posting day must fall inside its accounting period' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClientLedgerEntry_open_period" BEFORE INSERT ON "ClientLedgerEntry" FOR EACH ROW EXECUTE FUNCTION vc_ledger_guard();

-- An invoice never owes less than nothing. The invoice row is locked first, so two postings at once see each other.
CREATE OR REPLACE FUNCTION vc_ledger_invoice_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  IF NEW."invoice" IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM "Invoice" WHERE id = NEW."invoice" FOR UPDATE;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO s FROM "ClientLedgerEntry" WHERE "invoice" = NEW."invoice";
  IF s < 0 THEN RAISE EXCEPTION 'An invoice balance cannot go below zero' USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "ClientLedgerEntry_invoice_floor" AFTER INSERT ON "ClientLedgerEntry" FOR EACH ROW EXECUTE FUNCTION vc_ledger_invoice_floor();

-- ── Σ allocations ≤ payment, and only a payment that went through can be allocated ─────────────
CREATE OR REPLACE FUNCTION vc_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay record; spent bigint; cap bigint;
BEGIN
  SELECT "amountMinor", status, "payerAuthorization" INTO pay FROM "Payment" WHERE id = NEW."payment" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An allocation needs a payment' USING ERRCODE = 'check_violation'; END IF;
  IF pay.status <> 'succeeded' THEN RAISE EXCEPTION 'A payment that has not gone through cannot be allocated' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO spent FROM "PaymentAllocation" WHERE "payment" = NEW."payment";
  IF spent + NEW."amountMinor" > pay."amountMinor" THEN RAISE EXCEPTION 'Allocations cannot add up to more than the payment' USING ERRCODE = 'check_violation'; END IF;
  IF pay."payerAuthorization" IS NOT NULL THEN
    SELECT "authorisedMinor" INTO cap FROM "PayerAuthorization" WHERE id = pay."payerAuthorization";
    IF cap IS NULL OR spent + NEW."amountMinor" > cap THEN RAISE EXCEPTION 'An insurer payment cannot be allocated beyond what the insurer authorised' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PaymentAllocation_guard" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION vc_allocation_guard();

-- ── Payments: amount and owner never change; a result is final ────────────────────────────────
CREATE OR REPLACE FUNCTION vc_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."client" IS DISTINCT FROM OLD."client" OR NEW.method <> OLD.method OR NEW."currencyCode" <> OLD."currencyCode" THEN
    RAISE EXCEPTION 'A payment amount, owner and method are frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'voided') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'A payment that has a result never changes it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_guard" BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION vc_payment_guard();
CREATE OR REPLACE FUNCTION vc_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Payment', 'PaymentAttempt', 'Refund', 'PaymentWebhookEvent', 'ChargeLine', 'Deposit', 'TreatmentPlan', 'TreatmentPlanItem', 'ArPeriod', 'Estimate', 'EstimateVersion', 'FeeScheduleVersion', 'PayerAuthorization', 'InsuranceClaimPacket'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_no_delete()', t || '_no_delete', t);
  END LOOP;
END $$;

-- ── Σ refunds ≤ the payment ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vc_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay record; spent bigint;
BEGIN
  SELECT "amountMinor", status INTO pay FROM "Payment" WHERE id = NEW."payment" FOR UPDATE;
  IF NOT FOUND OR pay.status <> 'succeeded' THEN RAISE EXCEPTION 'Only a payment that went through can be refunded' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."amountMinor" <> OLD."amountMinor" OR NEW."payment" <> OLD."payment") THEN RAISE EXCEPTION 'A refund amount is frozen' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('succeeded', 'failed', 'rejected') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'A refund that has a result never changes it' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status IN ('requested', 'approved', 'processing', 'succeeded', 'unknown') THEN
    SELECT COALESCE(SUM("amountMinor"), 0) INTO spent FROM "Refund"
      WHERE "payment" = NEW."payment" AND id <> NEW.id AND status IN ('requested', 'approved', 'processing', 'succeeded', 'unknown');
    IF spent + NEW."amountMinor" > pay."amountMinor" THEN RAISE EXCEPTION 'Refunds cannot add up to more than the payment' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Refund_guard" BEFORE INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION vc_refund_guard();

-- ── Invoices: once posted, the money on them is frozen ────────────────────────────────────────
CREATE OR REPLACE FUNCTION vc_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'A posted invoice never goes back to draft' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.status = 'written_off' AND NEW.status <> 'written_off' THEN RAISE EXCEPTION 'A written-off invoice never reopens' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.ref <> OLD.ref OR NEW."client" IS DISTINCT FROM OLD."client" OR NEW."subtotalMinor" <> OLD."subtotalMinor" OR NEW."discountMinor" <> OLD."discountMinor"
       OR NEW."taxMinor" <> OLD."taxMinor" OR NEW."totalMinor" <> OLD."totalMinor" OR NEW."postedOn" IS DISTINCT FROM OLD."postedOn" OR NEW."period" IS DISTINCT FROM OLD."period"
       OR NEW."currencyCode" <> OLD."currencyCode" THEN
      RAISE EXCEPTION 'A posted invoice is frozen; correct it with a credit note' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Invoice_guard" BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION vc_invoice_guard();
CREATE OR REPLACE FUNCTION vc_invoice_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'A posted invoice is never deleted' USING ERRCODE = 'check_violation'; END IF; RETURN OLD; END $$;
CREATE TRIGGER "Invoice_delete_guard" BEFORE DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION vc_invoice_delete();

CREATE OR REPLACE FUNCTION vc_chargeline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."invoice" IS NOT NULL THEN
      SELECT status INTO inv FROM "Invoice" WHERE id = NEW."invoice";
      IF inv <> 'draft' THEN RAISE EXCEPTION 'Lines on a posted invoice are frozen' USING ERRCODE = 'check_violation'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."invoice" IS NOT NULL THEN
    SELECT status INTO inv FROM "Invoice" WHERE id = OLD."invoice";
    IF inv <> 'draft' THEN RAISE EXCEPTION 'Lines on a posted invoice are frozen' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  IF NEW."sourceType" <> OLD."sourceType" OR NEW."sourceId" <> OLD."sourceId" OR NEW."extendedMinor" <> OLD."extendedMinor" OR NEW."client" IS DISTINCT FROM OLD."client" THEN
    RAISE EXCEPTION 'A charge never changes what it was for or its price' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ChargeLine_guard" BEFORE INSERT OR UPDATE ON "ChargeLine" FOR EACH ROW EXECUTE FUNCTION vc_chargeline_guard();

-- ── Estimates: a presented version, its options and its lines never change ─────────────────────
CREATE OR REPLACE FUNCTION vc_estimate_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW."quoteHash" <> OLD."quoteHash" OR NEW."estimate" IS DISTINCT FROM OLD."estimate" OR NEW."versionNo" <> OLD."versionNo"
       OR NEW."feeScheduleVersion" IS DISTINCT FROM OLD."feeScheduleVersion" OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil" OR NEW."presentedAt" IS DISTINCT FROM OLD."presentedAt" THEN
      RAISE EXCEPTION 'A presented estimate is frozen; make a new version' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('declined', 'expired', 'superseded') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'This estimate version is closed' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.status = 'accepted' AND NEW.status NOT IN ('accepted', 'superseded') THEN RAISE EXCEPTION 'An accepted estimate cannot be reopened' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EstimateVersion_guard" BEFORE UPDATE ON "EstimateVersion" FOR EACH ROW EXECUTE FUNCTION vc_estimate_version_guard();

CREATE OR REPLACE FUNCTION vc_estimate_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; opt text;
BEGIN
  IF TG_TABLE_NAME = 'EstimateOption' THEN
    SELECT status INTO st FROM "EstimateVersion" WHERE id = COALESCE(NEW."estimateVersion", OLD."estimateVersion");
  ELSE
    opt := COALESCE(NEW."option", OLD."option");
    SELECT v.status INTO st FROM "EstimateOption" o JOIN "EstimateVersion" v ON v.id = o."estimateVersion" WHERE o.id = opt;
  END IF;
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'A presented estimate is frozen; make a new version' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "EstimateOption_guard" BEFORE INSERT OR UPDATE OR DELETE ON "EstimateOption" FOR EACH ROW EXECUTE FUNCTION vc_estimate_children_guard();
CREATE TRIGGER "EstimateLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "EstimateLine" FOR EACH ROW EXECUTE FUNCTION vc_estimate_children_guard();

-- ── The overage gate: what a plan has used never passes the ceiling the client accepted ───────
CREATE OR REPLACE FUNCTION vc_plan_item_ceiling() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE high bigint; used bigint;
BEGIN
  IF NEW.status NOT IN ('ordered', 'done') THEN RETURN NEW; END IF;
  SELECT "acceptedHighMinor" INTO high FROM "TreatmentPlan" WHERE id = NEW."plan" FOR UPDATE;
  SELECT COALESCE(SUM(COALESCE("chargedMinor", "projectedMinor")), 0) INTO used FROM "TreatmentPlanItem"
    WHERE "plan" = NEW."plan" AND id <> NEW.id AND status IN ('ordered', 'done');
  IF used + COALESCE(NEW."chargedMinor", NEW."projectedMinor") > high THEN
    RAISE EXCEPTION 'This would pass the ceiling the client accepted; get an overage approval first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreatmentPlanItem_ceiling" BEFORE INSERT OR UPDATE ON "TreatmentPlanItem" FOR EACH ROW EXECUTE FUNCTION vc_plan_item_ceiling();

-- The ceiling goes up only with a recorded approval for that exact figure.
CREATE OR REPLACE FUNCTION vc_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."acceptedHighMinor" < OLD."acceptedHighMinor" OR NEW."acceptedLowMinor" <> OLD."acceptedLowMinor" THEN
    RAISE EXCEPTION 'What the client accepted never goes down' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."acceptedHighMinor" > OLD."acceptedHighMinor" AND NOT EXISTS (SELECT 1 FROM "OverageApproval" WHERE "plan" = NEW.id AND "newHighMinor" = NEW."acceptedHighMinor") THEN
    RAISE EXCEPTION 'The accepted ceiling goes up only with a recorded approval' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreatmentPlan_guard" BEFORE UPDATE ON "TreatmentPlan" FOR EACH ROW EXECUTE FUNCTION vc_plan_guard();

-- ── Deposits: a result is final ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vc_deposit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestedMinor" <> OLD."requestedMinor" OR NEW."client" IS DISTINCT FROM OLD."client" THEN RAISE EXCEPTION 'A deposit amount is frozen' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('applied', 'refunded', 'forfeited') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'A deposit that was applied, refunded or forfeited never changes' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'applied' AND NEW."appliedInvoice" IS DISTINCT FROM OLD."appliedInvoice" THEN RAISE EXCEPTION 'A deposit is applied once, to one invoice' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Deposit_guard" BEFORE UPDATE ON "Deposit" FOR EACH ROW EXECUTE FUNCTION vc_deposit_guard();

-- ── Fee schedules: a published version is frozen; one is replaced by a new version ─────────────
CREATE OR REPLACE FUNCTION vc_fee_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') THEN
    IF NEW.status = 'draft' OR NEW.status = 'pending_approval' OR (OLD.status = 'retired' AND NEW.status <> 'retired') OR NEW."versionNo" <> OLD."versionNo" OR NEW."schedule" IS DISTINCT FROM OLD."schedule"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
      RAISE EXCEPTION 'A published fee schedule is frozen; make a new version' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FeeScheduleVersion_guard" BEFORE UPDATE ON "FeeScheduleVersion" FOR EACH ROW EXECUTE FUNCTION vc_fee_version_guard();
CREATE OR REPLACE FUNCTION vc_fee_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "FeeScheduleVersion" WHERE id = COALESCE(NEW."version", OLD."version");
  IF st IS NOT NULL AND st IN ('published', 'retired') THEN RAISE EXCEPTION 'A published fee schedule is frozen; make a new version' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "FeeItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FeeItem" FOR EACH ROW EXECUTE FUNCTION vc_fee_children_guard();
CREATE TRIGGER "PriceRule_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PriceRule" FOR EACH ROW EXECUTE FUNCTION vc_fee_children_guard();

-- ── A claim packet holds only documents that were released ─────────────────────────────────────
CREATE OR REPLACE FUNCTION vc_claim_packet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_array_length(NEW.documents) > 0 THEN
    IF NEW."recordsRelease" IS NULL THEN RAISE EXCEPTION 'A claim packet holds documents only from a records release' USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.documents) d
      WHERE NOT EXISTS (
        SELECT 1 FROM "RecordsRelease" r, jsonb_array_elements(r.documents) rd
        WHERE r.id = NEW."recordsRelease" AND rd->>'documentId' = d->>'documentId' AND rd->>'sha256' = d->>'sha256')
    ) THEN
      RAISE EXCEPTION 'A claim packet contains only documents that were released' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InsuranceClaimPacket_guard" BEFORE INSERT OR UPDATE ON "InsuranceClaimPacket" FOR EACH ROW EXECUTE FUNCTION vc_claim_packet_guard();
