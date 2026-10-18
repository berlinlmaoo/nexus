import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import { clip, count, limitOf, num, str, whenWib, PUBLIC_BASE } from "./util"
import type { ExtraTool, Input } from "./types"

/**
 * Summarise a form's responses (owner, 18 Oct 2026): the Forms Responses tab's own rule — Can view in the form's
 * project (GET /api/forms/:id/responses, checkProjectAccess VIEWER). Compact: how many responses, per choice
 * question the count of each option, per number question sum / average / min / max, per date question the range,
 * and the latest free-text answers; then a page of the latest responses (who, when, the task it made, its status).
 */

type Field = { id: string; name?: string; label?: string; type?: string; options?: unknown[]; autofill?: unknown }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const STATE: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" }

async function visibleForm(actor: User, input: Input) {
  const id = str(input.formId)
  const name = str(input.form) ?? str(input.name) ?? str(input.query)
  if (!id && !name) throw new Error("Say which form: formId or its name (form).")
  const rows = await prisma.form.findMany({
    where: id ? { id } : { name: { contains: name!, mode: "insensitive" } },
    select: { id: true, name: true, projectId: true, fields: true, project: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 30,
  })
  const visible = []
  for (const f of rows) if ((await checkProjectAccess(actor.id, f.projectId, ["VIEWER"])).allowed) visible.push(f)
  if (id) {
    if (!visible.length) throw new Error("That form does not exist or this person cannot see its project.")
    return visible[0]
  }
  const exact = visible.filter((f) => f.name.toLowerCase() === name!.toLowerCase())
  const pick = exact.length === 1 ? exact : visible
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`No form this person can see is named like “${name}”.`)
  throw new Error(`Several forms match “${name}”: ${pick.slice(0, 8).map((f) => `“${f.name}” (${f.project?.name ?? "?"})`).join(", ")}. Ask which one.`)
}

function valueOf(data: Record<string, unknown>, f: Field): unknown {
  return data[f.id] ?? (f.name ? data[f.name] : undefined)
}

async function getFormResponses(actor: User, input: Input) {
  const form = await visibleForm(actor, input)
  const from = str(input.from)
  const to = str(input.to)
  const createdAt: { gte?: Date; lt?: Date } = {}
  if (from && DAY.test(from)) createdAt.gte = new Date(`${from}T00:00:00+07:00`)
  if (to && DAY.test(to)) createdAt.lt = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400e3)
  const where = { formId: form.id, ...(Object.keys(createdAt).length ? { createdAt } : {}) }
  const [total, rows] = await Promise.all([
    prisma.formSubmission.count({ where }),
    // The summary reads up to 2000 responses (the newest); `sampled` says so when there are more.
    prisma.formSubmission.findMany({ where, orderBy: { createdAt: "desc" }, take: 2000, select: { id: true, data: true, createdAt: true, submitterId: true, task: { select: { id: true, title: true, status: true, taskList: { select: { name: true } } } } } }),
  ])
  const fields = (Array.isArray(form.fields) ? (form.fields as unknown as Field[]) : []).filter((f) => f && typeof f.id === "string")
  const questions = fields.filter((f) => f.type !== "file" && f.type !== "section" && f.type !== "heading").slice(0, 25).map((f) => {
    const label = clip(f.label || f.name || f.id, 80) ?? f.id
    const vals = rows.map((r) => valueOf((r.data ?? {}) as Record<string, unknown>, f)).filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    const base = { question: label, answered: vals.length }
    if (f.type === "select" || f.type === "multi_select" || f.type === "radio" || f.type === "checkbox" || Array.isArray(f.options)) {
      const counts = new Map<string, number>()
      for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) counts.set(String(x), (counts.get(String(x)) ?? 0) + 1)
      return { ...base, options: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)) }
    }
    const nums = vals.map((v) => num(v)).filter((n): n is number => n !== undefined)
    if (f.type === "number" || f.type === "currency" || (nums.length && nums.length === vals.length && vals.length > 0 && typeof vals[0] === "number")) {
      if (!nums.length) return base
      const sum = nums.reduce((s, n) => s + n, 0)
      return { ...base, sum: count(sum), avg: count(sum / nums.length), min: count(Math.min(...nums)), max: count(Math.max(...nums)) }
    }
    if (f.type === "date") {
      const days = vals.map(String).filter((s) => DAY.test(s.slice(0, 10))).map((s) => s.slice(0, 10)).sort()
      return days.length ? { ...base, earliest: days[0], latest: days[days.length - 1] } : base
    }
    return { ...base, latest: vals.slice(0, 5).map((v) => clip(typeof v === "string" ? v : JSON.stringify(v), 140)) }
  })
  const statusCounts: Record<string, number> = {}
  for (const r of rows) if (r.task) statusCounts[STATE[r.task.status] ?? r.task.status] = (statusCounts[STATE[r.task.status] ?? r.task.status] ?? 0) + 1
  const limit = limitOf(input, 10, 50)
  const offset = num(input.offset) && num(input.offset)! > 0 ? Math.floor(num(input.offset)!) : 0
  const pageRows = rows.slice(offset, offset + limit)
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(pageRows.map((r) => r.submitterId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  const rest = Math.max(0, Math.min(total, rows.length) - offset - pageRows.length)
  return {
    form: form.name,
    project: form.project?.name ?? null,
    link: `${PUBLIC_BASE}/forms?form=${form.id}`,
    total,
    ...(from || to ? { window: `${from ?? "…"} – ${to ?? "…"}` } : {}),
    ...(total > rows.length ? { sampled: `The summary covers the newest ${rows.length} of ${total} responses.` } : {}),
    ...(Object.keys(statusCounts).length ? { taskStatus: statusCounts } : {}),
    questions,
    responses: pageRows.map((r) => ({
      when: whenWib(r.createdAt),
      by: r.submitterId ? (nameOf.get(r.submitterId) ?? "?") : "anonymous",
      ...(r.task ? { task: r.task.title, status: r.task.taskList?.name ?? STATE[r.task.status] ?? r.task.status } : {}),
    })),
    ...(rest ? { more: `${rest} more responses — call again with offset=${offset + pageRows.length}, or narrow with from/to (YYYY-MM-DD).` } : {}),
    note: "Numbers are counts (no Rp) unless the question is money; say amounts as Rp only for money. Quote answers only as needed.",
  }
}

export const formTools: Record<string, ExtraTool> = {
  get_form_responses: { read: getFormResponses, stepArg: (i) => str(i.form) ?? str(i.name) ?? null },
}
