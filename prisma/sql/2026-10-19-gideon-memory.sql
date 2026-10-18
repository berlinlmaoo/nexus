-- bluegreen: expand   (additive: one new table + one new column with a default; safe BEFORE the deploy)
-- GIDEON Memory (owner, 19 Oct 2026): per-person memory so GIDEON can be personal with each person.
--   "GideonMemory"                     what GIDEON remembers about ONE person (only ever read into their own chat)
--   "GideonPreference"."memoryPaused"  the person paused GIDEON Memory
-- The partial unique index is the race guard: two saves of the same thing at once leave one live row.
--
-- Expand-only and idempotent. Safe BEFORE the deploy: the running build never reads the table or the column.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-gideon-memory.sql
-- Names follow Prisma conventions so `prisma migrate diff` sees no drift (the partial unique is DB-only).

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "GideonMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FACT',
    "text" TEXT NOT NULL,
    "textKey" TEXT NOT NULL,
    "monthDay" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'CHAT',
    "sourceChatId" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GideonMemory_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "GideonMemory" ADD CONSTRAINT "GideonMemory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "GideonMemory_userId_status_deletedAt_idx" ON "GideonMemory" ("userId", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "GideonMemory_sourceRunId_idx" ON "GideonMemory" ("sourceRunId");
CREATE INDEX IF NOT EXISTS "GideonMemory_deletedAt_idx" ON "GideonMemory" ("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GideonMemory_user_text_live_key" ON "GideonMemory" ("userId", "textKey") WHERE "deletedAt" IS NULL;

ALTER TABLE "GideonPreference" ADD COLUMN IF NOT EXISTS "memoryPaused" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
