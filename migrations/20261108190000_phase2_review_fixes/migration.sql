-- AlterTable
ALTER TABLE "CsLogEntry" ADD COLUMN     "witness" TEXT;

-- AlterTable
ALTER TABLE "RabiesCertificate" ADD COLUMN     "voidReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VaccineAdministration" ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reverses" TEXT;

-- CreateIndex
CREATE INDEX "CsLogEntry_witness_idx" ON "CsLogEntry"("witness");

-- CreateIndex
CREATE INDEX "VaccineAdministration_reverses_idx" ON "VaccineAdministration"("reverses");

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_reverses_fkey" FOREIGN KEY ("reverses") REFERENCES "VaccineAdministration"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════════════════
-- Phase 2 review fixes (REVIEW.md "Invariants that should move into the database", B2–B4, M2–M3)
-- Every predicate was run against live data first. Rows that already break a rule and are
-- themselves append-only clinical history are not rewritten: the constraint is added NOT VALID,
-- which still refuses every new or changed row.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Witnesses (B2) ───────────────────────────────────────────────────────────────────
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_witness_not_giver" CHECK (witness IS NULL OR witness <> "givenBy");
-- A waste, and any Schedule II administer, names a witness who is not the person recording it.
-- NOT VALID: CS-2026-000004/7/9 were written before the register had a witness column (the
-- witness of CS-000007/9 is on their Administration rows); the register is append-only.
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_witness_required" CHECK (
  NOT (type = 'waste' OR (type = 'administer' AND "ciiRef" IS NOT NULL)) OR witness IS NOT NULL) NOT VALID;
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_witness_not_actor" CHECK (witness IS NULL OR witness <> actor);

-- ── 2. Anaesthesia event order (B4) ─────────────────────────────────────────────────────
-- Induction ≤ intubation ≤ extubation ≤ end of recovery; intubation and extubation need induction;
-- extubation needs intubation. NOT VALID: ANE-2026-000001 (closed) was extubated with no intubation
-- recorded before this rule existed; its times are evidence and are not rewritten.
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_event_order" CHECK (
  ("intubatedAt" IS NULL OR ("inductionAt" IS NOT NULL AND "inductionAt" <= "intubatedAt"))
  AND ("extubatedAt" IS NULL OR ("intubatedAt" IS NOT NULL AND "intubatedAt" <= "extubatedAt"))
  AND ("recoveryEndAt" IS NULL OR "extubatedAt" IS NULL OR "extubatedAt" <= "recoveryEndAt")) NOT VALID;

-- An event time, once recorded, is never overwritten or cleared.
CREATE OR REPLACE FUNCTION vc_anaesthesia_times_set_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."inductionAt" IS NOT NULL AND NEW."inductionAt" IS DISTINCT FROM OLD."inductionAt")
     OR (OLD."intubatedAt" IS NOT NULL AND NEW."intubatedAt" IS DISTINCT FROM OLD."intubatedAt")
     OR (OLD."extubatedAt" IS NOT NULL AND NEW."extubatedAt" IS DISTINCT FROM OLD."extubatedAt")
     OR (OLD."recoveryEndAt" IS NOT NULL AND NEW."recoveryEndAt" IS DISTINCT FROM OLD."recoveryEndAt") THEN
    RAISE EXCEPTION 'An anaesthesia event time is never overwritten once recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AnaesthesiaRecord_times_set_once" BEFORE UPDATE ON "AnaesthesiaRecord" FOR EACH ROW EXECUTE FUNCTION vc_anaesthesia_times_set_once();

