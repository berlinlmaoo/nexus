-- bluegreen: expand   (additive: one column with a default; safe BEFORE the deploy)
-- Live co-editing of forms (owner, 19 Oct 2026, QA A-12). "Form"."version" counts the writes to a form's builder
-- content: every op batch (PATCH /api/forms/:id { ops }) and every whole-form save steps it by one under the row
-- lock, and the `form-ops` realtime event carries it, so a client can tell a newer form from an older one.
-- Existing rows start at 0. The running build never reads or writes it (Prisma only selects columns it knows).
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS with a constant default (no table rewrite on Postgres 11+).
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-form-coedit-version.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

COMMIT;
