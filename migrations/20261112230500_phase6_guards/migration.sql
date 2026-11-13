-- Phase 6 guards: append-only triggers, state-order triggers and unique indexes on the Phase 6 tables.
-- On an existing table this adds only one INSERT trigger on "RecordsRelease" (vc_release_guard). No existing table is altered
-- (RecordsRelease already carries its append-only triggers) and no existing row is changed.

-- Append-only: results, their values, reviews, imaging reports, production credits, commissions, payroll files.
-- ProductionCredit and Commission may only have their pay period filled in once, from empty (a late fact is assigned to a later period).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LabResult', 'LabResultValue', 'ResultReview', 'ImagingReport', 'PayrollExportBatch'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION vc_pay_line_assign() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ps text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END IF;
  IF OLD."period" IS NOT NULL OR NEW."period" IS NULL THEN RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END IF;
  IF (to_jsonb(NEW) - 'period' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'period' - 'updatedAt') THEN
    RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  SELECT "status" INTO ps FROM "PayPeriod" WHERE id = NEW."period";
  IF ps IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Only an open pay period can take new lines' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionCredit_assign" BEFORE UPDATE OR DELETE ON "ProductionCredit" FOR EACH ROW EXECUTE FUNCTION vc_pay_line_assign();
CREATE TRIGGER "ProductionCredit_no_truncate" BEFORE TRUNCATE ON "ProductionCredit" FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change();
CREATE TRIGGER "Commission_assign" BEFORE UPDATE OR DELETE ON "Commission" FOR EACH ROW EXECUTE FUNCTION vc_pay_line_assign();
CREATE TRIGGER "Commission_no_truncate" BEFORE TRUNCATE ON "Commission" FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change();

-- A release needs an approved request and a packet hash.
CREATE OR REPLACE FUNCTION vc_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "RecordsRequest" WHERE id = NEW."request";
  IF st IS NULL OR st NOT IN ('approved', 'released') THEN RAISE EXCEPTION 'Records are released only for an approved request' USING ERRCODE = 'check_violation'; END IF;
  IF length(NEW."packetHash") = 0 THEN RAISE EXCEPTION 'A release must carry the hash of what was sent' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RecordsRelease_guard" BEFORE INSERT ON "RecordsRelease" FOR EACH ROW EXECUTE FUNCTION vc_release_guard();

-- Lab: one accession per lab; a result is replaced at most once and only by one for the same order; values carry something.
CREATE UNIQUE INDEX "LabOrder_accession" ON "LabOrder" ("lab", "accessionId") WHERE "accessionId" IS NOT NULL;
CREATE UNIQUE INDEX "LabResult_superseded_once" ON "LabResult" ("supersedes") WHERE "supersedes" IS NOT NULL;
CREATE UNIQUE INDEX "LabResult_observation_once" ON "LabResult" ("observation") WHERE "observation" IS NOT NULL;
CREATE UNIQUE INDEX "LabTest_lab_code" ON "LabTest" ("lab", "code");
CREATE UNIQUE INDEX "LabAnalyteMap_lab_code" ON "LabAnalyteMap" ("lab", "externalCode");
CREATE UNIQUE INDEX "ReferenceRange_key" ON "ReferenceRange" ("analyte", "species", "ageClass", COALESCE("lab", ''));
CREATE UNIQUE INDEX "ResultReview_one_of_kind" ON "ResultReview" ("result", "kind");
ALTER TABLE "ReferenceRange" ADD CONSTRAINT "ReferenceRange_order" CHECK ("low" IS NULL OR "high" IS NULL OR "low" <= "high");
ALTER TABLE "LabResultValue" ADD CONSTRAINT "LabResultValue_has_value" CHECK ("valueNumeric" IS NOT NULL OR length("valueText") > 0);

CREATE OR REPLACE FUNCTION vc_lab_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o text; ost text; prev record;
BEGIN
  SELECT "status" INTO ost FROM "LabOrder" WHERE id = NEW."labOrder";
  IF ost IS NULL OR ost IN ('ordered', 'specimen_collected', 'cancelled') THEN RAISE EXCEPTION 'A result needs an order that has been sent to the lab' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."supersedes" IS NOT NULL THEN
    SELECT "labOrder", "status" INTO prev FROM "LabResult" WHERE id = NEW."supersedes";
    IF prev."labOrder" IS DISTINCT FROM NEW."labOrder" THEN RAISE EXCEPTION 'A correction must replace a result of the same order' USING ERRCODE = 'check_violation'; END IF;
    IF NEW."status" <> 'corrected' THEN RAISE EXCEPTION 'A result that replaces another is a correction' USING ERRCODE = 'check_violation'; END IF;
  ELSIF NEW."status" = 'corrected' THEN
    RAISE EXCEPTION 'A correction must say which result it replaces' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LabResult_guard" BEFORE INSERT ON "LabResult" FOR EACH ROW EXECUTE FUNCTION vc_lab_result_guard();

-- A communication review only follows an interpretation of the same result.
CREATE OR REPLACE FUNCTION vc_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" = 'communication' AND NOT EXISTS (SELECT 1 FROM "ResultReview" WHERE "result" = NEW."result" AND "kind" = 'interpretation') THEN
    RAISE EXCEPTION 'A result is communicated only after the doctor has read it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'interpretation' AND length(btrim(NEW."interpretation")) = 0 THEN
    RAISE EXCEPTION 'The interpretation cannot be empty' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ResultReview_guard" BEFORE INSERT ON "ResultReview" FOR EACH ROW EXECUTE FUNCTION vc_review_guard();

