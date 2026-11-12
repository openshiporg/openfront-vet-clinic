-- One card payment in flight (pending or unknown) per invoice or deposit: a second charge must wait for "Check status" on the first.
CREATE UNIQUE INDEX "Payment_one_open_card_per_invoice" ON "Payment" ("forInvoice") WHERE "method" = 'card_on_file' AND "status" IN ('pending', 'unknown') AND "forInvoice" IS NOT NULL;
CREATE UNIQUE INDEX "Payment_one_open_card_per_deposit" ON "Payment" ("forDeposit") WHERE "method" = 'card_on_file' AND "status" IN ('pending', 'unknown') AND "forDeposit" IS NOT NULL;
