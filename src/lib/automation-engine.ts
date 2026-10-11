import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { notifyAutomation, notifyTaskAssigned } from "@/lib/notification-service"
import { getAutomationUserId } from "@/lib/automation-identity"
import { emitAutomationsChanged, emitCommentAdded, emitTaskCreated, emitTaskDeleted, emitTaskUpdated } from "@/lib/socket-emitter"
import { webhookUrlError } from "@/lib/webhook-dispatcher"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { autofillOnEvent } from "@/lib/gideon-autofill"
import { isWorkspaceManagerRole } from "@/lib/rbac"
import { normalizeCustomFieldType, parseCustomFieldValue, serializeCustomFieldValue } from "@/lib/custom-fields"
import {
  TASK_ACTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  actionsOf,
  conditionsHold,
  dueSlot,
  fillTemplate,
  normalizeConditions,
  normalizeTrigger,
  realChanges,
  resolveDateValue,
  scheduleOf,
  triggerMatches,
  type AutomationEventKind,
  type FieldChange,
  type Rule,
  type TaskFacts,
} from "@/lib/automation-rules"

/**
 * Project automations engine (rewritten 12 Oct 2026, owner: "When / If / Do").
 *
 * The vocabulary and the pure matching live in automation-rules.ts. This file loads the rules of a project,
 * checks them against an event, runs the actions in order and writes one AutomationRun per firing (the
 * run log the web shows). Actions write straight to the database and never raise a new event, so one
 * automation can never set off another (no loops), the same as Notion.
 *
 * Callers fire and forget: `runAutomations(...).catch(() => {})` after their own write has succeeded.
 */

const log = createLogger("automation")

export interface AutomationEvent {
  kind: AutomationEventKind
  projectId: string
  /** The person whose action raised the event; null for the clock and inbound webhooks. */
  actorId: string | null
  taskId?: string
  changes?: Record<string, FieldChange>
  formId?: string
  commentId?: string
  payload?: unknown
}

type AutomationRow = {
  id: string
  name: string
  projectId: string
  trigger: unknown
  action: unknown
  actions: unknown
  condition: unknown
  conditions: unknown
  enabled: boolean
  createdById: string | null
  createdAt: Date
}

const ROW_SELECT = {
  id: true, name: true, projectId: true, trigger: true, action: true, actions: true, condition: true,
  conditions: true, enabled: true, createdById: true, createdAt: true,
} as const

const TASK_EMIT_INCLUDE = {
  assignees: { include: { user: true } },
  creator: true,
  taskList: true,
  _count: { select: { subtasks: true, comments: true } },
} as const

type StepResult = { type: string; ok: boolean; skipped?: boolean; message: string }
export type RunStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED"
export type RunResult = { runId: string | null; status: RunStatus; steps: StepResult[] }

/** Legacy entry point (pre-12 Oct call sites and anything not yet moved). Maps the old event names. */
export async function executeAutomations(
  projectId: string,
  event: "task_created" | "task_status_changed" | "task_assigned" | "task_due_approaching" | "comment_added" | "sprint_started",
  context: { taskId?: string; userId: string; oldStatus?: string; newStatus?: string; assigneeIds?: string[]; commentId?: string; [key: string]: unknown },
): Promise<void> {
  switch (event) {
    case "task_created":
      return runAutomations({ kind: "task_created", projectId, actorId: context.userId, taskId: context.taskId })
    case "comment_added":
      return runAutomations({ kind: "comment_added", projectId, actorId: context.userId, taskId: context.taskId, commentId: context.commentId })
    case "task_status_changed":
      return runAutomations({ kind: "task_updated", projectId, actorId: context.userId, taskId: context.taskId, changes: { status: { from: context.oldStatus, to: context.newStatus } } })
    case "task_assigned":
      return runAutomations({ kind: "task_updated", projectId, actorId: context.userId, taskId: context.taskId, changes: { assignee: { added: context.assigneeIds ?? [], removed: [] } } })
    default:
      // sprint_started used to fire every TASK_CREATED rule with no task: that was a bug, not a feature.
      return
  }
}

