-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "elective" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "allowOverpay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forDeposit" TEXT,
ADD COLUMN     "forInvoice" TEXT,
ADD COLUMN     "linkUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "postedOn" DATE;

-- CreateIndex
CREATE INDEX "Payment_forInvoice_idx" ON "Payment"("forInvoice");

-- CreateIndex
CREATE INDEX "Payment_forDeposit_idx" ON "Payment"("forDeposit");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_forInvoice_fkey" FOREIGN KEY ("forInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_forDeposit_fkey" FOREIGN KEY ("forDeposit") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
