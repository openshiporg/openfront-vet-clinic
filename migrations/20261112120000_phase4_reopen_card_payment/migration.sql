-- A result is final, with one exception: a card payment marked failed while the processor had no reference recorded
-- (the old "Check status" could do that to a live intent) may go back to pending once, when the intent reference is written.
CREATE OR REPLACE FUNCTION vc_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."client" IS DISTINCT FROM OLD."client" OR NEW.method <> OLD.method OR NEW."currencyCode" <> OLD."currencyCode" THEN
    RAISE EXCEPTION 'A payment amount, owner and method are frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'voided') AND NEW.status <> OLD.status
     AND NOT (OLD.status = 'failed' AND NEW.status = 'pending' AND OLD.method = 'card_on_file' AND OLD."providerRef" = '' AND NEW."providerRef" <> '') THEN
    RAISE EXCEPTION 'A payment that has a result never changes it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
