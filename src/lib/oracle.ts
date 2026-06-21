// NEXUS Oracle — natural-language (Indonesian) query brain for the One-Above-All voice dashboard.
// A deterministic parser maps a spoken question to an intent + entities, runs a Prisma query, and
// returns nodes shaped for the radial-orbital UI (each node = a task / project / person dot).
// Because the Oracle page is One-Above-All only (sees the whole org), queries are NOT actor-scoped.
import prisma from "@/lib/prisma"
import { TaskStatus } from "@/generated/prisma"

export type OracleNodeKind = "task" | "project" | "person"
export type OracleStatus = "completed" | "in-progress" | "pending"

export interface OracleNode {
  id: string
  kind: OracleNodeKind
  title: string
  subtitle?: string
  status: OracleStatus
  energy: number // 0..100 — drives the orbital glow size
  date?: string // human, e.g. "10 Jun"
  detail?: string
  href?: string // deep link into NEXUS
  meta?: Record<string, string | number | null>
}

export interface OracleResult {
  intent: string
  answer: string // short text summary (also spoken via TTS on the client)
  subject: string // center-label of the orbital view
  nodes: OracleNode[]
  truncated?: number // how many results were dropped past the cap
  needsLlm?: boolean // parser couldn't classify — caller may try the LLM fallback
  usedLlm?: boolean // this result came from the Codex LLM fallback
}

// Structured intent produced either by the deterministic parser or the Codex LLM fallback.
export type ParsedIntent = {
  intent: "tasks_by_person" | "tasks_by_project" | "overdue" | "due_today" | "busiest" | "project_summary" | "list_projects" | "search" | string
  person?: string
  project?: string
  query?: string
}

const NODE_CAP = 12
const NOT_DONE = { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] }

function statusBucket(s: TaskStatus): OracleStatus {
  if (s === "DONE") return "completed"
  if (s === "IN_PROGRESS" || s === "IN_REVIEW") return "in-progress"
  return "pending"
}
const PRIORITY_ENERGY: Record<string, number> = { URGENT: 100, HIGH: 80, MEDIUM: 60, LOW: 40, NONE: 25 }

function fmtDay(d: Date | null | undefined): string | undefined {
  if (!d) return undefined
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
}
function todayRangeWIB(): { start: Date; end: Date } {
  const wib = new Date(Date.now() + 7 * 3600 * 1000)
  const startUTC = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7 * 3600 * 1000
  return { start: new Date(startUTC), end: new Date(startUTC + 24 * 3600 * 1000) }
}

const TASK_INCLUDE = {
  assignees: { select: { user: { select: { id: true, name: true } } } },
  taskList: { select: { name: true, project: { select: { id: true, name: true } } } },
} as const

type TaskRow = {
  id: string; title: string; status: TaskStatus; priority: string; dueDate: Date | null
  assignees: { user: { id: string; name: string } }[]
  taskList: { name: string; project: { id: string; name: string } | null } | null
}

function taskNode(t: TaskRow): OracleNode {
  const project = t.taskList?.project
  const who = t.assignees.map((a) => a.user.name.split(" ")[0]).slice(0, 3).join(", ")
  return {
    id: t.id,
    kind: "task",
    title: t.title,
    subtitle: project?.name ?? t.taskList?.name ?? "—",
    status: statusBucket(t.status),
    energy: PRIORITY_ENERGY[t.priority] ?? 50,
    date: fmtDay(t.dueDate),
    detail: [
      `Status: ${t.status.replace("_", " ")}`,
      `Prioritas: ${t.priority}`,
      project ? `Project: ${project.name}` : null,
      who ? `Assignee: ${who}` : "Belum ada assignee",
      t.dueDate ? `Due: ${fmtDay(t.dueDate)}` : "Tanpa due date",
    ].filter(Boolean).join("\n"),
    href: `/tasks/${t.id}`,
    meta: { priority: t.priority, project: project?.name ?? null },
  }
}

