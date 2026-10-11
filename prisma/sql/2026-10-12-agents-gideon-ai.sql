-- GIDEON = Notion AI 1:1 (owner, 12 Oct 2026: "fitur gideon ini 1:1 kaya notion yg bisa baca task, project di
-- masing masing akun dengan akses akunnya"). Idempotent: safe to re-run.
--   GideonChat           : one conversation (history list with search, new chat ⌘/Ctrl+O).
--   GideonMessage.chatId : the conversation a turn belongs to. Older rows are gathered into one chat per user.
--   GideonPreference     : personalize (what the person calls GIDEON + personal instructions).
--   CustomFieldAutofill  : AI Autofill on a project custom field (summary / classify / extract).
--   CustomFieldAiFill    : which values GIDEON wrote (the ✨ marker shows while the value is still GIDEON's).

CREATE TABLE IF NOT EXISTS "GideonChat" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "title"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GideonChat_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "GideonChat" ADD CONSTRAINT "GideonChat_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "GideonChat_userId_updatedAt_idx" ON "GideonChat"("userId", "updatedAt");

ALTER TABLE "GideonMessage" ADD COLUMN IF NOT EXISTS "chatId" TEXT;
DO $$ BEGIN
  ALTER TABLE "GideonMessage" ADD CONSTRAINT "GideonMessage_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "GideonChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "GideonMessage_chatId_createdAt_idx" ON "GideonMessage"("chatId", "createdAt");

-- Every turn written before conversations existed goes into one chat per person, titled by its first question.
INSERT INTO "GideonChat" ("id", "userId", "title", "createdAt", "updatedAt")
SELECT 'gc_legacy_' || m."userId",
       m."userId",
       LEFT(COALESCE((SELECT regexp_replace(x."content", '\s+', ' ', 'g') FROM "GideonMessage" x
                      WHERE x."userId" = m."userId" AND x."role" = 'user' AND x."chatId" IS NULL
                      ORDER BY x."createdAt" ASC LIMIT 1), 'Earlier chat'), 80),
       MIN(m."createdAt"), MAX(m."createdAt")
FROM "GideonMessage" m
WHERE m."chatId" IS NULL
GROUP BY m."userId"
ON CONFLICT ("id") DO NOTHING;
UPDATE "GideonMessage" SET "chatId" = 'gc_legacy_' || "userId" WHERE "chatId" IS NULL;

CREATE TABLE IF NOT EXISTS "GideonPreference" (
  "userId"        TEXT NOT NULL,
  "assistantName" TEXT,
  "instructions"  TEXT,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GideonPreference_pkey" PRIMARY KEY ("userId")
);
DO $$ BEGIN
  ALTER TABLE "GideonPreference" ADD CONSTRAINT "GideonPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CustomFieldAutofill" (
  "customFieldId" TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "mode"          TEXT NOT NULL DEFAULT 'summary',
  "prompt"        TEXT,
  "onCreate"      BOOLEAN NOT NULL DEFAULT true,
  "onUpdate"      BOOLEAN NOT NULL DEFAULT false,
  "approval"      TEXT NOT NULL DEFAULT 'review',
  "createdById"   TEXT NOT NULL,
  "lastRunAt"     TIMESTAMP(3),
  "lastStatus"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomFieldAutofill_pkey" PRIMARY KEY ("customFieldId")
);
DO $$ BEGIN
  ALTER TABLE "CustomFieldAutofill" ADD CONSTRAINT "CustomFieldAutofill_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "CustomFieldAutofill_projectId_idx" ON "CustomFieldAutofill"("projectId");

CREATE TABLE IF NOT EXISTS "CustomFieldAiFill" (
  "id"            TEXT NOT NULL,
  "customFieldId" TEXT NOT NULL,
  "taskId"        TEXT NOT NULL,
  "value"         TEXT NOT NULL,
  "runId"         TEXT,
  "filledAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomFieldAiFill_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "CustomFieldAiFill" ADD CONSTRAINT "CustomFieldAiFill_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CustomFieldAiFill" ADD CONSTRAINT "CustomFieldAiFill_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldAiFill_customFieldId_taskId_key" ON "CustomFieldAiFill"("customFieldId", "taskId");
CREATE INDEX IF NOT EXISTS "CustomFieldAiFill_taskId_idx" ON "CustomFieldAiFill"("taskId");
