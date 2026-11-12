-- CreateTable
CREATE TABLE "WellnessPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WellnessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessPlanVersion" (
    "id" TEXT NOT NULL,
    "plan" TEXT,
    "versionNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "monthlyPriceMinor" BIGINT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "speciesCodes" JSONB,
    "minAgeWeeks" INTEGER DEFAULT 0,
    "maxAgeMonths" INTEGER,
    "entitlements" JSONB,
    "otherServicesDiscountBps" INTEGER DEFAULT 0,
    "trueUpNote" TEXT NOT NULL DEFAULT '',
    "disclosure" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WellnessPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "plan" TEXT,
    "planVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "startedOn" DATE NOT NULL,
    "termNo" INTEGER DEFAULT 1,
    "termStartsOn" DATE NOT NULL,
    "termEndsOn" DATE NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "cardLabel" TEXT NOT NULL DEFAULT '',
    "customerRef" TEXT NOT NULL DEFAULT '',
    "paymentMethodRef" TEXT NOT NULL DEFAULT '',
    "cardVersion" INTEGER DEFAULT 1,
    "consent" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "trueUpMinor" BIGINT NOT NULL DEFAULT 0,
    "trueUpWaived" BOOLEAN NOT NULL DEFAULT false,
    "trueUpInvoice" TEXT,
    "endedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentConsent" (
    "id" TEXT NOT NULL,
    "enrollment" TEXT,
    "signer" TEXT,
    "disclosureText" TEXT NOT NULL DEFAULT '',
    "disclosureHash" TEXT NOT NULL DEFAULT '',
    "terms" JSONB,
    "method" TEXT NOT NULL,
    "affirmed" BOOLEAN NOT NULL DEFAULT false,
    "setupIntentRef" TEXT NOT NULL DEFAULT '',
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementGrant" (
    "id" TEXT NOT NULL,
    "enrollment" TEXT,
    "termNo" INTEGER NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "qtyGranted" DECIMAL(18,6) NOT NULL,
    "retailValueMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementEntry" (
    "id" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL DEFAULT '',
    "grant" TEXT,
    "enrollment" TEXT,
    "kind" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "chargeLine" TEXT,
    "memo" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanBillingRun" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "runKey" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "periodKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER DEFAULT 0,
    "succeededCount" INTEGER DEFAULT 0,
    "failedCount" INTEGER DEFAULT 0,
    "openCount" INTEGER DEFAULT 0,
    "skippedCount" INTEGER DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "summary" JSONB,
    "startedBy" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanBillingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanBillingAttempt" (
    "id" TEXT NOT NULL,
    "enrollment" TEXT,
    "periodKey" TEXT NOT NULL DEFAULT '',
    "generation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "amountMinor" BIGINT NOT NULL,
    "cardVersion" INTEGER DEFAULT 1,
    "termNo" INTEGER DEFAULT 1,
    "payment" TEXT,
    "invoice" TEXT,
    "chargeLine" TEXT,
    "runKey" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanBillingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "priceMinor" BIGINT NOT NULL,
    "minutes" INTEGER DEFAULT 0,
    "taxCategory" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "speciesCodes" JSONB,
    "maxWeightKg" INTEGER,
    "nightlyRateMinor" BIGINT NOT NULL,
    "depositMinor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "runType" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightlyRunInventory" (
    "id" TEXT NOT NULL,
    "runType" TEXT,
    "location" TEXT,
    "night" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sold" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NightlyRunInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingReservation" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "runType" TEXT,
    "checkInOn" DATE NOT NULL,
    "checkOutOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "holdExpiresAt" TIMESTAMP(3),
    "depositMinor" BIGINT NOT NULL DEFAULT 0,
    "vaccineOverrideReason" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingStay" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "reservation" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "run" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_house',
    "checkedInAt" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "invoice" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardingStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunAssignment" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "run" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunCard" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "reservation" TEXT,
    "feeding" TEXT NOT NULL DEFAULT '',
    "handling" TEXT NOT NULL DEFAULT '',
    "medications" JSONB,
    "emergencyContactName" TEXT NOT NULL DEFAULT '',
    "emergencyContactPhone" TEXT NOT NULL DEFAULT '',
    "medicalLimitMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BelongingItem" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "returnedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BelongingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCareLog" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCareLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroomAppointment" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "groomer" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER DEFAULT 60,
    "service" TEXT NOT NULL DEFAULT '',
    "priceMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "noteVersion" TEXT,
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "invoice" TEXT,
    "commissionBps" INTEGER DEFAULT 0,
    "commissionMinor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroomAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroomNote" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "versionNo" INTEGER NOT NULL,
    "blade" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',
    "behaviour" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroomNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EuthanasiaConsent" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "signer" TEXT,
    "authority" TEXT NOT NULL,
    "authorityNote" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "biteAttestation" TEXT NOT NULL,
    "aftercare" TEXT NOT NULL,
    "clientPresent" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL,
    "witness" TEXT,
    "verbalConfirmedBy" TEXT,
    "verbalConfirmedAt" TIMESTAMP(3),
    "signatureText" TEXT NOT NULL DEFAULT '',
    "signedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EuthanasiaConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeathRecord" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "location" TEXT,
    "cause" TEXT NOT NULL,
    "causeNote" TEXT NOT NULL DEFAULT '',
    "diedAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT,
    "consent" TEXT,
    "administration" TEXT,
    "effects" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeathRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AftercareOrder" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "deathRecord" TEXT,
    "choice" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "tagNumber" TEXT NOT NULL DEFAULT '',
    "crematory" TEXT NOT NULL DEFAULT '',
    "manifestRef" TEXT NOT NULL DEFAULT '',
    "crematoryRef" TEXT NOT NULL DEFAULT '',
    "heldFrom" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AftercareOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" TEXT NOT NULL,
    "order" TEXT,
    "kind" TEXT NOT NULL,
    "tagNumber" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "crematoryRef" TEXT NOT NULL DEFAULT '',
    "receivedBy" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorialItem" (
    "id" TEXT NOT NULL,
    "order" TEXT,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceMinor" BIGINT NOT NULL,
    "chargeLine" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemorialItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WellnessPlan_code_key" ON "WellnessPlan"("code");

-- CreateIndex
CREATE INDEX "WellnessPlanVersion_plan_idx" ON "WellnessPlanVersion"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_ref_key" ON "Enrollment"("ref");

-- CreateIndex
CREATE INDEX "Enrollment_patient_idx" ON "Enrollment"("patient");

-- CreateIndex
CREATE INDEX "Enrollment_client_idx" ON "Enrollment"("client");

-- CreateIndex
CREATE INDEX "Enrollment_location_idx" ON "Enrollment"("location");

-- CreateIndex
CREATE INDEX "Enrollment_plan_idx" ON "Enrollment"("plan");

-- CreateIndex
CREATE INDEX "Enrollment_planVersion_idx" ON "Enrollment"("planVersion");

-- CreateIndex
CREATE INDEX "Enrollment_consent_idx" ON "Enrollment"("consent");

-- CreateIndex
CREATE INDEX "Enrollment_trueUpInvoice_idx" ON "Enrollment"("trueUpInvoice");

-- CreateIndex
CREATE INDEX "EnrollmentConsent_enrollment_idx" ON "EnrollmentConsent"("enrollment");

-- CreateIndex
CREATE INDEX "EnrollmentConsent_signer_idx" ON "EnrollmentConsent"("signer");

-- CreateIndex
CREATE INDEX "EntitlementGrant_enrollment_idx" ON "EntitlementGrant"("enrollment");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementEntry_entryKey_key" ON "EntitlementEntry"("entryKey");

-- CreateIndex
CREATE INDEX "EntitlementEntry_grant_idx" ON "EntitlementEntry"("grant");

-- CreateIndex
CREATE INDEX "EntitlementEntry_enrollment_idx" ON "EntitlementEntry"("enrollment");

-- CreateIndex
CREATE INDEX "EntitlementEntry_chargeLine_idx" ON "EntitlementEntry"("chargeLine");

-- CreateIndex
CREATE INDEX "EntitlementEntry_by_idx" ON "EntitlementEntry"("by");

-- CreateIndex
CREATE UNIQUE INDEX "PlanBillingRun_ref_key" ON "PlanBillingRun"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "PlanBillingRun_runKey_key" ON "PlanBillingRun"("runKey");

-- CreateIndex
CREATE INDEX "PlanBillingRun_location_idx" ON "PlanBillingRun"("location");

-- CreateIndex
CREATE INDEX "PlanBillingRun_periodKey_idx" ON "PlanBillingRun"("periodKey");

-- CreateIndex
CREATE INDEX "PlanBillingRun_startedBy_idx" ON "PlanBillingRun"("startedBy");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_enrollment_idx" ON "PlanBillingAttempt"("enrollment");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_periodKey_idx" ON "PlanBillingAttempt"("periodKey");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_payment_idx" ON "PlanBillingAttempt"("payment");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_invoice_idx" ON "PlanBillingAttempt"("invoice");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_chargeLine_idx" ON "PlanBillingAttempt"("chargeLine");

-- CreateIndex
CREATE INDEX "PlanBillingAttempt_runKey_idx" ON "PlanBillingAttempt"("runKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_code_key" ON "ServiceItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RunType_code_key" ON "RunType"("code");

-- CreateIndex
CREATE INDEX "RunType_location_idx" ON "RunType"("location");

-- CreateIndex
CREATE INDEX "Run_runType_idx" ON "Run"("runType");

-- CreateIndex
CREATE INDEX "Run_location_idx" ON "Run"("location");

-- CreateIndex
CREATE INDEX "NightlyRunInventory_runType_idx" ON "NightlyRunInventory"("runType");

-- CreateIndex
CREATE INDEX "NightlyRunInventory_location_idx" ON "NightlyRunInventory"("location");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingReservation_ref_key" ON "BoardingReservation"("ref");

-- CreateIndex
CREATE INDEX "BoardingReservation_patient_idx" ON "BoardingReservation"("patient");

-- CreateIndex
CREATE INDEX "BoardingReservation_client_idx" ON "BoardingReservation"("client");

-- CreateIndex
CREATE INDEX "BoardingReservation_location_idx" ON "BoardingReservation"("location");

-- CreateIndex
CREATE INDEX "BoardingReservation_runType_idx" ON "BoardingReservation"("runType");

-- CreateIndex
CREATE UNIQUE INDEX "BoardingStay_ref_key" ON "BoardingStay"("ref");

-- CreateIndex
CREATE INDEX "BoardingStay_reservation_idx" ON "BoardingStay"("reservation");

-- CreateIndex
CREATE INDEX "BoardingStay_patient_idx" ON "BoardingStay"("patient");

-- CreateIndex
CREATE INDEX "BoardingStay_client_idx" ON "BoardingStay"("client");

-- CreateIndex
CREATE INDEX "BoardingStay_location_idx" ON "BoardingStay"("location");

-- CreateIndex
CREATE INDEX "BoardingStay_run_idx" ON "BoardingStay"("run");

-- CreateIndex
CREATE INDEX "BoardingStay_invoice_idx" ON "BoardingStay"("invoice");

-- CreateIndex
CREATE INDEX "RunAssignment_stay_idx" ON "RunAssignment"("stay");

-- CreateIndex
CREATE INDEX "RunAssignment_run_idx" ON "RunAssignment"("run");

-- CreateIndex
CREATE INDEX "RunCard_stay_idx" ON "RunCard"("stay");

-- CreateIndex
CREATE INDEX "RunCard_reservation_idx" ON "RunCard"("reservation");

-- CreateIndex
CREATE INDEX "BelongingItem_stay_idx" ON "BelongingItem"("stay");

-- CreateIndex
CREATE INDEX "DailyCareLog_stay_idx" ON "DailyCareLog"("stay");

-- CreateIndex
CREATE INDEX "DailyCareLog_by_idx" ON "DailyCareLog"("by");

-- CreateIndex
CREATE UNIQUE INDEX "GroomAppointment_ref_key" ON "GroomAppointment"("ref");

-- CreateIndex
CREATE INDEX "GroomAppointment_patient_idx" ON "GroomAppointment"("patient");

-- CreateIndex
CREATE INDEX "GroomAppointment_client_idx" ON "GroomAppointment"("client");

-- CreateIndex
CREATE INDEX "GroomAppointment_location_idx" ON "GroomAppointment"("location");

-- CreateIndex
CREATE INDEX "GroomAppointment_groomer_idx" ON "GroomAppointment"("groomer");

-- CreateIndex
CREATE INDEX "GroomAppointment_noteVersion_idx" ON "GroomAppointment"("noteVersion");

-- CreateIndex
CREATE INDEX "GroomAppointment_invoice_idx" ON "GroomAppointment"("invoice");

-- CreateIndex
CREATE INDEX "GroomNote_patient_idx" ON "GroomNote"("patient");

-- CreateIndex
CREATE INDEX "GroomNote_by_idx" ON "GroomNote"("by");

-- CreateIndex
CREATE UNIQUE INDEX "EuthanasiaConsent_ref_key" ON "EuthanasiaConsent"("ref");

-- CreateIndex
CREATE INDEX "EuthanasiaConsent_patient_idx" ON "EuthanasiaConsent"("patient");

-- CreateIndex
CREATE INDEX "EuthanasiaConsent_client_idx" ON "EuthanasiaConsent"("client");

-- CreateIndex
CREATE INDEX "EuthanasiaConsent_signer_idx" ON "EuthanasiaConsent"("signer");

-- CreateIndex
CREATE INDEX "EuthanasiaConsent_witness_idx" ON "EuthanasiaConsent"("witness");

-- CreateIndex
CREATE INDEX "EuthanasiaConsent_verbalConfirmedBy_idx" ON "EuthanasiaConsent"("verbalConfirmedBy");

-- CreateIndex
CREATE INDEX "DeathRecord_patient_idx" ON "DeathRecord"("patient");

-- CreateIndex
CREATE INDEX "DeathRecord_location_idx" ON "DeathRecord"("location");

-- CreateIndex
CREATE INDEX "DeathRecord_recordedBy_idx" ON "DeathRecord"("recordedBy");

-- CreateIndex
CREATE INDEX "DeathRecord_consent_idx" ON "DeathRecord"("consent");

-- CreateIndex
CREATE INDEX "DeathRecord_administration_idx" ON "DeathRecord"("administration");

-- CreateIndex
CREATE UNIQUE INDEX "AftercareOrder_ref_key" ON "AftercareOrder"("ref");

-- CreateIndex
CREATE INDEX "AftercareOrder_patient_idx" ON "AftercareOrder"("patient");

-- CreateIndex
CREATE INDEX "AftercareOrder_client_idx" ON "AftercareOrder"("client");

-- CreateIndex
CREATE INDEX "AftercareOrder_location_idx" ON "AftercareOrder"("location");

-- CreateIndex
CREATE INDEX "AftercareOrder_deathRecord_idx" ON "AftercareOrder"("deathRecord");

-- CreateIndex
CREATE INDEX "CustodyEvent_order_idx" ON "CustodyEvent"("order");

-- CreateIndex
CREATE INDEX "CustodyEvent_by_idx" ON "CustodyEvent"("by");

-- CreateIndex
CREATE INDEX "MemorialItem_order_idx" ON "MemorialItem"("order");

-- CreateIndex
CREATE INDEX "MemorialItem_chargeLine_idx" ON "MemorialItem"("chargeLine");

-- AddForeignKey
ALTER TABLE "WellnessPlanVersion" ADD CONSTRAINT "WellnessPlanVersion_plan_fkey" FOREIGN KEY ("plan") REFERENCES "WellnessPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_plan_fkey" FOREIGN KEY ("plan") REFERENCES "WellnessPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_planVersion_fkey" FOREIGN KEY ("planVersion") REFERENCES "WellnessPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_consent_fkey" FOREIGN KEY ("consent") REFERENCES "EnrollmentConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_trueUpInvoice_fkey" FOREIGN KEY ("trueUpInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_signer_fkey" FOREIGN KEY ("signer") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementEntry" ADD CONSTRAINT "EntitlementEntry_grant_fkey" FOREIGN KEY ("grant") REFERENCES "EntitlementGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementEntry" ADD CONSTRAINT "EntitlementEntry_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementEntry" ADD CONSTRAINT "EntitlementEntry_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementEntry" ADD CONSTRAINT "EntitlementEntry_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingRun" ADD CONSTRAINT "PlanBillingRun_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingRun" ADD CONSTRAINT "PlanBillingRun_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingAttempt" ADD CONSTRAINT "PlanBillingAttempt_enrollment_fkey" FOREIGN KEY ("enrollment") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingAttempt" ADD CONSTRAINT "PlanBillingAttempt_payment_fkey" FOREIGN KEY ("payment") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingAttempt" ADD CONSTRAINT "PlanBillingAttempt_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanBillingAttempt" ADD CONSTRAINT "PlanBillingAttempt_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunType" ADD CONSTRAINT "RunType_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_runType_fkey" FOREIGN KEY ("runType") REFERENCES "RunType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightlyRunInventory" ADD CONSTRAINT "NightlyRunInventory_runType_fkey" FOREIGN KEY ("runType") REFERENCES "RunType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightlyRunInventory" ADD CONSTRAINT "NightlyRunInventory_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingReservation" ADD CONSTRAINT "BoardingReservation_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingReservation" ADD CONSTRAINT "BoardingReservation_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingReservation" ADD CONSTRAINT "BoardingReservation_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingReservation" ADD CONSTRAINT "BoardingReservation_runType_fkey" FOREIGN KEY ("runType") REFERENCES "RunType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_reservation_fkey" FOREIGN KEY ("reservation") REFERENCES "BoardingReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_run_fkey" FOREIGN KEY ("run") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingStay" ADD CONSTRAINT "BoardingStay_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAssignment" ADD CONSTRAINT "RunAssignment_stay_fkey" FOREIGN KEY ("stay") REFERENCES "BoardingStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAssignment" ADD CONSTRAINT "RunAssignment_run_fkey" FOREIGN KEY ("run") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunCard" ADD CONSTRAINT "RunCard_stay_fkey" FOREIGN KEY ("stay") REFERENCES "BoardingStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunCard" ADD CONSTRAINT "RunCard_reservation_fkey" FOREIGN KEY ("reservation") REFERENCES "BoardingReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BelongingItem" ADD CONSTRAINT "BelongingItem_stay_fkey" FOREIGN KEY ("stay") REFERENCES "BoardingStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareLog" ADD CONSTRAINT "DailyCareLog_stay_fkey" FOREIGN KEY ("stay") REFERENCES "BoardingStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCareLog" ADD CONSTRAINT "DailyCareLog_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_groomer_fkey" FOREIGN KEY ("groomer") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_noteVersion_fkey" FOREIGN KEY ("noteVersion") REFERENCES "GroomNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomAppointment" ADD CONSTRAINT "GroomAppointment_invoice_fkey" FOREIGN KEY ("invoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomNote" ADD CONSTRAINT "GroomNote_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroomNote" ADD CONSTRAINT "GroomNote_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_signer_fkey" FOREIGN KEY ("signer") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_witness_fkey" FOREIGN KEY ("witness") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuthanasiaConsent" ADD CONSTRAINT "EuthanasiaConsent_verbalConfirmedBy_fkey" FOREIGN KEY ("verbalConfirmedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathRecord" ADD CONSTRAINT "DeathRecord_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathRecord" ADD CONSTRAINT "DeathRecord_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathRecord" ADD CONSTRAINT "DeathRecord_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathRecord" ADD CONSTRAINT "DeathRecord_consent_fkey" FOREIGN KEY ("consent") REFERENCES "EuthanasiaConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathRecord" ADD CONSTRAINT "DeathRecord_administration_fkey" FOREIGN KEY ("administration") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareOrder" ADD CONSTRAINT "AftercareOrder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareOrder" ADD CONSTRAINT "AftercareOrder_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareOrder" ADD CONSTRAINT "AftercareOrder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareOrder" ADD CONSTRAINT "AftercareOrder_deathRecord_fkey" FOREIGN KEY ("deathRecord") REFERENCES "DeathRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_order_fkey" FOREIGN KEY ("order") REFERENCES "AftercareOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialItem" ADD CONSTRAINT "MemorialItem_order_fkey" FOREIGN KEY ("order") REFERENCES "AftercareOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialItem" ADD CONSTRAINT "MemorialItem_chargeLine_fkey" FOREIGN KEY ("chargeLine") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

