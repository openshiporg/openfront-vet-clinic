-- P5 r2 backlog (a): a retry authorisation is only honoured when the attempt carries a card newer than every declined,
-- never-paid attempt of the enrolment. Replaces the function body only; no table is altered.
CREATE OR REPLACE FUNCTION vc_plan_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; dead timestamp; declined int;
BEGIN
  SELECT e."status", p."deceasedAt" INTO st, dead FROM "Enrollment" e LEFT JOIN "Patient" p ON p."id" = e."patient" WHERE e."id" = NEW."enrollment";
  IF st IS NULL OR st NOT IN ('pending_payment', 'active') OR dead IS NOT NULL THEN
    RAISE EXCEPTION 'This plan enrolment cannot be charged' USING ERRCODE = 'check_violation';
  END IF;
  SELECT max(COALESCE(f."cardVersion", 1)) INTO declined FROM "PlanBillingAttempt" f
    WHERE f."enrollment" = NEW."enrollment" AND f."status" = 'failed'
      AND NOT EXISTS (SELECT 1 FROM "PlanBillingAttempt" s WHERE s."enrollment" = f."enrollment" AND s."periodKey" = f."periodKey" AND s."status" = 'succeeded');
  IF declined IS NOT NULL AND (length(NEW."retryNote") = 0 OR COALESCE(NEW."cardVersion", 1) <= declined) THEN
    RAISE EXCEPTION 'A declined plan month needs the card replaced and Retry before any new charge' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