/** Run every enabled rule of the project that matches this event. Never throws. */
export async function runAutomations(event: AutomationEvent): Promise<void> {
  // AI Autofill fields of the project listen on the same events (12 Oct 2026); debounced, never throws.
  autofillOnEvent(event)
  try {
    const rows = await prisma.automation.findMany({ where: { projectId: event.projectId, enabled: true }, select: ROW_SELECT })
    if (rows.length === 0) return
    const changes = realChanges(event.changes)
    if (event.kind === "task_updated" && Object.keys(changes).length === 0) return
    const ev = { ...event, changes }
    for (const row of rows as AutomationRow[]) {
      const trigger = normalizeTrigger(row.trigger)
      if (!trigger || !triggerMatches(trigger, ev)) continue
      await runOne(row, ev).catch((err) => log.error("automation run failed", { id: row.id, error: String(err) }))
    }
  } catch (err) {
    log.error("Failed to execute automations", { error: String(err) })
  }
}

/** Load the facts a condition reads. Null when the task is gone. */
async function taskFacts(taskId: string): Promise<(TaskFacts & { projectId: string; createdAt: Date }) | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      status: true, priority: true, tags: true, title: true, description: true, dueDate: true, startDate: true,
      creatorId: true, taskListId: true, createdAt: true,
      taskList: { select: { projectId: true } },
      assignees: { select: { userId: true } },
      customFieldValues: { select: { customFieldId: true, value: true, customField: { select: { type: true } } } },
    },
  })
  if (!task) return null
  const custom: Record<string, unknown> = {}
  for (const v of task.customFieldValues) {
    const type = normalizeCustomFieldType(v.customField.type)
    custom[`cf:${v.customFieldId}`] = type ? parseCustomFieldValue(type, v.value, task.createdAt) : v.value
  }
  return {
    status: task.status, priority: task.priority, assigneeIds: task.assignees.map((a) => a.userId),
    sectionId: task.taskListId, tags: task.tags, title: task.title, description: task.description,
    dueDate: task.dueDate, startDate: task.startDate, creatorId: task.creatorId, custom,
    projectId: task.taskList.projectId, createdAt: task.createdAt,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "P2002"
}

/**
 * Check the conditions, run the actions, log the run. `dedupKey` makes a clock-driven firing happen
 * once (unique per automation): a second attempt with the same key returns null without running.
 */
export async function runOne(
  row: AutomationRow,
  event: AutomationEvent,
  opts: { dedupKey?: string; manual?: boolean } = {},
): Promise<RunResult | null> {
  const started = Date.now()
  const trigger = normalizeTrigger(row.trigger)
  const conditions = normalizeConditions(row.conditions, row.condition)
  const facts = event.taskId ? await taskFacts(event.taskId) : null

  if (event.taskId && !facts) return null // the task was deleted between the event and now
  if (conditions && facts && !conditionsHold(conditions, facts)) return null
  // Conditions on a run with no task (schedule, webhook) cannot hold: they filter tasks.
  if (conditions && !facts && event.kind !== "scheduled") return null

  let runId: string | null = null
  try {
    const run = await prisma.automationRun.create({
      data: {
        automationId: row.id, projectId: row.projectId, taskId: event.taskId ?? null,
        event: opts.manual ? "manual" : event.kind, trigger: trigger?.type ?? "UNKNOWN",
        // Who set it off: the person, or for the clock and inbound webhooks the rule's author.
        status: "RUNNING", actorId: event.actorId ?? row.createdById, dedupKey: opts.dedupKey ?? null,
      },
      select: { id: true },
    })
    runId = run.id
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }

  // Everything the actions write is signed by the Automation identity (lib/automation-identity.ts); the
  // person who set it off is kept as `triggeredBy` (run log actorId, activity/audit metadata).
  const actor = await getAutomationUserId()
  const triggeredBy = event.actorId ?? row.createdById
  const steps: StepResult[] = []
  const project = await prisma.project.findUnique({ where: { id: row.projectId }, select: { id: true, name: true, workspaceId: true } })
  const actorName = triggeredBy ? (await prisma.user.findUnique({ where: { id: triggeredBy }, select: { name: true } }))?.name ?? "" : ""
  let taskTouched = false
  let taskGone = false

  for (const action of actionsOf(row)) {
    if (TASK_ACTIONS.has(action.type as never) && (!event.taskId || taskGone)) {
      steps.push({ type: action.type, ok: true, skipped: true, message: taskGone ? "Skipped: the task was archived by an earlier step" : "Skipped: this trigger has no task" })
      continue
    }
    try {
      const res = await executeAction(action, {
        row, event, actor, triggeredBy, actorName, projectName: project?.name ?? "", workspaceId: project?.workspaceId ?? null,
      })
      steps.push({ type: action.type, ok: true, skipped: res.skipped, message: res.message })
      if (res.touchedTask) taskTouched = true
      if (res.deletedTask) taskGone = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      steps.push({ type: action.type, ok: false, message: message.slice(0, 500) })
      log.error(`Automation "${row.name}" action ${action.type} failed`, { error: message })
    }
  }

  const failed = steps.filter((s) => !s.ok).length
  const ran = steps.filter((s) => s.ok && !s.skipped).length
  const status: RunStatus = steps.length === 0 ? "SKIPPED" : failed === 0 ? (ran === 0 ? "SKIPPED" : "SUCCESS") : failed === steps.length ? "FAILED" : "PARTIAL"
  const error = steps.find((s) => !s.ok)?.message ?? null

  await prisma.automationRun.update({
    where: { id: runId },
    data: { status, steps: steps as unknown as object, error, durationMs: Date.now() - started },
  }).catch(() => {})
  await prisma.automation.update({
    where: { id: row.id },
    data: { lastRunAt: new Date(), lastRunStatus: status, runCount: { increment: 1 } },
  }).catch(() => {})

  if (event.taskId) {
    await prisma.activityLog.create({
      data: {
        action: status === "FAILED" ? "automation_failed" : "automation_executed",
        details: `Automation "${row.name}" ${status === "FAILED" ? "failed" : "ran"}${actorName ? ` (triggered by ${actorName})` : ""}: ${steps.map((s) => s.message).join("; ")}`.slice(0, 1000),
        userId: actor,
        taskId: taskGone ? null : event.taskId,
        projectId: row.projectId,
      },
    }).catch(() => {})
  }

  if (taskTouched && event.taskId && !taskGone) await emitTask(event.taskId)
  emitAutomationsChanged(row.projectId, row.id)
  return { runId, status, steps }
}

