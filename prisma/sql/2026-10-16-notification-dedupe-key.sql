-- bluegreen: expand   (additive: a nullable column, then a unique index built CONCURRENTLY; NO transaction)
-- Notification dedupe key (race audit LOW, 16 Oct 2026). The cron-driven writers (attendance reminders, the
-- absent-recorded notice, due-soon, escalation, announcement repeats, booking/streak/quota/quest nudges and the
-- windowed watch alerts) checked "already sent?" with a findFirst and then inserted. They now also write a
-- deterministic key (type + target + period) with INSERT … ON CONFLICT DO NOTHING, so two runs that both passed
-- the check store one row and only that one pushes. Ad-hoc notifications (chat, comments, assignments…) keep
-- NULL and are outside the index.
--
-- Notification is the largest table, so nothing here rewrites it or blocks writes for a scan:
--   1. ADD COLUMN, nullable, NO default: a catalog-only change (a brief ACCESS EXCLUSIVE lock, bounded by
--      lock_timeout so it never queues behind a long transaction; if it times out nothing changed, run again).
--   2. Any INVALID copy of the index (left by a build that was interrupted or failed) is dropped first, or
--      IF NOT EXISTS would skip it forever. A valid index is left alone.
--   3. CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS … WHERE "dedupeKey" IS NOT NULL: writes continue during the
--      build. Every existing row is NULL, so it cannot fail on duplicates.
-- CONCURRENTLY cannot run inside a transaction block, so this file has NO BEGIN/COMMIT. deploy/bluegreen/nexus-sql.sh
-- already handles such a file: it sees CONCURRENTLY, skips the rolled-back dry run (lint only) and runs the file
-- WITHOUT -1, one statement at a time, stopping at the first error (ON_ERROR_STOP). Re-running it is safe.
-- Safe BEFORE the deploy: the running build never reads or writes the column. Apply it BEFORE deploying the
-- code that writes dedupeKey (the column must exist; the index only adds the race guarantee).
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-notification-dedupe-key.sql
-- Check afterwards (indisvalid must be t):
--   SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'Notification_dedupeKey_key';

SET lock_timeout = '5s';

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I', c.relname)
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname = 'Notification_dedupeKey_key' AND NOT i.indisvalid
\gexec

-- The build waits for transactions already running to finish (it does not block writers meanwhile).
SET lock_timeout = '60s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Notification_dedupeKey_key"
  ON "Notification" ("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
