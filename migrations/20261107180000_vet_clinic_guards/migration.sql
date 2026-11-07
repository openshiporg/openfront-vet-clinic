-- ── Vet clinic guards (SCHEMA G8, I-P2, I-R3) ─────────────────────────────────────
-- History that can never be rewritten, whatever the application does. Corrections are new rows.
CREATE OR REPLACE FUNCTION vc_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AuditEvent', 'ApprovalDecision', 'ReadAudit', 'LicenseEvaluation', 'AgentAction'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vc_forbid_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- A policy version's content is frozen once stored (G7). Only its lifecycle moves: draft → published
-- → superseded, and an open-ended version may be closed once (effectiveTo set from null).
CREATE OR REPLACE FUNCTION vc_policy_version_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PolicyVersion rows are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.pack IS DISTINCT FROM OLD.pack OR NEW.label IS DISTINCT FROM OLD.label OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
     OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash" OR NEW."sourceRefs" IS DISTINCT FROM OLD."sourceRefs"
     OR NEW.verified IS DISTINCT FROM OLD.verified OR NEW."unverifiedRules" IS DISTINCT FROM OLD."unverifiedRules" OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo") THEN
    RAISE EXCEPTION 'PolicyVersion rows are append-only: publish a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' OR OLD.status = 'published' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'PolicyVersion status cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PolicyVersion_frozen" BEFORE UPDATE OR DELETE ON "PolicyVersion" FOR EACH ROW EXECUTE FUNCTION vc_policy_version_frozen();
CREATE TRIGGER "PolicyVersion_no_truncate" BEFORE TRUNCATE ON "PolicyVersion" FOR EACH STATEMENT EXECUTE FUNCTION vc_forbid_change();

-- A DEA registration number identifies the registrant (21 CFR 1301.12): a new number is a new
-- registration row, never an edit.
CREATE OR REPLACE FUNCTION vc_dea_number_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."registrationNumber" IS DISTINCT FROM OLD."registrationNumber" THEN
    RAISE EXCEPTION 'A DEA number cannot be changed; record a new registration' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DeaRegistration_number_fixed" BEFORE UPDATE ON "DeaRegistration" FOR EACH ROW EXECUTE FUNCTION vc_dea_number_fixed();

-- DEA number format (21 CFR 1301; letters + 7 digits). The check digit is verified in the application.
ALTER TABLE "DeaRegistration" ADD CONSTRAINT "DeaRegistration_number_format" CHECK ("registrationNumber" ~ '^[A-Z][A-Z9][0-9]{7}$');
ALTER TABLE "DeaRegistration" ADD CONSTRAINT "DeaRegistration_dates" CHECK ("issuedOn" IS NULL OR "issuedOn" <= "expiresOn");
ALTER TABLE "ProfessionalLicense" ADD CONSTRAINT "ProfessionalLicense_dates" CHECK ("issuedOn" IS NULL OR "issuedOn" <= "expiresOn");
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_dates" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_number_positive" CHECK ("versionNumber" > 0);
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_hash_format" CHECK ("rulesHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_seq_positive" CHECK (seq > 0);
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_hash_format" CHECK (hash ~ '^[0-9a-f]{64}$' AND "prevHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_attempts_nonnegative" CHECK (attempts >= 0);
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_fencing_positive" CHECK ("fencingToken" > 0);
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_next_positive" CHECK ("nextValue" > 0);
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_min_approvals" CHECK ("minApprovals" >= 1);
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_version_nonnegative" CHECK (version >= 0);
ALTER TABLE "PracticeSettings" ADD CONSTRAINT "PracticeSettings_singleton" CHECK (id = 1);

-- Due-work indexes for the workers.
CREATE INDEX "OutboxEvent_due_idx" ON "OutboxEvent" ("nextAttemptAt", "createdAt") WHERE status IN ('pending', 'failed');
CREATE INDEX "OutboxEvent_leased_idx" ON "OutboxEvent" ("leaseExpiresAt") WHERE status = 'leased';
