/**
 * What GIDEON's NEXUS tools hand the model (owner, 18 Oct 2026: "cheaper per answer, not dumber").
 *
 * Every token of a tool result is paid at the fresh-input price on every model call that follows it, and a
 * task list used to arrive as full rows: each assignee's email and avatar URL, the creator, every custom
 * field with its whole option list, list ids — 60 KB for one "what are my tasks". That was most of what a
 * task question cost (40–87 credits on Phaëthon). These shapes keep what an answer is built from (title,
 * column, progress, priority, due date, who, project, filled-in fields) and say how many more rows there are
 * and how to fetch them, so nothing becomes unreachable: a capped list is a page, not a cut.
 *
 * Pure (no database): tested in gideon-compact.test.mjs.
 */

type AnyObj = Record<string, any>

export const TASK_PAGE = 25
export const TASK_PAGE_MAX = 100

const STATE: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" }
const PRIORITY: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low" }

/** "YYYY-MM-DD" of an instant in Asia/Jakarta (WIB, +07:00 fixed). */
export function wibDayKey(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return null
  return new Date(t.getTime() + 7 * 3600e3).toISOString().slice(0, 10)
}

function clip(s: unknown, n: number): string | null {
  if (typeof s !== "string") return null
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A custom field's value as a person reads it, or null when it is empty / not worth a token. */
export function fieldText(type: string | undefined, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s || s === "[]" || s === "{}" || s === "null") return null
  if (type === "FILE" || type === "CREATED") return null
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return v.length ? clip(v.map(String).join(", "), 80) : null
      if (v && typeof v === "object") return clip(String((v as AnyObj).label || (v as AnyObj).name || ""), 80)
    } catch { /* plain text that starts with a bracket */ }
  }
  return clip(s, 80)
}

/**
 * One task row for a list. `todayKey` decides `overdue`. `withProject` = the list spans projects (a list inside one
 * project names it once at the top instead).
 */
export function compactTask(t: AnyObj, todayKey: string, withProject = true): AnyObj {
  const state = STATE[t.status] ?? t.status
  const column = typeof t.taskList?.name === "string" && t.taskList.name.trim() ? t.taskList.name.trim() : state
  const due = wibDayKey(t.dueDate)
  const open = t.status !== "DONE" && t.status !== "CANCELLED"
  const out: AnyObj = { id: t.id, title: t.title, status: column }
  if (column !== state) out.progress = state
  if (PRIORITY[t.priority]) out.priority = PRIORITY[t.priority]
  if (due) out.due = due
  if (due && open && due < todayKey) out.overdue = true
  const who = (t.assignees || []).map((a: AnyObj) => a?.user?.name ?? a?.name).filter(Boolean)
  if (who.length) out.assignees = who
  if (withProject) {
    const p = t.taskList?.project ?? t.project
    if (p?.name) { out.project = p.name; out.projectId = p.id ?? t.taskList?.projectId }
  }
  const fields: AnyObj = {}
  for (const v of t.customFieldValues || []) {
    if (Object.keys(fields).length >= 6) break
    const name = v?.customField?.name
    const text = fieldText(v?.customField?.type, v?.value)
    if (name && text) fields[name] = text
  }
  if (Object.keys(fields).length) out.fields = fields
  const desc = clip(t.description, 140)
  if (desc) out.desc = desc
  return out
}

/** The page wrapper every list returns: how many there are, which slice this is, and how to get the rest. */
export function page<T>(items: T[], total: number, offset: number, limit: number, hint = "narrow it with filters") {
  const shown = items.length
  const rest = Math.max(0, total - offset - shown)
  return {
    total,
    shown,
    ...(offset ? { offset } : {}),
    items,
    ...(rest ? { more: `${rest} more not shown — call again with offset=${offset + shown}${limit < TASK_PAGE_MAX ? ` (or limit up to ${TASK_PAGE_MAX})` : ""}, or ${hint}.` } : {}),
  }
}

/** A project row for a list: no member roster, no avatars, just what tells projects apart. */
export function compactProject(p: AnyObj, open: number | undefined): AnyObj {
  const total = (p.taskLists || []).reduce((s: number, l: AnyObj) => s + (l?._count?.tasks ?? 0), 0)
  const out: AnyObj = { id: p.id, name: p.name, status: p.status }
  if (p.type && p.type !== "TASK") out.type = p.type
  out.tasks = total
  if (open !== undefined) out.open = open
  if (p._count?.members !== undefined) out.members = p._count.members
  return out
}

/** Open tasks first by urgency, then the earliest due date (none last). */
export function urgencyOrder(a: AnyObj, b: AnyObj): number {
  const rank = (t: AnyObj) => (t.priority === "URGENT" ? 0 : t.priority === "HIGH" ? 1 : 2)
  const r = rank(a) - rank(b)
  if (r) return r
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
  return da - db
}
