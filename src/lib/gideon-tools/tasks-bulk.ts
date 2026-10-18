import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import { parseDueInput } from "@/lib/gideon-dates"
import { wibDay } from "@/lib/calendar/core"
import { dayLabel, findPerson, str, strArray } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Bulk task work and subtasks (owner, 18 Oct 2026), plus the folder scope of task reads.
 *
 * bulk_update_tasks: move / reassign / re-date / re-prioritise many tasks at once — ONE card listing every change,
 * in every approval mode. Applied task by task through PATCH /api/tasks/:id as the person (lib/task-update.ts:
 * access per task, section ↔ status, done stamps, automations, notifications, the `task-updated` realtime event),
 * so nothing is reimplemented. Race-safe: each task's updatedAt is kept on the card and a task edited by someone
 * else in between is skipped and reported, never overwritten; an assignee change also sends baseAssigneeIds
 * (the endpoint's own 409 ASSIGNEES_CHANGED).
 *
 * add_subtasks: POST /api/tasks with parentId (the task popup's "+ Subtask"), as the person.
 */

const BULK_MAX = 50
const SUBTASKS_MAX = 20
const STATUS_WORD: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" }
const STATUSES = new Set(Object.keys(STATUS_WORD))
const PRIORITIES = new Set(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"])

// ── Folder scope (Folder view: Board + Calendar of every project in a folder and its sub-folders) ─────────────

/**
 * The projects of a folder (by name or id) and its sub-folders that this person can see — the folder view's own
 * rule: its curated selection (aggregateProjectIds) when set, else every project in the subtree.
 */
export async function folderProjectIds(actor: Pick<User, "id">, folder: string): Promise<{ name: string; projectIds: string[] }> {
  const myWs = (await prisma.workspaceMember.findMany({ where: { userId: actor.id }, select: { workspaceId: true } })).map((m) => m.workspaceId)
  const all = await prisma.projectFolder.findMany({ where: { workspaceId: { in: myWs } }, select: { id: true, name: true, parentFolderId: true, aggregateProjectIds: true } })
  const lower = folder.toLowerCase()
  const hit = all.find((f) => f.id === folder) ?? all.find((f) => f.name.toLowerCase() === lower)
    ?? (all.filter((f) => f.name.toLowerCase().includes(lower)).length === 1 ? all.find((f) => f.name.toLowerCase().includes(lower)) : undefined)
  if (!hit) {
    const near = all.filter((f) => f.name.toLowerCase().includes(lower)).map((f) => f.name)
    throw new Error(near.length ? `Several folders match "${folder}": ${near.slice(0, 8).join(", ")}. Ask which one.` : `No folder is named like "${folder}".`)
  }
  const subtree = new Set([hit.id])
  for (let grew = true; grew;) {
    grew = false
    for (const f of all) if (f.parentFolderId && subtree.has(f.parentFolderId) && !subtree.has(f.id)) { subtree.add(f.id); grew = true }
  }
  const visible = await prisma.project.findMany({
    where: {
      folderId: { in: [...subtree] },
      OR: [
        { members: { some: { userId: actor.id } } },
        { workspace: { members: { some: { userId: actor.id, role: { in: ["ONE_ABOVE_ALL", "BOD"] } } } } },
      ],
    },
    select: { id: true },
  })
  const ids = visible.map((p) => p.id)
  const curated = hit.aggregateProjectIds ?? []
  const set = new Set(ids)
  return { name: hit.name, projectIds: curated.length ? curated.filter((id) => set.has(id)) : ids }
}

// ── bulk_update_tasks ──────────────────────────────────────────────────────────────────────────────────────

type Change = { taskId: string; status?: string; taskListId?: string; section?: string; dueDate?: string | null; priority?: string; assignees?: string[]; addAssignees?: string[]; removeAssignees?: string[] }

function changesOf(input: Input): Change[] {
  const list = Array.isArray(input.changes) ? input.changes : null
  const common = { status: input.status, taskListId: input.taskListId, section: input.section, dueDate: input.dueDate, priority: input.priority, assignees: input.assignees, addAssignees: input.addAssignees, removeAssignees: input.removeAssignees }
  const raw: Record<string, unknown>[] = list
    ? (list.filter((x) => x && typeof x === "object") as Record<string, unknown>[])
    : strArray(input.taskIds).map((taskId) => ({ taskId, ...common }))
  return raw.map((c) => ({
    taskId: str(c.taskId) ?? "",
    ...(str(c.status) ? { status: str(c.status)!.toUpperCase() } : {}),
    ...(str(c.taskListId) ? { taskListId: str(c.taskListId) } : {}),
    ...(str(c.section) ? { section: str(c.section) } : {}),
    ...(c.dueDate === null ? { dueDate: null } : str(c.dueDate) ? { dueDate: str(c.dueDate) } : {}),
    ...(str(c.priority) ? { priority: str(c.priority)!.toUpperCase() } : {}),
    ...(Array.isArray(c.assignees) ? { assignees: strArray(c.assignees) } : {}),
    ...(c.addAssignees !== undefined ? { addAssignees: strArray(c.addAssignees) } : {}),
    ...(c.removeAssignees !== undefined ? { removeAssignees: strArray(c.removeAssignees) } : {}),
  }))
}

async function personIds(names: string[], projectId: string): Promise<{ ids: string[]; names: string[] }> {
  const ids: string[] = []
  const out: string[] = []
  for (const n of names) {
    const byId = await prisma.user.findFirst({ where: { id: n }, select: { id: true, name: true } })
    const p = byId ?? (await findPerson(n))
    const member = await prisma.projectMember.findFirst({ where: { projectId, userId: p.id }, select: { id: true } })
    if (!member) throw new Error(`${p.name} is not a member of that task's project, so they cannot be its PIC. Tell the person.`)
    ids.push(p.id)
    out.push(p.name ?? "?")
  }
  return { ids, names: out }
}

type Planned = { taskId: string; title: string; project: string; updatedAt: string; body: Record<string, unknown>; lines: string[] }

async function planBulk(actor: User, input: Input): Promise<Planned[]> {
  const changes = changesOf(input).filter((c) => c.taskId)
  if (!changes.length) throw new Error("Give the tasks: changes = [{ taskId, status / section / dueDate / priority / assignees … }], or taskIds + the fields to set on all of them.")
  if (changes.length > BULK_MAX) throw new Error(`At most ${BULK_MAX} tasks per card. Split it.`)
  const ids = [...new Set(changes.map((c) => c.taskId))]
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, updatedAt: true, taskListId: true, taskList: { select: { name: true, projectId: true, project: { select: { name: true } } } }, assignees: { select: { user: { select: { id: true, name: true } } } } },
  })
  const planned: Planned[] = []
  for (const c of changes) {
    const t = tasks.find((x) => x.id === c.taskId)
    if (!t) throw new Error(`No task with id ${c.taskId}. Find tasks with nexus_list_tasks / nexus_search_tasks first.`)
    const projectId = t.taskList.projectId
    const { allowed } = await checkProjectAccess(actor.id, projectId, ["MEMBER"])
    if (!allowed) throw new Error(`This person cannot edit tasks in ${t.taskList.project?.name ?? "that project"} (needs Can edit), so “${t.title}” cannot be changed. Leave it out or tell them.`)
    const body: Record<string, unknown> = {}
    const lines: string[] = []
    if (c.status) {
      if (!STATUSES.has(c.status)) throw new Error(`Invalid status ${c.status}`)
      if (c.status !== t.status) { body.status = c.status; lines.push(`${STATUS_WORD[t.status] ?? t.status} → ${STATUS_WORD[c.status]}`) }
    }
    if (c.taskListId || c.section) {
      const lists = await prisma.taskList.findMany({ where: { projectId }, select: { id: true, name: true } })
      const target = lists.find((l) => l.id === c.taskListId) ?? lists.find((l) => l.name.toLowerCase() === (c.section ?? "").toLowerCase())
      if (!target) throw new Error(`No column "${c.section ?? c.taskListId}" in ${t.taskList.project?.name}. Columns: ${lists.map((l) => l.name).join(", ")}`)
      if (target.id !== t.taskListId) { body.taskListId = target.id; lines.push(`${t.taskList.name} → ${target.name}`) }
    }
    if (c.dueDate !== undefined) {
      const due = parseDueInput(c.dueDate)
      const before = t.dueDate ? wibDay(t.dueDate) : null
      const after = due ? wibDay(due) : null
      if (before !== after) { body.dueDate = due ? due.toISOString() : null; lines.push(`Due ${before ? dayLabel(before) : "—"} → ${after ? dayLabel(after) : "—"}`) }
    }
    if (c.priority) {
      if (!PRIORITIES.has(c.priority)) throw new Error(`Invalid priority ${c.priority}`)
      if (c.priority !== t.priority) { body.priority = c.priority; lines.push(`Priority ${t.priority.toLowerCase()} → ${c.priority.toLowerCase()}`) }
    }
    const current = t.assignees.map((a) => a.user.id)
    const currentNames = t.assignees.map((a) => a.user.name ?? "?")
    if (c.assignees) {
      const p = await personIds(c.assignees, projectId)
      if (p.ids.slice().sort().join() !== current.slice().sort().join()) {
        body.assigneeIds = p.ids
        body.baseAssigneeIds = current
        lines.push(`PIC ${currentNames.join(", ") || "—"} → ${p.names.join(", ") || "—"}`)
      }
    } else if (c.addAssignees?.length || c.removeAssignees?.length) {
      const add = c.addAssignees?.length ? await personIds(c.addAssignees, projectId) : { ids: [], names: [] }
      const removeIds: string[] = []
      for (const n of c.removeAssignees ?? []) {
        const hit = t.assignees.find((a) => a.user.id === n || (a.user.name ?? "").toLowerCase().includes(n.toLowerCase()))
        if (hit) removeIds.push(hit.user.id)
      }
      const addIds = add.ids.filter((id) => !current.includes(id))
      if (addIds.length) body.addAssigneeIds = addIds
      if (removeIds.length) body.removeAssigneeIds = removeIds
      if (addIds.length || removeIds.length) lines.push(`PIC ${[...addIds.map((id) => `+${add.names[add.ids.indexOf(id)]}`), ...removeIds.map((id) => `−${t.assignees.find((a) => a.user.id === id)?.user.name ?? "?"}`)].join(" ")}`)
    }
    if (!lines.length) continue
    planned.push({ taskId: t.id, title: t.title, project: t.taskList.project?.name ?? "", updatedAt: t.updatedAt.toISOString(), body: { ...body, projectContextId: projectId }, lines })
  }
  if (!planned.length) throw new Error("Nothing would change on those tasks.")
  return planned
}

