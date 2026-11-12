-- A retry authorisation on the attempt: set (non-empty) only by Retry after the card was replaced.
ALTER TABLE "PlanBillingAttempt" ADD COLUMN "retryNote" TEXT NOT NULL DEFAULT '';

-- Extends vc_plan_attempt_guard: after a declined month that was never paid, no new attempt (any month, any generation) may be
-- started for the enrolment unless it carries a retry authorisation. A decline therefore stops every later automatic charge.
CREATE OR REPLACE FUNCTION vc_plan_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; dead timestamp;
BEGIN
  SELECT e."status", p."deceasedAt" INTO st, dead FROM "Enrollment" e LEFT JOIN "Patient" p ON p."id" = e."patient" WHERE e."id" = NEW."enrollment";
  IF st IS NULL OR st NOT IN ('pending_payment', 'active') OR dead IS NOT NULL THEN
    RAISE EXCEPTION 'This plan enrolment cannot be charged' USING ERRCODE = 'check_violation';
  END IF;
  IF length(NEW."retryNote") = 0 AND EXISTS (
    SELECT 1 FROM "PlanBillingAttempt" f
    WHERE f."enrollment" = NEW."enrollment" AND f."status" = 'failed'
      AND NOT EXISTS (SELECT 1 FROM "PlanBillingAttempt" s WHERE s."enrollment" = f."enrollment" AND s."periodKey" = f."periodKey" AND s."status" = 'succeeded')
  ) THEN
    RAISE EXCEPTION 'A declined plan month needs the card replaced and Retry before any new charge' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A boarding deposit is a Deposit row linked to its reservation (paid on the Billing screen, applied at check-out).
ALTER TABLE "Deposit" ADD COLUMN "reservation" TEXT;
CREATE INDEX "Deposit_reservation_idx" ON "Deposit"("reservation");
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_reservation_fkey" FOREIGN KEY ("reservation") REFERENCES "BoardingReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
