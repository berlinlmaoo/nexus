-- Form builder rebuild (12 Oct 2026): response settings (confirmation screen, submit label, response
-- limit, notify people). Nullable JSON, idempotent; released apps never read it.
ALTER TABLE "Form" ADD COLUMN IF NOT EXISTS "settings" JSONB;
