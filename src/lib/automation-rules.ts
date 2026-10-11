/**
 * Project automations: the vocabulary and the pure rules (owner, 12 Oct 2026, "When / If / Do").
 *
 * No database here, so it is unit-tested on its own (automation-rules.test.mjs) and the engine
 * (automation-engine.ts), the API (api/automations) and the cron share ONE definition of what a rule is.
 *
 * Stored shape of an Automation row (all JSON):
 *   trigger    { type, value?, field?, config? }      type is always one of TRIGGER_TYPES (upper case)
 *   action     { type, value?, field?, config? }      the FIRST action, kept for released iOS/Android
 *                                                     (they decode {type, field?, value?} as strings)
 *   actions    [{ type, value?, field?, config? }]    every action, run in order (null on old rows)
 *   condition  { type, value? }                       the old single condition (PRIORITY_IS …), still honoured
 *   conditions { match: "all" | "any", rules: [{ field, op, value? }] }
 *
 * The bug this file exists for: the web UI saved trigger types in lower case ("task_created") while the
 * engine compared upper case ("TASK_CREATED"), so no rule made on the web ever fired. Every type is now
 * normalised on save AND on read (normalizeTrigger / normalizeAction), whatever the client sent.
 */

export const TRIGGER_TYPES = [
  "TASK_CREATED",
  "TASK_UPDATED",
  "STATUS_CHANGED",
  "TASK_COMPLETED",
  "ASSIGNEE_CHANGED",
  "FIELD_CHANGED",
  "DUE_DATE_APPROACHING",
  "DUE_DATE_REACHED",
  "COMMENT_ADDED",
  "FORM_SUBMITTED",
  "SCHEDULED",
  "WEBHOOK_RECEIVED",
] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const ACTION_TYPES = [
  "SET_STATUS",
  "MARK_COMPLETE",
  "SET_PRIORITY",
  "ASSIGN_TO",
  "UNASSIGN",
  "SET_FIELD",
  "MOVE_TO_SECTION",
  "ADD_TAG",
  "REMOVE_TAG",
  "ADD_COMMENT",
  "SEND_NOTIFICATION",
  "CREATE_TASK",
  "CREATE_SUBTASK",
  "DUPLICATE_TASK",
  "ARCHIVE_TASK",
  "CALL_WEBHOOK",
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** Actions that need a task to act on. Under a scheduled or webhook trigger with no task they are skipped. */
export const TASK_ACTIONS = new Set<ActionType>([
  "SET_STATUS", "MARK_COMPLETE", "SET_PRIORITY", "ASSIGN_TO", "UNASSIGN", "SET_FIELD", "MOVE_TO_SECTION",
  "ADD_TAG", "REMOVE_TAG", "ADD_COMMENT", "CREATE_SUBTASK", "DUPLICATE_TASK", "ARCHIVE_TASK",
])

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const
export const TASK_PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const

/** Built-in task fields a FIELD_CHANGED trigger, a condition or SET_FIELD can name. Custom fields are "cf:<id>". */
export const TASK_FIELDS = ["status", "priority", "assignee", "section", "tags", "title", "description", "dueDate", "startDate", "creator"] as const

export const CONDITION_OPS = ["is", "is_not", "contains", "not_contains", "is_empty", "is_not_empty", "gt", "lt", "overdue", "within_days"] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

export const MAX_ACTIONS = 10
export const MAX_CONDITIONS = 10
export const MAX_TEXT = 2000

export interface Rule {
  type: string
  value?: string
  field?: string
  config?: Record<string, unknown>
}
export interface ConditionRule {
  field: string
  op: ConditionOp
  value?: string
}
export interface Conditions {
  match: "all" | "any"
  rules: ConditionRule[]
}

// ── Aliases ────────────────────────────────────────────────────────────────────────────────────
// Every spelling a client or an older server ever stored. Keys are compared upper-cased.

const TRIGGER_ALIASES: Record<string, TriggerType> = {
  TASK_CREATED: "TASK_CREATED",
  CREATED: "TASK_CREATED",
  PAGE_ADDED: "TASK_CREATED",
  TASK_UPDATED: "TASK_UPDATED",
  UPDATED: "TASK_UPDATED",
  ANY_PROPERTY_EDITED: "TASK_UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  STATUS_CHANGE: "STATUS_CHANGED",
  TASK_STATUS_CHANGED: "STATUS_CHANGED",
  TASK_COMPLETED: "TASK_COMPLETED",
  COMPLETED: "TASK_COMPLETED",
  ASSIGNEE_CHANGED: "ASSIGNEE_CHANGED",
  TASK_ASSIGNED: "ASSIGNEE_CHANGED",
  ASSIGNED: "ASSIGNEE_CHANGED",
  FIELD_CHANGED: "FIELD_CHANGED",
  PROPERTY_CHANGED: "FIELD_CHANGED",
  TAG_ADDED: "FIELD_CHANGED",
  DUE_DATE_APPROACHING: "DUE_DATE_APPROACHING",
  TASK_DUE_APPROACHING: "DUE_DATE_APPROACHING",
  DUE_SOON: "DUE_DATE_APPROACHING",
  DUE_DATE_REACHED: "DUE_DATE_REACHED",
  DUE_DATE_PASSED: "DUE_DATE_REACHED",
  OVERDUE: "DUE_DATE_REACHED",
  COMMENT_ADDED: "COMMENT_ADDED",
  FORM_SUBMITTED: "FORM_SUBMITTED",
  SCHEDULED: "SCHEDULED",
  SCHEDULE: "SCHEDULED",
  EVERY: "SCHEDULED",
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK: "WEBHOOK_RECEIVED",
  WEBHOOK_IN: "WEBHOOK_RECEIVED",
}

const ACTION_ALIASES: Record<string, ActionType> = {
  SET_STATUS: "SET_STATUS",
  CHANGE_STATUS: "SET_STATUS",
  MARK_COMPLETE: "MARK_COMPLETE",
  COMPLETE: "MARK_COMPLETE",
  SET_PRIORITY: "SET_PRIORITY",
  ASSIGN_TO: "ASSIGN_TO",
  ASSIGN_USER: "ASSIGN_TO",
  ASSIGN: "ASSIGN_TO",
  UNASSIGN: "UNASSIGN",
  SET_FIELD: "SET_FIELD",
  EDIT_PROPERTY: "SET_FIELD",
  MOVE_TO_SECTION: "MOVE_TO_SECTION",
  MOVE: "MOVE_TO_SECTION",
  ADD_TAG: "ADD_TAG",
  REMOVE_TAG: "REMOVE_TAG",
  ADD_COMMENT: "ADD_COMMENT",
  COMMENT: "ADD_COMMENT",
  SEND_NOTIFICATION: "SEND_NOTIFICATION",
  NOTIFY: "SEND_NOTIFICATION",
  CREATE_TASK: "CREATE_TASK",
  ADD_PAGE: "CREATE_TASK",
  CREATE_SUBTASK: "CREATE_SUBTASK",
  DUPLICATE_TASK: "DUPLICATE_TASK",
  DUPLICATE: "DUPLICATE_TASK",
  ARCHIVE_TASK: "ARCHIVE_TASK",
  ARCHIVE: "ARCHIVE_TASK",
  CALL_WEBHOOK: "CALL_WEBHOOK",
  SEND_WEBHOOK: "CALL_WEBHOOK",
  WEBHOOK: "CALL_WEBHOOK",
}

const LEGACY_CONDITION: Record<string, { field: string; op: ConditionOp }> = {
  PRIORITY_IS: { field: "priority", op: "is" },
  STATUS_IS: { field: "status", op: "is" },
  ASSIGNEE_IS: { field: "assignee", op: "is" },
  TAGS_CONTAIN: { field: "tags", op: "contains" },
}

function key(type: unknown): string {
  return typeof type === "string" ? type.trim().toUpperCase().replace(/[\s.-]+/g, "_") : ""
}

function str(v: unknown, max = MAX_TEXT): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string") return v.slice(0, max)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return undefined
}

