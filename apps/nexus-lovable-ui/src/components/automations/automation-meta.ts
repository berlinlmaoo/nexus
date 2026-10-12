import {
  AlarmClock, Archive, ArrowRightLeft, Bell, CalendarClock, CalendarX2, CheckCircle2, CircleDot, Copy, FilePlus2,
  FileText, Flag, FolderInput, MessageSquarePlus, MessageSquareText, Pencil, PencilLine, Plus, Repeat, Tag,
  TagsIcon, UserMinus, UserPlus, Users, type LucideIcon,
} from "lucide-react";

/**
 * The automation builder's vocabulary on the web (12 Oct 2026). Types mirror the server's
 * src/lib/automation-rules.ts; labels are English source text, translated with t() where shown
 * (lib/i18n/id-automations.ts).
 */

export type Rule = { type: string; value?: string; field?: string; config?: Record<string, unknown> };
export type ConditionRule = { field: string; op: string; value?: string };
export type Conditions = { match: "all" | "any"; rules: ConditionRule[] };

export type TriggerDef = { type: string; label: string; hint: string; icon: LucideIcon; group: "Task" | "Time" | "Other" };
export const TRIGGERS: TriggerDef[] = [
  { type: "TASK_CREATED", label: "Task created", hint: "A task is added to this project", icon: Plus, group: "Task" },
  { type: "TASK_UPDATED", label: "Any property edited", hint: "Anything on a task changes", icon: Pencil, group: "Task" },
  { type: "STATUS_CHANGED", label: "Status changed", hint: "Optionally only to (or from) one status", icon: CircleDot, group: "Task" },
  { type: "ASSIGNEE_CHANGED", label: "Assignee changed", hint: "Someone is assigned or unassigned", icon: Users, group: "Task" },
  { type: "FIELD_CHANGED", label: "Field changed", hint: "One property changes (priority, due date, tags, a custom field…)", icon: PencilLine, group: "Task" },
  { type: "COMMENT_ADDED", label: "Comment added", hint: "Someone comments on a task", icon: MessageSquareText, group: "Task" },
  { type: "FORM_SUBMITTED", label: "Form submitted", hint: "A form of this project creates a task", icon: FileText, group: "Task" },
  { type: "DUE_DATE_APPROACHING", label: "Due date approaching", hint: "Some hours before a task is due", icon: AlarmClock, group: "Time" },
  { type: "DUE_DATE_REACHED", label: "Due date reached", hint: "A task's due date passes and it isn't done", icon: CalendarX2, group: "Time" },
  { type: "SCHEDULED", label: "Every…", hint: "On a schedule: daily, weekdays, weekly or monthly", icon: Repeat, group: "Time" },
];
/**
 * Old rows: TASK_COMPLETED is shown as "Status changed to Done". WEBHOOK_RECEIVED was removed with NEXUS
 * webhooks (12 Oct 2026): such a rule never fires again; it stays visible so its owner can change or delete it.
 */
export const LEGACY_TRIGGER_LABEL: Record<string, string> = { TASK_COMPLETED: "Task completed", WEBHOOK_RECEIVED: "Webhook received (removed)" };

export type ActionDef = { type: string; label: string; icon: LucideIcon; needsTask: boolean; group: "Edit" | "Create" | "Notify" };
export const ACTIONS: ActionDef[] = [
  { type: "SET_STATUS", label: "Set status", icon: CircleDot, needsTask: true, group: "Edit" },
  { type: "MARK_COMPLETE", label: "Mark complete", icon: CheckCircle2, needsTask: true, group: "Edit" },
  { type: "SET_PRIORITY", label: "Set priority", icon: Flag, needsTask: true, group: "Edit" },
  { type: "ASSIGN_TO", label: "Assign to", icon: UserPlus, needsTask: true, group: "Edit" },
  { type: "UNASSIGN", label: "Unassign", icon: UserMinus, needsTask: true, group: "Edit" },
  { type: "SET_FIELD", label: "Set a field", icon: PencilLine, needsTask: true, group: "Edit" },
  { type: "MOVE_TO_SECTION", label: "Move to section", icon: FolderInput, needsTask: true, group: "Edit" },
  { type: "ADD_TAG", label: "Add tag", icon: Tag, needsTask: true, group: "Edit" },
  { type: "REMOVE_TAG", label: "Remove tag", icon: TagsIcon, needsTask: true, group: "Edit" },
  { type: "ARCHIVE_TASK", label: "Archive task", icon: Archive, needsTask: true, group: "Edit" },
  { type: "CREATE_TASK", label: "Create task", icon: FilePlus2, needsTask: false, group: "Create" },
  { type: "CREATE_SUBTASK", label: "Create subtask", icon: ArrowRightLeft, needsTask: true, group: "Create" },
  { type: "DUPLICATE_TASK", label: "Duplicate task", icon: Copy, needsTask: true, group: "Create" },
  { type: "ADD_COMMENT", label: "Add comment", icon: MessageSquarePlus, needsTask: true, group: "Notify" },
  { type: "SEND_NOTIFICATION", label: "Send notification", icon: Bell, needsTask: false, group: "Notify" },
];

