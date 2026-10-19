import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { hasProjectWideAccess, memberAccessLevel } from "@/lib/rbac"
import { wibDay } from "@/lib/calendar/core"

/**
 * GIDEON nexus_list_docs (19 Oct 2026): the pages (docs) of the projects the asker can open, newest first, filtered by
 * date (WIB), project and title — so "summarise this week's daily updates of every Master IP" or "which IP has not
 * posted today" can be answered from a LIST, which a text search cannot give. Read only.
 *
 * Access is the docs API's own rule (lib/rbac.ts projectAccessLevel, which GET /api/docs/[id] asks through
 * canReadProjectContent): a member of the project's workspace who is One Above All / BoD there (every project), or a
 * member of the project itself at any level. Nobody else sees a project or its pages; a private project stays
 * private. Only a short excerpt of each page is returned — the model reads a page with nexus_get_doc.
 */

export const LIST_DOCS_DEFAULT = 20
export const LIST_DOCS_MAX = 50
const EXCERPT = 200
const PROJECTS_MAX = 50
const WIB_OFFSET_MS = 7 * 3_600_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

type Input = Record<string, unknown>
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * A WIB date or time → the instant. "2026-10-19" = 00:00 WIB that day; a date-time without an offset is WIB; one with
 * "Z" or "+07:00" is taken as written. Anything else is refused (never silently ignored: a wrong window is a wrong answer).
 */
export function parseWibInstant(value: unknown, name: string): Date | undefined {
  const s = str(value)
  if (!s) return undefined
  let d: Date
  if (DAY_RE.test(s)) d = new Date(Date.parse(`${s}T00:00:00Z`) - WIB_OFFSET_MS)
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) d = new Date(Date.parse(`${s.replace(" ", "T")}Z`) - WIB_OFFSET_MS)
  else d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be a date like 2026-10-19 (WIB) or an ISO date-time; got "${s}".`)
  return d
}

/** The ids (and names) of every project this person can open, by the docs API's rule. */
export async function readableProjects(userId: string, nameQuery?: string): Promise<{ id: string; name: string }[]> {
  const [workspaces, memberships] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true } }),
    prisma.projectMember.findMany({ where: { userId }, select: { projectId: true, role: true, accessLevel: true } }),
  ])
  const allWs = workspaces.map((w) => w.workspaceId)
  if (!allWs.length) return []
  const wideWs = workspaces.filter((w) => hasProjectWideAccess(w.role)).map((w) => w.workspaceId)
  const memberIds = memberships.filter((m) => memberAccessLevel(m)).map((m) => m.projectId)
  const or: Prisma.ProjectWhereInput[] = []
  if (wideWs.length) or.push({ workspaceId: { in: wideWs } })
  // A project member counts only while they are still in the project's workspace (projectAccessLevel's rule).
  if (memberIds.length) or.push({ id: { in: memberIds }, workspaceId: { in: allWs } })
  if (!or.length) return []
  return prisma.project.findMany({
    where: { OR: or, ...(nameQuery ? { name: { contains: nameQuery, mode: "insensitive" } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

function excerptOf(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1).trimEnd()}…` : flat
}

