-- bluegreen: expand   (two nullable columns + a new trigger; the running build ignores both)
-- Un-done goes back to where the task was (owner, 27 Oct 2026, option B): unticking Done puts a task back in the
-- status (In progress, In review, …) and the section it had right before it was marked Done, not always To Do.
-- Every write path marks tasks done (web, released iOS / Android, GIDEON, MCP, automations, the WhatsApp bot), so
-- the database remembers it, like Task_completion_stamp does for completedAt: on a transition INTO Done this
-- trigger keeps the old status and section. PATCH /api/tasks/:id reads them when a Done task is set back to To Do
-- (lib/task-update.ts). Null = unknown (done before this file, or created as Done) -> To Do, as before.
-- A separate trigger: Task_completion_stamp is not touched. No foreign key: a section deleted since is simply
-- not found and the task takes the first section of its status.
--   nexus-sql.sh <env> apply prisma/sql/2026-10-27-task-status-before-done.sql

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "statusBeforeDone" "TaskStatus";
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "taskListIdBeforeDone" TEXT;

CREATE OR REPLACE FUNCTION nexus_task_status_before_done() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DONE' AND OLD.status IS DISTINCT FROM 'DONE' THEN
    NEW."statusBeforeDone" := OLD.status;
    NEW."taskListIdBeforeDone" := OLD."taskListId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Task_status_before_done" ON "Task";
CREATE TRIGGER "Task_status_before_done" BEFORE UPDATE OF status ON "Task"
  FOR EACH ROW EXECUTE FUNCTION nexus_task_status_before_done();

COMMIT;
