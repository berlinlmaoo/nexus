-- bluegreen: expand   (additive: one new table; safe BEFORE the deploy)
-- Vault quota race (race audit 16 Oct 2026, H10). Every upload checked "used + this file <= 60 GB" and then
-- wrote, so uploads finishing at the same moment all passed the same check and the Vault went over its quota.
-- The final write now re-sums under a per-workspace advisory lock (vault-quota:<workspace>) in the same
-- transaction as the new row. A chunked upload also RESERVES its declared size here while its chunks arrive
-- (refreshed with every chunk, dropped by its finalize, expired after 70 minutes without a chunk), so two big
-- uploads into the last free gigabytes are told at the first chunk, not after twenty minutes of transfer.
--
-- Expand-only and idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Safe BEFORE the deploy: the running build
-- never reads the table.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-vault-upload-reservation.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "VaultUploadReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultUploadReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VaultUploadReservation_userId_uploadId_key" ON "VaultUploadReservation" ("userId", "uploadId");
CREATE INDEX IF NOT EXISTS "VaultUploadReservation_workspaceId_expiresAt_idx" ON "VaultUploadReservation" ("workspaceId", "expiresAt");

COMMIT;