async function emitTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { ...TASK_EMIT_INCLUDE, taskProjects: { select: { projectId: true } } } })
  if (!task) return
  const projects = new Set([task.taskList.projectId, ...task.taskProjects.map((p) => p.projectId)])
  const { taskProjects: _ignored, ...rest } = task
  void _ignored
  for (const pid of projects) emitTaskUpdated(pid, JSON.parse(JSON.stringify(rest)))
}

type ActionCtx = {
  row: AutomationRow
  event: AutomationEvent
  /** The Automation identity: author of every comment, task, activity and audit row an action writes. */
  actor: string
  /** The person who set the run off (or the rule's author for clock/webhook runs); metadata only. */
  triggeredBy: string | null
  actorName: string
  projectName: string
  workspaceId: string | null
}
type ActionOutcome = { message: string; skipped?: boolean; touchedTask?: boolean; deletedTask?: boolean }

async function templateVars(ctx: ActionCtx): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    project: ctx.projectName,
    actor: ctx.actorName,
    automation: ctx.row.name,
    date: new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }),
  }
  if (!ctx.event.taskId) return base
  const t = await prisma.task.findUnique({ where: { id: ctx.event.taskId }, select: { title: true, status: true, priority: true, dueDate: true } })
  if (!t) return base
  return {
    ...base,
    task: t.title,
    status: t.status,
    priority: t.priority,
    due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : "",
    url: `/projects/${ctx.row.projectId}/tasks/${ctx.event.taskId}`,
  }
}

async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const m = await prisma.projectMember.findUnique({ where: { userId_projectId: { userId, projectId } }, select: { id: true } })
  return !!m
}

/** "@actor", "@creator" or a user id → user ids (assignees for "@assignees"). */
async function resolvePeople(spec: string[], ctx: ActionCtx): Promise<string[]> {
  const out = new Set<string>()
  const task = ctx.event.taskId
    ? await prisma.task.findUnique({ where: { id: ctx.event.taskId }, select: { creatorId: true, assignees: { select: { userId: true } } } })
    : null
  for (const s of spec) {
    if (s === "@actor") { if (ctx.event.actorId) out.add(ctx.event.actorId) }
    else if (s === "@creator") { if (task) out.add(task.creatorId) }
    else if (s === "@assignees") { task?.assignees.forEach((a) => out.add(a.userId)) }
    else if (s === "@leads") {
      // Who manages a project (lib/rbac.ts): its members with a Manager / BoD / One Above All workspace
      // role, plus anyone still holding the old per-project LEAD role.
      const members = await prisma.projectMember.findMany({
        where: { projectId: ctx.row.projectId },
        select: { userId: true, role: true, user: { select: { workspaceMembers: { where: { workspaceId: ctx.workspaceId ?? "" }, select: { role: true }, take: 1 } } } },
      })
      for (const m of members) {
        const ws = m.user.workspaceMembers[0]?.role
        if (m.role === "LEAD" || isWorkspaceManagerRole(ws)) out.add(m.userId)
      }
    } else if (s) out.add(s)
  }
  return [...out]
}

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === "string" && v) return v.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

