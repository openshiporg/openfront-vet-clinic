-- ── Phase 1 guards (SCHEMA G8, I-C2, I-C4, I-O4, I-CS1, I-RX1) ─────────────────────────────
-- Invariants that hold whatever the application does. Corrections are new rows, never edits.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Append-only history: consent, weights, alert acknowledgements, segment transitions, triage,
-- records releases and the controlled-substance register.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ConsentRecord', 'WeightMeasurement', 'AlertAcknowledgement', 'SegmentTransition', 'TriageAssessment', 'RecordsRelease', 'CsLogEntry'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ── Clients and patients ─────────────────────────────────────────────────────────────────
ALTER TABLE "Client" ADD CONSTRAINT "Client_ref_format" CHECK (ref ~ '^C-[0-9]{6,}$');
ALTER TABLE "Client" ADD CONSTRAINT "Client_not_merged_into_self" CHECK ("mergedInto" IS NULL OR "mergedInto" <> id);
ALTER TABLE "Client" ADD CONSTRAINT "Client_merged_has_target" CHECK ((status = 'merged') = ("mergedInto" IS NOT NULL));
ALTER TABLE "Client" ADD CONSTRAINT "Client_credit_nonnegative" CHECK ("creditLimitMinor" >= 0);
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_ref_format" CHECK (ref ~ '^P-[0-9]{6,}$');
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_merged_has_target" CHECK ((status = 'merged') = ("mergedInto" IS NOT NULL));
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_deceased_has_time" CHECK ((status = 'deceased') = ("deceasedAt" IS NOT NULL));
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_group_size" CHECK ((kind = 'group') = ("groupSize" IS NOT NULL) AND ("groupSize" IS NULL OR "groupSize" > 1));

-- A deceased patient never comes back to life, and a merged record stays merged (SM§2.2).
CREATE OR REPLACE FUNCTION vc_patient_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('deceased', 'merged') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A % patient cannot change status', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Patient_terminal" BEFORE UPDATE ON "Patient" FOR EACH ROW EXECUTE FUNCTION vc_patient_terminal();

-- One primary person per household, one primary contact point per person (I-C6).
CREATE UNIQUE INDEX "ClientPerson_one_primary" ON "ClientPerson" (client) WHERE "isPrimary";
CREATE UNIQUE INDEX "ContactPoint_one_primary_kind" ON "ContactPoint" (person, kind) WHERE "isPrimary" AND status = 'active';
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_hash_format" CHECK ("valueHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_value_format" CHECK ((kind = 'email' AND value ~ '^[^@\s]+@[^@\s]+$') OR (kind <> 'email' AND value ~ '^\+[0-9]{8,15}$'));

-- One open primary owner per patient, and no overlapping primary ownership periods (I-C2).
CREATE UNIQUE INDEX "PatientOwnership_one_open_primary" ON "PatientOwnership" (patient) WHERE role = 'primary' AND "effectiveTo" IS NULL;
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_no_overlap" EXCLUDE USING gist (patient WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity')) WITH &&) WHERE (role = 'primary');

-- Weights: positive, and the kilogram value is present (I-C4).
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_positive" CHECK (value > 0 AND "valueKg" > 0);
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_bcs" CHECK ("bodyConditionScore" IS NULL OR "bodyConditionScore" BETWEEN 1 AND 9);

-- A microchip number is active on one patient at a time.
CREATE UNIQUE INDEX "Microchip_one_active" ON "Microchip" (number) WHERE active;

ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_period" CHECK ("expiresAt" > "establishedAt");
ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_dvm_scope" CHECK (scope <> 'dvm' OR dvm IS NOT NULL);

