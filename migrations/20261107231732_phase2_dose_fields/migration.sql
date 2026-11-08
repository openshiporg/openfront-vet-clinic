-- AlterTable
ALTER TABLE "Administration" ADD COLUMN     "licenseEvaluation" TEXT,
ADD COLUMN     "wasteLogEntry" TEXT,
ADD COLUMN     "witness" TEXT;

-- AlterTable
ALTER TABLE "DrugProduct" ADD COLUMN     "cautionFlags" JSONB DEFAULT '[]',
ADD COLUMN     "doseRanges" JSONB,
ADD COLUMN     "measurableIncrement" DECIMAL(18,6);

-- CreateIndex
CREATE INDEX "Administration_witness_idx" ON "Administration"("witness");

-- CreateIndex
CREATE INDEX "Administration_licenseEvaluation_idx" ON "Administration"("licenseEvaluation");

-- CreateIndex
CREATE INDEX "Administration_wasteLogEntry_idx" ON "Administration"("wasteLogEntry");

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_licenseEvaluation_fkey" FOREIGN KEY ("licenseEvaluation") REFERENCES "LicenseEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_wasteLogEntry_fkey" FOREIGN KEY ("wasteLogEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
