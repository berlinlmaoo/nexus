-- bluegreen: expand   (one new column with a default; the running build ignores it)
-- "Staff Management" (owner, 27 Oct 2026): a Staff member of the management team who can SEE everyone's attendance
-- history but change nothing. The role stays STAFF (released iOS / Android parse the role enum); this flag adds the
-- read-only, workspace-wide attendance view. Default false = nobody changes. See WorkspaceMember.attendanceViewAll.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-27-staff-management.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "attendanceViewAll" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
