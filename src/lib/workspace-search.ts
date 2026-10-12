import prisma from "@/lib/prisma"
import { hasProjectWideAccess } from "@/lib/rbac"
import { visibleConversationIdsOf } from "@/lib/chat-access"

/**
 * Workspace Q&A search (owner, 12 Oct 2026 — GIDEON like Notion AI: "ask anything across everything you can
 * access, with cited sources"). One query over projects, tasks, docs, task comments, forms and chat messages,
 * with exactly the visibility of the person asking — the same rules as the ⌘K search (/api/search):
 *   - projects: every project of a workspace where they are Manager / BoD / One Above All (system admin: all
 *     their workspaces), otherwise projects they are a member of;
 *   - tasks: in those projects, plus tasks assigned to or created by them;
 *   - docs, forms, comments: through the project / task they belong to;
 *   - chat: only rooms they can open (chat-access visibleConversationIdsOf).
 * Attendance is not searched, ever (GIDEON never reads attendance).
 *
 * A question is not a keyword: it is split into words (stop words in EN/ID dropped), any word may match,
 * and hits are ranked by how many words they contain (title hits count double) and then by recency.
 */

export type SearchHitKind = "project" | "task" | "doc" | "comment" | "form" | "message"
export type SearchHit = {
  kind: SearchHitKind
  id: string
  title: string
  excerpt: string
  url: string
  projectId?: string | null
  projectName?: string | null
  /** For a comment: the task it is on. For a message: the conversation. */
  parentId?: string | null
  at: string
  score: number
}

const STOP = new Set([
  // EN
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "what", "whats", "which", "who", "whom", "how",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "have", "has", "had", "i", "me", "my", "we", "our",
  "you", "your", "it", "its", "this", "that", "these", "those", "there", "about", "from", "at", "by", "as", "any",
  "all", "can", "could", "should", "would", "will", "please", "tell", "show", "find", "give", "list", "summarize",
  "summarise", "anything", "everything", "where", "when", "why", "status", "latest", "last", "so", "far", "up",
  // ID
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "dengan", "apa", "apakah", "siapa", "bagaimana", "gimana",
  "kapan", "mana", "ini", "itu", "ada", "adalah", "saya", "aku", "gw", "gue", "lo", "kamu", "kita", "kami", "tolong",
  "coba", "dong", "sih", "nya", "juga", "sudah", "udah", "belum", "akan", "bisa", "tentang", "soal", "semua", "cari",
  "carikan", "kasih", "tahu", "tau", "jelaskan", "ringkas", "rangkum", "terbaru", "terakhir", "sampai", "sekarang",
])

