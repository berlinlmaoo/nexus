-- Automations builder (owner, 12 Oct 2026): "When / If / Do", run log, schedules, inbound webhooks.
-- Idempotent: safe to run more than once. Shapes: src/lib/automation-rules.ts.

ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "conditions"    JSONB;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "actions"       JSONB;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "createdById"   TEXT;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "lastRunAt"     TIMESTAMP(3);
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "lastRunStatus" TEXT;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "runCount"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "webhookToken"  TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Automation_webhookToken_key" ON "Automation"("webhookToken");
CREATE INDEX IF NOT EXISTS "Automation_projectId_idx" ON "Automation"("projectId");

CREATE TABLE IF NOT EXISTS "AutomationRun" (
  "id"           TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "taskId"       TEXT,
  "event"        TEXT NOT NULL,
  "trigger"      TEXT NOT NULL,
  "status"       TEXT NOT NULL,
  "steps"        JSONB,
  "error"        TEXT,
  "actorId"      TEXT,
  "dedupKey"     TEXT,
  "durationMs"   INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRun_automationId_dedupKey_key" ON "AutomationRun"("automationId", "dedupKey");
CREATE INDEX IF NOT EXISTS "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationRun_createdAt_idx" ON "AutomationRun"("createdAt");

-- The case bug: the web saved trigger/action types in lower case ("task_created") and the engine compared
-- upper case, so those rules never fired. Normalise every stored type to the canonical upper-case name
-- (the API also normalises on save and on read; this fixes rows already written). Aliases mirror
-- TRIGGER_ALIASES / ACTION_ALIASES in automation-rules.ts.
UPDATE "Automation" SET "trigger" = jsonb_set("trigger"::jsonb, '{type}', to_jsonb(
  CASE upper(regexp_replace("trigger"->>'type', '[\s.-]+', '_', 'g'))
    WHEN 'TASK_STATUS_CHANGED' THEN 'STATUS_CHANGED'
    WHEN 'STATUS_CHANGE'       THEN 'STATUS_CHANGED'
    WHEN 'TASK_ASSIGNED'       THEN 'ASSIGNEE_CHANGED'
    WHEN 'ASSIGNED'            THEN 'ASSIGNEE_CHANGED'
    WHEN 'TASK_DUE_APPROACHING' THEN 'DUE_DATE_APPROACHING'
    WHEN 'DUE_DATE_PASSED'     THEN 'DUE_DATE_REACHED'
    WHEN 'TAG_ADDED'           THEN 'FIELD_CHANGED'
    ELSE upper(regexp_replace("trigger"->>'type', '[\s.-]+', '_', 'g'))
  END))
WHERE "trigger" ? 'type' AND ("trigger"->>'type') IS DISTINCT FROM (
  CASE upper(regexp_replace("trigger"->>'type', '[\s.-]+', '_', 'g'))
    WHEN 'TASK_STATUS_CHANGED' THEN 'STATUS_CHANGED'
    WHEN 'STATUS_CHANGE'       THEN 'STATUS_CHANGED'
    WHEN 'TASK_ASSIGNED'       THEN 'ASSIGNEE_CHANGED'
    WHEN 'ASSIGNED'            THEN 'ASSIGNEE_CHANGED'
    WHEN 'TASK_DUE_APPROACHING' THEN 'DUE_DATE_APPROACHING'
    WHEN 'DUE_DATE_PASSED'     THEN 'DUE_DATE_REACHED'
    WHEN 'TAG_ADDED'           THEN 'FIELD_CHANGED'
    ELSE upper(regexp_replace("trigger"->>'type', '[\s.-]+', '_', 'g'))
  END);

UPDATE "Automation" SET "action" = jsonb_set("action"::jsonb, '{type}', to_jsonb(
  CASE upper(regexp_replace("action"->>'type', '[\s.-]+', '_', 'g'))
    WHEN 'CHANGE_STATUS' THEN 'SET_STATUS'
    WHEN 'ASSIGN_USER'   THEN 'ASSIGN_TO'
    ELSE upper(regexp_replace("action"->>'type', '[\s.-]+', '_', 'g'))
  END))
WHERE "action" ? 'type' AND ("action"->>'type') IS DISTINCT FROM (
  CASE upper(regexp_replace("action"->>'type', '[\s.-]+', '_', 'g'))
    WHEN 'CHANGE_STATUS' THEN 'SET_STATUS'
    WHEN 'ASSIGN_USER'   THEN 'ASSIGN_TO'
    ELSE upper(regexp_replace("action"->>'type', '[\s.-]+', '_', 'g'))
  END);