export async function listDocs(userId: string, rawInput: Input, publicBase: string) {
  const input = rawInput ?? {}
  const projectId = str(input.projectId)
  const projectQuery = str(input.projectQuery) ?? str(input.project) ?? str(input.projectName)
  const titleQuery = str(input.titleQuery) ?? str(input.title) ?? str(input.query)
  const since = parseWibInstant(input.updatedSince ?? input.since ?? input.from, "updatedSince")
  const before = parseWibInstant(input.updatedBefore ?? input.before ?? input.to, "updatedBefore")
  const sortCreated = str(input.sort) === "created"
  const limitRaw = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.floor(input.limit) : LIST_DOCS_DEFAULT
  const limit = Math.max(1, Math.min(LIST_DOCS_MAX, limitRaw))
  const offset = typeof input.offset === "number" && Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset)) : 0

  let projects = await readableProjects(userId, projectId ? undefined : projectQuery)
  if (projectId) {
    projects = projects.filter((p) => p.id === projectId)
    // Not found and not allowed read the same: a private project's existence is not told.
    if (!projects.length) throw new Error("No project with that id that this person can open. Find it with nexus_list_projects.")
  } else if (projectQuery && !projects.length) {
    return { today: wibDay(new Date()), total: 0, shown: 0, items: [], note: `No project this person can open is named like "${projectQuery}". Say so; do not guess.` }
  }
  const ids = projects.map((p) => p.id)
  if (!ids.length) return { today: wibDay(new Date()), total: 0, shown: 0, items: [], note: "This person cannot open any project, so there are no pages to list." }

  const dateField = sortCreated ? "createdAt" : "updatedAt"
  const range: Prisma.DateTimeFilter = {}
  if (since) range.gte = since
  if (before) range.lt = before
  const where: Prisma.DocWhereInput = {
    projectId: { in: ids },
    ...(since || before ? { [dateField]: range } : {}),
    ...(titleQuery ? { title: { contains: titleQuery, mode: "insensitive" } } : {}),
  }

  const [total, docs] = await Promise.all([
    prisma.doc.count({ where }),
    prisma.doc.findMany({
      where,
      orderBy: [{ [dateField]: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      select: {
        id: true, title: true, projectId: true, createdAt: true, updatedAt: true, contentText: true,
        author: { select: { name: true } },
      },
    }),
  ])

  // Last editor: the newest "update" audit row of each page (one per save / editing session); else its author.
  const edits = docs.length
    ? await prisma.auditLog.findMany({
        where: { entityType: "doc", action: "update", entityId: { in: docs.map((d) => d.id) } },
        orderBy: { createdAt: "desc" },
        distinct: ["entityId"],
        select: { entityId: true, user: { select: { name: true } } },
      })
    : []
  const editorOf = new Map(edits.map((e) => [e.entityId, e.user?.name ?? null]))
  const nameOf = new Map(projects.map((p) => [p.id, p.name]))

  const items = docs.map((d) => ({
    id: d.id,
    title: d.title,
    project: { id: d.projectId, name: nameOf.get(d.projectId) ?? null },
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdDay: wibDay(d.createdAt),
    updatedDay: wibDay(d.updatedAt),
    author: d.author?.name ?? null,
    lastEditedBy: editorOf.get(d.id) ?? d.author?.name ?? null,
    excerpt: excerptOf(d.contentText),
    url: `${publicBase}/docs/${d.id}`,
  }))

  // With a project name filter (e.g. every "Master IP"): each matching project with its page count in the window, so
  // "which IP has not posted today" sees the projects with 0 too, not only those that appear in the page list.
  let byProject: { id: string; name: string; pages: number; latest: Date | null }[] | undefined
  if (projectQuery && !projectId) {
    const groups = await prisma.doc.groupBy({
      by: ["projectId"],
      where,
      _count: { _all: true },
      _max: { [dateField]: true },
    })
    const g = new Map(groups.map((r) => [r.projectId, r]))
    byProject = projects.slice(0, PROJECTS_MAX).map((p) => {
      const row = g.get(p.id) as { _count?: { _all?: number }; _max?: Record<string, Date | null> } | undefined
      return { id: p.id, name: p.name, pages: row?._count?._all ?? 0, latest: row?._max?.[dateField] ?? null }
    })
  }

  const shown = items.length
  const rest = Math.max(0, total - offset - shown)
  return {
    today: wibDay(new Date()),
    window: {
      field: dateField,
      ...(since ? { from: since.toISOString(), fromDay: wibDay(since) } : {}),
      ...(before ? { before: before.toISOString() } : {}),
    },
    total,
    shown,
    ...(offset ? { offset } : {}),
    items,
    ...(byProject ? { projects: byProject.map((p) => ({ ...p, latestDay: p.latest ? wibDay(p.latest) : null })), projectsMatched: projects.length } : {}),
    ...(rest ? { more: `${rest} more not shown — call again with offset=${offset + shown}${limit < LIST_DOCS_MAX ? ` (or limit up to ${LIST_DOCS_MAX})` : ""}, or narrow the dates / project.` } : {}),
    note: shown
      ? "Only these pages exist for this person in this window. Read the ones you summarise with nexus_get_doc; cite each by its exact title and date."
      : "No page this person can open matches. Say so; do not guess.",
  }
}
