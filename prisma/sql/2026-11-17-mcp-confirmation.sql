-- bluegreen: expand   (additive: one new table; safe BEFORE the deploy)
-- MCP attendance corrections (17 Nov 2026, lib/mcp-attendance.ts): "McpConfirmation" holds a previewed change behind a
-- single-use confirmation token (SHA-256 only), 10-minute expiry, bound to the person and the connection (ApiToken).
-- No FK to "User" / "ApiToken", like "GideonRun": rows are short-lived and purged a day after they expire.
--
-- Expand-only and idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Safe BEFORE the deploy: the running build never
-- reads this table.
--   nexus-sql.sh <env> apply prisma/sql/2026-11-17-mcp-confirmation.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "McpConfirmation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "resultStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpConfirmation_tokenHash_key" ON "McpConfirmation" ("tokenHash");
CREATE INDEX IF NOT EXISTS "McpConfirmation_userId_createdAt_idx" ON "McpConfirmation" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "McpConfirmation_expiresAt_idx" ON "McpConfirmation" ("expiresAt");

COMMIT;
