-- bluegreen: expand   (additive: one NOT NULL column with a constant default; safe BEFORE the deploy)
-- Sheets structure race (race audit 16 Oct 2026, H6). PATCH /api/sheets/:id saved `columns` (the whole list) and
-- `settings` from the copy read at the start of the request, so two people adding a column, or freezing a row and
-- hiding another, at the same moment kept only the last write. The server now writes the structure under
-- SELECT … FOR UPDATE and re-reads it there; a client that sends the version it last saw (structureVersion) gets a
-- 409 SHEET_STRUCTURE_CHANGED instead of overwriting columns it has not seen. This is that version: bumped by every
-- write of ProjectSheet.columns (structure PATCH, column delete, import, Audit restore of a column).
--
-- Expand-only and idempotent: ADD COLUMN IF NOT EXISTS with a constant default (PostgreSQL 11+ stores it in the
-- catalog: no table rewrite, no backfill). Safe BEFORE the deploy: the running build never reads or writes it.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-sheet-structure-version.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "ProjectSheet" ADD COLUMN IF NOT EXISTS "structureVersion" INTEGER NOT NULL DEFAULT 0;

COMMIT;
