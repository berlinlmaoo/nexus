export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { z } from "zod"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { Prisma } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { sectionForStatus } from "@/lib/status-sections"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import { getUserWorkspaceIds } from "@/lib/workspace-scope"
import { logAudit } from "@/lib/audit"
import { runAutomations } from "@/lib/automation-engine"
import { verifyMcpToken, mcpUserId } from "@/lib/mcp-token-auth"
import { MCP_ISSUER } from "@/lib/mcp-oauth"

// Full access to every project: BoD / One Above All only (owner 13 Oct 2026, lib/rbac.ts PROJECT_WIDE_ROLES).
const MGR_ROLES: string[] = ["ONE_ABOVE_ALL", "BOD"]
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] })
const forbidden = (msg = "Forbidden: kamu gak punya akses ke project ini.") => ({ content: [{ type: "text" as const, text: msg }], isError: true })
const hasScope = (extra: { authInfo?: AuthInfo }, scope: string) => (extra.authInfo?.scopes ?? []).includes(scope)

// The single source of truth for "which projects may this user READ" — identical rule to the web app's
// GET /api/tasks: system admin → all (undefined = unrestricted); BOD/MANAGER/ONE_ABOVE_ALL workspaces →
// every project in them; STAFF workspaces → only projects where they are a ProjectMember. This closes the
// gap where listing tasks without a projectId would otherwise expose tasks from projects a STAFF user
// isn't a member of.
async function accessibleProjectWhere(userId: string): Promise<Prisma.ProjectWhereInput | undefined> {
  if (await isSystemAdminUser(userId)) return undefined
  const wsIds = await getUserWorkspaceIds(userId)
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, workspaceId: { in: wsIds } },
    select: { workspaceId: true, role: true },
  })
  const mgrWs = memberships.filter((m) => MGR_ROLES.includes(m.role)).map((m) => m.workspaceId)
  return {
    workspaceId: { in: wsIds.length ? wsIds : ["__none__"] },
    OR: [{ workspaceId: { in: mgrWs } }, { members: { some: { userId } } }],
  }
}

