-- Pipeline Dashboard, payments per term (owner, 9 Oct 2026: "perlu per termin"): a deal is paid in terms
-- (DP, Termin 1, …), each with its amount, due date, invoice and payment. History rows say which term
-- they are about. Additive and idempotent: run it as many times as you like. Apply BEFORE deploying the
-- image that reads these columns (after 2026-10-09-pipeline.sql and 2026-10-09-pipeline-execution.sql):
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-09-pipeline-terms.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

BEGIN;

CREATE TABLE IF NOT EXISTS "PipelinePaymentTerm" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "invoiceNo" TEXT NOT NULL DEFAULT '',
    "invoiceDate" TIMESTAMP(3),
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PipelinePaymentTerm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PipelinePaymentTerm_dealId_position_idx" ON "PipelinePaymentTerm"("dealId", "position");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelinePaymentTerm_dealId_fkey') THEN
    ALTER TABLE "PipelinePaymentTerm" ADD CONSTRAINT "PipelinePaymentTerm_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "PipelineDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "PipelineDealChange" ADD COLUMN IF NOT EXISTS "termId" TEXT;
ALTER TABLE "PipelineDealChange" ADD COLUMN IF NOT EXISTS "termLabel" TEXT;

COMMIT;
