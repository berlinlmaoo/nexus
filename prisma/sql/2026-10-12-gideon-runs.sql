-- GIDEON like Notion's agent (owner, 12 Oct 2026): runs (Insights), steps (tool progress, sources,
-- cards), proposals (approval mode), schedules (weekly project digest). Idempotent: safe to re-run.
-- No foreign keys to "User"/"Project" on purpose: a run log must outlive the person or project it was
-- about (offboarding refuses to delete accounts that own data; a deleted project is restorable).

CREATE TABLE IF NOT EXISTS "GideonRun" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT,
  "trigger"      TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'RUNNING',
  "approvalMode" TEXT NOT NULL DEFAULT 'dont_ask',
  "tier"         TEXT,
  "title"        TEXT,
  "projectId"    TEXT,
  "taskId"       TEXT,
  "scheduleId"   TEXT,
  "toolsUsed"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "toolCalls"    INTEGER NOT NULL DEFAULT 0,
  "tokens"       INTEGER,
  "replyChars"   INTEGER,
  "error"        TEXT,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"   TIMESTAMP(3),
  "durationMs"   INTEGER,
  CONSTRAINT "GideonRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GideonRun_startedAt_idx" ON "GideonRun"("startedAt");
CREATE INDEX IF NOT EXISTS "GideonRun_userId_startedAt_idx" ON "GideonRun"("userId", "startedAt");
CREATE INDEX IF NOT EXISTS "GideonRun_projectId_startedAt_idx" ON "GideonRun"("projectId", "startedAt");
CREATE INDEX IF NOT EXISTS "GideonRun_status_startedAt_idx" ON "GideonRun"("status", "startedAt");

CREATE TABLE IF NOT EXISTS "GideonRunStep" (
  "id"         TEXT NOT NULL,
  "runId"      TEXT NOT NULL,
  "tool"       TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "arg"        TEXT,
  "ok"         BOOLEAN,
  "error"      TEXT,
  "durationMs" INTEGER,
  "refs"       JSONB,
  "card"       JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GideonRunStep_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "GideonRunStep" ADD CONSTRAINT "GideonRunStep_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "GideonRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "GideonRunStep_runId_createdAt_idx" ON "GideonRunStep"("runId", "createdAt");

CREATE TABLE IF NOT EXISTS "GideonProposal" (
  "id"        TEXT NOT NULL,
  "runId"     TEXT,
  "userId"    TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "input"     JSONB NOT NULL,
  "summary"   TEXT NOT NULL,
  "diff"      JSONB,
  "projectId" TEXT,
  "taskId"    TEXT,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "result"    JSONB,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "GideonProposal_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "GideonProposal" ADD CONSTRAINT "GideonProposal_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "GideonRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "GideonProposal_userId_status_createdAt_idx" ON "GideonProposal"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GideonProposal_runId_idx" ON "GideonProposal"("runId");

CREATE TABLE IF NOT EXISTS "GideonSchedule" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'WEEKLY_DIGEST',
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "weekdays"     INTEGER[] NOT NULL DEFAULT ARRAY[1]::INTEGER[],
  "time"         TEXT NOT NULL DEFAULT '09:00',
  "timezone"     TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  "language"     TEXT NOT NULL DEFAULT 'id',
  "instructions" TEXT,
  "createdById"  TEXT NOT NULL,
  "lastRunAt"    TIMESTAMP(3),
  "lastRunId"    TEXT,
  "lastStatus"   TEXT,
  "nextRunAt"    TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GideonSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GideonSchedule_enabled_nextRunAt_idx" ON "GideonSchedule"("enabled", "nextRunAt");
CREATE INDEX IF NOT EXISTS "GideonSchedule_projectId_idx" ON "GideonSchedule"("projectId");

-- The chat turn keeps the run it came from and what the run showed (steps, sources, cards, proposals),
-- so a reopened panel draws the same answer it drew live.
ALTER TABLE "GideonMessage" ADD COLUMN IF NOT EXISTS "runId" TEXT;
ALTER TABLE "GideonMessage" ADD COLUMN IF NOT EXISTS "meta"  JSONB;