// NEXUS MCP server — TASK-SCOPED ONLY. Acts as the authenticated user (RBAC applies). It deliberately
// exposes NO tools for XP, day-off quota, attendance writes, offices, roles, or any admin action.
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "List the projects you can access (id, name, workspaceId).",
      {},
      async (_args: Record<string, never>, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        const where = await accessibleProjectWhere(userId)
        const projects = await prisma.project.findMany({
          where: where ?? {},
          select: { id: true, name: true, workspaceId: true, color: true },
          orderBy: { name: "asc" },
          take: 200,
        })
        return ok(projects)
      },
    )

    server.tool(
      "list_sections",
      "List a project's sections (board columns / TaskLists) so you know where tasks live.",
      { projectId: z.string() },
      async ({ projectId }: { projectId: string }, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        const { allowed } = await checkProjectAccess(userId, projectId, ["MEMBER"])
        if (!allowed) return forbidden()
        const sections = await prisma.taskList.findMany({ where: { projectId }, select: { id: true, name: true, position: true }, orderBy: { position: "asc" } })
        return ok(sections)
      },
    )

    server.tool(
      "list_tasks",
      "List tasks. Optionally filter by project, section, status, or a title search.",
      {
        projectId: z.string().optional(),
        taskListId: z.string().optional(),
        status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async (args: { projectId?: string; taskListId?: string; status?: string; search?: string; limit?: number }, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        if (args.projectId) {
          const { allowed } = await checkProjectAccess(userId, args.projectId, ["MEMBER"])
          if (!allowed) return forbidden()
        }
        // Authoritative read scope: STAFF only see tasks in projects they're a member of; the optional
        // taskListId/status/search filters are AND-intersected with this, so none of them can widen it.
        const projWhere = await accessibleProjectWhere(userId)
        const tasks = await prisma.task.findMany({
          where: {
            taskList: {
              ...(projWhere ? { project: projWhere } : {}),
              ...(args.projectId ? { projectId: args.projectId } : {}),
            },
            ...(args.taskListId ? { taskListId: args.taskListId } : {}),
            ...(args.status ? { status: args.status as never } : {}),
            ...(args.search ? { title: { contains: args.search, mode: "insensitive" } } : {}),
          },
          select: {
            id: true, title: true, status: true, priority: true, dueDate: true, taskListId: true,
            taskList: { select: { name: true, project: { select: { name: true } } } },
            assignees: { select: { user: { select: { name: true, email: true } } } },
          },
          orderBy: { updatedAt: "desc" },
          take: args.limit ?? 50,
        })
        return ok(tasks)
      },
    )

    server.tool(
      "get_task",
      "Get the full detail of one task by id.",
      { taskId: z.string() },
      async ({ taskId }: { taskId: string }, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: {
            id: true, title: true, description: true, status: true, priority: true, dueDate: true, tags: true, taskListId: true,
            taskList: { select: { name: true, projectId: true, project: { select: { name: true } } } },
            assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
            creator: { select: { name: true } }, createdAt: true, updatedAt: true,
          },
        })
        if (!task) return ok("Task not found.")
        const { allowed } = await checkProjectAccess(userId, task.taskList.projectId, ["MEMBER"])
        if (!allowed) return forbidden("Forbidden: gak punya akses ke project task ini.")
        return ok(task)
      },
    )

    server.tool(
      "create_task",
      "Create a new task inside a project section (taskListId).",
      {
        taskListId: z.string().describe("The section (TaskList) id to create the task in. Use list_sections to find it."),
        title: z.string().trim().min(1).max(500),
        description: z.string().max(20000).optional(),
        priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        dueDate: z.string().optional().describe("ISO datetime or YYYY-MM-DD"),
        assigneeIds: z.array(z.string()).optional().describe("User ids to assign"),
      },
      async (args: { taskListId: string; title: string; description?: string; priority?: string; dueDate?: string; assigneeIds?: string[] }, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        if (!hasScope(extra, "tasks:write")) return forbidden("Forbidden: token ini read-only (butuh scope tasks:write).")
        const list = await prisma.taskList.findUnique({ where: { id: args.taskListId }, select: { projectId: true } })
        if (!list) return ok("Section (taskListId) not found.")
        const { allowed } = await checkProjectAccess(userId, list.projectId, ["MEMBER"])
        if (!allowed) return forbidden()
        const task = await prisma.task.create({
          data: {
            title: args.title.trim(),
            description: args.description ?? null,
            priority: (args.priority ?? "NONE") as never,
            status: "TODO",
            taskListId: args.taskListId,
            creatorId: userId,
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            ...(args.assigneeIds?.length ? { assignees: { create: args.assigneeIds.map((u) => ({ userId: u })) } } : {}),
          },
          select: { id: true, title: true, status: true, taskListId: true },
        })
        try { await logAudit({ action: "create", entityType: "task", entityId: task.id, entityName: task.title, userId, metadata: { via: "mcp" } }) } catch { /* best-effort */ }
        runAutomations({ kind: "task_created", projectId: list.projectId, actorId: userId, taskId: task.id }).catch(() => {})
        return ok({ created: true, task })
      },
    )

    server.tool(
      "update_task",
      "Update a task: move section (taskListId), change status/priority/due/title/description, or set assignees.",
      {
        taskId: z.string(),
        taskListId: z.string().optional().describe("Move the task to this section id"),
        status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
        priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        title: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(20000).nullable().optional(),
        dueDate: z.string().nullable().optional(),
        assigneeIds: z.array(z.string()).optional().describe("Replaces the assignee set"),
      },
      async (args: { taskId: string; taskListId?: string; status?: string; priority?: string; title?: string; description?: string | null; dueDate?: string | null; assigneeIds?: string[] }, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        if (!hasScope(extra, "tasks:write")) return forbidden("Forbidden: token ini read-only (butuh scope tasks:write).")
        const existing = await prisma.task.findUnique({ where: { id: args.taskId }, select: { status: true, priority: true, title: true, dueDate: true, taskListId: true, assignees: { select: { userId: true } }, taskList: { select: { projectId: true } } } })
        if (!existing) return ok("Task not found.")
        const { allowed } = await checkProjectAccess(userId, existing.taskList.projectId, ["MEMBER"])
        if (!allowed) return forbidden()
        if (args.taskListId) {
          const tl = await prisma.taskList.findUnique({ where: { id: args.taskListId }, select: { projectId: true } })
          if (!tl) return ok("Target section not found.")
          const acc = await checkProjectAccess(userId, tl.projectId, ["MEMBER"])
          if (!acc.allowed) return forbidden("Forbidden: gak punya akses ke project section tujuan.")
        }
        // Sections are the status options (lib/status-sections.ts): a new status moves the task to its column.
        const statusMove = !args.taskListId && args.status && args.status !== existing.status
          ? await sectionForStatus(prisma, existing.taskList.projectId, existing.taskListId, args.status)
          : null
        const updated = await prisma.task.update({
          where: { id: args.taskId },
          data: {
            ...(args.taskListId ? { taskListId: args.taskListId } : statusMove ? { taskListId: statusMove } : {}),
            ...(args.status ? { status: args.status as never } : {}),
            // completedAt is stamped by the DB trigger; on DONE→DONE it keeps the first completer.
            ...(args.status === "DONE" ? { completedById: userId } : {}),
            ...(args.priority ? { priority: args.priority as never } : {}),
            ...(args.title ? { title: args.title.trim() } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.dueDate !== undefined ? { dueDate: args.dueDate ? new Date(args.dueDate) : null } : {}),
            ...(args.assigneeIds ? { assignees: { deleteMany: {}, create: args.assigneeIds.map((u) => ({ userId: u })) } } : {}),
          },
          select: { id: true, title: true, status: true, priority: true, taskListId: true },
        })
        try { await logAudit({ action: "update", entityType: "task", entityId: updated.id, entityName: updated.title, userId, metadata: { via: "mcp" } }) } catch { /* best-effort */ }
        // Project automations (12 Oct 2026): the same "task_updated" event the task PATCH route raises.
        const beforeAssignees = existing.assignees.map((a) => a.userId)
        runAutomations({
          kind: "task_updated", projectId: existing.taskList.projectId, actorId: userId, taskId: updated.id,
          changes: {
            ...(args.status ? { status: { from: existing.status, to: args.status } } : {}),
            ...(args.priority ? { priority: { from: existing.priority, to: args.priority } } : {}),
            ...(args.title ? { title: { from: existing.title, to: args.title.trim() } } : {}),
            ...(args.dueDate !== undefined ? { dueDate: { from: existing.dueDate?.toISOString() ?? null, to: args.dueDate ? new Date(args.dueDate).toISOString() : null } } : {}),
            ...(args.taskListId ? { section: { from: existing.taskListId, to: args.taskListId } } : {}),
            ...(args.assigneeIds ? { assignee: { added: args.assigneeIds.filter((id) => !beforeAssignees.includes(id)), removed: beforeAssignees.filter((id) => !args.assigneeIds!.includes(id)) } } : {}),
          },
        }).catch(() => {})
        return ok({ updated: true, task: updated })
      },
    )
  },
  { serverInfo: { name: "nexus", version: "1.0.0" } },
  { streamableHttpEndpoint: "/api/mcp", disableSse: true, maxDuration: 60, verboseLogs: false },
)

// resourceUrl pins the WWW-Authenticate `resource_metadata` URL to the public origin so OAuth
// discovery works regardless of which internal host actually served the request.
const authed = withMcpAuth(handler, verifyMcpToken, { required: true, resourceUrl: MCP_ISSUER })
export { authed as GET, authed as POST }