export const TIME_ICON = CalendarClock;

export const STATUSES = [
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
];
export const PRIORITIES = [
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "NONE", label: "No priority" },
];

/** Built-in task fields for "Field changed", conditions and "Set a field". */
export const BUILTIN_FIELDS = [
  { key: "status", label: "Status", kind: "status" },
  { key: "priority", label: "Priority", kind: "priority" },
  { key: "assignee", label: "Assignee", kind: "person" },
  { key: "section", label: "Section", kind: "section" },
  { key: "tags", label: "Tags", kind: "text" },
  { key: "title", label: "Title", kind: "text" },
  { key: "description", label: "Description", kind: "text" },
  { key: "dueDate", label: "Due date", kind: "date" },
  { key: "startDate", label: "Start date", kind: "date" },
  { key: "creator", label: "Created by", kind: "person" },
] as const;
/** Fields "Set a field" can write besides status/priority/section/assignee (those have their own actions). */
export const SETTABLE_BUILTIN = ["title", "description", "dueDate", "startDate"];

export type FieldKind = "status" | "priority" | "person" | "section" | "text" | "date" | "number" | "select";

export const OPS: Record<FieldKind, Array<{ op: string; label: string; noValue?: boolean }>> = {
  status: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }],
  priority: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }],
  section: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }],
  person: [{ op: "is", label: "includes" }, { op: "is_not", label: "does not include" }, { op: "is_empty", label: "is empty", noValue: true }, { op: "is_not_empty", label: "is not empty", noValue: true }],
  text: [{ op: "contains", label: "contains" }, { op: "not_contains", label: "does not contain" }, { op: "is", label: "is" }, { op: "is_empty", label: "is empty", noValue: true }, { op: "is_not_empty", label: "is not empty", noValue: true }],
  select: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }, { op: "contains", label: "contains" }, { op: "is_empty", label: "is empty", noValue: true }, { op: "is_not_empty", label: "is not empty", noValue: true }],
  number: [{ op: "is", label: "=" }, { op: "gt", label: ">" }, { op: "lt", label: "<" }, { op: "is_empty", label: "is empty", noValue: true }, { op: "is_not_empty", label: "is not empty", noValue: true }],
  date: [{ op: "overdue", label: "is overdue", noValue: true }, { op: "within_days", label: "is within the next … days" }, { op: "is_empty", label: "is empty", noValue: true }, { op: "is_not_empty", label: "is not empty", noValue: true }, { op: "lt", label: "is before" }, { op: "gt", label: "is after" }],
};

export function cfKind(type?: string): FieldKind {
  switch ((type ?? "").toUpperCase()) {
    case "NUMBER": case "RATING": return "number";
    case "DATE": case "CREATED": return "date";
    case "SELECT": case "DROPDOWN": case "MULTI_SELECT": case "STATUS": case "CHECKBOX": return "select";
    case "PEOPLE": return "person";
    default: return "text";
  }
}

export function cfChoices(options: unknown): string[] {
  if (!options) return [];
  if (Array.isArray(options)) return options.map((o) => (typeof o === "string" ? o : String((o as { label?: unknown; value?: unknown })?.label ?? (o as { value?: unknown })?.value ?? ""))).filter(Boolean);
  const o = options as { choices?: unknown; options?: unknown };
  if (Array.isArray(o.choices)) return cfChoices(o.choices);
  if (Array.isArray(o.options)) return cfChoices(o.options);
  return [];
}

export const WEEKDAYS = [
  { d: 1, label: "Mo" }, { d: 2, label: "Tu" }, { d: 3, label: "We" }, { d: 4, label: "Th" }, { d: 5, label: "Fr" }, { d: 6, label: "Sa" }, { d: 7, label: "Su" },
];

export const TEMPLATE_HINT = "{task} {project} {actor} {status} {due} {payload.key}";