async function describeBulk(actor: User, input: Input) {
  const planned = await planBulk(actor, input)
  const projects = [...new Set(planned.map((p) => p.project))]
  const preview = planned.map((p, i) => `${i + 1}. ${p.title}${projects.length > 1 ? ` · ${p.project}` : ""}\n   ${p.lines.join(" · ")}`).join("\n")
  return {
    summary: `Change ${planned.length} task${planned.length === 1 ? "" : "s"}${projects.length === 1 ? ` in ${projects[0]}` : ""}`,
    diff: [
      { field: "Tasks", to: String(planned.length) },
      ...(projects.length <= 3 ? [{ field: "Project", to: projects.join(", ") }] : []),
      { field: "Change", to: preview },
    ],
    projectId: null,
    store: { planned },
    preview,
    note: `NOT changed yet. One card lists all ${planned.length} changes; nothing moves until the person taps Apply all. A task someone else edits in the meantime is skipped, not overwritten. Say so in one sentence.`,
  }
}

// ── add_subtasks ───────────────────────────────────────────────────────────────────────────────────────────

async function describeSubtasks(actor: User, input: Input) {
  const parentId = str(input.taskId) ?? str(input.parentId)
  if (!parentId) throw new Error("taskId (the parent task) is required.")
  const titles = (Array.isArray(input.titles) ? input.titles : Array.isArray(input.subtasks) ? input.subtasks : [input.title]).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
  if (!titles.length) throw new Error("titles is required: the subtasks to add, one title each.")
  if (titles.length > SUBTASKS_MAX) throw new Error(`At most ${SUBTASKS_MAX} subtasks per card.`)
  if (titles.some((t) => t.length > 500)) throw new Error("A title is at most 500 characters.")
  const parent = await prisma.task.findUnique({ where: { id: parentId }, select: { id: true, title: true, taskListId: true, taskList: { select: { projectId: true, project: { select: { name: true } } } } } })
  if (!parent) throw new Error("No task with that id.")
  const { allowed } = await checkProjectAccess(actor.id, parent.taskList.projectId, ["MEMBER"])
  if (!allowed) throw new Error(`This person cannot add tasks in ${parent.taskList.project?.name ?? "that project"} (needs Can edit).`)
  const who = input.assignees !== undefined ? await personIds(strArray(input.assignees), parent.taskList.projectId) : { ids: [], names: [] }
  const dueRaw = str(input.dueDate)
  const due = dueRaw ? parseDueInput(dueRaw) : null
  const preview = titles.map((t, i) => `${i + 1}. ${t}`).join("\n")
  return {
    summary: `Add ${titles.length} subtask${titles.length === 1 ? "" : "s"} to “${parent.title}”`,
    diff: [
      { field: "Task", to: parent.title },
      { field: "Project", to: parent.taskList.project?.name ?? "—" },
      { field: "Subtasks", to: preview },
      ...(who.names.length ? [{ field: "Assignees", to: who.names.join(", ") }] : []),
      ...(due ? [{ field: "Due", to: dayLabel(wibDay(due)) ?? "", toDay: wibDay(due) }] : []),
    ],
    projectId: parent.taskList.projectId,
    taskId: parent.id,
    store: { parentId: parent.id, projectId: parent.taskList.projectId, taskListId: parent.taskListId, titles, assigneeIds: who.ids, dueDate: due ? due.toISOString() : null },
    preview,
  }
}

