/**
 * "My Submissions" (/submissions, owner 12 Oct 2026): what someone filed through a form, on a board whose
 * columns are the target projects' STATUS OPTIONS (sections bound to a status, lib/status-sections.ts),
 * grouped To-do / In progress / Complete, with the names and colours of that project's board.
 *
 * Released iOS / Android apps read the older shape and keep working:
 *   procStatus     the custom "Status" field value while a project still has one (before the status
 *                  unify), else the name of the task's column once it is past To-do; null = "New"
 *   statusColumns  the names those apps make columns of (after "New")
 * Everything else here is additive.
 */
import prisma from "@/lib/prisma"
import { statusGroup, type StatusGroup } from "@/lib/status-sections"
import { numberFieldFormat, storedNumber } from "@/lib/custom-field-number"

export type SubmissionKind = "finance" | "multimedia" | "other"

export type BoardColumn = { key: string; name: string; color: string | null; group: StatusGroup; taskStatus: string | null; projectIds?: string[] }

const GROUP_ORDER: StatusGroup[] = ["todo", "in_progress", "complete"]
const STATUS_COLOR: Record<string, string> = { TODO: "gray", IN_PROGRESS: "blue", IN_REVIEW: "yellow", DONE: "green", CANCELLED: "red" }
const NEEDS_ACTION_COLUMN = /(revis|perbaik|kurang|lengkapi|need info|needs info|butuh|tolak|reject|return)/i

export function columnKey(group: StatusGroup, name: string) {
  return `${group}:${name.trim().toLowerCase()}`
}

export function submissionKind(projectName: string | null | undefined, folderName: string | null | undefined): SubmissionKind {
  const s = `${projectName ?? ""} ${folderName ?? ""}`
  if (/(finance|keuangan)/i.test(s)) return "finance"
  if (/(frameworkz|multimedia|creative|design|studio|viralz|iconz)/i.test(s)) return "multimedia"
  return "other"
}

type CfRow = { value: string; customField: { id: string; name: string; type: string; options: unknown } }

function isIdrField(options: unknown) {
  // Legacy { format: "currency-idr" } and the newer { numberFormat: "IDR" } (lib/custom-field-number.ts).
  return numberFieldFormat(options) === "currency-idr"
}

/** The amount of a request: an IDR number field on the task, else a number-ish answer named like one. */
export function amountOf(values: CfRow[], answers?: Record<string, unknown> | null, fields?: Array<{ id: string; name?: string; type?: string }>) {
  for (const v of values) {
    if (String(v.customField.type) !== "NUMBER" || !isIdrField(v.customField.options)) continue
    const n = storedNumber(v.value, v.customField.options)
    if (n !== null) return n
  }
  for (const f of fields ?? []) {
    if (!/(harga|nominal|amount|biaya|total|jumlah)/i.test(f.name ?? "")) continue
    const raw = answers?.[f.id]
    const n = Number(String(raw ?? "").replace(/[^\d-]+/g, ""))
    if (raw != null && String(raw).trim() && Number.isFinite(n)) return n
  }
  return null
}

/** The date that matters: a date field on the task (e.g. "Tanggal Penggunaan"), else the due date. */
export function dateOf(values: CfRow[], dueDate: Date | null) {
  for (const v of values) {
    if (String(v.customField.type) === "DATE" && v.value && !Number.isNaN(Date.parse(v.value))) return new Date(v.value).toISOString()
  }
  return dueDate ? dueDate.toISOString() : null
}

/** Where a task stands as a column of the board. */
export function columnOf(section: { name: string; color: string | null; taskStatus: string | null } | null | undefined): BoardColumn | null {
  if (!section) return null
  const group = statusGroup(section.taskStatus) ?? "todo"
  return { key: columnKey(group, section.name), name: section.name, color: section.color ?? (section.taskStatus ? STATUS_COLOR[section.taskStatus] : null), group, taskStatus: section.taskStatus }
}

/** The board's columns: every status option of the projects involved, merged by (group, name). */
export async function boardColumns(projectIds: string[]): Promise<BoardColumn[]> {
  if (!projectIds.length) return []
  const sections = await prisma.taskList.findMany({ where: { projectId: { in: projectIds } }, select: { name: true, color: true, taskStatus: true, position: true, projectId: true }, orderBy: { position: "asc" } })
  const out = new Map<string, BoardColumn & { position: number; projectIds: string[] }>()
  for (const s of sections) {
    const c = columnOf({ name: s.name, color: s.color, taskStatus: s.taskStatus ? String(s.taskStatus) : null })
    if (!c) continue
    const had = out.get(c.key)
    if (had) { if (!had.projectIds.includes(s.projectId)) had.projectIds.push(s.projectId) }
    else out.set(c.key, { ...c, position: s.position, projectIds: [s.projectId] })
  }
  return [...out.values()]
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.position - b.position)
    .map((c) => ({ key: c.key, name: c.name, color: c.color, group: c.group, taskStatus: c.taskStatus, projectIds: c.projectIds }))
}

/** The project's category field (the "By category" view's group), by project. */
export async function categoryFields(projectIds: string[]): Promise<Map<string, string>> {
  const views = projectIds.length
    ? await prisma.projectView.findMany({ where: { projectId: { in: projectIds }, builtin: "category", ownerId: null }, select: { projectId: true, config: true } })
    : []
  const map = new Map<string, string>()
  for (const v of views) {
    const g = (v.config as { groupBy?: unknown } | null)?.groupBy
    if (typeof g === "string" && g.startsWith("cf:")) map.set(v.projectId, g.slice(3))
  }
  return map
}

/**
 * Does the submitter have to do something? Their request sits in a column that asks for it (Revision,
 * "Perlu dilengkapi"…), or the latest comment is someone else's and came after their own last one.
 */
export function needsAction(section: { name: string } | null | undefined, comments: Array<{ userId: string; createdAt: Date }>, submitterId: string) {
  if (section && NEEDS_ACTION_COLUMN.test(section.name)) return true
  if (!comments.length) return false
  const last = comments.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
  return last.userId !== submitterId
}

const DONE_WORD = /^(done|selesai|complete|completed|finished|paid|lunas|cair)$/i

/**
 * The old apps' column for a task: the custom STATUS value, else the column name past To-do.
 * The Done checkbox wins both ways (owner, 12 Oct 2026): a task checked done never reads "On Progress"
 * (its Complete column's name, else "Done"), and a value "Done" on a task that is not done is ignored.
 */
export function legacyProcStatus(customStatus: string | null | undefined, column: BoardColumn | null, taskStatus?: string | null) {
  const v = (customStatus ?? "").trim()
  if (taskStatus === "DONE") return column && column.group === "complete" ? column.name : v && DONE_WORD.test(v) ? v : "Done"
  if (v && !(taskStatus && DONE_WORD.test(v))) return v
  if (column && column.group !== "todo") return column.name
  return null
}

/**
 * The files shown to the submitter as proof (the response's `proofs`). Since 12 Oct 2026 finance attaches
 * the payout proof as an ordinary attachment (the separate "Bukti Pencairan" section is gone from the web
 * popup), so proofs = legacy kind "PROOF" files (released apps may still upload those) PLUS any attachment
 * uploaded by someone other than the submitter. The submitter's own form files stay out.
 */
export function proofAttachmentsWhere(submitterId: string) {
  return { OR: [{ kind: "PROOF" }, { uploaderId: { not: submitterId } }] }
}