-- ── 3. Rows of a signed record are frozen (M2) ──────────────────────────────────────────
-- Any insert, update or delete of a child of a signed encounter is refused. Exceptions, by column:
-- the rendered-document link (RabiesCertificate.document) and voiding a certificate (voidedAt/voidReason);
-- signing itself moves draft surgery reports to signed in the same transaction, before the status flips.
CREATE OR REPLACE FUNCTION refuse_if_encounter_signed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enc_id text; enc_status text; enc_ref text; allowed text[];
BEGIN
  IF TG_TABLE_NAME = 'RabiesCertificate' THEN
    -- A certificate belongs to the encounter of the vaccine that issued it.
    SELECT va.encounter INTO enc_id FROM "VaccineAdministration" va WHERE va.certificate = COALESCE(NEW.id, OLD.id) LIMIT 1;
  ELSIF TG_OP = 'DELETE' THEN
    enc_id := OLD.encounter;
  ELSE
    enc_id := NEW.encounter;
  END IF;
  IF enc_id IS NULL AND TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'RabiesCertificate' THEN enc_id := OLD.encounter; END IF;
  IF enc_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, ref INTO enc_status, enc_ref FROM "Encounter" WHERE id = enc_id;
  IF enc_status IS DISTINCT FROM 'signed' THEN
    -- Moving a row onto another encounter must not escape the check either.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'RabiesCertificate' AND OLD.encounter IS DISTINCT FROM NEW.encounter AND OLD.encounter IS NOT NULL
       AND (SELECT status FROM "Encounter" WHERE id = OLD.encounter) = 'signed' THEN
      RAISE EXCEPTION 'This entry belongs to a signed record and cannot be moved' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    allowed := CASE TG_TABLE_NAME WHEN 'RabiesCertificate' THEN ARRAY['document', 'voidedAt', 'voidReason', 'updatedAt'] ELSE ARRAY[]::text[] END;
    IF (to_jsonb(NEW) - allowed) = (to_jsonb(OLD) - allowed) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION '% is signed; this entry cannot change (add an addendum instead)', enc_ref USING ERRCODE = 'check_violation';
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Diagnosis', 'PhysicalExamFinding', 'VitalsObservation', 'DentalChart', 'SurgeryReport', 'RabiesCertificate'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION refuse_if_encounter_signed()', t || '_signed_frozen', t);
  END LOOP;
END $$;
-- SoapSection already refuses UPDATE/DELETE of a locked section; a new section on a signed record is refused too.
CREATE TRIGGER "SoapSection_signed_no_insert" BEFORE INSERT ON "SoapSection" FOR EACH ROW EXECUTE FUNCTION refuse_if_encounter_signed();

-- ── 4. Rabies tags and same-day repeat doses (M3) ───────────────────────────────────────
CREATE UNIQUE INDEX "RabiesCertificate_tag_unique" ON "RabiesCertificate" ("tagJurisdiction", "tagNumber") WHERE "tagNumber" <> '' AND "voidedAt" IS NULL;
ALTER TABLE "RabiesCertificate" ADD CONSTRAINT "RabiesCertificate_void_reason" CHECK ("voidedAt" IS NULL OR length("voidReason") > 0);
-- A reversal row names its dose and a reason; only reversal rows may point at another dose.
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_reversal" CHECK ((source = 'reversal') = (reverses IS NOT NULL) AND (reverses IS NULL OR length(reason) > 0));
CREATE UNIQUE INDEX "VaccineAdministration_reversed_once" ON "VaccineAdministration" (reverses) WHERE reverses IS NOT NULL;
CREATE UNIQUE INDEX "Administration_reversed_once" ON "Administration" (reverses) WHERE reverses IS NOT NULL;
-- One dose of a product per patient per day (a second same-day dose is a duplicate; reverse the first).
-- Rosie has two same-day rabies doses from the review (RAB-2026-000001/2); the second is reversed
-- by the review-fix data correction, which the trigger counts, so the rule is a trigger, not an index.
CREATE OR REPLACE FUNCTION vc_vaccine_one_per_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'reversal' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('vaccine-day:' || NEW.patient || ':' || NEW.product));
  IF EXISTS (
    SELECT 1 FROM "VaccineAdministration" v
     WHERE v.patient = NEW.patient AND v.product = NEW.product AND v."administeredOn" = NEW."administeredOn"
       AND v.source <> 'reversal' AND v.id <> NEW.id
       AND NOT EXISTS (SELECT 1 FROM "VaccineAdministration" r WHERE r.reverses = v.id)) THEN
    RAISE EXCEPTION 'This vaccine was already given to the patient that day; reverse that dose first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "VaccineAdministration_one_per_day" BEFORE INSERT ON "VaccineAdministration" FOR EACH ROW EXECUTE FUNCTION vc_vaccine_one_per_day();

