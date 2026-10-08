/**
 * Turns an AuditLog row into something a person can read: one English sentence (`title`), a list of
 * field changes (`changes`) and every other metadata key as a labelled row (`details`).
 *
 * Pure on purpose — no Prisma, no `@/` imports — so the list endpoint can call `auditSummary` for
 * every row without a query, and `audit-describe.test.mjs` can load this file with plain node.
 * Ids are turned into names by the caller: `collectAuditIds` says which ids a row mentions, the
 * caller looks them up in a few batched queries (see `resolveAuditNames` in audit-query.ts) and
 * hands the maps back to `describeAuditEntry`. Without names every id degrades to itself.
 *
 * Metadata has had many shapes over the years (212 call sites, none of them typed). The rule here
 * is that an unknown shape is shown, not refused: anything this file does not recognise becomes a
 * details row with a humanised label, and nothing in here may throw on a strange value.
 *
 * The same module also holds the two helpers the WRITERS use, so the shape they write and the shape
 * this file reads cannot drift apart: `auditDiff` (the `{changes: {field: {from, to}}}` shape) and
 * `redactAuditMetadata` (secrets never reach the table).
 */

export type AuditLinkType = "task" | "project" | "user" | "attendance" | "form"

export interface AuditChange {
  field: string
  label: string
  from: string | null
  to: string | null
}

export interface AuditDetail {
  label: string
  value: string
  link?: { type: AuditLinkType; id: string }
}

export interface AuditDescription {
  title: string
  changes: AuditChange[]
  details: AuditDetail[]
}

/** The kinds of id a metadata value can point at, each resolved by one batched lookup. */
export type AuditIdKind =
  | "user"
  | "task"
  | "project"
  | "customField"
  | "office"
  | "form"
  | "taskList"
  | "workspace"
  | "team"

export type AuditIdSets = Record<AuditIdKind, string[]>
/** id → display name, per kind. Missing kinds / ids are fine: the raw id is shown instead. */
export type AuditNames = Partial<Record<AuditIdKind, Record<string, string>>>

export interface AuditRowLike {
  action: string
  entityType: string
  entityId?: string | null
  entityName?: string | null
  userId?: string | null
  metadata?: unknown
  user?: { id?: string | null; name?: string | null; email?: string | null } | null
}

// ─── writer helpers ────────────────────────────────────────────────────────────────────────────

const MAX_VALUE_CHARS = 500

/**
 * Keys whose STRING value must never be stored or shown. Booleans and numbers under such a key are
 * kept (`usedMobileNormalizedPassword: true` is a fact about the login, not a password).
 */
const SECRET_KEY_RE = /(passw|secret|token|api[-_]?key|private[-_]?key|credential|cookie|authorization|^otp$|^pin$|passcode|hash$)/i
export const REDACTED = "[redacted]"

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

/** Deep copy of `meta` with secret-looking keys blanked. Depth-limited; never throws. */
export function redactAuditMetadata<T>(meta: T): T {
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 6 || value === null || typeof value !== "object") return value
    if (value instanceof Date) return value
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k) && v !== null && v !== undefined && typeof v !== "boolean" && typeof v !== "number") {
        out[k] = REDACTED
      } else {
        out[k] = walk(v, depth + 1)
      }
    }
    return out
  }
  try {
    return walk(meta, 0) as T
  } catch {
    return meta
  }
}

function auditComparable(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === "string") return value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value
  if (Array.isArray(value)) return value.map((v) => auditComparable(v))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = auditComparable(v)
    return out
  }
  return value
}

/**
 * `{field: {from, to}}` for every key of `after` that is not `undefined` and differs from `before`.
 * Dates become ISO strings, long strings are cut at 500 characters, secret keys are left out.
 * `before`/`after` are plain objects of the values the caller ALREADY has in hand — no reads here.
 */
export function auditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, next] of Object.entries(after)) {
    if (next === undefined || isSecretKey(key)) continue
    const from = auditComparable(before[key] ?? null)
    const to = auditComparable(next)
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    out[key] = { from, to }
  }
  return out
}

// ─── formatting primitives ─────────────────────────────────────────────────────────────────────

