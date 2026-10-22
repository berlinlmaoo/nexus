-- bluegreen: expand   (additive: four columns, one NOT NULL with a constant default; safe BEFORE the deploy)
-- GIDEON auto-support retry queue (22 Oct 2026). While NEXUS ran on the failover VPS the GIDEON shim was unreachable;
-- a support ticket filed then was never answered and nothing retried it. lib/gideon-ticket.ts now records each failed
-- review on the ticket and /api/cron/gideon-watch retries it (per-ticket backoff, lib/gideon-ticket-retry.ts) before
-- it alarms. All four reset when GIDEON answers.
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS. The constant default on an INT column is metadata-only in
-- Postgres 11+ (no table rewrite). Safe BEFORE the deploy: the running build never reads or writes these columns.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-22-gideon-review-retry.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "gideonReviewAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "gideonReviewFailedAt" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "gideonReviewFailingSince" TIMESTAMP(3);
ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "gideonReviewError" TEXT;

COMMIT;