export const bulkTaskTools: Record<string, ExtraTool> = {
  bulk_update_tasks: {
    describe: describeBulk,
    stepArg: () => null,
    web: async (input, call) => {
      const planned = (Array.isArray(input.planned) ? input.planned : []) as Planned[]
      const done: string[] = []
      const skipped: string[] = []
      for (const p of planned) {
        // Edited by someone else since the card was made: skipped, never overwritten.
        const now = await prisma.task.findUnique({ where: { id: p.taskId }, select: { updatedAt: true } })
        if (!now) { skipped.push(`${p.title} (deleted meanwhile)`); continue }
        if (now.updatedAt.toISOString() !== p.updatedAt) { skipped.push(`${p.title} (changed by someone meanwhile)`); continue }
        const r = await call({ method: "PATCH", path: `/api/tasks/${p.taskId}`, json: p.body })
        if (r.ok) done.push(p.taskId)
        else skipped.push(`${p.title} (${webError(r, "refused")})`)
      }
      if (!done.length) return { ok: false, message: `Nothing was changed · Tidak ada yang diubah: ${skipped.join("; ")}`.slice(0, 480) }
      return { ok: true, message: skipped.length ? `Skipped · Dilewati: ${skipped.join("; ")}` : null, result: { changed: done.length, skipped } }
    },
  },
  add_subtasks: {
    describe: describeSubtasks,
    stepArg: async (i) => {
      const id = str(i.taskId) ?? str(i.parentId)
      return id ? (await prisma.task.findUnique({ where: { id }, select: { title: true } }))?.title ?? null : null
    },
    // The task route's own create (POST /api/tasks with parentId) as the person, from the card.
    web: async (input, call) => {
      const titles = (Array.isArray(input.titles) ? input.titles : []) as string[]
      let made = 0
      const failed: string[] = []
      for (const title of titles) {
        const r = await call({ method: "POST", path: "/api/tasks", json: { title, projectId: input.projectId, taskListId: input.taskListId, parentId: input.parentId, ...(Array.isArray(input.assigneeIds) && input.assigneeIds.length ? { assigneeIds: input.assigneeIds } : {}), ...(input.dueDate ? { dueDate: input.dueDate } : {}) } })
        if (r.ok) made++
        else failed.push(`${title} (${webError(r, "refused")})`)
      }
      if (!made) return { ok: false, message: `No subtask was added · Tidak ada subtask yang ditambahkan: ${failed.join("; ")}`.slice(0, 480) }
      return { ok: true, link: `/tasks/${String(input.parentId)}`, message: failed.length ? `Not added · Tidak ditambahkan: ${failed.join("; ")}` : null, result: { added: made } }
    },
  },
}

