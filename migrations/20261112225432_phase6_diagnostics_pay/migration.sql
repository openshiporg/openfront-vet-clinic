-- AlterTable
ALTER TABLE "RecordsRelease" ADD COLUMN     "destination" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "packetHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "RecordsRequest" ADD COLUMN     "decisionReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "verificationNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT;

-- CreateTable
CREATE TABLE "Laboratory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "intake" TEXT NOT NULL,
    "integration" TEXT,
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Laboratory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analyte" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "canonicalUnit" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analyte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTest" (
    "id" TEXT NOT NULL,
    "lab" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "specimenRequirements" JSONB,
    "feeItem" TEXT,
    "turnaroundHours" INTEGER NOT NULL DEFAULT 24,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAnalyteMap" (
    "id" TEXT NOT NULL,
    "lab" TEXT,
    "externalCode" TEXT NOT NULL DEFAULT '',
    "analyte" TEXT,
    "unitConversion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAnalyteMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceRange" (
    "id" TEXT NOT NULL,
    "analyte" TEXT,
    "species" TEXT,
    "ageClass" TEXT NOT NULL,
    "lab" TEXT,
    "low" DECIMAL(18,6),
    "high" DECIMAL(18,6),
    "criticalLow" DECIMAL(18,6),
    "criticalHigh" DECIMAL(18,6),
    "unit" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "order" TEXT,
    "patient" TEXT,
    "encounter" TEXT,
    "location" TEXT,
    "lab" TEXT,
    "orderedBy" TEXT,
    "accessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "chargeLine" TEXT,
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specimen" (
    "id" TEXT NOT NULL,
    "labOrder" TEXT,
    "kind" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "collectedBy" TEXT,
    "containerId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "labOrder" TEXT,
    "observation" TEXT,
    "status" TEXT NOT NULL,
    "supersedes" TEXT,
    "reportDocument" TEXT,
    "worstFlag" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResultValue" (
    "id" TEXT NOT NULL,
    "result" TEXT,
    "analyte" TEXT,
    "externalCode" TEXT NOT NULL DEFAULT '',
    "valueNumeric" DECIMAL(18,6),
    "valueText" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "refLow" DECIMAL(18,6),
    "refHigh" DECIMAL(18,6),
    "flag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResultValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultReview" (
    "id" TEXT NOT NULL,
    "result" TEXT,
    "dvm" TEXT,
    "kind" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL DEFAULT '',
    "communicatedVia" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingOrder" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "order" TEXT,
    "patient" TEXT,
    "encounter" TEXT,
    "location" TEXT,
    "orderedBy" TEXT,
    "modality" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingStudy" (
    "id" TEXT NOT NULL,
    "order" TEXT,
    "studyInstanceUid" TEXT NOT NULL DEFAULT '',
    "modality" TEXT NOT NULL,
    "pacs" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "images" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingReport" (
    "id" TEXT NOT NULL,
    "study" TEXT,
    "author" TEXT NOT NULL,
    "authorStaff" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRuleVersion" (
    "id" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "rules" JSONB,
    "commissionRules" JSONB,
    "effectiveFrom" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "ruleHash" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCredit" (
    "id" TEXT NOT NULL,
    "staff" TEXT,
    "chargeLine" TEXT,
    "invoice" TEXT,
    "ruleVersion" TEXT,
    "location" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "basis" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "adjusts" TEXT,
    "baseMinor" BIGINT NOT NULL,
    "bps" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "creditedOn" DATE NOT NULL,
    "period" TEXT,
    "entryKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "staff" TEXT,
    "chargeLine" TEXT,
    "ruleVersion" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "baseMinor" BIGINT NOT NULL,
    "bps" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "earnedOn" DATE NOT NULL,
    "period" TEXT,
    "entryKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "totals" JSONB,
    "totalsHash" TEXT NOT NULL DEFAULT '',
    "calculatedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollExportBatch" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "period" TEXT,
    "format" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "csv" TEXT NOT NULL DEFAULT '',
    "exportedBy" TEXT,
    "exportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'built',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL,
    "template" TEXT,
    "audience" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "outboundVoice" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LabTest_species" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_LabOrder_tests" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Laboratory_code_key" ON "Laboratory"("code");

-- CreateIndex
CREATE INDEX "Laboratory_integration_idx" ON "Laboratory"("integration");

-- CreateIndex
CREATE UNIQUE INDEX "Analyte_code_key" ON "Analyte"("code");

-- CreateIndex
CREATE INDEX "LabTest_lab_idx" ON "LabTest"("lab");

-- CreateIndex
CREATE INDEX "LabTest_feeItem_idx" ON "LabTest"("feeItem");

-- CreateIndex
CREATE INDEX "LabAnalyteMap_lab_idx" ON "LabAnalyteMap"("lab");

-- CreateIndex
CREATE INDEX "LabAnalyteMap_analyte_idx" ON "LabAnalyteMap"("analyte");

-- CreateIndex
CREATE INDEX "ReferenceRange_analyte_idx" ON "ReferenceRange"("analyte");

-- CreateIndex
CREATE INDEX "ReferenceRange_species_idx" ON "ReferenceRange"("species");

-- CreateIndex
CREATE INDEX "ReferenceRange_lab_idx" ON "ReferenceRange"("lab");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_ref_key" ON "LabOrder"("ref");

-- CreateIndex
CREATE INDEX "LabOrder_order_idx" ON "LabOrder"("order");

-- CreateIndex
CREATE INDEX "LabOrder_patient_idx" ON "LabOrder"("patient");

-- CreateIndex
CREATE INDEX "LabOrder_encounter_idx" ON "LabOrder"("encounter");

-- CreateIndex
CREATE INDEX "LabOrder_location_idx" ON "LabOrder"("location");

-- CreateIndex
CREATE INDEX "LabOrder_lab_idx" ON "LabOrder"("lab");

-- CreateIndex
CREATE INDEX "LabOrder_orderedBy_idx" ON "LabOrder"("orderedBy");

-- CreateIndex
CREATE INDEX "LabOrder_chargeLine_idx" ON "LabOrder"("chargeLine");

-- CreateIndex
CREATE INDEX "Specimen_labOrder_idx" ON "Specimen"("labOrder");

-- CreateIndex
CREATE INDEX "Specimen_collectedBy_idx" ON "Specimen"("collectedBy");

-- CreateIndex
CREATE INDEX "LabResult_labOrder_idx" ON "LabResult"("labOrder");

-- CreateIndex
CREATE INDEX "LabResult_observation_idx" ON "LabResult"("observation");

-- CreateIndex
CREATE INDEX "LabResult_supersedes_idx" ON "LabResult"("supersedes");

-- CreateIndex
CREATE INDEX "LabResult_reportDocument_idx" ON "LabResult"("reportDocument");

-- CreateIndex
CREATE INDEX "LabResult_contentHash_idx" ON "LabResult"("contentHash");

-- CreateIndex
CREATE INDEX "LabResultValue_result_idx" ON "LabResultValue"("result");

-- CreateIndex
CREATE INDEX "LabResultValue_analyte_idx" ON "LabResultValue"("analyte");

-- CreateIndex
CREATE INDEX "ResultReview_result_idx" ON "ResultReview"("result");

-- CreateIndex
CREATE INDEX "ResultReview_dvm_idx" ON "ResultReview"("dvm");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingOrder_ref_key" ON "ImagingOrder"("ref");

-- CreateIndex
CREATE INDEX "ImagingOrder_order_idx" ON "ImagingOrder"("order");

-- CreateIndex
CREATE INDEX "ImagingOrder_patient_idx" ON "ImagingOrder"("patient");

-- CreateIndex
CREATE INDEX "ImagingOrder_encounter_idx" ON "ImagingOrder"("encounter");

-- CreateIndex
CREATE INDEX "ImagingOrder_location_idx" ON "ImagingOrder"("location");

-- CreateIndex
CREATE INDEX "ImagingOrder_orderedBy_idx" ON "ImagingOrder"("orderedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingStudy_studyInstanceUid_key" ON "ImagingStudy"("studyInstanceUid");

-- CreateIndex
CREATE INDEX "ImagingStudy_order_idx" ON "ImagingStudy"("order");

-- CreateIndex
CREATE INDEX "ImagingStudy_pacs_idx" ON "ImagingStudy"("pacs");

-- CreateIndex
CREATE INDEX "ImagingReport_study_idx" ON "ImagingReport"("study");

-- CreateIndex
CREATE INDEX "ImagingReport_authorStaff_idx" ON "ImagingReport"("authorStaff");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCredit_entryKey_key" ON "ProductionCredit"("entryKey");

-- CreateIndex
CREATE INDEX "ProductionCredit_staff_idx" ON "ProductionCredit"("staff");

-- CreateIndex
CREATE INDEX "ProductionCredit_chargeLine_idx" ON "ProductionCredit"("chargeLine");

-- CreateIndex
CREATE INDEX "ProductionCredit_invoice_idx" ON "ProductionCredit"("invoice");

-- CreateIndex
CREATE INDEX "ProductionCredit_ruleVersion_idx" ON "ProductionCredit"("ruleVersion");

-- CreateIndex
CREATE INDEX "ProductionCredit_location_idx" ON "ProductionCredit"("location");

-- CreateIndex
CREATE INDEX "ProductionCredit_adjusts_idx" ON "ProductionCredit"("adjusts");

-- CreateIndex
CREATE INDEX "ProductionCredit_requestedBy_idx" ON "ProductionCredit"("requestedBy");

-- CreateIndex
CREATE INDEX "ProductionCredit_approvedBy_idx" ON "ProductionCredit"("approvedBy");

-- CreateIndex
CREATE INDEX "ProductionCredit_period_idx" ON "ProductionCredit"("period");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_entryKey_key" ON "Commission"("entryKey");

-- CreateIndex
CREATE INDEX "Commission_staff_idx" ON "Commission"("staff");

-- CreateIndex
CREATE INDEX "Commission_chargeLine_idx" ON "Commission"("chargeLine");

-- CreateIndex
CREATE INDEX "Commission_ruleVersion_idx" ON "Commission"("ruleVersion");

-- CreateIndex
CREATE INDEX "Commission_period_idx" ON "Commission"("period");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_ref_key" ON "PayPeriod"("ref");

-- CreateIndex
CREATE INDEX "PayPeriod_approvedBy_idx" ON "PayPeriod"("approvedBy");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollExportBatch_ref_key" ON "PayrollExportBatch"("ref");

-- CreateIndex
CREATE INDEX "PayrollExportBatch_period_idx" ON "PayrollExportBatch"("period");

-- CreateIndex
CREATE INDEX "PayrollExportBatch_exportedBy_idx" ON "PayrollExportBatch"("exportedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_ref_key" ON "ExportJob"("ref");

-- CreateIndex
CREATE INDEX "ExportJob_requestedBy_idx" ON "ExportJob"("requestedBy");

-- CreateIndex
CREATE INDEX "Campaign_template_idx" ON "Campaign"("template");

-- CreateIndex
CREATE UNIQUE INDEX "_LabTest_species_AB_unique" ON "_LabTest_species"("A", "B");

-- CreateIndex
CREATE INDEX "_LabTest_species_B_index" ON "_LabTest_species"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_LabOrder_tests_AB_unique" ON "_LabOrder_tests"("A", "B");

-- CreateIndex
CREATE INDEX "_LabOrder_tests_B_index" ON "_LabOrder_tests"("B");

-- CreateIndex
CREATE INDEX "RecordsRequest_verifiedBy_idx" ON "RecordsRequest"("verifiedBy");

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_integration_fkey" FOREIGN KEY ("integration") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_lab_fkey" FOREIGN KEY ("lab") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_feeItem_fkey" FOREIGN KEY ("feeItem") REFERENCES "FeeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalyteMap" ADD CONSTRAINT "LabAnalyteMap_lab_fkey" FOREIGN KEY ("lab") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalyteMap" ADD CONSTRAINT "LabAnalyteMap_analyte_fkey" FOREIGN KEY ("analyte") REFERENCES "Analyte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRange" ADD CONSTRAINT "ReferenceRange_analyte_fkey" FOREIGN KEY ("analyte") REFERENCES "Analyte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRange" ADD CONSTRAINT "ReferenceRange_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRange" ADD CONSTRAINT "ReferenceRange_lab_fkey" FOREIGN KEY ("lab") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_order_fkey" FOREIGN KEY ("order") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_lab_fkey" FOREIGN KEY ("lab") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_orderedBy_fkey" FOREIGN KEY ("orderedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_labOrder_fkey" FOREIGN KEY ("labOrder") REFERENCES "LabOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_collectedBy_fkey" FOREIGN KEY ("collectedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_labOrder_fkey" FOREIGN KEY ("labOrder") REFERENCES "LabOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_observation_fkey" FOREIGN KEY ("observation") REFERENCES "ProviderObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_supersedes_fkey" FOREIGN KEY ("supersedes") REFERENCES "LabResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_reportDocument_fkey" FOREIGN KEY ("reportDocument") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultValue" ADD CONSTRAINT "LabResultValue_result_fkey" FOREIGN KEY ("result") REFERENCES "LabResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultValue" ADD CONSTRAINT "LabResultValue_analyte_fkey" FOREIGN KEY ("analyte") REFERENCES "Analyte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultReview" ADD CONSTRAINT "ResultReview_result_fkey" FOREIGN KEY ("result") REFERENCES "LabResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultReview" ADD CONSTRAINT "ResultReview_dvm_fkey" FOREIGN KEY ("dvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_order_fkey" FOREIGN KEY ("order") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_orderedBy_fkey" FOREIGN KEY ("orderedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_order_fkey" FOREIGN KEY ("order") REFERENCES "ImagingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_pacs_fkey" FOREIGN KEY ("pacs") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_study_fkey" FOREIGN KEY ("study") REFERENCES "ImagingStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_authorStaff_fkey" FOREIGN KEY ("authorStaff") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_staff_fkey" FOREIGN KEY ("staff") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_ruleVersion_fkey" FOREIGN KEY ("ruleVersion") REFERENCES "ProductionRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_adjusts_fkey" FOREIGN KEY ("adjusts") REFERENCES "ProductionCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCredit" ADD CONSTRAINT "ProductionCredit_period_fkey" FOREIGN KEY ("period") REFERENCES "PayPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_staff_fkey" FOREIGN KEY ("staff") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_ruleVersion_fkey" FOREIGN KEY ("ruleVersion") REFERENCES "ProductionRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_period_fkey" FOREIGN KEY ("period") REFERENCES "PayPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportBatch" ADD CONSTRAINT "PayrollExportBatch_period_fkey" FOREIGN KEY ("period") REFERENCES "PayPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportBatch" ADD CONSTRAINT "PayrollExportBatch_exportedBy_fkey" FOREIGN KEY ("exportedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_template_fkey" FOREIGN KEY ("template") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LabTest_species" ADD CONSTRAINT "_LabTest_species_A_fkey" FOREIGN KEY ("A") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LabTest_species" ADD CONSTRAINT "_LabTest_species_B_fkey" FOREIGN KEY ("B") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LabOrder_tests" ADD CONSTRAINT "_LabOrder_tests_A_fkey" FOREIGN KEY ("A") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LabOrder_tests" ADD CONSTRAINT "_LabOrder_tests_B_fkey" FOREIGN KEY ("B") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