// ── Name resolution (fuzzy, best-match) ─────────────────────────────────────────
// Rank candidates: exact > startsWith > most-token-overlap > shortest name (closest).
function bestMatch<T extends { name: string }>(q: string, pool: T[]): T | null {
  if (!pool.length) return null
  const ql = q.toLowerCase().trim()
  const qTokens = ql.split(/\s+/).filter(Boolean)
  const exact = pool.find((p) => p.name.toLowerCase() === ql)
  if (exact) return exact
  const starts = pool.filter((p) => p.name.toLowerCase().startsWith(ql)).sort((a, b) => a.name.length - b.name.length)
  if (starts.length) return starts[0]
  const scored = pool.map((p) => {
    const nl = p.name.toLowerCase()
    const overlap = qTokens.filter((t) => nl.includes(t)).length
    return { p, overlap, len: p.name.length }
  }).sort((a, b) => b.overlap - a.overlap || a.len - b.len)
  return scored[0].p
}
async function resolveUser(name: string) {
  const n = name.trim()
  if (!n) return null
  let pool = await prisma.user.findMany({ where: { name: { contains: n, mode: "insensitive" } }, select: { id: true, name: true }, take: 12 })
  if (!pool.length) {
    const first = n.split(/\s+/)[0]
    if (first.length >= 3) pool = await prisma.user.findMany({ where: { name: { contains: first, mode: "insensitive" } }, select: { id: true, name: true }, take: 12 })
  }
  return bestMatch(n, pool)
}
async function resolveProject(name: string) {
  const n = name.trim()
  if (!n) return null
  let pool = await prisma.project.findMany({ where: { name: { contains: n, mode: "insensitive" } }, select: { id: true, name: true }, take: 12 })
  if (!pool.length) {
    const first = n.split(/\s+/)[0]
    if (first.length >= 3) pool = await prisma.project.findMany({ where: { name: { contains: first, mode: "insensitive" } }, select: { id: true, name: true }, take: 12 })
  }
  return bestMatch(n, pool)
}

// Strip filler words to isolate a person/project name from the spoken phrase.
const STOP = new Set([
  "task", "tasks", "tugas", "kerjaan", "kerjaannya", "pekerjaan", "punya", "milik", "ada", "apa", "aja", "saja",
  "yang", "si", "mas", "mbak", "pak", "bu", "kak", "bang", "dari", "untuk", "buat", "tolong", "tunjukin", "tunjukkan",
  "lihat", "liat", "cek", "semua", "list", "daftar", "detail", "dong", "ya", "nya", "ngerjain", "lagi", "sekarang",
  "gimana", "berapa", "siapa", "mana", "project", "proyek", "proyeknya", "di", "ke", "itu", "ini", "tasknya",
])
function extractName(q: string): string {
  return q.split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase().replace(/[^\w]/g, ""))).join(" ").trim()
}

// ── Query handlers ──────────────────────────────────────────────────────────────
async function tasksByPerson(user: { id: string; name: string }): Promise<OracleResult> {
  const tasks = (await prisma.task.findMany({
    where: { assignees: { some: { userId: user.id } }, status: NOT_DONE },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, ...TASK_INCLUDE },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "asc" }],
    take: NODE_CAP + 1,
  })) as TaskRow[]
  const truncated = Math.max(0, tasks.length - NODE_CAP)
  const shown = tasks.slice(0, NODE_CAP)
  const first = user.name.split(" ")[0]
  return {
    intent: "tasks_by_person",
    subject: first,
    answer: shown.length === 0
      ? `${user.name} lagi gak punya task aktif. 🎉`
      : `${user.name} punya ${tasks.length > NODE_CAP ? NODE_CAP + "+" : shown.length} task aktif${truncated ? ` (nampilin ${NODE_CAP} teratas)` : ""}.`,
    nodes: shown.map(taskNode),
    truncated: truncated || undefined,
  }
}

