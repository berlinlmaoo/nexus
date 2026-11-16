export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

import { z } from "zod"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { Prisma } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { getUserWorkspaceIds } from "@/lib/workspace-scope"
import { NextRequest } from "next/server"
import { applyTaskCreate } from "@/lib/task-create"
import { applyTaskUpdate } from "@/lib/task-update"
import { verifyMcpToken, mcpUserId, mcpCaller, type McpCaller } from "@/lib/mcp-token-auth"
import { MCP_ISSUER } from "@/lib/mcp-oauth"
import {
  McpAttendanceError,
  getCorrectionStatus,
  getAttendanceDeductions,
  previewPenaltyWaiver,
  listAttendanceDays,
  listAttendancePeople,
  listAttendanceRequests,
  previewAttendanceCorrection,
  type CorrectionInput,
} from "@/lib/mcp-attendance"

// Full access to every project: BoD / One Above All only (owner 13 Oct 2026, lib/rbac.ts PROJECT_WIDE_ROLES).
const MGR_ROLES: string[] = ["ONE_ABOVE_ALL", "BOD"]
// MCP follows the web's project levels (lib/rbac.ts): read tools = Can view, task writes = Can edit
// (checkProjectAccess MEMBER), nothing here changes project settings (those would need Full / LEAD).
// Task writes run the web's own code (lib/task-create.ts = POST /api/tasks, lib/task-update.ts = PATCH
// /api/tasks/[id]): the same access check, row locks, section/status rules, notifications, realtime and audit.
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] })
const forbidden = (msg = "Forbidden: kamu gak punya akses ke project ini.") => ({ content: [{ type: "text" as const, text: msg }], isError: true })
const hasScope = (extra: { authInfo?: AuthInfo }, scope: string) => (extra.authInfo?.scopes ?? []).includes(scope)
type ToolExtra = { authInfo?: AuthInfo; requestInfo?: { headers?: Record<string, string | string[] | undefined> } }

/** A request object for the shared web code: the audit row's user agent names the connection ("NEXUS MCP · <client>"). */
function webRequest(caller: McpCaller, extra: ToolExtra): NextRequest {
  const h = new Headers({ "user-agent": `NEXUS MCP · ${caller.clientLabel}`, "content-type": "application/json" })
  const fwd = extra.requestInfo?.headers?.["x-forwarded-for"]
  if (typeof fwd === "string" && fwd) h.set("x-forwarded-for", fwd)
  return new NextRequest("http://127.0.0.1/api/mcp", { method: "POST", headers: h })
}
/** Keys on every audit row an MCP connection writes: who it acted through. */
const viaMeta = (caller: McpCaller) => ({ via: `${caller.clientLabel} (MCP)`, mcpClient: caller.clientLabel })

/** The web route's JSON answer as a tool result: its error text on a refusal, its body on success. */
async function fromWeb(res: Response, okShape: (body: Record<string, unknown>) => unknown) {
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (res.status >= 200 && res.status < 300) return ok(okShape(body))
  const msg = typeof body.error === "string" ? body.error : `Failed (HTTP ${res.status})`
  return { content: [{ type: "text" as const, text: `NEXUS refused: ${msg}${typeof body.code === "string" ? ` [${body.code}]` : ""}` }], isError: true }
}

/** Attendance tool wrapper: scope check, then the shared module; its refusals become readable tool errors. */
async function attendanceTool(extra: ToolExtra, scope: "attendance:read" | "attendance:write", run: (caller: McpCaller) => Promise<unknown>) {
  const caller = mcpCaller(extra)
  if (!caller.scopes.includes(scope)) {
    return forbidden(`Forbidden: this connection has no ${scope} scope. Reconnect it (or mint a token) with attendance access.`)
  }
  try {
    return ok(await run(caller))
  } catch (e) {
    if (e instanceof McpAttendanceError) return { content: [{ type: "text" as const, text: `${e.message} [${e.code}]` }], isError: true }
    throw e
  }
}