/** The words of a question worth searching for (max 8, longest first). */
export function searchTerms(query: string): string[] {
  const words = (query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.@#]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-_.]+|[-_.]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w))
  const unique = [...new Set(words)]
  unique.sort((a, b) => b.length - a.length)
  const out = unique.slice(0, 8)
  // A query that is all stop words / very short: search it as typed.
  if (!out.length && query.trim().length >= 2) return [query.trim().toLowerCase().slice(0, 80)]
  return out
}

function scoreOf(terms: string[], title: string, body: string): number {
  const t = title.toLowerCase()
  const b = body.toLowerCase()
  let s = 0
  for (const w of terms) {
    if (t.includes(w)) s += 2
    else if (b.includes(w)) s += 1
  }
  return s
}

/** ~220 characters of `text` around the first term it contains. */
function excerptOf(text: string, terms: string[], max = 220): string {
  const flat = (text || "").replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const lower = flat.toLowerCase()
  let at = -1
  for (const w of terms) {
    const i = lower.indexOf(w)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - 60)
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + max)}${start + max < flat.length ? "…" : ""}`
}

/** The person's visibility, built once per search. */
export async function visibilityOf(userId: string) {
  const [memberships, user] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  const wsIds = memberships.map((m) => m.workspaceId)
  const fullWs = user?.role === "ADMIN" ? wsIds : memberships.filter((m) => hasProjectWideAccess(m.role)).map((m) => m.workspaceId)
  const visibleProject = {
    workspaceId: { in: wsIds.length ? wsIds : ["__none__"] },
    OR: [{ workspaceId: { in: fullWs.length ? fullWs : ["__none__"] } }, { members: { some: { userId } } }],
  }
  const visibleTask = {
    OR: [
      { taskList: { project: visibleProject } },
      { taskProjects: { some: { project: visibleProject } } },
      { assignees: { some: { userId } } },
      { creatorId: userId },
    ],
  }
  return { wsIds, visibleProject, visibleTask }
}

export type SearchOptions = {
  kinds?: SearchHitKind[]
  projectId?: string | null
  limit?: number
}

const ALL_KINDS: SearchHitKind[] = ["project", "task", "doc", "comment", "form", "message"]

export async function searchWorkspace(userId: string, query: string, opts: SearchOptions = {}): Promise<{ terms: string[]; hits: SearchHit[] }> {
  const terms = searchTerms(query)
  if (!terms.length) return { terms, hits: [] }
  const kinds = new Set(opts.kinds?.length ? opts.kinds : ALL_KINDS)
  const limit = Math.max(1, Math.min(40, opts.limit ?? 12))
  const per = 25
  const { wsIds, visibleProject, visibleTask } = await visibilityOf(userId)
  if (!wsIds.length) return { terms, hits: [] }
  const pid = opts.projectId || null
  const anyOf = (fields: string[]) => ({
    OR: terms.flatMap((w) => fields.map((f) => ({ [f]: { contains: w, mode: "insensitive" as const } }))),
  })

  const hits: SearchHit[] = []
  const jobs: Promise<void>[] = []

  if (kinds.has("project")) jobs.push((async () => {
    const rows = await prisma.project.findMany({
      where: { AND: [visibleProject, anyOf(["name", "description"]), ...(pid ? [{ id: pid }] : [])] },
      select: { id: true, name: true, description: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: per,
    })
    for (const p of rows) hits.push({ kind: "project", id: p.id, title: p.name, excerpt: excerptOf(p.description ?? "", terms), url: `/projects/${p.id}`, projectId: p.id, projectName: p.name, at: p.updatedAt.toISOString(), score: scoreOf(terms, p.name, p.description ?? "") })
  })())

  if (kinds.has("task")) jobs.push((async () => {
    const rows = await prisma.task.findMany({
      where: { AND: [visibleTask, anyOf(["title", "description"]), ...(pid ? [{ taskList: { projectId: pid } }] : [])] },
      select: { id: true, title: true, description: true, status: true, dueDate: true, updatedAt: true, taskList: { select: { projectId: true, project: { select: { name: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: per * 2,
    })
    for (const t of rows) {
      const meta = [t.status, t.dueDate ? `due ${t.dueDate.toISOString().slice(0, 10)}` : null].filter(Boolean).join(" · ")
      hits.push({ kind: "task", id: t.id, title: t.title, excerpt: [meta, excerptOf(t.description ?? "", terms, 180)].filter(Boolean).join(" — "), url: `/tasks/${t.id}`, projectId: t.taskList?.projectId ?? null, projectName: t.taskList?.project?.name ?? null, at: t.updatedAt.toISOString(), score: scoreOf(terms, t.title, t.description ?? "") })
    }
  })())

  if (kinds.has("doc")) jobs.push((async () => {
    const rows = await prisma.doc.findMany({
      where: { AND: [{ project: visibleProject }, anyOf(["title", "contentText"]), ...(pid ? [{ projectId: pid }] : [])] },
      select: { id: true, title: true, contentText: true, updatedAt: true, projectId: true, project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: per,
    })
    for (const d of rows) hits.push({ kind: "doc", id: d.id, title: d.title || "Untitled", excerpt: excerptOf(d.contentText ?? "", terms), url: `/docs/${d.id}`, projectId: d.projectId, projectName: d.project?.name ?? null, at: d.updatedAt.toISOString(), score: scoreOf(terms, d.title ?? "", d.contentText ?? "") })
  })())

  if (kinds.has("comment")) jobs.push((async () => {
    const rows = await prisma.comment.findMany({
      where: { AND: [{ task: visibleTask }, anyOf(["content"]), ...(pid ? [{ task: { taskList: { projectId: pid } } }] : [])] },
      select: { id: true, content: true, createdAt: true, user: { select: { name: true } }, task: { select: { id: true, title: true, taskList: { select: { projectId: true, project: { select: { name: true } } } } } } },
      orderBy: { createdAt: "desc" },
      take: per,
    })
    for (const c of rows) {
      if (!c.task) continue
      hits.push({ kind: "comment", id: c.id, title: `${c.user?.name ?? "?"} on “${c.task.title}”`, excerpt: excerptOf(c.content, terms), url: `/tasks/${c.task.id}`, parentId: c.task.id, projectId: c.task.taskList?.projectId ?? null, projectName: c.task.taskList?.project?.name ?? null, at: c.createdAt.toISOString(), score: scoreOf(terms, "", c.content) })
    }
  })())

  if (kinds.has("form")) jobs.push((async () => {
    const rows = await prisma.form.findMany({
      where: { AND: [{ project: visibleProject }, anyOf(["name", "description"]), ...(pid ? [{ projectId: pid }] : [])] },
      select: { id: true, name: true, description: true, updatedAt: true, projectId: true, project: { select: { name: true } }, _count: { select: { submissions: true } } },
      orderBy: { updatedAt: "desc" },
      take: per,
    })
    for (const f of rows) hits.push({ kind: "form", id: f.id, title: f.name, excerpt: [`${f._count.submissions} submissions`, excerptOf(f.description ?? "", terms, 160)].filter(Boolean).join(" — "), url: `/projects/${f.projectId}?tab=forms`, projectId: f.projectId, projectName: f.project?.name ?? null, at: f.updatedAt.toISOString(), score: scoreOf(terms, f.name, f.description ?? "") })
  })())

  if (kinds.has("message")) jobs.push((async () => {
    const roomIds = await visibleConversationIdsOf(userId).catch(() => [] as string[])
    if (!roomIds.length) return
    const rows = await prisma.message.findMany({
      where: { AND: [{ conversationId: { in: roomIds } }, { kind: "USER" }, anyOf(["content"]), ...(pid ? [{ conversation: { projectId: pid } }] : [])] },
      select: { id: true, content: true, createdAt: true, conversationId: true, user: { select: { name: true } }, conversation: { select: { name: true, type: true, projectId: true, project: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: per,
    })
    for (const m of rows) {
      const room = m.conversation?.project?.name ?? m.conversation?.name ?? (m.conversation?.type === "DM" ? "Direct message" : "Chat")
      hits.push({ kind: "message", id: m.id, title: `${m.user?.name ?? "?"} in ${room}`, excerpt: excerptOf(m.content, terms), url: `/messages/${m.conversationId}`, parentId: m.conversationId, projectId: m.conversation?.projectId ?? null, projectName: m.conversation?.project?.name ?? null, at: m.createdAt.toISOString(), score: scoreOf(terms, "", m.content) })
    }
  })())

  await Promise.all(jobs)
  // More matched words first; among equals the newer first; never more than `limit`, and no kind may take
  // every slot (a busy chat must not drown the one doc that answers the question).
  hits.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
  const out: SearchHit[] = []
  const perKind = new Map<string, number>()
  const cap = Math.max(3, Math.ceil(limit / 2))
  for (const h of hits) {
    if (out.length >= limit) break
    const n = perKind.get(h.kind) ?? 0
    if (n >= cap) continue
    perKind.set(h.kind, n + 1)
    out.push(h)
  }
  return { terms, hits: out }
}