async function tasksByProject(project: { id: string; name: string }): Promise<OracleResult> {
  const tasks = (await prisma.task.findMany({
    where: { taskList: { projectId: project.id }, status: NOT_DONE },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, ...TASK_INCLUDE },
    orderBy: [{ priority: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    take: NODE_CAP + 1,
  })) as TaskRow[]
  const truncated = Math.max(0, tasks.length - NODE_CAP)
  const shown = tasks.slice(0, NODE_CAP)
  return {
    intent: "tasks_by_project",
    subject: project.name,
    answer: shown.length === 0
      ? `Project *${project.name}* gak punya task aktif.`
      : `Project *${project.name}* punya ${tasks.length > NODE_CAP ? NODE_CAP + "+" : shown.length} task aktif${truncated ? ` (nampilin ${NODE_CAP} teratas)` : ""}.`,
    nodes: shown.map(taskNode),
    truncated: truncated || undefined,
  }
}

async function overdueTasks(scope?: { user?: { id: string; name: string }; project?: { id: string; name: string } }): Promise<OracleResult> {
  const { start } = todayRangeWIB()
  const tasks = (await prisma.task.findMany({
    where: {
      status: NOT_DONE,
      dueDate: { lt: start },
      ...(scope?.user ? { assignees: { some: { userId: scope.user.id } } } : {}),
      ...(scope?.project ? { taskList: { projectId: scope.project.id } } : {}),
    },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, ...TASK_INCLUDE },
    orderBy: { dueDate: "asc" },
    take: NODE_CAP + 1,
  })) as TaskRow[]
  const truncated = Math.max(0, tasks.length - NODE_CAP)
  const shown = tasks.slice(0, NODE_CAP)
  const where = scope?.user ? ` ${scope.user.name.split(" ")[0]}` : scope?.project ? ` di ${scope.project.name}` : ""
  return {
    intent: "overdue",
    subject: "Overdue",
    answer: shown.length === 0 ? `Gak ada task overdue${where}. 🎉` : `Ada ${tasks.length > NODE_CAP ? NODE_CAP + "+" : shown.length} task overdue${where}.`,
    nodes: shown.map(taskNode),
    truncated: truncated || undefined,
  }
}

async function dueToday(): Promise<OracleResult> {
  const { start, end } = todayRangeWIB()
  const tasks = (await prisma.task.findMany({
    where: { status: NOT_DONE, dueDate: { gte: start, lt: end } },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, ...TASK_INCLUDE },
    orderBy: { priority: "asc" },
    take: NODE_CAP + 1,
  })) as TaskRow[]
  const truncated = Math.max(0, tasks.length - NODE_CAP)
  const shown = tasks.slice(0, NODE_CAP)
  return {
    intent: "due_today",
    subject: "Hari ini",
    answer: shown.length === 0 ? "Gak ada task yang due hari ini. 🎉" : `Ada ${tasks.length > NODE_CAP ? NODE_CAP + "+" : shown.length} task due hari ini.`,
    nodes: shown.map(taskNode),
    truncated: truncated || undefined,
  }
}

async function busiest(): Promise<OracleResult> {
  const grouped = await prisma.taskAssignee.groupBy({
    by: ["userId"],
    where: { task: { status: NOT_DONE } },
    _count: { userId: true },
    orderBy: { _count: { userId: "desc" } },
    take: NODE_CAP,
  })
  const users = await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } }, select: { id: true, name: true } })
  const nameById = new Map(users.map((u) => [u.id, u.name]))
  const max = grouped[0]?._count.userId || 1
  const nodes: OracleNode[] = grouped.map((g) => {
    const n = g._count.userId
    return {
      id: g.userId,
      kind: "person",
      title: nameById.get(g.userId) ?? "—",
      subtitle: `${n} task aktif`,
      status: n > max * 0.66 ? "in-progress" : "pending",
      energy: Math.round((n / max) * 100),
      detail: `${nameById.get(g.userId) ?? "—"} lagi pegang ${n} task aktif.`,
      meta: { openTasks: n },
    }
  })
  return {
    intent: "busiest",
    subject: "Workload",
    answer: nodes.length ? `${nodes[0].title} paling sibuk (${grouped[0]._count.userId} task aktif).` : "Belum ada task aktif buat dihitung.",
    nodes,
  }
}

