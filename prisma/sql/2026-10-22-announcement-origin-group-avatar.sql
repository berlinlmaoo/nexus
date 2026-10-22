-- bluegreen: expand   (additive: two NOT NULL columns with constant defaults + one nullable column + one index; safe BEFORE the deploy)
-- 22 Oct 2026, owner after testing 0.1.7:
--  1. Control Room -> Announcements mixed personal/system pushes (attendance warnings, "install the app" nudges,
--     GIDEON test posts) with real announcements. "Announcement"."origin" = manual | system, "source" = composer |
--     gideon | attendance_warning | template | legacy. The list shows manual by default, the rest under "System".
--  2. Group chat photo: "Conversation"."avatarUrl".
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and a backfill that only
-- touches rows still on the defaults, so a re-run never overrides a later decision. Safe BEFORE the deploy: the
-- running build never names these columns (its inserts get manual/composer; the new build treats kind = warning
-- as system whatever is stored).
--   nexus-sql.sh <env> apply prisma/sql/2026-10-22-announcement-origin-group-avatar.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'composer';
CREATE INDEX IF NOT EXISTS "Announcement_origin_createdAt_idx" ON "Announcement"("origin", "createdAt");

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

-- Absen Monitor -> Warn.
UPDATE "Announcement" SET "origin" = 'system', "source" = 'attendance_warning'
 WHERE "kind" = 'warning' AND "origin" = 'manual' AND "source" = 'composer';
-- Posted from a GIDEON draft card (the applied proposal keeps the announcement id in its result).
UPDATE "Announcement" a SET "origin" = 'system', "source" = 'gideon'
  FROM "GideonProposal" p
 WHERE p."action" = 'draft_announcement' AND p."status" = 'APPLIED'
   AND p."result" ->> 'announcementId' = a."id"
   AND a."origin" = 'manual' AND a."source" = 'composer';
-- Scripted per-person nudges sent before origins existed (2 Oct 2026: install the app / check out in the app).
UPDATE "Announcement" SET "origin" = 'system', "source" = 'template'
 WHERE "origin" = 'manual' AND "source" = 'composer'
   AND ("title" ILIKE 'Pasang app NEXUS%' OR "title" ILIKE 'Check-out hari ini lewat app NEXUS%'
        OR "title" ILIKE 'Install the NEXUS app%' OR "title" ILIKE 'Check out today in the NEXUS app%');
-- Everything else from before this change: a manual post, marked legacy.
UPDATE "Announcement" SET "source" = 'legacy'
 WHERE "origin" = 'manual' AND "source" = 'composer'
   AND "createdAt" < TIMESTAMP '2026-10-22 00:00:00';

COMMIT;
