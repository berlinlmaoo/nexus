import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, FileText, ListChecks, Loader2, Pencil, Plus, Sparkles, Users } from "lucide-react";
import { Avatar, AvatarFace, AvatarStack } from "@/components/Avatar";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { nexusApi, statusLabel, type NexusProject, type NexusTask } from "@/lib/nexus-api";
import { priorityTone, STATUS } from "@/lib/calendar/tone";
import { COLOR_PRESETS } from "@/lib/project-views";
import { orderedOptions, usesStatusOptions } from "@/lib/status-options";
import { optionColorKey } from "@/components/tasks/StatusPicker";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * A task project's Overview tab (owner, 11 Oct 2026: "UI-nya jelek banget, data yang ditampilin cuma gitu
 * doang?"). It used to be a brief, four number tiles and a list of status counts. Now it answers what a
 * lead opens a project for: how far along it is, what is late or due soon, who carries what, and what
 * just got finished.
 *
 * Everything is computed from the project payload the page already has (GET /api/projects/:id — top-level
 * tasks with status, priority, dueDate, completedAt, completedById, assignees), never the board's filters,
 * so filtering the board does not change the numbers. Subtasks are not counted, as in the header's
 * progress. A count that can be shown as tasks opens the Board (or List) with the matching filter.
 *
 * Dates are compared as local calendar days: "overdue" = due before today, "next 7 days" = today and the
 * six days after it. Open = not Done and not Cancelled.
 */

export type OverviewDrill = { due?: "OVERDUE" | "NEXT7" | "NONE"; assigneeId?: string; priority?: string; section?: string };

