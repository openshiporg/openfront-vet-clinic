-- A client paying by payment link is a card payment too: the one-open-card-payment rule covers both methods.
DROP INDEX IF EXISTS "Payment_one_open_card_per_invoice";
DROP INDEX IF EXISTS "Payment_one_open_card_per_deposit";
CREATE UNIQUE INDEX "Payment_one_open_card_per_invoice" ON "Payment" ("forInvoice") WHERE "method" IN ('card_on_file', 'payment_link') AND "status" IN ('pending', 'unknown') AND "forInvoice" IS NOT NULL;
CREATE UNIQUE INDEX "Payment_one_open_card_per_deposit" ON "Payment" ("forDeposit") WHERE "method" IN ('card_on_file', 'payment_link') AND "status" IN ('pending', 'unknown') AND "forDeposit" IS NOT NULL;

-- The one way back from failed (a live intent the old "Check status" marked failed) applies to link payments as well.
CREATE OR REPLACE FUNCTION vc_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."client" IS DISTINCT FROM OLD."client" OR NEW.method <> OLD.method OR NEW."currencyCode" <> OLD."currencyCode" THEN
    RAISE EXCEPTION 'A payment amount, owner and method are frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'voided') AND NEW.status <> OLD.status
     AND NOT (OLD.status = 'failed' AND NEW.status = 'pending' AND OLD.method IN ('card_on_file', 'payment_link') AND OLD."providerRef" = '' AND NEW."providerRef" <> '') THEN
    RAISE EXCEPTION 'A payment that has a result never changes it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
