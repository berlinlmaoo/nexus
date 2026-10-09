-- Pipeline Dashboard, won → execution (owner/GM, 9 Oct 2026: "after udah won lebih enak kalo kebentuk
-- Master Calendar sama Master Task buat projectnya"): a won deal points at the Task project made for its
-- execution, and at the task that puts its main date on the Master Calendar.
-- Additive and idempotent: run it as many times as you like. Apply BEFORE deploying the image that reads
-- these columns (after prisma/sql/2026-10-09-pipeline.sql):
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-09-pipeline-execution.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

BEGIN;

ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "executionProjectId" TEXT;
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "executionCreatedAt" TIMESTAMP(3);
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "mainDateTaskId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineDeal_executionProjectId_key" ON "PipelineDeal"("executionProjectId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_executionProjectId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_executionProjectId_fkey"
      FOREIGN KEY ("executionProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
