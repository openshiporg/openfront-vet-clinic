-- ── Phase 5 guards: wellness plans, boarding, grooming, end of life ─────────────────
-- These hold whatever the application does. Only new tables are touched; nothing existing is altered.

-- History that can never be rewritten. Corrections are new rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EntitlementEntry', 'EntitlementGrant', 'EnrollmentConsent', 'DailyCareLog', 'CustodyEvent', 'GroomNote', 'DeathRecord'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ── Wellness plans ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "WellnessPlanVersion_number" ON "WellnessPlanVersion" ("plan", "versionNo");
ALTER TABLE "WellnessPlanVersion" ADD CONSTRAINT "WellnessPlanVersion_amounts" CHECK ("monthlyPriceMinor" >= 0 AND "termMonths" > 0 AND "otherServicesDiscountBps" BETWEEN 0 AND 10000);

-- A published version is frozen: price, term, what is included and the disclosure never change. It can only be retired.
CREATE OR REPLACE FUNCTION vc_plan_version_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN RAISE EXCEPTION 'A published plan version cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'draft' AND (
       NEW."monthlyPriceMinor" IS DISTINCT FROM OLD."monthlyPriceMinor" OR NEW."termMonths" IS DISTINCT FROM OLD."termMonths"
    OR NEW."entitlements"::text IS DISTINCT FROM OLD."entitlements"::text OR NEW."disclosure" IS DISTINCT FROM OLD."disclosure"
    OR NEW."otherServicesDiscountBps" IS DISTINCT FROM OLD."otherServicesDiscountBps" OR NEW."plan" IS DISTINCT FROM OLD."plan"
    OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo") THEN
    RAISE EXCEPTION 'A published plan version is frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "WellnessPlanVersion_frozen" BEFORE UPDATE OR DELETE ON "WellnessPlanVersion" FOR EACH ROW EXECUTE FUNCTION vc_plan_version_frozen();

-- One live enrolment per patient per plan.
CREATE UNIQUE INDEX "Enrollment_one_live_per_patient_plan" ON "Enrollment" ("patient", "plan") WHERE "status" IN ('pending_payment', 'active', 'cancelling', 'suspended');
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_amounts" CHECK ("trueUpMinor" >= 0 AND "termNo" >= 1 AND "termEndsOn" > "startedOn");
CREATE INDEX "Enrollment_status_location" ON "Enrollment" ("status", "location");

-- One charge per enrolment and period. A failed attempt is final for its key; the next try is a new generation, and
-- only while no other attempt for the period is still open or already paid.
ALTER TABLE "PlanBillingAttempt" ADD CONSTRAINT "PlanBillingAttempt_amount" CHECK ("amountMinor" > 0 AND "generation" >= 1);
CREATE UNIQUE INDEX "PlanBillingAttempt_generation" ON "PlanBillingAttempt" ("enrollment", "periodKey", "generation");
CREATE UNIQUE INDEX "PlanBillingAttempt_one_live_per_period" ON "PlanBillingAttempt" ("enrollment", "periodKey") WHERE "status" IN ('processing', 'unknown', 'succeeded');
CREATE UNIQUE INDEX "PlanBillingAttempt_one_payment" ON "PlanBillingAttempt" ("payment") WHERE "payment" IS NOT NULL;

-- Never start a charge for an enrolment that is cancelled, ended, completed or suspended, or for a patient who has died.
CREATE OR REPLACE FUNCTION vc_plan_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; dead timestamp;
BEGIN
  SELECT e."status", p."deceasedAt" INTO st, dead FROM "Enrollment" e LEFT JOIN "Patient" p ON p."id" = e."patient" WHERE e."id" = NEW."enrollment";
  IF st IS NULL OR st NOT IN ('pending_payment', 'active') OR dead IS NOT NULL THEN
    RAISE EXCEPTION 'This plan enrolment cannot be charged' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanBillingAttempt_guard" BEFORE INSERT ON "PlanBillingAttempt" FOR EACH ROW EXECUTE FUNCTION vc_plan_attempt_guard();