-- ── 5. Dental chart (one per encounter; teeth are Triadan keys → {findings[], procedures[]}) ──
CREATE UNIQUE INDEX "DentalChart_one_per_encounter" ON "DentalChart" (encounter) WHERE encounter IS NOT NULL;
CREATE OR REPLACE FUNCTION vc_dental_teeth_valid(teeth jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT teeth IS NULL OR (jsonb_typeof(teeth) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(teeth) e
     WHERE e.key !~ '^[1-8](0[1-9]|1[0-1])$'
        OR jsonb_typeof(e.value) <> 'object'
        OR (e.value ? 'findings' AND jsonb_typeof(e.value -> 'findings') <> 'array')
        OR (e.value ? 'procedures' AND jsonb_typeof(e.value -> 'procedures') <> 'array')))
$$;
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_teeth_shape" CHECK (vc_dental_teeth_valid(teeth::jsonb));

-- ── 6. Treatment tasks: no second dose inside the frequency interval (B3) ───────────────
-- A task is refused as done when another done task of the same sheet order was done less than half
-- the frequency interval earlier or later (q24h → 12 h, q4h → 2 h). The application locks the sheet
-- order row before completing a task; the trigger takes the same lock, so two completions serialise.
CREATE OR REPLACE FUNCTION vc_treatment_task_interval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE freq text; hours numeric; clash timestamptz;
BEGIN
  IF NEW.status <> 'done' OR (TG_OP = 'UPDATE' AND OLD.status = 'done') OR NEW."sheetOrder" IS NULL THEN RETURN NEW; END IF;
  SELECT frequency INTO freq FROM "TreatmentSheetOrder" WHERE id = NEW."sheetOrder" FOR UPDATE;
  hours := CASE freq WHEN 'q1h' THEN 1 WHEN 'q2h' THEN 2 WHEN 'q4h' THEN 4 WHEN 'q6h' THEN 6 WHEN 'q8h' THEN 8 WHEN 'q12h' THEN 12
                     WHEN 'q24h' THEN 24 WHEN 'sid' THEN 24 WHEN 'bid' THEN 12 WHEN 'tid' THEN 8 WHEN 'qid' THEN 6 ELSE NULL END;
  IF hours IS NULL THEN RETURN NEW; END IF;
  SELECT t."doneAt" INTO clash FROM "TreatmentTask" t
   WHERE t."sheetOrder" = NEW."sheetOrder" AND t.id <> NEW.id AND t.status = 'done' AND t."doneAt" IS NOT NULL
     AND abs(extract(epoch FROM (COALESCE(NEW."doneAt", now()) - t."doneAt"))) < hours * 1800
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'A % dose was already given at %; the next one cannot be given yet', freq, to_char(clash AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreatmentTask_interval" BEFORE INSERT OR UPDATE ON "TreatmentTask" FOR EACH ROW EXECUTE FUNCTION vc_treatment_task_interval();

-- ── 7. Monitoring temperature in °C ─────────────────────────────────────────────────────
-- NOT VALID: one append-only reading on ANE-2026-000001 (60 °C, a °F entry typed as °C during the
-- review) predates the rule; MonitoringReading is append-only, so it is kept and annotated by audit.
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_temp_c" CHECK ("tempC" IS NULL OR "tempC" BETWEEN 25 AND 45) NOT VALID;
