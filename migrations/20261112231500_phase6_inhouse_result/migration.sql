-- An in-house test is run on site, so its result may arrive while the order is still at "specimen_collected".
-- Replaces the body of the Phase 6 function vc_lab_result_guard() only; no table is altered.
CREATE OR REPLACE FUNCTION vc_lab_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ost text; lk text; prev record;
BEGIN
  SELECT o."status", l."kind" INTO ost, lk FROM "LabOrder" o LEFT JOIN "Laboratory" l ON l.id = o."lab" WHERE o.id = NEW."labOrder";
  IF ost IS NULL OR ost IN ('ordered', 'cancelled') OR (ost = 'specimen_collected' AND lk IS DISTINCT FROM 'in_house') THEN
    RAISE EXCEPTION 'A result needs an order that has been sent to the lab' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."supersedes" IS NOT NULL THEN
    SELECT "labOrder", "status" INTO prev FROM "LabResult" WHERE id = NEW."supersedes";
    IF prev."labOrder" IS DISTINCT FROM NEW."labOrder" THEN RAISE EXCEPTION 'A correction must replace a result of the same order' USING ERRCODE = 'check_violation'; END IF;
  ELSIF NEW."status" = 'corrected' THEN
    RAISE EXCEPTION 'A correction must say which result it replaces' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