async function sectionInProject(sectionId: string | undefined, projectId: string): Promise<string | null> {
  if (!sectionId) return null
  const s = await prisma.taskList.findFirst({ where: { id: sectionId, projectId }, select: { id: true } })
  return s?.id ?? null
}

async function executeAction(action: Rule, ctx: ActionCtx): Promise<ActionOutcome> {
  const taskId = ctx.event.taskId
  const projectId = ctx.row.projectId
  const actor = ctx.actor

  switch (action.type) {
    case "SET_STATUS":
    case "MARK_COMPLETE": {
      const status = action.type === "MARK_COMPLETE" ? "DONE" : action.value
      if (!status || !(TASK_STATUSES as readonly string[]).includes(status)) return { message: "Skipped: no valid status", skipped: true }
      const cur = await prisma.task.findUnique({ where: { id: taskId! }, select: { status: true, taskList: { select: { projectId: true, taskStatus: true } } } })
      if (cur?.status === status) return { message: `Status already ${status}`, skipped: true }
      // Same rule as the task PATCH route (TaskList.taskStatus, project templates): out of a section that
      // stands for a status, the task moves to the first section of its new status, if there is one.
      const statusSection = cur?.taskList.taskStatus && cur.taskList.taskStatus !== status
        ? await prisma.taskList.findFirst({ where: { projectId: cur.taskList.projectId, taskStatus: status as (typeof TASK_STATUSES)[number] }, orderBy: { position: "asc" }, select: { id: true } })
        : null
      await prisma.task.update({
        where: { id: taskId! },
        data: {
          status: status as (typeof TASK_STATUSES)[number],
          ...(statusSection ? { taskListId: statusSection.id } : {}),
        },
      })
      return { message: `Status set to ${status}${statusSection ? " (moved to its section)" : ""}`, touchedTask: true }
    }

    case "SET_PRIORITY": {
      if (!action.value || !(TASK_PRIORITIES as readonly string[]).includes(action.value)) return { message: "Skipped: no valid priority", skipped: true }
      await prisma.task.update({ where: { id: taskId! }, data: { priority: action.value as (typeof TASK_PRIORITIES)[number] } })
      return { message: `Priority set to ${action.value}`, touchedTask: true }
    }

    case "ASSIGN_TO": {
      const ids = await resolvePeople(listOf(action.value), ctx)
      const added: string[] = []
      for (const userId of ids) {
        if (!(await isProjectMember(projectId, userId))) continue
        const existing = await prisma.taskAssignee.findFirst({ where: { taskId: taskId!, userId } })
        if (existing) continue
        await prisma.taskAssignee.create({ data: { taskId: taskId!, userId } })
        await prisma.taskFollower.upsert({ where: { taskId_userId: { taskId: taskId!, userId } }, create: { taskId: taskId!, userId }, update: {} }).catch(() => {})
        added.push(userId)
      }
      if (added.length) {
        const t = await prisma.task.findUnique({ where: { id: taskId! }, select: { title: true } })
        await Promise.allSettled(added.map((assigneeId) => notifyTaskAssigned({
          assigneeId, taskId: taskId!, taskTitle: t?.title ?? "", projectName: ctx.projectName, projectId,
          assignedByName: `⚡ ${ctx.row.name}`,
        })))
      }
      return added.length ? { message: `Assigned ${added.length} person(s)`, touchedTask: true } : { message: "Already assigned (or not a project member)", skipped: true }
    }

    case "UNASSIGN": {
      const spec = listOf(action.value)
      const where = spec.includes("@all") ? { taskId: taskId! } : { taskId: taskId!, userId: { in: await resolvePeople(spec, ctx) } }
      const { count } = await prisma.taskAssignee.deleteMany({ where })
      return count ? { message: `Unassigned ${count} person(s)`, touchedTask: true } : { message: "Nobody to unassign", skipped: true }
    }

    case "MOVE_TO_SECTION": {
      const section = await prisma.taskList.findFirst({ where: { id: action.value ?? "", projectId }, select: { id: true, taskStatus: true } })
      if (!section) return { message: "Skipped: the section no longer exists in this project", skipped: true }
      const cur = await prisma.task.findUnique({ where: { id: taskId! }, select: { status: true, taskListId: true } })
      if (cur?.taskListId === section.id) return { message: "Already in that section", skipped: true }
      // A section that stands for a status gives the task that status (same rule as the task PATCH route).
      const takeStatus = section.taskStatus && section.taskStatus !== cur?.status ? section.taskStatus : null
      await prisma.task.update({
        where: { id: taskId! },
        data: { taskListId: section.id, ...(takeStatus ? { status: takeStatus } : {}) },
      })
      return { message: `Moved to another section${takeStatus ? ` (status ${takeStatus})` : ""}`, touchedTask: true }
    }

    case "ADD_TAG":
    case "REMOVE_TAG": {
      const tag = (action.value ?? "").trim()
      if (!tag) return { message: "Skipped: no tag", skipped: true }
      const t = await prisma.task.findUnique({ where: { id: taskId! }, select: { tags: true } })
      if (!t) return { message: "Skipped: task not found", skipped: true }
      const has = t.tags.some((x) => x.toLowerCase() === tag.toLowerCase())
      if (action.type === "ADD_TAG") {
        if (has) return { message: `Tag "${tag}" already there`, skipped: true }
        await prisma.task.update({ where: { id: taskId! }, data: { tags: [...t.tags, tag] } })
        return { message: `Tag "${tag}" added`, touchedTask: true }
      }
      if (!has) return { message: `No tag "${tag}"`, skipped: true }
      await prisma.task.update({ where: { id: taskId! }, data: { tags: t.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) } })
      return { message: `Tag "${tag}" removed`, touchedTask: true }
    }

    case "SET_FIELD":
      return setField(action, ctx)

    case "ADD_COMMENT": {
      const content = fillTemplate(action.value ?? "", await templateVars(ctx), ctx.event.payload).trim()
      if (!content) return { message: "Skipped: empty comment", skipped: true }
      const comment = await prisma.comment.create({ data: { content: content.slice(0, 5000), taskId: taskId!, userId: actor }, include: { user: true } })
      emitCommentAdded(projectId, taskId!, JSON.parse(JSON.stringify(comment)))
      return { message: "Comment added", touchedTask: true }
    }

    case "SEND_NOTIFICATION": {
      const toSpec = listOf(action.config?.to)
      const recipients = await resolvePeople(toSpec.length ? toSpec : ["@assignees"], ctx)
      if (recipients.length === 0) return { message: "Nobody to notify", skipped: true }
      const vars = await templateVars(ctx)
      const message = fillTemplate(action.value || (vars.task ? `"${vars.task}"` : ctx.row.name), vars, ctx.event.payload).slice(0, 500)
      const title = `⚡ ${ctx.row.name}`
      // Each recipient's own settings decide (notification-service notifyAutomation): Do Not Disturb =
      // nothing; "Automation notifications" off = the in-app row only, no push.
      const outcome = await notifyAutomation({
        userIds: recipients, title, message, taskId: taskId ?? undefined, projectId,
        link: taskId ? `/projects/${projectId}/tasks/${taskId}` : `/projects/${projectId}`,
      })
      const parts = [`Notified ${outcome.sent} person(s)`]
      if (outcome.dnd) parts.push(`${outcome.dnd} on Do Not Disturb`)
      if (outcome.noPush) parts.push(`${outcome.noPush} without push (their setting)`)
      return outcome.sent ? { message: parts.join(", ") } : { message: parts.join(", "), skipped: true }
    }

    case "CREATE_TASK": {
      const vars = await templateVars(ctx)
      const payloadTitle = (() => {
        const p = ctx.event.payload as Record<string, unknown> | undefined
        return p && typeof p.title === "string" ? p.title : undefined
      })()
      const title = fillTemplate(action.value || payloadTitle || ctx.row.name, vars, ctx.event.payload).trim().slice(0, 500) || ctx.row.name
      const sectionId = (await sectionInProject(typeof action.config?.sectionId === "string" ? action.config.sectionId : undefined, projectId))
        ?? (await prisma.taskList.findFirst({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true } }))?.id
      if (!sectionId) return { message: "Skipped: this project has no section", skipped: true }
      // New tasks take the status their section stands for (TaskList.taskStatus), as in POST /api/tasks.
      const sectionStatus = (await prisma.taskList.findUnique({ where: { id: sectionId }, select: { taskStatus: true } }))?.taskStatus ?? null
      const priority = typeof action.config?.priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(action.config.priority) ? action.config.priority : undefined
      const due = typeof action.config?.due === "string" ? resolveDateValue(action.config.due) : null
      const descriptionRaw = typeof action.config?.description === "string" ? action.config.description : undefined
      const description = descriptionRaw ? fillTemplate(descriptionRaw, vars, ctx.event.payload).slice(0, 10000) : undefined
      const assignees: string[] = []
      for (const id of await resolvePeople(listOf(action.config?.assignees), ctx)) if (await isProjectMember(projectId, id)) assignees.push(id)
      const max = await prisma.task.aggregate({ where: { taskListId: sectionId, parentId: null }, _max: { position: true } })
      const task = await prisma.task.create({
        data: {
          title, description, taskListId: sectionId, creatorId: actor, position: (max._max.position ?? -1) + 1,
          ...(sectionStatus ? { status: sectionStatus } : {}),
          ...(priority ? { priority: priority as (typeof TASK_PRIORITIES)[number] } : {}),
          ...(due && due !== "invalid" ? { dueDate: due } : {}),
          ...(assignees.length ? { assignees: { create: assignees.map((userId) => ({ userId })) } } : {}),
        },
        include: TASK_EMIT_INCLUDE,
      })
      await seedTaskCustomFieldValues(task.id, projectId, task.createdAt).catch(() => {})
      emitTaskCreated(projectId, JSON.parse(JSON.stringify(task)))
      return { message: `Created task "${title}"` }
    }

    case "CREATE_SUBTASK": {
      const parent = await prisma.task.findUnique({ where: { id: taskId! }, select: { taskListId: true } })
      if (!parent) return { message: "Skipped: parent task not found", skipped: true }
      const title = fillTemplate(action.value || "Subtask", await templateVars(ctx), ctx.event.payload).trim().slice(0, 500) || "Subtask"
      const sub = await prisma.task.create({ data: { title, taskListId: parent.taskListId, creatorId: actor, parentId: taskId! } })
      await seedTaskCustomFieldValues(sub.id, projectId, sub.createdAt).catch(() => {})
      return { message: `Created subtask "${title}"`, touchedTask: true }
    }

    case "DUPLICATE_TASK": {
      const src = await prisma.task.findUnique({
        where: { id: taskId! },
        include: { assignees: { select: { userId: true } }, customFieldValues: { select: { customFieldId: true, value: true } } },
      })
      if (!src) return { message: "Skipped: task not found", skipped: true }
      const sectionId = (await sectionInProject(typeof action.config?.sectionId === "string" ? action.config.sectionId : undefined, projectId)) ?? src.taskListId
      const suffix = typeof action.value === "string" ? action.value : " (copy)"
      const copy = await prisma.task.create({
        data: {
          title: `${src.title}${suffix}`.slice(0, 500), description: src.description, priority: src.priority, tags: src.tags,
          taskType: src.taskType, dueDate: src.dueDate, startDate: src.startDate, estimatedHours: src.estimatedHours,
          taskListId: sectionId, creatorId: actor, parentId: src.parentId,
          assignees: src.assignees.length ? { create: src.assignees.map((a) => ({ userId: a.userId })) } : undefined,
        },
        include: TASK_EMIT_INCLUDE,
      })
      if (src.customFieldValues.length) {
        await prisma.customFieldValue.createMany({ data: src.customFieldValues.map((v) => ({ customFieldId: v.customFieldId, taskId: copy.id, value: v.value })), skipDuplicates: true })
      }
      await seedTaskCustomFieldValues(copy.id, projectId, copy.createdAt).catch(() => {})
      emitTaskCreated(projectId, JSON.parse(JSON.stringify(copy)))
      return { message: `Duplicated as "${copy.title}"` }
    }

    case "ARCHIVE_TASK": {
      // NEXUS has no archived flag on tasks: archiving = the normal restorable delete, so the task can be
      // brought back from Control Room → Audit (90 days), exactly like a delete by hand.
      const t = await prisma.task.findUnique({ where: { id: taskId! }, select: { title: true, taskProjects: { select: { projectId: true } } } })
      if (!t) return { message: "Skipped: task not found", skipped: true }
      await restorableDelete({
        entityType: "task", entityId: taskId!, entityName: t.title, workspaceId: ctx.workspaceId,
        userId: actor, metadata: { title: t.title, projectId, projectName: ctx.projectName, automationId: ctx.row.id, automation: ctx.row.name, triggeredBy: ctx.triggeredBy },
        meta: { open: { type: "task", id: taskId!, projectId }, projectId, taskId: taskId! },
        remove: (tx) => tx.task.delete({ where: { id: taskId! } }),
      })
      for (const pid of new Set([projectId, ...t.taskProjects.map((p) => p.projectId)])) emitTaskDeleted(pid, taskId!)
      return { message: "Archived (restorable from Audit)", deletedTask: true }
    }

    case "CALL_WEBHOOK":
      return callWebhook(action, ctx)

    default:
      return { message: `Unknown action ${action.type}`, skipped: true }
  }
}