// The single source of truth for "which projects may this user READ" — identical rule to the web app's
// GET /api/tasks: BOD/ONE_ABOVE_ALL workspaces → every project in them; MANAGER/STAFF workspaces → only
// projects where they are a ProjectMember. This closes the
// gap where listing tasks without a projectId would otherwise expose tasks from projects a STAFF user
// isn't a member of.
async function accessibleProjectWhere(userId: string): Promise<Prisma.ProjectWhereInput> {
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

// NEXUS MCP server. Acts as the authenticated user (RBAC applies). Tasks (scopes tasks:read/write) and, only for a
// connection granted attendance:read/write, attendance reads and the two-step attendance correction
// (lib/mcp-attendance.ts). No tools for XP, day-off quota, offices, roles, or any admin action.
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "List the projects you can access (id, name, workspaceId).",
      {},
      async (_args: Record<string, never>, extra: { authInfo?: AuthInfo }) => {
        const userId = mcpUserId(extra)
        if (!hasScope(extra, "tasks:read")) return forbidden("Forbidden: this connection has no tasks:read scope.")
        const where = await accessibleProjectWhere(userId)
        const projects = await prisma.project.findMany({
          where,
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
        if (!hasScope(extra, "tasks:read")) return forbidden("Forbidden: this connection has no tasks:read scope.")
        const { allowed } = await checkProjectAccess(userId, projectId, ["VIEWER"])
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
        if (!hasScope(extra, "tasks:read")) return forbidden("Forbidden: this connection has no tasks:read scope.")
        if (args.projectId) {
          const { allowed } = await checkProjectAccess(userId, args.projectId, ["VIEWER"])
          if (!allowed) return forbidden()
        }
        // Authoritative read scope: STAFF only see tasks in projects they're a member of; the optional
        // taskListId/status/search filters are AND-intersected with this, so none of them can widen it.
        const projWhere = await accessibleProjectWhere(userId)
        const tasks = await prisma.task.findMany({
          where: {
            taskList: {
              project: projWhere,
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
        if (!hasScope(extra, "tasks:read")) return forbidden("Forbidden: this connection has no tasks:read scope.")
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
        const { allowed } = await checkProjectAccess(userId, task.taskList.projectId, ["VIEWER"])
        if (!allowed) return forbidden("Forbidden: gak punya akses ke project task ini.")
        return ok(task)
      },
    )

    server.tool(
      "create_task",
      "Create a new task inside a project section (taskListId). Same rules as creating it on the web (needs Can edit; assignees must be project members).",
      {
        taskListId: z.string().describe("The section (TaskList) id to create the task in. Use list_sections to find it."),
        title: z.string().trim().min(1).max(500),
        description: z.string().max(10000).optional(),
        priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        dueDate: z.string().optional().describe("ISO datetime or YYYY-MM-DD"),
        assigneeIds: z.array(z.string()).max(50).optional().describe("User ids to assign (project members only)"),
      },
      async (args: { taskListId: string; title: string; description?: string; priority?: string; dueDate?: string; assigneeIds?: string[] }, extra: ToolExtra) => {
        const caller = mcpCaller(extra)
        if (!hasScope(extra, "tasks:write")) return forbidden("Forbidden: token ini read-only (butuh scope tasks:write).")
        const list = await prisma.taskList.findUnique({ where: { id: args.taskListId }, select: { projectId: true } })
        if (!list) return ok("Section (taskListId) not found.")
        const actor = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } })
        const res = await applyTaskCreate({
          request: webRequest(caller, extra),
          session: { user: { id: caller.userId, name: actor?.name ?? null } },
          body: {
            title: args.title.trim(), projectId: list.projectId, taskListId: args.taskListId,
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.priority ? { priority: args.priority } : {}),
            ...(args.dueDate ? { dueDate: args.dueDate } : {}),
            ...(args.assigneeIds?.length ? { assigneeIds: args.assigneeIds } : {}),
          },
          auditMetadata: viaMeta(caller),
        })
        return fromWeb(res, (t) => ({ created: true, task: { id: t.id, title: t.title, status: t.status, taskListId: t.taskListId } }))
      },
    )

    server.tool(
      "update_task",
      "Update a task: move section (taskListId), change status/priority/due/title/description, or change assignees. Same rules as editing it on the web (needs Can edit).",
      {
        taskId: z.string(),
        taskListId: z.string().optional().describe("Move the task to this section id"),
        status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
        priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        title: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(100000).nullable().optional(),
        dueDate: z.string().nullable().optional(),
        assigneeIds: z.array(z.string()).max(50).optional().describe("Replaces the whole assignee set"),
        addAssigneeIds: z.array(z.string()).max(50).optional().describe("Adds these assignees, keeping the others (safe when someone else edits at the same time)"),
        removeAssigneeIds: z.array(z.string()).max(50).optional().describe("Removes these assignees, keeping the others"),
      },
      async (args: { taskId: string; taskListId?: string; status?: string; priority?: string; title?: string; description?: string | null; dueDate?: string | null; assigneeIds?: string[]; addAssigneeIds?: string[]; removeAssigneeIds?: string[] }, extra: ToolExtra) => {
        const caller = mcpCaller(extra)
        if (!hasScope(extra, "tasks:write")) return forbidden("Forbidden: token ini read-only (butuh scope tasks:write).")
        const { taskId, ...fields } = args
        const body: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        // A status named by the caller is a status picked from a list (the web status menu), not the Done tick undone.
        if (args.status) body.exactStatus = true
        if (Object.keys(body).length === 0) return ok("Nothing to change.")
        const actor = await prisma.user.findUnique({ where: { id: caller.userId }, select: { name: true } })
        const res = await applyTaskUpdate({
          request: webRequest(caller, extra),
          session: { user: { id: caller.userId, name: actor?.name ?? null } },
          taskId,
          body,
          auditMetadata: viaMeta(caller),
        })
        return fromWeb(res, (t) => ({ updated: true, task: { id: t.id, title: t.title, status: t.status, priority: t.priority, taskListId: t.taskListId } }))
      },
    )

    // ── Attendance (scopes attendance:read / attendance:write; lib/mcp-attendance.ts) ─────────────────
    server.tool(
      "list_attendance_people",
      "List the people whose attendance you may see: yourself plus everyone you approve in the Bagan Approval. `canCorrect` says whether you may correct them.",
      {},
      async (_args: Record<string, never>, extra: ToolExtra) => attendanceTool(extra, "attendance:read", (c) => listAttendancePeople(c)),
    )

    server.tool(
      "list_attendance",
      "Attendance days (present / late / absent (TK) / leave / sick / permit / day off) with check-in and check-out times (WIB) for one person or everyone you may see, from..to (YYYY-MM-DD, at most 62 days).",
      {
        from: z.string().describe("YYYY-MM-DD"),
        to: z.string().optional().describe("YYYY-MM-DD (default: same as from)"),
        userId: z.string().optional().describe("One person (from list_attendance_people); omit for everyone you may see"),
      },
      async (args: { from: string; to?: string; userId?: string }, extra: ToolExtra) => attendanceTool(extra, "attendance:read", (c) => listAttendanceDays(c, args)),
    )

    server.tool(
      "list_attendance_requests",
      "Attendance requests (leave, sick, permit, day off) of the people you may see. Default: the ones still pending.",
      {
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
        userId: z.string().optional(),
        from: z.string().optional().describe("YYYY-MM-DD: requests ending on/after this date"),
        to: z.string().optional().describe("YYYY-MM-DD: requests starting on/before this date"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async (args: { status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; userId?: string; from?: string; to?: string; limit?: number }, extra: ToolExtra) =>
        attendanceTool(extra, "attendance:read", (c) => listAttendanceRequests(c, args)),
    )

    server.tool(
      "preview_attendance_correction",
      "Ask for a correction of one person's attendance day. CHANGES NOTHING. kind MARK_PRESENT = the day has no record (forgot to check in) → present with the given times; kind FIX_TIMES = change the check-in and/or check-out of an existing record (e.g. forgot to check out). Times as HH:mm (WIB) on that date. Returns the exact before/after, a requestId and an approveUrl. Send the approveUrl to the person: only they can approve it, signed in to NEXUS on the web. Then use get_attendance_correction_status.",
      {
        userId: z.string().describe("The person (from list_attendance_people)"),
        date: z.string().describe("YYYY-MM-DD"),
        kind: z.enum(["MARK_PRESENT", "FIX_TIMES"]),
        checkInAt: z.string().optional().describe("HH:mm (WIB) or ISO-8601. Required for MARK_PRESENT."),
        checkOutAt: z.string().nullable().optional().describe("HH:mm (WIB) or ISO-8601. MARK_PRESENT: omitted = end of shift, null = check-in only."),
        reason: z.string().describe("Why (10–500 characters). Stored on the record and in the audit."),
      },
      async (args: CorrectionInput, extra: ToolExtra) => attendanceTool(extra, "attendance:write", (c) => previewAttendanceCorrection(c, args)),
    )

    server.tool(
      "get_attendance_deductions",
      "Why someone lost XP or day off: every attendance deduction of one attendance period (28th → 27th) — per date the XP deducted, the day off cut automatically, the minutes late and check-in/out times — plus the day-off allowance, how much is used and what remains, and the day offs they asked for. Read from NEXUS's own deduction log.",
      {
        userId: z.string().describe("The person (from list_attendance_people)"),
        period: z.string().optional().describe("YYYY-MM attendance period (the 28th of the month before → the 27th). Default: the current one."),
      },
      async (args: { userId: string; period?: string }, extra: ToolExtra) => attendanceTool(extra, "attendance:read", (c) => getAttendanceDeductions(c, args)),
    )

    server.tool(
      "preview_attendance_waiver",
      "Ask to remove the attendance deductions (XP and auto-cut day off) of one person on some dates, as one batch. CHANGES NOTHING. Each date is cleared as a whole day, like the remove button in the NEXUS deduction log. Returns every item, the XP and day off that would come back and the balance after, plus a requestId and an approveUrl: send the approveUrl to the person; only they can approve it, signed in to NEXUS on the web. Then use get_attendance_correction_status.",
      {
        userId: z.string(),
        dates: z.array(z.string()).min(1).max(31).describe("YYYY-MM-DD dates that have deductions (from get_attendance_deductions)"),
        reason: z.string().describe("Why (10–500 characters). Stored in the audit."),
      },
      async (args: { userId: string; dates: string[]; reason: string }, extra: ToolExtra) => attendanceTool(extra, "attendance:write", (c) => previewPenaltyWaiver(c, args)),
    )

    server.tool(
      "get_attendance_correction_status",
      "The outcome of a correction you asked for: PENDING (waiting for the person on the approval page), APPROVED (applied), REJECTED, EXPIRED (not decided within 10 minutes) or FAILED (approved but NEXUS refused it when applying, with the reason).",
      { requestId: z.string() },
      async (args: { requestId: string }, extra: ToolExtra) => attendanceTool(extra, "attendance:read", (c) => getCorrectionStatus(c, args.requestId)),
    )
  },
  { serverInfo: { name: "nexus", version: "1.0.0" } },
  { streamableHttpEndpoint: "/api/mcp", disableSse: true, maxDuration: 60, verboseLogs: false },
)

// resourceUrl pins the WWW-Authenticate `resource_metadata` URL to the public origin so OAuth
// discovery works regardless of which internal host actually served the request.
const authed = withMcpAuth(handler, verifyMcpToken, { required: true, resourceUrl: MCP_ISSUER })
export { authed as GET, authed as POST }
