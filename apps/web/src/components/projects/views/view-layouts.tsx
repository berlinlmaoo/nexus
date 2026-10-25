import { NumberValue } from "@/components/projects/number-field";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CircleCheck, Clock, ImageOff, ListChecks, MessageSquare, Plus, Type, UserRound } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { StatusPill } from "@/components/tasks/StatusPicker";
import { useTaskBulk } from "@/components/tasks/task-bulk";
import { nexusApi, type NexusTask } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { priorityTone } from "@/lib/calendar/tone";
import { cn } from "@/lib/utils";
import { Incremental } from "./incremental";
import { useProjectCanEdit } from "@/components/projects/project-access";
import {
  COLOR_PRESETS,
  groupCalcValue,
  groupLabelIsBuiltin,
  isDoneStatus,
  optionColor,
  formatNumberProp,
  propDef,
  taskColor,
  taskValues,
  type PropDef,
  type TaskGroup,
  type ViewConfig,
  type ViewCtx,
} from "@/lib/project-views";

const STATUS_PILL: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  IN_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  DONE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  CANCELLED: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};
const STATUS_TEXT: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };
const PRIORITY_TEXT: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "No priority" };

function useDateFmt() {
  const { locale } = useLang();
  return (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return (new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d)).replace(/\bSept\b/, "Sep");
  };
}

const pill = "inline-flex max-w-[160px] shrink-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-4";

