-- Legal (owner, 14 Oct 2026): signed copies, VOID gives an unsigned document's number back, addenda.
-- Expand-only and idempotent: new nullable columns, one index, foreign keys with SET NULL. Nothing is
-- rewritten or dropped. Safe BEFORE the deploy: the running build never reads or writes these columns.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-14-legal-signed-void-addendum.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "DocumentNumber" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "DocumentNumber" ADD COLUMN IF NOT EXISTS "releasedFromId" TEXT;

ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3);
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "signedById" TEXT;
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "signedVersion" INTEGER;
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "numberReleasedAt" TIMESTAMP(3);
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "numberReusedById" TEXT;
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "parentDocumentId" TEXT;
ALTER TABLE "LegalDocument" ADD COLUMN IF NOT EXISTS "addendumSeq" INTEGER;

CREATE INDEX IF NOT EXISTS "LegalDocument_parentDocumentId_idx" ON "LegalDocument"("parentDocumentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_signedById_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_signedById_fkey"
      FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_numberReusedById_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_numberReusedById_fkey"
      FOREIGN KEY ("numberReusedById") REFERENCES "LegalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_parentDocumentId_fkey') THEN
    ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_parentDocumentId_fkey"
      FOREIGN KEY ("parentDocumentId") REFERENCES "LegalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Documents already SIGNED before this change: record when (best known: their last update).
UPDATE "LegalDocument" SET "signedAt" = "updatedAt" WHERE "status" = 'SIGNED' AND "signedAt" IS NULL;

COMMIT;
