-- bluegreen: expand   (additive: five columns with defaults / nullable; safe BEFORE the deploy)
-- MCP attendance corrections are approved on the NEXUS web (17 Nov 2026, lib/mcp-attendance.ts): the request keeps
-- its decision (status PENDING → APPROVING → APPROVED | FAILED, or REJECTED), who decided and when, the refusal when
-- applying failed, and the connection's name for the audit ("via <name> (MCP)"). "tokenHash" now holds the SHA-256
-- of the approval link's secret. Idempotent; the running build never reads these columns.
--   nexus-sql.sh <env> apply prisma/sql/2026-11-17-mcp-approval.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "McpConfirmation" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "McpConfirmation" ADD COLUMN IF NOT EXISTS "clientLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "McpConfirmation" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
ALTER TABLE "McpConfirmation" ADD COLUMN IF NOT EXISTS "decidedById" TEXT;
ALTER TABLE "McpConfirmation" ADD COLUMN IF NOT EXISTS "error" TEXT;

COMMIT;