const TZ = "Asia/Jakarta"
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
// Date-only values stored as UTC midnight (attendance request start/end dates).
const UTC_MIDNIGHT_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/

// Month names spelled out here: ICU versions disagree on en-GB's short September ("Sep" / "Sept").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function formatDateOnly(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  const hour = p.hour === "24" ? "00" : p.hour
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1] ?? p.month} ${p.year}, ${hour}:${p.minute} WIB`
}

/** "24 Sep 2026" / "24 Sep 2026, 14:05 WIB" for anything date-shaped, otherwise null. */
export function formatAuditDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatDateTime(value.toISOString())
  if (typeof value !== "string") return null
  const s = value.trim()
  if (DATE_ONLY_RE.test(s)) return formatDateOnly(s)
  const midnight = UTC_MIDNIGHT_RE.exec(s)
  if (midnight) return formatDateOnly(midnight[1])
  if (ISO_DATETIME_RE.test(s)) return formatDateTime(s)
  return null
}

const WORD_OVERRIDES: Record<string, string> = {
  xp: "XP",
  id: "ID",
  ids: "IDs",
  ip: "IP",
  url: "URL",
  urls: "URLs",
  mcp: "MCP",
  ios: "iOS",
  bod: "BoD",
  wa: "WA",
  saml: "SAML",
  scim: "SCIM",
  pdf: "PDF",
  csv: "CSV",
  dnd: "DND",
  oauth: "OAuth",
}

/** "attendanceShiftStartTime" / "auto_absence_deduction" / "DAY_OFF" → "Attendance shift start time" … */
export function humanizeKey(key: string): string {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.:]+/g, " ")
    .trim()
  if (!spaced) return String(key)
  const words = spaced.split(/\s+/).map((w) => w.toLowerCase())
  const mapped = words.map((w, i) => {
    if (WORD_OVERRIDES[w]) return WORD_OVERRIDES[w]
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w
  })
  return mapped.join(" ")
}

const ENUM_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/
const SNAKE_TOKEN_RE = /^[a-z]+(_[a-z0-9]+)+$/

const VALUE_LABELS: Record<string, string> = {
  DAY_OFF: "Day off",
  SICK: "Sick",
  PERMIT: "Permit",
  LEAVE: "Annual leave",
  RED_DATE: "Public holiday",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  TODO: "To do",
  BOD: "BoD",
  ONE_ABOVE_ALL: "One Above All",
}

function formatScalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value)
    return Math.abs(value) >= 10000 ? value.toLocaleString("en-US") : String(value)
  }
  const s = value
  const date = formatAuditDate(s)
  if (date) return date
  if (VALUE_LABELS[s]) return VALUE_LABELS[s]
  // Enum-looking values ("APPROVED", "IN_PROGRESS") and snake tokens ("auto_absence_deduction").
  if ((ENUM_RE.test(s) && s.length > 1) || SNAKE_TOKEN_RE.test(s)) return humanizeKey(s)
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Any metadata value → one display string. Never throws. */
export function formatAuditValue(value: unknown, depth = 0): string {
  try {
    if (value === null || value === undefined) return "None"
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (typeof value === "string" && value.trim() === "") return "Empty"
      return formatScalar(value)
    }
    if (value instanceof Date) return formatAuditDate(value) ?? String(value)
    if (Array.isArray(value)) {
      if (value.length === 0) return "None"
      if (depth > 2) return `${value.length} items`
      return value.map((v) => formatAuditValue(v, depth + 1)).join(", ")
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
      if (entries.length === 0) return "None"
      if (depth > 2) return `${entries.length} fields`
      return entries
        .map(([k, v]) => `${humanizeKey(k)}: ${isSecretKey(k) && typeof v === "string" ? REDACTED : formatAuditValue(v, depth + 1)}`)
        .join("; ")
    }
    return String(value)
  } catch {
    return "Unreadable value"
  }
}

// ─── id resolution ─────────────────────────────────────────────────────────────────────────────

const ID_KEY_KIND: Record<string, AuditIdKind> = {
  taskId: "task",
  sourceTaskId: "task",
  targetTaskId: "task",
  dependsOnTaskId: "task",
  addTaskId: "task",
  removeTaskId: "task",
  parentTaskId: "task",
  projectId: "project",
  projectIds: "project",
  fieldId: "customField",
  customFieldId: "customField",
  officeLocationId: "office",
  formId: "form",
  taskListId: "taskList",
  workspaceId: "workspace",
  teamId: "team",
  userId: "user",
  targetUserId: "user",
  targetUserIds: "user",
  assigneeUserId: "user",
  removedUserId: "user",
  reportedUserId: "user",
  recipientId: "user",
  approverId: "user",
  memberId: "user",
  reviewerId: "user",
  assigneeIds: "user",
  orphanedReports: "user",
}

const KIND_LINK: Partial<Record<AuditIdKind, AuditLinkType>> = {
  task: "task",
  project: "project",
  user: "user",
  form: "form",
}

/** Keys that point at an attendance record/request; shown as the raw id with an attendance link. */
const ATTENDANCE_ID_KEYS = new Set(["recordId", "attendanceRecordId", "requestId", "attendanceRequestId"])

function idKindOf(key: string): AuditIdKind | null {
  if (ID_KEY_KIND[key]) return ID_KEY_KIND[key]
  if (/UserId$/.test(key) || /UserIds$/.test(key)) return "user"
  if (/TaskId$/.test(key) || /TaskIds$/.test(key)) return "task"
  return null
}

function looksLikeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v)
}

/** Every id this row mentions, grouped by what it points at. */
export function collectAuditIds(row: Pick<AuditRowLike, "metadata" | "entityType" | "entityName">): AuditIdSets {
  const sets: Record<AuditIdKind, Set<string>> = {
    user: new Set(),
    task: new Set(),
    project: new Set(),
    customField: new Set(),
    office: new Set(),
    form: new Set(),
    taskList: new Set(),
    workspace: new Set(),
    team: new Set(),
  }
  const add = (kind: AuditIdKind | null, value: unknown) => {
    if (!kind) return
    if (Array.isArray(value)) {
      for (const v of value.slice(0, 100)) if (looksLikeId(v)) sets[kind].add(v)
    } else if (looksLikeId(value)) {
      sets[kind].add(value)
    }
  }
  try {
    const meta = asRecord(row.metadata)
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (k === "changes") continue
        add(idKindOf(k), v)
      }
      const changes = asRecord(meta.changes)
      if (changes) {
        for (const [k, v] of Object.entries(changes)) {
          const kind = idKindOf(k)
          if (!kind) continue
          const pair = fromToPair(v)
          if (pair) {
            add(kind, pair.from)
            add(kind, pair.to)
          } else {
            add(kind, v)
          }
        }
      }
    }
    // "dayoff-quota:<userId>", "employment-start:<userId>" — the member is only named in entityName.
    const embedded = embeddedUserId(row.entityName)
    if (embedded) sets.user.add(embedded)
  } catch {
    // collect what we have
  }
  const out = {} as AuditIdSets
  for (const kind of Object.keys(sets) as AuditIdKind[]) out[kind] = Array.from(sets[kind])
  return out
}

function embeddedUserId(entityName: string | null | undefined): string | null {
  if (!entityName) return null
  const m = /^(dayoff-quota|employment-start):([A-Za-z0-9_-]{8,64})$/.exec(entityName)
  return m ? m[2] : null
}

function nameOf(names: AuditNames | undefined, kind: AuditIdKind, id: string): string | null {
  const n = names?.[kind]?.[id]
  return typeof n === "string" && n.trim() ? n : null
}

// ─── shape helpers ─────────────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? (v as Record<string, unknown>) : null
}

function fromToPair(v: unknown): { from: unknown; to: unknown } | null {
  const r = asRecord(v)
  if (!r) return null
  const keys = Object.keys(r)
  if (keys.length === 0 || keys.length > 3) return null
  if (!("from" in r) && !("to" in r) && r.redacted !== true) return null
  if (!keys.every((k) => k === "from" || k === "to" || k === "redacted")) return null
  return { from: r.from, to: r.to }
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  dueDate: "Due date",
  startDate: "Start date",
  endDate: "End date",
  tags: "Tags",
  taskListId: "List",
  position: "Position",
  assigneeIds: "Assignees",
  isRecurring: "Recurring",
  recurPattern: "Repeat pattern",
  taskType: "Task type",
  role: "Role",
  attendanceRole: "Attendance role",
  attendanceShiftStartTime: "Shift start",
  attendanceShiftEndTime: "Shift end",
  attendanceShiftByDay: "Shift per weekday",
  flexiTimeEnabled: "Flexi time",
  noGeofenceMode: "No-geofence mode",
  restDays: "Rest days",
  approverId: "Approver",
  phoneNumber: "Phone number",
  dayOffQuota: "Day-off quota",
  employmentStartDate: "Employment start date",
  name: "Name",
  dndUntil: "Do not disturb until",
  onboardedAt: "Onboarded",
  // details
  taskId: "Task",
  sourceTaskId: "Task",
  targetTaskId: "Target task",
  dependsOnTaskId: "Depends on task",
  projectId: "Project",
  projectIds: "Projects",
  fieldId: "Custom field",
  customFieldId: "Custom field",
  officeLocationId: "Office",
  formId: "Form",
  workspaceId: "Workspace",
  teamId: "Team",
  userId: "User",
  targetUserId: "Person",
  assigneeUserId: "Assignee",
  removedUserId: "Removed assignee",
  reportedUserId: "Reported user",
  recipientId: "Recipient",
  memberId: "Member",
  orphanedReports: "Reports left without approver",
  xpRefunded: "XP refunded",
  approvalSource: "Reviewed as",
  distanceMeters: "Distance from office",
  checkInAway: "Away from office",
  checkInPlace: "Checked in at",
  mimeType: "File type",
  size: "Size",
  via: "Via",
  provider: "Sign-in method",
  nativeApp: "App",
  type: "Type",
  reason: "Reason",
  correctionReason: "Correction reason",
  offsiteApproval: "Off-site check-out",
  granted: "Granted by admin",
  date: "Date",
  quota: "Quota",
  markAllRead: "Marked all as read",
}

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key)
}

function formatIdValue(kind: AuditIdKind, value: unknown, names: AuditNames | undefined, fallbackName?: string | null): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "None"
    return value.map((v) => (looksLikeId(v) ? nameOf(names, kind, v) ?? v : formatAuditValue(v))).join(", ")
  }
  if (looksLikeId(value)) return nameOf(names, kind, value) ?? fallbackName ?? value
  return formatAuditValue(value)
}

function formatChangeValue(field: string, value: unknown, names: AuditNames | undefined): string | null {
  if (value === null || value === undefined) return null
  if (isSecretKey(field) && typeof value === "string") return REDACTED
  const kind = idKindOf(field)
  if (kind) return formatIdValue(kind, value, names)
  if (typeof value === "string" && value === "") return "Empty"
  return formatAuditValue(value)
}

// ─── changes ───────────────────────────────────────────────────────────────────────────────────

interface Normalised {
  changes: AuditChange[]
  consumed: Set<string>
}

function normaliseChanges(meta: Record<string, unknown> | null, row: AuditRowLike, names?: AuditNames): Normalised {
  const changes: AuditChange[] = []
  const consumed = new Set<string>()
  if (!meta) return { changes, consumed }
  const seen = new Set<string>()
  const push = (field: string, from: unknown, to: unknown, label?: string) => {
    if (seen.has(field)) return
    seen.add(field)
    changes.push({
      field,
      label: label ?? labelFor(field),
      from: formatChangeValue(field, from, names),
      to: formatChangeValue(field, to, names),
    })
  }

  // 1. {changes: {...}} — old shape {field: newValue}, new shape {field: {from, to}}, or a list of names.
  const rawChanges = meta.changes
  if (rawChanges !== undefined) {
    consumed.add("changes")
    const rec = asRecord(rawChanges)
    if (rec) {
      for (const [field, v] of Object.entries(rec)) {
        if (v === undefined) continue
        const pair = fromToPair(v)
        if (pair) push(field, pair.from, pair.to)
        else push(field, null, v)
      }
    } else if (Array.isArray(rawChanges)) {
      for (const f of rawChanges) if (typeof f === "string") push(f, null, null)
    }
  }

  // 2. Top-level {from, to} — a single value change (custom field values).
  if ("from" in meta || "to" in meta) {
    const fieldName = typeof meta.fieldName === "string" && meta.fieldName ? meta.fieldName : row.entityName || "Value"
    push("value", meta.from, meta.to, fieldName)
    consumed.add("from")
    consumed.add("to")
    consumed.add("fieldName")
  }

  // 3. Status transitions: {status, previousStatus?}.
  if (meta.status !== undefined && (typeof meta.status === "string" || meta.status === null)) {
    push("status", meta.previousStatus ?? null, meta.status)
    consumed.add("status")
    consumed.add("previousStatus")
  }
  if (meta.newRole !== undefined) {
    push("role", meta.previousRole ?? null, meta.newRole)
    consumed.add("newRole")
    consumed.add("previousRole")
  }

  // 4. Field-name lists: {fields: [...]} / {changed: [...]}.
  for (const key of ["fields", "changed"]) {
    const list = meta[key]
    if (Array.isArray(list) && list.every((f) => typeof f === "string")) {
      for (const f of list as string[]) push(f, null, null)
      consumed.add(key)
    }
  }

  // Legacy top-level keys that restate a field already listed in changes (workspace_member kept
  // `attendanceRole`, `approverId`… next to the new `changes` for older readers).
  for (const c of changes) if (c.field in meta && !consumed.has(c.field)) consumed.add(c.field)
  return { changes, consumed }
}

// ─── details ───────────────────────────────────────────────────────────────────────────────────

function buildDetails(meta: Record<string, unknown> | null, consumed: Set<string>, names?: AuditNames): AuditDetail[] {
  const details: AuditDetail[] = []
  if (!meta) return details
  // "projectId" + "projectName", "taskId" + "taskTitle", "fieldId" + "fieldName": one row, name as
  // the fallback when the id no longer resolves (deleted task, …).
  const skip = new Set<string>(consumed)
  const fallbackFor = (key: string): string | null => {
    const base = key.replace(/Ids?$/, "")
    for (const suffix of ["Name", "Title"]) {
      const sibling = `${base}${suffix}`
      const v = meta[sibling]
      if (typeof v === "string" && v.trim()) {
        skip.add(sibling)
        return v
      }
    }
    return null
  }
  const fallbacks = new Map<string, string | null>()
  for (const key of Object.keys(meta)) {
    if (idKindOf(key)) fallbacks.set(key, fallbackFor(key))
  }

  for (const [key, value] of Object.entries(meta)) {
    if (skip.has(key) || value === undefined) continue
    const label = labelFor(key)
    try {
      if (isSecretKey(key) && value !== null && typeof value !== "boolean" && typeof value !== "number") {
        details.push({ label, value: REDACTED })
        continue
      }
      const kind = idKindOf(key)
      if (kind) {
        const text = formatIdValue(kind, value, names, fallbacks.get(key) ?? null)
        const linkType = KIND_LINK[kind]
        const detail: AuditDetail = { label, value: text }
        if (linkType && looksLikeId(value) && nameOf(names, kind, value)) detail.link = { type: linkType, id: value }
        details.push(detail)
        continue
      }
      if (ATTENDANCE_ID_KEYS.has(key) && looksLikeId(value)) {
        details.push({ label, value, link: { type: "attendance", id: value } })
        continue
      }
      if (typeof value === "number" && (key === "size" || /Size$/.test(key) || /Bytes$/.test(key))) {
        details.push({ label, value: formatBytes(value) })
        continue
      }
      if (typeof value === "number" && /Meters$/.test(key)) {
        details.push({ label, value: `${Math.round(value)} m` })
        continue
      }
      details.push({ label, value: formatAuditValue(value) })
    } catch {
      details.push({ label, value: "Unreadable value" })
    }
  }
  return details
}

// ─── title ─────────────────────────────────────────────────────────────────────────────────────

const VERBS: Record<string, string> = {
  create: "created",
  update: "changed",
  delete: "deleted",
  login: "signed in",
  logout: "signed out",
  grant: "granted",
  export: "exported",
  import: "imported",
  invite: "invited",
  approve: "approved",
  reject: "rejected",
  restore: "restored",
  archive: "archived",
  upload: "uploaded",
  duplicate: "duplicated",
  revoke: "revoked",
  share: "shared",
  offboard: "offboarded",
  reinstate: "reinstated",
}

const NOUNS: Record<string, string> = {
  custom_field_value: "custom field",
  custom_field: "custom field",
  attendance_request: "attendance request",
  attendance_record: "attendance record",
  attendance_day: "attendance day",
  workspace_member: "member",
  user_profile: "profile",
  formSubmission: "form submission",
  task_assignee: "task assignee",
  task_dependency: "task dependency",
  task_relation: "task relation",
  project_page: "project page",
  notificationPreference: "notification preferences",
  dayoff_bonus: "extra day off",
  xp_transaction: "XP entry",
  member_record: "member record",
  // Restorable deletes (lib/deletion-entities.ts), named the way the restore card names them.
  task_list: "section",
  project_folder: "folder",
  project_sheet: "sheet",
  project_sheet_column: "sheet column",
  sheet_comment: "sheet comment",
  sheet_rows: "sheet rows",
  proof_annotation: "annotation",
  saved_search: "saved search",
  room_booking: "room booking",
  workflow_bundle: "workflow bundle",
  form_submission: "form submission",
  org_unit: "org chart unit",
  org_unit_member: "org chart placement",
  calendar_event: "calendar event",
  attendance_office: "office",
  vault_file: "Vault file",
  vault_folder: "Vault folder",
  vault_trash: "Vault trash",
  pnl_expense: "expense",
  pnl_income: "income",
  pnl_payment: "payment",
  pnl_category: "expense category",
  pnl_stage: "income stage",
  pnl_recurring: "recurring expense",
  pnl_expense_attachment: "receipt",
  pnl_budget: "budget",
  chat_group: "group chat",
}

const REQUEST_TYPE_NOUN: Record<string, string> = {
  DAY_OFF: "day-off",
  SICK: "sick-leave",
  PERMIT: "permit",
  LEAVE: "annual-leave",
  RED_DATE: "public-holiday",
}

function nounOf(entityType: string): string {
  return NOUNS[entityType] ?? humanizeKey(entityType).toLowerCase()
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? "an" : "a"
}

function quote(s: string): string {
  const t = s.length > 120 ? `${s.slice(0, 120)}…` : s
  return `“${t}”`
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

function actorOf(row: AuditRowLike): string {
  const n = row.user?.name?.trim()
  if (n) return n
  const e = row.user?.email?.trim()
  if (e) return e
  return "Someone"
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** One English sentence for the row. `names` makes it richer (resolved people / tasks) but is optional. */
export function auditTitle(row: AuditRowLike, names?: AuditNames): string {
  try {
    return buildTitle(row, names)
  } catch {
    return `${actorOf(row)} ${VERBS[row.action] ?? humanizeKey(row.action || "acted").toLowerCase()} ${article(nounOf(row.entityType || "item"))} ${nounOf(row.entityType || "item")}`
  }
}

function buildTitle(row: AuditRowLike, names?: AuditNames): string {
  const actor = actorOf(row)
  const meta = asRecord(row.metadata) ?? {}
  const action = String(row.action || "")
  const type = String(row.entityType || "")
  const noun = nounOf(type || "item")
  const entityName = str(row.entityName)
  const verb = VERBS[action]
  const person = (key: string): string | null => {
    const id = meta[key]
    return looksLikeId(id) ? nameOf(names, "user", id) : null
  }
  const taskName = (): string | null => {
    const id = meta.taskId
    return str(meta.taskTitle) ?? (looksLikeId(id) ? nameOf(names, "task", id) : null)
  }

  if (action === "login") return `${actor} signed in`
  if (action === "logout") return `${actor} signed out`

  if (type === "task") {
    if (action === "delete") {
      const projectName = str(meta.projectName) ?? (looksLikeId(meta.projectId) ? nameOf(names, "project", meta.projectId) : null)
      return `${actor} deleted the task ${quote(entityName ?? str(meta.title) ?? "untitled")}${projectName ? ` from ${quote(projectName)}` : ""}`
    }
    if (action === "update") return `${actor} changed the task ${quote(entityName ?? "untitled")}`
  }

  if (type === "custom_field_value") {
    const field = str(meta.fieldName) ?? entityName ?? "a custom field"
    const task = taskName()
    const fieldText = field === "a custom field" ? field : quote(field)
    return task ? `${actor} changed ${fieldText} on the task ${quote(task)}` : `${actor} changed the custom field ${fieldText}`
  }

  if (type === "task_assignee" && (action === "create" || action === "delete")) {
    const who = person(action === "create" ? "assigneeUserId" : "removedUserId")
    const task = entityName ?? taskName()
    const onTask = task ? ` ${action === "create" ? "to" : "from"} the task ${quote(task)}` : ""
    if (action === "create") return who ? `${actor} assigned ${who}${onTask}` : `${actor} added an assignee${onTask}`
    return who ? `${actor} removed ${who}${onTask}` : `${actor} removed an assignee${onTask}`
  }

  if (type === "attachment") {
    const task = taskName()
    const file = entityName ? quote(entityName) : "a file"
    if (action === "create") return `${actor} uploaded ${file}${task ? ` to the task ${quote(task)}` : ""}`
    if (action === "delete") return `${actor} deleted the attachment ${file}`
  }

  if (type === "formSubmission" && action === "create") {
    return entityName ? `${actor} submitted the form ${quote(entityName)}` : `${actor} submitted a form`
  }

  if (type === "user_profile") {
    const own = row.entityId && row.userId ? row.entityId === row.userId : true
    return own ? `${actor} updated their profile` : `${actor} updated a profile`
  }

  if (type === "notification") {
    if (meta.markAllRead === true) return `${actor} marked all notifications as read`
    if (meta.clearRead === true) return `${actor} cleared read notifications`
    if (action === "update") return `${actor} marked a notification as read`
  }

  if (type === "attendance_request") return attendanceRequestTitle(actor, action, entityName, meta, person)

  if (type === "attendance_record") {
    if (action === "create" && entityName && /check-in$/i.test(entityName)) {
      // Away from the office (location-free): say where, not which office (owner, 28 Sep 2026).
      const place = meta.checkInAway === true ? str(meta.checkInPlace) : null
      return place ? `${actor} checked in at ${place} (away from the office)` : `${actor} checked in`
    }
    if (action === "update" && entityName && / check-out$/i.test(entityName) && !/hapus/i.test(entityName)) return `${actor} checked out`
    if (typeof meta.offsiteApproval === "string") {
      const who = person("targetUserId")
      const decided = meta.offsiteApproval === "APPROVED" ? "approved" : meta.offsiteApproval === "REJECTED" ? "rejected" : "reviewed"
      return `${actor} ${decided} ${who ? `${possessive(who)} ` : "an "}off-site check-out`
    }
  }

  if (action === "attendance_status_override") {
    const who = person("targetUserId")
    const date = formatAuditDate(meta.date)
    const what = str(meta.override)
    return `${actor} overrode ${who ? `${possessive(who)} attendance` : "an attendance day"}${date ? ` on ${date}` : ""}${what ? ` (${humanizeKey(what).toLowerCase()})` : ""}`
  }

  if (type === "xp_transaction" && action === "refund") {
    const who = person("targetUserId")
    const amount = typeof meta.amount === "number" ? meta.amount : null
    const date = formatAuditDate(meta.date)
    const what = entityName ? entityName.toLowerCase() : "XP"
    return `${actor} removed ${who ? `${possessive(who)} ` : "a "}${amount !== null ? `${amount} XP ` : ""}deduction (${what}${date ? `, ${date}` : ""})`
  }

  if (type === "member_record" && action === "view") {
    return `${actor} opened ${entityName ? `${possessive(entityName)} ` : "a "}member record`
  }

  if (type === "dayoff_bonus") {
    const period = str(meta.periodKey)
    const days = typeof meta.days === "number" ? meta.days : null
    const what = days !== null ? `${days} extra day${days === 1 ? "" : "s"} off` : "extra day off"
    const forPeriod = period ? ` for the ${period} period` : ""
    if (action === "grant") {
      const n = typeof meta.people === "number" ? meta.people : null
      return `${actor} gave ${n !== null ? `${n} ${n === 1 ? "person" : "people"}` : "people"} ${what}${forPeriod}`
    }
    if (action === "revoke") {
      const who = person("targetUserId")
      return `${actor} revoked ${who ? possessive(who) : "someone’s"} ${what}${forPeriod}`
    }
  }

  if (type === "workspace_member") {
    const embedded = embeddedUserId(entityName)
    if (embedded) {
      const who = nameOf(names, "user", embedded)
      const what = entityName?.startsWith("dayoff-quota:") ? "day-off quota" : "employment start date"
      return `${actor} changed ${who ? `${possessive(who)} ${what}` : `a member’s ${what}`}`
    }
    const who = entityName ?? person("targetUserId")
    if (action === "update") return who ? `${actor} changed the member ${quote(who)}` : `${actor} changed a member`
  }

  // Generic.
  if (verb) {
    return entityName ? `${actor} ${verb} the ${noun} ${quote(entityName)}` : `${actor} ${verb} ${article(noun)} ${noun}`
  }
  const act = humanizeKey(action || "acted").toLowerCase()
  return entityName ? `${actor} did “${act}” on the ${noun} ${quote(entityName)}` : `${actor} did “${act}” on ${article(noun)} ${noun}`
}

function attendanceRequestTitle(
  actor: string,
  action: string,
  entityName: string | null,
  meta: Record<string, unknown>,
  person: (key: string) => string | null,
): string {
  // entityName is "<TYPE>:<requester name>" or "auto-dayoff:<name>".
  let reqType = str(meta.type)
  let requester: string | null = person("targetUserId") ?? str(meta.requesterName)
  if (entityName) {
    const i = entityName.indexOf(":")
    if (i > 0) {
      const head = entityName.slice(0, i)
      const tail = entityName.slice(i + 1).trim()
      if (head === "auto-dayoff") return `An automatic day off was charged to ${tail || actor} for an unexcused absence`
      if (!reqType) reqType = head
      if (!requester && tail) requester = tail
    }
  }
  const kind = (reqType && REQUEST_TYPE_NOUN[reqType]) ?? (reqType ? humanizeKey(reqType).toLowerCase() : "attendance")
  const self = !requester || requester === actor
  const theirs = self ? `their ${kind} request` : `${possessive(requester as string)} ${kind} request`

  if (action === "create") return self ? `${actor} filed ${article(kind)} ${kind} request` : `${actor} filed ${article(kind)} ${kind} request for ${requester}`
  if (action === "grant") return `${actor} granted ${self ? "themselves" : requester} ${article(kind)} ${kind} request`
  if (action === "delete") return `${actor} deleted ${theirs}`
  if (action === "update") {
    const status = str(meta.status)
    if (status === "APPROVED") return `${actor} approved ${theirs}`
    if (status === "REJECTED") return `${actor} rejected ${theirs}`
    if (status === "CANCELED" || status === "CANCELLED") return `${actor} canceled ${theirs}`
    return `${actor} changed ${theirs}`
  }
  return `${actor} ${VERBS[action] ?? `did “${humanizeKey(action).toLowerCase()}” on`} ${theirs}`
}

// ─── public entry points ───────────────────────────────────────────────────────────────────────

/** Cheap one-liner for list rows: no names, no queries. */
export function auditSummary(row: AuditRowLike): string {
  return auditTitle(row)
}

/** Full description for the detail endpoint. Never throws. */
export function describeAuditEntry(row: AuditRowLike, names?: AuditNames): AuditDescription {
  let meta: Record<string, unknown> | null = null
  let changes: AuditChange[] = []
  let details: AuditDetail[] = []
  try {
    const raw = row.metadata
    meta = asRecord(raw)
    const n = normaliseChanges(meta, row, names)
    changes = n.changes
    details = buildDetails(meta, n.consumed, names)
    if (!meta && raw !== null && raw !== undefined) {
      // metadata that is not an object (array, string, number) — show it as it is.
      details = [{ label: "Metadata", value: formatAuditValue(raw) }]
    }
  } catch {
    details = [{ label: "Metadata", value: "Unreadable metadata" }]
  }
  return { title: auditTitle(row, names), changes, details }
}