async function listProjects(): Promise<OracleResult> {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, status: true, _count: { select: { taskLists: true } }, taskLists: { select: { _count: { select: { tasks: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: NODE_CAP + 1,
  })
  const truncated = Math.max(0, projects.length - NODE_CAP)
  const shown = projects.slice(0, NODE_CAP)
  const nodes: OracleNode[] = shown.map((p) => {
    const taskCount = p.taskLists.reduce((s, tl) => s + tl._count.tasks, 0)
    return {
      id: p.id, kind: "project", title: p.name, subtitle: `${taskCount} task`,
      status: p.status === "COMPLETED" ? "completed" : p.status === "ACTIVE" ? "in-progress" : "pending",
      energy: Math.min(100, 30 + taskCount * 4), date: undefined,
      detail: `Status: ${p.status}\nTotal task: ${taskCount}`, href: `/projects/${p.id}`,
    }
  })
  return {
    intent: "list_projects",
    subject: "Projects",
    answer: shown.length ? `Ada ${projects.length > NODE_CAP ? NODE_CAP + "+" : shown.length} project.` : "Belum ada project.",
    nodes,
    truncated: truncated || undefined,
  }
}

async function projectSummary(project: { id: string; name: string }): Promise<OracleResult> {
  const tasks = await prisma.task.findMany({ where: { taskList: { projectId: project.id } }, select: { status: true } })
  const total = tasks.length
  const done = tasks.filter((t) => t.status === "DONE").length
  const inProg = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW").length
  const todo = tasks.filter((t) => t.status === "TODO").length
  const pct = total ? Math.round((done / total) * 100) : 0
  const nodes: OracleNode[] = [
    { id: `${project.id}-done`, kind: "task", title: "Selesai", subtitle: `${done} task`, status: "completed", energy: total ? (done / total) * 100 : 0, detail: `${done} dari ${total} task selesai.` },
    { id: `${project.id}-prog`, kind: "task", title: "In progress", subtitle: `${inProg} task`, status: "in-progress", energy: total ? (inProg / total) * 100 : 0, detail: `${inProg} task lagi dikerjain.` },
    { id: `${project.id}-todo`, kind: "task", title: "To do", subtitle: `${todo} task`, status: "pending", energy: total ? (todo / total) * 100 : 0, detail: `${todo} task belum mulai.` },
  ]
  return {
    intent: "project_summary",
    subject: project.name,
    answer: `Project *${project.name}*: ${pct}% selesai (${done}/${total}). ${inProg} lagi jalan, ${todo} belum mulai.`,
    nodes,
  }
}

async function searchTasks(q: string): Promise<OracleResult> {
  const tasks = (await prisma.task.findMany({
    where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, ...TASK_INCLUDE },
    orderBy: { updatedAt: "desc" },
    take: NODE_CAP + 1,
  })) as TaskRow[]
  const truncated = Math.max(0, tasks.length - NODE_CAP)
  const shown = tasks.slice(0, NODE_CAP)
  return {
    intent: "search",
    subject: q.length > 18 ? q.slice(0, 18) + "…" : q,
    answer: shown.length ? `Nemu ${tasks.length > NODE_CAP ? NODE_CAP + "+" : shown.length} task yang cocok "${q}".` : `Gak nemu task yang cocok "${q}".`,
    nodes: shown.map(taskNode),
    truncated: truncated || undefined,
    needsLlm: shown.length === 0, // nothing matched → a smarter LLM pass might help
  }
}

// ── Main entry: deterministic interpretation ─────────────────────────────────────
const RE = {
  overdue: /\b(overdue|telat|telad|lewat|kelewat|nunggak|lewat deadline|lewat tenggat)\b/i,
  today: /\b(hari ini|due hari ini|deadline hari ini|sekarang due)\b/i,
  busiest: /\b(paling sibuk|paling banyak|workload|overload|sibuk banget|beban kerja)\b/i,
  listProjects: /\b(project apa aja|proyek apa aja|list project|daftar project|ada project apa|semua project)\b/i,
  summary: /\b(ringkasan|summary|progress|sejauh mana|seberapa jauh|persentase|berapa persen)\b/i,
  mine: /\b(gw|gue|gua|saya|aku|punya gw|punya saya|task gw|task saya|task aku)\b/i,
  project: /\b(project|proyek)\b/i,
}

export async function askOracle(query: string, actor: { id: string; name: string }): Promise<OracleResult> {
  const q = query.trim()
  if (!q) return { intent: "empty", subject: "NEXUS", answer: "Coba tanya, misal: \"task Bagas Putro\" atau \"siapa yang overdue?\"", nodes: [] }
  const lower = q.toLowerCase()

  // 1) explicit intents
  if (RE.listProjects.test(lower)) return listProjects()
  if (RE.busiest.test(lower)) return busiest()

  // overdue (optionally scoped to a person/project mentioned in the same sentence)
  if (RE.overdue.test(lower)) {
    const name = extractName(lower.replace(RE.overdue, " "))
    if (name) {
      const u = await resolveUser(name); if (u) return overdueTasks({ user: u })
      const p = await resolveProject(name); if (p) return overdueTasks({ project: p })
    }
    return overdueTasks()
  }
  if (RE.today.test(lower)) return dueToday()
  if (RE.mine.test(lower)) return tasksByPerson(actor)

  // project summary / project tasks
  if (RE.project.test(lower)) {
    const name = extractName(lower)
    const p = name ? await resolveProject(name) : null
    if (p) return RE.summary.test(lower) ? projectSummary(p) : tasksByProject(p)
  }
  if (RE.summary.test(lower)) {
    const name = extractName(lower)
    const p = name ? await resolveProject(name) : null
    if (p) return projectSummary(p)
  }

  // 2) bare "task <name>" → try person, then project
  const name = extractName(lower)
  if (name && name.length >= 2) {
    const u = await resolveUser(name); if (u) return tasksByPerson(u)
    const p = await resolveProject(name); if (p) return tasksByProject(p)
  }

  // 3) fallback: full-text search (flags needsLlm if empty)
  return searchTasks(name || q)
}

// Execute a structured intent (from the Codex LLM fallback). The LLM only classifies the question;
// every DB query still runs here, so there's no way for it to fabricate data or touch unintended rows.
export async function executeIntent(p: ParsedIntent, actor: { id: string; name: string }): Promise<OracleResult> {
  switch (p.intent) {
    case "tasks_by_person": {
      if (p.person) { const u = await resolveUser(p.person); if (u) return tasksByPerson(u) }
      return searchTasks(p.person || p.query || "")
    }
    case "tasks_by_project": {
      if (p.project) { const pr = await resolveProject(p.project); if (pr) return tasksByProject(pr) }
      return searchTasks(p.project || p.query || "")
    }
    case "overdue": {
      const scope: { user?: { id: string; name: string }; project?: { id: string; name: string } } = {}
      if (p.person) { const u = await resolveUser(p.person); if (u) scope.user = u }
      if (p.project) { const pr = await resolveProject(p.project); if (pr) scope.project = pr }
      return overdueTasks(scope)
    }
    case "due_today": return dueToday()
    case "busiest": return busiest()
    case "project_summary": {
      if (p.project) { const pr = await resolveProject(p.project); if (pr) return projectSummary(pr) }
      return listProjects()
    }
    case "list_projects": return listProjects()
    default: return searchTasks(p.query || p.person || p.project || "")
  }
}
