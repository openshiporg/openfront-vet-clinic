-- AlterTable
ALTER TABLE "Administration" ADD COLUMN     "qtyOverrideReason" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "supersedesField" TEXT NOT NULL DEFAULT '';


-- ════════════════════════════════════════════════════════════════════════════════════════
-- Phase 2 r2 review fixes (N1, N2, N3, M1). Every predicate below was run against live data first
-- (state/screenshots/vet-clinic/p2-fixes-r2/N3-predicates-live-before.json): with the legacy
-- cutoff no row breaks a rule, so each constraint is VALIDATED, not left NOT VALID.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ── N3. Legacy cutoff, then VALIDATE ───────────────────────────────────────────────────
-- The three rules were added NOT VALID because append-only rows written before them break them
-- (live: CS-2026-000004/7/9, ANE-2026-000001 and one 60 °C reading on it). A NOT VALID CHECK is
-- still re-checked on every UPDATE of an old row, which made ANE-2026-000001 impossible to update.
-- Each rule now exempts only rows recorded before the legacy cutoff, 2026-11-08 22:05:41 UTC (when
-- 20261108190000_phase2_review_fixes deployed and the rules began), and a guard refuses any new row
-- dated before the cutoff, so the exemption cannot be reused by backdating. The constraints are then
-- VALIDATED over the whole table. The rows themselves are evidence and are not rewritten: no witness
-- is invented for CS-2026-000004/7/9, and the 60 °C reading stays as typed.

CREATE OR REPLACE FUNCTION vc_legacy_cutoff() RETURNS timestamp LANGUAGE sql IMMUTABLE AS $$ SELECT TIMESTAMP '2026-11-08 22:05:41' $$;

ALTER TABLE "CsLogEntry" DROP CONSTRAINT "CsLogEntry_witness_required";
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_witness_required" CHECK (
  NOT (type = 'waste' OR (type = 'administer' AND "ciiRef" IS NOT NULL))
  OR witness IS NOT NULL
  OR "recordedAt" < vc_legacy_cutoff()
) NOT VALID;
ALTER TABLE "CsLogEntry" VALIDATE CONSTRAINT "CsLogEntry_witness_required";
COMMENT ON CONSTRAINT "CsLogEntry_witness_required" ON "CsLogEntry" IS
  'Waste and Schedule II administer name a witness. Legacy: entries recorded before 2026-11-08 22:05:41 UTC (live: CS-2026-000004/7/9) predate the witness column; no witness is invented.';

ALTER TABLE "AnaesthesiaRecord" DROP CONSTRAINT "AnaesthesiaRecord_event_order";
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_event_order" CHECK (
  ("intubatedAt" IS NULL OR ("inductionAt" IS NOT NULL AND "inductionAt" <= "intubatedAt"))
  AND ("extubatedAt" IS NULL OR ("intubatedAt" IS NOT NULL AND "intubatedAt" <= "extubatedAt")
       OR ("intubatedAt" IS NULL AND "createdAt" < vc_legacy_cutoff()))
  AND ("recoveryEndAt" IS NULL OR "extubatedAt" IS NULL OR "extubatedAt" <= "recoveryEndAt")
) NOT VALID;
ALTER TABLE "AnaesthesiaRecord" VALIDATE CONSTRAINT "AnaesthesiaRecord_event_order";
COMMENT ON CONSTRAINT "AnaesthesiaRecord_event_order" ON "AnaesthesiaRecord" IS
  'Induction <= intubation <= extubation <= recovery end. Legacy: a record opened before 2026-11-08 22:05:41 UTC may lack an intubation time (live: ANE-2026-000001).';

ALTER TABLE "MonitoringReading" DROP CONSTRAINT "MonitoringReading_temp_c";
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_temp_c" CHECK (
  "tempC" IS NULL OR "tempC" BETWEEN 25 AND 45 OR "at" < vc_legacy_cutoff()
) NOT VALID;
ALTER TABLE "MonitoringReading" VALIDATE CONSTRAINT "MonitoringReading_temp_c";
COMMENT ON CONSTRAINT "MonitoringReading_temp_c" ON "MonitoringReading" IS
  'Temperature in °C, 25–45. Legacy: readings before 2026-11-08 22:05:41 UTC (live: cmw885eqx024tqb01okl9egtw, 60 typed as °C on ANE-2026-000001).';