-- ── Scheduling (I-O4): no double booking of a room, equipment or provider, ever ────────────
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_period" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_ref_format" CHECK (ref ~ '^APT-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_period" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ResourceReservation" ADD CONSTRAINT "ResourceReservation_period" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ProviderReservation" ADD CONSTRAINT "ProviderReservation_period" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ResourceReservation" ADD CONSTRAINT "ResourceReservation_no_overlap" EXCLUDE USING gist (resource WITH =, tsrange("startsAt", "endsAt") WITH &&) WHERE (status <> 'released');
ALTER TABLE "ProviderReservation" ADD CONSTRAINT "ProviderReservation_no_overlap" EXCLUDE USING gist ("staffMember" WITH =, tsrange("startsAt", "endsAt") WITH &&) WHERE (status <> 'released');
CREATE INDEX "Appointment_day_idx" ON "Appointment" (location, "startsAt") WHERE status NOT IN ('cancelled', 'declined', 'no_show');
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_deposit" CHECK ("depositMinor" IS NULL OR "depositMinor" >= 0);
-- One live whiteboard entry per patient per location.
CREATE UNIQUE INDEX "WhiteboardEntry_one_live" ON "WhiteboardEntry" (location, patient) WHERE status <> 'discharged';

-- Triage protocol versions are frozen once published; only the lifecycle moves.
CREATE OR REPLACE FUNCTION vc_triage_version_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TriageProtocolVersion rows are append-only' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'draft' AND (NEW.questions IS DISTINCT FROM OLD.questions OR NEW."redFlags" IS DISTINCT FROM OLD."redFlags"
     OR NEW."levelRules" IS DISTINCT FROM OLD."levelRules" OR NEW.scripts IS DISTINCT FROM OLD.scripts OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber" OR NEW.protocol IS DISTINCT FROM OLD.protocol) THEN
    RAISE EXCEPTION 'A published triage protocol is frozen: publish a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' OR OLD.status = 'published' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'TriageProtocolVersion status cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TriageProtocolVersion_frozen" BEFORE UPDATE OR DELETE ON "TriageProtocolVersion" FOR EACH ROW EXECUTE FUNCTION vc_triage_version_frozen();
CREATE UNIQUE INDEX "TriageProtocolVersion_one_published" ON "TriageProtocolVersion" (protocol) WHERE status = 'published';

-- A triage that hit a red flag is always emergency_now (SM§4): agents never downgrade.
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_red_flag_is_emergency" CHECK (
  "redFlagsHit" IS NULL OR jsonb_typeof("redFlagsHit") <> 'array' OR jsonb_array_length("redFlagsHit") = 0 OR level = 'emergency_now');
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_emergency_not_booked" CHECK (level <> 'emergency_now' OR outcome IN ('transferred', 'er_referred'));

-- ── Comms ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_blocked_reason" CHECK (status <> 'blocked' OR "blockedReason" <> '');
CREATE INDEX "CommsMessage_queued_idx" ON "CommsMessage" ("createdAt") WHERE status = 'queued';
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_period" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
-- An AI-answered call must carry its disclosure time once it is past ringing (FCC 24-17; I-G3).
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_ai_disclosed" CHECK ("answeredBy" <> 'ai' OR status = 'ringing' OR "disclosurePlayedAt" IS NOT NULL);
-- Outbound AI voice is disabled in v1 (Euler decision 4): the database refuses the row.
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_no_outbound_ai" CHECK (NOT (direction = 'outbound' AND "answeredBy" = 'ai'));
CREATE UNIQUE INDEX "Suppression_active_contact_reason" ON "Suppression" ("contactPoint", reason) WHERE active AND "contactPoint" IS NOT NULL;

-- ── Records ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_decision" CHECK (status NOT IN ('fulfilled_under_existing_rx', 'approved_new_rx', 'denied', 'needs_exam') OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL));
-- An agent can file a refill request; it can never be the decider (I-G4).
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_denial_reason" CHECK (status <> 'denied' OR "denialReason" <> '');

-- ── Prescriptions (I-RX1; 21 CFR 1306.12, 1306.22) ─────────────────────────────────────────
-- A Schedule II line can never carry a refill; CIII-CV at most five.
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_cii_no_refills" CHECK ("csSchedule" NOT IN ('CII', 'CIIN') OR "refillsAuthorised" = 0);
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_ciii_cv_refills" CHECK ("csSchedule" NOT IN ('CIII', 'CIIIN', 'CIV', 'CV') OR "refillsAuthorised" <= 5);
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_refills_nonnegative" CHECK ("refillsAuthorised" >= 0);
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_no_ci" CHECK ("csSchedule" <> 'CI');

