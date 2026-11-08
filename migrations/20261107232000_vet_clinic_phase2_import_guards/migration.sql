-- Imported consults (kind records_import) are signed by the source system, not by a clinician
-- here: the source signer is kept in signedContent, signedBy stays empty so nobody at this
-- practice is credited with a signature they never gave. Every other kind still needs a signer.
ALTER TABLE "Encounter" DROP CONSTRAINT "Encounter_signed_complete";
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_signed_complete" CHECK (status <> 'signed' OR ("signedAt" IS NOT NULL AND "contentHash" ~ '^[0-9a-f]{64}$' AND ("signedBy" IS NOT NULL OR (kind = 'records_import' AND "signedContent" ? 'signer'))));
-- An imported history never establishes a VCPR here.
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_import_not_vcpr" CHECK (kind <> 'records_import' OR "vcprQualifying" = false);
