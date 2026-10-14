-- Legal requests (owner, 14 Oct 2026): a request form reached by link only (/f/legal-<token>), the requester's
-- view in My Submissions, and the Legal board (To Do / In Progress / Done). Two new tables, nothing else.
-- Expand-only and idempotent: CREATE ... IF NOT EXISTS, constraints added only when missing. Nothing is
-- rewritten or dropped. Safe BEFORE the deploy: the running build never reads these tables.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-14-legal-requests.sql
-- Names follow Prisma's conventions (<Table>_<cols>_key/_idx/_fkey) so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "LegalRequestLink" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "companyId" TEXT,
    "accepting" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "rotatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRequestLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegalRequestLink_scope_key" ON "LegalRequestLink"("scope");
CREATE UNIQUE INDEX IF NOT EXISTS "LegalRequestLink_token_key" ON "LegalRequestLink"("token");

CREATE TABLE IF NOT EXISTS "LegalRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT,
    "linkId" TEXT,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "templateName" TEXT NOT NULL DEFAULT '',
    "docType" TEXT NOT NULL,
    "isAddendum" BOOLEAN NOT NULL DEFAULT false,
    "parentNumberText" TEXT NOT NULL DEFAULT '',
    "parentDocumentId" TEXT,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "purpose" TEXT NOT NULL DEFAULT '',
    "deadline" TIMESTAMP(3),
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "projectId" TEXT,
    "dealId" TEXT,
    "column" TEXT NOT NULL DEFAULT 'TODO',
    "stage" TEXT NOT NULL DEFAULT 'RECEIVED',
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "rejectedById" TEXT,
    "picId" TEXT,
    "documentId" TEXT,
    "doneAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegalRequest_documentId_key" ON "LegalRequest"("documentId");
CREATE UNIQUE INDEX IF NOT EXISTS "LegalRequest_requesterId_idempotencyKey_key" ON "LegalRequest"("requesterId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "LegalRequest_column_idx" ON "LegalRequest"("column");
CREATE INDEX IF NOT EXISTS "LegalRequest_requesterId_createdAt_idx" ON "LegalRequest"("requesterId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalRequestLink_companyId_fkey') THEN
    ALTER TABLE "LegalRequestLink" ADD CONSTRAINT "LegalRequestLink_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "LegalCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalRequest_requesterId_fkey') THEN
    ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_requesterId_fkey"
      FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalRequest_companyId_fkey') THEN
    ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "LegalCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalRequest_picId_fkey') THEN
    ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_picId_fkey"
      FOREIGN KEY ("picId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalRequest_documentId_fkey') THEN
    ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
