/**
 * Saved views per project (owner, 12 Oct 2026, Notion-style): the pure part — what a view's config
 * means, applied to a project's tasks. No React, no fetch: project-views.test.mjs runs it with node.
 *
 * The server stores the config (src/lib/project-views.ts of the Next app documents the JSON and checks
 * its shape); this file evaluates it. iOS / Android follow the same rules when they get views.
 *
 *  filter       simple rules (the chips under the toolbar, all must match) AND one advanced group
 *               (nested AND / OR, two levels).
 *  sort         list of { prop, dir }; none = the manual order (section position, then card position).
 *  groupBy      lanes on the Board, sections on List / Table / Timeline / Gallery. subGroupBy nests a
 *               second level (Board: swimlanes).
 *  visibleProps which properties a card / row / column shows, in order. null = the layout's default.
 */
import type { NexusCustomField, NexusProjectView, NexusTask } from "./nexus-api";
import { groupIndex, orderedOptions, usesStatusOptions } from "./status-options.ts";
import { formatNumberWith, numberFieldFormat, numberOptions, storedNumber, type NumberOptions } from "./custom-field-number.ts";
import { formatCount } from "./number-format.ts";

export type ViewLayout = NexusProjectView["layout"];
export const VIEW_LAYOUTS: ViewLayout[] = ["board", "list", "table", "calendar", "timeline", "gallery"];
export const BUILTIN_KEYS = ["board", "list", "table", "calendar", "timeline"] as const;

/** One of the five migrated tabs: fixed layout, always shared, hidden (not deleted) via hiddenTabs. */
export function isBuiltinTab(v: Pick<NexusProjectView, "builtin">): boolean {
  return !!v.builtin && (BUILTIN_KEYS as readonly string[]).includes(v.builtin);
}

/** English names; the UI translates them with t(). */
export const LAYOUT_LABEL: Record<ViewLayout, string> = {
  board: "Board",
  list: "List",
  table: "Table",
  calendar: "Calendar",
  timeline: "Timeline",
  gallery: "Gallery",
};

export type FilterValue = string | number | string[];
export type FilterRule = { id: string; prop: string; op: string; value?: FilterValue };
export type FilterGroup = { id: string; mode: "and" | "or"; rules: Array<FilterRule | FilterGroup> };
export type ViewFilter = { simple: FilterRule[]; advanced: FilterGroup | null };
export type SortRule = { prop: string; dir: "asc" | "desc" };
export type GroupCalc = { kind: "count" | "done" | "percent_done" | "sum" | "avg"; prop?: string };
/** A Table column's footer calculation (Notion's "Calculate"). Counts work on any column, the rest on numbers. */
export type ColumnCalc = "count_all" | "count_values" | "count_empty" | "percent_empty" | "percent_not_empty" | "sum" | "avg" | "median" | "min" | "max" | "range";
export const COUNT_CALCS: ColumnCalc[] = ["count_all", "count_values", "count_empty", "percent_empty", "percent_not_empty"];
export const NUMBER_CALCS: ColumnCalc[] = ["sum", "avg", "median", "min", "max", "range"];
/** English names (the UI translates them); the short ones label the footer value, as Notion does. */
export const COLUMN_CALC_LABEL: Record<ColumnCalc, { name: string; short: string }> = {
  count_all: { name: "Count all", short: "Count all" },
  count_values: { name: "Count values", short: "Count values" },
  count_empty: { name: "Count empty", short: "Count empty" },
  percent_empty: { name: "Percent empty", short: "Percent empty" },
  percent_not_empty: { name: "Percent not empty", short: "Percent not empty" },
  sum: { name: "Sum", short: "Sum" },
  avg: { name: "Average", short: "Average" },
  median: { name: "Median", short: "Median" },
  min: { name: "Min", short: "Min" },
  max: { name: "Max", short: "Max" },
  range: { name: "Range", short: "Range" },
};
export type ColorRule = { id: string; prop: string; value: string; color: string };

export type ViewConfig = {
  filter: ViewFilter;
  sort: SortRule[];
  groupBy: string | null;
  subGroupBy: string | null;
  hiddenGroups: string[];
  collapsedGroups: string[];
  hideEmptyGroups: boolean;
  groupCalc: GroupCalc;
  visibleProps: string[] | null;
  cardSize: "small" | "medium" | "large";
  cardCover: "none" | "image";
  colorBy: string | null;
  colorRules: ColorRule[];
  dateProp: string;
  startProp: string;
  endProp: string;
  showSubtasks: boolean;
  wrap: boolean;
  /** Table footer: a calculation per column (prop key → calc). Absent = none. */
  columnCalcs: Record<string, ColumnCalc>;
};

export const EMPTY_FILTER: ViewFilter = { simple: [], advanced: null };

export function isGroup(r: FilterRule | FilterGroup): r is FilterGroup {
  return Array.isArray((r as FilterGroup).rules);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── properties ──────────────────────────────────────────────────────────────────────────────────────

export type PropKind = "title" | "text" | "select" | "multi" | "person" | "date" | "number" | "checkbox" | "count";
export type PropOption = { value: string; label: string; color?: string | null };
/** `hidden`: still evaluated (old saved filters keep working) but not offered in pickers. */
export type PropDef = {
  key: string; label: string; kind: PropKind; options?: PropOption[]; fieldType?: string;
  /** NUMBER fields: "currency-idr" shows Rp, "plain" any other format (legacy; see `number`). */
  numberFormat?: "plain" | "currency-idr";
  /** NUMBER fields: the field's format, decimals and Show as (lib/custom-field-number.ts). */
  number?: NumberOptions;
  builtin: boolean; hidden?: boolean;
};

export type ViewCtx = {
  /** The project's sections. With a taskStatus they are its status options (lib/status-options.ts). */
  sections: Array<{ id: string; name: string; position?: number | null; taskStatus?: string | null; color?: string | null }>;
  fields: NexusCustomField[];
  /** Project members, for the person filter's options and the assignee group order. */
  people: Array<{ id: string; name: string }>;
  meId?: string | null;
  now?: Date;
};

export const STATUS_ORDER = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
export const PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
const STATUS_LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };
const PRIORITY_LABEL: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "No priority" };

