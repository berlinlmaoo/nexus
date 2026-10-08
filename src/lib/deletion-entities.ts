/**
 * What can be restored from Control Room → Audit, by the audit row's `entityType` (owner, 8 Oct 2026:
 * "semua delete apapun itu bentuknya soft delete ya supaya bisa di restore"). One place for the root
 * table a delete starts from, the word people use for it, how "what comes back" is counted, and the
 * failure messages. Pure: no database, so the web/mobile handoff can be read straight off this file.
 */

/** Where an "Open …" link goes after a restore. `projectId` when the thing lives inside a project. */
export type RestoreOpen = { type: string; id: string; projectId?: string }

/** Stored on DeletionSnapshot.meta when the copy is taken: the link, and the ids follow-ups need. */
export type SnapshotMeta = {
  open?: RestoreOpen | null
  projectId?: string | null
  taskId?: string | null
  sheetId?: string | null
  folderId?: string | null
}

type Spec = {
  /** The table the delete starts from (a "soft" delete: the table whose columns it flips). */
  table: string
  /** English noun, as the audit and the restore card say it. */
  label: string
}

export const RESTORABLE: Record<string, Spec> = {
  project: { table: "Project", label: "project" },
  task: { table: "Task", label: "task" },
  // Group A: one row (and what cascades with it).
  comment: { table: "Comment", label: "comment" },
  attachment: { table: "Attachment", label: "file" },
  proof_annotation: { table: "ProofAnnotation", label: "annotation" },
  doc: { table: "Doc", label: "doc" },
  project_page: { table: "ProjectPage", label: "page" },
  project_sheet: { table: "ProjectSheet", label: "sheet" },
  sheet_comment: { table: "SheetComment", label: "sheet comment" },
  custom_field: { table: "CustomField", label: "custom field" },
  form: { table: "Form", label: "form" },
  automation: { table: "Automation", label: "automation" },
  webhook: { table: "Webhook", label: "webhook" },
  workflow_bundle: { table: "WorkflowBundle", label: "workflow bundle" },
  goal: { table: "Goal", label: "goal" },
  portfolio: { table: "Portfolio", label: "portfolio" },
  calendar: { table: "Calendar", label: "calendar" },
  room_booking: { table: "RoomBooking", label: "room booking" },
  announcement: { table: "Announcement", label: "announcement" },
  saved_search: { table: "SavedSearch", label: "saved search" },
  pnl_expense: { table: "PnlExpense", label: "expense" },
  pnl_income: { table: "PnlIncome", label: "income" },
  pnl_payment: { table: "PnlIncomePayment", label: "payment" },
  pnl_category: { table: "PnlCategory", label: "expense category" },
  pnl_stage: { table: "PnlIncomeStage", label: "income stage" },
  pnl_recurring: { table: "PnlRecurringExpense", label: "recurring expense" },
  pnl_expense_attachment: { table: "PnlExpenseAttachment", label: "receipt" },
  pnl_budget: { table: "PnlBudget", label: "budget" },
  holiday: { table: "Holiday", label: "holiday" },
  attendance_request: { table: "AttendanceRequest", label: "day off" },
  attendance_office: { table: "OfficeLocation", label: "office" },
  org_unit_member: { table: "OrgUnitMember", label: "org chart placement" },
  vault_file: { table: "VaultItem", label: "file" },
  vault_folder: { table: "VaultItem", label: "folder" },
  // Group B: move what was inside out, then delete.
  task_list: { table: "TaskList", label: "section" },
  project_folder: { table: "ProjectFolder", label: "folder" },
  org_unit: { table: "OrgUnit", label: "org chart unit" },
  // Group C: many rows at once.
  sheet_rows: { table: "SheetRow", label: "sheet rows" },
  vault_trash: { table: "VaultItem", label: "Vault trash" },
  // Group D.
  form_submission: { table: "FormSubmission", label: "submission" },
  attendance_record: { table: "AttendanceRecord", label: "attendance record" },
  project_sheet_column: { table: "ProjectSheet", label: "sheet column" },
  post: { table: "Post", label: "post" },
  quest: { table: "Quest", label: "quest" },
  calendar_event: { table: "TeamCalendarEvent", label: "calendar event" },
  dayoff_bonus: { table: "DayOffBonus", label: "extra day off" },
}

export function rootTableOf(entityType: string): string {
  const spec = RESTORABLE[entityType]
  if (!spec) throw new Error(`Not a restorable entity type: ${entityType}`)
  return spec.table
}

export function entityLabelOf(entityType: string): string {
  return RESTORABLE[entityType]?.label ?? entityType.replace(/[_-]+/g, " ").toLowerCase()
}

/**
 * "Comes back with …", generic so every client can show it. The first six are what project/task
 * restores always sent (and still mean exactly that). `items` is every row the copy holds — the
 * fallback "N items" for a type a client does not know. The rest appear only when non-zero.
 *
 * Counts never include the deleted thing itself: a task's `tasks` are its subtasks, a comment's
 * `comments` are its replies, a page's `pages` its subpages. Exceptions, where the rows ARE the thing:
 * `rows` (sheet rows), `cells` (a sheet column's values).
 */
