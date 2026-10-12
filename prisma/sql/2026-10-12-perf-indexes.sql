-- Perf pass (12 Oct 2026): foreign-key lookups the project page, task popup, project tree and forms
-- make on every load, which had no index (sequential scans; cheap today, linear in table size).
-- Idempotent; CONCURRENTLY so it can run on a live database without blocking writes. Run outside a
-- transaction (psql -f, not inside BEGIN). Mirrors the @@index lines added to prisma/schema.prisma.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CustomFieldValue_taskId_idx" ON "CustomFieldValue" ("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attachment_taskId_idx" ON "Attachment" ("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CustomField_projectId_idx" ON "CustomField" ("projectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Form_projectId_idx" ON "Form" ("projectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TaskList_projectId_position_idx" ON "TaskList" ("projectId", "position");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectMember_projectId_idx" ON "ProjectMember" ("projectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Project_workspaceId_idx" ON "Project" ("workspaceId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember" ("workspaceId");
