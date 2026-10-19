-- bluegreen: expand   (additive: one column with a default + a CHECK; safe BEFORE the deploy)
-- Presence status, N-1 availability (owner, 19 Oct 2026). A manual status shows as Online · <text>, Away · <text> or
-- Do not disturb · <text> instead of always Away. "PresenceManualStatus"."availability" holds ONLINE | AWAY | DND,
-- default AWAY: every existing row, the running build (it never names the column, so its upserts get the default)
-- and iOS/Android 0.1.6 and older (they send no availability) behave exactly as before.
--
-- Needs 2026-10-19-presence-status.sql first (the table). Expand-only and idempotent: ADD COLUMN IF NOT EXISTS with
-- a constant default (no table rewrite on Postgres 11+); the CHECK is added only when missing.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-presence-availability.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "PresenceManualStatus" ADD COLUMN IF NOT EXISTS "availability" TEXT NOT NULL DEFAULT 'AWAY';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PresenceManualStatus_availability_check') THEN
    ALTER TABLE "PresenceManualStatus"
      ADD CONSTRAINT "PresenceManualStatus_availability_check" CHECK ("availability" IN ('ONLINE', 'AWAY', 'DND'));
  END IF;
END $$;

COMMIT;
