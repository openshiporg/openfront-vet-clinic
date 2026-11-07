-- CreateTable
CREATE TABLE "AlertAcknowledgement" (
    "id" TEXT NOT NULL,
    "alert" TEXT,
    "user" TEXT,
    "appointment" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breed" (
    "id" TEXT NOT NULL,
    "species" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "registryCode" TEXT NOT NULL DEFAULT '',
    "sizeClass" TEXT,
    "geneticFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Breed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "publicCode" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prospect',
    "primaryLocation" TEXT,
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "stateCode" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "creditLimitMinor" BIGINT NOT NULL DEFAULT 0,
    "accountFlags" JSONB DEFAULT '{}',
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "mergedInto" TEXT,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPerson" (
    "id" TEXT NOT NULL,
    "client" TEXT,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "relationship" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canBook" BOOLEAN NOT NULL DEFAULT true,
    "canApproveTreatment" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveRecords" BOOLEAN NOT NULL DEFAULT false,
    "canPay" BOOLEAN NOT NULL DEFAULT true,
    "canAuthoriseEuthanasia" BOOLEAN NOT NULL DEFAULT false,
    "dateOfBirth" DATE,
    "preferredLanguage" TEXT NOT NULL DEFAULT '',
    "user" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColourMarking" (
    "id" TEXT NOT NULL,
    "species" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColourMarking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "contactPoint" TEXT,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT,
    "callRecord" TEXT,
    "keyword" TEXT NOT NULL DEFAULT '',
    "capturedByUser" TEXT,
    "capturedByAgent" TEXT,
    "policyVersion" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "person" TEXT,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "valueHash" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "canText" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Microchip" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "number" TEXT NOT NULL DEFAULT '',
    "standard" TEXT NOT NULL,
    "implantedOn" DATE,
    "registry" TEXT NOT NULL DEFAULT '',
    "registeredToClient" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Microchip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "species" TEXT,
    "breed" TEXT,
    "secondaryBreed" TEXT,
    "sex" TEXT NOT NULL,
    "reproductiveStatus" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "dobEstimated" BOOLEAN NOT NULL DEFAULT false,
    "colourMarkings" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deceasedAt" TIMESTAMP(3),
    "codeStatus" TEXT NOT NULL,
    "preferredDvm" TEXT,
    "groupSize" INTEGER,
    "mergedInto" TEXT,
    "photo" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAlert" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientOwnership" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "client" TEXT,
    "role" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "basis" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetInsurancePolicy" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "insurer" TEXT,
    "policyNumber" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "deductibleMinor" BIGINT,
    "reimbursementRate" DECIMAL(12,6),
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "directPayEligible" BOOLEAN NOT NULL DEFAULT false,
    "clientAuthorisation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetInsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRelease" (
    "id" TEXT NOT NULL,
    "request" TEXT,
    "recipient" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "documents" JSONB,
    "releasedByUser" TEXT,
    "releasedByAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordsRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRequest" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "requesterKind" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL DEFAULT '',
    "requesterContact" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT,
    "channel" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "authorisationDocument" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "responseDueAt" TIMESTAMP(3),
    "policyVersion" TEXT,
    "callRecord" TEXT,
    "createdByAgent" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralHospital" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'emergency',
    "phone" TEXT NOT NULL DEFAULT '',
    "fax" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "stateCode" TEXT NOT NULL DEFAULT '',
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "open24h" BOOLEAN NOT NULL DEFAULT false,
    "hours" JSONB,
    "verifiedChannel" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralHospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferringVet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "clinicName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "fax" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "verifiedChannel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferringVet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefillRequest" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "requestedBy" TEXT,
    "channel" TEXT NOT NULL,
    "productText" TEXT NOT NULL DEFAULT '',
    "pharmacyNote" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'received',
    "slaDueAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "denialReason" TEXT NOT NULL DEFAULT '',
    "callRecord" TEXT,
    "createdByAgent" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefillRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Species" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "module" TEXT NOT NULL DEFAULT 'companion',
    "defaultWeightUnit" TEXT NOT NULL DEFAULT 'kg',
    "vitalsReference" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdPartyPayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'insurer',
    "directPay" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT NOT NULL DEFAULT '',
    "claimsEmail" TEXT NOT NULL DEFAULT '',
    "portalUrl" TEXT NOT NULL DEFAULT '',
    "adapterKey" TEXT NOT NULL DEFAULT 'manual',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThirdPartyPayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VcprRecord" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "scope" TEXT NOT NULL,
    "dvm" TEXT,
    "location" TEXT,
    "establishedByRef" TEXT NOT NULL DEFAULT '',
    "establishedVia" TEXT NOT NULL,
    "establishedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "policyVersion" TEXT,
    "terminatedReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcprRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightMeasurement" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "value" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "valueKg" DECIMAL(10,4) NOT NULL,
    "method" TEXT NOT NULL,
    "bodyConditionScore" INTEGER,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "measuredBy" TEXT,
    "appointment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "client" TEXT,
    "appointmentType" TEXT,
    "provider" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "channel" TEXT NOT NULL,
    "bookedByUser" TEXT,
    "bookedByAgent" TEXT,
    "slotToken" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "triage" TEXT,
    "callRecord" TEXT,
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "cancelledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentPatient" (
    "id" TEXT NOT NULL,
    "appointment" TEXT,
    "patient" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "weightSkippedReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSegment" (
    "id" TEXT NOT NULL,
    "appointment" TEXT,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "resource" TEXT,
    "staff" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'wellness',
    "durationMinutes" INTEGER NOT NULL,
    "segments" JSONB,
    "requiredResourceKinds" JSONB DEFAULT '["exam_room"]',
    "providerKinds" JSONB DEFAULT '["dvm"]',
    "aiBookable" BOOLEAN NOT NULL DEFAULT false,
    "portalBookable" BOOLEAN NOT NULL DEFAULT false,
    "requestOnly" BOOLEAN NOT NULL DEFAULT false,
    "newClientAllowed" BOOLEAN NOT NULL DEFAULT true,
    "depositRequired" TEXT NOT NULL DEFAULT 'none',
    "depositMinor" BIGINT,
    "vcprQualifying" BOOLEAN NOT NULL DEFAULT false,
    "colour" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderReservation" (
    "id" TEXT NOT NULL,
    "staffMember" TEXT,
    "appointment" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "location" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'exam_room',
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceReservation" (
    "id" TEXT NOT NULL,
    "resource" TEXT,
    "appointment" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentTransition" (
    "id" TEXT NOT NULL,
    "segment" TEXT,
    "fromStatus" TEXT NOT NULL DEFAULT '',
    "toStatus" TEXT NOT NULL DEFAULT '',
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SegmentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSchedule" (
    "id" TEXT NOT NULL,
    "staffMember" TEXT,
    "location" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'recurring',
    "weekday" INTEGER,
    "localDate" DATE,
    "startTime" TEXT NOT NULL DEFAULT '',
    "endTime" TEXT NOT NULL DEFAULT '',
    "appointmentCategories" JSONB,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageAssessment" (
    "id" TEXT NOT NULL,
    "patient" TEXT,
    "client" TEXT,
    "callRecord" TEXT,
    "protocolVersion" TEXT,
    "complaint" TEXT NOT NULL DEFAULT '',
    "answers" JSONB,
    "redFlagsHit" JSONB,
    "level" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "referredTo" TEXT,
    "actorKind" TEXT NOT NULL,
    "actorUser" TEXT,
    "actorAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriageAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageProtocol" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageProtocolVersion" (
    "id" TEXT NOT NULL,
    "protocol" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "questions" JSONB,
    "redFlags" JSONB,
    "levelRules" JSONB,
    "scripts" JSONB,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "approval" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageProtocolVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "client" TEXT,
    "location" TEXT,
    "appointmentType" TEXT,
    "preferredWindows" JSONB,
    "urgency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "offeredSlotToken" TEXT NOT NULL DEFAULT '',
    "offerExpiresAt" TIMESTAMP(3),
    "bookedAppointment" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhiteboardEntry" (
    "id" TEXT NOT NULL,
    "location" TEXT,
    "patient" TEXT,
    "appointment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "room" TEXT,
    "assignedDvm" TEXT,
    "assignedTech" TEXT,
    "flags" JSONB DEFAULT '[]',
    "since" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "from" TEXT NOT NULL DEFAULT '',
    "to" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "client" TEXT,
    "person" TEXT,
    "answeredBy" TEXT NOT NULL,
    "agent" TEXT,
    "agentRun" TEXT,
    "providerCallId" TEXT NOT NULL DEFAULT '',
    "adapterKey" TEXT NOT NULL DEFAULT '',
    "disclosurePlayedAt" TIMESTAMP(3),
    "recordingConsent" TEXT NOT NULL,
    "callerVerifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT NOT NULL,
    "transcript" JSONB DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '',
    "disposition" TEXT NOT NULL,
    "transferTo" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "recordingRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsMessage" (
    "id" TEXT NOT NULL,
    "thread" TEXT,
    "direction" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL DEFAULT '',
    "to" TEXT NOT NULL DEFAULT '',
    "from" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "blockedReason" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "appointment" TEXT,
    "sentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsThread" (
    "id" TEXT NOT NULL,
    "client" TEXT,
    "contactPoint" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedTo" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBaseEntry" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "keywords" JSONB DEFAULT '[]',
    "content" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "location" TEXT,
    "entryVersion" INTEGER DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeBaseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT 'care',
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "body" TEXT NOT NULL DEFAULT '',
    "templateVersion" INTEGER DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "person" TEXT,
    "contactPoint" TEXT,
    "tokenHash" TEXT NOT NULL DEFAULT '',
    "otpHash" TEXT NOT NULL DEFAULT '',
    "otpAttempts" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "ipHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicAppointmentType" (
    "id" TEXT NOT NULL,
    "appointmentType" TEXT,
    "publicName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'book',
    "newClients" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicAppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSiteProfile" (
    "id" INTEGER NOT NULL,
    "headline" TEXT NOT NULL DEFAULT 'Cedar Creek Animal Hospital',
    "onlineBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "newClientBookingMode" TEXT NOT NULL DEFAULT 'request',
    "bookingWindowDays" INTEGER DEFAULT 60,
    "minimumNoticeMinutes" INTEGER DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicSiteProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "contactPoint" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugProduct" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "genericName" TEXT NOT NULL DEFAULT '',
    "brandName" TEXT NOT NULL DEFAULT '',
    "form" TEXT NOT NULL,
    "strength" DECIMAL(18,6),
    "strengthUnit" TEXT,
    "per" TEXT,
    "concentration" DECIMAL(18,6),
    "concentrationUnit" TEXT NOT NULL DEFAULT '',
    "packageQty" DECIMAL(18,6),
    "packageUnit" TEXT,
    "csSchedule" TEXT NOT NULL,
    "stateCsSchedule" JSONB,
    "isHumanLabel" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" TEXT NOT NULL,
    "multiDoseBudDays" INTEGER,
    "ndc" TEXT NOT NULL DEFAULT '',
    "requiresWitnessOnAdminister" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "patient" TEXT,
    "client" TEXT,
    "location" TEXT,
    "prescriber" TEXT,
    "deaRegistration" TEXT,
    "vcpr" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signedAt" TIMESTAMP(3),
    "licenseEvaluation" TEXT,
    "policyVersion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionLine" (
    "id" TEXT NOT NULL,
    "prescription" TEXT,
    "product" TEXT,
    "csSchedule" TEXT NOT NULL,
    "directions" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT '',
    "frequency" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantityUnit" TEXT,
    "refillsAuthorised" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "extralabel" BOOLEAN NOT NULL DEFAULT false,
    "substitutionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsContainer" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "product" TEXT,
    "location" TEXT,
    "deaRegistration" TEXT,
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "lotExpiresOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'sealed',
    "labelQty" DECIMAL(18,6) NOT NULL,
    "labelUnit" TEXT,
    "openedAt" TIMESTAMP(3),
    "openedBy" TEXT,
    "budAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsLogEntry" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "ciiRef" TEXT NOT NULL DEFAULT '',
    "container" TEXT,
    "deaRegistration" TEXT,
    "schedule" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qtySigned" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "actor" TEXT,
    "patient" TEXT,
    "client" TEXT,
    "clientSnapshot" JSONB,
    "reverses" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "prevHash" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CsLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WaitlistEntry_patients" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_AppointmentType_species" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_alert_idx" ON "AlertAcknowledgement"("alert");

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_user_idx" ON "AlertAcknowledgement"("user");

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_appointment_idx" ON "AlertAcknowledgement"("appointment");

-- CreateIndex
CREATE INDEX "Breed_species_idx" ON "Breed"("species");

-- CreateIndex
CREATE UNIQUE INDEX "Breed_species_name_key" ON "Breed"("species", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ref_key" ON "Client"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Client_publicCode_key" ON "Client"("publicCode");

-- CreateIndex
CREATE INDEX "Client_primaryLocation_idx" ON "Client"("primaryLocation");

-- CreateIndex
CREATE INDEX "Client_mergedInto_idx" ON "Client"("mergedInto");

-- CreateIndex
CREATE INDEX "ClientPerson_client_idx" ON "ClientPerson"("client");

-- CreateIndex
CREATE INDEX "ClientPerson_user_idx" ON "ClientPerson"("user");

-- CreateIndex
CREATE INDEX "ColourMarking_species_idx" ON "ColourMarking"("species");

-- CreateIndex
CREATE INDEX "ConsentRecord_contactPoint_idx" ON "ConsentRecord"("contactPoint");

-- CreateIndex
CREATE INDEX "ConsentRecord_evidence_idx" ON "ConsentRecord"("evidence");

-- CreateIndex
CREATE INDEX "ConsentRecord_callRecord_idx" ON "ConsentRecord"("callRecord");

-- CreateIndex
CREATE INDEX "ConsentRecord_capturedByUser_idx" ON "ConsentRecord"("capturedByUser");

-- CreateIndex
CREATE INDEX "ConsentRecord_capturedByAgent_idx" ON "ConsentRecord"("capturedByAgent");

-- CreateIndex
CREATE INDEX "ConsentRecord_policyVersion_idx" ON "ConsentRecord"("policyVersion");

-- CreateIndex
CREATE INDEX "ContactPoint_person_idx" ON "ContactPoint"("person");

-- CreateIndex
CREATE INDEX "ContactPoint_valueHash_idx" ON "ContactPoint"("valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_person_value_key" ON "ContactPoint"("person", "valueHash");

-- CreateIndex
CREATE INDEX "Microchip_patient_idx" ON "Microchip"("patient");

-- CreateIndex
CREATE INDEX "Microchip_number_idx" ON "Microchip"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_ref_key" ON "Patient"("ref");

-- CreateIndex
CREATE INDEX "Patient_species_idx" ON "Patient"("species");

-- CreateIndex
CREATE INDEX "Patient_breed_idx" ON "Patient"("breed");

-- CreateIndex
CREATE INDEX "Patient_secondaryBreed_idx" ON "Patient"("secondaryBreed");

-- CreateIndex
CREATE INDEX "Patient_preferredDvm_idx" ON "Patient"("preferredDvm");

-- CreateIndex
CREATE INDEX "Patient_mergedInto_idx" ON "Patient"("mergedInto");

-- CreateIndex
CREATE INDEX "Patient_photo_idx" ON "Patient"("photo");

-- CreateIndex
CREATE INDEX "PatientAlert_patient_idx" ON "PatientAlert"("patient");

-- CreateIndex
CREATE INDEX "PatientAlert_createdBy_idx" ON "PatientAlert"("createdBy");

-- CreateIndex
CREATE INDEX "PatientOwnership_patient_idx" ON "PatientOwnership"("patient");

-- CreateIndex
CREATE INDEX "PatientOwnership_client_idx" ON "PatientOwnership"("client");

-- CreateIndex
CREATE INDEX "PatientOwnership_evidence_idx" ON "PatientOwnership"("evidence");

-- CreateIndex
CREATE INDEX "PatientOwnership_recordedBy_idx" ON "PatientOwnership"("recordedBy");

-- CreateIndex
CREATE INDEX "PetInsurancePolicy_patient_idx" ON "PetInsurancePolicy"("patient");

-- CreateIndex
CREATE INDEX "PetInsurancePolicy_insurer_idx" ON "PetInsurancePolicy"("insurer");

-- CreateIndex
CREATE INDEX "PetInsurancePolicy_clientAuthorisation_idx" ON "PetInsurancePolicy"("clientAuthorisation");

-- CreateIndex
CREATE INDEX "RecordsRelease_request_idx" ON "RecordsRelease"("request");

-- CreateIndex
CREATE INDEX "RecordsRelease_releasedByUser_idx" ON "RecordsRelease"("releasedByUser");

-- CreateIndex
CREATE INDEX "RecordsRelease_releasedByAgent_idx" ON "RecordsRelease"("releasedByAgent");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsRequest_ref_key" ON "RecordsRequest"("ref");

-- CreateIndex
CREATE INDEX "RecordsRequest_patient_idx" ON "RecordsRequest"("patient");

-- CreateIndex
CREATE INDEX "RecordsRequest_client_idx" ON "RecordsRequest"("client");

-- CreateIndex
CREATE INDEX "RecordsRequest_requestedBy_idx" ON "RecordsRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "RecordsRequest_authorisationDocument_idx" ON "RecordsRequest"("authorisationDocument");

-- CreateIndex
CREATE INDEX "RecordsRequest_policyVersion_idx" ON "RecordsRequest"("policyVersion");

-- CreateIndex
CREATE INDEX "RecordsRequest_callRecord_idx" ON "RecordsRequest"("callRecord");

-- CreateIndex
CREATE INDEX "RecordsRequest_createdByAgent_idx" ON "RecordsRequest"("createdByAgent");

-- CreateIndex
CREATE UNIQUE INDEX "RefillRequest_ref_key" ON "RefillRequest"("ref");

-- CreateIndex
CREATE INDEX "RefillRequest_patient_idx" ON "RefillRequest"("patient");

-- CreateIndex
CREATE INDEX "RefillRequest_client_idx" ON "RefillRequest"("client");

-- CreateIndex
CREATE INDEX "RefillRequest_requestedBy_idx" ON "RefillRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "RefillRequest_decidedBy_idx" ON "RefillRequest"("decidedBy");

-- CreateIndex
CREATE INDEX "RefillRequest_callRecord_idx" ON "RefillRequest"("callRecord");

-- CreateIndex
CREATE INDEX "RefillRequest_createdByAgent_idx" ON "RefillRequest"("createdByAgent");

-- CreateIndex
CREATE UNIQUE INDEX "Species_code_key" ON "Species"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdPartyPayer_name_key" ON "ThirdPartyPayer"("name");

-- CreateIndex
CREATE INDEX "VcprRecord_patient_idx" ON "VcprRecord"("patient");

-- CreateIndex
CREATE INDEX "VcprRecord_dvm_idx" ON "VcprRecord"("dvm");

-- CreateIndex
CREATE INDEX "VcprRecord_location_idx" ON "VcprRecord"("location");

-- CreateIndex
CREATE INDEX "VcprRecord_policyVersion_idx" ON "VcprRecord"("policyVersion");

-- CreateIndex
CREATE INDEX "WeightMeasurement_patient_idx" ON "WeightMeasurement"("patient");

-- CreateIndex
CREATE INDEX "WeightMeasurement_measuredBy_idx" ON "WeightMeasurement"("measuredBy");

-- CreateIndex
CREATE INDEX "WeightMeasurement_appointment_idx" ON "WeightMeasurement"("appointment");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_ref_key" ON "Appointment"("ref");

-- CreateIndex
CREATE INDEX "Appointment_location_idx" ON "Appointment"("location");

-- CreateIndex
CREATE INDEX "Appointment_client_idx" ON "Appointment"("client");

-- CreateIndex
CREATE INDEX "Appointment_appointmentType_idx" ON "Appointment"("appointmentType");

-- CreateIndex
CREATE INDEX "Appointment_provider_idx" ON "Appointment"("provider");

-- CreateIndex
CREATE INDEX "Appointment_bookedByUser_idx" ON "Appointment"("bookedByUser");

-- CreateIndex
CREATE INDEX "Appointment_bookedByAgent_idx" ON "Appointment"("bookedByAgent");

-- CreateIndex
CREATE INDEX "Appointment_triage_idx" ON "Appointment"("triage");

-- CreateIndex
CREATE INDEX "Appointment_callRecord_idx" ON "Appointment"("callRecord");

-- CreateIndex
CREATE INDEX "AppointmentPatient_appointment_idx" ON "AppointmentPatient"("appointment");

-- CreateIndex
CREATE INDEX "AppointmentPatient_patient_idx" ON "AppointmentPatient"("patient");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentPatient_appointment_patient_key" ON "AppointmentPatient"("appointment", "patient");

-- CreateIndex
CREATE INDEX "AppointmentSegment_appointment_idx" ON "AppointmentSegment"("appointment");

-- CreateIndex
CREATE INDEX "AppointmentSegment_resource_idx" ON "AppointmentSegment"("resource");

-- CreateIndex
CREATE INDEX "AppointmentSegment_staff_idx" ON "AppointmentSegment"("staff");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_code_key" ON "AppointmentType"("code");

-- CreateIndex
CREATE INDEX "ProviderReservation_staffMember_idx" ON "ProviderReservation"("staffMember");

-- CreateIndex
CREATE INDEX "ProviderReservation_appointment_idx" ON "ProviderReservation"("appointment");

-- CreateIndex
CREATE INDEX "Resource_location_idx" ON "Resource"("location");

-- CreateIndex
CREATE INDEX "ResourceReservation_resource_idx" ON "ResourceReservation"("resource");

-- CreateIndex
CREATE INDEX "ResourceReservation_appointment_idx" ON "ResourceReservation"("appointment");

-- CreateIndex
CREATE INDEX "SegmentTransition_segment_idx" ON "SegmentTransition"("segment");

-- CreateIndex
CREATE INDEX "SegmentTransition_by_idx" ON "SegmentTransition"("by");

-- CreateIndex
CREATE INDEX "StaffSchedule_staffMember_idx" ON "StaffSchedule"("staffMember");

-- CreateIndex
CREATE INDEX "StaffSchedule_location_idx" ON "StaffSchedule"("location");

-- CreateIndex
CREATE INDEX "TriageAssessment_patient_idx" ON "TriageAssessment"("patient");

-- CreateIndex
CREATE INDEX "TriageAssessment_client_idx" ON "TriageAssessment"("client");

-- CreateIndex
CREATE INDEX "TriageAssessment_callRecord_idx" ON "TriageAssessment"("callRecord");

-- CreateIndex
CREATE INDEX "TriageAssessment_protocolVersion_idx" ON "TriageAssessment"("protocolVersion");

-- CreateIndex
CREATE INDEX "TriageAssessment_referredTo_idx" ON "TriageAssessment"("referredTo");

-- CreateIndex
CREATE INDEX "TriageAssessment_actorUser_idx" ON "TriageAssessment"("actorUser");

-- CreateIndex
CREATE INDEX "TriageAssessment_actorAgent_idx" ON "TriageAssessment"("actorAgent");

-- CreateIndex
CREATE UNIQUE INDEX "TriageProtocol_code_key" ON "TriageProtocol"("code");

-- CreateIndex
CREATE INDEX "TriageProtocolVersion_protocol_idx" ON "TriageProtocolVersion"("protocol");

-- CreateIndex
CREATE INDEX "TriageProtocolVersion_approval_idx" ON "TriageProtocolVersion"("approval");

-- CreateIndex
CREATE UNIQUE INDEX "TriageProtocolVersion_protocol_number_key" ON "TriageProtocolVersion"("protocol", "versionNumber");

-- CreateIndex
CREATE INDEX "WaitlistEntry_client_idx" ON "WaitlistEntry"("client");

-- CreateIndex
CREATE INDEX "WaitlistEntry_location_idx" ON "WaitlistEntry"("location");

-- CreateIndex
CREATE INDEX "WaitlistEntry_appointmentType_idx" ON "WaitlistEntry"("appointmentType");

-- CreateIndex
CREATE INDEX "WaitlistEntry_bookedAppointment_idx" ON "WaitlistEntry"("bookedAppointment");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_location_idx" ON "WhiteboardEntry"("location");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_patient_idx" ON "WhiteboardEntry"("patient");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_appointment_idx" ON "WhiteboardEntry"("appointment");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_room_idx" ON "WhiteboardEntry"("room");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_assignedDvm_idx" ON "WhiteboardEntry"("assignedDvm");

-- CreateIndex
CREATE INDEX "WhiteboardEntry_assignedTech_idx" ON "WhiteboardEntry"("assignedTech");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_ref_key" ON "CallRecord"("ref");

-- CreateIndex
CREATE INDEX "CallRecord_location_idx" ON "CallRecord"("location");

-- CreateIndex
CREATE INDEX "CallRecord_client_idx" ON "CallRecord"("client");

-- CreateIndex
CREATE INDEX "CallRecord_person_idx" ON "CallRecord"("person");

-- CreateIndex
CREATE INDEX "CallRecord_agent_idx" ON "CallRecord"("agent");

-- CreateIndex
CREATE INDEX "CallRecord_agentRun_idx" ON "CallRecord"("agentRun");

-- CreateIndex
CREATE INDEX "CallRecord_providerCallId_idx" ON "CallRecord"("providerCallId");

-- CreateIndex
CREATE INDEX "CommsMessage_thread_idx" ON "CommsMessage"("thread");

-- CreateIndex
CREATE INDEX "CommsMessage_providerId_idx" ON "CommsMessage"("providerId");

-- CreateIndex
CREATE INDEX "CommsMessage_patient_idx" ON "CommsMessage"("patient");

-- CreateIndex
CREATE INDEX "CommsMessage_appointment_idx" ON "CommsMessage"("appointment");

-- CreateIndex
CREATE INDEX "CommsThread_client_idx" ON "CommsThread"("client");

-- CreateIndex
CREATE INDEX "CommsThread_contactPoint_idx" ON "CommsThread"("contactPoint");

-- CreateIndex
CREATE INDEX "CommsThread_assignedTo_idx" ON "CommsThread"("assignedTo");

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_topic_idx" ON "KnowledgeBaseEntry"("topic");

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_location_idx" ON "KnowledgeBaseEntry"("location");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_code_channel_locale_version_key" ON "MessageTemplate"("code", "channel", "locale", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_person_idx" ON "PortalSession"("person");

-- CreateIndex
CREATE INDEX "PortalSession_contactPoint_idx" ON "PortalSession"("contactPoint");

-- CreateIndex
CREATE INDEX "PublicAppointmentType_appointmentType_idx" ON "PublicAppointmentType"("appointmentType");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");

-- CreateIndex
CREATE INDEX "Suppression_contactPoint_idx" ON "Suppression"("contactPoint");

-- CreateIndex
CREATE INDEX "Suppression_patient_idx" ON "Suppression"("patient");

-- CreateIndex
CREATE INDEX "Suppression_client_idx" ON "Suppression"("client");

-- CreateIndex
CREATE INDEX "DrugProduct_ndc_idx" ON "DrugProduct"("ndc");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_ref_key" ON "Prescription"("ref");

-- CreateIndex
CREATE INDEX "Prescription_patient_idx" ON "Prescription"("patient");

-- CreateIndex
CREATE INDEX "Prescription_client_idx" ON "Prescription"("client");

-- CreateIndex
CREATE INDEX "Prescription_location_idx" ON "Prescription"("location");

-- CreateIndex
CREATE INDEX "Prescription_prescriber_idx" ON "Prescription"("prescriber");

-- CreateIndex
CREATE INDEX "Prescription_deaRegistration_idx" ON "Prescription"("deaRegistration");

-- CreateIndex
CREATE INDEX "Prescription_vcpr_idx" ON "Prescription"("vcpr");

-- CreateIndex
CREATE INDEX "Prescription_licenseEvaluation_idx" ON "Prescription"("licenseEvaluation");

-- CreateIndex
CREATE INDEX "Prescription_policyVersion_idx" ON "Prescription"("policyVersion");

-- CreateIndex
CREATE INDEX "PrescriptionLine_prescription_idx" ON "PrescriptionLine"("prescription");

-- CreateIndex
CREATE INDEX "PrescriptionLine_product_idx" ON "PrescriptionLine"("product");

-- CreateIndex
CREATE UNIQUE INDEX "CsContainer_ref_key" ON "CsContainer"("ref");

-- CreateIndex
CREATE INDEX "CsContainer_product_idx" ON "CsContainer"("product");

-- CreateIndex
CREATE INDEX "CsContainer_location_idx" ON "CsContainer"("location");

-- CreateIndex
CREATE INDEX "CsContainer_deaRegistration_idx" ON "CsContainer"("deaRegistration");

-- CreateIndex
CREATE INDEX "CsContainer_openedBy_idx" ON "CsContainer"("openedBy");

-- CreateIndex
CREATE UNIQUE INDEX "CsLogEntry_ref_key" ON "CsLogEntry"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "CsLogEntry_ciiRef_key" ON "CsLogEntry"("ciiRef");

-- CreateIndex
CREATE INDEX "CsLogEntry_container_idx" ON "CsLogEntry"("container");

-- CreateIndex
CREATE INDEX "CsLogEntry_deaRegistration_idx" ON "CsLogEntry"("deaRegistration");

-- CreateIndex
CREATE INDEX "CsLogEntry_actor_idx" ON "CsLogEntry"("actor");

-- CreateIndex
CREATE INDEX "CsLogEntry_patient_idx" ON "CsLogEntry"("patient");

-- CreateIndex
CREATE INDEX "CsLogEntry_client_idx" ON "CsLogEntry"("client");

-- CreateIndex
CREATE INDEX "CsLogEntry_reverses_idx" ON "CsLogEntry"("reverses");

-- CreateIndex
CREATE UNIQUE INDEX "_WaitlistEntry_patients_AB_unique" ON "_WaitlistEntry_patients"("A", "B");

-- CreateIndex
CREATE INDEX "_WaitlistEntry_patients_B_index" ON "_WaitlistEntry_patients"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_AppointmentType_species_AB_unique" ON "_AppointmentType_species"("A", "B");

-- CreateIndex
CREATE INDEX "_AppointmentType_species_B_index" ON "_AppointmentType_species"("B");

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_alert_fkey" FOREIGN KEY ("alert") REFERENCES "PatientAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryLocation_fkey" FOREIGN KEY ("primaryLocation") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_mergedInto_fkey" FOREIGN KEY ("mergedInto") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPerson" ADD CONSTRAINT "ClientPerson_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPerson" ADD CONSTRAINT "ClientPerson_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColourMarking" ADD CONSTRAINT "ColourMarking_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactPoint_fkey" FOREIGN KEY ("contactPoint") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_evidence_fkey" FOREIGN KEY ("evidence") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_callRecord_fkey" FOREIGN KEY ("callRecord") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_capturedByUser_fkey" FOREIGN KEY ("capturedByUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_capturedByAgent_fkey" FOREIGN KEY ("capturedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_person_fkey" FOREIGN KEY ("person") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Microchip" ADD CONSTRAINT "Microchip_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_species_fkey" FOREIGN KEY ("species") REFERENCES "Species"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_breed_fkey" FOREIGN KEY ("breed") REFERENCES "Breed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_secondaryBreed_fkey" FOREIGN KEY ("secondaryBreed") REFERENCES "Breed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_preferredDvm_fkey" FOREIGN KEY ("preferredDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mergedInto_fkey" FOREIGN KEY ("mergedInto") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_photo_fkey" FOREIGN KEY ("photo") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_evidence_fkey" FOREIGN KEY ("evidence") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientOwnership" ADD CONSTRAINT "PatientOwnership_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetInsurancePolicy" ADD CONSTRAINT "PetInsurancePolicy_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetInsurancePolicy" ADD CONSTRAINT "PetInsurancePolicy_insurer_fkey" FOREIGN KEY ("insurer") REFERENCES "ThirdPartyPayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetInsurancePolicy" ADD CONSTRAINT "PetInsurancePolicy_clientAuthorisation_fkey" FOREIGN KEY ("clientAuthorisation") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRelease" ADD CONSTRAINT "RecordsRelease_request_fkey" FOREIGN KEY ("request") REFERENCES "RecordsRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRelease" ADD CONSTRAINT "RecordsRelease_releasedByUser_fkey" FOREIGN KEY ("releasedByUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRelease" ADD CONSTRAINT "RecordsRelease_releasedByAgent_fkey" FOREIGN KEY ("releasedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_authorisationDocument_fkey" FOREIGN KEY ("authorisationDocument") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_callRecord_fkey" FOREIGN KEY ("callRecord") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_createdByAgent_fkey" FOREIGN KEY ("createdByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_callRecord_fkey" FOREIGN KEY ("callRecord") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillRequest" ADD CONSTRAINT "RefillRequest_createdByAgent_fkey" FOREIGN KEY ("createdByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_dvm_fkey" FOREIGN KEY ("dvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VcprRecord" ADD CONSTRAINT "VcprRecord_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_measuredBy_fkey" FOREIGN KEY ("measuredBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_appointmentType_fkey" FOREIGN KEY ("appointmentType") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_provider_fkey" FOREIGN KEY ("provider") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_bookedByUser_fkey" FOREIGN KEY ("bookedByUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_bookedByAgent_fkey" FOREIGN KEY ("bookedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_triage_fkey" FOREIGN KEY ("triage") REFERENCES "TriageAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_callRecord_fkey" FOREIGN KEY ("callRecord") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentPatient" ADD CONSTRAINT "AppointmentPatient_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentPatient" ADD CONSTRAINT "AppointmentPatient_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_resource_fkey" FOREIGN KEY ("resource") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSegment" ADD CONSTRAINT "AppointmentSegment_staff_fkey" FOREIGN KEY ("staff") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderReservation" ADD CONSTRAINT "ProviderReservation_staffMember_fkey" FOREIGN KEY ("staffMember") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderReservation" ADD CONSTRAINT "ProviderReservation_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceReservation" ADD CONSTRAINT "ResourceReservation_resource_fkey" FOREIGN KEY ("resource") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceReservation" ADD CONSTRAINT "ResourceReservation_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentTransition" ADD CONSTRAINT "SegmentTransition_segment_fkey" FOREIGN KEY ("segment") REFERENCES "AppointmentSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentTransition" ADD CONSTRAINT "SegmentTransition_by_fkey" FOREIGN KEY ("by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSchedule" ADD CONSTRAINT "StaffSchedule_staffMember_fkey" FOREIGN KEY ("staffMember") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSchedule" ADD CONSTRAINT "StaffSchedule_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_callRecord_fkey" FOREIGN KEY ("callRecord") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_protocolVersion_fkey" FOREIGN KEY ("protocolVersion") REFERENCES "TriageProtocolVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_referredTo_fkey" FOREIGN KEY ("referredTo") REFERENCES "ReferralHospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_actorUser_fkey" FOREIGN KEY ("actorUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_actorAgent_fkey" FOREIGN KEY ("actorAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageProtocolVersion" ADD CONSTRAINT "TriageProtocolVersion_protocol_fkey" FOREIGN KEY ("protocol") REFERENCES "TriageProtocol"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageProtocolVersion" ADD CONSTRAINT "TriageProtocolVersion_approval_fkey" FOREIGN KEY ("approval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_appointmentType_fkey" FOREIGN KEY ("appointmentType") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_bookedAppointment_fkey" FOREIGN KEY ("bookedAppointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_room_fkey" FOREIGN KEY ("room") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_assignedDvm_fkey" FOREIGN KEY ("assignedDvm") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteboardEntry" ADD CONSTRAINT "WhiteboardEntry_assignedTech_fkey" FOREIGN KEY ("assignedTech") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_person_fkey" FOREIGN KEY ("person") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_agent_fkey" FOREIGN KEY ("agent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_agentRun_fkey" FOREIGN KEY ("agentRun") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_thread_fkey" FOREIGN KEY ("thread") REFERENCES "CommsThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsMessage" ADD CONSTRAINT "CommsMessage_appointment_fkey" FOREIGN KEY ("appointment") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_contactPoint_fkey" FOREIGN KEY ("contactPoint") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsThread" ADD CONSTRAINT "CommsThread_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseEntry" ADD CONSTRAINT "KnowledgeBaseEntry_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_person_fkey" FOREIGN KEY ("person") REFERENCES "ClientPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_contactPoint_fkey" FOREIGN KEY ("contactPoint") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicAppointmentType" ADD CONSTRAINT "PublicAppointmentType_appointmentType_fkey" FOREIGN KEY ("appointmentType") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_contactPoint_fkey" FOREIGN KEY ("contactPoint") REFERENCES "ContactPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_prescriber_fkey" FOREIGN KEY ("prescriber") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_deaRegistration_fkey" FOREIGN KEY ("deaRegistration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_vcpr_fkey" FOREIGN KEY ("vcpr") REFERENCES "VcprRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_licenseEvaluation_fkey" FOREIGN KEY ("licenseEvaluation") REFERENCES "LicenseEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_prescription_fkey" FOREIGN KEY ("prescription") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_product_fkey" FOREIGN KEY ("product") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsContainer" ADD CONSTRAINT "CsContainer_product_fkey" FOREIGN KEY ("product") REFERENCES "DrugProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsContainer" ADD CONSTRAINT "CsContainer_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsContainer" ADD CONSTRAINT "CsContainer_deaRegistration_fkey" FOREIGN KEY ("deaRegistration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsContainer" ADD CONSTRAINT "CsContainer_openedBy_fkey" FOREIGN KEY ("openedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_container_fkey" FOREIGN KEY ("container") REFERENCES "CsContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_deaRegistration_fkey" FOREIGN KEY ("deaRegistration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_actor_fkey" FOREIGN KEY ("actor") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_patient_fkey" FOREIGN KEY ("patient") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_client_fkey" FOREIGN KEY ("client") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsLogEntry" ADD CONSTRAINT "CsLogEntry_reverses_fkey" FOREIGN KEY ("reverses") REFERENCES "CsLogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WaitlistEntry_patients" ADD CONSTRAINT "_WaitlistEntry_patients_A_fkey" FOREIGN KEY ("A") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WaitlistEntry_patients" ADD CONSTRAINT "_WaitlistEntry_patients_B_fkey" FOREIGN KEY ("B") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppointmentType_species" ADD CONSTRAINT "_AppointmentType_species_A_fkey" FOREIGN KEY ("A") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppointmentType_species" ADD CONSTRAINT "_AppointmentType_species_B_fkey" FOREIGN KEY ("B") REFERENCES "Species"("id") ON DELETE CASCADE ON UPDATE CASCADE;
