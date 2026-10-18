-- bluegreen: expand   (additive: two columns on "MeetingNote"; safe BEFORE the deploy)
-- Meeting notes speaker labels (owner, 19 Oct 2026). Voices are told apart on the office transcriber, and the
-- round of introductions at the start ("Halo, saya Berlin…") gives each voice its name:
--   "MeetingNote"."introEndSec"    seconds into the recording where the introductions ended (the record screen's
--                                  "Done with introductions"); null = uploaded file / not marked → the first
--                                  two minutes are searched instead.
--   "MeetingNote"."speakerLabels"  ask the transcriber for speaker labels (the dialog's switch; default on).
-- The running build never reads them; old rows read as "no marker, labels on" which only matters on a retry.
--
-- Expand-only and idempotent.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-19-meeting-speakers.sql

SET lock_timeout = '5s';

ALTER TABLE "MeetingNote" ADD COLUMN IF NOT EXISTS "introEndSec" DOUBLE PRECISION;
ALTER TABLE "MeetingNote" ADD COLUMN IF NOT EXISTS "speakerLabels" BOOLEAN NOT NULL DEFAULT true;
