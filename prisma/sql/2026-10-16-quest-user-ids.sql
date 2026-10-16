-- Per-person quests (owner, 16 Oct 2026): a quest can be for chosen people (Quest.userIds), next to the
-- divisions (unitIds). Expand-only and idempotent: one column with an empty default, nothing rewritten.
-- Safe BEFORE the deploy: the running build never reads the column.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-quest-user-ids.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "userIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMIT;
