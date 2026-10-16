-- Pipeline deal codes unique across all boards and never reused (owner, 16 Oct 2026). One new table holding every
-- code ever handed out, filled once from the deals that exist now. Expand-only and idempotent: CREATE ... IF NOT
-- EXISTS, the fill skips codes already there. Nothing is rewritten or dropped. Safe BEFORE the deploy: the
-- running build never reads the table (a deal it creates meanwhile is picked up by re-running this file).
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-pipeline-deal-codes.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "PipelineDealCode" (
    "code" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineDealCode_pkey" PRIMARY KEY ("code")
);

INSERT INTO "PipelineDealCode" ("code", "projectId", "createdAt")
SELECT DISTINCT ON ("code") "code", "projectId", "createdAt" FROM "PipelineDeal" ORDER BY "code", "createdAt"
ON CONFLICT ("code") DO NOTHING;

COMMIT;
