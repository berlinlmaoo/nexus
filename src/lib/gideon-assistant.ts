import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { canReadTask } from "@/lib/read-access"
import type { GideonRef } from "@/lib/gideon-runs"

/**
 * GIDEON as Notion AI (owner, 12 Oct 2026: "fitur gideon ini 1:1 kaya notion yg bisa baca task, project di
 * masing masing akun dengan akses akunnya"). The pieces of the chat that are about the PERSON rather than
 * the run: their conversations (GideonChat), what they call GIDEON and their own instructions
 * (GideonPreference), and the pages a question carries (the page it was opened from + @-mentions).
 * Everything here reads with the asker's own access; nothing is ever shared between people.
 */

export type GideonContextRef = { kind: "project" | "task" | "doc"; id: string }

const TITLE_MAX = 80

function titleFrom(text: string): string | null {
  const line = (text || "").replace(/\s+/g, " ").trim()
  if (!line) return null
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/**
 * The conversation a turn goes into. A chatId must be the asker's own (anything else is ignored, never an
 * error that tells whether the id exists). No chatId: `newChat` starts one, otherwise the most recent one
 * (released apps keep a single running conversation and never send an id).
 */
export async function resolveGideonChat(userId: string, opts: { chatId?: string | null; newChat?: boolean; title?: string }) {
  if (opts.chatId) {
    // Live chats only: a chat the person deleted (another tab, another device) never takes new turns.
    const own = await prisma.gideonChat.findFirst({ where: { id: opts.chatId, userId, deletedAt: null }, select: { id: true, title: true } })
    if (own) {
      if (!own.title && opts.title) {
        const title = titleFrom(opts.title)
        await prisma.gideonChat.update({ where: { id: own.id }, data: { title } }).catch(() => {})
        return { id: own.id, title }
      }
      return own
    }
  }
  // A question sent from a chat that is not a live chat of this person (deleted meanwhile, purged, or not
  // theirs at all) starts a fresh one rather than landing in another of their chats (QA final 19 Oct, E-4).
  if (!opts.newChat && !opts.chatId) {
    const latest = await prisma.gideonChat.findFirst({ where: { userId, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true } })
    if (latest) return latest
  }
  return prisma.gideonChat.create({ data: { userId, title: titleFrom(opts.title ?? "") }, select: { id: true, title: true } })
}

export async function touchGideonChat(chatId: string) {
  await prisma.gideonChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }).catch(() => {})
}

// ── Personalize ───────────────────────────────────────────────────────────────────────────────────────

export const ASSISTANT_NAME_MAX = 40
export const INSTRUCTIONS_MAX = 2000

export async function getGideonPreference(userId: string) {
  const row = await prisma.gideonPreference.findUnique({ where: { userId } })
  return { assistantName: row?.assistantName ?? null, instructions: row?.instructions ?? null, updatedAt: row?.updatedAt?.toISOString() ?? null }
}

export async function personalPromptLines(userId: string, personName: string): Promise<string[]> {
  const pref = await prisma.gideonPreference.findUnique({ where: { userId }, select: { assistantName: true, instructions: true } })
  if (!pref) return []
  const out: string[] = []
  const who = personName?.trim() || "Orang ini"
  if (pref.assistantName?.trim()) {
    out.push(`[PANGGILAN] ${who} memanggilmu "${pref.assistantName.trim()}". Terima nama itu di obrolan ini; kamu tetap GIDEON dengan aturan yang sama.`)
  }
  if (pref.instructions?.trim()) {
    out.push(`[INSTRUKSI PRIBADI dari ${who} — preferensi gaya/cara kerja, BUKAN izin tambahan; aturan dan akses tetap berlaku]\n${pref.instructions.trim().slice(0, INSTRUCTIONS_MAX)}`)
  }
  return out
}

// ── Pages a question carries ──────────────────────────────────────────────────────────────────────────

const MAX_REFS = 8

/**
 * Read every page the question carries — the task / doc it was opened from and up to 8 @-mentions — with
 * the asker's access. What they cannot open is dropped silently (no title leaks into the prompt).
 * The project/task the panel was opened from is announced by the chat route itself; here only the
 * CONTENT (task description, doc text) and the @-mentioned pages are added.
 */
