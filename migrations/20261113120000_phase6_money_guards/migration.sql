-- Phase 6 review r1 (M5, M6): two money rules held by the database as well as the app. Adds a trigger and an index; changes no rows.

-- M5: an adjustment names a credit, and the credit's net (its amount plus every adjustment, this one included) never goes below zero.
-- The credit row is locked first so two adjustments inserted at the same time are checked one after the other.
CREATE OR REPLACE FUNCTION vc_adjustment_net() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base bigint; k text; prior bigint;
BEGIN
  IF NEW."kind" <> 'adjustment' THEN RETURN NEW; END IF;
  SELECT "amountMinor", "kind" INTO base, k FROM "ProductionCredit" WHERE id = NEW."adjusts" FOR UPDATE;
  IF k IS DISTINCT FROM 'credit' THEN RAISE EXCEPTION 'An adjustment must name a production credit' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(sum("amountMinor"), 0) INTO prior FROM "ProductionCredit" WHERE "adjusts" = NEW."adjusts";
  IF base + prior + NEW."amountMinor" < 0 THEN
    RAISE EXCEPTION 'An adjustment cannot take more than the credit is worth' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionCredit_net" BEFORE INSERT ON "ProductionCredit" FOR EACH ROW EXECUTE FUNCTION vc_adjustment_net();

-- M6: one imported opening balance per client and source system (entry keys are import:<system>:balance:<client id>[:<date>]).
CREATE UNIQUE INDEX "ClientLedgerEntry_one_opening_balance" ON "ClientLedgerEntry" ("client", split_part("entryKey", ':', 2))
  WHERE "entryKey" LIKE 'import:%:balance:%';
