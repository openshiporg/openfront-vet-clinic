-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeScheduleVersion" (
    "id" TEXT NOT NULL,
    "schedule" TEXT,
    "versionNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveFrom" DATE,
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeItem" (
    "id" TEXT NOT NULL,
    "version" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "unit" TEXT NOT NULL DEFAULT '',
    "minimumChargeMinor" BIGINT,
    "dispensingFeeMinor" BIGINT,
    "injectionFeeMinor" BIGINT,
    "markupRate" DECIMAL(12,6),
    "taxCategory" TEXT NOT NULL,
    "productionCategory" TEXT NOT NULL DEFAULT '',
    "orderKind" TEXT NOT NULL DEFAULT '',
    "drug" TEXT,
    "vaccine" TEXT,
    "item" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "version" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "adjustmentBps" INTEGER NOT NULL,
    "conditions" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "encounter" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "acceptedVersion" TEXT,
    "acceptedOption" TEXT,
    "createdBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateVersion" (
    "id" TEXT NOT NULL,
    "estimate" TEXT,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "presentedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "feeScheduleVersion" TEXT,
    "quoteHash" TEXT NOT NULL DEFAULT '',
    "isOverage" BOOLEAN NOT NULL DEFAULT false,
    "overageOf" TEXT,
    "declineReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateOption" (
    "id" TEXT NOT NULL,
    "estimateVersion" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "lowTotalMinor" BIGINT NOT NULL,
    "highTotalMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "option" TEXT,
    "feeItem" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "qtyLow" DECIMAL(18,6) NOT NULL,
    "qtyHigh" DECIMAL(18,6) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "lowMinor" BIGINT NOT NULL,
    "highMinor" BIGINT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateAcceptance" (
    "id" TEXT NOT NULL,
    "estimateVersion" TEXT,
    "option" TEXT,
    "signer" TEXT,
    "method" TEXT NOT NULL,
    "quoteHash" TEXT NOT NULL DEFAULT '',
    "signatureText" TEXT NOT NULL DEFAULT '',
    "witness" TEXT,
    "recordedBy" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlan" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "estimate" TEXT,
    "estimateVersion" TEXT,
    "option" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "acceptedLowMinor" BIGINT NOT NULL,
    "acceptedHighMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlanItem" (
    "id" TEXT NOT NULL,
    "plan" TEXT,
    "estimateLine" TEXT,
    "order" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "projectedMinor" BIGINT NOT NULL,
    "chargedMinor" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverageApproval" (
    "id" TEXT NOT NULL,
    "plan" TEXT,
    "previousHighMinor" BIGINT NOT NULL,
    "newHighMinor" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "approver" TEXT,
    "witness" TEXT,
    "emergencyOverrideBy" TEXT,
    "recordedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverageApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "client" TEXT,
    "estimate" TEXT,
    "plan" TEXT,
    "requestedMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "payment" TEXT,
    "appliedInvoice" TEXT,
    "appliedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArPeriod" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "client" TEXT,
    "location" TEXT,
    "encounter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "postedAt" TIMESTAMP(3),
    "postedOn" DATE,
    "period" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeLine" (
    "id" TEXT NOT NULL,
    "invoice" TEXT,
    "client" TEXT,
    "patient" TEXT,
    "location" TEXT,
    "encounter" TEXT,
    "feeItem" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,6) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "extendedMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxCategory" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "manualReason" TEXT NOT NULL DEFAULT '',
    "performedBy" TEXT,
    "planItem" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "invoice" TEXT,
    "client" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL DEFAULT '',
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "client" TEXT,
    "location" TEXT,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reference" TEXT NOT NULL DEFAULT '',
    "providerRef" TEXT NOT NULL DEFAULT '',
    "payerAuthorization" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "payment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "providerIdempotencyKey" TEXT NOT NULL DEFAULT '',
    "providerRef" TEXT NOT NULL DEFAULT '',
    "amountMinor" BIGINT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "payment" TEXT,
    "invoice" TEXT,
    "deposit" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "payment" TEXT,
    "invoice" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "providerIdempotencyKey" TEXT NOT NULL DEFAULT '',
    "providerRef" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT,
    "approval" TEXT,
    "processedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "eventId" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "objectRef" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "duplicates" INTEGER DEFAULT 0,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLedgerEntry" (
    "id" TEXT NOT NULL,
    "client" TEXT,
    "invoice" TEXT,
    "payment" TEXT,
    "kind" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "postedOn" DATE NOT NULL,
    "period" TEXT,
    "entryKey" TEXT NOT NULL DEFAULT '',
    "memo" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerAuthorization" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "payer" TEXT,
    "invoice" TEXT,
    "policy" TEXT,
    "requestedMinor" BIGINT NOT NULL,
    "authorisedMinor" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "externalRef" TEXT NOT NULL DEFAULT '',
    "validUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayerAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaimPacket" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "policy" TEXT,
    "patient" TEXT,
    "invoice" TEXT,
    "recordsRelease" TEXT,
    "formFields" JSONB DEFAULT '{}',
    "documents" JSONB DEFAULT '[]',
    "submitter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedMinor" BIGINT,
    "paidTo" TEXT,
    "statusNote" TEXT NOT NULL DEFAULT '',
    "packetBody" TEXT NOT NULL DEFAULT '',
    "packetSha256" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceClaimPacket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeSchedule_code_key" ON "FeeSchedule"("code");

-- CreateIndex
CREATE INDEX "FeeScheduleVersion_schedule_idx" ON "FeeScheduleVersion"("schedule");

-- CreateIndex
CREATE INDEX "FeeItem_version_idx" ON "FeeItem"("version");

-- CreateIndex
CREATE INDEX "FeeItem_code_idx" ON "FeeItem"("code");

-- CreateIndex
CREATE INDEX "FeeItem_orderKind_idx" ON "FeeItem"("orderKind");

-- CreateIndex
CREATE INDEX "FeeItem_drug_idx" ON "FeeItem"("drug");

-- CreateIndex
CREATE INDEX "FeeItem_vaccine_idx" ON "FeeItem"("vaccine");

-- CreateIndex
CREATE INDEX "FeeItem_item_idx" ON "FeeItem"("item");

-- CreateIndex
CREATE INDEX "PriceRule_version_idx" ON "PriceRule"("version");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_ref_key" ON "Estimate"("ref");

-- CreateIndex
CREATE INDEX "Estimate_patient_idx" ON "Estimate"("patient");

-- CreateIndex
CREATE INDEX "Estimate_client_idx" ON "Estimate"("client");

-- CreateIndex
CREATE INDEX "Estimate_location_idx" ON "Estimate"("location");

-- CreateIndex
CREATE INDEX "Estimate_encounter_idx" ON "Estimate"("encounter");

-- CreateIndex
CREATE INDEX "Estimate_acceptedVersion_idx" ON "Estimate"("acceptedVersion");

-- CreateIndex
CREATE INDEX "Estimate_acceptedOption_idx" ON "Estimate"("acceptedOption");

-- CreateIndex
CREATE INDEX "Estimate_createdBy_idx" ON "Estimate"("createdBy");

-- CreateIndex
CREATE INDEX "EstimateVersion_estimate_idx" ON "EstimateVersion"("estimate");

-- CreateIndex
CREATE INDEX "EstimateVersion_feeScheduleVersion_idx" ON "EstimateVersion"("feeScheduleVersion");

-- CreateIndex
CREATE INDEX "EstimateVersion_overageOf_idx" ON "EstimateVersion"("overageOf");

-- CreateIndex
CREATE INDEX "EstimateOption_estimateVersion_idx" ON "EstimateOption"("estimateVersion");

-- CreateIndex
CREATE INDEX "EstimateLine_option_idx" ON "EstimateLine"("option");

-- CreateIndex
CREATE INDEX "EstimateLine_feeItem_idx" ON "EstimateLine"("feeItem");

-- CreateIndex
CREATE INDEX "EstimateAcceptance_estimateVersion_idx" ON "EstimateAcceptance"("estimateVersion");

-- CreateIndex
CREATE INDEX "EstimateAcceptance_option_idx" ON "EstimateAcceptance"("option");

-- CreateIndex
CREATE INDEX "EstimateAcceptance_signer_idx" ON "EstimateAcceptance"("signer");

-- CreateIndex
CREATE INDEX "EstimateAcceptance_witness_idx" ON "EstimateAcceptance"("witness");

-- CreateIndex
CREATE INDEX "EstimateAcceptance_recordedBy_idx" ON "EstimateAcceptance"("recordedBy");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPlan_ref_key" ON "TreatmentPlan"("ref");

-- CreateIndex
CREATE INDEX "TreatmentPlan_estimate_idx" ON "TreatmentPlan"("estimate");

-- CreateIndex
CREATE INDEX "TreatmentPlan_estimateVersion_idx" ON "TreatmentPlan"("estimateVersion");

-- CreateIndex
CREATE INDEX "TreatmentPlan_option_idx" ON "TreatmentPlan"("option");

-- CreateIndex
CREATE INDEX "TreatmentPlan_patient_idx" ON "TreatmentPlan"("patient");

-- CreateIndex
CREATE INDEX "TreatmentPlan_client_idx" ON "TreatmentPlan"("client");

-- CreateIndex
CREATE INDEX "TreatmentPlan_location_idx" ON "TreatmentPlan"("location");

-- CreateIndex
CREATE INDEX "TreatmentPlanItem_plan_idx" ON "TreatmentPlanItem"("plan");

-- CreateIndex
CREATE INDEX "TreatmentPlanItem_estimateLine_idx" ON "TreatmentPlanItem"("estimateLine");

-- CreateIndex
CREATE INDEX "TreatmentPlanItem_order_idx" ON "TreatmentPlanItem"("order");

-- CreateIndex
CREATE INDEX "OverageApproval_plan_idx" ON "OverageApproval"("plan");

-- CreateIndex
CREATE INDEX "OverageApproval_approver_idx" ON "OverageApproval"("approver");

-- CreateIndex
CREATE INDEX "OverageApproval_witness_idx" ON "OverageApproval"("witness");

-- CreateIndex
CREATE INDEX "OverageApproval_emergencyOverrideBy_idx" ON "OverageApproval"("emergencyOverrideBy");

-- CreateIndex
CREATE INDEX "OverageApproval_recordedBy_idx" ON "OverageApproval"("recordedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_ref_key" ON "Deposit"("ref");

-- CreateIndex
CREATE INDEX "Deposit_client_idx" ON "Deposit"("client");

-- CreateIndex
CREATE INDEX "Deposit_estimate_idx" ON "Deposit"("estimate");

-- CreateIndex
CREATE INDEX "Deposit_plan_idx" ON "Deposit"("plan");

-- CreateIndex
CREATE INDEX "Deposit_payment_idx" ON "Deposit"("payment");

-- CreateIndex
CREATE INDEX "Deposit_appliedInvoice_idx" ON "Deposit"("appliedInvoice");

-- CreateIndex
CREATE INDEX "ArPeriod_closedBy_idx" ON "ArPeriod"("closedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_ref_key" ON "Invoice"("ref");

-- CreateIndex
CREATE INDEX "Invoice_client_idx" ON "Invoice"("client");

-- CreateIndex
CREATE INDEX "Invoice_location_idx" ON "Invoice"("location");

-- CreateIndex
CREATE INDEX "Invoice_encounter_idx" ON "Invoice"("encounter");

-- CreateIndex
CREATE INDEX "Invoice_period_idx" ON "Invoice"("period");

-- CreateIndex
CREATE INDEX "Invoice_createdBy_idx" ON "Invoice"("createdBy");

-- CreateIndex
CREATE INDEX "ChargeLine_invoice_idx" ON "ChargeLine"("invoice");

-- CreateIndex
CREATE INDEX "ChargeLine_client_idx" ON "ChargeLine"("client");

-- CreateIndex
CREATE INDEX "ChargeLine_patient_idx" ON "ChargeLine"("patient");

-- CreateIndex
CREATE INDEX "ChargeLine_location_idx" ON "ChargeLine"("location");

-- CreateIndex
CREATE INDEX "ChargeLine_encounter_idx" ON "ChargeLine"("encounter");

-- CreateIndex
CREATE INDEX "ChargeLine_feeItem_idx" ON "ChargeLine"("feeItem");

-- CreateIndex
CREATE INDEX "ChargeLine_sourceId_idx" ON "ChargeLine"("sourceId");

-- CreateIndex
CREATE INDEX "ChargeLine_performedBy_idx" ON "ChargeLine"("performedBy");

-- CreateIndex
CREATE INDEX "ChargeLine_planItem_idx" ON "ChargeLine"("planItem");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_ref_key" ON "CreditNote"("ref");

-- CreateIndex
CREATE INDEX "CreditNote_invoice_idx" ON "CreditNote"("invoice");

-- CreateIndex
CREATE INDEX "CreditNote_client_idx" ON "CreditNote"("client");

-- CreateIndex
CREATE INDEX "CreditNote_postedBy_idx" ON "CreditNote"("postedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ref_key" ON "Payment"("ref");

-- CreateIndex
CREATE INDEX "Payment_client_idx" ON "Payment"("client");

-- CreateIndex
CREATE INDEX "Payment_location_idx" ON "Payment"("location");

-- CreateIndex
CREATE INDEX "Payment_providerRef_idx" ON "Payment"("providerRef");

-- CreateIndex
CREATE INDEX "Payment_payerAuthorization_idx" ON "Payment"("payerAuthorization");

-- CreateIndex
CREATE INDEX "Payment_receivedBy_idx" ON "Payment"("receivedBy");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerIdempotencyKey_key" ON "PaymentAttempt"("providerIdempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_payment_idx" ON "PaymentAttempt"("payment");

-- CreateIndex
CREATE INDEX "PaymentAllocation_payment_idx" ON "PaymentAllocation"("payment");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoice_idx" ON "PaymentAllocation"("invoice");

-- CreateIndex
CREATE INDEX "PaymentAllocation_deposit_idx" ON "PaymentAllocation"("deposit");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_ref_key" ON "Refund"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerIdempotencyKey_key" ON "Refund"("providerIdempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_payment_idx" ON "Refund"("payment");

-- CreateIndex
CREATE INDEX "Refund_invoice_idx" ON "Refund"("invoice");

-- CreateIndex
CREATE INDEX "Refund_requestedBy_idx" ON "Refund"("requestedBy");

-- CreateIndex
CREATE INDEX "Refund_approval_idx" ON "Refund"("approval");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_idx" ON "PaymentWebhookEvent"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ClientLedgerEntry_entryKey_key" ON "ClientLedgerEntry"("entryKey");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_client_idx" ON "ClientLedgerEntry"("client");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_invoice_idx" ON "ClientLedgerEntry"("invoice");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_payment_idx" ON "ClientLedgerEntry"("payment");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_period_idx" ON "ClientLedgerEntry"("period");

-- CreateIndex
CREATE UNIQUE INDEX "PayerAuthorization_ref_key" ON "PayerAuthorization"("ref");

-- CreateIndex
CREATE INDEX "PayerAuthorization_payer_idx" ON "PayerAuthorization"("payer");

-- CreateIndex
CREATE INDEX "PayerAuthorization_invoice_idx" ON "PayerAuthorization"("invoice");

-- CreateIndex
CREATE INDEX "PayerAuthorization_policy_idx" ON "PayerAuthorization"("policy");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaimPacket_ref_key" ON "InsuranceClaimPacket"("ref");

-- CreateIndex
CREATE INDEX "InsuranceClaimPacket_policy_idx" ON "InsuranceClaimPacket"("policy");

-- CreateIndex
CREATE INDEX "InsuranceClaimPacket_patient_idx" ON "InsuranceClaimPacket"("patient");

-- CreateIndex
CREATE INDEX "InsuranceClaimPacket_invoice_idx" ON "InsuranceClaimPacket"("invoice");

-- CreateIndex
CREATE INDEX "InsuranceClaimPacket_recordsRelease_idx" ON "InsuranceClaimPacket"("recordsRelease");

-- AddForeignKey
ALTER TABLE "FeeScheduleVersion" ADD CONSTRAINT "FeeScheduleVersion_schedule_fkey" FOREIGN KEY ("schedule") REFERENCES "FeeSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_version_fkey" FOREIGN KEY ("version") REFERENCES "FeeScheduleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_drug_fkey" FOREIGN KEY ("drug") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_vaccine_fkey" FOREIGN KEY ("vaccine") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_item_fkey" FOREIGN KEY ("item") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_version_fkey" FOREIGN KEY ("version") REFERENCES "FeeScheduleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_acceptedVersion_fkey" FOREIGN KEY ("acceptedVersion") REFERENCES "EstimateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_acceptedOption_fkey" FOREIGN KEY ("acceptedOption") REFERENCES "EstimateOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_estimate_fkey" FOREIGN KEY ("estimate") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_feeScheduleVersion_fkey" FOREIGN KEY ("feeScheduleVersion") REFERENCES "FeeScheduleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_overageOf_fkey" FOREIGN KEY ("overageOf") REFERENCES "EstimateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateOption" ADD CONSTRAINT "EstimateOption_estimateVersion_fkey" FOREIGN KEY ("estimateVersion") REFERENCES "EstimateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_option_fkey" FOREIGN KEY ("option") REFERENCES "EstimateOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_feeItem_fkey" FOREIGN KEY ("feeItem") REFERENCES "FeeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAcceptance" ADD CONSTRAINT "EstimateAcceptance_estimateVersion_fkey" FOREIGN KEY ("estimateVersion") REFERENCES "EstimateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAcceptance" ADD CONSTRAINT "EstimateAcceptance_option_fkey" FOREIGN KEY ("option") REFERENCES "EstimateOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAcceptance" ADD CONSTRAINT "EstimateAcceptance_signer_fkey" FOREIGN KEY ("signer") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAcceptance" ADD CONSTRAINT "EstimateAcceptance_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAcceptance" ADD CONSTRAINT "EstimateAcceptance_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_estimate_fkey" FOREIGN KEY ("estimate") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_estimateVersion_fkey" FOREIGN KEY ("estimateVersion") REFERENCES "EstimateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_option_fkey" FOREIGN KEY ("option") REFERENCES "EstimateOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_plan_fkey" FOREIGN KEY ("plan") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_estimateLine_fkey" FOREIGN KEY ("estimateLine") REFERENCES "EstimateLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_order_fkey" FOREIGN KEY ("order") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_plan_fkey" FOREIGN KEY ("plan") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_approver_fkey" FOREIGN KEY ("approver") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_emergencyOverrideBy_fkey" FOREIGN KEY ("emergencyOverrideBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverageApproval" ADD CONSTRAINT "OverageApproval_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_estimate_fkey" FOREIGN KEY ("estimate") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_plan_fkey" FOREIGN KEY ("plan") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_appliedInvoice_fkey" FOREIGN KEY ("appliedInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArPeriod" ADD CONSTRAINT "ArPeriod_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_period_fkey" FOREIGN KEY ("period") REFERENCES "ArPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_feeItem_fkey" FOREIGN KEY ("feeItem") REFERENCES "FeeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_planItem_fkey" FOREIGN KEY ("planItem") REFERENCES "TreatmentPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerAuthorization_fkey" FOREIGN KEY ("payerAuthorization") REFERENCES "PayerAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_deposit_fkey" FOREIGN KEY ("deposit") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approval_fkey" FOREIGN KEY ("approval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_period_fkey" FOREIGN KEY ("period") REFERENCES "ArPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerAuthorization" ADD CONSTRAINT "PayerAuthorization_payer_fkey" FOREIGN KEY ("payer") REFERENCES "ThirdPartyPayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerAuthorization" ADD CONSTRAINT "PayerAuthorization_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerAuthorization" ADD CONSTRAINT "PayerAuthorization_policy_fkey" FOREIGN KEY ("policy") REFERENCES "PetInsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimPacket" ADD CONSTRAINT "InsuranceClaimPacket_policy_fkey" FOREIGN KEY ("policy") REFERENCES "PetInsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimPacket" ADD CONSTRAINT "InsuranceClaimPacket_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimPacket" ADD CONSTRAINT "InsuranceClaimPacket_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimPacket" ADD CONSTRAINT "InsuranceClaimPacket_recordsRelease_fkey" FOREIGN KEY ("recordsRelease") REFERENCES "RecordsRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