-- The entitlement ledger: a grant can never be used beyond what was granted, and a credit can never give back more than was used.
ALTER TABLE "EntitlementEntry" ADD CONSTRAINT "EntitlementEntry_qty" CHECK ("qty" > 0 AND "valueMinor" >= 0);
CREATE INDEX "EntitlementEntry_grant" ON "EntitlementEntry" ("grant");
CREATE UNIQUE INDEX "EntitlementGrant_term_code" ON "EntitlementGrant" ("enrollment", "termNo", "code");
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_qty" CHECK ("qtyGranted" >= 0 AND "retailValueMinor" >= 0);
CREATE OR REPLACE FUNCTION vc_entitlement_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE granted numeric; used numeric;
BEGIN
  SELECT "qtyGranted" INTO granted FROM "EntitlementGrant" WHERE "id" = NEW."grant" FOR UPDATE;
  SELECT COALESCE(SUM(CASE WHEN "kind" = 'debit' THEN "qty" ELSE -"qty" END), 0) INTO used FROM "EntitlementEntry" WHERE "grant" = NEW."grant";
  used := used + CASE WHEN NEW."kind" = 'debit' THEN NEW."qty" ELSE -NEW."qty" END;
  IF granted IS NULL OR used > granted OR used < 0 THEN
    RAISE EXCEPTION 'That would take the entitlement outside what was granted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EntitlementEntry_bounds" BEFORE INSERT ON "EntitlementEntry" FOR EACH ROW EXECUTE FUNCTION vc_entitlement_bounds();

-- ── Boarding ────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "NightlyRunInventory_night" ON "NightlyRunInventory" ("runType", "night");
ALTER TABLE "NightlyRunInventory" ADD CONSTRAINT "NightlyRunInventory_bounds" CHECK ("capacity" >= 0 AND COALESCE("sold", 0) >= 0 AND COALESCE("sold", 0) <= "capacity");
ALTER TABLE "RunType" ADD CONSTRAINT "RunType_amounts" CHECK ("nightlyRateMinor" >= 0 AND COALESCE("depositMinor", 0) >= 0);
ALTER TABLE "BoardingReservation" ADD CONSTRAINT "BoardingReservation_dates" CHECK ("checkOutOn" > "checkInOn" AND COALESCE("depositMinor", 0) >= 0);
CREATE INDEX "BoardingReservation_nights" ON "BoardingReservation" ("runType", "status", "checkInOn", "checkOutOn");
CREATE UNIQUE INDEX "BoardingReservation_one_open_per_patient_start" ON "BoardingReservation" ("patient", "checkInOn") WHERE "status" IN ('requested', 'confirmed', 'checked_in');
CREATE UNIQUE INDEX "BoardingStay_one_in_house" ON "BoardingStay" ("patient") WHERE "status" = 'in_house';
CREATE UNIQUE INDEX "BoardingStay_one_per_reservation" ON "BoardingStay" ("reservation");
ALTER TABLE "RunAssignment" ADD CONSTRAINT "RunAssignment_no_overlap" EXCLUDE USING gist ("run" WITH =, tsrange("startsAt", COALESCE("endsAt", 'infinity')) WITH &&);
ALTER TABLE "RunCard" ADD CONSTRAINT "RunCard_limit" CHECK (COALESCE("medicalLimitMinor", 0) >= 0);

-- ── Grooming ────────────────────────────────────────────────────────────────────
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_amounts" CHECK ("priceMinor" >= 0 AND "durationMinutes" > 0 AND COALESCE("commissionBps", 0) BETWEEN 0 AND 10000 AND COALESCE("commissionMinor", 0) >= 0);
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_no_overlap" EXCLUDE USING gist ("groomer" WITH =, tsrange("startsAt", "startsAt" + ("durationMinutes" * interval '1 minute')) WITH &&) WHERE ("status" NOT IN ('cancelled', 'no_show') AND "groomer" IS NOT NULL);
CREATE UNIQUE INDEX "GroomNote_number" ON "GroomNote" ("patient", "versionNo");

-- ── End of life ─────────────────────────────────────────────────────────────────
-- Every link in the chain names the tag on the animal, and nothing past "ordered" exists without one.
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_tag" CHECK (length(btrim("tagNumber")) > 0);
ALTER TABLE "AftercareOrder" ADD CONSTRAINT "AftercareOrder_tag" CHECK ("status" = 'ordered' OR length(btrim("tagNumber")) > 0);
CREATE UNIQUE INDEX "AftercareOrder_one_per_death" ON "AftercareOrder" ("deathRecord") WHERE "deathRecord" IS NOT NULL;
CREATE UNIQUE INDEX "DeathRecord_one_per_patient" ON "DeathRecord" ("patient");
CREATE UNIQUE INDEX "EuthanasiaConsent_one_live_per_patient" ON "EuthanasiaConsent" ("patient") WHERE "status" IN ('draft', 'signed');
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_signed" CHECK ("status" IN ('draft', 'revoked') OR ("signedAt" IS NOT NULL AND "aftercare" <> '' AND "biteAttestation" <> ''));
ALTER TABLE "MemorialItem" ADD CONSTRAINT "MemorialItem_price" CHECK ("priceMinor" >= 0);
