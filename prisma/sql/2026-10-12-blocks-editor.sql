-- Block editor (owner-approved item #5, 12 Oct 2026): rich bodies for task descriptions and Docs/Pages,
-- Yjs state of live editing rooms, "remind me" chips, and the per-page full-width switch.
-- Additive and idempotent: it only creates what is missing and never drops or rewrites a row.
-- Task.description and Doc.contentText stay the text that released apps read (lib/blockdoc.ts);
-- no existing content is touched here: plain text / BlockNote descriptions are converted when they are
-- first opened (resolveTaskBody), losslessly, and stored on the first edit.
-- Apply BEFORE deploying the image whose Prisma client reads these tables.
-- Names follow Prisma's conventions (<Table>_<cols>_key/_idx/_fkey) so `prisma migrate diff` sees no drift.

BEGIN;

CREATE TABLE IF NOT EXISTS "TaskBody" (
    "taskId" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskBody_pkey" PRIMARY KEY ("taskId")
);

CREATE TABLE IF NOT EXISTS "CollabState" (
    "key" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "epoch" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollabState_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "BlockReminder" (
    "id" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlockReminder_sourceKind_sourceId_userId_key_key" ON "BlockReminder"("sourceKind", "sourceId", "userId", "key");
CREATE INDEX IF NOT EXISTS "BlockReminder_remindAt_firedAt_idx" ON "BlockReminder"("remindAt", "firedAt");

ALTER TABLE "Doc" ADD COLUMN IF NOT EXISTS "fullWidth" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskBody_taskId_fkey') THEN
    ALTER TABLE "TaskBody" ADD CONSTRAINT "TaskBody_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BlockReminder_userId_fkey') THEN
    ALTER TABLE "BlockReminder" ADD CONSTRAINT "BlockReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
