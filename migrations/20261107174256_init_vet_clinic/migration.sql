-- CreateEnum
CREATE TYPE "UserKindType" AS ENUM ('staff', 'relief', 'auditor', 'administrator');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL,
    "role" TEXT,
    "kind" "UserKindType" DEFAULT 'staff',
    "title" TEXT NOT NULL DEFAULT '',
    "mfaEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "accessExpiresAt" TIMESTAMP(3),
    "onboardingStatus" TEXT DEFAULT 'not_started',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordResetToken" TEXT,
    "passwordResetIssuedAt" TIMESTAMP(3),
    "passwordResetRedeemedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "canSeeOtherPeople" BOOLEAN NOT NULL DEFAULT false,
    "canEditOtherPeople" BOOLEAN NOT NULL DEFAULT false,
    "canManagePeople" BOOLEAN NOT NULL DEFAULT false,
    "canManageRoles" BOOLEAN NOT NULL DEFAULT false,
    "canAccessDashboard" BOOLEAN NOT NULL DEFAULT false,
    "canManageOnboarding" BOOLEAN NOT NULL DEFAULT false,
    "canManagePayments" BOOLEAN NOT NULL DEFAULT false,
    "canIssueRefunds" BOOLEAN NOT NULL DEFAULT false,
    "canReadAudit" BOOLEAN NOT NULL DEFAULT false,
    "canManagePractice" BOOLEAN NOT NULL DEFAULT false,
    "canManageIntegrations" BOOLEAN NOT NULL DEFAULT false,
    "canManagePolicies" BOOLEAN NOT NULL DEFAULT false,
    "canManageFees" BOOLEAN NOT NULL DEFAULT false,
    "canApprovePolicies" BOOLEAN NOT NULL DEFAULT false,
    "canApproveFees" BOOLEAN NOT NULL DEFAULT false,
    "canManageClients" BOOLEAN NOT NULL DEFAULT false,
    "canManagePatients" BOOLEAN NOT NULL DEFAULT false,
    "canMergeRecords" BOOLEAN NOT NULL DEFAULT false,
    "canApproveMerges" BOOLEAN NOT NULL DEFAULT false,
    "canReadClinical" BOOLEAN NOT NULL DEFAULT false,
    "canReadClientPII" BOOLEAN NOT NULL DEFAULT false,
    "canBook" BOOLEAN NOT NULL DEFAULT false,
    "canOverbook" BOOLEAN NOT NULL DEFAULT false,
    "canCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "canManageSchedules" BOOLEAN NOT NULL DEFAULT false,
    "canWriteRecord" BOOLEAN NOT NULL DEFAULT false,
    "canSignRecord" BOOLEAN NOT NULL DEFAULT false,
    "canOrder" BOOLEAN NOT NULL DEFAULT false,
    "canAdminister" BOOLEAN NOT NULL DEFAULT false,
    "canPrescribe" BOOLEAN NOT NULL DEFAULT false,
    "canPerformSurgery" BOOLEAN NOT NULL DEFAULT false,
    "canAuthoriseEuthanasia" BOOLEAN NOT NULL DEFAULT false,
    "canDispense" BOOLEAN NOT NULL DEFAULT false,
    "canFulfilRefill" BOOLEAN NOT NULL DEFAULT false,
    "canManageRefills" BOOLEAN NOT NULL DEFAULT false,
    "canAdministerControlled" BOOLEAN NOT NULL DEFAULT false,
    "canWitnessControlled" BOOLEAN NOT NULL DEFAULT false,
    "canCountControlled" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveControlled" BOOLEAN NOT NULL DEFAULT false,
    "canManageControlled" BOOLEAN NOT NULL DEFAULT false,
    "canViewControlled" BOOLEAN NOT NULL DEFAULT false,
    "canManageInventory" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveStock" BOOLEAN NOT NULL DEFAULT false,
    "canOrderStock" BOOLEAN NOT NULL DEFAULT false,
    "canApprovePurchase" BOOLEAN NOT NULL DEFAULT false,
    "canReleaseQuarantine" BOOLEAN NOT NULL DEFAULT false,
    "canTakePayments" BOOLEAN NOT NULL DEFAULT false,
    "canPostInvoices" BOOLEAN NOT NULL DEFAULT false,
    "canAddManualCharge" BOOLEAN NOT NULL DEFAULT false,
    "canDiscount" BOOLEAN NOT NULL DEFAULT false,
    "canApproveDiscount" BOOLEAN NOT NULL DEFAULT false,
    "canApproveWriteOff" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinance" BOOLEAN NOT NULL DEFAULT false,
    "canProcessRecordsRequests" BOOLEAN NOT NULL DEFAULT false,
    "canApproveRecordsRelease" BOOLEAN NOT NULL DEFAULT false,
    "canManageBoarding" BOOLEAN NOT NULL DEFAULT false,
    "canGroom" BOOLEAN NOT NULL DEFAULT false,
    "canMessageClients" BOOLEAN NOT NULL DEFAULT false,
    "canManageTemplates" BOOLEAN NOT NULL DEFAULT false,
    "canManageAgents" BOOLEAN NOT NULL DEFAULT false,
    "canApproveAgentScopes" BOOLEAN NOT NULL DEFAULT false,
    "canBreakGlass" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthApp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecret" TEXT NOT NULL DEFAULT '',
    "tokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_post',
    "redirectUris" JSONB DEFAULT '[]',
    "scopes" JSONB DEFAULT '["mcp:read","mcp:write"]',
    "webhookUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT DEFAULT 'active',
    "installUrl" TEXT NOT NULL DEFAULT '',
    "uninstallUrl" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB DEFAULT '{}',
    "developerEmail" TEXT NOT NULL DEFAULT '',
    "privacyPolicyUrl" TEXT NOT NULL DEFAULT '',
    "termsOfServiceUrl" TEXT NOT NULL DEFAULT '',
    "supportUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "user" TEXT,
    "scopes" JSONB DEFAULT '[]',
    "redirectUri" TEXT NOT NULL DEFAULT '',
    "resource" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "isRevoked" TEXT DEFAULT 'false',
    "authorizationCode" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "codeChallenge" TEXT NOT NULL DEFAULT '',
    "codeChallengeMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentIdentity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'voice_receptionist',
    "model" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "limits" JSONB DEFAULT '{"toolCallsPerRun":40}',
    "oauthApp" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "request" TEXT,
    "decidedBy" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "requiredPermission" TEXT NOT NULL DEFAULT '',
    "minApprovals" INTEGER DEFAULT 1,
    "thresholdMinor" BIGINT,
    "expiresAfterMinutes" INTEGER DEFAULT 1440,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "targetList" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "payloadHash" TEXT NOT NULL DEFAULT '',
    "requiredPermission" TEXT NOT NULL DEFAULT '',
    "requestedBy" TEXT,
    "requestedByAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL DEFAULT '',
    "entityType" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT NOT NULL DEFAULT '',
    "actorUser" TEXT,
    "actorAgent" TEXT,
    "approver" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "requestId" TEXT NOT NULL DEFAULT '',
    "prevHash" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakGlassEvent" (
    "id" TEXT NOT NULL,
    "user" TEXT,
    "resourceType" TEXT NOT NULL DEFAULT '',
    "resourceId" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakGlassEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCalendar" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "timeZone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "kind" TEXT NOT NULL DEFAULT 'location',
    "weekendDays" JSONB DEFAULT '[0,6]',
    "regularOpen" TEXT NOT NULL DEFAULT '08:00',
    "regularClose" TEXT NOT NULL DEFAULT '18:00',
    "coverageThrough" DATE,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarException" (
    "id" TEXT NOT NULL,
    "calendar" TEXT,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'holiday',
    "openAt" TEXT NOT NULL DEFAULT '',
    "closeAt" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL DEFAULT '',
    "command" TEXT NOT NULL DEFAULT '',
    "principalKey" TEXT NOT NULL DEFAULT '',
    "requestHash" TEXT NOT NULL DEFAULT '',
    "requestParams" JSONB,
    "responseCode" TEXT NOT NULL DEFAULT '',
    "responseBody" JSONB,
    "recoveryPoint" TEXT NOT NULL DEFAULT 'completed',
    "completedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'other',
    "storageKey" TEXT NOT NULL DEFAULT '',
    "sha256" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER,
    "documentVersion" INTEGER DEFAULT 1,
    "supersedes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "retentionUntil" DATE,
    "signedAt" TIMESTAMP(3),
    "esignEnvelopeId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalId" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL DEFAULT '',
    "recordType" TEXT NOT NULL DEFAULT '',
    "recordId" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "location" TEXT,
    "secretRef" TEXT NOT NULL DEFAULT '',
    "capabilityProfile" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastHealthAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL DEFAULT '',
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipient" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "template" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "aggregateType" TEXT NOT NULL DEFAULT '',
    "aggregateId" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT NOT NULL DEFAULT '',
    "leaseExpiresAt" TIMESTAMP(3),
    "fencingToken" INTEGER DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderObservation" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "connectionId" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadAudit" (
    "id" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL DEFAULT '',
    "actorLabel" TEXT NOT NULL DEFAULT '',
    "patientId" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "resourceType" TEXT NOT NULL DEFAULT '',
    "resourceId" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL,
    "fields" JSONB,
    "requestId" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "intervalSeconds" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'idle',
    "leaseKey" TEXT NOT NULL DEFAULT '',
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretBox" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "ciphertext" TEXT NOT NULL DEFAULT '',
    "iv" TEXT NOT NULL DEFAULT '',
    "authTag" TEXT NOT NULL DEFAULT '',
    "keyVersion" INTEGER DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeaPowerOfAttorney" (
    "id" TEXT NOT NULL,
    "registration" TEXT,
    "grantee" TEXT,
    "signedOn" DATE,
    "revokedOn" DATE,
    "document" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeaPowerOfAttorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeaRegistration" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "registrantName" TEXT NOT NULL DEFAULT '',
    "registrantKind" TEXT NOT NULL,
    "staffMember" TEXT,
    "location" TEXT,
    "schedules" JSONB,
    "issuedOn" DATE,
    "expiresOn" DATE NOT NULL,
    "stateCsRegistration" TEXT NOT NULL DEFAULT '',
    "csosCertificateRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeaRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseEvaluation" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "staffMember" TEXT,
    "location" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "onDate" DATE,
    "license" TEXT,
    "deaRegistration" TEXT,
    "policyVersions" JSONB,
    "result" TEXT NOT NULL,
    "findings" JSONB,

    CONSTRAINT "LicenseEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'general_practice',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "stateCode" TEXT NOT NULL DEFAULT '',
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "timeZone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "calendar" TEXT,
    "openHours" JSONB,
    "emergencyCoverage" TEXT NOT NULL DEFAULT 'referral',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSettings" (
    "id" INTEGER NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT 'Openfront Vet Clinic',
    "displayName" TEXT NOT NULL DEFAULT 'Openfront Vet Clinic',
    "homeTimeZone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "medicalDirector" TEXT,
    "estimateValidityDays" INTEGER DEFAULT 30,
    "estimateOverageToleranceBps" INTEGER DEFAULT 0,
    "electiveDepositPct" DECIMAL(12,6),
    "depositBasis" TEXT NOT NULL DEFAULT 'low',
    "noShowGraceMinutes" INTEGER DEFAULT 15,
    "unsignedRecordTaskHours" INTEGER DEFAULT 24,
    "unsignedRecordEscalateHours" INTEGER DEFAULT 72,
    "refundApprovalThresholdMinor" BIGINT NOT NULL DEFAULT 25000,
    "discountApprovalThresholdBps" INTEGER DEFAULT 1000,
    "writeOffRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "weightMaxAgeHours" JSONB DEFAULT '{"anaesthesia":24,"inpatient":72,"outpatient":720}',
    "features" JSONB DEFAULT '{"boarding":true,"grooming":true,"wellnessPlans":true,"insurance":true,"aiVoice":false,"scribe":false,"multiLocation":true,"pdmp":true,"csos":false,"drugCabinet":false}',
    "strictAgentOwnerSoD" BOOLEAN NOT NULL DEFAULT true,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'not_started',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalLicense" (
    "id" TEXT NOT NULL,
    "staffMember" TEXT,
    "kind" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT '',
    "licenseNumber" TEXT NOT NULL DEFAULT '',
    "issuedOn" DATE,
    "expiresOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verificationSource" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "user" TEXT,
    "displayName" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'dvm',
    "credentials" TEXT NOT NULL DEFAULT '',
    "employment" TEXT NOT NULL DEFAULT 'employee',
    "homeLocation" TEXT,
    "colour" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subjectType" TEXT NOT NULL DEFAULT '',
    "subjectId" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "startedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL DEFAULT '',
    "escalations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "evidence" JSONB,
    "policyVersion" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "discoveredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "subjectType" TEXT NOT NULL DEFAULT '',
    "subjectId" TEXT NOT NULL DEFAULT '',
    "placedBy" TEXT,
    "placedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineCredential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT '',
    "secretHash" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT '',
    "subjectId" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL,
    "author" TEXT,
    "authorAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyBinding" (
    "id" TEXT NOT NULL,
    "pack" TEXT,
    "scope" TEXT NOT NULL,
    "location" TEXT,
    "layer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyPack" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "pack" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "versionNumber" INTEGER NOT NULL,
    "rules" JSONB,
    "rulesHash" TEXT NOT NULL DEFAULT '',
    "sourceRefs" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "unverifiedRules" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approval" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "recordClass" TEXT NOT NULL DEFAULT '',
    "retainYears" INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "appliesTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "subjectType" TEXT NOT NULL DEFAULT '',
    "subjectId" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "assignee" TEXT,
    "roleName" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdByAgent" TEXT,
    "createdByUser" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolGrant" (
    "id" TEXT NOT NULL,
    "agent" TEXT,
    "scope" TEXT NOT NULL,
    "constraints" JSONB,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "approval" TEXT,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent" TEXT,
    "startedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'started',
    "promptHash" TEXT NOT NULL DEFAULT '',
    "toolCalls" JSONB,
    "costMeta" JSONB,
    "callRecordId" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "agent" TEXT,
    "run" TEXT,
    "tool" TEXT NOT NULL DEFAULT '',
    "argsHash" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL DEFAULT '',
    "auditEventId" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "payloadHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "agentRun" TEXT,
    "proposedByAgent" TEXT,
    "proposedByUser" TEXT,
    "targetList" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "approval" TEXT,
    "validation" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BusinessCalendar_composedOf" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_StaffMember_locations" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthApp_clientId_key" ON "OAuthApp"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_token_key" ON "OAuthToken"("token");

-- CreateIndex
CREATE INDEX "OAuthToken_clientId_idx" ON "OAuthToken"("clientId");

-- CreateIndex
CREATE INDEX "OAuthToken_user_idx" ON "OAuthToken"("user");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIdentity_name_key" ON "AgentIdentity"("name");

-- CreateIndex
CREATE INDEX "AgentIdentity_owner_idx" ON "AgentIdentity"("owner");

-- CreateIndex
CREATE INDEX "AgentIdentity_oauthApp_idx" ON "AgentIdentity"("oauthApp");

-- CreateIndex
CREATE INDEX "ApprovalDecision_request_idx" ON "ApprovalDecision"("request");

-- CreateIndex
CREATE INDEX "ApprovalDecision_decidedBy_idx" ON "ApprovalDecision"("decidedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_action_key" ON "ApprovalPolicy"("action");

-- CreateIndex
CREATE INDEX "ApprovalRequest_action_idx" ON "ApprovalRequest"("action");

-- CreateIndex
CREATE INDEX "ApprovalRequest_targetId_idx" ON "ApprovalRequest"("targetId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedBy_idx" ON "ApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedByAgent_idx" ON "ApprovalRequest"("requestedByAgent");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventKey_key" ON "AuditEvent"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_idx" ON "AuditEvent"("entityType");

-- CreateIndex
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUser_idx" ON "AuditEvent"("actorUser");

-- CreateIndex
CREATE INDEX "AuditEvent_actorAgent_idx" ON "AuditEvent"("actorAgent");

-- CreateIndex
CREATE INDEX "AuditEvent_approver_idx" ON "AuditEvent"("approver");

-- CreateIndex
CREATE INDEX "BreakGlassEvent_user_idx" ON "BreakGlassEvent"("user");

-- CreateIndex
CREATE INDEX "BreakGlassEvent_reviewedBy_idx" ON "BreakGlassEvent"("reviewedBy");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCalendar_code_key" ON "BusinessCalendar"("code");

-- CreateIndex
CREATE INDEX "CalendarException_calendar_idx" ON "CalendarException"("calendar");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarException_calendar_date_key" ON "CalendarException"("calendar", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_idempotencyKey_key" ON "CommandReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Document_supersedes_idx" ON "Document"("supersedes");

-- CreateIndex
CREATE INDEX "ExternalId_system_idx" ON "ExternalId"("system");

-- CreateIndex
CREATE INDEX "ExternalId_recordId_idx" ON "ExternalId"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalId_system_value_key" ON "ExternalId"("system", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalId_system_record_key" ON "ExternalId"("system", "recordType", "recordId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_location_idx" ON "IntegrationConnection"("location");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_key_key" ON "Lease"("key");

-- CreateIndex
CREATE INDEX "Notification_recipient_idx" ON "Notification"("recipient");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_topic_idx" ON "OutboxEvent"("topic");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_idx" ON "OutboxEvent"("aggregateId");

-- CreateIndex
CREATE INDEX "ProviderObservation_source_idx" ON "ProviderObservation"("source");

-- CreateIndex
CREATE INDEX "ProviderObservation_externalId_idx" ON "ProviderObservation"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderObservation_source_external_key" ON "ProviderObservation"("source", "connectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderObservation_source_hash_key" ON "ProviderObservation"("source", "contentHash");

-- CreateIndex
CREATE INDEX "ReadAudit_actorId_idx" ON "ReadAudit"("actorId");

-- CreateIndex
CREATE INDEX "ReadAudit_patientId_idx" ON "ReadAudit"("patientId");

-- CreateIndex
CREATE INDEX "ReadAudit_clientId_idx" ON "ReadAudit"("clientId");

-- CreateIndex
CREATE INDEX "ReadAudit_resourceType_idx" ON "ReadAudit"("resourceType");

-- CreateIndex
CREATE INDEX "ReadAudit_resourceId_idx" ON "ReadAudit"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_kind_key" ON "ScheduledJob"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_key_key" ON "Sequence"("key");

-- CreateIndex
CREATE INDEX "DeaPowerOfAttorney_registration_idx" ON "DeaPowerOfAttorney"("registration");

-- CreateIndex
CREATE INDEX "DeaPowerOfAttorney_grantee_idx" ON "DeaPowerOfAttorney"("grantee");

-- CreateIndex
CREATE INDEX "DeaPowerOfAttorney_document_idx" ON "DeaPowerOfAttorney"("document");

-- CreateIndex
CREATE UNIQUE INDEX "DeaRegistration_registrationNumber_key" ON "DeaRegistration"("registrationNumber");

-- CreateIndex
CREATE INDEX "DeaRegistration_staffMember_idx" ON "DeaRegistration"("staffMember");

-- CreateIndex
CREATE INDEX "DeaRegistration_location_idx" ON "DeaRegistration"("location");

-- CreateIndex
CREATE INDEX "LicenseEvaluation_action_idx" ON "LicenseEvaluation"("action");

-- CreateIndex
CREATE INDEX "LicenseEvaluation_staffMember_idx" ON "LicenseEvaluation"("staffMember");

-- CreateIndex
CREATE INDEX "LicenseEvaluation_location_idx" ON "LicenseEvaluation"("location");

-- CreateIndex
CREATE INDEX "LicenseEvaluation_license_idx" ON "LicenseEvaluation"("license");

-- CreateIndex
CREATE INDEX "LicenseEvaluation_deaRegistration_idx" ON "LicenseEvaluation"("deaRegistration");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_calendar_idx" ON "Location"("calendar");

-- CreateIndex
CREATE INDEX "PracticeSettings_medicalDirector_idx" ON "PracticeSettings"("medicalDirector");

-- CreateIndex
CREATE INDEX "ProfessionalLicense_staffMember_idx" ON "ProfessionalLicense"("staffMember");

-- CreateIndex
CREATE INDEX "ProfessionalLicense_verifiedBy_idx" ON "ProfessionalLicense"("verifiedBy");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalLicense_state_kind_number_key" ON "ProfessionalLicense"("stateCode", "kind", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_user_key" ON "StaffMember"("user");

-- CreateIndex
CREATE INDEX "StaffMember_homeLocation_idx" ON "StaffMember"("homeLocation");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceTask_dedupeKey_key" ON "ComplianceTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "ComplianceTask_subjectId_idx" ON "ComplianceTask"("subjectId");

-- CreateIndex
CREATE INDEX "ComplianceTask_location_idx" ON "ComplianceTask"("location");

-- CreateIndex
CREATE INDEX "ComplianceTask_policyVersion_idx" ON "ComplianceTask"("policyVersion");

-- CreateIndex
CREATE INDEX "ComplianceTask_completedBy_idx" ON "ComplianceTask"("completedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_ref_key" ON "Incident"("ref");

-- CreateIndex
CREATE INDEX "Incident_location_idx" ON "Incident"("location");

-- CreateIndex
CREATE UNIQUE INDEX "LegalHold_ref_key" ON "LegalHold"("ref");

-- CreateIndex
CREATE INDEX "LegalHold_subjectId_idx" ON "LegalHold"("subjectId");

-- CreateIndex
CREATE INDEX "LegalHold_placedBy_idx" ON "LegalHold"("placedBy");

-- CreateIndex
CREATE INDEX "LegalHold_releasedBy_idx" ON "LegalHold"("releasedBy");

-- CreateIndex
CREATE UNIQUE INDEX "MachineCredential_name_key" ON "MachineCredential"("name");

-- CreateIndex
CREATE INDEX "Note_subjectId_idx" ON "Note"("subjectId");

-- CreateIndex
CREATE INDEX "Note_author_idx" ON "Note"("author");

-- CreateIndex
CREATE INDEX "Note_authorAgent_idx" ON "Note"("authorAgent");

-- CreateIndex
CREATE INDEX "PolicyBinding_pack_idx" ON "PolicyBinding"("pack");

-- CreateIndex
CREATE INDEX "PolicyBinding_location_idx" ON "PolicyBinding"("location");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyBinding_pack_scope_location_key" ON "PolicyBinding"("pack", "scope", "location");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyPack_code_key" ON "PolicyPack"("code");

-- CreateIndex
CREATE INDEX "PolicyPack_jurisdiction_idx" ON "PolicyPack"("jurisdiction");

-- CreateIndex
CREATE INDEX "PolicyVersion_pack_idx" ON "PolicyVersion"("pack");

-- CreateIndex
CREATE INDEX "PolicyVersion_approval_idx" ON "PolicyVersion"("approval");

-- CreateIndex
CREATE INDEX "PolicyVersion_publishedBy_idx" ON "PolicyVersion"("publishedBy");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_pack_number_key" ON "PolicyVersion"("pack", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_recordClass_key" ON "RetentionPolicy"("recordClass");

-- CreateIndex
CREATE INDEX "RetentionPolicy_policyVersion_idx" ON "RetentionPolicy"("policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Task_ref_key" ON "Task"("ref");

-- CreateIndex
CREATE INDEX "Task_subjectId_idx" ON "Task"("subjectId");

-- CreateIndex
CREATE INDEX "Task_location_idx" ON "Task"("location");

-- CreateIndex
CREATE INDEX "Task_assignee_idx" ON "Task"("assignee");

-- CreateIndex
CREATE INDEX "Task_createdByAgent_idx" ON "Task"("createdByAgent");

-- CreateIndex
CREATE INDEX "Task_createdByUser_idx" ON "Task"("createdByUser");

-- CreateIndex
CREATE INDEX "AgentToolGrant_agent_idx" ON "AgentToolGrant"("agent");

-- CreateIndex
CREATE INDEX "AgentToolGrant_approval_idx" ON "AgentToolGrant"("approval");

-- CreateIndex
CREATE INDEX "AgentRun_agent_idx" ON "AgentRun"("agent");

-- CreateIndex
CREATE INDEX "AgentRun_callRecordId_idx" ON "AgentRun"("callRecordId");

-- CreateIndex
CREATE INDEX "AgentAction_agent_idx" ON "AgentAction"("agent");

-- CreateIndex
CREATE INDEX "AgentAction_run_idx" ON "AgentAction"("run");

-- CreateIndex
CREATE INDEX "AgentAction_tool_idx" ON "AgentAction"("tool");

-- CreateIndex
CREATE INDEX "Proposal_agentRun_idx" ON "Proposal"("agentRun");

-- CreateIndex
CREATE INDEX "Proposal_proposedByAgent_idx" ON "Proposal"("proposedByAgent");

-- CreateIndex
CREATE INDEX "Proposal_proposedByUser_idx" ON "Proposal"("proposedByUser");

-- CreateIndex
CREATE INDEX "Proposal_targetId_idx" ON "Proposal"("targetId");

-- CreateIndex
CREATE INDEX "Proposal_approval_idx" ON "Proposal"("approval");

-- CreateIndex
CREATE UNIQUE INDEX "_BusinessCalendar_composedOf_AB_unique" ON "_BusinessCalendar_composedOf"("A", "B");

-- CreateIndex
CREATE INDEX "_BusinessCalendar_composedOf_B_index" ON "_BusinessCalendar_composedOf"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_StaffMember_locations_AB_unique" ON "_StaffMember_locations"("A", "B");

-- CreateIndex
CREATE INDEX "_StaffMember_locations_B_index" ON "_StaffMember_locations"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_oauthApp_fkey" FOREIGN KEY ("oauthApp") REFERENCES "OAuthApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_request_fkey" FOREIGN KEY ("request") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedByAgent_fkey" FOREIGN KEY ("requestedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUser_fkey" FOREIGN KEY ("actorUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorAgent_fkey" FOREIGN KEY ("actorAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_approver_fkey" FOREIGN KEY ("approver") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakGlassEvent" ADD CONSTRAINT "BreakGlassEvent_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakGlassEvent" ADD CONSTRAINT "BreakGlassEvent_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarException" ADD CONSTRAINT "CalendarException_calendar_fkey" FOREIGN KEY ("calendar") REFERENCES "BusinessCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_supersedes_fkey" FOREIGN KEY ("supersedes") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_fkey" FOREIGN KEY ("recipient") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeaPowerOfAttorney" ADD CONSTRAINT "DeaPowerOfAttorney_registration_fkey" FOREIGN KEY ("registration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeaPowerOfAttorney" ADD CONSTRAINT "DeaPowerOfAttorney_grantee_fkey" FOREIGN KEY ("grantee") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeaPowerOfAttorney" ADD CONSTRAINT "DeaPowerOfAttorney_document_fkey" FOREIGN KEY ("document") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeaRegistration" ADD CONSTRAINT "DeaRegistration_staffMember_fkey" FOREIGN KEY ("staffMember") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeaRegistration" ADD CONSTRAINT "DeaRegistration_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvaluation" ADD CONSTRAINT "LicenseEvaluation_staffMember_fkey" FOREIGN KEY ("staffMember") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvaluation" ADD CONSTRAINT "LicenseEvaluation_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvaluation" ADD CONSTRAINT "LicenseEvaluation_license_fkey" FOREIGN KEY ("license") REFERENCES "ProfessionalLicense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvaluation" ADD CONSTRAINT "LicenseEvaluation_deaRegistration_fkey" FOREIGN KEY ("deaRegistration") REFERENCES "DeaRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_calendar_fkey" FOREIGN KEY ("calendar") REFERENCES "BusinessCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSettings" ADD CONSTRAINT "PracticeSettings_medicalDirector_fkey" FOREIGN KEY ("medicalDirector") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalLicense" ADD CONSTRAINT "ProfessionalLicense_staffMember_fkey" FOREIGN KEY ("staffMember") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalLicense" ADD CONSTRAINT "ProfessionalLicense_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_user_fkey" FOREIGN KEY ("user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_homeLocation_fkey" FOREIGN KEY ("homeLocation") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceTask" ADD CONSTRAINT "ComplianceTask_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceTask" ADD CONSTRAINT "ComplianceTask_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceTask" ADD CONSTRAINT "ComplianceTask_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_placedBy_fkey" FOREIGN KEY ("placedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_releasedBy_fkey" FOREIGN KEY ("releasedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_author_fkey" FOREIGN KEY ("author") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorAgent_fkey" FOREIGN KEY ("authorAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_pack_fkey" FOREIGN KEY ("pack") REFERENCES "PolicyPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_pack_fkey" FOREIGN KEY ("pack") REFERENCES "PolicyPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_approval_fkey" FOREIGN KEY ("approval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_location_fkey" FOREIGN KEY ("location") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByAgent_fkey" FOREIGN KEY ("createdByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUser_fkey" FOREIGN KEY ("createdByUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolGrant" ADD CONSTRAINT "AgentToolGrant_agent_fkey" FOREIGN KEY ("agent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolGrant" ADD CONSTRAINT "AgentToolGrant_approval_fkey" FOREIGN KEY ("approval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agent_fkey" FOREIGN KEY ("agent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_agent_fkey" FOREIGN KEY ("agent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_run_fkey" FOREIGN KEY ("run") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_agentRun_fkey" FOREIGN KEY ("agentRun") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposedByAgent_fkey" FOREIGN KEY ("proposedByAgent") REFERENCES "AgentIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposedByUser_fkey" FOREIGN KEY ("proposedByUser") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_approval_fkey" FOREIGN KEY ("approval") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BusinessCalendar_composedOf" ADD CONSTRAINT "_BusinessCalendar_composedOf_A_fkey" FOREIGN KEY ("A") REFERENCES "BusinessCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BusinessCalendar_composedOf" ADD CONSTRAINT "_BusinessCalendar_composedOf_B_fkey" FOREIGN KEY ("B") REFERENCES "BusinessCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffMember_locations" ADD CONSTRAINT "_StaffMember_locations_A_fkey" FOREIGN KEY ("A") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffMember_locations" ADD CONSTRAINT "_StaffMember_locations_B_fkey" FOREIGN KEY ("B") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