async function setField(action: Rule, ctx: ActionCtx): Promise<ActionOutcome> {
  const taskId = ctx.event.taskId!
  const field = action.field ?? ""
  if (field === "dueDate" || field === "startDate") {
    const d = resolveDateValue(action.value)
    if (d === "invalid") return { message: `Skipped: "${action.value}" is not a date`, skipped: true }
    await prisma.task.update({ where: { id: taskId }, data: { [field]: d } })
    return { message: d ? `${field === "dueDate" ? "Due date" : "Start date"} set to ${d.toISOString().slice(0, 10)}` : `${field === "dueDate" ? "Due date" : "Start date"} cleared`, touchedTask: true }
  }
  if (field === "title" || field === "description") {
    const v = fillTemplate(action.value ?? "", await templateVars(ctx), ctx.event.payload)
    if (field === "title" && !v.trim()) return { message: "Skipped: empty title", skipped: true }
    await prisma.task.update({ where: { id: taskId }, data: { [field]: field === "title" ? v.trim().slice(0, 500) : v.slice(0, 10000) } })
    return { message: `${field === "title" ? "Title" : "Description"} updated`, touchedTask: true }
  }
  if (field.startsWith("cf:")) {
    const fieldId = field.slice(3)
    const cf = await prisma.customField.findFirst({ where: { id: fieldId, projectId: ctx.row.projectId }, select: { id: true, type: true, name: true } })
    if (!cf) return { message: "Skipped: the field no longer exists in this project", skipped: true }
    const type = normalizeCustomFieldType(cf.type)
    if (!type || type === "CREATED" || type === "FILE") return { message: `Skipped: ${cf.name} cannot be set by an automation`, skipped: true }
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { createdAt: true } })
    let raw: unknown = action.value ?? ""
    if (type === "MULTI_SELECT") raw = listOf(action.value)
    if (type === "DATE") {
      const d = resolveDateValue(action.value)
      if (d === "invalid") return { message: `Skipped: "${action.value}" is not a date`, skipped: true }
      raw = d ? d.toISOString().slice(0, 10) : ""
    }
    const value = serializeCustomFieldValue(type, raw, task?.createdAt)
    await prisma.customFieldValue.upsert({
      where: { customFieldId_taskId: { customFieldId: cf.id, taskId } },
      update: { value },
      create: { customFieldId: cf.id, taskId, value },
    })
    return { message: `${cf.name} set`, touchedTask: true }
  }
  return { message: `Skipped: unknown field ${field}`, skipped: true }
}