function plainConfig(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue
    if (typeof val === "string") out[k] = val.slice(0, MAX_TEXT)
    else if (typeof val === "number" || typeof val === "boolean" || val === null) out[k] = val
    else if (Array.isArray(val)) out[k] = val.filter((x) => typeof x === "string" || typeof x === "number").slice(0, 50)
  }
  return Object.keys(out).length ? out : undefined
}

export function canonicalTriggerType(type: unknown): TriggerType | null {
  return TRIGGER_ALIASES[key(type)] ?? null
}

export function canonicalActionType(type: unknown): ActionType | null {
  return ACTION_ALIASES[key(type)] ?? null
}

/**
 * Any stored or posted trigger → the canonical shape, or null when the type is unknown. Lower-case and
 * legacy spellings ("task_created", "status_change", "due_date_passed", "tag_added") are mapped.
 */
export function normalizeTrigger(raw: unknown): Rule | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const rawKey = key(r.type)
  const type = canonicalTriggerType(r.type)
  if (!type) return null
  const out: Rule = { type }
  let value = str(r.value)
  let field = str(r.field, 200)
  // Suggestions spelled "tag added: X" as its own trigger; it is a FIELD_CHANGED on tags.
  if (rawKey === "TAG_ADDED") field = "tags"
  // A status trigger's field is always status; drop the noise the suggestions sent.
  if (type === "STATUS_CHANGED" || type === "ASSIGNEE_CHANGED") field = undefined
  if (type === "STATUS_CHANGED" && value) value = value.toUpperCase()
  if (type === "FIELD_CHANGED" && field === "status" && value) value = value.toUpperCase()
  if (type === "FIELD_CHANGED" && field === "priority" && value) value = value.toUpperCase()
  if (value) out.value = value
  if (field) out.field = field
  const config = plainConfig(r.config)
  if (config) out.config = config
  return out
}

