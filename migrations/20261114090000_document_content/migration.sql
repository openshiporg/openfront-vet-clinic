-- A records-request proof file (base64) kept in the database when no object store is configured; never in the API.
ALTER TABLE "Document" ADD COLUMN     "content" TEXT NOT NULL DEFAULT '';
