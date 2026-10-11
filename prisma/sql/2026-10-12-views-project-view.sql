-- Saved views per project (owner, 12 Oct 2026, Notion-style). One table, nothing else changes.
--
-- A project's five fixed task tabs (Board, List, Table, Calendar, Timeline) become five SHARED views with
-- `builtin` set. They are created by the server the first time someone opens the project's views
-- (GET /api/projects/:id/views), so this file does not backfill rows: a project nobody opens costs nothing,
-- and a project created later gets them the same way. The partial unique index keeps that lazy create
-- race-free (two browsers opening the project at once insert one set; the loser's INSERT … ON CONFLICT
-- DO NOTHING is a no-op).
--
-- Project.hiddenTabs is untouched and still decides whether a built-in view shows (released iOS / Android
-- apps read it). Deleting a project or a user removes their views (ON DELETE CASCADE).
--
-- Idempotent. DEV only for now:
--   docker run --rm -i --network nexus_dev_internal -e PGPASSWORD=… postgres:16-alpine \
--     psql -h nexus-dev-postgres -U nexus_dev -d nexus_dev -v ON_ERROR_STOP=1 < prisma/sql/2026-10-12-views-project-view.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "ProjectView" (
  "id"          TEXT         NOT NULL,
  "name"        TEXT,
  "layout"      TEXT         NOT NULL,
  "builtin"     TEXT,
  "position"    INTEGER      NOT NULL DEFAULT 0,
  "config"      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId"   TEXT         NOT NULL,
  "ownerId"     TEXT,
  CONSTRAINT "ProjectView_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectView_projectId_fkey') THEN
    ALTER TABLE "ProjectView" ADD CONSTRAINT "ProjectView_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectView_ownerId_fkey') THEN
    ALTER TABLE "ProjectView" ADD CONSTRAINT "ProjectView_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProjectView_projectId_position_idx" ON "ProjectView"("projectId", "position");
CREATE INDEX IF NOT EXISTS "ProjectView_ownerId_idx" ON "ProjectView"("ownerId");
-- At most one shared built-in view of each kind per project.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectView_projectId_builtin_key"
  ON "ProjectView"("projectId", "builtin") WHERE "builtin" IS NOT NULL;

COMMIT;
