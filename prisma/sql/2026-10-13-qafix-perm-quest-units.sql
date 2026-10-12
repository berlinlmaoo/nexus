-- Quests target divisions/units of the IP & Division Chart instead of the retired Crew Hub teams
-- (owner decision 13 Oct 2026). Additive only.
--   unitIds        OrgUnit ids; empty = everyone. A member of a unit OR of any unit below it sees the quest.
--   teamsRetired   true when the quest pointed at teams that no longer exist and was moved to "everyone"
--                  by this file (the admin list says so).
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "unitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "teamsRetired" BOOLEAN NOT NULL DEFAULT false;

-- Quests whose teams are all gone (nobody could see them) → everyone, flagged. Idempotent: a second run
-- finds no such rows (teamIds is empty afterwards).
UPDATE "Quest" q
SET "teamIds" = ARRAY[]::TEXT[], "teamsRetired" = true
WHERE cardinality(q."teamIds") > 0
  AND NOT EXISTS (SELECT 1 FROM "Team" t WHERE t.id = ANY (q."teamIds"));