/** One property of a task, compact, for cards and rows. Null when the task has nothing there. */
export function PropValue({ task, def, ctx }: { task: NexusTask; def: PropDef; ctx: ViewCtx }) {
  const { t, locale } = useLang();
  const fmt = useDateFmt();
  const vals = taskValues(task, def.key);
  switch (def.key) {
    case "status": {
      const opt = ctx.sections.find((x) => x.id === (task.taskListId ?? task.taskList?.id));
      if (opt?.taskStatus) return <StatusPill option={opt} />;
      const s = vals[0] ?? "TODO";
      return <span className={cn(pill, STATUS_PILL[s] ?? STATUS_PILL.TODO)}>{t(STATUS_TEXT[s] ?? s)}</span>;
    }
    case "priority": {
      const p = vals[0] ?? "NONE";
      if (p === "NONE") return null;
      return <span className={cn(pill, "rounded-full", priorityTone(p))}>{t(PRIORITY_TEXT[p] ?? p)}</span>;
    }
    case "assignee": {
      const people = (task.assignees ?? []).map((a) => a.user).filter(Boolean);
      if (people.length === 0) return null;
      return (
        <span className="inline-flex shrink-0 items-center -space-x-1.5" title={people.map((u) => u?.name ?? "").join(", ")}>
          {people.slice(0, 3).map((u) => <Avatar key={u!.id} userId={u!.id} name={u!.name} avatar={u!.avatar} size={20} className="ring-2 ring-card" />)}
          {people.length > 3 && <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card">+{people.length - 3}</span>}
        </span>
      );
    }
    case "section": {
      const s = ctx.sections.find((x) => x.id === vals[0]);
      if (!s) return null;
      // A section that stands for a status is the task's status option: a Notion pill in its colour.
      return s.taskStatus || s.color ? <StatusPill option={s} /> : <span className={cn(pill, "bg-muted text-muted-foreground")}>{s.name}</span>;
    }
    case "subtasks": {
      const subs = task.subtasks ?? [];
      if (!subs.length) return null;
      const done = subs.filter((s) => isDoneStatus(s.status)).length;
      return <span className={cn(pill, done === subs.length ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground")}><ListChecks className="h-3 w-3" />{done}/{subs.length}</span>;
    }
    case "comments": {
      const n = task._count?.comments ?? 0;
      return n ? <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><MessageSquare className="h-3 w-3" />{n}</span> : null;
    }
    case "tags":
      return vals.length ? <span className="inline-flex flex-wrap gap-1">{vals.slice(0, 4).map((tag) => <span key={tag} className={cn(pill, "bg-muted text-muted-foreground")}>#{tag}</span>)}</span> : null;
  }
  if (vals.length === 0) return null;
  if (def.kind === "date") {
    // A date field holding a name, not a date: Notion imports filled "Request by" (a Created-time field) with
    // who asked. That name is text, not a NEXUS person: it reads "Request by: Sinta" with the text glyph, never as
    // an assignee-looking chip (UI tour run 19, R19-WB-2, decision 5: the person glyph is for real people only).
    if (Number.isNaN(new Date(vals[0]).getTime())) return <TextProp label={def.label} value={vals[0]} />;
    const overdue = def.key === "due" && !isDoneStatus(task.status) && new Date(vals[0]).getTime() < new Date().setHours(0, 0, 0, 0);
    const label = def.builtin ? t(def.label) : def.label;
    // The two task dates read as what they are: due wears the clock, a lone start date the arrow it starts
    // from ("24 May →"); any other date field gets a calendar icon and its own name on hover (UI tour run 9:
    // "26 May · Rp… · 24 May 24 May" gave no way to tell which date was which).
    if (def.key === "start") {
      return <span title={`${label}: ${fmt(vals[0])}`} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" />{fmt(vals[0])}<ArrowRight className="h-3 w-3" /></span>;
    }
    const Icon = def.key === "due" ? Clock : CalendarDays;
    return <span title={`${label}: ${fmt(vals[0])}`} className={cn("inline-flex shrink-0 items-center gap-1 text-[11px]", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}><Icon className="h-3 w-3" />{fmt(vals[0])}</span>;
  }
  if (def.kind === "number") {
    const n = Number(vals[0]);
    // A number field in its own format ("Rp 1.500.000", "42%", "US$12,00") and Show as (Bar / Ring); any
    // other number (a rating) is a plain grouped number.
    if (!Number.isNaN(n) && def.number) {
      return <NumberValue n={n} options={def.number} title={def.label} className={cn("text-[11px] text-muted-foreground", def.number.showAs === "bar" ? "w-28 shrink-0" : "shrink-0")} />;
    }
    const text = Number.isNaN(n) ? vals[0] : formatNumberProp(n, def.numberFormat, 2, locale);
    return <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={def.label}>{text}</span>;
  }
  if (def.kind === "checkbox") return vals[0] === "true" ? <span className={cn(pill, "bg-muted text-muted-foreground")}><CircleCheck className="h-3 w-3" />{def.label}</span> : null;
  if (def.kind === "person") {
    // A real person (a PERSON field): the person glyph (decision 5).
    const names = vals.map((id) => ctx.people.find((p) => p.id === id)?.name ?? id);
    return <span className={cn(pill, "min-w-0 max-w-full bg-muted text-muted-foreground")} title={`${def.label}: ${names.join(", ")}`}><UserRound className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{names.join(", ")}</span></span>;
  }
  if (def.kind === "select" || def.kind === "multi") {
    return (
      <span className="inline-flex min-w-0 max-w-full flex-wrap gap-1">
        {vals.slice(0, 3).map((v) => {
          const c = COLOR_PRESETS[optionColor(def.key, v, [def])];
          // The text in its own span: an ellipsis is only drawn on a block, not on the flex pill itself.
          return <span key={v} className={cn(pill, "min-w-0 max-w-full")} style={{ backgroundColor: c.bg, color: c.text }} title={v}><span className="truncate">{v}</span></span>;
        })}
        {vals.length > 3 && <span className={cn(pill, "bg-muted text-muted-foreground")}>+{vals.length - 3}</span>}
      </span>
    );
  }
  if (def.fieldType === "URL") {
    let label = vals[0];
    try { label = new URL(vals[0]).hostname.replace(/^www\./, ""); } catch { /* keep */ }
    return <span className={cn(pill, "bg-muted text-muted-foreground")}>{label}</span>;
  }
  if (def.fieldType === "FILE") return <span className={cn(pill, "bg-muted text-muted-foreground")}>{t(vals.length === 1 ? "1 file" : "{n} files", { n: vals.length })}</span>;
  if (def.kind === "text") return <TextProp label={def.label} value={vals[0]} />;
  return <span className={cn(pill, "min-w-0 max-w-full bg-muted text-muted-foreground")} title={`${def.label}: ${vals[0]}`}><span className="truncate">{vals[0]}</span></span>;
}

/** A text property on a card: its field name and the text, with the text glyph ("Request by: Sinta"), so it never
 *  reads as a person (UI tour run 19, R19-WB-2, decision 5). */
function TextProp({ label, value }: { label: string; value: string }) {
  return (
    <span className={cn(pill, "min-w-0 max-w-[min(240px,100%)] bg-muted text-muted-foreground")} title={`${label}: ${value}`}>
      <Type className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate"><span className="opacity-80">{label}:</span> <span className="text-foreground/80">{value}</span></span>
    </span>
  );
}

/** The properties a card shows, in the view's order. */
export function PropLine({ task, keys, defs, ctx, className, slots }: { task: NexusTask; keys: string[]; defs: PropDef[]; ctx: ViewCtx; className?: string;
  /** List rows (sm and up): the assignee keeps a fixed-width slot, empty or not, so the status pill before it
   *  sits at the same x on every row (UI tour run 11, WD-15: rows with an avatar pushed it left). */
  slots?: boolean }) {
  const items = keys.map((k) => propDef(defs, k)).filter(Boolean) as PropDef[];
  if (!items.length) return null;
  // Dates read as one ordered group (UI tour run 9: "26 May · Rp… · 24 May 24 May" gave no way to tell
  // which date was which, nor a fixed order). Every date property the view shows is drawn together where
  // the first of them sits: start → due first (one chip, the clock icon), then the other date fields in
  // the view's order with a calendar icon and their name on hover. A day already on screen is not drawn
  // again; its field name joins the tooltip of the chip that shows it.
  // The group's slot is the view's first date property, whether or not this task has a value for it: anchoring
  // it on the first date the task happens to have moved the dates past the amount on some rows and not on
  // others (UI tour run 10, WD-4). Every row now reads in the same order.
  const isDateItem = (d: PropDef) => d.kind === "date" && taskValues(task, d.key).some((v) => !Number.isNaN(new Date(v).getTime()));
  const dateItems = items.filter(isDateItem);
  if (slots) {
    // List rows (sm and up): every property has a column of its own width, kept empty when the task has no
    // value, so the dates, amounts, people, tags, priority and status line up from row to row (UI tour run 13,
    // W-D14: the chips shifted with each row's content). On a phone the line stays one line (W-M16).
    const firstDateKey = items.find((d) => d.kind === "date")?.key ?? null;
    return (
      // Phone: the line wraps to a second one when it has to, instead of cutting the status and the people off
      // at the edge (UI tour run 14, WM-3).
      <div className={cn("flex items-center gap-1.5 max-sm:flex-wrap max-sm:gap-y-1", className)}>
        {items.map((d) => {
          if (d.kind === "date" && d.key !== firstDateKey) return null;
          const content = d.key === firstDateKey
            ? <><DateChips task={task} items={dateItems} fit />{!isDateItem(d) && <PropValue task={task} def={d} ctx={ctx} />}</>
            : <PropValue task={task} def={d} ctx={ctx} />;
          // Phone: the dates first and the people right after them, so a wrapped line never leaves an avatar alone
          // on a third line (UI tour run 20, R20-WM-12).
          return <span key={d.key} className={cn("inline-flex min-w-0 items-center gap-1 max-sm:shrink-0 max-sm:empty:hidden sm:overflow-hidden sm:[&>*]:max-w-full", d.kind === "date" ? "max-sm:order-1" : d.key === "assignee" ? "max-sm:order-2" : "max-sm:order-3", listSlotWidth(d))}>{content}</span>;
        })}
      </div>
    );
  }
  const firstDate = dateItems.length ? (items.find((d) => d.kind === "date")?.key ?? null) : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((d) => {
        if (d.key === firstDate) {
          // The slot's own field may hold a name instead of a date (a Notion "Request by"): it follows the dates.
          return <Fragment key="dates"><DateChips task={task} items={dateItems} />{!isDateItem(d) && <PropValue task={task} def={d} ctx={ctx} />}</Fragment>;
        }
        if (isDateItem(d)) return null;
        return <PropValue key={d.key} task={task} def={d} ctx={ctx} />;
      })}
    </div>
  );
}

/** listSlotWidth in rem, for the row's minimum width (listRowMinWidth). Keep the two in step. */
function listSlotRem(d: PropDef): number {
  if (d.key === "assignee") return 3.75;
  if (d.kind === "date") return 12.5;
  if (d.kind === "number") return 6.5;
  if (d.key === "priority") return 4.75;
  if (d.key === "status" || d.key === "section" || d.kind === "person") return 7.5;
  return 7;
}

/**
 * A List row's minimum width from sm up: the name's own minimum (16rem), every property column at its full width
 * and the row's checkbox, chevron, gaps and padding. Narrower than that, the list scrolls sideways instead of
 * cutting the last columns (status, priority, people) at the row's end (owner, 25 Oct 2026: clipped text blocks
 * the release). Mirrors PropLine's slots: one column for all the dates.
 */
export function listRowMinWidth(keys: string[], defs: PropDef[]): string {
  const items = keys.map((k) => propDef(defs, k)).filter(Boolean) as PropDef[];
  const firstDate = items.find((d) => d.kind === "date")?.key ?? null;
  const slots = items.filter((d) => d.kind !== "date" || d.key === firstDate);
  if (!slots.length) return "0px";
  const props = slots.reduce((sum, d) => sum + listSlotRem(d), 0) + (slots.length - 1) * 0.375;
  // padding 1 + checkbox 1 + name 16 + chevron 1 + three 0.625 gaps + 0.5 to spare
  return `${(props + 1 + 1 + 16 + 1 + 3 * 0.625 + 0.5).toFixed(3)}rem`;
}

/** A List row's column width for a property (sm and up), wide enough for its usual value. */
function listSlotWidth(d: PropDef): string {
  if (d.key === "assignee") return "sm:w-[3.75rem] sm:justify-start";
  // Room for the due date and one more date with its field name ("26 May · Request by 24 May", run 19 WD-4).
  if (d.kind === "date") return "sm:w-[12.5rem] sm:justify-end";
  if (d.kind === "number") return "sm:w-[6.5rem] sm:justify-end";
  if (d.key === "priority") return "sm:w-[4.75rem]";
  if (d.key === "status" || d.key === "section") return "sm:w-[7.5rem]";
  if (d.kind === "person") return "sm:w-[7.5rem]";
  return "sm:w-[7rem]";
}

/**
 * A task's date properties as one ordered group: start → due, then every other date field, each day once.
 * `fit` (a List row's date column): the lead chip and at most one more day; the rest fold into "+N", whose
 * tooltip names them (UI tour run 14, WD-5: three dates overflowed the column and the first was cut).
 */
function DateChips({ task, items, fit }: { task: NexusTask; items: PropDef[]; fit?: boolean }) {
  const { t } = useLang();
  const fmt = useDateFmt();
  const label = (d: PropDef) => (d.builtin ? t(d.label) : d.label);
  const start = items.find((d) => d.key === "start");
  const due = items.find((d) => d.key === "due");
  const startText = start && task.startDate ? fmt(task.startDate) : null;
  const dueText = due && task.dueDate ? fmt(task.dueDate) : null;
  const overdue = !!dueText && !isDoneStatus(task.status) && new Date(task.dueDate!).getTime() < new Date().setHours(0, 0, 0, 0);
  // day text → the field names that day stands for (so a repeated day becomes one chip with two names).
  const shown = new Map<string, string[]>();
  if (startText) shown.set(startText, [label(start!)]);
  if (dueText) shown.set(dueText, [...(shown.get(dueText) ?? []), label(due!)]);
  const others: string[] = [];
  for (const d of items) {
    if (d.key === "start" || d.key === "due") continue;
    const v = taskValues(task, d.key)[0];
    const text = fmt(v);
    if (!shown.has(text)) others.push(text);
    shown.set(text, [...(shown.get(text) ?? []), label(d)]);
  }
  const tip = (text: string) => `${(shown.get(text) ?? []).join(", ")}: ${text}`;
  const lead = startText && dueText && startText !== dueText ? (
    <span title={`${tip(startText)} · ${tip(dueText)}`} aria-label={`${tip(startText)}, ${tip(dueText)}`} className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
      <Clock className="h-3 w-3 shrink-0" />{startText}<ArrowRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />{dueText}
    </span>
  ) : dueText || startText ? (
    <span title={tip((dueText ?? startText)!)} aria-label={tip((dueText ?? startText)!)} className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
      <Clock className="h-3 w-3 shrink-0" />{dueText ?? startText}{!dueText && <ArrowRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
    </span>
  ) : null;
  const room = !fit ? others.length : !lead ? 2 : startText && dueText && startText !== dueText ? 0 : 1;
  const shownOthers = others.slice(0, room);
  const folded = others.slice(room);
  return (
    <>
      {lead}
      {/* Any other date names its field ("Request by: 24 May"): beside the due date's clock a second bare date
          could not be told apart (UI tour run 19, R19-WD-4). With a colon, as a text property's "Request by: Sinta"
          (one pattern, UI tour run 20, R20-WD-8). */}
      {shownOthers.map((text) => (
        // The one part that gives way in a narrow slot: its field name truncates, never the due date and its clock
        // before it (UI tour run 20, R20-WD-3: "PELUNASAN …" lost half its clock).
        <span key={text} title={tip(text)} aria-label={tip(text)} className="inline-flex min-w-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          <CalendarDays className="h-3 w-3 shrink-0" aria-hidden /><span className="min-w-0 truncate opacity-80">{(shown.get(text) ?? [])[0]}:</span><span className="shrink-0">{text}</span>
        </span>
      ))}
      {folded.length > 0 && (
        <span title={folded.map(tip).join("\n")} className="inline-flex shrink-0 items-center rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">+{folded.length}</span>
      )}
    </>
  );
}

/** The card tint a view gives a task (conditional colour / colour by). */
export function cardTint(task: NexusTask, cfg: ViewConfig, defs: PropDef[], ctx: ViewCtx): React.CSSProperties | undefined {
  const c = taskColor(task, cfg, defs, ctx);
  if (!c) return undefined;
  const p = COLOR_PRESETS[c];
  return { backgroundColor: p.bg, borderColor: p.border, color: p.text };
}

/** A group's header: chevron, label (with its colour dot), the header calculation. */
export function GroupHeader({ group, groupBy, defs, cfg, collapsed, onToggle, children, className, sticky }: {
  group: TaskGroup; groupBy: string | null; defs: PropDef[]; cfg: ViewConfig; collapsed: boolean; onToggle: () => void; children?: ReactNode; className?: string; sticky?: boolean;
}) {
  const { t } = useLang();
  const calc = groupCalcValue(group.tasks, cfg.groupCalc, defs);
  const label = groupLabelIsBuiltin(groupBy, group.key, defs) ? t(group.label) : group.label;
  const def = propDef(defs, groupBy);
  // Options with a colour (status options, priorities, select values) show as their coloured pill, the
  // count in the same hue (Notion's coloured groups, owner 12 Oct 2026). Plain sections stay plain.
  const coloured = !!def && (def.kind === "select" || def.kind === "multi") && group.key !== "__none__" && (groupBy !== "section" || !!def.options?.find((o) => o.value === group.key)?.color);
  const tone = coloured ? COLOR_PRESETS[optionColor(groupBy!, group.key, defs)] : null;
  const pillDot = groupBy === "status" || groupBy === "section" || def?.fieldType === "STATUS";
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", sticky && "sticky left-0", className)}>
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pl-0.5 pr-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/30">
        {/* Notion's group toggle: a small solid triangle, pointing down while open. */}
        <svg aria-hidden viewBox="0 0 12 12" className={cn("h-4 w-4 shrink-0 p-[3px] text-foreground/70 transition-transform duration-150", collapsed && "-rotate-90")}><path d="M1.5 3.5h9L6 9z" fill="currentColor" /></svg>
        {tone ? (
          // Status values are round pills with a dot; other options are Notion's small square-cornered tags.
          <span className={cn("inline-flex min-w-0 items-center gap-1.5 truncate px-2 py-0.5 font-display text-sm font-semibold", pillDot ? "rounded-full pl-2" : "rounded-md")} style={{ backgroundColor: tone.bg, color: tone.text }}>
            {pillDot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />}
            <span className="truncate">{label}</span>
          </span>
        ) : (
          <span className="truncate font-display text-sm font-semibold">{label}</span>
        )}
        <span className="shrink-0 text-sm tabular-nums" style={{ color: tone?.text ?? "var(--muted-foreground)" }} title={calc.hint ? t("{done} of {total} tasks done", calc.hint) : t(calc.label)}>{calc.value}</span>
      </button>
      {children}
    </div>
  );
}

const GALLERY_COLS: Record<ViewConfig["cardSize"], string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
  medium: "grid-cols-[repeat(auto-fill,minmax(260px,1fr))]",
  large: "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]",
};

function GalleryCard({ task, cover, keys, defs, ctx, cfg, onOpen }: { task: NexusTask; cover?: string; keys: string[]; defs: PropDef[]; ctx: ViewCtx; cfg: ViewConfig; onOpen: (t: NexusTask) => void }) {
  const { t } = useLang();
  const bulk = useTaskBulk();
  const props = bulk.bindCard(task, () => onOpen(task));
  const done = isDoneStatus(task.status);
  const tint = cardTint(task, cfg, defs, ctx);
  return (
    <button
      type="button"
      data-morph-id={`gallery-taskcard-${task.id}`}
      style={{ borderRadius: 12, ...tint }}
      {...props}
      // Notion's gallery card (cover on top, the name under it) in NEXUS's soft card: 12px corners, the soft shadow.
      className={cn("group flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card text-left shadow-soft transition-[box-shadow,border-color] hover:border-ring/30 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", bulk.isSelected(task.id) && "ring-2 ring-ring")}
    >
      {cfg.cardCover === "image" && (
        <div className={cn("w-full overflow-hidden border-b border-border/70 bg-muted/60", cfg.cardSize === "small" ? "aspect-[16/9]" : "aspect-[2/1]")}>
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/50"><ImageOff className="h-5 w-5" aria-label={t("No image")} /></div>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2.5">
        <span className={cn("line-clamp-2 text-sm font-semibold leading-snug", done && "text-muted-foreground line-through")}>{task.title}</span>
        <PropLine task={task} keys={keys} defs={defs} ctx={ctx} />
      </div>
    </button>
  );
}

/** Gallery (owner, 12 Oct 2026): cards with the task's first image as cover, the title and chosen properties. */
export function GalleryView({ projectId, groups, groupBy, cfg, keys, defs, ctx, collapsed, onToggleGroup, onOpen, onCreate }: {
  projectId: string; groups: TaskGroup[]; groupBy: string | null; cfg: ViewConfig; keys: string[]; defs: PropDef[]; ctx: ViewCtx;
  collapsed: Set<string>; onToggleGroup: (k: string) => void; onOpen: (t: NexusTask) => void; onCreate: () => void;
}) {
  const { t } = useLang();
  const covers = useQuery({ queryKey: ["nexus", "project-task-covers", projectId], queryFn: () => nexusApi.projectTaskCovers(projectId), enabled: cfg.cardCover === "image", staleTime: 60_000, retry: false });
  const cover = (id: string) => covers.data?.covers[id]?.url;
  const canEdit = useProjectCanEdit();
  const grid = (tasks: NexusTask[]) => (
    <div className={cn("grid gap-4", GALLERY_COLS[cfg.cardSize])}>
      <Incremental items={tasks} first={40} step={40} markerClassName="col-span-full h-px" keyOf={(task) => task.id} render={(task) => <GalleryCard task={task} cover={cover(task.id)} keys={keys} defs={defs} ctx={ctx} cfg={cfg} onOpen={onOpen} />} />
      {canEdit && <button type="button" onClick={onCreate} className="grid min-h-24 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground">
        <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />{t("New task")}</span>
      </button>}
    </div>
  );
  return (
    <div className="space-y-6 nx-gx py-4">
      {groups.map((g) => (
        <section key={g.key}>
          {groupBy && <GroupHeader group={g} groupBy={groupBy} defs={defs} cfg={cfg} collapsed={collapsed.has(g.key)} onToggle={() => onToggleGroup(g.key)} className="mb-2" />}
          {!collapsed.has(g.key) && grid(g.tasks)}
        </section>
      ))}
    </div>
  );
}
