-- bluegreen: expand   (additive: two nullable columns and two partial unique indexes; safe BEFORE the deploy)
-- Race audit 16 Oct 2026, PR 4 (M7, M9). "Add term" on a pipeline deal and "Add night" on an Outlet Sales
-- project may now carry a key per submit (body field clientRequestId or the Idempotency-Key header). The same
-- key on the same deal (term) or project (night) stores ONE row: a repeat — a retry after a timeout, a double
-- tap — gets the original back with 200 duplicate:true. The writers already serialise under a row lock on the
-- deal / an advisory lock per project; these indexes are the database's own guarantee under them.
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS (nullable, no default: no rewrite, no backfill), CREATE
-- UNIQUE INDEX IF NOT EXISTS over rows that HAVE a key, so every existing row (NULL) and every client that sends
-- none is outside it. Both tables are small (a few hundred rows); the build takes a SHARE lock for a moment and
-- lock_timeout keeps it from queueing behind a long transaction — if it times out nothing changed: run it again.
-- Safe BEFORE the deploy: the running build never reads or writes the columns.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-race-pr4-idempotency.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift on the columns.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "PipelinePaymentTerm" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PipelinePaymentTerm_dealId_clientRequestId_key"
  ON "PipelinePaymentTerm" ("dealId", "clientRequestId")
  WHERE "clientRequestId" IS NOT NULL;

ALTER TABLE "OutletSalesEvent" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "OutletSalesEvent_projectId_clientRequestId_key"
  ON "OutletSalesEvent" ("projectId", "clientRequestId")
  WHERE "clientRequestId" IS NOT NULL;

COMMIT;
