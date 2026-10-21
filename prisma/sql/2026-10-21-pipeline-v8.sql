-- bluegreen: expand   (additive: two columns with defaults, one new table; safe BEFORE the deploy)
-- Pipeline Dashboard v8 (Control Tower v8, 21 Oct 2026): barter on the deal, and one table for the deal's open
-- lists — cashback recipients, project contacts and budget categories (PipelineDealItem.kind). Cost lines
-- (PipelineDeal.costs, JSON) gain an optional "budgetId" key inside the JSON: no column change.
-- Additive and idempotent: run it as many times as you like; no backfill (every existing deal reads as no
-- barter, no cashback, no contacts, no budget). The old build never names these columns or the table.
-- Apply BEFORE deploying the image that reads them:
--   ~/deploy-nexus-bluegreen.sh sql apply ~/nexus/prisma/sql/2026-10-21-pipeline-v8.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "barterValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "barterCompensation" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "PipelineDealItem" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PipelineDealItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PipelineDealItem_dealId_kind_position_idx" ON "PipelineDealItem"("dealId", "kind", "position");

-- "Add" with the same client key on the same deal stores one row (a retried or double-tapped request).
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineDealItem_dealId_clientRequestId_key"
  ON "PipelineDealItem" ("dealId", "clientRequestId")
  WHERE "clientRequestId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDealItem_dealId_fkey') THEN
    ALTER TABLE "PipelineDealItem" ADD CONSTRAINT "PipelineDealItem_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "PipelineDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDealItem_kind_check') THEN
    ALTER TABLE "PipelineDealItem" ADD CONSTRAINT "PipelineDealItem_kind_check"
      CHECK ("kind" IN ('cashback', 'contact', 'budget'));
  END IF;
END $$;

COMMIT;