/** Any stored or posted action → canonical, or null. `set_field priority=HIGH` becomes SET_PRIORITY HIGH. */
export function normalizeAction(raw: unknown): Rule | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  let type = canonicalActionType(r.type)
  if (!type) return null
  let field = str(r.field, 200)
  let value = str(r.value)
  if (type === "SET_FIELD" && field === "priority") { type = "SET_PRIORITY"; field = undefined }
  else if (type === "SET_FIELD" && field === "status") { type = "SET_STATUS"; field = undefined }
  else if (type === "SET_FIELD" && (field === "section" || field === "taskListId")) { type = "MOVE_TO_SECTION"; field = undefined }
  else if (type === "SET_FIELD" && field === "assignee") { type = "ASSIGN_TO"; field = undefined }
  if (type === "ASSIGN_TO" || type === "SET_STATUS" || type === "SET_PRIORITY") field = undefined
  if ((type === "SET_STATUS" || type === "SET_PRIORITY") && value) value = value.toUpperCase()
  const out: Rule = { type }
  if (value !== undefined && value !== "") out.value = value
  if (field) out.field = field
  const config = plainConfig(r.config)
  if (config) out.config = config
  return out
}

export function normalizeConditions(raw: unknown, legacy?: unknown): Conditions | null {
  const rules: ConditionRule[] = []
  let match: "all" | "any" = "all"
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { rules?: unknown }).rules : undefined
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { match?: unknown }).match === "any") match = "any"
  if (Array.isArray(list)) {
    for (const item of list.slice(0, MAX_CONDITIONS)) {
      if (!item || typeof item !== "object") continue
      const c = item as Record<string, unknown>
      const field = str(c.field, 200)
      const op = typeof c.op === "string" ? (c.op.toLowerCase() as ConditionOp) : "is"
      if (!field || !(CONDITION_OPS as readonly string[]).includes(op)) continue
      const value = str(c.value)
      rules.push({ field, op, ...(value !== undefined && value !== "" ? { value } : {}) })
    }
  }
  if (legacy && typeof legacy === "object") {
    const l = legacy as Record<string, unknown>
    const mapped = LEGACY_CONDITION[key(l.type)]
    if (mapped) rules.push({ field: mapped.field, op: mapped.op, ...(str(l.value) ? { value: str(l.value) } : {}) })
  }
  return rules.length ? { match, rules } : null
}

