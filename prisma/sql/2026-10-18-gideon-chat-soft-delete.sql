-- bluegreen: expand   (additive: two nullable columns + one index; safe BEFORE the deploy)
-- GIDEON chats: soft delete + One Above All review (owner, 18 Oct 2026).
--   "GideonChat"."deletedAt"                  the person removed the chat: hidden from them everywhere, kept
--                                             90 days for Control Room > GIDEON > People > Chats (OAA only),
--                                             then purged with its messages and files by cron/purge-sheet-revisions.
--   "GideonPreference"."reviewNoticeSeenAt"   when the person dismissed the one-time notice "GIDEON chats can
--                                             be reviewed by members of the Board of Directors for work purposes."
-- Expand-only and idempotent. The running build never reads these columns.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-18-gideon-chat-soft-delete.sql
-- Names follow Prisma conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;
ALTER TABLE "GideonChat" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "GideonChat_deletedAt_idx" ON "GideonChat" ("deletedAt");
ALTER TABLE "GideonPreference" ADD COLUMN IF NOT EXISTS "reviewNoticeSeenAt" TIMESTAMP(3);
COMMIT;
