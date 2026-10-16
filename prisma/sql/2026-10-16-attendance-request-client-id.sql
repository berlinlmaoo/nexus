-- bluegreen: expand   (additive: one nullable column and a partial unique index; safe BEFORE the deploy)
-- Attendance request idempotency (race audit H3, the optional part; 16 Oct 2026). A client may send a key per
-- submit (form field clientRequestId or the Idempotency-Key header). The same key from the same person stores ONE
-- request: a repeat (a retry after a timeout, a double tap) gets the original back with 200 duplicate:true. The
-- per-person advisory lock (attreq|user) already serialises the writers; this index is the database's own
-- guarantee under it.
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS (nullable, no default: no rewrite, no backfill), CREATE
-- UNIQUE INDEX IF NOT EXISTS over (userId, clientRequestId) for rows that HAVE a key, so every existing row
-- (NULL) and every client that sends none is outside it. The index build reads the table once under a SHARE lock
-- (writes wait); AttendanceRequest is small, and lock_timeout keeps it from queueing behind a long transaction —
-- if it times out, nothing changed: run the file again. Safe BEFORE the deploy: the running build never reads the
-- column and never writes it.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-attendance-request-client-id.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift on the column.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRequest_userId_clientRequestId_key"
  ON "AttendanceRequest" ("userId", "clientRequestId")
  WHERE "clientRequestId" IS NOT NULL;

COMMIT;
