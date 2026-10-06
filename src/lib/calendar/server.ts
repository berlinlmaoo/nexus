import { createHash, createHmac } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"
import { auth } from "@/lib/auth"
import { getAppSetting } from "@/lib/app-setting"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import {
  buildItems, buildStructure, CALENDAR_SETTINGS_DEFAULTS, effectiveVisibility, inAudience, normalizeCalendarSettings, projectUnits,
  type CalendarSettings, type CalItem, type CalStructure, type CalViewer, type ItemContext, type ProjectUnitWhy, type TaskRow,
} from "@/lib/calendar/core"

/**
 * Calendar — the database side of /api/calendar/** (the rules themselves are in ./core.ts).
 *
 * Who gets what:
 *   • not signed in → 401;
 *   • signed in but not in the company workspace (and not a system admin) → 200 { access: "none" } with
 *     empty lists, so a personal-workspace account shows "enter a workspace code" instead of an error;
 *   • outside the rollout audience (AppSetting "calendar".audience) → 200 { access: "off" };
 *   • otherwise the data, with `access` = "all" for admin/OAA/BoD/Manager and the visibility mode for staff.
 */

export const CALENDAR_SETTING_KEY = "calendar"

export async function getCalendarSettings(): Promise<CalendarSettings> {
  const raw = await getAppSetting<unknown>(CALENDAR_SETTING_KEY).catch(() => null)
  return normalizeCalendarSettings(raw ?? CALENDAR_SETTINGS_DEFAULTS)
}

export type CalendarAccess = "all" | CalendarSettings["visibility"]

export type CalendarCaller =
  | { kind: "none"; userId: string }
  | { kind: "off"; userId: string }
  | { kind: "ok"; userId: string; orgRole: string | null; isAdmin: boolean; viewer: CalViewer; settings: CalendarSettings; access: CalendarAccess }

/** The signed-in caller, or the 401 response. */
export async function calendarCaller(): Promise<CalendarCaller | NextResponse> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const [user, member, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } }, select: { role: true } }),
    getCalendarSettings(),
  ])
  const isAdmin = user?.role === "ADMIN"
  const orgRole = member?.role ?? null
  if (!isAdmin && !orgRole) return { kind: "none", userId }
  if (!inAudience(settings, { userId, orgRole, isAdmin })) return { kind: "off", userId }
  const full = isAdmin || orgRole === "ONE_ABOVE_ALL" || orgRole === "BOD" || orgRole === "MANAGER"
  const memberProjectIds = full
    ? new Set<string>()
    : new Set((await prisma.projectMember.findMany({ where: { userId, project: { workspaceId: ORG_WORKSPACE_ID } }, select: { projectId: true } })).map((m) => m.projectId))
  return {
    kind: "ok", userId, orgRole, isAdmin, settings,
    viewer: { userId, full, memberProjectIds },
    access: full ? "all" : effectiveVisibility(settings),
  }
}

// ── Structure ──────────────────────────────────────────────────────────────────────────────────────

export type LoadedStructure = CalStructure & {
  version: string
  homeUnitsOf: Map<string, string[]>
  unitRank: Map<string, number>
  unitColor: Map<string, string>
  /** unit id → the colour of its section (the card under the top it belongs to). */
  sectionColor: Map<string, string>
}

/** The Bagan of the company workspace (without gideon), built once per request. */
export async function loadStructure(): Promise<LoadedStructure> {
  const [units, members, links] = await Promise.all([
    prisma.orgUnit.findMany({
      where: { workspaceId: ORG_WORKSPACE_ID },
      select: { id: true, name: true, kind: true, logoUrl: true, parentId: true, position: true, leadUserId: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ORG_WORKSPACE_ID, user: { email: { not: "gideon@znetworks.id" } } },
      select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.orgUnitMember.findMany({
      where: { workspaceId: ORG_WORKSPACE_ID },
      select: { unitId: true, userId: true, title: true, reportsToUserId: true },
      orderBy: { createdAt: "asc" },
    }),
  ])
  const s = buildStructure(
    units,
    members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, avatar: m.user.avatar, role: m.role })),
    links,
  )
  return {
    ...s,
    version: `st_${createHash("sha1").update(JSON.stringify(s)).digest("hex").slice(0, 12)}`,
    homeUnitsOf: new Map(s.people.map((p) => [p.userId, p.homeUnitIds])),
    unitRank: new Map(s.units.map((u) => [u.id, u.rank])),
    unitColor: new Map(s.units.map((u) => [u.id, u.color])),
    sectionColor: new Map(s.units.map((u) => [u.id, s.units.find((x) => x.id === u.sectionId)?.color ?? u.color])),
  }
}

