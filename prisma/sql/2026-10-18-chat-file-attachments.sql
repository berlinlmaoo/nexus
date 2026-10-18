-- bluegreen: expand   (additive: two nullable columns + a partial index built CONCURRENTLY; NO transaction)
-- Documents in chat (owner, 18 Oct 2026: "chat di web app kenapa baru send foto doang? gaada send doc").
-- A message can now carry a PDF / Word / Excel / PowerPoint / CSV / TXT / ZIP as well as a picture. The file is
-- stored under a random name (public/uploads/chat/<uuid>.<ext>), so the name people sent it as, and its size,
-- travel with the message:
--   "Message"."attachmentName"  the original file name, cleaned (chat-files.ts cleanFileName), ≤ 180 chars
--   "Message"."attachmentSize"  bytes (≤ 25 MB, so an int)
-- Both nullable: every existing message (text, or a picture) stays valid and reads exactly as before.
--
-- The index answers "which message is this file?" for the download route (/api/files/chat/<name> of a
-- document is served only to members of that message's conversation) and the purge's "is this upload still
-- referenced". Partial (only rows with an attachment), so it lives here and not in schema.prisma.
-- CONCURRENTLY cannot run inside a transaction block, so this file has NO BEGIN/COMMIT (nexus-sql.sh then runs
-- it statement by statement, ON_ERROR_STOP). Re-running it is safe.
-- Must be applied BEFORE the deploy: the new build selects both columns on every message query.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-18-chat-file-attachments.sql
-- Check afterwards (indisvalid must be t):
--   SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'Message_attachmentUrl_idx';

SET lock_timeout = '5s';

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachmentSize" INTEGER;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_attachmentUrl_idx" ON "Message" ("attachmentUrl") WHERE "attachmentUrl" IS NOT NULL;