export type RestoreCounts = {
  lists: number
  tasks: number
  files: number
  comments: number
  sheets: number
  members: number
  items: number
  rows?: number
  cells?: number
  submissions?: number
  values?: number
  receipts?: number
  payments?: number
  milestones?: number
  pages?: number
  people?: number
  projects?: number
  folders?: number
  units?: number
  points?: number
}

/** Counts as stored on DeletionSnapshot.counts: rows per table, plus "moved:<Table>.<column>" for links a move-then-delete recorded. */
export function restoreCountsOf(entityType: string, stored: Record<string, unknown> | null | undefined, rootCount = 1): RestoreCounts {
  const c: Record<string, number> = {}
  for (const [k, v] of Object.entries(stored ?? {})) if (typeof v === "number") c[k] = v
  const root = RESTORABLE[entityType]?.table ?? null
  const less = (table: string) => Math.max(0, (c[table] ?? 0) - (table === root ? rootCount : 0))
  const moved = (key: string) => c[`moved:${key}`] ?? 0
  const items = Object.entries(c).filter(([k]) => !k.startsWith("moved:")).reduce((n, [, v]) => n + v, 0)
  const out: RestoreCounts = {
    lists: less("TaskList"),
    // A section's tasks were moved out, not deleted: they are what goes back into it.
    tasks: less("Task") + moved("Task.taskListId"),
    files: less("Attachment"),
    comments: less("Comment"),
    sheets: less("ProjectSheet"),
    members: less("ProjectMember"),
    items,
  }
  const extra: [keyof RestoreCounts, number][] = [
    ["rows", c.SheetRow ?? 0],
    ["cells", c.SheetCell ?? 0],
    ["submissions", less("FormSubmission")],
    ["values", less("CustomFieldValue")],
    ["receipts", less("PnlExpenseAttachment")],
    ["payments", less("PnlIncomePayment")],
    ["milestones", less("GoalMilestone")],
    ["pages", less("ProjectPage")],
    ["people", less("OrgUnitMember")],
    ["projects", moved("Project.folderId") + less("PortfolioProject")],
    ["folders", moved("ProjectFolder.parentFolderId")],
    ["units", moved("OrgUnit.parentId")],
    ["points", less("AttendanceLocationPoint")],
  ]
  // Projects and tasks keep exactly the counts they always had (plus `items`).
  if (entityType === "project" || entityType === "task") return out
  // Everywhere else a sheet's cell comments are comments too.
  out.comments += less("SheetComment")
  for (const [k, n] of extra) if (n > 0) (out as Record<string, number>)[k] = n
  return out
}

/** For PARENT_MISSING: the table of the gone parent → the noun clients put in "Restore the … first". */
const PARENT_NOUN: Record<string, string> = {
  Project: "project",
  Task: "task",
  TaskList: "section",
  Comment: "comment",
  Attachment: "file",
  ProjectSheet: "sheet",
  SheetRow: "row",
  ProjectPage: "page",
  Doc: "doc",
  Form: "form",
  CustomField: "custom field",
  Goal: "goal",
  Portfolio: "portfolio",
  PnlIncome: "income",
  PnlExpense: "expense",
  ProjectFolder: "folder",
  OrgUnit: "org chart unit",
  VaultItem: "folder",
  OfficeLocation: "office",
  User: "person",
  Workspace: "workspace",
  Team: "team",
}

export function parentNounOf(table: string | null | undefined): string | null {
  return table ? PARENT_NOUN[table] ?? null : null
}

export function parentMissingMessage(entityType: string, table: string | null | undefined): string {
  const parent = parentNounOf(table)
  if (entityType === "task" && (parent === "project" || parent === "section" || !parent)) {
    return "What it belonged to no longer exists. Restore its project first."
  }
  if (entityType === "task" && parent === "task") {
    return "Its parent task was deleted too. Restore that task first, then this subtask."
  }
  if (parent === "person" || parent === "workspace" || parent === "team") {
    return `The ${parent} it belonged to no longer exists, so it can't come back.`
  }
  return parent
    ? `Its ${parent} was deleted too. Restore the ${parent} first, then this ${entityLabelOf(entityType)}.`
    : `What it belonged to no longer exists.`
}

/** For CONFLICT: what holds its place now, per type. */
const CONFLICT_MESSAGE: Record<string, string> = {
  holiday: "There is already a holiday on that date. Remove it first if this one should come back.",
  attendance_record: "That person already has an attendance record for that day.",
  pnl_budget: "A budget has been set for that month since. Change that one instead.",
  room_booking: "The room has been booked for that time since.",
  org_unit_member: "They are in that unit again already.",
  project_sheet_column: "The sheet has no room for another column.",
}

export function conflictMessage(entityType: string, soft = false): string {
  if (CONFLICT_MESSAGE[entityType]) return CONFLICT_MESSAGE[entityType]
  return soft
    ? "It was changed or removed after it was deleted, so it can't be put back."
    : "Something has taken its place since, so it can't come back as it was."
}

/** A readable audit name from free text (a comment, a post): first line, trimmed, at most `max` characters. */
export function auditSnippet(text: string | null | undefined, max = 80): string | null {
  const line = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!line) return null
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
