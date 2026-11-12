-- Plain-sentence messages for the guards that did not carry a keyword the command layer turns into a readable error.

CREATE OR REPLACE FUNCTION vc_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay record; spent bigint;
BEGIN
  SELECT "amountMinor", status INTO pay FROM "Payment" WHERE id = NEW."payment" FOR UPDATE;
  IF NOT FOUND OR pay.status <> 'succeeded' THEN RAISE EXCEPTION 'A refund needs a payment that went through' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."amountMinor" <> OLD."amountMinor" OR NEW."payment" <> OLD."payment") THEN RAISE EXCEPTION 'A refund amount is frozen' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('succeeded', 'failed', 'rejected') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'A refund that has a result never changes it' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status IN ('requested', 'approved', 'processing', 'succeeded', 'unknown') THEN
    SELECT COALESCE(SUM("amountMinor"), 0) INTO spent FROM "Refund"
      WHERE "payment" = NEW."payment" AND id <> NEW.id AND status IN ('requested', 'approved', 'processing', 'succeeded', 'unknown');
    IF spent + NEW."amountMinor" > pay."amountMinor" THEN RAISE EXCEPTION 'Refunds cannot add up to more than the payment' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vc_estimate_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW."quoteHash" <> OLD."quoteHash" OR NEW."estimate" IS DISTINCT FROM OLD."estimate" OR NEW."versionNo" <> OLD."versionNo"
       OR NEW."feeScheduleVersion" IS DISTINCT FROM OLD."feeScheduleVersion" OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil" OR NEW."presentedAt" IS DISTINCT FROM OLD."presentedAt" THEN
      RAISE EXCEPTION 'A presented estimate is frozen; make a new version' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('declined', 'expired', 'superseded') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'This estimate version is closed and never reopens' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.status = 'accepted' AND NEW.status NOT IN ('accepted', 'superseded') THEN RAISE EXCEPTION 'An accepted estimate cannot be reopened' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vc_plan_item_ceiling() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE high bigint; used bigint;
BEGIN
  IF NEW.status NOT IN ('ordered', 'done') THEN RETURN NEW; END IF;
  SELECT "acceptedHighMinor" INTO high FROM "TreatmentPlan" WHERE id = NEW."plan" FOR UPDATE;
  SELECT COALESCE(SUM(COALESCE("chargedMinor", "projectedMinor")), 0) INTO used FROM "TreatmentPlanItem"
    WHERE "plan" = NEW."plan" AND id <> NEW.id AND status IN ('ordered', 'done');
  IF used + COALESCE(NEW."chargedMinor", NEW."projectedMinor") > high THEN
    RAISE EXCEPTION 'Going past the ceiling the client accepted needs an overage approval first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vc_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."acceptedHighMinor" < OLD."acceptedHighMinor" OR NEW."acceptedLowMinor" <> OLD."acceptedLowMinor" THEN
    RAISE EXCEPTION 'What the client accepted never goes down' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."acceptedHighMinor" > OLD."acceptedHighMinor" AND NOT EXISTS (SELECT 1 FROM "OverageApproval" WHERE "plan" = NEW.id AND "newHighMinor" = NEW."acceptedHighMinor") THEN
    RAISE EXCEPTION 'The accepted ceiling needs a recorded approval to go up' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vc_deposit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestedMinor" <> OLD."requestedMinor" OR NEW."client" IS DISTINCT FROM OLD."client" THEN RAISE EXCEPTION 'A deposit amount is frozen' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('applied', 'refunded', 'forfeited') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'A deposit that was applied, refunded or forfeited never changes' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'applied' AND NEW."appliedInvoice" IS DISTINCT FROM OLD."appliedInvoice" THEN RAISE EXCEPTION 'A deposit never applies twice or to another invoice' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vc_claim_packet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_array_length(NEW.documents) > 0 THEN
    IF NEW."recordsRelease" IS NULL THEN RAISE EXCEPTION 'A claim packet needs a records release for its documents' USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.documents) d
      WHERE NOT EXISTS (
        SELECT 1 FROM "RecordsRelease" r, jsonb_array_elements(r.documents) rd
        WHERE r.id = NEW."recordsRelease" AND rd->>'documentId' = d->>'documentId' AND rd->>'sha256' = d->>'sha256')
    ) THEN
      RAISE EXCEPTION 'A claim packet must contain only documents that were released' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- A processor event is kept once, by its own id.
CREATE UNIQUE INDEX "PaymentWebhookEvent_once" ON "PaymentWebhookEvent" ("provider", "eventId");