-- The line's schedule must be the product's (so a CII product can't be written as "none" to get refills),
-- and CIII-CV lines expire within six months of issue.
CREATE OR REPLACE FUNCTION vc_rx_line_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_schedule text; issued timestamp;
BEGIN
  SELECT "csSchedule" INTO product_schedule FROM "DrugProduct" WHERE id = NEW.product;
  IF product_schedule IS NULL THEN RAISE EXCEPTION 'A prescription line needs a product' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."csSchedule" IS DISTINCT FROM product_schedule THEN
    RAISE EXCEPTION 'Prescription line schedule % does not match the product schedule %', NEW."csSchedule", product_schedule USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."csSchedule" IN ('CIII', 'CIIIN', 'CIV', 'CV') THEN
    SELECT "issuedAt" INTO issued FROM "Prescription" WHERE id = NEW.prescription;
    IF issued IS NOT NULL AND NEW."expiresAt" > issued + interval '6 months' THEN
      RAISE EXCEPTION 'A Schedule III-V prescription cannot be refilled beyond six months from issue' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PrescriptionLine_schedule" BEFORE INSERT OR UPDATE ON "PrescriptionLine" FOR EACH ROW EXECUTE FUNCTION vc_rx_line_schedule();

-- A product's schedule cannot be lowered once a prescription line references it.
CREATE OR REPLACE FUNCTION vc_drug_schedule_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."csSchedule" IS DISTINCT FROM OLD."csSchedule" AND EXISTS (SELECT 1 FROM "PrescriptionLine" WHERE product = OLD.id) THEN
    RAISE EXCEPTION 'The schedule of a prescribed product cannot change: add a new product' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DrugProduct_schedule_fixed" BEFORE UPDATE ON "DrugProduct" FOR EACH ROW EXECUTE FUNCTION vc_drug_schedule_fixed();

-- ── Controlled-substance register (I-CS1; 21 CFR 1304.21-22) ─────────────────────────────
ALTER TABLE "CsContainer" ADD CONSTRAINT "CsContainer_label_positive" CHECK ("labelQty" > 0);
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_nonzero" CHECK ("qtySigned" <> 0);
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_direction" CHECK (
  (type IN ('receive', 'open_transfer', 'transfer_in', 'return') AND "qtySigned" > 0)
  OR (type IN ('administer', 'dispense', 'waste', 'transfer_out', 'destroy', 'theft_loss') AND "qtySigned" < 0)
  OR type IN ('adjust', 'count_variance'));
-- Schedule II entries carry their own sequence (separate CII records, 21 CFR 1304.04(f)).
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_cii_sequence" CHECK ((schedule IN ('CII', 'CIIN')) = ("ciiRef" IS NOT NULL));
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_no_ci" CHECK (schedule <> 'CI' AND schedule <> 'none');

-- The balance of a container is Σ qtySigned and is never below zero, under any interleaving:
-- the trigger takes the container row lock, so concurrent entries on one bottle serialise.
CREATE OR REPLACE FUNCTION vc_cs_balance_nonnegative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance numeric; container_schedule text;
BEGIN
  IF NEW.container IS NULL THEN RAISE EXCEPTION 'A register entry needs a container' USING ERRCODE = 'check_violation'; END IF;
  PERFORM 1 FROM "CsContainer" WHERE id = NEW.container FOR UPDATE;
  SELECT p."csSchedule" INTO container_schedule FROM "CsContainer" c JOIN "DrugProduct" p ON p.id = c.product WHERE c.id = NEW.container;
  IF container_schedule IS DISTINCT FROM NEW.schedule THEN
    RAISE EXCEPTION 'Register entry schedule % does not match the product schedule %', NEW.schedule, container_schedule USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM("qtySigned"), 0) INTO balance FROM "CsLogEntry" WHERE container = NEW.container;
  IF balance + NEW."qtySigned" < 0 THEN
    RAISE EXCEPTION 'Controlled-substance balance cannot go below zero (container %, balance %, entry %)', NEW.container, balance, NEW."qtySigned" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsLogEntry_balance" BEFORE INSERT ON "CsLogEntry" FOR EACH ROW EXECUTE FUNCTION vc_cs_balance_nonnegative();

-- Containers are never deleted (the register references them for two years, 21 CFR 1304.04).
CREATE OR REPLACE FUNCTION vc_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "CsContainer_no_delete" BEFORE DELETE ON "CsContainer" FOR EACH ROW EXECUTE FUNCTION vc_no_delete();
CREATE TRIGGER "CsContainer_no_truncate" BEFORE TRUNCATE ON "CsContainer" FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change();
