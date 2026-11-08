-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "location" TEXT,
    "appointment" TEXT,
    "stay" TEXT,
    "kind" TEXT NOT NULL,
    "vcprQualifying" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL DEFAULT '',
    "attendingDvm" TEXT,
    "weightUsed" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "signedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL DEFAULT '',
    "signedContent" JSONB,
    "licenseEvaluation" TEXT,
    "vcpr" TEXT,
    "document" TEXT,
    "policyVersion" TEXT,
    "completeness" JSONB,
    "voidReason" TEXT NOT NULL DEFAULT '',
    "voidApproval" TEXT,
    "importedFrom" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoapSection" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "kind" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "body" TEXT NOT NULL DEFAULT '',
    "structured" JSONB,
    "source" TEXT NOT NULL,
    "lastAuthor" TEXT,
    "lockedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoapSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoapSectionRevision" (
    "id" TEXT NOT NULL,
    "section" TEXT,
    "revisionNumber" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "structured" JSONB,
    "source" TEXT NOT NULL,
    "template" TEXT,
    "scribeDraft" TEXT,
    "author" TEXT,
    "authorUser" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SoapSectionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Addendum" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "sectionKind" TEXT NOT NULL,
    "author" TEXT,
    "authorIsDvm" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "signedAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Addendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalsObservation" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "patient" TEXT,
    "temperature" DECIMAL(18,6),
    "temperatureUnit" TEXT NOT NULL DEFAULT 'F',
    "heartRate" INTEGER,
    "respRate" INTEGER,
    "mucousMembranes" TEXT,
    "crtSeconds" DECIMAL(18,6),
    "painScore" INTEGER,
    "bodyConditionScore" INTEGER,
    "mentation" TEXT,
    "hydrationPct" DECIMAL(18,6),
    "at" TIMESTAMP(3) NOT NULL,
    "by" TEXT,

    CONSTRAINT "VitalsObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalExamFinding" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "system" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhysicalExamFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosisCode" (
    "id" TEXT NOT NULL,
    "codeSystem" TEXT NOT NULL DEFAULT 'practice',
    "code" TEXT NOT NULL DEFAULT '',
    "term" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "encounter" TEXT,
    "code" TEXT,
    "term" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "chronic" BOOLEAN NOT NULL DEFAULT false,
    "onset" DATE,
    "resolvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "patient" TEXT,
    "code" TEXT,
    "term" TEXT NOT NULL DEFAULT '',
    "certainty" TEXT NOT NULL,
    "problem" TEXT,
    "by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalAttachment" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "patient" TEXT,
    "kind" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "document" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "encounter" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending_render',
    "sourceType" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "sourceHash" TEXT NOT NULL DEFAULT '',
    "document" TEXT,
    "signedBy" TEXT,
    "renderedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'wellness',
    "sectionKind" TEXT NOT NULL DEFAULT 'objective',
    "species" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "templateVersion" INTEGER DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Glossary" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL DEFAULT '',
    "expansion" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Glossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScribeSession" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "startedBy" TEXT,
    "startedByAgent" TEXT,
    "clientConsent" TEXT,
    "staffAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "audioDocument" TEXT,
    "audioDeleteAfter" TIMESTAMP(3),
    "transcriptRef" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '',
    "transcriptionProvider" TEXT NOT NULL DEFAULT '',
    "modelProvider" TEXT NOT NULL DEFAULT '',
    "modelRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'recording',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScribeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScribeDraft" (
    "id" TEXT NOT NULL,
    "session" TEXT,
    "sections" JSONB,
    "suggestedCharges" JSONB,
    "confidence" DECIMAL(12,6),
    "modelRef" TEXT NOT NULL DEFAULT '',
    "acceptedBlocks" JSONB,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScribeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "encounter" TEXT,
    "direction" TEXT NOT NULL,
    "hospital" TEXT,
    "referringVet" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "urgency" TEXT NOT NULL,
    "recordsRelease" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "encounter" TEXT,
    "patient" TEXT,
    "location" TEXT,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "drug" TEXT,
    "vaccine" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "orderedBy" TEXT,
    "licenseEvaluation" TEXT,
    "dose" TEXT,
    "frequency" TEXT NOT NULL DEFAULT '',
    "schedule" JSONB,
    "route" TEXT NOT NULL,
    "quantity" DECIMAL(18,6),
    "quantityUnit" TEXT,
    "extralabel" BOOLEAN NOT NULL DEFAULT false,
    "emergencyStabilisation" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT NOT NULL DEFAULT '',
    "warnings" JSONB DEFAULT '[]',
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoseCalculation" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "weight" TEXT,
    "weightKg" DECIMAL(10,4) NOT NULL,
    "weightAgeHours" INTEGER,
    "doseAmount" DECIMAL(18,6) NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "dosePer" TEXT NOT NULL,
    "bsaM2" DECIMAL(18,6),
    "bsaConstant" DECIMAL(18,6),
    "totalAmount" DECIMAL(18,6) NOT NULL,
    "totalUnit" TEXT NOT NULL DEFAULT '',
    "product" TEXT,
    "concentration" DECIMAL(18,6),
    "concentrationUnit" TEXT NOT NULL DEFAULT '',
    "computedQty" DECIMAL(18,6),
    "computedUnit" TEXT NOT NULL DEFAULT '',
    "roundingRule" JSONB,
    "roundedQty" DECIMAL(18,6),
    "deliveredAmount" DECIMAL(18,6),
    "deviationBps" INTEGER,
    "manualOverrideQty" DECIMAL(18,6),
    "overrideReason" TEXT NOT NULL DEFAULT '',
    "warnings" JSONB DEFAULT '[]',
    "calcVersion" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoseCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "drug" TEXT,
    "vaccine" TEXT,
    "location" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "expiresOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "quarantineReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Administration" (
    "id" TEXT NOT NULL,
    "order" TEXT,
    "patient" TEXT,
    "encounter" TEXT,
    "treatmentTask" TEXT,
    "lot" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "lotExpiresOn" DATE,
    "csContainer" TEXT,
    "csLogEntry" TEXT,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "givenBy" TEXT,
    "supervisingDvm" TEXT,
    "givenAt" TIMESTAMP(3) NOT NULL,
    "wasteQty" DECIMAL(18,6),
    "reverses" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Administration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "location" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cage" (
    "id" TEXT NOT NULL,
    "ward" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT 'medium',
    "features" JSONB DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalStay" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "location" TEXT,
    "encounter" TEXT,
    "cage" TEXT,
    "admittedAt" TIMESTAMP(3) NOT NULL,
    "dischargedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "codeStatus" TEXT NOT NULL,
    "attendingDvm" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CageAssignment" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "cage" TEXT,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CageAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentSheetOrder" (
    "id" TEXT NOT NULL,
    "stay" TEXT,
    "order" TEXT,
    "patient" TEXT,
    "frequency" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "instructions" TEXT NOT NULL DEFAULT '',
    "materialisedThrough" TIMESTAMP(3),
    "graceMinutes" INTEGER DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentSheetOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentTask" (
    "id" TEXT NOT NULL,
    "sheetOrder" TEXT,
    "stay" TEXT,
    "patient" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "doneBy" TEXT,
    "doneAt" TIMESTAMP(3),
    "skipReason" TEXT NOT NULL DEFAULT '',
    "rescheduledTo" TEXT,
    "administration" TEXT,
    "observation" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnaesthesiaRecord" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "encounter" TEXT,
    "patient" TEXT,
    "procedure" TEXT NOT NULL DEFAULT '',
    "asaStatus" TEXT NOT NULL,
    "fastingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "preWeight" TEXT,
    "ivCatheter" JSONB,
    "protocol" JSONB,
    "checklist" JSONB,
    "inductionAt" TIMESTAMP(3),
    "intubatedAt" TIMESTAMP(3),
    "extubatedAt" TIMESTAMP(3),
    "recoveryEndAt" TIMESTAMP(3),
    "anaesthetist" TEXT,
    "dvm" TEXT,
    "licenseEvaluation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "complications" TEXT NOT NULL DEFAULT '',
    "closedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnaesthesiaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringReading" (
    "id" TEXT NOT NULL,
    "record" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "hr" INTEGER,
    "rr" INTEGER,
    "spo2" INTEGER,
    "etco2" INTEGER,
    "sbp" INTEGER,
    "dbp" INTEGER,
    "map" INTEGER,
    "tempC" DECIMAL(18,6),
    "agentPct" DECIMAL(18,6),
    "o2FlowLpm" DECIMAL(18,6),
    "fluidsRateMlHr" DECIMAL(18,6),
    "notes" TEXT NOT NULL DEFAULT '',
    "by" TEXT,

    CONSTRAINT "MonitoringReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryReport" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "procedure" TEXT NOT NULL DEFAULT '',
    "surgeon" TEXT,
    "assistant" TEXT,
    "technique" TEXT NOT NULL DEFAULT '',
    "findings" TEXT NOT NULL DEFAULT '',
    "closure" TEXT NOT NULL DEFAULT '',
    "sutures" TEXT NOT NULL DEFAULT '',
    "specimens" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalChart" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "patient" TEXT,
    "teeth" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DentalChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DischargeInstruction" (
    "id" TEXT NOT NULL,
    "encounter" TEXT,
    "stay" TEXT,
    "patient" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "medsSummary" TEXT NOT NULL DEFAULT '',
    "recheckOn" DATE,
    "sentAt" TIMESTAMP(3),
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DischargeInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccineProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "antigens" JSONB DEFAULT '[]',
    "licensedDoiMonths" INTEGER NOT NULL DEFAULT 12,
    "minAgeWeeks" INTEGER NOT NULL DEFAULT 8,
    "isRabies" BOOLEAN NOT NULL DEFAULT false,
    "usdaProductCode" TEXT NOT NULL DEFAULT '',
    "defaultRoute" TEXT NOT NULL DEFAULT 'sc',
    "reminderType" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaccineProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccineAdministration" (
    "id" TEXT NOT NULL,
    "administration" TEXT,
    "patient" TEXT,
    "encounter" TEXT,
    "product" TEXT,
    "lot" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "lotExpiresOn" DATE NOT NULL,
    "doseSeries" INTEGER NOT NULL,
    "isInitialSeries" BOOLEAN NOT NULL DEFAULT false,
    "route" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "administeredOn" DATE NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "dueNextOn" DATE NOT NULL,
    "vaccinatedBy" TEXT,
    "supervisingDvm" TEXT,
    "policyVersions" JSONB,
    "certificate" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "VaccineAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RabiesCertificate" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "ownerSnapshot" JSONB,
    "patientSnapshot" JSONB,
    "vaccineSnapshot" JSONB,
    "vetSnapshot" JSONB,
    "vaccinatedOn" DATE NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "nextDueOn" DATE NOT NULL,
    "tagNumber" TEXT NOT NULL DEFAULT '',
    "tagJurisdiction" TEXT NOT NULL DEFAULT '',
    "fields" JSONB,
    "missingFields" JSONB DEFAULT '[]',
    "document" TEXT,
    "reportedTo" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "policyVersions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RabiesCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'vaccine',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderProtocol" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "species" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderProtocolVersion" (
    "id" TEXT NOT NULL,
    "protocol" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "versionNumber" INTEGER NOT NULL,
    "sourceRefs" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "unverifiedRules" JSONB DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderProtocolVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "protocolVersion" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "triggerServiceCode" TEXT NOT NULL DEFAULT '',
    "satisfies" TEXT,
    "schedule" JSONB,
    "leadDays" INTEGER DEFAULT 30,
    "graceDays" INTEGER DEFAULT 30,
    "lapseDays" INTEGER DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientReminder" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "location" TEXT,
    "type" TEXT,
    "rule" TEXT,
    "dueOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "suppressedReason" TEXT NOT NULL DEFAULT '',
    "protocolVersion" TEXT,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL DEFAULT '',
    "lastNotifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSatisfaction" (
    "id" TEXT NOT NULL,
    "reminder" TEXT,
    "sourceKey" TEXT NOT NULL DEFAULT '',
    "vaccineAdministration" TEXT,
    "administration" TEXT,
    "externalEvidence" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSatisfaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdverseEventReport" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "vaccineAdministration" TEXT,
    "administration" TEXT,
    "product" TEXT,
    "drug" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL,
    "reportedTo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reference" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdverseEventReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "system" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "location" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'received',
    "rowsTotal" INTEGER DEFAULT 0,
    "rowsCreated" INTEGER DEFAULT 0,
    "rowsSkipped" INTEGER DEFAULT 0,
    "rowsFailed" INTEGER DEFAULT 0,
    "mapping" JSONB,
    "startedBy" TEXT,
    "finishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batch" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL,
    "recordType" TEXT NOT NULL DEFAULT '',
    "recordId" TEXT NOT NULL DEFAULT '',
    "errors" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VaccineProduct_species" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_Encounter_participants" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_DiagnosisCode_species" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_ReminderRule_triggerVaccines" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_ref_key" ON "Encounter"("ref");

-- CreateIndex
CREATE INDEX "Encounter_patient_idx" ON "Encounter"("patient");

-- CreateIndex
CREATE INDEX "Encounter_location_idx" ON "Encounter"("location");

-- CreateIndex
CREATE INDEX "Encounter_appointment_idx" ON "Encounter"("appointment");

-- CreateIndex
CREATE INDEX "Encounter_stay_idx" ON "Encounter"("stay");

-- CreateIndex
CREATE INDEX "Encounter_attendingDvm_idx" ON "Encounter"("attendingDvm");

-- CreateIndex
CREATE INDEX "Encounter_weightUsed_idx" ON "Encounter"("weightUsed");

-- CreateIndex
CREATE INDEX "Encounter_signedBy_idx" ON "Encounter"("signedBy");

-- CreateIndex
CREATE INDEX "Encounter_licenseEvaluation_idx" ON "Encounter"("licenseEvaluation");

-- CreateIndex
CREATE INDEX "Encounter_vcpr_idx" ON "Encounter"("vcpr");

-- CreateIndex
CREATE INDEX "Encounter_document_idx" ON "Encounter"("document");

-- CreateIndex
CREATE INDEX "Encounter_policyVersion_idx" ON "Encounter"("policyVersion");

-- CreateIndex
CREATE INDEX "Encounter_voidApproval_idx" ON "Encounter"("voidApproval");

-- CreateIndex
CREATE INDEX "SoapSection_encounter_idx" ON "SoapSection"("encounter");

-- CreateIndex
CREATE INDEX "SoapSection_lastAuthor_idx" ON "SoapSection"("lastAuthor");

-- CreateIndex
CREATE UNIQUE INDEX "SoapSection_encounter_kind_ordinal_key" ON "SoapSection"("encounter", "kind", "ordinal");

-- CreateIndex
CREATE INDEX "SoapSectionRevision_section_idx" ON "SoapSectionRevision"("section");

-- CreateIndex
CREATE INDEX "SoapSectionRevision_template_idx" ON "SoapSectionRevision"("template");

-- CreateIndex
CREATE INDEX "SoapSectionRevision_scribeDraft_idx" ON "SoapSectionRevision"("scribeDraft");

-- CreateIndex
CREATE INDEX "SoapSectionRevision_author_idx" ON "SoapSectionRevision"("author");

-- CreateIndex
CREATE INDEX "SoapSectionRevision_authorUser_idx" ON "SoapSectionRevision"("authorUser");

-- CreateIndex
CREATE UNIQUE INDEX "SoapSectionRevision_section_number_key" ON "SoapSectionRevision"("section", "revisionNumber");

-- CreateIndex
CREATE INDEX "Addendum_encounter_idx" ON "Addendum"("encounter");

-- CreateIndex
CREATE INDEX "Addendum_author_idx" ON "Addendum"("author");

-- CreateIndex
CREATE INDEX "VitalsObservation_encounter_idx" ON "VitalsObservation"("encounter");

-- CreateIndex
CREATE INDEX "VitalsObservation_patient_idx" ON "VitalsObservation"("patient");

-- CreateIndex
CREATE INDEX "VitalsObservation_by_idx" ON "VitalsObservation"("by");

-- CreateIndex
CREATE INDEX "PhysicalExamFinding_encounter_idx" ON "PhysicalExamFinding"("encounter");

-- CreateIndex
CREATE INDEX "PhysicalExamFinding_by_idx" ON "PhysicalExamFinding"("by");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisCode_system_code_key" ON "DiagnosisCode"("codeSystem", "code");

-- CreateIndex
CREATE INDEX "Problem_patient_idx" ON "Problem"("patient");

-- CreateIndex
CREATE INDEX "Problem_encounter_idx" ON "Problem"("encounter");

-- CreateIndex
CREATE INDEX "Problem_code_idx" ON "Problem"("code");

-- CreateIndex
CREATE INDEX "Diagnosis_encounter_idx" ON "Diagnosis"("encounter");

-- CreateIndex
CREATE INDEX "Diagnosis_patient_idx" ON "Diagnosis"("patient");

-- CreateIndex
CREATE INDEX "Diagnosis_code_idx" ON "Diagnosis"("code");

-- CreateIndex
CREATE INDEX "Diagnosis_problem_idx" ON "Diagnosis"("problem");

-- CreateIndex
CREATE INDEX "Diagnosis_by_idx" ON "Diagnosis"("by");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_encounter_idx" ON "ClinicalAttachment"("encounter");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_patient_idx" ON "ClinicalAttachment"("patient");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_document_idx" ON "ClinicalAttachment"("document");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_addedBy_idx" ON "ClinicalAttachment"("addedBy");

-- CreateIndex
CREATE INDEX "ClinicalDocument_patient_idx" ON "ClinicalDocument"("patient");

-- CreateIndex
CREATE INDEX "ClinicalDocument_encounter_idx" ON "ClinicalDocument"("encounter");

-- CreateIndex
CREATE INDEX "ClinicalDocument_sourceId_idx" ON "ClinicalDocument"("sourceId");

-- CreateIndex
CREATE INDEX "ClinicalDocument_document_idx" ON "ClinicalDocument"("document");

-- CreateIndex
CREATE INDEX "ClinicalDocument_signedBy_idx" ON "ClinicalDocument"("signedBy");

-- CreateIndex
CREATE INDEX "RecordTemplate_species_idx" ON "RecordTemplate"("species");

-- CreateIndex
CREATE UNIQUE INDEX "Glossary_term_key" ON "Glossary"("term");

-- CreateIndex
CREATE INDEX "ScribeSession_encounter_idx" ON "ScribeSession"("encounter");

-- CreateIndex
CREATE INDEX "ScribeSession_startedBy_idx" ON "ScribeSession"("startedBy");

-- CreateIndex
CREATE INDEX "ScribeSession_startedByAgent_idx" ON "ScribeSession"("startedByAgent");

-- CreateIndex
CREATE INDEX "ScribeSession_clientConsent_idx" ON "ScribeSession"("clientConsent");

-- CreateIndex
CREATE INDEX "ScribeSession_audioDocument_idx" ON "ScribeSession"("audioDocument");

-- CreateIndex
CREATE INDEX "ScribeDraft_session_idx" ON "ScribeDraft"("session");

-- CreateIndex
CREATE INDEX "ScribeDraft_decidedBy_idx" ON "ScribeDraft"("decidedBy");

-- CreateIndex
CREATE INDEX "Referral_patient_idx" ON "Referral"("patient");

-- CreateIndex
CREATE INDEX "Referral_encounter_idx" ON "Referral"("encounter");

-- CreateIndex
CREATE INDEX "Referral_hospital_idx" ON "Referral"("hospital");

-- CreateIndex
CREATE INDEX "Referral_referringVet_idx" ON "Referral"("referringVet");

-- CreateIndex
CREATE INDEX "Referral_recordsRelease_idx" ON "Referral"("recordsRelease");

-- CreateIndex
CREATE INDEX "Referral_createdBy_idx" ON "Referral"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_ref_key" ON "ClinicalOrder"("ref");

-- CreateIndex
CREATE INDEX "ClinicalOrder_encounter_idx" ON "ClinicalOrder"("encounter");

-- CreateIndex
CREATE INDEX "ClinicalOrder_patient_idx" ON "ClinicalOrder"("patient");

-- CreateIndex
CREATE INDEX "ClinicalOrder_location_idx" ON "ClinicalOrder"("location");

-- CreateIndex
CREATE INDEX "ClinicalOrder_drug_idx" ON "ClinicalOrder"("drug");

-- CreateIndex
CREATE INDEX "ClinicalOrder_vaccine_idx" ON "ClinicalOrder"("vaccine");

-- CreateIndex
CREATE INDEX "ClinicalOrder_orderedBy_idx" ON "ClinicalOrder"("orderedBy");

-- CreateIndex
CREATE INDEX "ClinicalOrder_licenseEvaluation_idx" ON "ClinicalOrder"("licenseEvaluation");

-- CreateIndex
CREATE INDEX "ClinicalOrder_dose_idx" ON "ClinicalOrder"("dose");

-- CreateIndex
CREATE INDEX "DoseCalculation_patient_idx" ON "DoseCalculation"("patient");

-- CreateIndex
CREATE INDEX "DoseCalculation_weight_idx" ON "DoseCalculation"("weight");

-- CreateIndex
CREATE INDEX "DoseCalculation_product_idx" ON "DoseCalculation"("product");

-- CreateIndex
CREATE INDEX "DoseCalculation_by_idx" ON "DoseCalculation"("by");

-- CreateIndex
CREATE INDEX "InventoryLot_drug_idx" ON "InventoryLot"("drug");

-- CreateIndex
CREATE INDEX "InventoryLot_vaccine_idx" ON "InventoryLot"("vaccine");

-- CreateIndex
CREATE INDEX "InventoryLot_location_idx" ON "InventoryLot"("location");

-- CreateIndex
CREATE INDEX "Administration_order_idx" ON "Administration"("order");

-- CreateIndex
CREATE INDEX "Administration_patient_idx" ON "Administration"("patient");

-- CreateIndex
CREATE INDEX "Administration_encounter_idx" ON "Administration"("encounter");

-- CreateIndex
CREATE INDEX "Administration_treatmentTask_idx" ON "Administration"("treatmentTask");

-- CreateIndex
CREATE INDEX "Administration_lot_idx" ON "Administration"("lot");

-- CreateIndex
CREATE INDEX "Administration_csContainer_idx" ON "Administration"("csContainer");

-- CreateIndex
CREATE INDEX "Administration_csLogEntry_idx" ON "Administration"("csLogEntry");

-- CreateIndex
CREATE INDEX "Administration_givenBy_idx" ON "Administration"("givenBy");

-- CreateIndex
CREATE INDEX "Administration_supervisingDvm_idx" ON "Administration"("supervisingDvm");

-- CreateIndex
CREATE INDEX "Administration_reverses_idx" ON "Administration"("reverses");

-- CreateIndex
CREATE INDEX "Ward_location_idx" ON "Ward"("location");

-- CreateIndex
CREATE UNIQUE INDEX "Cage_code_key" ON "Cage"("code");

-- CreateIndex
CREATE INDEX "Cage_ward_idx" ON "Cage"("ward");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalStay_ref_key" ON "HospitalStay"("ref");

-- CreateIndex
CREATE INDEX "HospitalStay_patient_idx" ON "HospitalStay"("patient");

-- CreateIndex
CREATE INDEX "HospitalStay_location_idx" ON "HospitalStay"("location");

-- CreateIndex
CREATE INDEX "HospitalStay_encounter_idx" ON "HospitalStay"("encounter");

-- CreateIndex
CREATE INDEX "HospitalStay_cage_idx" ON "HospitalStay"("cage");

-- CreateIndex
CREATE INDEX "HospitalStay_attendingDvm_idx" ON "HospitalStay"("attendingDvm");

-- CreateIndex
CREATE INDEX "CageAssignment_stay_idx" ON "CageAssignment"("stay");

-- CreateIndex
CREATE INDEX "CageAssignment_cage_idx" ON "CageAssignment"("cage");

-- CreateIndex
CREATE INDEX "TreatmentSheetOrder_stay_idx" ON "TreatmentSheetOrder"("stay");

-- CreateIndex
CREATE INDEX "TreatmentSheetOrder_order_idx" ON "TreatmentSheetOrder"("order");

-- CreateIndex
CREATE INDEX "TreatmentSheetOrder_patient_idx" ON "TreatmentSheetOrder"("patient");

-- CreateIndex
CREATE INDEX "TreatmentTask_sheetOrder_idx" ON "TreatmentTask"("sheetOrder");

-- CreateIndex
CREATE INDEX "TreatmentTask_stay_idx" ON "TreatmentTask"("stay");

-- CreateIndex
CREATE INDEX "TreatmentTask_patient_idx" ON "TreatmentTask"("patient");

-- CreateIndex
CREATE INDEX "TreatmentTask_doneBy_idx" ON "TreatmentTask"("doneBy");

-- CreateIndex
CREATE INDEX "TreatmentTask_rescheduledTo_idx" ON "TreatmentTask"("rescheduledTo");

-- CreateIndex
CREATE INDEX "TreatmentTask_administration_idx" ON "TreatmentTask"("administration");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentTask_sheet_due_key" ON "TreatmentTask"("sheetOrder", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnaesthesiaRecord_ref_key" ON "AnaesthesiaRecord"("ref");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_encounter_idx" ON "AnaesthesiaRecord"("encounter");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_patient_idx" ON "AnaesthesiaRecord"("patient");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_preWeight_idx" ON "AnaesthesiaRecord"("preWeight");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_anaesthetist_idx" ON "AnaesthesiaRecord"("anaesthetist");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_dvm_idx" ON "AnaesthesiaRecord"("dvm");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_licenseEvaluation_idx" ON "AnaesthesiaRecord"("licenseEvaluation");

-- CreateIndex
CREATE INDEX "AnaesthesiaRecord_closedBy_idx" ON "AnaesthesiaRecord"("closedBy");

-- CreateIndex
CREATE INDEX "MonitoringReading_record_idx" ON "MonitoringReading"("record");

-- CreateIndex
CREATE INDEX "MonitoringReading_by_idx" ON "MonitoringReading"("by");

-- CreateIndex
CREATE INDEX "SurgeryReport_encounter_idx" ON "SurgeryReport"("encounter");

-- CreateIndex
CREATE INDEX "SurgeryReport_surgeon_idx" ON "SurgeryReport"("surgeon");

-- CreateIndex
CREATE INDEX "SurgeryReport_assistant_idx" ON "SurgeryReport"("assistant");

-- CreateIndex
CREATE INDEX "DentalChart_encounter_idx" ON "DentalChart"("encounter");

-- CreateIndex
CREATE INDEX "DentalChart_patient_idx" ON "DentalChart"("patient");

-- CreateIndex
CREATE INDEX "DischargeInstruction_encounter_idx" ON "DischargeInstruction"("encounter");

-- CreateIndex
CREATE INDEX "DischargeInstruction_stay_idx" ON "DischargeInstruction"("stay");

-- CreateIndex
CREATE INDEX "DischargeInstruction_patient_idx" ON "DischargeInstruction"("patient");

-- CreateIndex
CREATE INDEX "DischargeInstruction_author_idx" ON "DischargeInstruction"("author");

-- CreateIndex
CREATE INDEX "VaccineProduct_reminderType_idx" ON "VaccineProduct"("reminderType");

-- CreateIndex
CREATE INDEX "VaccineAdministration_administration_idx" ON "VaccineAdministration"("administration");

-- CreateIndex
CREATE INDEX "VaccineAdministration_patient_idx" ON "VaccineAdministration"("patient");

-- CreateIndex
CREATE INDEX "VaccineAdministration_encounter_idx" ON "VaccineAdministration"("encounter");

-- CreateIndex
CREATE INDEX "VaccineAdministration_product_idx" ON "VaccineAdministration"("product");

-- CreateIndex
CREATE INDEX "VaccineAdministration_lot_idx" ON "VaccineAdministration"("lot");

-- CreateIndex
CREATE INDEX "VaccineAdministration_vaccinatedBy_idx" ON "VaccineAdministration"("vaccinatedBy");

-- CreateIndex
CREATE INDEX "VaccineAdministration_supervisingDvm_idx" ON "VaccineAdministration"("supervisingDvm");

-- CreateIndex
CREATE INDEX "VaccineAdministration_certificate_idx" ON "VaccineAdministration"("certificate");

-- CreateIndex
CREATE UNIQUE INDEX "RabiesCertificate_ref_key" ON "RabiesCertificate"("ref");

-- CreateIndex
CREATE INDEX "RabiesCertificate_patient_idx" ON "RabiesCertificate"("patient");

-- CreateIndex
CREATE INDEX "RabiesCertificate_document_idx" ON "RabiesCertificate"("document");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderType_code_key" ON "ReminderType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderProtocol_code_key" ON "ReminderProtocol"("code");

-- CreateIndex
CREATE INDEX "ReminderProtocol_species_idx" ON "ReminderProtocol"("species");

-- CreateIndex
CREATE INDEX "ReminderProtocolVersion_protocol_idx" ON "ReminderProtocolVersion"("protocol");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderProtocolVersion_protocol_number_key" ON "ReminderProtocolVersion"("protocol", "versionNumber");

-- CreateIndex
CREATE INDEX "ReminderRule_protocolVersion_idx" ON "ReminderRule"("protocolVersion");

-- CreateIndex
CREATE INDEX "ReminderRule_satisfies_idx" ON "ReminderRule"("satisfies");

-- CreateIndex
CREATE INDEX "PatientReminder_patient_idx" ON "PatientReminder"("patient");

-- CreateIndex
CREATE INDEX "PatientReminder_location_idx" ON "PatientReminder"("location");

-- CreateIndex
CREATE INDEX "PatientReminder_type_idx" ON "PatientReminder"("type");

-- CreateIndex
CREATE INDEX "PatientReminder_rule_idx" ON "PatientReminder"("rule");

-- CreateIndex
CREATE INDEX "PatientReminder_protocolVersion_idx" ON "PatientReminder"("protocolVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PatientReminder_patient_type_due_key" ON "PatientReminder"("patient", "type", "dueOn");

-- CreateIndex
CREATE INDEX "ReminderSatisfaction_reminder_idx" ON "ReminderSatisfaction"("reminder");

-- CreateIndex
CREATE INDEX "ReminderSatisfaction_vaccineAdministration_idx" ON "ReminderSatisfaction"("vaccineAdministration");

-- CreateIndex
CREATE INDEX "ReminderSatisfaction_administration_idx" ON "ReminderSatisfaction"("administration");

-- CreateIndex
CREATE INDEX "ReminderSatisfaction_externalEvidence_idx" ON "ReminderSatisfaction"("externalEvidence");

-- CreateIndex
CREATE INDEX "ReminderSatisfaction_recordedBy_idx" ON "ReminderSatisfaction"("recordedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSatisfaction_reminder_source_key" ON "ReminderSatisfaction"("reminder", "sourceKey");

-- CreateIndex
CREATE INDEX "AdverseEventReport_patient_idx" ON "AdverseEventReport"("patient");

-- CreateIndex
CREATE INDEX "AdverseEventReport_vaccineAdministration_idx" ON "AdverseEventReport"("vaccineAdministration");

-- CreateIndex
CREATE INDEX "AdverseEventReport_administration_idx" ON "AdverseEventReport"("administration");

-- CreateIndex
CREATE INDEX "AdverseEventReport_product_idx" ON "AdverseEventReport"("product");

-- CreateIndex
CREATE INDEX "AdverseEventReport_drug_idx" ON "AdverseEventReport"("drug");

-- CreateIndex
CREATE INDEX "AdverseEventReport_createdBy_idx" ON "AdverseEventReport"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_ref_key" ON "ImportBatch"("ref");

-- CreateIndex
CREATE INDEX "ImportBatch_location_idx" ON "ImportBatch"("location");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportBatch_startedBy_idx" ON "ImportBatch"("startedBy");

-- CreateIndex
CREATE INDEX "ImportRow_batch_idx" ON "ImportRow"("batch");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batch_row_key" ON "ImportRow"("batch", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "_VaccineProduct_species_AB_unique" ON "_VaccineProduct_species"("A", "B");

-- CreateIndex
CREATE INDEX "_VaccineProduct_species_B_index" ON "_VaccineProduct_species"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_Encounter_participants_AB_unique" ON "_Encounter_participants"("A", "B");

-- CreateIndex
CREATE INDEX "_Encounter_participants_B_index" ON "_Encounter_participants"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_DiagnosisCode_species_AB_unique" ON "_DiagnosisCode_species"("A", "B");

-- CreateIndex
CREATE INDEX "_DiagnosisCode_species_B_index" ON "_DiagnosisCode_species"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReminderRule_triggerVaccines_AB_unique" ON "_ReminderRule_triggerVaccines"("A", "B");

-- CreateIndex
CREATE INDEX "_ReminderRule_triggerVaccines_B_index" ON "_ReminderRule_triggerVaccines"("B");

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_stay_fkey" FOREIGN KEY ("stay") REFERENCES "HospitalStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_attendingDvm_fkey" FOREIGN KEY ("attendingDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_weightUsed_fkey" FOREIGN KEY ("weightUsed") REFERENCES "WeightMeasurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_signedBy_fkey" FOREIGN KEY ("signedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_licenseEvaluation_fkey" FOREIGN KEY ("licenseEvaluation") REFERENCES "LicenseEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_vcpr_fkey" FOREIGN KEY ("vcpr") REFERENCES "VcprRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_document_fkey" FOREIGN KEY ("document") REFERENCES "ClinicalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_voidApproval_fkey" FOREIGN KEY ("voidApproval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSection" ADD CONSTRAINT "SoapSection_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSection" ADD CONSTRAINT "SoapSection_lastAuthor_fkey" FOREIGN KEY ("lastAuthor") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_section_fkey" FOREIGN KEY ("section") REFERENCES "SoapSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_template_fkey" FOREIGN KEY ("template") REFERENCES "RecordTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_scribeDraft_fkey" FOREIGN KEY ("scribeDraft") REFERENCES "ScribeDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_author_fkey" FOREIGN KEY ("author") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_authorUser_fkey" FOREIGN KEY ("authorUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Addendum" ADD CONSTRAINT "Addendum_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Addendum" ADD CONSTRAINT "Addendum_author_fkey" FOREIGN KEY ("author") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsObservation" ADD CONSTRAINT "VitalsObservation_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsObservation" ADD CONSTRAINT "VitalsObservation_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsObservation" ADD CONSTRAINT "VitalsObservation_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalExamFinding" ADD CONSTRAINT "PhysicalExamFinding_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalExamFinding" ADD CONSTRAINT "PhysicalExamFinding_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_code_fkey" FOREIGN KEY ("code") REFERENCES "DiagnosisCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_code_fkey" FOREIGN KEY ("code") REFERENCES "DiagnosisCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_problem_fkey" FOREIGN KEY ("problem") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_document_fkey" FOREIGN KEY ("document") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_document_fkey" FOREIGN KEY ("document") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_signedBy_fkey" FOREIGN KEY ("signedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordTemplate" ADD CONSTRAINT "RecordTemplate_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeSession" ADD CONSTRAINT "ScribeSession_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeSession" ADD CONSTRAINT "ScribeSession_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeSession" ADD CONSTRAINT "ScribeSession_startedByAgent_fkey" FOREIGN KEY ("startedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeSession" ADD CONSTRAINT "ScribeSession_clientConsent_fkey" FOREIGN KEY ("clientConsent") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeSession" ADD CONSTRAINT "ScribeSession_audioDocument_fkey" FOREIGN KEY ("audioDocument") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeDraft" ADD CONSTRAINT "ScribeDraft_session_fkey" FOREIGN KEY ("session") REFERENCES "ScribeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeDraft" ADD CONSTRAINT "ScribeDraft_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_hospital_fkey" FOREIGN KEY ("hospital") REFERENCES "ReferralHospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referringVet_fkey" FOREIGN KEY ("referringVet") REFERENCES "ReferringVet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_recordsRelease_fkey" FOREIGN KEY ("recordsRelease") REFERENCES "RecordsRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_drug_fkey" FOREIGN KEY ("drug") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_vaccine_fkey" FOREIGN KEY ("vaccine") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_orderedBy_fkey" FOREIGN KEY ("orderedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_licenseEvaluation_fkey" FOREIGN KEY ("licenseEvaluation") REFERENCES "LicenseEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_dose_fkey" FOREIGN KEY ("dose") REFERENCES "DoseCalculation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_weight_fkey" FOREIGN KEY ("weight") REFERENCES "WeightMeasurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_product_fkey" FOREIGN KEY ("product") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseCalculation" ADD CONSTRAINT "DoseCalculation_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_drug_fkey" FOREIGN KEY ("drug") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_vaccine_fkey" FOREIGN KEY ("vaccine") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_order_fkey" FOREIGN KEY ("order") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_treatmentTask_fkey" FOREIGN KEY ("treatmentTask") REFERENCES "TreatmentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_csContainer_fkey" FOREIGN KEY ("csContainer") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_csLogEntry_fkey" FOREIGN KEY ("csLogEntry") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_givenBy_fkey" FOREIGN KEY ("givenBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_supervisingDvm_fkey" FOREIGN KEY ("supervisingDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Administration" ADD CONSTRAINT "Administration_reverses_fkey" FOREIGN KEY ("reverses") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_ward_fkey" FOREIGN KEY ("ward") REFERENCES "Ward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_cage_fkey" FOREIGN KEY ("cage") REFERENCES "Cage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStay" ADD CONSTRAINT "HospitalStay_attendingDvm_fkey" FOREIGN KEY ("attendingDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageAssignment" ADD CONSTRAINT "CageAssignment_stay_fkey" FOREIGN KEY ("stay") REFERENCES "HospitalStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageAssignment" ADD CONSTRAINT "CageAssignment_cage_fkey" FOREIGN KEY ("cage") REFERENCES "Cage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentSheetOrder" ADD CONSTRAINT "TreatmentSheetOrder_stay_fkey" FOREIGN KEY ("stay") REFERENCES "HospitalStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentSheetOrder" ADD CONSTRAINT "TreatmentSheetOrder_order_fkey" FOREIGN KEY ("order") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentSheetOrder" ADD CONSTRAINT "TreatmentSheetOrder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_sheetOrder_fkey" FOREIGN KEY ("sheetOrder") REFERENCES "TreatmentSheetOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_stay_fkey" FOREIGN KEY ("stay") REFERENCES "HospitalStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_doneBy_fkey" FOREIGN KEY ("doneBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_rescheduledTo_fkey" FOREIGN KEY ("rescheduledTo") REFERENCES "TreatmentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentTask" ADD CONSTRAINT "TreatmentTask_administration_fkey" FOREIGN KEY ("administration") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_preWeight_fkey" FOREIGN KEY ("preWeight") REFERENCES "WeightMeasurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_anaesthetist_fkey" FOREIGN KEY ("anaesthetist") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_dvm_fkey" FOREIGN KEY ("dvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_licenseEvaluation_fkey" FOREIGN KEY ("licenseEvaluation") REFERENCES "LicenseEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnaesthesiaRecord" ADD CONSTRAINT "AnaesthesiaRecord_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_record_fkey" FOREIGN KEY ("record") REFERENCES "AnaesthesiaRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_by_fkey" FOREIGN KEY ("by") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryReport" ADD CONSTRAINT "SurgeryReport_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryReport" ADD CONSTRAINT "SurgeryReport_surgeon_fkey" FOREIGN KEY ("surgeon") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryReport" ADD CONSTRAINT "SurgeryReport_assistant_fkey" FOREIGN KEY ("assistant") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChart" ADD CONSTRAINT "DentalChart_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeInstruction" ADD CONSTRAINT "DischargeInstruction_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeInstruction" ADD CONSTRAINT "DischargeInstruction_stay_fkey" FOREIGN KEY ("stay") REFERENCES "HospitalStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeInstruction" ADD CONSTRAINT "DischargeInstruction_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeInstruction" ADD CONSTRAINT "DischargeInstruction_author_fkey" FOREIGN KEY ("author") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineProduct" ADD CONSTRAINT "VaccineProduct_reminderType_fkey" FOREIGN KEY ("reminderType") REFERENCES "ReminderType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_administration_fkey" FOREIGN KEY ("administration") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_encounter_fkey" FOREIGN KEY ("encounter") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_product_fkey" FOREIGN KEY ("product") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_lot_fkey" FOREIGN KEY ("lot") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_vaccinatedBy_fkey" FOREIGN KEY ("vaccinatedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_supervisingDvm_fkey" FOREIGN KEY ("supervisingDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineAdministration" ADD CONSTRAINT "VaccineAdministration_certificate_fkey" FOREIGN KEY ("certificate") REFERENCES "RabiesCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RabiesCertificate" ADD CONSTRAINT "RabiesCertificate_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RabiesCertificate" ADD CONSTRAINT "RabiesCertificate_document_fkey" FOREIGN KEY ("document") REFERENCES "ClinicalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderProtocol" ADD CONSTRAINT "ReminderProtocol_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderProtocolVersion" ADD CONSTRAINT "ReminderProtocolVersion_protocol_fkey" FOREIGN KEY ("protocol") REFERENCES "ReminderProtocol"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_protocolVersion_fkey" FOREIGN KEY ("protocolVersion") REFERENCES "ReminderProtocolVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_satisfies_fkey" FOREIGN KEY ("satisfies") REFERENCES "ReminderType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_type_fkey" FOREIGN KEY ("type") REFERENCES "ReminderType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_rule_fkey" FOREIGN KEY ("rule") REFERENCES "ReminderRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_protocolVersion_fkey" FOREIGN KEY ("protocolVersion") REFERENCES "ReminderProtocolVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSatisfaction" ADD CONSTRAINT "ReminderSatisfaction_reminder_fkey" FOREIGN KEY ("reminder") REFERENCES "PatientReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSatisfaction" ADD CONSTRAINT "ReminderSatisfaction_vaccineAdministration_fkey" FOREIGN KEY ("vaccineAdministration") REFERENCES "VaccineAdministration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSatisfaction" ADD CONSTRAINT "ReminderSatisfaction_administration_fkey" FOREIGN KEY ("administration") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSatisfaction" ADD CONSTRAINT "ReminderSatisfaction_externalEvidence_fkey" FOREIGN KEY ("externalEvidence") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSatisfaction" ADD CONSTRAINT "ReminderSatisfaction_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_vaccineAdministration_fkey" FOREIGN KEY ("vaccineAdministration") REFERENCES "VaccineAdministration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_administration_fkey" FOREIGN KEY ("administration") REFERENCES "Administration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_product_fkey" FOREIGN KEY ("product") REFERENCES "VaccineProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_drug_fkey" FOREIGN KEY ("drug") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdverseEventReport" ADD CONSTRAINT "AdverseEventReport_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batch_fkey" FOREIGN KEY ("batch") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VaccineProduct_species" ADD CONSTRAINT "_VaccineProduct_species_A_fkey" FOREIGN KEY ("A") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VaccineProduct_species" ADD CONSTRAINT "_VaccineProduct_species_B_fkey" FOREIGN KEY ("B") REFERENCES "VaccineProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Encounter_participants" ADD CONSTRAINT "_Encounter_participants_A_fkey" FOREIGN KEY ("A") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Encounter_participants" ADD CONSTRAINT "_Encounter_participants_B_fkey" FOREIGN KEY ("B") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DiagnosisCode_species" ADD CONSTRAINT "_DiagnosisCode_species_A_fkey" FOREIGN KEY ("A") REFERENCES "DiagnosisCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DiagnosisCode_species" ADD CONSTRAINT "_DiagnosisCode_species_B_fkey" FOREIGN KEY ("B") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReminderRule_triggerVaccines" ADD CONSTRAINT "_ReminderRule_triggerVaccines_A_fkey" FOREIGN KEY ("A") REFERENCES "ReminderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReminderRule_triggerVaccines" ADD CONSTRAINT "_ReminderRule_triggerVaccines_B_fkey" FOREIGN KEY ("B") REFERENCES "VaccineProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