/** The action list of a row: `actions` when set, else the single `action` (rows from before 12 Oct 2026). */
export function actionsOf(row: { action?: unknown; actions?: unknown }): Rule[] {
  const list = Array.isArray(row.actions) && row.actions.length ? row.actions : row.action ? [row.action] : []
  return list.map(normalizeAction).filter((a): a is Rule => !!a).slice(0, MAX_ACTIONS)
}

// ── Validation (save time) ─────────────────────────────────────────────────────────────────────

/** Why this trigger cannot be saved, or null. */
export function triggerError(t: Rule): string | null {
  switch (t.type) {
    case "FIELD_CHANGED":
      if (!t.field) return "Pick the field to watch"
      return null
    case "DUE_DATE_APPROACHING": {
      if (t.value === undefined) return null
      const h = Number(t.value)
      if (!Number.isFinite(h) || h < 1 || h > 24 * 30) return "Hours before due must be between 1 and 720"
      return null
    }
    case "SCHEDULED": {
      const s = scheduleOf(t)
      if (!s) return "Pick when it runs"
      return null
    }
    default:
      return null
  }
}

export function actionError(a: Rule): string | null {
  switch (a.type) {
    case "SET_STATUS":
      return a.value && (TASK_STATUSES as readonly string[]).includes(a.value) ? null : "Pick a status"
    case "SET_PRIORITY":
      return a.value && (TASK_PRIORITIES as readonly string[]).includes(a.value) ? null : "Pick a priority"
    case "ASSIGN_TO":
    case "UNASSIGN":
      return a.value ? null : "Pick a person"
    case "MOVE_TO_SECTION":
      return a.value ? null : "Pick a section"
    case "ADD_TAG":
    case "REMOVE_TAG":
      return a.value?.trim() ? null : "Type a tag"
    case "ADD_COMMENT":
      return a.value?.trim() ? null : "Write the comment"
    case "SET_FIELD":
      return a.field ? null : "Pick the field to set"
    case "CALL_WEBHOOK": {
      if (!a.value) return "Paste the webhook URL"
      try {
        const u = new URL(a.value)
        if (u.protocol !== "https:") return "Webhook URL must use https"
      } catch {
        return "Invalid URL"
      }
      return null
    }
    default:
      return null
  }
}

// ── Matching ───────────────────────────────────────────────────────────────────────────────────

/** One field's move in a task update. Assignees carry the ids added and removed. */
export interface FieldChange {
  from?: unknown
  to?: unknown
  added?: string[]
  removed?: string[]
}

export type AutomationEventKind =
  | "task_created"
  | "task_updated"
  | "comment_added"
  | "form_submitted"
  | "due_approaching"
  | "due_reached"
  | "scheduled"
  | "webhook"
  | "manual"

export interface AutomationEventLike {
  kind: AutomationEventKind
  changes?: Record<string, FieldChange>
  formId?: string
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  if (a instanceof Date || b instanceof Date) {
    const x = a ? new Date(a as string).getTime() : null
    const y = b ? new Date(b as string).getTime() : null
    return x === y
  }
  if ((a && typeof a === "object") || (b && typeof b === "object")) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (a ?? null) === (b ?? null)
}

