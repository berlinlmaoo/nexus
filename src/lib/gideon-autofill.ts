import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { askGideon } from "@/lib/gideon-chat"
import { checkProjectAccess } from "@/lib/rbac"
import { emitTaskUpdated } from "@/lib/socket-emitter"
import { createInAppNotification } from "@/lib/notification-service"
import { normalizeCustomFieldOptions, normalizeCustomFieldType, serializeCustomFieldValue, type SupportedCustomFieldType } from "@/lib/custom-fields"
import { autofillPrompt, coerceAutofillValue, extractJsonObject, type AutofillField } from "@/lib/gideon-autofill-core"

/**
 * AI Autofill for project custom fields (owner, 12 Oct 2026 — Notion "AI Autofill"). A field can be
 * filled by GIDEON from the task itself: summarise it, classify it into the field's existing options, or
 * extract a value (a date, an amount, a link…). It runs
 *   - on demand ("Fill empty" / "Refill all" in the AI Autofill panel) as the person who clicked;
 *   - when a task is created / its title or description changes, as the person whose edit fired it.
 * Either way the person needs write access to the project (the same as typing the value by hand), and
 * GIDEON only reads that one task's own content. approval "review" (default) turns every value into a
 * GideonProposal the person approves in the GIDEON panel; "auto" writes it straight away.
 * A value GIDEON wrote is remembered (CustomFieldAiFill) for the ✨ marker.
 */
const log = createLogger("gideon-autofill")

export const AUTOFILL_TYPES: SupportedCustomFieldType[] = ["TEXT", "URL", "NUMBER", "SELECT", "MULTI_SELECT", "STATUS", "DATE"]
export const AUTOFILL_MODES = ["summary", "classify", "extract"] as const
/** One click fills at most this many tasks (one GIDEON call). Run again for the next batch. */
export const AUTOFILL_BATCH = 25
/** Event-driven fills per project per day; past this, only on-demand runs. */
const DAILY_EVENT_CAP = 200

type FieldRow = { id: string; name: string; type: string; options: unknown; projectId: string }

function fieldOf(row: FieldRow, cfg: { mode: string; prompt: string | null }): AutofillField | null {
  const type = normalizeCustomFieldType(row.type)
  if (!type || !AUTOFILL_TYPES.includes(type)) return null
  const opts = normalizeCustomFieldOptions(type, row.options)
  return { id: row.id, name: row.name, type, options: opts?.options ?? [], mode: (AUTOFILL_MODES as readonly string[]).includes(cfg.mode) ? (cfg.mode as AutofillField["mode"]) : "summary", prompt: cfg.prompt }
}

export type AutofillResult = { ok: boolean; runId: string | null; filled: number; proposed: number; skipped: number; error?: string; remaining?: number }

/**
 * Fill `fields` on `taskIds` (all in `projectId`) as `actorId`. One GIDEON call. Never throws.
 */
