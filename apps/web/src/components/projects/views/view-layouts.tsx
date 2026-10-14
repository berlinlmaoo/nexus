import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, ChevronRight, CircleCheck, Clock, ImageOff, ListChecks, MessageSquare, Plus, UserRound } from "lucide-react";
import type { ReactNode } from "react";
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
    // who asked. It reads as that person, with a person icon, not as a date with a clock (UI tour run 7).
    if (Number.isNaN(new Date(vals[0]).getTime())) {
      return <span className={cn(pill, "bg-muted text-muted-foreground")} title={def.label}><UserRound className="h-3 w-3 shrink-0" />{vals[0]}</span>;
    }
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
    // Rp only for Rupiah fields; any other number field is a plain grouped number.
    const text = Number.isNaN(n) ? vals[0] : formatNumberProp(n, def.numberFormat, 2, locale);
    return <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={def.label}>{text}</span>;
  }
  if (def.kind === "checkbox") return vals[0] === "true" ? <span className={cn(pill, "bg-muted text-muted-foreground")}><CircleCheck className="h-3 w-3" />{def.label}</span> : null;
  if (def.kind === "person") {
    const names = vals.map((id) => ctx.people.find((p) => p.id === id)?.name ?? id);
    return <span className={cn(pill, "bg-muted text-muted-foreground")}>{names.join(", ")}</span>;
  }
  if (def.kind === "select" || def.kind === "multi") {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {vals.slice(0, 3).map((v) => {
          const c = COLOR_PRESETS[optionColor(def.key, v, [def])];
          return <span key={v} className={pill} style={{ backgroundColor: c.bg, color: c.text }}>{v}</span>;
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
  return <span className={cn(pill, "bg-muted text-muted-foreground")} title={def.label}>{vals[0]}</span>;
}

/** The properties a card shows, in the view's order. */
export function PropLine({ task, keys, defs, ctx, className }: { task: NexusTask; keys: string[]; defs: PropDef[]; ctx: ViewCtx; className?: string }) {
  const items = keys.map((k) => propDef(defs, k)).filter(Boolean) as PropDef[];
  if (!items.length) return null;
  // Dates read as one ordered group (UI tour run 9: "26 May · Rp… · 24 May 24 May" gave no way to tell
  // which date was which, nor a fixed order). Every date property the view shows is drawn together where
  // the first of them sits: start → due first (one chip, the clock icon), then the other date fields in
  // the view's order with a calendar icon and their name on hover. A day already on screen is not drawn
  // again; its field name joins the tooltip of the chip that shows it.
  const isDateItem = (d: PropDef) => d.kind === "date" && taskValues(task, d.key).some((v) => !Number.isNaN(new Date(v).getTime()));
  const firstDate = items.find(isDateItem)?.key ?? null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((d) => {
        if (isDateItem(d)) return d.key === firstDate ? <DateChips key="dates" task={task} items={items.filter(isDateItem)} /> : null;
        return <PropValue key={d.key} task={task} def={d} ctx={ctx} />;
      })}
    </div>
  );
}

/** A task's date properties as one ordered group: start → due, then every other date field, each day once. */
function DateChips({ task, items }: { task: NexusTask; items: PropDef[] }) {
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
    <span title={`${tip(startText)} · ${tip(dueText)}`} className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
      <Clock className="h-3 w-3" />{startText}<ArrowRight className="h-3 w-3 opacity-70" aria-hidden />{dueText}
    </span>
  ) : dueText || startText ? (
    <span title={tip((dueText ?? startText)!)} className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
      <Clock className="h-3 w-3" />{dueText ?? startText}{!dueText && <ArrowRight className="h-3 w-3 opacity-70" aria-hidden />}
    </span>
  ) : null;
  return (
    <>
      {lead}
      {others.map((text) => (
        <span key={text} title={tip(text)} className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          <CalendarDays className="h-3 w-3" />{text}
        </span>
      ))}
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
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", sticky && "sticky left-0", className)}>
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pl-0.5 pr-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/30">
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150", !collapsed && "rotate-90")} />
        {tone ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-sm font-medium" style={{ backgroundColor: tone.bg, color: tone.text }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
            <span className="truncate">{label}</span>
          </span>
        ) : (
          <span className="truncate text-sm font-semibold">{label}</span>
        )}
        <span className="shrink-0 text-xs tabular-nums" style={{ color: tone?.text ?? "var(--muted-foreground)" }} title={t(calc.label)}>{calc.value}</span>
      </button>
      {children}
    </div>
  );
}

const GALLERY_COLS: Record<ViewConfig["cardSize"], string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
  medium: "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]",
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
      style={{ borderRadius: 10, ...tint }}
      {...props}
      className={cn("group flex flex-col overflow-hidden border border-border bg-card text-left shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition-shadow hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/40", bulk.isSelected(task.id) && "ring-2 ring-[color:var(--accent-foreground)]")}
    >
      {cfg.cardCover === "image" && (
        <div className={cn("w-full overflow-hidden border-b border-border/70 bg-muted/60", cfg.cardSize === "small" ? "aspect-[16/9]" : "aspect-[16/10]")}>
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/50"><ImageOff className="h-5 w-5" aria-label={t("No image")} /></div>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <span className={cn("line-clamp-2 text-sm font-medium leading-snug", done && "text-muted-foreground line-through")}>{task.title}</span>
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
    <div className={cn("grid gap-3", GALLERY_COLS[cfg.cardSize])}>
      <Incremental items={tasks} first={40} step={40} markerClassName="col-span-full h-px" keyOf={(task) => task.id} render={(task) => <GalleryCard task={task} cover={cover(task.id)} keys={keys} defs={defs} ctx={ctx} cfg={cfg} onOpen={onOpen} />} />
      {canEdit && <button type="button" onClick={onCreate} className="grid min-h-24 place-items-center rounded-[10px] border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground">
        <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />{t("New task")}</span>
      </button>}
    </div>
  );
  return (
    <div className="space-y-6 px-4 py-4 md:px-8">
      {groups.map((g) => (
        <section key={g.key}>
          {groupBy && <GroupHeader group={g} groupBy={groupBy} defs={defs} cfg={cfg} collapsed={collapsed.has(g.key)} onToggle={() => onToggleGroup(g.key)} className="mb-2" />}
          {!collapsed.has(g.key) && grid(g.tasks)}
        </section>
      ))}
    </div>
  );
}
