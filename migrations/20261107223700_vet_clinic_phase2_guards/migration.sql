-- ── Phase 2 guards (I-R1, I-R2, I-O1–I-O4, I-V1–I-V3) ────────────────────────────────────
-- The medical record is legal evidence: what the application cannot be trusted to keep, the
-- database keeps. Corrections are new rows (revisions, addenda, reversing administrations).

-- Append-only clinical history.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SoapSectionRevision', 'Addendum', 'VitalsObservation', 'DoseCalculation', 'Administration', 'MonitoringReading', 'VaccineAdministration', 'ReminderSatisfaction'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ── Encounter (SM§5) ─────────────────────────────────────────────────────────────────────
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_ref_format" CHECK (ref ~ '^ENC-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_signed_complete" CHECK (status <> 'signed' OR ("signedAt" IS NOT NULL AND "signedBy" IS NOT NULL AND "contentHash" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_voided_reason" CHECK (status <> 'voided' OR length("voidReason") > 0);
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_has_patient" CHECK (patient IS NOT NULL AND location IS NOT NULL);

-- A signed record is frozen (I-R1): only the rendered document link may be attached afterwards.
-- A voided record stays voided. Neither is ever deleted.
CREATE OR REPLACE FUNCTION vc_encounter_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Encounters are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'signed' THEN
    IF (to_jsonb(NEW) - ARRAY['document', 'version', 'updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['document', 'version', 'updatedAt']) THEN
      RAISE EXCEPTION 'Encounter % is signed; add an addendum instead', OLD.ref USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'voided' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A voided encounter cannot change status' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Encounter_frozen" BEFORE UPDATE OR DELETE ON "Encounter" FOR EACH ROW EXECUTE FUNCTION vc_encounter_frozen();

-- A section of a signed encounter (lockedAt set) never changes; sections are never deleted.
CREATE OR REPLACE FUNCTION vc_section_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Record sections are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."lockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'This section is signed and locked; add an addendum instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SoapSection_frozen" BEFORE UPDATE OR DELETE ON "SoapSection" FOR EACH ROW EXECUTE FUNCTION vc_section_frozen();
ALTER TABLE "SoapSection" ADD CONSTRAINT "SoapSection_ordinal" CHECK (ordinal >= 1);
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Addendum" ADD CONSTRAINT "Addendum_reason" CHECK (length(reason) > 0 AND length(body) > 0 AND hash ~ '^[0-9a-f]{64}$');

-- Vitals in plausible ranges (typos like 1020 °F are refused, not charted).
ALTER TABLE "VitalsObservation" ADD CONSTRAINT "VitalsObservation_ranges" CHECK (
  (temperature IS NULL OR (("temperatureUnit" = 'F' AND temperature BETWEEN 80 AND 115) OR ("temperatureUnit" = 'C' AND temperature BETWEEN 26 AND 46)))
  AND ("heartRate" IS NULL OR "heartRate" BETWEEN 1 AND 500)
  AND ("respRate" IS NULL OR "respRate" BETWEEN 1 AND 300)
  AND ("painScore" IS NULL OR "painScore" BETWEEN 0 AND 10)
  AND ("bodyConditionScore" IS NULL OR "bodyConditionScore" BETWEEN 1 AND 9)
  AND ("crtSeconds" IS NULL OR "crtSeconds" BETWEEN 0 AND 10)
  AND ("hydrationPct" IS NULL OR "hydrationPct" BETWEEN 0 AND 20));

-- ── Orders, doses and administrations (I-O1, I-O2) ───────────────────────────────────────
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_ref_format" CHECK (ref ~ '^ORD-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_medication_has_drug" CHECK (kind <> 'medication' OR (drug IS NOT NULL AND dose IS NOT NULL));
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_cancel_reason" CHECK (status NOT IN ('cancelled', 'reversed') OR length("cancelReason") > 0);
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_positive" CHECK ("weightKg" > 0 AND "doseAmount" > 0 AND "totalAmount" > 0 AND ("roundedQty" IS NULL OR "roundedQty" > 0));
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_override_reason" CHECK ("manualOverrideQty" IS NULL OR length("overrideReason") > 0);
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_hash" CHECK (hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_one_order" CHECK ("order" IS NOT NULL AND patient IS NOT NULL);
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_qty" CHECK ((reverses IS NULL AND qty > 0) OR (reverses IS NOT NULL AND qty < 0 AND length(reason) > 0));
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_lot_or_container" CHECK (length("lotNumber") > 0 OR "csContainer" IS NOT NULL OR reverses IS NOT NULL);

-- ── Hospital stays, cages and the treatment sheet (I-O3, I-O4) ───────────────────────────
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_ref_format" CHECK (ref ~ '^STAY-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_period" CHECK ("dischargedAt" IS NULL OR "dischargedAt" >= "admittedAt");
CREATE UNIQUE INDEX "HospitalStay_one_live_per_patient" ON "HospitalStay" (patient) WHERE status IN ('admitted', 'in_care', 'ready_for_discharge');
ALTER TABLE "CageAssignment" ADD CONSTRAINT "CageAssignment_period" CHECK ("toAt" IS NULL OR "toAt" > "fromAt");
ALTER TABLE "CageAssignment" ADD CONSTRAINT "CageAssignment_no_overlap" EXCLUDE USING gist (cage WITH =, tsrange("fromAt", COALESCE("toAt", 'infinity')) WITH &&);
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_skip_reason" CHECK (status <> 'skipped' OR length("skipReason") > 0);
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_done_by" CHECK (status <> 'done' OR ("doneBy" IS NOT NULL AND "doneAt" IS NOT NULL));

-- ── Anaesthesia ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_ref_format" CHECK (ref ~ '^ANE-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_ranges" CHECK (
  ("spo2" IS NULL OR "spo2" BETWEEN 0 AND 100) AND ("etco2" IS NULL OR "etco2" BETWEEN 0 AND 150)
  AND ("hr" IS NULL OR "hr" BETWEEN 0 AND 500) AND ("rr" IS NULL OR "rr" BETWEEN 0 AND 300));

-- ── Vaccines, rabies and reminders (I-V1–I-V3) ───────────────────────────────────────────
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_lot_in_date" CHECK ("lotExpiresOn" >= "administeredOn");
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_due_after" CHECK ("dueNextOn" > "administeredOn" AND "durationMonths" > 0 AND "doseSeries" >= 1);
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_site" CHECK (length(site) > 0 AND length("lotNumber") > 0);
ALTER TABLE "RabiesCertificate" ADD CONSTRAINT "RabiesCertificate_ref_format" CHECK (ref ~ '^RAB-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "RabiesCertificate" ADD CONSTRAINT "RabiesCertificate_due_after" CHECK ("nextDueOn" > "vaccinatedOn");
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_one_product" CHECK ((drug IS NULL) <> (vaccine IS NULL));
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_suppressed_reason" CHECK (status <> 'suppressed' OR length("suppressedReason") > 0);

-- A published reminder protocol version is frozen (same rule as PolicyVersion).
CREATE OR REPLACE FUNCTION vc_reminder_protocol_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A published reminder protocol is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    IF NEW.status = 'superseded' AND (to_jsonb(NEW) - ARRAY['status', 'version', 'updatedAt']) = (to_jsonb(OLD) - ARRAY['status', 'version', 'updatedAt']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A published reminder protocol version is frozen; publish a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'A superseded reminder protocol version is frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "ReminderProtocolVersion_frozen" BEFORE UPDATE OR DELETE ON "ReminderProtocolVersion" FOR EACH ROW EXECUTE FUNCTION vc_reminder_protocol_frozen();
CREATE UNIQUE INDEX "ReminderProtocolVersion_one_published" ON "ReminderProtocolVersion" (protocol) WHERE status = 'published';

-- ── Import ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_ref_format" CHECK (ref ~ '^IMP-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_counts" CHECK ("rowsCreated" + "rowsSkipped" + "rowsFailed" <= "rowsTotal");