/** Drop the entries of a change map whose value did not actually move. */
export function realChanges(changes: Record<string, FieldChange> | undefined): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {}
  for (const [k, c] of Object.entries(changes ?? {})) {
    if (k === "assignee") {
      if ((c.added?.length ?? 0) + (c.removed?.length ?? 0) > 0) out[k] = c
    } else if (!same(c.from, c.to)) out[k] = c
  }
  return out
}

function valueMatches(expected: string | undefined, actual: unknown): boolean {
  if (!expected) return true
  if (Array.isArray(actual)) return actual.some((v) => String(v).toLowerCase() === expected.toLowerCase())
  if (actual === null || actual === undefined) return false
  return String(actual).toLowerCase() === expected.toLowerCase()
}

/** Does this trigger fire for this event? Pure: the due/scheduled scans decide the time part themselves. */
export function triggerMatches(trigger: Rule, event: AutomationEventLike): boolean {
  const changes = realChanges(event.changes)
  switch (trigger.type) {
    case "TASK_CREATED":
      return event.kind === "task_created"
    case "TASK_UPDATED":
      return event.kind === "task_updated" && Object.keys(changes).length > 0
    case "STATUS_CHANGED": {
      if (event.kind !== "task_updated" || !changes.status) return false
      const from = trigger.config?.from
      if (typeof from === "string" && from && !valueMatches(from, changes.status.from)) return false
      return valueMatches(trigger.value, changes.status.to)
    }
    case "TASK_COMPLETED":
      return event.kind === "task_updated" && !!changes.status && changes.status.to === "DONE"
    case "ASSIGNEE_CHANGED": {
      if (event.kind !== "task_updated" || !changes.assignee) return false
      if (!trigger.value) return true
      return (changes.assignee.added ?? []).includes(trigger.value)
    }
    case "FIELD_CHANGED": {
      if (event.kind !== "task_updated" || !trigger.field) return false
      const c = changes[trigger.field]
      if (!c) return false
      if (trigger.field === "assignee") return trigger.value ? (c.added ?? []).includes(trigger.value) : true
      if (trigger.field === "tags" && trigger.value) {
        const before = new Set((Array.isArray(c.from) ? c.from : []).map((x) => String(x).toLowerCase()))
        return (Array.isArray(c.to) ? c.to : []).some((x) => String(x).toLowerCase() === trigger.value!.toLowerCase() && !before.has(String(x).toLowerCase()))
      }
      return valueMatches(trigger.value, c.to)
    }
    case "COMMENT_ADDED":
      return event.kind === "comment_added"
    case "FORM_SUBMITTED":
      return event.kind === "form_submitted" && (!trigger.value || trigger.value === event.formId)
    case "DUE_DATE_APPROACHING":
      return event.kind === "due_approaching"
    case "DUE_DATE_REACHED":
      return event.kind === "due_reached"
    case "SCHEDULED":
      return event.kind === "scheduled"
    case "WEBHOOK_RECEIVED":
      return event.kind === "webhook"
    default:
      return false
  }
}

/** What a condition looks at, already read from the task (see automation-engine.ts taskFacts). */
export interface TaskFacts {
  status: string
  priority: string
  assigneeIds: string[]
  sectionId: string
  tags: string[]
  title: string
  description: string | null
  dueDate: Date | null
  startDate: Date | null
  creatorId: string
  /** cf:<id> → stored value (MULTI_SELECT / PEOPLE as arrays). */
  custom: Record<string, unknown>
}

function factOf(facts: TaskFacts, field: string): unknown {
  switch (field) {
    case "status": return facts.status
    case "priority": return facts.priority
    case "assignee": return facts.assigneeIds
    case "section": return facts.sectionId
    case "tags": return facts.tags
    case "title": return facts.title
    case "description": return facts.description
    case "dueDate": return facts.dueDate
    case "startDate": return facts.startDate
    case "creator": return facts.creatorId
    default: return field.startsWith("cf:") ? facts.custom[field] : undefined
  }
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") {
    const s = v.trim()
    return s === "" || s === "[]" || s === "null"
  }
  return false
}

function asNumberOrTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === "number") return v
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
  }
  return null
}

function arrayOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      const p = JSON.parse(v)
      if (Array.isArray(p)) return p.map(String)
    } catch { /* plain text */ }
  }
  return []
}

export function conditionHolds(rule: ConditionRule, facts: TaskFacts, now = new Date()): boolean {
  const actual = factOf(facts, rule.field)
  const want = (rule.value ?? "").trim()
  const lower = want.toLowerCase()
  const list = arrayOf(actual)
  const isList = Array.isArray(actual) || list.length > 0
  switch (rule.op) {
    case "is_empty": return isEmpty(actual)
    case "is_not_empty": return !isEmpty(actual)
    case "is":
      if (isList) return list.some((x) => x.toLowerCase() === lower)
      if (actual instanceof Date) return want ? actual.toISOString().slice(0, 10) === want.slice(0, 10) : false
      return String(actual ?? "").toLowerCase() === lower
    case "is_not":
      if (isList) return !list.some((x) => x.toLowerCase() === lower)
      if (actual instanceof Date) return !(want && actual.toISOString().slice(0, 10) === want.slice(0, 10))
      return String(actual ?? "").toLowerCase() !== lower
    case "contains":
      if (isList) return list.some((x) => x.toLowerCase() === lower || x.toLowerCase().includes(lower))
      return String(actual ?? "").toLowerCase().includes(lower)
    case "not_contains":
      if (isList) return !list.some((x) => x.toLowerCase().includes(lower))
      return !String(actual ?? "").toLowerCase().includes(lower)
    case "gt":
    case "lt": {
      const a = asNumberOrTime(actual)
      const b = asNumberOrTime(want)
      if (a === null || b === null) return false
      return rule.op === "gt" ? a > b : a < b
    }
    case "overdue": {
      const a = asNumberOrTime(actual)
      return a !== null && a < now.getTime() && facts.status !== "DONE" && facts.status !== "CANCELLED"
    }
    case "within_days": {
      const a = asNumberOrTime(actual)
      const days = Number(want || "0")
      if (a === null || !Number.isFinite(days)) return false
      return a >= now.getTime() && a <= now.getTime() + days * 86_400_000
    }
    default:
      return true
  }
}

export function conditionsHold(conditions: Conditions | null, facts: TaskFacts, now = new Date()): boolean {
  if (!conditions || conditions.rules.length === 0) return true
  return conditions.match === "any"
    ? conditions.rules.some((r) => conditionHolds(r, facts, now))
    : conditions.rules.every((r) => conditionHolds(r, facts, now))
}

// ── Schedules (Asia/Jakarta wall clock, UTC+7, no DST) ─────────────────────────────────────────

const JAKARTA_OFFSET_MS = 7 * 3_600_000

export interface Schedule {
  frequency: "daily" | "weekly" | "weekdays" | "monthly"
  /** "HH:mm" in WIB. */
  time: string
  /** ISO weekdays 1 (Mon) … 7 (Sun), for weekly. */
  days: number[]
  /** 1…28 for monthly. */
  dayOfMonth: number
}

export function scheduleOf(t: Pick<Rule, "config">): Schedule | null {
  const c = t.config ?? {}
  const frequency = c.frequency === "weekly" || c.frequency === "weekdays" || c.frequency === "monthly" ? c.frequency : c.frequency === "daily" ? "daily" : null
  if (!frequency) return null
  const time = typeof c.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ? c.time : null
  if (!time) return null
  const days = Array.isArray(c.days) ? Array.from(new Set(c.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))).sort() : []
  if (frequency === "weekly" && days.length === 0) return null
  const dom = Number(c.dayOfMonth ?? 1)
  const dayOfMonth = Number.isInteger(dom) && dom >= 1 && dom <= 28 ? dom : 1
  return { frequency, time, days, dayOfMonth }
}

