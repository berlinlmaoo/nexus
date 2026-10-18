-- bluegreen: expand   (additive: one nullable column; safe BEFORE the deploy)
-- GIDEON auto-support claim (race audit 16 Oct 2026, M21). Two triggers for one ticket (ticket created + a reply a
-- moment later, a re-review sweep on top of an automatic run) both read the thread before either had answered, and
-- both posted an answer. lib/gideon-ticket.ts now takes a compare-and-swap claim on the ticket before it reads the
-- thread and clears it when the review ends; a claim older than 6 minutes is stale and may be taken over.
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS (nullable, no default: no rewrite, no backfill). Safe BEFORE
-- the deploy: the running build never reads or writes the column.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-gideon-review-claim.sql
-- Name follows Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Complaint" ADD COLUMN IF NOT EXISTS "gideonReviewingAt" TIMESTAMP(3);

COMMIT;
