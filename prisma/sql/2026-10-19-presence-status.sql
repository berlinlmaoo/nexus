-- bluegreen: expand   (additive: one new table; safe BEFORE the deploy)
-- Presence status (owner, 19 Oct 2026). "PresenceManualStatus" holds a person's manual "Away · <text>" with a start
-- and an end (one row per person: userId UNIQUE, so a set is one upsert and two devices can never leave two rows).
-- Everything else about presence (Online / Away out of office / Sick / Leave / Not checked in / Offline) is
-- computed from attendance by lib/presence.ts and stored nowhere. No FK to "User", like "GideonRun".
--
-- Expand-only and idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Safe BEFORE the deploy: the running build never
-- reads this table.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-presence-status.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "PresenceManualStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceManualStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PresenceManualStatus_userId_key" ON "PresenceManualStatus" ("userId");
CREATE INDEX IF NOT EXISTS "PresenceManualStatus_endsAt_idx" ON "PresenceManualStatus" ("endsAt");

COMMIT;