/** Jakarta calendar parts of an instant. */
export function jakartaParts(at: Date): { y: number; m: number; d: number; isoDow: number; key: string } {
  const j = new Date(at.getTime() + JAKARTA_OFFSET_MS)
  const y = j.getUTCFullYear(), m = j.getUTCMonth() + 1, d = j.getUTCDate()
  const dow = j.getUTCDay()
  return { y, m, d, isoDow: dow === 0 ? 7 : dow, key: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` }
}

/**
 * The slot due on the Jakarta day of `now`, or null when the schedule has none that day.
 * `at` is the UTC instant of that day's HH:mm WIB.
 */
export function slotOn(schedule: Schedule, now: Date): { at: Date; key: string } | null {
  const p = jakartaParts(now)
  if (schedule.frequency === "weekly" && !schedule.days.includes(p.isoDow)) return null
  if (schedule.frequency === "weekdays" && p.isoDow > 5) return null
  if (schedule.frequency === "monthly" && p.d !== schedule.dayOfMonth) return null
  const [hh, mm] = schedule.time.split(":").map(Number)
  const at = new Date(Date.UTC(p.y, p.m - 1, p.d, hh, mm) - JAKARTA_OFFSET_MS)
  return { at, key: `sched:${p.key}T${schedule.time}` }
}

/**
 * Is a scheduled run owed now? The slot of today when it has passed by less than `graceMs` (so a restart
 * or a missed tick still runs it, but a rule saved at 10:00 for 09:00 waits for tomorrow) and is not
 * older than the rule itself.
 */
export function dueSlot(schedule: Schedule, now: Date, createdAt: Date, graceMs = 6 * 3_600_000): { at: Date; key: string } | null {
  const slot = slotOn(schedule, now)
  if (!slot) return null
  const age = now.getTime() - slot.at.getTime()
  if (age < 0 || age > graceMs) return null
  if (slot.at.getTime() < createdAt.getTime()) return null
  return slot
}

/** The next slot after `from`, for the UI's "Next run" line. Looks ahead up to 62 days. */
export function nextSlot(schedule: Schedule, from: Date): Date | null {
  for (let i = 0; i < 62; i++) {
    const day = new Date(from.getTime() + i * 86_400_000)
    const slot = slotOn(schedule, day)
    if (slot && slot.at.getTime() > from.getTime()) return slot.at
  }
  return null
}

// ── Text templates ─────────────────────────────────────────────────────────────────────────────

/**
 * Fills {task}, {project}, {actor}, {status}, {priority}, {due}, {url} and {payload.some.key} in comment,
 * notification, task-title and webhook text. Unknown placeholders stay as typed.
 */
export function fillTemplate(text: string, vars: Record<string, string | undefined>, payload?: unknown): string {
  return text.replace(/\{([\w.]+)\}/g, (m, k: string) => {
    if (k.startsWith("payload.")) {
      let cur: unknown = payload
      for (const part of k.slice(8).split(".")) {
        if (!cur || typeof cur !== "object") return ""
        cur = (cur as Record<string, unknown>)[part]
      }
      if (cur === undefined || cur === null) return ""
      return typeof cur === "object" ? JSON.stringify(cur) : String(cur)
    }
    return k in vars ? vars[k] ?? "" : m
  })
}

/** Due-date math for SET_FIELD dueDate/startDate: "+3" = three days from now, "-1", "today", "" = clear, or a date. */
export function resolveDateValue(value: string | undefined, now = new Date()): Date | null | "invalid" {
  const v = (value ?? "").trim()
  if (!v) return null
  if (v === "today") return startOfJakartaDay(now)
  const rel = /^([+-]\d{1,4})$/.exec(v)
  if (rel) return new Date(startOfJakartaDay(now).getTime() + Number(rel[1]) * 86_400_000)
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t) : "invalid"
}

function startOfJakartaDay(now: Date): Date {
  const p = jakartaParts(now)
  // Due dates are stored as the calendar day at 00:00 UTC by the web and the apps.
  return new Date(Date.UTC(p.y, p.m - 1, p.d))
}
