-- Legal (14 Oct 2026): DocumentNumber.issuedById ON DELETE CASCADE → SET NULL (column nullable).
-- Why: deleting a user deleted every number they had issued; the allocator takes max(seq) + 1, so the next
-- document would print a number that already exists on paper. Numbers must outlive the people who took them.
-- Additive and idempotent: drops NOT NULL (a widening) and re-creates the one foreign key with SET NULL.
-- Safe BEFORE the deploy: the running build never writes NULL, and no row is NULL until a user is deleted.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-14-legal-docnum-issuer-setnull.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "DocumentNumber" ALTER COLUMN "issuedById" DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentNumber_issuedById_fkey' AND confdeltype <> 'n'
  ) THEN
    ALTER TABLE "DocumentNumber" DROP CONSTRAINT "DocumentNumber_issuedById_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentNumber_issuedById_fkey') THEN
    ALTER TABLE "DocumentNumber" ADD CONSTRAINT "DocumentNumber_issuedById_fkey"
      FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