export function fieldChoices(field: Pick<NexusCustomField, "options">): string[] {
  const o = field.options as unknown;
  if (!o) return [];
  if (Array.isArray(o)) return o.map(String);
  const obj = o as { options?: unknown[]; choices?: unknown[] };
  if (Array.isArray(obj.options)) return obj.options.map(String);
  if (Array.isArray(obj.choices)) return obj.choices.map(String);
  return [];
}

/** A select field's own option colours (options.optionColors, e.g. the "Kategori" made from old sections). */
export function fieldOptionColors(field: Pick<NexusCustomField, "options">): Record<string, string> {
  const o = field.options as { optionColors?: unknown } | null | undefined;
  const c = o && typeof o === "object" && !Array.isArray(o) ? o.optionColors : null;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, string>) : {};
}

function fieldKind(type: string): PropKind {
  switch (type.toUpperCase()) {
    case "SELECT":
    case "DROPDOWN":
    case "STATUS":
      return "select";
    case "MULTI_SELECT":
      return "multi";
    case "PEOPLE":
      return "person";
    case "DATE":
    case "CREATED":
      return "date";
    case "NUMBER":
    case "RATING":
      return "number";
    case "CHECKBOX":
      return "checkbox";
    default:
      return "text";
  }
}

/** Every property a view can show, filter, sort or group by, for this project. */
export function propDefs(ctx: ViewCtx): PropDef[] {
  // Sections that stand for a status ARE the status options (owner, 12 Oct 2026): "Status" is then the
  // section, in group order, with each option's colour; the fixed five-value status stays evaluable for
  // older saved filters but is not offered.
  const statusSections = usesStatusOptions(ctx.sections);
  const sections = statusSections ? orderedOptions(ctx.sections) : [...ctx.sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const defs: PropDef[] = [
    { key: "title", label: "Name", kind: "title", builtin: true },
    { key: "section", label: statusSections ? "Status" : "Section", kind: "select", builtin: true, options: sections.map((s) => ({ value: s.id, label: s.name, color: s.color ?? (statusSections ? STATUS_COLOR[s.taskStatus ?? "TODO"] : null) })) },
    { key: "status", label: statusSections ? "Status type" : "Status", kind: "select", builtin: true, hidden: statusSections, options: STATUS_ORDER.map((v) => ({ value: v, label: STATUS_LABEL[v] })) },
    { key: "priority", label: "Priority", kind: "select", builtin: true, options: PRIORITY_ORDER.map((v) => ({ value: v, label: PRIORITY_LABEL[v] })) },
    { key: "assignee", label: "Assignee", kind: "person", builtin: true, options: ctx.people.map((p) => ({ value: p.id, label: p.name })) },
    { key: "due", label: "Due date", kind: "date", builtin: true },
    { key: "start", label: "Start date", kind: "date", builtin: true },
    { key: "tags", label: "Tags", kind: "multi", builtin: true },
    { key: "created", label: "Created", kind: "date", builtin: true },
    { key: "updated", label: "Last edited", kind: "date", builtin: true },
    { key: "subtasks", label: "Subtasks", kind: "count", builtin: true },
    { key: "comments", label: "Comments", kind: "count", builtin: true },
  ];
  for (const f of [...ctx.fields].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const kind = fieldKind(f.type ?? "");
    const colors = fieldOptionColors(f);
    const options = kind === "select" || kind === "multi" ? fieldChoices(f).map((v) => ({ value: v, label: v, color: colors[v] ?? null })) : kind === "person" ? ctx.people.map((p) => ({ value: p.id, label: p.name })) : undefined;
    const fieldType = (f.type ?? "").toUpperCase();
    const isNumber = fieldType === "NUMBER";
    defs.push({ key: `cf:${f.id}`, label: f.name, kind, options, fieldType, numberFormat: isNumber ? numberFieldFormat(f.options) : undefined, number: isNumber ? numberOptions(f.options) : undefined, builtin: false });
  }
  return defs;
}

/**
 * A number property for display in its field's format ("Rp 1.500.000", "42%", "US$12,00", "1.500"), with
 * Indonesian grouping in both languages. Without a field format (RATING, counts) a grouped number with up
 * to `maxFractionDigits` decimals. `format` is the legacy two-way switch, still honoured.
 */
export function formatNumberProp(n: number, format: PropDef["numberFormat"] | NumberOptions | undefined, maxFractionDigits = 2, _locale = "id-ID"): string {
  if (format && typeof format === "object") return formatNumberWith(n, format);
  if (format === "currency-idr") return formatNumberWith(n, numberOptions({ format: "currency-idr" }));
  return formatCount(n, maxFractionDigits);
}

export function propDef(defs: PropDef[], key: string | null | undefined): PropDef | undefined {
  return key ? defs.find((d) => d.key === key) : undefined;
}

/** Properties a view can group by: one value per task, or a list (a task in several groups). */
export function groupableProps(defs: PropDef[]): PropDef[] {
  return defs.filter((d) => !d.hidden).filter((d) => d.kind === "select" || d.kind === "multi" || d.kind === "person" || d.kind === "date" || d.kind === "checkbox");
}
export function sortableProps(defs: PropDef[]): PropDef[] {
  return defs.filter((d) => !d.hidden).filter((d) => d.kind !== "multi" || d.key === "tags");
}
export function dateProps(defs: PropDef[]): PropDef[] {
  return defs.filter((d) => d.kind === "date");
}

// ─── reading a task ──────────────────────────────────────────────────────────────────────────────────

function cfRaw(task: NexusTask, fieldId: string): string {
  const v = (task.customFieldValues ?? []).find((c) => c.customFieldId === fieldId)?.value;
  return v == null ? "" : String(v);
}

function parseList(raw: string): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a.map((x) => (typeof x === "object" && x && "id" in x ? String((x as { id: unknown }).id) : String(x))).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [raw];
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sectionIdOf(task: NexusTask): string {
  return task.taskListId ?? task.taskList?.id ?? "";
}

/** The values a task holds for a property, as strings (empty list = empty). */
export function taskValues(task: NexusTask, key: string): string[] {
  switch (key) {
    case "title":
      return task.title ? [task.title] : [];
    case "section":
      return sectionIdOf(task) ? [sectionIdOf(task)] : [];
    case "status":
      return [(task.status || "TODO").toUpperCase()];
    case "priority":
      return [(task.priority || "NONE").toUpperCase()];
    case "assignee":
      return (task.assignees ?? []).map((a) => a.user?.id ?? "").filter(Boolean);
    case "due":
      return task.dueDate ? [task.dueDate] : [];
    case "start":
      return task.startDate ? [task.startDate] : [];
    case "created":
      return task.createdAt ? [task.createdAt] : [];
    case "updated":
      return task.updatedAt ? [task.updatedAt] : [];
    case "tags":
      return (task.tags ?? []).filter(Boolean);
    case "subtasks":
      return [String((task.subtasks ?? []).length)];
    case "comments":
      return [String(task._count?.comments ?? 0)];
  }
  if (key.startsWith("cf:")) {
    const raw = cfRaw(task, key.slice(3)).trim();
    if (!raw) return [];
    const cfv = (task.customFieldValues ?? []).find((c) => c.customFieldId === key.slice(3));
    const type = (cfv?.customField?.type ?? "").toUpperCase();
    if (type === "MULTI_SELECT" || type === "PEOPLE" || type === "FILE") return parseList(raw);
    if (type === "PLACE") {
      try { const p = JSON.parse(raw) as { label?: string }; return p?.label ? [p.label] : []; } catch { return [raw]; }
    }
    if (type === "NUMBER") {
      // The stored machine number; a legacy Rupiah "369.000" is Rp 369.000, not 369 (lib/custom-field-number.ts).
      const n = storedNumber(raw, cfv?.customField?.options);
      return n === null ? [] : [String(n)];
    }
    return [raw];
  }
  return [];
}

export function isDoneStatus(status?: string | null): boolean {
  return ["DONE", "COMPLETED", "COMPLETE"].includes((status || "").toUpperCase());
}

// ─── filter ──────────────────────────────────────────────────────────────────────────────────────────

/** The operators offered for a property kind, with English labels. The first one is the default. */
export function opsFor(kind: PropKind): Array<{ op: string; label: string; needsValue: boolean }> {
  switch (kind) {
    case "title":
    case "text":
      return [
        { op: "contains", label: "contains", needsValue: true },
        { op: "not_contains", label: "does not contain", needsValue: true },
        { op: "is", label: "is", needsValue: true },
        { op: "is_not", label: "is not", needsValue: true },
        { op: "empty", label: "is empty", needsValue: false },
        { op: "not_empty", label: "is not empty", needsValue: false },
      ];
    case "select":
    case "multi":
      return [
        { op: "any_of", label: "is any of", needsValue: true },
        { op: "none_of", label: "is none of", needsValue: true },
        { op: "empty", label: "is empty", needsValue: false },
        { op: "not_empty", label: "is not empty", needsValue: false },
      ];
    case "person":
      return [
        { op: "any_of", label: "is any of", needsValue: true },
        { op: "none_of", label: "is none of", needsValue: true },
        { op: "empty", label: "is empty", needsValue: false },
        { op: "not_empty", label: "is not empty", needsValue: false },
      ];
    case "date":
      return [
        { op: "on", label: "is on", needsValue: true },
        { op: "before", label: "is before", needsValue: true },
        { op: "after", label: "is after", needsValue: true },
        { op: "overdue", label: "is overdue", needsValue: false },
        { op: "today", label: "is today", needsValue: false },
        { op: "this_week", label: "is this week", needsValue: false },
        { op: "next_days", label: "is within the next … days", needsValue: true },
        { op: "past_days", label: "is within the past … days", needsValue: true },
        { op: "empty", label: "is empty", needsValue: false },
        { op: "not_empty", label: "is not empty", needsValue: false },
      ];
    case "number":
    case "count":
      return [
        { op: "eq", label: "=", needsValue: true },
        { op: "neq", label: "≠", needsValue: true },
        { op: "gt", label: ">", needsValue: true },
        { op: "gte", label: "≥", needsValue: true },
        { op: "lt", label: "<", needsValue: true },
        { op: "lte", label: "≤", needsValue: true },
        { op: "empty", label: "is empty", needsValue: false },
        { op: "not_empty", label: "is not empty", needsValue: false },
      ];
    case "checkbox":
      return [
        { op: "checked", label: "is checked", needsValue: false },
        { op: "unchecked", label: "is not checked", needsValue: false },
      ];
  }
}

const DAY_MS = 86_400_000;
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(d: Date, now: Date): number { return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS); }
function ymdLocal(d: Date): string { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/** "me" in a person rule stands for whoever is looking. */
export const ME = "__me__";

/** Is the rule complete enough to apply? An incomplete rule (no value picked yet) matches everything. */
export function ruleIsActive(rule: FilterRule, kind: PropKind | undefined): boolean {
  if (!kind) return false;
  const op = opsFor(kind).find((o) => o.op === rule.op);
  if (!op) return false;
  if (!op.needsValue) return true;
  const v = rule.value;
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function matchRule(task: NexusTask, rule: FilterRule, defs: PropDef[], ctx: Pick<ViewCtx, "meId" | "now">): boolean {
  const def = propDef(defs, rule.prop);
  if (!def || !ruleIsActive(rule, def.kind)) return true;
  const vals = taskValues(task, rule.prop);
  const now = ctx.now ?? new Date();
  const value = rule.value;
  switch (rule.op) {
    case "empty":
      return def.kind === "count" ? vals.every((v) => Number(v) === 0) : vals.length === 0;
    case "not_empty":
      return def.kind === "count" ? vals.some((v) => Number(v) > 0) : vals.length > 0;
  }
  if (def.kind === "title" || def.kind === "text") {
    const hay = vals.join(" ").toLowerCase();
    const needle = String(value ?? "").trim().toLowerCase();
    if (rule.op === "contains") return hay.includes(needle);
    if (rule.op === "not_contains") return !hay.includes(needle);
    if (rule.op === "is") return vals.some((v) => v.trim().toLowerCase() === needle);
    if (rule.op === "is_not") return !vals.some((v) => v.trim().toLowerCase() === needle);
    return true;
  }
  if (def.kind === "select" || def.kind === "multi" || def.kind === "person") {
    const wanted = (Array.isArray(value) ? value : [String(value)]).map((v) => (v === ME ? ctx.meId ?? "" : v));
    const lowerVals = vals.map((v) => v.toLowerCase());
    const hit = wanted.some((w) => (def.kind === "multi" ? lowerVals.includes(w.toLowerCase()) : vals.includes(w)));
    return rule.op === "none_of" ? !hit : hit;
  }
  if (def.kind === "date") {
    const d = vals.map(parseDate).find(Boolean) ?? null;
    if (!d) return false;
    const diff = dayDiff(d, now);
    switch (rule.op) {
      case "on": return ymdLocal(d) === String(value);
      case "before": { const ref = parseDate(String(value)); return !!ref && startOfDay(d) < startOfDay(ref); }
      case "after": { const ref = parseDate(String(value)); return !!ref && startOfDay(d) > startOfDay(ref); }
      case "overdue": return diff < 0 && !isDoneStatus(task.status);
      case "today": return diff === 0;
      case "this_week": {
        const dow = (startOfDay(now).getDay() + 6) % 7; // Monday = 0
        return diff >= -dow && diff <= 6 - dow;
      }
      case "next_days": { const n = Math.max(1, Number(value) || 0); return diff >= 0 && diff <= n - 1; }
      case "past_days": { const n = Math.max(1, Number(value) || 0); return diff <= 0 && diff >= -(n - 1); }
    }
    return true;
  }
  if (def.kind === "number" || def.kind === "count") {
    if (vals.length === 0) return false;
    const n = Number(vals[0]);
    const ref = Number(value);
    if (Number.isNaN(n) || Number.isNaN(ref)) return false;
    switch (rule.op) {
      case "eq": return n === ref;
      case "neq": return n !== ref;
      case "gt": return n > ref;
      case "gte": return n >= ref;
      case "lt": return n < ref;
      case "lte": return n <= ref;
    }
    return true;
  }
  if (def.kind === "checkbox") {
    const on = vals.some((v) => v === "true" || v === "1" || v.toLowerCase() === "yes");
    return rule.op === "checked" ? on : !on;
  }
  return true;
}

export function matchGroup(task: NexusTask, group: FilterGroup, defs: PropDef[], ctx: Pick<ViewCtx, "meId" | "now">): boolean {
  const active = group.rules.filter((r) => (isGroup(r) ? countRules(r) > 0 : ruleIsActive(r, propDef(defs, r.prop)?.kind)));
  if (active.length === 0) return true;
  const test = (r: FilterRule | FilterGroup) => (isGroup(r) ? matchGroup(task, r, defs, ctx) : matchRule(task, r, defs, ctx));
  return group.mode === "or" ? active.some(test) : active.every(test);
}

export function countRules(g: FilterGroup | null | undefined): number {
  if (!g) return 0;
  return g.rules.reduce((n, r) => n + (isGroup(r) ? countRules(r) : 1), 0);
}

/** Search box: title, description text, section, tags, assignees, custom field values. */
export function matchSearch(task: NexusTask, query: string, ctx: Pick<ViewCtx, "sections">): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const section = ctx.sections.find((s) => s.id === sectionIdOf(task))?.name ?? task.taskList?.name ?? "";
  const desc = typeof task.description === "string" ? task.description : "";
  const hay = [
    task.title,
    desc,
    section,
    ...(task.tags ?? []),
    ...(task.assignees ?? []).map((a) => a.user?.name || a.user?.email || ""),
    ...(task.customFieldValues ?? []).map((c) => c.value ?? ""),
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

export function taskMatches(task: NexusTask, filter: ViewFilter, query: string, defs: PropDef[], ctx: ViewCtx): boolean {
  for (const r of filter.simple) if (!matchRule(task, r, defs, ctx)) return false;
  if (filter.advanced && !matchGroup(task, filter.advanced, defs, ctx)) return false;
  return matchSearch(task, query, ctx);
}

export function activeFilterCount(filter: ViewFilter, defs: PropDef[]): number {
  return filter.simple.filter((r) => ruleIsActive(r, propDef(defs, r.prop)?.kind)).length + countRules(filter.advanced);
}

// ─── sort ────────────────────────────────────────────────────────────────────────────────────────────

function sortKey(task: NexusTask, key: string, defs: PropDef[], ctx: ViewCtx): string | number | null {
  const def = propDef(defs, key);
  const vals = taskValues(task, key);
  if (key === "status") return STATUS_ORDER.indexOf(vals[0]) === -1 ? 99 : STATUS_ORDER.indexOf(vals[0]);
  if (key === "priority") return PRIORITY_ORDER.indexOf(vals[0]) === -1 ? 99 : PRIORITY_ORDER.indexOf(vals[0]);
  if (key === "section") {
    const s = ctx.sections.find((x) => x.id === vals[0]);
    return s ? groupIndex(s.taskStatus) * 100000 + (s.position ?? 0) : null;
  }
  if (vals.length === 0) return null;
  if (key === "assignee") {
    const names = vals.map((id) => ctx.people.find((p) => p.id === id)?.name ?? (task.assignees ?? []).find((a) => a.user?.id === id)?.user?.name ?? id);
    return names.sort((a, b) => a.localeCompare(b))[0].toLowerCase();
  }
  if (!def) return vals[0].toLowerCase();
  if (def.kind === "date") return parseDate(vals[0])?.getTime() ?? null;
  if (def.kind === "number" || def.kind === "count") { const n = Number(vals[0]); return Number.isNaN(n) ? null : n; }
  if (def.kind === "select" && def.options?.length) {
    const i = def.options.findIndex((o) => o.value === vals[0]);
    return i === -1 ? 1000 : i;
  }
  if (def.kind === "checkbox") return vals[0] === "true" ? 1 : 0;
  return vals.join(", ").toLowerCase();
}

/** Sorted copy. Empty values go last in both directions (as Notion does). Stable: ties keep manual order. */
export function sortTasks<T extends NexusTask>(tasks: T[], sort: SortRule[], defs: PropDef[], ctx: ViewCtx): T[] {
  const rules = sort.filter((s) => s.prop === "title" || propDef(defs, s.prop));
  if (rules.length === 0) return tasks;
  const keyed = tasks.map((t, i) => ({ t, i, k: rules.map((r) => sortKey(t, r.prop, defs, ctx)) }));
  keyed.sort((a, b) => {
    for (let j = 0; j < rules.length; j++) {
      const x = a.k[j];
      const y = b.k[j];
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return rules[j].dir === "desc" ? -c : c;
    }
    return a.i - b.i;
  });
  return keyed.map((x) => x.t);
}

// ─── group ───────────────────────────────────────────────────────────────────────────────────────────

export const EMPTY_GROUP = "__none__";
export type TaskGroup<T extends NexusTask = NexusTask> = { key: string; label: string; tasks: T[]; empty?: boolean; tone?: string };

const DUE_BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "next7", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "past", label: "Earlier" },
];

function dateBucket(task: NexusTask, key: string, now: Date): string {
  const d = parseDate(taskValues(task, key)[0]);
  if (!d) return EMPTY_GROUP;
  const diff = dayDiff(d, now);
  if (diff < 0) return key === "due" && !isDoneStatus(task.status) ? "overdue" : "past";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "next7";
  return "later";
}

/** The group keys a task falls in for a property (a multi / person value can put it in several). */
export function groupKeysOf(task: NexusTask, key: string, defs: PropDef[], ctx: ViewCtx): string[] {
  const def = propDef(defs, key);
  if (!def) return [EMPTY_GROUP];
  if (def.kind === "date") return [dateBucket(task, key, ctx.now ?? new Date())];
  if (def.kind === "checkbox") return [taskValues(task, key).some((v) => v === "true") ? "true" : "false"];
  const vals = taskValues(task, key);
  return vals.length ? Array.from(new Set(vals)) : [EMPTY_GROUP];
}

/**
 * Does a group's label come from NEXUS (English, to translate) or from the user's data (shown as is)?
 * Status / priority / date buckets / checkbox / the "no value" group are NEXUS words.
 */
export function groupLabelIsBuiltin(groupBy: string | null | undefined, groupKey: string, defs: PropDef[]): boolean {
  if (groupKey === EMPTY_GROUP) return true;
  if (groupBy === "status" || groupBy === "priority") return true;
  const kind = propDef(defs, groupBy)?.kind;
  return kind === "date" || kind === "checkbox";
}

/** The groups of a property in display order, with every defined option (so empty groups can show). */
export function groupSkeleton(key: string, defs: PropDef[], ctx: ViewCtx): Array<{ key: string; label: string }> {
  const def = propDef(defs, key);
  if (!def) return [{ key: EMPTY_GROUP, label: "No value" }];
  if (def.kind === "date") {
    return [...DUE_BUCKETS.filter((b) => key === "due" || b.key !== "overdue"), { key: EMPTY_GROUP, label: "No date" }];
  }
  if (def.kind === "checkbox") return [{ key: "true", label: "Checked" }, { key: "false", label: "Not checked" }];
  const opts = def.options ?? [];
  const none = key === "assignee" ? "No assignee" : "No value";
  if (key === "section") return opts.map((o) => ({ key: o.value, label: o.label }));
  return [...opts.map((o) => ({ key: o.value, label: o.label })), ...(key === "status" || key === "priority" ? [] : [{ key: EMPTY_GROUP, label: none }])];
}

export function groupTasks<T extends NexusTask>(tasks: T[], key: string, defs: PropDef[], ctx: ViewCtx): TaskGroup<T>[] {
  const skeleton = groupSkeleton(key, defs, ctx);
  const map = new Map<string, TaskGroup<T>>(skeleton.map((g) => [g.key, { key: g.key, label: g.label, tasks: [] as T[] }]));
  const extra: TaskGroup<T>[] = [];
  for (const t of tasks) {
    for (const k of groupKeysOf(t, key, defs, ctx)) {
      let g = map.get(k);
      if (!g) {
        // A value outside the defined options (a legacy select value, an assignee who left, a tag).
        let label = k;
        if (key === "assignee" || propDef(defs, key)?.kind === "person") label = (t.assignees ?? []).find((a) => a.user?.id === k)?.user?.name ?? "Former member";
        g = { key: k, label, tasks: [] };
        map.set(k, g);
        extra.push(g);
      }
      g.tasks.push(t);
    }
  }
  const ordered = skeleton.map((s) => map.get(s.key)!);
  // Extra values sit before the "No value" group, alphabetically.
  extra.sort((a, b) => a.label.localeCompare(b.label));
  const noneIdx = ordered.findIndex((g) => g.key === EMPTY_GROUP);
  if (noneIdx === -1) ordered.push(...extra);
  else ordered.splice(noneIdx, 0, ...extra);
  return ordered.map((g) => ({ ...g, empty: g.tasks.length === 0 }));
}

/** The number in a group header. */
export function groupCalcValue(tasks: NexusTask[], calc: GroupCalc, defs: PropDef[]): { value: string; label: string; hint?: { done: number; total: number } } {
  switch (calc.kind) {
    case "done": {
      const done = tasks.filter((t) => isDoneStatus(t.status)).length;
      return { value: `${done}/${tasks.length}`, label: "Done", hint: { done, total: tasks.length } };
    }
    case "percent_done": {
      const done = tasks.filter((t) => isDoneStatus(t.status)).length;
      return { value: tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : "0%", label: "Done" };
    }
    case "sum":
    case "avg": {
      const def = propDef(defs, calc.prop);
      if (!def) return { value: String(tasks.length), label: "Count" };
      const nums = tasks.map((t) => Number(taskValues(t, def.key)[0])).filter((n) => !Number.isNaN(n));
      const sum = nums.reduce((a, b) => a + b, 0);
      const v = calc.kind === "sum" ? sum : nums.length ? sum / nums.length : 0;
      // In the field's own format ("Rp …", "42%"…); a plain number field is just grouped (owner, 12 Oct 2026).
      const text = def.number ? formatCalcNumber(v, def.number, calc.kind === "avg") : formatNumberProp(v, def.numberFormat, calc.kind === "avg" ? 1 : 0);
      return { value: text, label: calc.kind === "sum" ? `Sum of ${def.label}` : `Average ${def.label}` };
    }
    default:
      return { value: String(tasks.length), label: "Count" };
  }
}

/** A calculated number in its field's format; an average with Default decimals is not printed to 16 places. */
function formatCalcNumber(v: number, o: NumberOptions, averaged: boolean): string {
  if (!averaged || o.decimals !== null) return formatNumberWith(v, o);
  const places = o.numberFormat === "percent" ? 4 : o.numberFormat === "IDR" ? 0 : 2;
  return formatNumberWith(Number(v.toFixed(places)), o);
}

/** Which footer calculations a column offers: counts for every column, sums and the rest for numbers. */
export function columnCalcsFor(def: PropDef | undefined): ColumnCalc[] {
  if (!def) return [];
  return def.kind === "number" || def.kind === "count" ? [...COUNT_CALCS, ...NUMBER_CALCS] : [...COUNT_CALCS];
}

/**
 * A Table column's footer value over the view's tasks. Sum, Average, Median, Min, Max and Range keep the
 * field's number format and decimals; counts and percents are plain ("12", "25%").
 */
export function columnCalcValue(tasks: NexusTask[], calc: ColumnCalc, def: PropDef): string {
  const values = tasks.map((t) => taskValues(t, def.key));
  const filled = def.kind === "count" ? values.filter((v) => v.length && v[0] !== "0").length : values.filter((v) => v.length > 0).length;
  const total = tasks.length;
  const pct = (k: number) => `${total ? formatCount((k / total) * 100, 1) : "0"}%`;
  switch (calc) {
    case "count_all": return formatCount(total);
    case "count_values": return formatCount(filled);
    case "count_empty": return formatCount(total - filled);
    case "percent_empty": return pct(total - filled);
    case "percent_not_empty": return pct(filled);
  }
  const nums = values.map((v) => (v.length ? Number(v[0]) : Number.NaN)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return "";
  let v: number;
  switch (calc) {
    case "sum": v = nums.reduce((a, b) => a + b, 0); break;
    case "avg": v = nums.reduce((a, b) => a + b, 0) / nums.length; break;
    case "median": { const m = nums.length >> 1; v = nums.length % 2 ? nums[m] : (nums[m - 1] + nums[m]) / 2; break; }
    case "min": v = nums[0]; break;
    case "max": v = nums[nums.length - 1]; break;
    case "range": v = nums[nums.length - 1] - nums[0]; break;
    default: return "";
  }
  // Float noise from adding fractions (0.1 + 0.2) is not a real digit.
  v = Number(v.toPrecision(15));
  if (def.number) return formatCalcNumber(v, def.number, calc === "avg" || calc === "median");
  return formatCount(v, calc === "avg" || calc === "median" ? 2 : 0);
}

// ─── config ──────────────────────────────────────────────────────────────────────────────────────────

/** What a card / row / column shows when the view has not chosen (null): what the old tabs showed. */
export function defaultVisibleProps(layout: ViewLayout, defs: PropDef[]): string[] {
  const cfs = defs.filter((d) => !d.builtin).map((d) => d.key);
  switch (layout) {
    case "board":
      return ["priority", "tags", ...cfs, "due", "subtasks", "comments", "assignee"];
    // List and Table show every custom field, like the Board (UI tour run 7, 14 Oct 2026: the List kept
    // only the first three, so a 4th "Kategori" select showed on the Board and not in the List, and the
    // Table showed none, so a project whose dates live in a custom field read as "no due dates").
    case "list":
      return ["due", ...cfs, "priority", "status", "assignee"];
    case "table":
      return ["assignee", "due", ...cfs, "priority", "status", "tags"];
    case "gallery":
      return ["status", "due", "assignee"];
    case "calendar":
    case "timeline":
      return ["status", "assignee"];
  }
}

export function defaultConfig(layout: ViewLayout): ViewConfig {
  return {
    filter: { simple: [], advanced: null },
    sort: [],
    groupBy: layout === "board" || layout === "list" || layout === "table" || layout === "timeline" ? "section" : null,
    subGroupBy: null,
    hiddenGroups: [],
    collapsedGroups: [],
    // Every layout shows an empty group by default, as the Board does ("To Do 0"): the List hid it, so the two
    // views of one project disagreed (UI tour run 13, W-B20). "Hide empty groups" in Group still hides them.
    hideEmptyGroups: false,
    groupCalc: { kind: layout === "list" ? "done" : "count" },
    visibleProps: null,
    cardSize: "medium",
    cardCover: layout === "gallery" ? "image" : "none",
    colorBy: null,
    colorRules: [],
    dateProp: "due",
    startProp: "start",
    endProp: "due",
    showSubtasks: layout === "board" || layout === "list",
    wrap: false,
    columnCalcs: {},
  };
}

function asFilter(v: unknown): ViewFilter {
  if (!v || typeof v !== "object") return { simple: [], advanced: null };
  const f = v as Partial<ViewFilter>;
  return {
    simple: Array.isArray(f.simple) ? f.simple.filter((r) => r && typeof r.prop === "string" && typeof r.op === "string") : [],
    advanced: f.advanced && Array.isArray(f.advanced.rules) ? f.advanced : null,
  };
}

/** The view's config with every default filled in. */
export function resolveConfig(view: Pick<NexusProjectView, "layout" | "config">): ViewConfig {
  const d = defaultConfig(view.layout);
  const c = (view.config ?? {}) as Partial<ViewConfig>;
  return {
    ...d,
    ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
    filter: asFilter(c.filter),
    sort: Array.isArray(c.sort) ? c.sort.filter((s) => s && typeof s.prop === "string") : [],
    hiddenGroups: Array.isArray(c.hiddenGroups) ? c.hiddenGroups : [],
    collapsedGroups: Array.isArray(c.collapsedGroups) ? c.collapsedGroups : [],
    colorRules: Array.isArray(c.colorRules) ? c.colorRules : [],
    groupCalc: c.groupCalc && typeof c.groupCalc === "object" ? c.groupCalc : d.groupCalc,
    columnCalcs: c.columnCalcs && typeof c.columnCalcs === "object" && !Array.isArray(c.columnCalcs) ? c.columnCalcs : {},
  } as ViewConfig;
}

/** Visible properties that still exist (a deleted custom field drops out). */
export function visibleProps(cfg: ViewConfig, layout: ViewLayout, defs: PropDef[]): string[] {
  let list = cfg.visibleProps ?? defaultVisibleProps(layout, defs);
  // With status options, "status" means the option (the section): one Status, not two.
  if (propDef(defs, "status")?.hidden) list = Array.from(new Set(list.map((k) => (k === "status" ? "section" : k))));
  const known = new Set(defs.map((d) => d.key));
  return list.filter((k) => known.has(k) && k !== "title");
}

export function viewName(view: Pick<NexusProjectView, "name" | "layout" | "builtin">, t: (s: string) => string): string {
  if (view.name) return view.name;
  return t(LAYOUT_LABEL[(isBuiltinTab(view) ? view.builtin : view.layout) as ViewLayout] ?? "View");
}

// ─── URL (filter draft) ──────────────────────────────────────────────────────────────────────────────

/** Sort as it rides in the address: "due:asc,priority:desc". "none" = explicitly unsorted. */
export function encodeSort(sort: SortRule[]): string {
  return sort.length ? sort.map((s) => `${s.prop}:${s.dir}`).join(",") : "none";
}
export function decodeSort(raw: unknown): SortRule[] | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  if (raw === "none") return [];
  const out: SortRule[] = [];
  for (const part of raw.split(",").slice(0, 8)) {
    const i = part.lastIndexOf(":");
    const prop = i > 0 ? part.slice(0, i) : part;
    const dir = i > 0 && part.slice(i + 1) === "desc" ? "desc" : "asc";
    if (/^(title|section|status|priority|assignee|due|start|tags|created|updated|subtasks|comments|cf:[A-Za-z0-9_-]{1,64})$/.test(prop)) out.push({ prop, dir });
  }
  return out;
}
export function encodeFilter(filter: ViewFilter): string {
  return JSON.stringify(filter);
}
export function decodeFilter(raw: unknown): ViewFilter | undefined {
  if (typeof raw === "object" && raw) return asFilter(raw);
  if (typeof raw !== "string" || !raw || raw.length > 8000) return undefined;
  try { return asFilter(JSON.parse(raw)); } catch { return undefined; }
}

export function sameFilter(a: ViewFilter, b: ViewFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function sameSort(a: SortRule[], b: SortRule[]): boolean {
  return encodeSort(a) === encodeSort(b);
}

// ─── the old filter bar (Overview's counts open the board with these) ───────────────────────────────

export type LegacyDrill = { hideDone?: boolean; due?: "ALL" | "OVERDUE" | "NEXT7" | "NONE"; assigneeId?: string; priority?: string; section?: string };

export function filterFromDrill(d: LegacyDrill): ViewFilter {
  const simple: FilterRule[] = [];
  if (d.hideDone) simple.push({ id: newId(), prop: "status", op: "none_of", value: ["DONE"] });
  if (d.due === "OVERDUE") simple.push({ id: newId(), prop: "due", op: "overdue" });
  if (d.due === "NEXT7") simple.push({ id: newId(), prop: "due", op: "next_days", value: 7 });
  if (d.due === "NONE") simple.push({ id: newId(), prop: "due", op: "empty" });
  if (d.assigneeId && d.assigneeId !== "ALL") simple.push(d.assigneeId === "NONE" ? { id: newId(), prop: "assignee", op: "empty" } : { id: newId(), prop: "assignee", op: "any_of", value: [d.assigneeId] });
  if (d.priority && d.priority !== "ALL") simple.push({ id: newId(), prop: "priority", op: "any_of", value: [d.priority] });
  if (d.section && d.section !== "ALL") simple.push({ id: newId(), prop: "section", op: "any_of", value: [d.section] });
  return { simple, advanced: null };
}

// ─── colour ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Option colours (owner, 12 Oct 2026): Notion's nine, as CSS tokens in styles.css (--st-<key>-*), so a
 * custom status, a colour rule and a select pill all draw from one palette and follow dark mode.
 * `lane` tints a board column, `bg` a pill or card, `text` its text, `dot` the marker.
 */
export const COLOR_KEYS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
const COLOR_LABEL: Record<ColorKey, string> = { gray: "Gray", brown: "Brown", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", red: "Red" };
export const COLOR_PRESETS: Record<string, { label: string; lane: string; bg: string; border: string; text: string; dot: string }> = Object.fromEntries(
  COLOR_KEYS.map((k) => [k, { label: COLOR_LABEL[k], lane: `var(--st-${k}-lane)`, bg: `var(--st-${k}-bg)`, border: `var(--st-${k}-border)`, text: `var(--st-${k}-fg)`, dot: `var(--st-${k}-dot)` }]),
);
/** Older keys (the first views build, the calendar's old rules) → the palette's. */
const COLOR_ALIAS: Record<string, ColorKey> = { sky: "blue", emerald: "green", amber: "yellow", rose: "red", violet: "purple", slate: "gray" };
export function normalizeColor(c: string | null | undefined): ColorKey | null {
  if (!c) return null;
  if ((COLOR_KEYS as readonly string[]).includes(c)) return c as ColorKey;
  return COLOR_ALIAS[c] ?? null;
}

const PRIORITY_COLOR: Record<string, ColorKey> = { URGENT: "red", HIGH: "orange", MEDIUM: "blue", LOW: "green", NONE: "gray" };
/** A status's colour when its option has none of its own. */
export const STATUS_COLOR: Record<string, ColorKey> = { TODO: "gray", IN_PROGRESS: "blue", IN_REVIEW: "yellow", DONE: "green", CANCELLED: "red" };

/** A stable colour for an option of a property (priority/status have fixed ones, others rotate). */
export function optionColor(prop: string, value: string, defs: PropDef[]): ColorKey {
  if (prop === "priority") return PRIORITY_COLOR[value] ?? "gray";
  if (prop === "status") return STATUS_COLOR[value] ?? "gray";
  const def = propDef(defs, prop);
  const own = normalizeColor(def?.options?.find((o) => o.value === value)?.color);
  if (own) return own;
  const i = def?.options?.findIndex((o) => o.value === value) ?? -1;
  const palette = COLOR_KEYS.filter((k) => k !== "gray" && k !== "brown");
  if (i >= 0) return palette[i % palette.length];
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** A select custom field's option colour, as the views draw it (own colour, else the rotating palette by position). */
export function choiceColor(field: Pick<NexusCustomField, "options">, value: string, choices: string[]): ColorKey {
  const own = normalizeColor(fieldOptionColors(field)[value]);
  if (own) return own;
  const palette = COLOR_KEYS.filter((k) => k !== "gray" && k !== "brown");
  const i = choices.indexOf(value);
  if (i >= 0) return palette[i % palette.length];
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** The colour a task card takes in this view: the first matching rule, else "colour by" a property. */
export function taskColor(task: NexusTask, cfg: Pick<ViewConfig, "colorRules" | "colorBy">, defs: PropDef[], ctx: Pick<ViewCtx, "meId">): string | null {
  for (const r of cfg.colorRules) {
    const vals = taskValues(task, r.prop);
    const want = r.value === ME ? ctx.meId ?? "" : r.value;
    if (want && vals.includes(want)) return normalizeColor(r.color);
  }
  if (cfg.colorBy) {
    const v = taskValues(task, cfg.colorBy)[0];
    if (v) return optionColor(cfg.colorBy, v, defs);
  }
  return null;
}