-- Lab order status only moves forward along the machine.
CREATE OR REPLACE FUNCTION vc_lab_order_flow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  ok := CASE OLD."status"
    WHEN 'ordered' THEN NEW."status" IN ('specimen_collected', 'cancelled')
    WHEN 'specimen_collected' THEN NEW."status" IN ('sent', 'final', 'cancelled')
    WHEN 'sent' THEN NEW."status" IN ('partial', 'final')
    WHEN 'partial' THEN NEW."status" IN ('partial', 'final')
    WHEN 'final' THEN NEW."status" IN ('reviewed', 'corrected')
    WHEN 'corrected' THEN NEW."status" IN ('reviewed', 'corrected')
    WHEN 'reviewed' THEN NEW."status" IN ('communicated', 'corrected')
    WHEN 'communicated' THEN NEW."status" IN ('corrected')
    ELSE false END;
  IF NOT ok THEN RAISE EXCEPTION 'A lab order cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LabOrder_flow" BEFORE UPDATE ON "LabOrder" FOR EACH ROW EXECUTE FUNCTION vc_lab_order_flow();

-- Production and pay.
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_bps" CHECK ("bps" BETWEEN 0 AND 10000);
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_bps" CHECK ("bps" BETWEEN 0 AND 10000);
-- A credit follows a charge line; an adjustment names the credit it adjusts, a reason, a requester and a different approver.
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_kind_shape" CHECK (
  ("kind" = 'credit' AND "adjusts" IS NULL AND "chargeLine" IS NOT NULL)
  OR ("kind" = 'adjustment' AND "adjusts" IS NOT NULL AND length("reason") > 0 AND "requestedBy" IS NOT NULL AND "approvedBy" IS NOT NULL AND "requestedBy" <> "approvedBy"));
-- One credit per charge line, staff member and rule version.
CREATE UNIQUE INDEX "ProductionCredit_line_once" ON "ProductionCredit" ("chargeLine", "staff", "ruleVersion") WHERE "kind" = 'credit';
CREATE UNIQUE INDEX "Commission_line_once" ON "Commission" ("chargeLine", "staff", "ruleVersion");
-- Separation of duties: nobody approves an adjustment to their own production.
CREATE OR REPLACE FUNCTION vc_adjustment_sod() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE su text;
BEGIN
  IF NEW."kind" = 'adjustment' THEN
    SELECT "user" INTO su FROM "StaffMember" WHERE id = NEW."staff";
    IF su IS NOT NULL AND (su = NEW."approvedBy" OR su = NEW."requestedBy") THEN
      RAISE EXCEPTION 'A doctor cannot request or approve an adjustment to their own production' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionCredit_sod" BEFORE INSERT ON "ProductionCredit" FOR EACH ROW EXECUTE FUNCTION vc_adjustment_sod();

-- Rule versions are frozen once published; they can only be retired.
CREATE OR REPLACE FUNCTION vc_rule_version_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN RAISE EXCEPTION 'A published production rule version cannot be removed' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'draft' AND (NEW."rules"::text IS DISTINCT FROM OLD."rules"::text OR NEW."commissionRules"::text IS DISTINCT FROM OLD."commissionRules"::text
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo" OR NEW."ruleHash" IS DISTINCT FROM OLD."ruleHash") THEN
    RAISE EXCEPTION 'A published production rule version is frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'retired' AND NEW."status" <> 'retired' THEN RAISE EXCEPTION 'A retired rule version stays retired' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionRuleVersion_frozen" BEFORE UPDATE OR DELETE ON "ProductionRuleVersion" FOR EACH ROW EXECUTE FUNCTION vc_rule_version_frozen();
CREATE UNIQUE INDEX "ProductionRuleVersion_number" ON "ProductionRuleVersion" ("versionNo");

-- Pay periods: one step forward at a time, never overlapping, nothing changes once exported.
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_dates" CHECK ("startsOn" <= "endsOn");
CREATE OR REPLACE FUNCTION vc_pay_period_flow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'open' THEN RAISE EXCEPTION 'A pay period past open cannot be removed' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "PayPeriod" WHERE "startsOn" <= NEW."endsOn" AND "endsOn" >= NEW."startsOn") THEN
      RAISE EXCEPTION 'Pay periods cannot overlap' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" <> 'open' THEN RAISE EXCEPTION 'A pay period starts open' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."startsOn" IS DISTINCT FROM OLD."startsOn" OR NEW."endsOn" IS DISTINCT FROM OLD."endsOn" THEN
    RAISE EXCEPTION 'The dates of a pay period never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('approved', 'exported', 'locked') AND NEW."totals"::text IS DISTINCT FROM OLD."totals"::text THEN
    RAISE EXCEPTION 'Approved pay totals are frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> OLD."status" THEN
    ok := CASE OLD."status"
      WHEN 'open' THEN NEW."status" = 'calculated'
      WHEN 'calculated' THEN NEW."status" IN ('calculated', 'approved', 'open')
      WHEN 'approved' THEN NEW."status" = 'exported'
      WHEN 'exported' THEN NEW."status" = 'locked'
      ELSE false END;
    IF NOT ok THEN RAISE EXCEPTION 'A pay period cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation'; END IF;
    IF NEW."status" = 'approved' AND NEW."approvedBy" IS NULL THEN RAISE EXCEPTION 'A pay period is approved by a named person' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PayPeriod_flow" BEFORE INSERT OR UPDATE OR DELETE ON "PayPeriod" FOR EACH ROW EXECUTE FUNCTION vc_pay_period_flow();

-- A payroll file is made once per period.
CREATE UNIQUE INDEX "PayrollExportBatch_one_per_period" ON "PayrollExportBatch" ("period");

-- Campaigns never send by voice in this version.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_no_outbound_voice" CHECK ("outboundVoice" = false);
