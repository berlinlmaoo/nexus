-- Spreadsheet formatting (owner, 11 Oct 2026: "samain kaya Sheets"). Two additive columns:
--   "ProjectSheet"."settings"  sheet-level view settings (freeze, hidden rows/columns, merges, tab colour)
--   "SheetRow"."styles"        per-cell formatting keyed by column id
-- Additive and idempotent; no data is touched. The app also adds them itself on first sheet open
-- (ensureSheetFormattingColumns in src/lib/project-sheets.ts), so the order of deploy vs. this file
-- does not matter — running it first just avoids that one-time ALTER from the app:
--   docker exec -i nexus-postgres psql -U nexus_user -d nexus_db -v ON_ERROR_STOP=1 < prisma/sql/2026-10-11-sheet-formatting.sql

ALTER TABLE "ProjectSheet" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SheetRow" ADD COLUMN IF NOT EXISTS "styles" JSONB;