async function callWebhook(action: Rule, ctx: ActionCtx): Promise<ActionOutcome> {
  const url = action.value ?? ""
  const blocked = await webhookUrlError(url)
  if (blocked) throw new Error(blocked)
  const task = ctx.event.taskId
    ? await prisma.task.findUnique({
        where: { id: ctx.event.taskId },
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true, startDate: true, tags: true, taskListId: true,
          assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
        },
      })
    : null
  const body = JSON.stringify({
    event: "automation.fired",
    timestamp: new Date().toISOString(),
    automation: { id: ctx.row.id, name: ctx.row.name },
    project: { id: ctx.row.projectId, name: ctx.projectName },
    trigger: ctx.event.kind,
    task: task ? { ...task, assignees: task.assignees.map((a) => a.user) } : null,
    changes: ctx.event.changes ?? null,
  })
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    body,
    headers: { "Content-Type": "application/json", "User-Agent": "NEXUS-Automation/1", "X-Nexus-Automation": ctx.row.id },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Webhook answered HTTP ${res.status}`)
  return { message: `Webhook answered HTTP ${res.status}` }
}

// ── Clock: due dates and schedules (called every minute by lib/automation-ticker.ts and /api/cron/automations) ──

const SCAN_LIMIT = 200

/**
 * One pass over every enabled time-based rule. Each firing carries a dedup key (per task and due date, or
 * per schedule slot), so running this twice in the same minute, or from two places, fires once.
 */
export async function runTimeBasedAutomations(now = new Date()): Promise<{ checked: number; fired: number }> {
  const rows = (await prisma.automation.findMany({ where: { enabled: true }, select: ROW_SELECT })) as AutomationRow[]
  let checked = 0
  let fired = 0
  for (const row of rows) {
    const trigger = normalizeTrigger(row.trigger)
    if (!trigger) continue
    try {
      if (trigger.type === "DUE_DATE_APPROACHING" || trigger.type === "DUE_DATE_REACHED") {
        checked++
        const hours = trigger.type === "DUE_DATE_APPROACHING" ? Math.min(720, Math.max(1, Number(trigger.value) || 24)) : 0
        const windowStart = trigger.type === "DUE_DATE_REACHED"
          // Only due dates that passed in the last day and after the rule was made: turning a rule on must
          // not fire on every old overdue task at once.
          ? new Date(Math.max(now.getTime() - 24 * 3_600_000, row.createdAt.getTime()))
          : now
        const windowEnd = trigger.type === "DUE_DATE_REACHED" ? now : new Date(now.getTime() + hours * 3_600_000)
        const tasks = await prisma.task.findMany({
          where: {
            taskList: { projectId: row.projectId },
            status: { notIn: ["DONE", "CANCELLED"] },
            dueDate: { gte: windowStart, lte: windowEnd },
          },
          select: { id: true, dueDate: true },
          take: SCAN_LIMIT,
          orderBy: { dueDate: "asc" },
        })
        for (const t of tasks) {
          const kind = trigger.type === "DUE_DATE_REACHED" ? "due_reached" : "due_approaching"
          const res = await runOne(row, { kind, projectId: row.projectId, actorId: null, taskId: t.id }, { dedupKey: `${kind}:${t.id}:${t.dueDate!.toISOString()}` })
          if (res) fired++
        }
      } else if (trigger.type === "SCHEDULED") {
        checked++
        const schedule = scheduleOf(trigger)
        if (!schedule) continue
        const slot = dueSlot(schedule, now, row.createdAt)
        if (!slot) continue
        const conditions = normalizeConditions(row.conditions, row.condition)
        if (conditions) {
          // "Every Monday 09:00, for tasks where …": run once per matching task, each with its own key.
          const tasks = await prisma.task.findMany({ where: { taskList: { projectId: row.projectId } }, select: { id: true }, take: 1000, orderBy: { createdAt: "desc" } })
          let n = 0
          for (const t of tasks) {
            const facts = await taskFacts(t.id)
            if (!facts || !conditionsHold(conditions, facts, now)) continue
            const res = await runOne(row, { kind: "scheduled", projectId: row.projectId, actorId: null, taskId: t.id }, { dedupKey: `${slot.key}:${t.id}` })
            if (res) fired++
            if (++n >= SCAN_LIMIT) break
          }
        } else {
          const res = await runOne(row, { kind: "scheduled", projectId: row.projectId, actorId: null }, { dedupKey: slot.key })
          if (res) fired++
        }
      }
    } catch (err) {
      log.error("time-based automation failed", { id: row.id, error: String(err) })
    }
  }
  return { checked, fired }
}

/** Keep the run log bounded: 90 days. Called hourly by the ticker. */
export async function pruneAutomationRuns(now = new Date()): Promise<number> {
  const { count } = await prisma.automationRun.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } })
  return count
}

/** Fire one rule now, by hand ("Run now" in the builder) or from its inbound webhook. */
export async function runAutomationNow(automationId: string, event: Omit<AutomationEvent, "projectId">, opts: { manual?: boolean } = {}): Promise<RunResult | null> {
  const row = (await prisma.automation.findUnique({ where: { id: automationId }, select: ROW_SELECT })) as AutomationRow | null
  if (!row) return null
  return runOne(row, { ...event, projectId: row.projectId }, { manual: opts.manual })
}
