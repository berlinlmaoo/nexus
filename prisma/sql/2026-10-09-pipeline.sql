-- Pipeline Dashboard (Project.type "PIPELINE", owner 9 Oct 2026): deals and their per-field history.
-- Additive and idempotent: run it as many times as you like; it only creates what is missing and never
-- drops or rewrites a row. Apply BEFORE deploying the image whose Prisma client reads these tables:
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-09-pipeline.sql
-- Names follow Prisma's conventions (<Table>_<cols>_key/_idx/_fkey) so `prisma migrate diff` sees no drift.

BEGIN;

CREATE TABLE IF NOT EXISTS "PipelineDeal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL DEFAULT 'Other',
    "bdUserId" TEXT,
    "bdName" TEXT,
    "pmUserId" TEXT,
    "pmName" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Incoming',
    "probability" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "contractValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "invoiceValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contractStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "vregStatus" TEXT NOT NULL DEFAULT 'Not Required',
    "readiness" TEXT NOT NULL DEFAULT 'N/A',
    "deliverableStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "deliverableRisk" TEXT NOT NULL DEFAULT 'Aman',
    "paymentStatus" TEXT NOT NULL DEFAULT 'Not Yet',
    "outstandingReceivable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentDueDate" TIMESTAMP(3),
    "maxDaysOverdue" INTEGER NOT NULL DEFAULT 0,
    "netCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingStatus" TEXT NOT NULL DEFAULT 'Not Ready',
    "mainDate" TIMESTAMP(3),
    "nextAction" TEXT NOT NULL DEFAULT '',
    "nextActionDate" TIMESTAMP(3),
    "blocker" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "links" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PipelineDeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PipelineDealChange" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT,
    "field" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineDealChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineDeal_projectId_code_key" ON "PipelineDeal"("projectId", "code");
CREATE INDEX IF NOT EXISTS "PipelineDeal_projectId_stage_position_idx" ON "PipelineDeal"("projectId", "stage", "position");
CREATE INDEX IF NOT EXISTS "PipelineDealChange_dealId_createdAt_idx" ON "PipelineDealChange"("dealId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_projectId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_bdUserId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_bdUserId_fkey"
      FOREIGN KEY ("bdUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_pmUserId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_pmUserId_fkey"
      FOREIGN KEY ("pmUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_createdById_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_updatedById_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDealChange_dealId_fkey') THEN
    ALTER TABLE "PipelineDealChange" ADD CONSTRAINT "PipelineDealChange_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "PipelineDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDealChange_userId_fkey') THEN
    ALTER TABLE "PipelineDealChange" ADD CONSTRAINT "PipelineDealChange_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