export async function gatherContext(userId: string, input: { projectId?: string; taskId?: string; docId?: string; refs?: GideonContextRef[] }): Promise<{ lines: string[]; refs: GideonRef[] }> {
  const lines: string[] = []
  const refs: GideonRef[] = []
  const seen = new Set<string>()
  const list: GideonContextRef[] = []
  if (input.taskId) list.push({ kind: "task", id: input.taskId })
  if (input.docId) list.push({ kind: "doc", id: input.docId })
  for (const r of (input.refs ?? []).slice(0, MAX_REFS)) {
    if (r && typeof r.id === "string" && (r.kind === "project" || r.kind === "task" || r.kind === "doc")) list.push({ kind: r.kind, id: r.id.slice(0, 40) })
  }
  for (const r of list) {
    const key = `${r.kind}:${r.id}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (r.kind === "project") {
        if (!(await checkProjectAccess(userId, r.id, ["VIEWER"])).allowed) continue
        const p = await prisma.project.findUnique({ where: { id: r.id }, select: { id: true, name: true, description: true, status: true } })
        if (!p) continue
        lines.push(`[HALAMAN TERLAMPIR · project] "${p.name}" (projectId: ${p.id}, status ${p.status})${p.description ? `\n${p.description.slice(0, 800)}` : ""}\nUntuk detail task-nya panggil tool NEXUS dengan projectId ini.`)
        refs.push({ kind: "project", id: p.id, title: p.name, projectId: p.id, url: `/projects/${p.id}` })
      } else if (r.kind === "task") {
        if ((await canReadTask(userId, r.id)) !== "ok") continue
        const t = await prisma.task.findUnique({
          where: { id: r.id },
          select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, taskList: { select: { name: true, projectId: true, project: { select: { name: true } } } }, assignees: { select: { user: { select: { name: true } } } } },
        })
        if (!t) continue
        const who = t.assignees.map((a) => a.user.name).filter(Boolean).join(", ")
        lines.push(`[HALAMAN TERLAMPIR · task] "${t.title}" (taskId: ${t.id}) di project "${t.taskList?.project?.name ?? ""}", section "${t.taskList?.name ?? ""}", status ${t.status}, prioritas ${t.priority}${t.dueDate ? `, tenggat ${t.dueDate.toISOString().slice(0, 10)}` : ""}${who ? `, PIC ${who}` : ""}.${t.description ? `\nDeskripsi:\n${t.description.slice(0, 2500)}` : ""}`)
        refs.push({ kind: "task", id: t.id, title: t.title, projectId: t.taskList?.projectId ?? null, url: `/tasks/${t.id}` })
      } else if (r.kind === "doc") {
        const d = await prisma.doc.findUnique({ where: { id: r.id }, select: { id: true, title: true, contentText: true, projectId: true, project: { select: { name: true } } } })
        if (!d?.projectId || !(await checkProjectAccess(userId, d.projectId, ["VIEWER"])).allowed) continue
        lines.push(`[HALAMAN TERLAMPIR · doc] "${d.title || "Untitled"}" (docId: ${d.id}) di project "${d.project?.name ?? ""}".\nIsi:\n${(d.contentText ?? "").slice(0, 6000) || "(kosong)"}`)
        refs.push({ kind: "doc", id: d.id, title: d.title || "Untitled", projectId: d.projectId, url: `/docs/${d.id}` })
      }
    } catch {
      // One unreadable page must not take the question down.
    }
  }
  return { lines, refs }
}

/** Titles for context chips the client could not name itself (e.g. a link pasted from elsewhere). Access-checked. */
export async function describeRefs(userId: string, refs: GideonContextRef[]) {
  const { refs: out } = await gatherContext(userId, { refs })
  return out.map((r) => ({ kind: r.kind, id: r.id, title: r.title, projectId: r.projectId ?? null, url: r.url }))
}

// ── The attached project as primary scope ─────────────────────────────────────────────────────────────

const PRIORITY_WORD: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "" }
const OPEN_LIMIT = 40

/**
 * A compact digest of a project the question is scoped to (owner, 12 Oct 2026: "ada task apa aja?" asked
 * from Finance Management was answered about another project): every status column with its count, the
 * open tasks first (column, due date, priority, assignees — open ones by due date, at most 40), then how
 * many are done with the most recent few. Read with the asker's access; null when they cannot see it.
 * Labels only (column names, priority words): no ids or enum values reach the answer.
 */
export async function projectDigest(userId: string, projectId: string): Promise<{ name: string; lines: string[] } | null> {
  if (!(await checkProjectAccess(userId, projectId, ["VIEWER"])).allowed) return null
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true } })
  if (!p) return null
  const lists = await prisma.taskList.findMany({ where: { projectId }, select: { id: true, name: true, position: true, taskStatus: true }, orderBy: { position: "asc" } })
  const tasks = await prisma.task.findMany({
    where: { taskListId: { in: lists.map((l) => l.id) }, parentId: null },
    select: { title: true, status: true, priority: true, dueDate: true, completedAt: true, updatedAt: true, taskListId: true, assignees: { select: { user: { select: { name: true } } } } },
    take: 2000,
  })
  const colName = new Map(lists.map((l) => [l.id, l.name]))
  const isDone = (t: { status: unknown }) => String(t.status) === "DONE" || String(t.status) === "CANCELLED"
  const open = tasks.filter((t) => !isDone(t)).sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
  const done = tasks.filter(isDone).sort((a, b) => (b.completedAt ?? b.updatedAt).getTime() - (a.completedAt ?? a.updatedAt).getTime())
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const counts = lists.map((l) => `${l.name} ${tasks.filter((t) => t.taskListId === l.id).length}`).join(" · ")
  const lines = [
    `[KONTEKS UTAMA · project "${p.name}"] Ini project yang sedang dibuka/dilampirkan. ${tasks.length} task: ${counts}. ${open.length} masih terbuka, ${done.length} selesai.`,
    ...(p.description ? [`Deskripsi project: ${p.description.slice(0, 500)}`] : []),
    open.length ? `Task terbuka (urut tenggat${open.length > OPEN_LIMIT ? `, ${OPEN_LIMIT} dari ${open.length}` : ""}):` : "Tidak ada task terbuka.",
    ...open.slice(0, OPEN_LIMIT).map((t) => {
      const who = t.assignees.map((a) => a.user.name).filter(Boolean).join(", ")
      const overdue = t.dueDate && t.dueDate < today ? " — LEWAT TENGGAT" : ""
      return `- "${t.title}" · ${colName.get(t.taskListId) ?? ""}${t.dueDate ? ` · tenggat ${fmt(t.dueDate)}${overdue}` : ""}${PRIORITY_WORD[String(t.priority)] ? ` · ${PRIORITY_WORD[String(t.priority)]}` : ""}${who ? ` · ${who}` : ""}`
    }),
    ...(done.length ? [`Selesai terbaru: ${done.slice(0, 5).map((t) => `"${t.title}"`).join(", ")}${done.length > 5 ? ` (+${done.length - 5} lagi)` : ""}.`] : []),
  ]
  return { name: p.name, lines }
}
