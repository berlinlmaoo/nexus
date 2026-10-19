-- bluegreen: expand   (additive: one new table; safe BEFORE the deploy)
-- Meeting notes, Beta (owner, 18 Oct 2026). A meeting recording becomes a transcript (Whisper on our own GPU,
-- the audio never leaves the network), then GIDEON writes an overview, minutes (MoM) and proposed tasks. The
-- person edits all of it, then Apply saves the minutes as a Doc in the chosen project and creates the ticked
-- tasks, each linking back to that Doc.
--   "MeetingNote"  one row per recording. status: UPLOADING → QUEUED → TRANSCRIBING → SUMMARIZING → READY →
--                  APPLYING → APPLIED (or FAILED). Apply claims READY → APPLYING with a conditional update inside
--                  the transaction that creates the Doc and the tasks, so a double tap creates them once.
-- No FKs (like "GideonRun" / "GideonCreditUsage"): a meeting row must never block removing a project, a doc or
-- an account; the code treats a missing project/doc as gone.
--
-- Expand-only and idempotent. Safe BEFORE the deploy: the running build never reads this table.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-18-meeting-notes.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "MeetingNote" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "source" TEXT NOT NULL DEFAULT 'upload',
    "audioName" TEXT,
    "audioMime" TEXT,
    "audioExt" TEXT,
    "audioBytes" BIGINT NOT NULL DEFAULT 0,
    "audioReceived" BIGINT NOT NULL DEFAULT 0,
    "audioDeleteAfter" TIMESTAMP(3),
    "audioDeletedAt" TIMESTAMP(3),
    "durationSec" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3),
    "transcript" JSONB,
    "speakers" JSONB,
    "overview" TEXT,
    "mom" JSONB,
    "proposals" JSONB,
    "detectedLanguage" TEXT,
    "transcribeStats" JSONB,
    "runIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier" TEXT,
    "docId" TEXT,
    "taskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "error" TEXT,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "stageStartedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MeetingNote_createdById_createdAt_idx" ON "MeetingNote" ("createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "MeetingNote_projectId_createdAt_idx" ON "MeetingNote" ("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "MeetingNote_status_updatedAt_idx" ON "MeetingNote" ("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "MeetingNote_audioDeleteAfter_idx" ON "MeetingNote" ("audioDeleteAfter");

COMMIT;
