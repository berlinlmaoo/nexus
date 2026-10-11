-- Project templates (owner, 12 Oct 2026, DEV item #8). Idempotent.
--  * Project.templateId: which template a project was built from (src/lib/project-templates.ts); null
--    for blank projects and everything made before.
--  * TaskList.taskStatus: the task status a section stands for; moving a task into it sets that status.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "TaskList" ADD COLUMN IF NOT EXISTS "taskStatus" "TaskStatus";