-- No row is ever dated into the legacy period after the fact, and the date that decides it never moves.
-- The column is read through to_jsonb: PL/pgSQL cannot reference NEW."createdAt" on a table without it,
-- even in a branch that is never taken.
CREATE OR REPLACE FUNCTION vc_no_legacy_backdating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text; stamp timestamp;
BEGIN
  col := CASE TG_TABLE_NAME WHEN 'CsLogEntry' THEN 'recordedAt' WHEN 'MonitoringReading' THEN 'at' ELSE 'createdAt' END;
  stamp := (to_jsonb(NEW) ->> col)::timestamp;
  IF TG_OP = 'INSERT' THEN
    IF stamp < vc_legacy_cutoff() THEN
      RAISE EXCEPTION '% rows cannot be dated before %', TG_TABLE_NAME, vc_legacy_cutoff() USING ERRCODE = 'check_violation';
    END IF;
  ELSIF stamp IS DISTINCT FROM (to_jsonb(OLD) ->> col)::timestamp THEN
    RAISE EXCEPTION 'The recorded time of a % row never changes', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CsLogEntry_no_backdating" BEFORE INSERT ON "CsLogEntry" FOR EACH ROW EXECUTE FUNCTION vc_no_legacy_backdating();
CREATE TRIGGER "MonitoringReading_no_backdating" BEFORE INSERT ON "MonitoringReading" FOR EACH ROW EXECUTE FUNCTION vc_no_legacy_backdating();
CREATE TRIGGER "AnaesthesiaRecord_no_backdating" BEFORE INSERT OR UPDATE ON "AnaesthesiaRecord" FOR EACH ROW EXECUTE FUNCTION vc_no_legacy_backdating();

-- ── N1. The amount given matches the order ──────────────────────────────────────────────
-- A new administration (not a reversal) on an order with a dose calculation must be within 10% of
-- the quantity to give (the manual quantity if one was recorded, else the rounded, else the computed
-- quantity), never less than 0.01 of the unit. Outside it, a veterinarian gives it and records why.
-- The application refuses the same case first (administrationQtyProblem in domain/dose.ts).
CREATE OR REPLACE FUNCTION vc_administration_qty_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned numeric; tolerance numeric; giver_kind text;
BEGIN
  IF NEW.reverses IS NOT NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(d."manualOverrideQty", d."roundedQty", d."computedQty") INTO planned
    FROM "ClinicalOrder" o JOIN "DoseCalculation" d ON d.id = o.dose WHERE o.id = NEW."order";
  IF planned IS NULL OR planned <= 0 THEN RETURN NEW; END IF;
  tolerance := GREATEST(planned * 0.10, 0.01);
  IF abs(NEW.qty - planned) <= tolerance THEN RETURN NEW; END IF;
  SELECT kind INTO giver_kind FROM "StaffMember" WHERE id = NEW."givenBy";
  IF giver_kind IS DISTINCT FROM 'dvm' OR length(btrim(NEW."qtyOverrideReason")) < 8 THEN
    RAISE EXCEPTION 'Administration of % % is outside the ordered % (±%); a veterinarian must record the reason', NEW.qty, NEW.unit, planned, tolerance USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Administration_qty_guard" BEFORE INSERT ON "Administration" FOR EACH ROW EXECUTE FUNCTION vc_administration_qty_guard();

-- ── N2. Dose range blocks need a reason; a manual quantity outside the range is never stored ─
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_block_reason" CHECK (
  NOT (warnings @> '[{"severity": "block"}]'::jsonb) OR length(btrim("overrideReason")) >= 8);
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_no_hard_block" CHECK (
  NOT (warnings @> '[{"code": "override_out_of_range"}]'::jsonb) AND NOT (warnings @> '[{"code": "range_unconvertible_override"}]'::jsonb));
-- A per-m² dose carries the body surface area it was calculated from (from the dosing weight).
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_bsa" CHECK (
  "dosePer" <> 'm2' OR ("bsaM2" > 0 AND "bsaConstant" > 0));

-- ── M1. Missed treatments stay missed ────────────────────────────────────────────────────
-- The treatment-sheet job moves an undone task past half its interval to `missed`. A missed dose is
-- never marked done late; it can only be rescheduled (which creates a new task).
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_status" CHECK (
  status IN ('scheduled', 'due', 'overdue', 'missed', 'done', 'skipped', 'rescheduled'));
CREATE OR REPLACE FUNCTION vc_treatment_task_missed_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'missed' AND NEW.status NOT IN ('missed', 'rescheduled') THEN
    RAISE EXCEPTION 'A missed treatment is not given late; reschedule it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreatmentTask_missed_final" BEFORE UPDATE ON "TreatmentTask" FOR EACH ROW EXECUTE FUNCTION vc_treatment_task_missed_final();
