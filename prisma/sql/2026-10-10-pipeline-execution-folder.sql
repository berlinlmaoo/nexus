-- Pipeline Dashboard, won → execution folder (owner, 10 Oct 2026: "soal won itu jangan dibuat otomatis tpi
-- siapin aja tombol untuk 'Create execution project' nanti langsung lo buatin 1 folder di project yg isinya
-- Master Calendar sama Master Task"): a won deal points at the folder made for its execution and at that
-- folder's Master Calendar project (executionProjectId keeps pointing at the Master Task).
-- Additive and idempotent: run it as many times as you like. Apply BEFORE deploying the image that reads
-- these columns (after prisma/sql/2026-10-09-pipeline-execution.sql):
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-10-pipeline-execution-folder.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

BEGIN;

ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "executionCalendarProjectId" TEXT;
ALTER TABLE "PipelineDeal" ADD COLUMN IF NOT EXISTS "executionFolderId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineDeal_executionCalendarProjectId_key" ON "PipelineDeal"("executionCalendarProjectId");
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineDeal_executionFolderId_key" ON "PipelineDeal"("executionFolderId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_executionCalendarProjectId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_executionCalendarProjectId_fkey"
      FOREIGN KEY ("executionCalendarProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineDeal_executionFolderId_fkey') THEN
    ALTER TABLE "PipelineDeal" ADD CONSTRAINT "PipelineDeal_executionFolderId_fkey"
      FOREIGN KEY ("executionFolderId") REFERENCES "ProjectFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