/**
 * Every company project → its division (core.ts projectUnits): where a task goes when none of its
 * PICs is in the Bagan. Archived projects included, so nothing moves when a project is archived.
 */
export async function loadProjectUnits(s: LoadedStructure, settings: CalendarSettings): Promise<Map<string, { unitId: string; why: ProjectUnitWhy }>> {
  const [projects, folders] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: ORG_WORKSPACE_ID }, select: { id: true, name: true, folderId: true } }),
    prisma.projectFolder.findMany({ where: { workspaceId: ORG_WORKSPACE_ID }, select: { id: true, name: true, parentFolderId: true } }),
  ])
  return projectUnits(projects, folders, s.units, settings)
}

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────────

/** A safety cap; a month is ~200 tasks today. */
export const ROW_CAP = 5000

const TASK_SELECT = {
  id: true, title: true, status: true, priority: true, dueDate: true, creatorId: true,
  parent: {
    select: {
      id: true, title: true, creatorId: true,
      taskList: { select: { project: { select: { id: true, name: true } } } },
      taskProjects: { select: { project: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      assignees: { select: { userId: true } },
    },
  },
  taskList: { select: { project: { select: { id: true, name: true, color: true, disableTaskStatus: true } } } },
  taskProjects: { select: { project: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  assignees: { select: { userId: true }, orderBy: { assignedAt: "asc" } },
} satisfies Prisma.TaskSelect

type TaskSelected = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>

function toRow(t: TaskSelected, dueDate: Date): TaskRow {
  const home = t.taskList.project
  return {
    id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate, creatorId: t.creatorId,
    parent: t.parent && {
      id: t.parent.id, title: t.parent.title, creatorId: t.parent.creatorId,
      projects: [t.parent.taskList.project, ...t.parent.taskProjects.map((l) => l.project).filter((p) => p.id !== t.parent!.taskList.project.id)],
      assigneeIds: t.parent.assignees.map((a) => a.userId),
    },
    project: { id: home.id, name: home.name, color: home.color },
    noStatus: home.disableTaskStatus,
    linkedProjects: t.taskProjects.map((l) => l.project).filter((p) => p.id !== home.id),
    assigneeIds: t.assignees.map((a) => a.userId),
  }
}

/**
 * Tasks of the company workspace (home project there and not archived), not cancelled, with a due
 * date matching `dueDate`. One query; the assignees come in the order they were assigned. `open`
 * = still to do: not done, and not in a project without status (those can never be ticked done).
 */
export async function loadTaskRows(dueDate: Prisma.TaskWhereInput["dueDate"], opts: { open?: boolean; take?: number; order?: "asc" | "desc" } = {}): Promise<{ rows: TaskRow[]; truncated: boolean }> {
  const take = opts.take ?? ROW_CAP
  const found = await prisma.task.findMany({
    where: {
      dueDate,
      status: opts.open ? { notIn: ["DONE", "CANCELLED"] } : { not: "CANCELLED" },
      taskList: { project: { workspaceId: ORG_WORKSPACE_ID, status: { not: "ARCHIVED" }, ...(opts.open ? { disableTaskStatus: false } : {}) } },
    },
    orderBy: [{ dueDate: opts.order ?? "asc" }, { id: "asc" }],
    take: take + 1,
    select: TASK_SELECT,
  })
  const truncated = found.length > take
  const rows = found.slice(0, take).flatMap((t) => (t.dueDate ? [toRow(t, t.dueDate)] : []))
  return { rows, truncated }
}

/**
 * Open tasks WITHOUT a due date ("Suatu hari" in the widgets), most urgent first. `assigneeId` limits
 * them to one person's. The due date is set to the epoch only so the shared rules can run; it is never sent.
 */
export async function loadUndatedRows(assigneeId: string | null, take: number): Promise<TaskRow[]> {
  const found = await prisma.task.findMany({
    where: {
      dueDate: null,
      status: { notIn: ["DONE", "CANCELLED"] },
      taskList: { project: { workspaceId: ORG_WORKSPACE_ID, status: { not: "ARCHIVED" }, disableTaskStatus: false } },
      ...(assigneeId ? { assignees: { some: { userId: assigneeId } } } : {}),
    },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
    take,
    select: TASK_SELECT,
  })
  return found.map((t) => toRow(t, new Date(0)))
}

/** One task of the company workspace by id (any due date, or none), or null. */
export async function loadTaskRowById(id: string): Promise<TaskRow | null> {
  const t = await prisma.task.findFirst({
    where: { id, status: { not: "CANCELLED" }, taskList: { project: { workspaceId: ORG_WORKSPACE_ID } } },
    select: TASK_SELECT,
  })
  return t ? toRow(t, t.dueDate ?? new Date(0)) : null
}

/**
 * The id a masked row is known by: stable (a client can key its list on it) and not reversible to the
 * task id, so a masked row cannot be opened.
 */
export function maskKey(taskId: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "nexus-calendar"
  return `x_${createHmac("sha256", secret).update(`calendar-mask:${taskId}`).digest("base64url").slice(0, 16)}`
}

export function itemContext(caller: Extract<CalendarCaller, { kind: "ok" }>, s: LoadedStructure, projectUnitOf: Map<string, { unitId: string }>): ItemContext {
  return {
    viewer: caller.viewer, settings: caller.settings, homeUnitsOf: s.homeUnitsOf, unitRank: s.unitRank, maskKey,
    projectUnitOf: new Map([...projectUnitOf].map(([id, v]) => [id, v.unitId])),
  }
}

/** The items of these rows for this caller: one query for the project divisions, the rest in memory. */
export async function buildCalendarItems(rows: TaskRow[], caller: Extract<CalendarCaller, { kind: "ok" }>, s: LoadedStructure): Promise<CalItem[]> {
  return buildItems(rows, itemContext(caller, s, await loadProjectUnits(s, caller.settings)))
}

/** Name and avatar of assignees who are not in the structure (former members, bots). */
export async function extraPeople(items: CalItem[], s: LoadedStructure): Promise<Record<string, { name: string | null; avatar: string | null }>> {
  const known = new Set(s.people.map((p) => p.userId))
  const missing = Array.from(new Set(items.flatMap((i) => i.assigneeIds))).filter((id) => !known.has(id))
  if (missing.length === 0) return {}
  const users = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, avatar: true } })
  return Object.fromEntries(users.map((u) => [u.id, { name: u.name, avatar: u.avatar }]))
}

/** Tanggal merah of the company workspace within [from, to] (WIB days). Stored at UTC midnight of the day. */
export async function holidaysBetween(from: string, to: string): Promise<{ day: string; name: string }[]> {
  const rows = await prisma.holiday.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID, date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
    select: { date: true, name: true },
    orderBy: { date: "asc" },
  })
  return rows.map((h) => ({ day: h.date.toISOString().slice(0, 10), name: h.name }))
}

// ── Responses ──────────────────────────────────────────────────────────────────────────────────────

/**
 * JSON with an ETag over everything but `now` (which changes every call), so a poll that finds nothing
 * new costs a 304. `private, no-cache`: always revalidated, never shared.
 */
export function calendarJson(req: NextRequest, body: Record<string, unknown>): NextResponse {
  const { now: _now, ...stable } = body
  const etag = `"${createHash("sha1").update(JSON.stringify(stable)).digest("base64url").slice(0, 27)}"`
  const headers = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie, Authorization" }
  const inm = req.headers.get("if-none-match")
  if (inm && inm.split(",").map((s) => s.trim().replace(/^W\//, "")).includes(etag)) {
    return new NextResponse(null, { status: 304, headers })
  }
  return NextResponse.json(body, { headers })
}

export function rulesOf(settings: CalendarSettings) {
  return { overdueWindowDays: settings.overdueWindowDays, urgentDays: settings.urgentDays }
}
