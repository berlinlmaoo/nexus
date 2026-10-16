-- bluegreen: expand   (additive: one trigger function + one trigger; safe BEFORE the deploy)
-- Task.updatedAt in commit order (race audit 16 Oct 2026, M20). Prisma stamps @updatedAt in the app when it builds the
-- UPDATE, not when it commits, so of two edits of one task a moment apart the one that commits LAST can carry the
-- EARLIER updatedAt (measured on dev: 6 of 8 rounds of 15 simultaneous edits). The web now ignores a task-updated event
-- older (updatedAt) than the card it holds, which is only right if updatedAt grows in commit order. This trigger makes
-- it so: when an UPDATE sets updatedAt (Prisma always does) to a value not after the stored one, it becomes the stored
-- one + 1 ms. Concurrent UPDATEs of one row wait on its row lock and the trigger then sees the committed row, so the
-- order is the commit order. An UPDATE that leaves updatedAt alone (raw SQL position moves) is left alone. Normal edits,
-- whose app time is already later, are untouched.
--
-- Expand-only and idempotent: CREATE OR REPLACE FUNCTION / TRIGGER. Harmless to the running build (it only ever moves
-- an updatedAt forward by a millisecond). Undo: DROP TRIGGER "Task_updatedAt_monotonic" ON "Task".
--   nexus-sql.sh <env> apply prisma/sql/2026-10-16-task-updated-at-monotonic.sql

SET lock_timeout = '5s';

BEGIN;

CREATE OR REPLACE FUNCTION nexus_task_updated_at_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."updatedAt" IS DISTINCT FROM OLD."updatedAt" AND NEW."updatedAt" <= OLD."updatedAt" THEN
    NEW."updatedAt" := OLD."updatedAt" + interval '1 millisecond';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "Task_updatedAt_monotonic"
  BEFORE UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION nexus_task_updated_at_monotonic();

COMMIT;
