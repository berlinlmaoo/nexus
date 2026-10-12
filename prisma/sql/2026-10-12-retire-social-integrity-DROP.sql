-- =====================================================================================================
-- DO NOT RUN WITHOUT OWNER APPROVAL.
--
-- 2026-10-12  Retire "Integrity" (peer reports) and "Social Approvals" — OPTIONAL, IRREVERSIBLE PART.
--
-- The features were removed from the code on 12 Oct 2026 (owner: "feature social approvals sama
-- integrity hapus total"). The data was deliberately left in place. This file is the later, optional
-- clean-up: it copies the Integrity tables into an `archive` schema and then drops the live tables and
-- their enum types. Social Approvals stored nothing in NEXUS (the drafts lived in Buffer), so it has
-- nothing to drop.
--
-- Row counts on 12 Oct 2026: prod PeerReport = 0, PeerReportEvent = 0.
--
-- Before running, ALSO remove from prisma/schema.prisma: models PeerReport + PeerReportEvent, enums
-- PeerReportStatus + PeerReportCategory, and the three User relation fields peerReportsFiled /
-- peerReportsAgainst / peerReportsReviewed — in the SAME release, or Prisma will query missing tables.
-- Evidence photos stay on disk under public/uploads/peer-reports (no longer served); delete them by hand
-- only if the owner wants that too.
--
-- The guard below stops the whole script. Delete it deliberately once approval is given.
-- =====================================================================================================

DO $$ BEGIN
  RAISE EXCEPTION 'retire-social-integrity-DROP: owner approval required — remove this guard to run';
END $$;

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

-- Archive copies (data + a timestamp). Re-runnable: skipped if the archive already exists.
DO $$ BEGIN
  IF to_regclass('public."PeerReport"') IS NOT NULL AND to_regclass('archive."PeerReport_20261012"') IS NULL THEN
    EXECUTE 'CREATE TABLE archive."PeerReport_20261012" AS SELECT *, now() AS archived_at FROM public."PeerReport"';
  END IF;
  IF to_regclass('public."PeerReportEvent"') IS NOT NULL AND to_regclass('archive."PeerReportEvent_20261012"') IS NULL THEN
    EXECUTE 'CREATE TABLE archive."PeerReportEvent_20261012" AS SELECT *, now() AS archived_at FROM public."PeerReportEvent"';
  END IF;
END $$;

-- Enum columns become text in the archive so the enum types can go.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'archive' AND table_name = 'PeerReport_20261012' AND column_name = 'category' AND data_type = 'USER-DEFINED') THEN
    ALTER TABLE archive."PeerReport_20261012" ALTER COLUMN "category" TYPE text USING "category"::text;
    ALTER TABLE archive."PeerReport_20261012" ALTER COLUMN "status" TYPE text USING "status"::text;
  END IF;
END $$;

DROP TABLE IF EXISTS public."PeerReportEvent";
DROP TABLE IF EXISTS public."PeerReport";
DROP TYPE IF EXISTS public."PeerReportStatus";
DROP TYPE IF EXISTS public."PeerReportCategory";

-- Old in-app notifications of the retired types (already shown without a link). Optional; kept
-- commented out because people may still want to read them.
-- DELETE FROM public."Notification" WHERE type LIKE 'peer_report%' OR type = 'violation_announcement';

COMMIT;
