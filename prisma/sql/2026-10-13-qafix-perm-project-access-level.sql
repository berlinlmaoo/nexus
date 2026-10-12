-- Notion-style project access levels (owner decision 13 Oct 2026). Additive.
-- FULL = Full access, EDIT = Can edit, COMMENT = Can comment, VIEW = Can view.
-- Backfill: every existing membership = EDIT; the project's Owner (role LEAD) = FULL.
ALTER TABLE "ProjectMember" ADD COLUMN IF NOT EXISTS "accessLevel" TEXT NOT NULL DEFAULT 'EDIT';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_accessLevel_check') THEN
    ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_accessLevel_check" CHECK ("accessLevel" IN ('FULL', 'EDIT', 'COMMENT', 'VIEW'));
  END IF;
END $$;
UPDATE "ProjectMember" SET "accessLevel" = 'FULL' WHERE "role" = 'LEAD' AND "accessLevel" <> 'FULL';
