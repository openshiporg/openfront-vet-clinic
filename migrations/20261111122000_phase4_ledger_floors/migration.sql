-- The ledger floors are checked when the transaction commits, so a credit note and the move of its excess to the
-- client's account can be written together. Two floors: an invoice never owes less than nothing, and money held
-- on account (entries with no invoice) is never spent beyond what the client has put there.

DROP TRIGGER "ClientLedgerEntry_invoice_floor" ON "ClientLedgerEntry";

CREATE OR REPLACE FUNCTION vc_ledger_floors() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  IF NEW."invoice" IS NOT NULL THEN
    PERFORM 1 FROM "Invoice" WHERE id = NEW."invoice" FOR UPDATE;
    SELECT COALESCE(SUM("amountMinor"), 0) INTO s FROM "ClientLedgerEntry" WHERE "invoice" = NEW."invoice";
    IF s < 0 THEN RAISE EXCEPTION 'An invoice balance cannot go below zero' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    PERFORM 1 FROM "Client" WHERE id = NEW."client" FOR UPDATE;
    SELECT COALESCE(SUM("amountMinor"), 0) INTO s FROM "ClientLedgerEntry" WHERE "client" = NEW."client" AND "invoice" IS NULL;
    IF s > 0 THEN RAISE EXCEPTION 'The money held on account cannot go below zero' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ClientLedgerEntry_floors" AFTER INSERT ON "ClientLedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vc_ledger_floors();
