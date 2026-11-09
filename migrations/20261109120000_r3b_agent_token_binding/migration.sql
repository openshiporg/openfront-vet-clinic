-- r3b fixes: a token remembers which agent it was issued to, so unbinding can never turn it into the
-- approver's session. The application refuses any token on a bound app unless it names that agent.
ALTER TABLE "OAuthToken" ADD COLUMN "agentId" TEXT NOT NULL DEFAULT '';

-- One app, one agent: the app's tokens act as that agent, so the binding must be unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentIdentity_oauthApp_one_agent" ON "AgentIdentity"("oauthApp") WHERE "oauthApp" IS NOT NULL;

-- The agents' own role: no permission at all. An agent acts only through its tool grants.
INSERT INTO "Role" (id, name, description)
VALUES ('seed_role_ai_agent', 'AI Agent', 'Least privilege for AI agents. Holds no permission: an agent acts only through its tool grants and never inherits the person who connected it.')
ON CONFLICT (id) DO NOTHING;

-- Each bound agent gets its own service user (no usable password) on that role.
INSERT INTO "User" (id, name, email, password, kind, role, title, "onboardingStatus")
SELECT 'agent_user_' || a.id, a.name || ' (agent)', 'agent-' || a.id || '@agents.invalid',
       '$2a$10$3dITCbIvf5zFA.1U8KZDhOHC3EEexi3KYy5ysZK1cRF6LHMm0H.ya', 'staff', 'seed_role_ai_agent', 'AI agent', 'dismissed'
FROM "AgentIdentity" a
ON CONFLICT (id) DO NOTHING;

-- Anything issued before this change to an app that is bound to an agent is ended now.
UPDATE "OAuthToken" t SET "isRevoked" = 'true'
WHERE t."isRevoked" = 'false' AND t."agentId" = ''
  AND EXISTS (SELECT 1 FROM "OAuthApp" a JOIN "AgentIdentity" g ON g."oauthApp" = a.id WHERE a."clientId" = t."clientId");

-- No rabies certificate without the vaccine it certifies. The certificate is written first and the
-- administration then points at it, so the check runs at commit: by then a VaccineAdministration of
-- a rabies product for the same patient must reference the certificate.
CREATE OR REPLACE FUNCTION vc_certificate_needs_vaccine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "VaccineAdministration" va JOIN "VaccineProduct" p ON p.id = va.product
    WHERE va.certificate = NEW.id AND va.patient = NEW.patient AND p."isRabies"
  ) THEN
    RAISE EXCEPTION 'A rabies certificate needs the rabies vaccine it certifies (certificate %)', NEW.ref USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS "RabiesCertificate_needs_vaccine" ON "RabiesCertificate";
CREATE CONSTRAINT TRIGGER "RabiesCertificate_needs_vaccine" AFTER INSERT ON "RabiesCertificate"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vc_certificate_needs_vaccine();
