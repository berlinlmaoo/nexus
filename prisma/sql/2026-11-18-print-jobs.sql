-- bluegreen: expand   (additive: one new table; safe BEFORE the deploy)
-- Print to the office printer (18 Nov 2026, lib/print): "PrintJob" logs every Legal document / Doc page sent to the
-- CUPS queue in PRINT_IPP_URL: who, what, pages, copies, colour, the CUPS job id and how it ended. No FK to "User",
-- the document or the page, like "GideonRun": the log must outlive them.
--
-- Expand-only and idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Safe BEFORE the deploy: the running build never
-- reads this table.
--   nexus-sql.sh <env> apply prisma/sql/2026-11-18-print-jobs.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "PrintJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "colorMode" TEXT NOT NULL DEFAULT 'mono',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "ippJobId" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrintJob_userId_createdAt_idx" ON "PrintJob" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PrintJob_createdAt_idx" ON "PrintJob" ("createdAt");
CREATE INDEX IF NOT EXISTS "PrintJob_status_idx" ON "PrintJob" ("status");

COMMIT;