const DAY = 86_400_000;
const CLOSED = new Set(["DONE", "CANCELLED", "COMPLETED", "COMPLETE"]);
const statusOf = (task: NexusTask) => (task.status || "TODO").toUpperCase();
const isDoneStatus = (s: string) => s === "DONE" || s === "COMPLETED" || s === "COMPLETE";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function dateOf(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Days from today to the task's due day (negative = late); null without a due date. */
function dueIn(task: NexusTask, today: Date): number | null {
  const d = dateOf(task.dueDate);
  return d ? Math.round((startOfDay(d).getTime() - today.getTime()) / DAY) : null;
}
const assigneeIds = (task: NexusTask) => (task.assignees ?? []).map((a) => a.user?.id).filter(Boolean) as string[];

/** Status segments, in the order work moves. Colours: open slate, in progress sky, review violet, done green. */
const STATUS_SEGMENTS = [
  { key: "TODO", label: "To do", dot: "bg-cal-todo" },
  { key: "IN_PROGRESS", label: "In progress", dot: "bg-sky-500" },
  { key: "IN_REVIEW", label: "In review", dot: "bg-violet-500" },
  { key: "DONE", label: "Done", dot: "bg-success" },
  { key: "CANCELLED", label: "Cancelled", dot: "bg-muted-foreground/35" },
] as const;

const PRIORITY_ROWS = [
  { key: "URGENT", label: "Urgent", bar: "bg-rose-500" },
  { key: "HIGH", label: "High", bar: "bg-red-500" },
  { key: "MEDIUM", label: "Medium", bar: "bg-sky-500" },
  { key: "LOW", label: "Low", bar: "bg-muted-foreground/40" },
  { key: "NONE", label: "No priority", bar: "bg-muted-foreground/25" },
] as const;

const CARD = "rounded-2xl border border-border bg-card shadow-soft";

function Section({ title, icon, action, children, className, id }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id: string }) {
  return (
    <section aria-labelledby={id} className={cn(CARD, "min-w-0 overflow-hidden", className)}>
      <div className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 id={id} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          {icon && <span className="text-muted-foreground" aria-hidden>{icon}</span>}
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkBtn = "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]";

export function ProjectOverview({
  project,
  tasks,
  onOpenTask,
  onDrill,
  onEditBrief,
  onAddTask,
}: {
  project: NexusProject;
  /** Every top-level task of the project, unfiltered. */
  tasks: NexusTask[];
  onOpenTask: (task: NexusTask) => void;
  /** Open the Board (or List) with this filter, done tasks hidden. */
  onDrill: (drill: OverviewDrill) => void;
  onEditBrief: () => void;
  onAddTask: () => void;
}) {
  const { t, tn, locale } = useLang();
  const today = startOfDay(new Date());

  const m = useMemo(() => {
    const now = startOfDay(new Date());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const weekAgo = now.getTime() - 6 * DAY;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const open: NexusTask[] = [];
    const overdue: NexusTask[] = [];
    const upcoming: NexusTask[] = [];
    let next7 = 0;
    let noDue = 0;
    let unassigned = 0;
    let done = 0;
    let doneLast7 = 0;
    const completed: NexusTask[] = [];
    const people = new Map<string, { open: number; overdue: number; doneMonth: number }>();
    const person = (id: string) => {
      let p = people.get(id);
      if (!p) people.set(id, (p = { open: 0, overdue: 0, doneMonth: 0 }));
      return p;
    };
    for (const mem of project.members ?? []) {
      const id = mem.userId || mem.user?.id;
      if (id) person(id);
    }
    for (const task of tasks) {
      const s = statusOf(task);
      const key = STATUS_SEGMENTS.some((x) => x.key === s) ? s : isDoneStatus(s) ? "DONE" : "TODO";
      byStatus[key] = (byStatus[key] ?? 0) + 1;
      const ids = assigneeIds(task);
      if (isDoneStatus(s)) {
        done++;
        completed.push(task);
        const at = dateOf(task.completedAt)?.getTime();
        if (at !== undefined && at >= weekAgo) doneLast7++;
        if (at !== undefined && at >= monthStart) for (const id of ids) person(id).doneMonth++;
        continue;
      }
      if (CLOSED.has(s)) continue;
      open.push(task);
      const pr = (task.priority || "NONE").toUpperCase();
      byPriority[pr] = (byPriority[pr] ?? 0) + 1;
      const d = dueIn(task, now);
      if (d === null) noDue++;
      else if (d < 0) overdue.push(task);
      else {
        if (d <= 6) next7++;
        if (d <= 13) upcoming.push(task);
      }
      if (ids.length === 0) unassigned++;
      for (const id of ids) {
        const p = person(id);
        p.open++;
        if (d !== null && d < 0) p.overdue++;
      }
    }
    const byDue = (a: NexusTask, b: NexusTask) => (dateOf(a.dueDate)?.getTime() ?? 0) - (dateOf(b.dueDate)?.getTime() ?? 0);
    overdue.sort(byDue);
    upcoming.sort(byDue);
    completed.sort((a, b) => (dateOf(b.completedAt ?? b.updatedAt)?.getTime() ?? 0) - (dateOf(a.completedAt ?? a.updatedAt)?.getTime() ?? 0));
    // Board columns: where the open work sits.
    const sections = [...(project.taskLists ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((list) => {
        const own = tasks.filter((x) => (x.taskListId ?? x.taskList?.id) === list.id);
        const closedN = own.filter((x) => CLOSED.has(statusOf(x))).length;
        return { id: list.id, name: list.name, total: own.length, open: own.length - closedN, done: own.filter((x) => isDoneStatus(statusOf(x))).length };
      });
    return { byStatus, byPriority, open, overdue, upcoming, next7, noDue, unassigned, done, doneLast7, completed, people, sections };
  }, [tasks, project.members, project.taskLists]);

  const total = tasks.length;
  const pct = total ? Math.round((m.done / total) * 100) : 0;
  // The status bar follows the project's status options when it has them (owner, 12 Oct 2026): one
  // segment per option, in its colour; else the five fixed statuses as before.
  const segs = useMemo(() => {
    const lists = project.taskLists ?? [];
    if (usesStatusOptions(lists)) {
      const count = new Map<string, number>();
      for (const task of tasks) { const k = task.taskListId ?? task.taskList?.id ?? ""; count.set(k, (count.get(k) ?? 0) + 1); }
      return orderedOptions(lists).map((o) => ({ key: o.id, label: o.name, translate: false, dot: "", dotColor: COLOR_PRESETS[optionColorKey(o)].dot, n: count.get(o.id) ?? 0, always: false }));
    }
    return STATUS_SEGMENTS.map((x) => ({ key: x.key, label: x.label, translate: true, dot: x.dot, dotColor: undefined as string | undefined, n: m.byStatus[x.key] ?? 0, always: x.key === "TODO" || x.key === "DONE" }));
  }, [project.taskLists, tasks, m.byStatus]);

  const memberById = useMemo(() => {
    const map = new Map<string, { name?: string | null; avatar?: string | null; role?: string }>();
    for (const mem of project.members ?? []) {
      const id = mem.userId || mem.user?.id;
      if (id) map.set(id, { name: mem.user?.name ?? mem.user?.email, avatar: mem.user?.avatar, role: mem.role });
    }
    for (const task of tasks) for (const a of task.assignees ?? []) if (a.user?.id && !map.has(a.user.id)) map.set(a.user.id, { name: a.user.name ?? a.user.email, avatar: a.user.avatar });
    return map;
  }, [project.members, tasks]);

  const dueLabel = (task: NexusTask) => {
    const d = dueIn(task, today);
    if (d === null) return "";
    if (d < 0) return tn(-d, "1 day late", "{n} days late");
    if (d === 0) return t("Today");
    if (d === 1) return t("Tomorrow");
    return dateOf(task.dueDate)!.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  };

  if (total === 0) {
    return (
      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:gap-6 md:p-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <EmptyState
            icon={ListChecks}
            title={t("No tasks in this project yet")}
            message={t("Progress, deadlines and who's working on what show up here once the project has tasks. Add the first one, or open the Board to set up its columns.")}
            action={<EmptyAction onClick={onAddTask}><Plus className="h-4 w-4" />{t("Add task")}</EmptyAction>}
          />
        </div>
        <div className="space-y-4 md:space-y-6 lg:col-span-4">
          <BriefCard project={project} onEdit={onEditBrief} />
          <StatusUpdatesCard projectId={project.id} />
        </div>
      </div>
    );
  }

  const counters: { key: string; label: string; value: number; hint: string; drill: OverviewDrill; tone?: "bad"; wide?: boolean }[] = [
    { key: "open", label: t("Open"), value: m.open.length, hint: tn(m.open.length, "Show 1 open task", "Show {n} open tasks"), drill: {}, wide: true },
    { key: "overdue", label: t("Overdue"), value: m.overdue.length, hint: tn(m.overdue.length, "Show 1 overdue task", "Show {n} overdue tasks"), drill: { due: "OVERDUE" }, tone: "bad" },
    { key: "next7", label: t("Due in 7 days"), value: m.next7, hint: tn(m.next7, "Show 1 task due in 7 days", "Show {n} tasks due in 7 days"), drill: { due: "NEXT7" } },
    { key: "nodue", label: t("No due date"), value: m.noDue, hint: tn(m.noDue, "Show 1 open task without a due date", "Show {n} open tasks without a due date"), drill: { due: "NONE" } },
    { key: "unassigned", label: t("Unassigned"), value: m.unassigned, hint: tn(m.unassigned, "Show 1 open task nobody is on", "Show {n} open tasks nobody is on"), drill: { assigneeId: "NONE" } },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 md:gap-6 md:p-8 lg:grid-cols-12">
      <div className="min-w-0 space-y-4 md:space-y-6 lg:col-span-8">
        {/* Progress: the stacked status bar is the progress visual; the counters open the board filtered. */}
        <section aria-labelledby="ov-progress" className={cn(CARD, "overflow-hidden")}>
          <div className="p-4 md:p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
              <div>
                <h3 id="ov-progress" className="text-sm font-semibold">{t("Progress")}</h3>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{pct}%</span>
                  <span className="text-sm text-muted-foreground tabular-nums">{t("{done} of {total} tasks done", { done: m.done, total })}</span>
                </p>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {m.doneLast7 > 0 ? tn(m.doneLast7, "1 finished in the last 7 days", "{n} finished in the last 7 days") : t("Nothing finished in the last 7 days")}
              </p>
            </div>
            <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={segs.filter((x) => x.n).map((x) => `${x.translate ? t(x.label) : x.label} ${x.n}`).join(", ")}>
              {segs.map((x) => {
                if (!x.n) return null;
                return <span key={x.key} className={cn("h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300", x.dot)} style={{ width: `${(x.n / total) * 100}%`, ...(x.dotColor ? { backgroundColor: x.dotColor } : {}) }} title={`${x.translate ? t(x.label) : x.label}: ${x.n}`} />;
              })}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {segs.filter((x) => x.n > 0 || x.always).map((x) => (
                <li key={x.key} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("h-2 w-2 rounded-full", x.dot)} style={x.dotColor ? { backgroundColor: x.dotColor } : undefined} />
                  <span className="text-muted-foreground">{x.translate ? t(x.label) : x.label}</span>
                  <span className="font-semibold tabular-nums">{x.n}</span>
                  <span className="text-muted-foreground tabular-nums">{total ? Math.round((x.n / total) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
            {counters.map((c) => (
              <div key={c.key} className={cn("bg-card", c.wide && "col-span-2 sm:col-span-1")}>
                <button
                  type="button"
                  onClick={() => onDrill(c.drill)}
                  disabled={c.value === 0}
                  aria-label={c.value ? c.hint : undefined}
                  title={c.value ? c.hint : undefined}
                  className="group flex h-full w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <dt className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="truncate">{c.label}</span>
                    {c.value > 0 && <ArrowUpRight aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-60" />}
                  </dt>
                  <dd className={cn("mt-1 text-xl font-semibold leading-7 tracking-tight tabular-nums", c.value === 0 ? "text-muted-foreground/60" : c.tone === "bad" ? STATUS.overdueText : "")}>{c.value}</dd>
                </button>
              </div>
            ))}
          </dl>
        </section>

        <DeadlinesCard overdue={m.overdue} upcoming={m.upcoming} noDue={m.noDue} openCount={m.open.length} dueLabel={dueLabel} onOpenTask={onOpenTask} onDrill={onDrill} />

        <TeamCard people={m.people} memberById={memberById} unassigned={m.unassigned} onDrill={onDrill} />
      </div>

      <div className="min-w-0 space-y-4 md:space-y-6 lg:col-span-4">
        <BriefCard project={project} onEdit={onEditBrief} />

        <Section id="ov-priority" title={t("Open tasks by priority")} icon={<AlertTriangle className="h-4 w-4" />}>
          {m.open.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">{t("Every task is done or cancelled.")}</p>
          ) : (
            <ul className="p-2">
              {PRIORITY_ROWS.filter((p) => p.key !== "NONE" || (m.byPriority.NONE ?? 0) > 0).map((p) => {
                const n = m.byPriority[p.key] ?? 0;
                return (
                  <li key={p.key}>
                    <button type="button" disabled={!n} onClick={() => onDrill({ priority: p.key })} className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:min-h-[44px]">
                      <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", p.key === "NONE" ? "bg-muted text-muted-foreground" : priorityTone(p.key))}>{t(p.label)}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", p.bar)} style={{ width: `${(n / m.open.length) * 100}%` }} /></span>
                      <span className={cn("text-right text-sm font-semibold tabular-nums", !n && "text-muted-foreground/60")}>{n}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {m.sections.length > 1 && (
          <Section id="ov-sections" title={t("Sections")} icon={<ListChecks className="h-4 w-4" />}>
            <ul className="p-2">
              {m.sections.map((s) => (
                <li key={s.id}>
                  <button type="button" disabled={!s.open} onClick={() => onDrill({ section: s.id })} className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent">
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.total ? t("{open} open · {done} done", { open: s.open, done: s.done }) : t("Empty")}</span>
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-success" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <RecentlyDoneCard completed={m.completed} memberById={memberById} onOpenTask={onOpenTask} />

        <StatusUpdatesCard projectId={project.id} />
      </div>
    </div>
  );
}

function TaskRow({ task, due, late, onOpen }: { task: NexusTask; due: string; late?: boolean; onOpen: () => void }) {
  const { t } = useLang();
  const pr = (task.priority || "").toUpperCase();
  const ids = assigneeIds(task);
  const inProgress = statusOf(task) === "IN_PROGRESS" || statusOf(task) === "IN_REVIEW";
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none pointer-coarse:min-h-[48px]">
        <span aria-hidden className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2", inProgress ? "border-sky-500" : STATUS.todoRing)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{task.title}</span>
          {task.taskList?.name && <span className="block truncate text-xs text-muted-foreground">{task.taskList.name}</span>}
        </span>
        {(pr === "URGENT" || pr === "HIGH") && <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 sm:inline-flex", priorityTone(pr))}>{t(pr === "URGENT" ? "Urgent" : "High")}</span>}
        {ids.length > 0 && <span className="hidden shrink-0 sm:block"><AvatarStack ids={ids} max={2} size={22} /></span>}
        <span className={cn("w-[5.5rem] shrink-0 text-right text-xs tabular-nums", late ? cn("font-semibold", STATUS.overdueText) : "text-muted-foreground")}>{due}</span>
      </button>
    </li>
  );
}

function DeadlinesCard({ overdue, upcoming, noDue, openCount, dueLabel, onOpenTask, onDrill }: { overdue: NexusTask[]; upcoming: NexusTask[]; noDue: number; openCount: number; dueLabel: (task: NexusTask) => string; onOpenTask: (task: NexusTask) => void; onDrill: (d: OverviewDrill) => void }) {
  const { t, tn } = useLang();
  const [allLate, setAllLate] = useState(false);
  const [allSoon, setAllSoon] = useState(false);
  const LIMIT = 5;
  const late = allLate ? overdue : overdue.slice(0, LIMIT);
  const soon = allSoon ? upcoming : upcoming.slice(0, LIMIT);
  const groupHead = "flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-semibold";
  return (
    <Section id="ov-deadlines" title={t("Deadlines")} icon={<CalendarClock className="h-4 w-4" />}>
      {overdue.length === 0 && upcoming.length === 0 ? (
        <div className="px-4 py-6 text-sm">
          <p className="font-medium">{openCount === 0 ? t("No open tasks, so nothing is due.") : t("Nothing overdue and nothing due in the next 14 days.")}</p>
          {noDue > 0 && (
            <p className="mt-1 text-muted-foreground">
              {tn(noDue, "1 open task has no due date. Give it one so it shows up here.", "{n} open tasks have no due date. Give them one so they show up here.")}{" "}
              <button type="button" onClick={() => onDrill({ due: "NONE" })} className="font-semibold text-primary hover:underline">{t("Show them")}</button>
            </p>
          )}
        </div>
      ) : (
        <div className="pb-2">
          {overdue.length > 0 && (
            <>
              <div className={cn(groupHead, STATUS.overdueText)}>{t("Overdue")}<span className="tabular-nums">{overdue.length}</span></div>
              <ul>{late.map((task) => <TaskRow key={task.id} task={task} due={dueLabel(task)} late onOpen={() => onOpenTask(task)} />)}</ul>
              {overdue.length > LIMIT && <div className="px-2"><button type="button" className={linkBtn} onClick={() => setAllLate((v) => !v)}>{allLate ? t("Show fewer") : tn(overdue.length - LIMIT, "Show 1 more", "Show {n} more")}</button></div>}
            </>
          )}
          <div className={cn(groupHead, "text-muted-foreground", overdue.length > 0 && "mt-1 border-t border-border")}>{t("Next 14 days")}<span className="tabular-nums">{upcoming.length}</span></div>
          {upcoming.length === 0 ? (
            <p className="px-4 pb-2 text-sm text-muted-foreground">{t("Nothing due in the next 14 days.")}</p>
          ) : (
            <ul>{soon.map((task) => <TaskRow key={task.id} task={task} due={dueLabel(task)} onOpen={() => onOpenTask(task)} />)}</ul>
          )}
          {upcoming.length > LIMIT && <div className="px-2"><button type="button" className={linkBtn} onClick={() => setAllSoon((v) => !v)}>{allSoon ? t("Show fewer") : tn(upcoming.length - LIMIT, "Show 1 more", "Show {n} more")}</button></div>}
        </div>
      )}
    </Section>
  );
}

function TeamCard({ people, memberById, unassigned, onDrill }: { people: Map<string, { open: number; overdue: number; doneMonth: number }>; memberById: Map<string, { name?: string | null; avatar?: string | null; role?: string }>; unassigned: number; onDrill: (d: OverviewDrill) => void }) {
  const { t, tn } = useLang();
  const [all, setAll] = useState(false);
  const rows = [...people.entries()]
    .map(([id, v]) => ({ id, ...v, name: memberById.get(id)?.name ?? "—", avatar: memberById.get(id)?.avatar, role: memberById.get(id)?.role }))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue || b.doneMonth - a.doneMonth || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((r) => r.open), unassigned);
  const LIMIT = 8;
  const shown = all ? rows : rows.slice(0, LIMIT);
  const grid = "grid grid-cols-[minmax(0,1fr)_3rem_3.5rem_3.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem]";
  const num = (n: number, bad?: boolean) => <span className={cn("text-right text-sm tabular-nums", n === 0 ? "text-muted-foreground/60" : bad ? cn("font-semibold", STATUS.overdueText) : "font-semibold")}>{n}</span>;
  return (
    <Section id="ov-team" title={t("Who's working on what")} icon={<Users className="h-4 w-4" />}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t("No members or assignees yet. Add people to the project, then assign tasks to see the workload here.")}</p>
      ) : (
        <div className="pb-2">
          <div className={cn(grid, "px-4 pb-1 pt-3 text-[11px] font-medium text-muted-foreground")}>
            <span>{t("Person")}</span>
            <span className="text-right">{t("Open")}</span>
            <span className="text-right">{t("Overdue")}</span>
            <span className="text-right">{t("Done this month")}</span>
          </div>
          <ul>
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={!r.open} onClick={() => onDrill({ assigneeId: r.id })} title={r.open ? tn(r.open, "Show 1 open task", "Show {n} open tasks") : undefined} className={cn(grid, "w-full px-4 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent")}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar userId={r.id} name={r.name} avatar={r.avatar} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        {r.role === "LEAD" && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold leading-4 text-primary">{t("Lead")}</span>}
                      </span>
                      <span className="mt-1 block h-1 max-w-40 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${(r.open / max) * 100}%` }} /></span>
                    </span>
                  </span>
                  {num(r.open)}
                  {num(r.overdue, true)}
                  {num(r.doneMonth)}
                </button>
              </li>
            ))}
            {unassigned > 0 && (
              <li>
                <button type="button" onClick={() => onDrill({ assigneeId: "NONE" })} className={cn(grid, "w-full px-4 py-2 text-left transition-colors hover:bg-muted/50")}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="h-7 w-7 shrink-0 rounded-full border-2 border-dashed border-control-border" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-muted-foreground">{t("Unassigned")}</span>
                      <span className="mt-1 block h-1 max-w-40 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-muted-foreground/40" style={{ width: `${(unassigned / max) * 100}%` }} /></span>
                    </span>
                  </span>
                  {num(unassigned)}
                  <span />
                  <span />
                </button>
              </li>
            )}
          </ul>
          {rows.length > LIMIT && <div className="px-2"><button type="button" className={linkBtn} onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : tn(rows.length - LIMIT, "Show 1 more", "Show {n} more")}</button></div>}
        </div>
      )}
    </Section>
  );
}

function BriefCard({ project, onEdit }: { project: NexusProject; onEdit: () => void }) {
  const { t, tn } = useLang();
  const [expanded, setExpanded] = useState(false);
  const brief = project.description?.trim() ?? "";
  const members = project.members ?? [];
  const ids = members.map((mem) => mem.userId || mem.user?.id).filter(Boolean) as string[];
  const leads = members.filter((mem) => mem.role === "LEAD").map((mem) => mem.user?.name ?? mem.user?.email).filter(Boolean) as string[];
  const long = brief.length > 280;
  return (
    <Section
      id="ov-brief"
      title={t("Brief")}
      icon={<FileText className="h-4 w-4" />}
      action={brief ? <button type="button" onClick={onEdit} className={linkBtn}>{t("Edit")}</button> : undefined}
    >
      <div className="px-4 py-4">
        {brief ? (
          <>
            <p className={cn("whitespace-pre-wrap text-sm leading-relaxed text-foreground/90", long && !expanded && "line-clamp-6")}>{brief}</p>
            {long && <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold text-primary hover:underline">{expanded ? t("Show less") : t("Read more")}</button>}
          </>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground">{t("No brief yet. Write what this project is for and what done looks like, so anyone who joins gets it at a glance.")}</p>
            <button type="button" onClick={onEdit} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted pointer-coarse:min-h-[44px]"><Pencil className="h-3.5 w-3.5" />{t("Write a brief")}</button>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
          {ids.length > 0 ? <AvatarStack ids={ids} max={6} size={26} /> : <Users className="h-4 w-4 text-muted-foreground" />}
          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{tn(ids.length, "1 member", "{n} members")}</div>
            {leads.length > 0 && <div className="truncate">{t("Led by {names}", { names: leads.join(", ") })}</div>}
          </div>
        </div>
      </div>
    </Section>
  );
}

function RecentlyDoneCard({ completed, memberById, onOpenTask }: { completed: NexusTask[]; memberById: Map<string, { name?: string | null; avatar?: string | null }>; onOpenTask: (task: NexusTask) => void }) {
  const { t, locale } = useLang();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }), [locale]);
  const ago = (value?: string | null) => {
    const d = dateOf(value);
    if (!d) return "";
    const days = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY);
    if (days === 0) {
      const mins = Math.round((d.getTime() - Date.now()) / 60_000);
      return Math.abs(mins) < 60 ? rtf.format(Math.min(0, mins), "minute") : rtf.format(Math.round(mins / 60), "hour");
    }
    return Math.abs(days) < 30 ? rtf.format(days, "day") : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  };
  const rows = completed.slice(0, 6);
  return (
    <Section id="ov-done" title={t("Recently completed")} icon={<CheckCircle2 className="h-4 w-4" />}>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{t("Nothing finished yet. Tasks show up here as they're marked done.")}</p>
      ) : (
        <ul className="py-1">
          {rows.map((task) => {
            const by = task.completedById ? memberById.get(task.completedById) : undefined;
            return (
              <li key={task.id}>
                <button type="button" onClick={() => onOpenTask(task)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                  <span aria-hidden className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full", STATUS.doneFill)}><svg viewBox="0 0 12 12" className="h-2.5 w-2.5"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{task.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[by?.name ? t("by {name}", { name: by.name }) : null, ago(task.completedAt ?? task.updatedAt)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {by && <AvatarFace name={by.name} avatar={by.avatar} seed={task.completedById ?? undefined} size={22} decorative />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function StatusUpdatesCard({ projectId }: { projectId: string }) {
  const { t, locale } = useLang();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const key = ["nexus", "project", projectId, "status-updates"];
  const updates = useQuery({ queryKey: key, queryFn: () => nexusApi.statusUpdates(projectId), retry: false });
  const create = useMutation({ mutationFn: () => nexusApi.createStatusUpdate(projectId, text.trim()), onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: key }); } });
  const generate = useMutation({ mutationFn: () => nexusApi.generateStatusUpdate(projectId), onSuccess: (res) => setText(res.content || "") });
  const rows = updates.data ?? [];
  const shown = all ? rows : rows.slice(0, 3);
  const when = (v?: string | null) => {
    const d = dateOf(v);
    return d ? d.toLocaleDateString(locale, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "";
  };
  return (
    <Section
      id="ov-updates"
      title={t("Status updates")}
      icon={<Sparkles className="h-4 w-4" />}
      action={
        <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending} className={cn(linkBtn, "disabled:opacity-50")} title={t("Draft an update from this project's tasks")}>
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {t("Draft with AI")}
        </button>
      }
    >
      <div className="space-y-2 px-4 pt-3">
        <label htmlFor={`su-${projectId}`} className="sr-only">{t("Status update")}</label>
        <textarea
          id={`su-${projectId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={text ? 4 : 2}
          placeholder={t("How is the project going? Wins, blockers, what's next.")}
          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        {(generate.isError || create.isError) && <p role="alert" className="text-xs text-destructive">{generate.isError ? ((generate.error as { payload?: { code?: string } } | null)?.payload?.code === "GIDEON_UNAVAILABLE" ? t("GIDEON isn't connected on this server. Write the update yourself.") : t("Couldn't draft an update. Try again, or write it yourself.")) : t("Couldn't post the update. Check your connection and try again.")}</p>}
        <div className="flex justify-end">
          <button type="button" disabled={!text.trim() || create.isPending} onClick={() => create.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 pointer-coarse:h-11">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t("Post update")}
          </button>
        </div>
      </div>
      <div className="px-4 pb-4 pt-2">
        {updates.isLoading && <div className="space-y-2" aria-hidden><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-4/5 animate-pulse rounded bg-muted" /></div>}
        {!updates.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("No updates yet. Post one so the team and BoD can follow along without asking.")}</p>}
        {shown.length > 0 && (
          <ol className="divide-y divide-border border-t border-border">
            {shown.map((u) => (
              <li key={u.id} className="py-3">
                <div className="flex items-center gap-2 text-xs">
                  <AvatarFace name={u.author?.name} avatar={u.author?.avatar} seed={u.author?.id} size={22} decorative />
                  <span className="min-w-0 truncate font-semibold">{u.author?.name ?? t("Someone")}</span>
                  {u.status && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-semibold leading-4 text-muted-foreground">{t(statusLabel(u.status))}</span>}
                  <time className="ml-auto shrink-0 text-muted-foreground tabular-nums" dateTime={u.createdAt ?? undefined}>{when(u.createdAt)}</time>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{u.text}</p>
              </li>
            ))}
          </ol>
        )}
        {rows.length > 3 && <button type="button" className={cn(linkBtn, "-ml-2")} onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : t("Show all {n} updates", { n: rows.length })}</button>}
      </div>
    </Section>
  );
}
