-- bluegreen: expand   (additive: four nullable / defaulted columns; safe BEFORE the deploy)
-- Attendance override evidence (owner, 20 Oct 2026). A BoD/OAA changing a day on the attendance board to
-- Sick or Permit, or to Present from Permit / TK / nothing recorded, is asked for evidence (photo or PDF, optional).
--   AttendanceRecord.correctionEvidenceUrl/Name   the file for → Present (the request carries it for Sick/Permit)
--   AttendanceRecord.correctionEvidenceMissing    → Present saved with no evidence attached (evidence is optional)
--   AttendanceRequest.evidenceMissing              → Sick/Permit saved with no evidence attached
-- The running build never reads them; ADD COLUMN with a constant default is metadata-only on PG ≥ 11.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-20-attendance-override-evidence.sql
-- Names follow Prisma's conventions so `prisma migrate diff` sees no drift.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "correctionEvidenceUrl" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "correctionEvidenceName" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "correctionEvidenceMissing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS "evidenceMissing" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
