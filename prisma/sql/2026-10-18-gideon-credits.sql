-- bluegreen: expand   (additive: three new tables; safe BEFORE the deploy)
-- GIDEON credits (owner, 18 Oct 2026). Every GIDEON answer is priced from what its model was actually paid
-- for (Hermes state.db usage, read back by the shim) and recorded per person; each person has a daily
-- allowance (00:00 WIB) and a monthly pool (attendance period 28th → 27th), defaults per workspace role.
--   "GideonCreditUsage"     one row per answer (tokens, credits, which bucket paid). runId UNIQUE: an answer
--                           is billed once however often it is reported. Written under a per-user advisory lock.
--   "GideonCreditOverride"  a BoD / One Above All override of one person's limits (null = role default)
--   "GideonCreditBonus"     one-off bonus credits added to one period's pool
-- Role defaults live in AppSetting "gideon-credits" (no table). No FKs to "User", like "GideonRun": a ledger
-- row must never stop an account from being removed.
--
-- Expand-only and idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Safe BEFORE the deploy: the running build
-- never reads these tables.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-18-gideon-credits.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

CREATE TABLE IF NOT EXISTS "GideonCreditUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "role" TEXT,
    "runId" TEXT,
    "trigger" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "requestedTier" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "dailyCredits" INTEGER NOT NULL DEFAULT 0,
    "poolCredits" INTEGER NOT NULL DEFAULT 0,
    "overCredits" INTEGER NOT NULL DEFAULT 0,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT,
    "source" TEXT,
    "dayKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GideonCreditUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GideonCreditUsage_runId_key" ON "GideonCreditUsage" ("runId");
CREATE INDEX IF NOT EXISTS "GideonCreditUsage_userId_dayKey_idx" ON "GideonCreditUsage" ("userId", "dayKey");
CREATE INDEX IF NOT EXISTS "GideonCreditUsage_userId_periodKey_idx" ON "GideonCreditUsage" ("userId", "periodKey");
CREATE INDEX IF NOT EXISTS "GideonCreditUsage_periodKey_idx" ON "GideonCreditUsage" ("periodKey");
CREATE INDEX IF NOT EXISTS "GideonCreditUsage_createdAt_idx" ON "GideonCreditUsage" ("createdAt");

CREATE TABLE IF NOT EXISTS "GideonCreditOverride" (
    "userId" TEXT NOT NULL,
    "dailyLimit" INTEGER,
    "monthlyLimit" INTEGER,
    "unlimited" BOOLEAN,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GideonCreditOverride_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "GideonCreditBonus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "reason" TEXT,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GideonCreditBonus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GideonCreditBonus_userId_periodKey_idx" ON "GideonCreditBonus" ("userId", "periodKey");
CREATE INDEX IF NOT EXISTS "GideonCreditBonus_periodKey_idx" ON "GideonCreditBonus" ("periodKey");

COMMIT;