export async function runAutofill(input: { projectId: string; fieldIds: string[]; taskIds: string[]; actorId: string; trigger: "manual" | "create" | "update" }): Promise<AutofillResult> {
  const empty: AutofillResult = { ok: false, runId: null, filled: 0, proposed: 0, skipped: 0 }
  try {
    if (!process.env.GIDEON_CHAT_URL) return { ...empty, error: "GIDEON isn't connected on this server." }
    const actor = await prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true, email: true, deactivatedAt: true } })
    if (!actor || actor.deactivatedAt) return { ...empty, error: "Unknown person" }
    if (!(await checkProjectAccess(actor.id, input.projectId, ["MEMBER"])).allowed) return { ...empty, error: "You can't edit fields in this project." }

    const configs = await prisma.customFieldAutofill.findMany({ where: { projectId: input.projectId, customFieldId: { in: input.fieldIds }, ...(input.trigger === "manual" ? {} : { enabled: true }) } })
    const rows = await prisma.customField.findMany({ where: { id: { in: configs.map((c) => c.customFieldId) }, projectId: input.projectId }, select: { id: true, name: true, type: true, options: true, projectId: true } })
    const fields = rows.map((r) => fieldOf(r, configs.find((c) => c.customFieldId === r.id)!)).filter((f): f is AutofillField => Boolean(f))
    if (!fields.length) return { ...empty, error: "No AI Autofill field to fill" }
    const approval = configs.some((c) => c.approval === "review") ? "review" : "auto"

    const tasks = await prisma.task.findMany({
      where: { id: { in: input.taskIds.slice(0, AUTOFILL_BATCH) }, taskList: { projectId: input.projectId } },
      select: {
        id: true, title: true, description: true, status: true, priority: true, dueDate: true, createdAt: true,
        taskList: { select: { name: true } },
        assignees: { select: { user: { select: { name: true } } } },
        customFieldValues: { select: { customFieldId: true, value: true, customField: { select: { name: true } } } },
      },
    })
    if (!tasks.length) return { ...empty, ok: true }
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true } })

    const prompt = autofillPrompt(project?.name ?? "", fields, tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: (t.description ?? "").slice(0, 1200),
      status: t.status,
      priority: t.priority,
      due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      section: t.taskList?.name ?? "",
      assignees: t.assignees.map((a) => a.user.name).filter(Boolean) as string[],
      fields: Object.fromEntries(t.customFieldValues.filter((v) => v.value && !fields.some((f) => f.id === v.customFieldId)).map((v) => [v.customField.name, v.value.slice(0, 200)])),
    })))

    let runId: string | null = null
    const reply = await askGideon({
      prompt,
      user: actor.name ?? "",
      actorEmail: actor.email ?? actor.id,
      trigger: "AUTOFILL",
      approvalMode: approval === "review" ? "always_ask" : "dont_ask",
      projectId: input.projectId,
      title: `AI Autofill · ${fields.map((f) => f.name).join(", ")} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
      model: "luna",
      timeoutMs: 180_000,
      tag: `autofill ${input.projectId}`,
      onRun: (id) => { runId = id },
    }).catch((e) => { log.error("autofill call failed", { error: String(e) }); return null })
    const stamp = (status: string) => prisma.customFieldAutofill.updateMany({ where: { customFieldId: { in: fields.map((f) => f.id) } }, data: { lastRunAt: new Date(), lastStatus: status } }).catch(() => {})
    if (!reply) { await stamp("FAILED"); return { ...empty, runId, error: "GIDEON didn't answer. Try again." } }
    const parsed = extractJsonObject(reply)
    if (!parsed) { await stamp("FAILED"); return { ...empty, runId, error: "GIDEON's answer couldn't be read. Try again." } }

    let filled = 0
    let proposed = 0
    let skipped = 0
    for (const t of tasks) {
      const perTask = parsed[t.id]
      const updates: Array<{ field: AutofillField; value: unknown; serialized: string }> = []
      for (const f of fields) {
        const raw = perTask && typeof perTask === "object" ? (perTask as Record<string, unknown>)[f.id] ?? (perTask as Record<string, unknown>)[f.name] : fields.length === 1 ? perTask : undefined
        const value = coerceAutofillValue(f, raw)
        if (value === null) { skipped++; continue }
        const v = f.type === "NUMBER" ? String(value) : value
        const serialized = serializeCustomFieldValue(f.type as SupportedCustomFieldType, v, t.createdAt, rows.find((r) => r.id === f.id)?.options)
        const current = t.customFieldValues.find((x) => x.customFieldId === f.id)?.value ?? ""
        if (serialized === current) { skipped++; continue }
        updates.push({ field: f, value: v, serialized })
      }
      if (!updates.length) continue
      const cfgApproval = (fid: string) => configs.find((c) => c.customFieldId === fid)?.approval ?? "review"
      const direct = updates.filter((u) => cfgApproval(u.field.id) === "auto")
      const held = updates.filter((u) => cfgApproval(u.field.id) !== "auto")
      if (direct.length) {
        for (const u of direct) {
          await prisma.customFieldValue.upsert({
            where: { customFieldId_taskId: { customFieldId: u.field.id, taskId: t.id } },
            update: { value: u.serialized },
            create: { customFieldId: u.field.id, taskId: t.id, value: u.serialized },
          })
          await markAiFill(u.field.id, t.id, u.serialized, runId)
          filled++
        }
        await emitTask(t.id)
      }
      if (held.length) {
        const current = (fid: string) => t.customFieldValues.find((x) => x.customFieldId === fid)?.value || "—"
        await prisma.gideonProposal.create({
          data: {
            runId,
            userId: actor.id,
            action: "update_task",
            input: { taskId: t.id, customFields: held.map((u) => ({ fieldId: u.field.id, value: u.value })), aiFill: held.map((u) => ({ fieldId: u.field.id, value: u.serialized })) } as object,
            summary: `AI Autofill on “${t.title}”`.slice(0, 300),
            diff: held.map((u) => ({ field: u.field.name, from: current(u.field.id).slice(0, 200), to: u.serialized.slice(0, 300) })) as unknown as object,
            projectId: input.projectId,
            taskId: t.id,
          },
        })
        proposed += held.length
      }
    }
    await stamp("SUCCEEDED")
    if (proposed > 0) {
      createInAppNotification({
        userId: actor.id,
        type: "gideon_proposal",
        title: "GIDEON is waiting for your approval",
        message: `AI Autofill suggested ${proposed} value${proposed === 1 ? "" : "s"} in ${project?.name ?? "a project"}. Open GIDEON to review.`,
        projectId: input.projectId,
        link: `/projects/${input.projectId}`,
        push: false,
      }).catch(() => {})
    }
    return { ok: true, runId, filled, proposed, skipped }
  } catch (error) {
    log.error("autofill failed", { error: String(error) })
    return { ...empty, error: "Autofill failed" }
  }
}

/** The last on-demand result per field, for the panel's "Filled 3 · 2 waiting for you" line (in memory). */
const gr = globalThis as unknown as { __autofillLast?: Map<string, AutofillResult & { at: string }> }
export const lastAutofillResults = (gr.__autofillLast ??= new Map())

export async function markAiFill(customFieldId: string, taskId: string, value: string, runId: string | null) {
  await prisma.customFieldAiFill.upsert({
    where: { customFieldId_taskId: { customFieldId, taskId } },
    update: { value, runId, filledAt: new Date() },
    create: { customFieldId, taskId, value, runId },
  }).catch(() => {})
}

const EMIT_INCLUDE = {
  assignees: { include: { user: true } },
  creator: true,
  taskList: true,
  _count: { select: { subtasks: true, comments: true } },
} as const

async function emitTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: EMIT_INCLUDE }).catch(() => null)
  if (task) emitTaskUpdated(task.taskList.projectId, JSON.parse(JSON.stringify(task)))
}

// ── On create / on change ─────────────────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __autofillTimers?: Map<string, ReturnType<typeof setTimeout>> }
const timers = (g.__autofillTimers ??= new Map())
const DEBOUNCE_MS = 20_000

/**
 * Called for every project event (from runAutomations). Queues a fill of the project's enabled AI fields
 * for the task — debounced, so typing a description does not fire one call per keystroke-save. Edits that
 * GIDEON / Autofill itself make never raise events, so this cannot loop. Never throws.
 */
export function autofillOnEvent(event: { kind: string; projectId: string; actorId: string | null; taskId?: string; changes?: Record<string, unknown> }) {
  if (!event.taskId || !event.actorId || !process.env.GIDEON_CHAT_URL) return
  const created = event.kind === "task_created" || event.kind === "form_submitted"
  const edited = event.kind === "task_updated" && Boolean(event.changes && ("title" in event.changes || "description" in event.changes))
  if (!created && !edited) return
  void (async () => {
    try {
      const configs = await prisma.customFieldAutofill.findMany({ where: { projectId: event.projectId, enabled: true, ...(created ? { onCreate: true } : { onUpdate: true }) }, select: { customFieldId: true } })
      if (!configs.length) return
      const key = `${event.taskId}`
      const prev = timers.get(key)
      if (prev) clearTimeout(prev)
      timers.set(key, setTimeout(() => {
        timers.delete(key)
        void (async () => {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
          const today = await prisma.gideonRun.count({ where: { trigger: "AUTOFILL", projectId: event.projectId, startedAt: { gte: since } } })
          if (today >= DAILY_EVENT_CAP) { log.info("autofill skipped: daily cap", { projectId: event.projectId }); return }
          await runAutofill({ projectId: event.projectId, fieldIds: configs.map((c) => c.customFieldId), taskIds: [event.taskId!], actorId: event.actorId!, trigger: created ? "create" : "update" })
        })()
      }, DEBOUNCE_MS))
      timers.get(key)?.unref?.()
    } catch (error) {
      log.error("autofillOnEvent failed", { error: String(error) })
    }
  })()
}
