import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { nexusApi, ORG_HIERARCHY, type CalendarTaskItem, type NexusCalendar, type NexusProject } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/master-calendar")({ component: MasterCalendar });

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PALETTE = ["#7B2FBE", "#2563EB", "#059669", "#D97706", "#DC2626", "#0891B2", "#DB2777", "#475569"];

function monthGrid(anchor: Date) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}
// LOCAL date key (avoids the UTC off-by-one toISOString causes in +7 timezones).
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const taskDayKey = (t: CalendarTaskItem) => {
  const iso = t.dueDate ?? t.startDate;
  return iso ? dayKey(new Date(iso)) : "";
};
// Parse a "YYYY-MM-DD" key back into a LOCAL date — `new Date(k)` would treat it as UTC midnight and
// shift a day in west-of-UTC timezones.
const dateFromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function MasterCalendar() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string>("");
  const [setup, setSetup] = useState<{ mode: "create" } | { mode: "edit"; calendar: NexusCalendar } | null>(null);
  const [dayDetail, setDayDetail] = useState<string | null>(null); // a "YYYY-MM-DD" key → day-detail modal

  const calendarsQ = useQuery({ queryKey: ["nexus", "calendars"], queryFn: nexusApi.calendars, retry: false });
  const calendars = calendarsQ.data?.calendars ?? [];
  const projectsQ = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const allProjects = projectsQ.data ?? [];
  const primaryWorkspaceId = allProjects.find((p) => p.workspaceId)?.workspaceId ?? "";
  // Gate canManage on the SAME workspace the create-POST targets (primaryWorkspaceId), so the enable
  // state and the backend's per-workspace role check agree even for multi-workspace users.
  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members", primaryWorkspaceId || "any"], queryFn: () => nexusApi.workspaceMembers(primaryWorkspaceId || undefined), retry: false, staleTime: 60_000, enabled: !!primaryWorkspaceId });
  const canManage = (ORG_HIERARCHY[roleQ.data?.role ?? ""] ?? 0) >= (ORG_HIERARCHY.MANAGER ?? 2);

  const active = calendars.find((c) => c.id === activeId) ?? calendars[0];
  const activeProjectIds = useMemo(() => active?.projectIds ?? [], [active]);
  const pidsKey = activeProjectIds.join(",");

  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeStart = days[0].toISOString();
  const rangeEnd = useMemo(() => {
    const after = new Date(days[days.length - 1]);
    after.setDate(after.getDate() + 1); // inclusive of the whole last visible day
    return after.toISOString();
  }, [days]);

  const tasksQ = useQuery({
    queryKey: ["nexus", "calendar-tasks", active?.id, pidsKey, rangeStart, rangeEnd],
    queryFn: () => nexusApi.calendarTasks(activeProjectIds, rangeStart, rangeEnd),
    enabled: !!active && activeProjectIds.length > 0,
    retry: false,
  });
  const tasks = tasksQ.data?.tasks ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarTaskItem[]>();
    for (const t of tasks) {
      const k = taskDayKey(t);
      if (k) map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [tasks]);

  // The projects this calendar pulls from (resolved against the visible project list, for the legend).
  const sourceProjects = useMemo(
    () => activeProjectIds.map((id) => allProjects.find((p) => p.id === id)).filter(Boolean) as NexusProject[],
    [activeProjectIds, allProjects],
  );

  const todayKey = dayKey(new Date());

  return (
    <div>
      <PageHeader
        title="Team Calendar"
        subtitle="A calendar per project — pick your source projects and their deadlines show up automatically."
        actions={canManage ? (
          <button onClick={() => setSetup({ mode: "create" })} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]">
            <Plus className="h-3.5 w-3.5" /> New calendar
          </button>
        ) : undefined}
      />

      <div className="p-4 md:p-8">
        {/* Calendar selector pills */}
        {calendars.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {calendars.map((c) => {
              const on = active?.id === c.id;
              return (
                <button key={c.id} onClick={() => setActiveId(c.id)} className={cn("group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors", on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-accent")}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color ?? "#7B2FBE" }} />
                  {c.name}
                  {canManage && on && (
                    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setSetup({ mode: "edit", calendar: c }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setSetup({ mode: "edit", calendar: c }); } }} className="-mr-1 ml-0.5 grid h-5 w-5 place-items-center rounded-full text-primary/70 hover:bg-primary/15 hover:text-primary">
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
            {canManage && (
              <button onClick={() => setSetup({ mode: "create" })} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">
                <Plus className="h-3.5 w-3.5" /> Calendar
              </button>
            )}
          </div>
        )}

        {/* Month nav (only meaningful when a calendar is active) */}
        {active && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold tracking-tight">{anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent active:scale-[0.97]"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => setAnchor(new Date())} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98]">Today</button>
                <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent active:scale-[0.97]"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        )}

        {/* States */}
        {(calendarsQ.isLoading || projectsQ.isLoading) && <CenterLoader />}

        {!calendarsQ.isLoading && calendars.length === 0 && (
          <Empty
            title="No calendars yet"
            message={canManage ? "Create your first calendar to pull together task deadlines from the projects you pick." : "No calendars have been set up yet. Ping a BoD / Manager to get one going."}
            action={canManage ? <button onClick={() => setSetup({ mode: "create" })} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-4 w-4" /> New calendar</button> : undefined}
          />
        )}

        {active && activeProjectIds.length === 0 && (
          <Empty
            title="This calendar has no projects yet"
            message="Pick which projects feed it — their task deadlines will show up here."
            action={canManage ? <button onClick={() => setSetup({ mode: "edit", calendar: active })} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"><Pencil className="h-4 w-4" /> Set up projects</button> : undefined}
          />
        )}

        {active && activeProjectIds.length > 0 && tasksQ.isLoading && <CenterLoader />}
        {active && activeProjectIds.length > 0 && tasksQ.isError && <Empty title="Couldn't load tasks" message="Check your session / project access." />}

        {/* CALENDAR (month grid) view */}
        {active && activeProjectIds.length > 0 && !tasksQ.isError && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const k = dayKey(d);
                const inMonth = d.getMonth() === anchor.getMonth();
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const dayTasks = byDay.get(k) ?? [];
                return (
                  <div key={k} className={cn("min-h-24 border-b border-r border-border p-1.5 last:border-r-0", weekend && "bg-muted/20", !inMonth && "bg-muted/30 text-muted-foreground/50")}>
                    <div className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", k === todayKey && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
                    <div className="mt-1 space-y-1">
                      {dayTasks.slice(0, 4).map((t) => <TaskPill key={t.id} task={t} />)}
                      {dayTasks.length > 4 && (
                        <button onClick={() => setDayDetail(k)} className="w-full rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">+{dayTasks.length - 4} more</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Project legend — moved to the bottom so the calendar grid sits up top even when a calendar
            aggregates many projects (the source list can get very long). */}
        {active && sourceProjects.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source projects ({sourceProjects.length})</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              {sourceProjects.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color ?? "#7B2FBE" }} />
                  <span className="font-semibold text-foreground">{p.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {setup && (
        <CalendarSetup
          key={setup.mode === "edit" ? setup.calendar.id : "new"}
          mode={setup.mode}
          calendar={setup.mode === "edit" ? setup.calendar : undefined}
          workspaceId={primaryWorkspaceId}
          allProjects={allProjects}
          onSaved={(id) => { setActiveId(id); setSetup(null); }}
          onDeleted={() => { setActiveId(""); setSetup(null); }}
          onClose={() => setSetup(null)}
        />
      )}

      {dayDetail && (
        <DayDetailModal dateKey={dayDetail} tasks={byDay.get(dayDetail) ?? []} onClose={() => setDayDetail(null)} />
      )}
    </div>
  );
}

function DayDetailModal({ dateKey, tasks, onClose }: { dateKey: string; tasks: CalendarTaskItem[]; onClose: () => void }) {
  const d = dateFromKey(dateKey);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">{d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {tasks.length} task{tasks.length === 1 ? "" : "s"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 -mr-2 space-y-2 overflow-y-auto pr-2">
          {tasks.map((t) => (
            <Link key={t.id} to="/projects/$projectId" params={{ projectId: t.projectId }} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop">
              <span className="w-1.5 shrink-0 self-stretch rounded-full" style={{ backgroundColor: t.projectColor ?? "#7B2FBE" }} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-sm font-semibold group-hover:text-primary", t.status === "DONE" && "text-muted-foreground line-through")}>{t.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.projectName}</div>
              </div>
              {t.priority && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t.priority}</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskPill({ task }: { task: CalendarTaskItem }) {
  return (
    <Link to="/projects/$projectId" params={{ projectId: task.projectId }} title={`${task.title} — ${task.projectName}`} className="flex w-full items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-left transition-colors hover:bg-accent">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor ?? "#7B2FBE" }} />
      <span className={cn("truncate text-[11px] font-semibold text-foreground", task.status === "DONE" && "text-muted-foreground line-through")}>{task.title}</span>
    </Link>
  );
}

function CalendarSetup({ mode, calendar, workspaceId, allProjects, onSaved, onDeleted, onClose }: {
  mode: "create" | "edit";
  calendar?: NexusCalendar;
  workspaceId: string;
  allProjects: NexusProject[];
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = mode === "edit";
  const [name, setName] = useState(calendar?.name ?? "");
  const [color, setColor] = useState(calendar?.color ?? PALETTE[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set(calendar?.projectIds ?? []));
  const [q, setQ] = useState("");
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? allProjects.filter((p) => p.name.toLowerCase().includes(s)) : allProjects;
  }, [q, allProjects]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "calendars"] });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), color, projectIds: [...picked] };
      if (editing && calendar) return (await nexusApi.updateCalendar(calendar.id, payload)).calendar;
      return (await nexusApi.createCalendar({ ...payload, workspaceId })).calendar;
    },
    onSuccess: (cal) => { invalidate(); onSaved(cal.id); },
  });
  const del = useMutation({
    mutationFn: () => nexusApi.deleteCalendar(calendar!.id),
    onSuccess: () => { invalidate(); onDeleted(); },
  });

  const canSave = !!name.trim() && (editing || !!workspaceId) && !save.isPending;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit calendar" : "New calendar"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Calendar name (e.g. Q3 Roadmap)" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />

          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Color</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={cn("h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-card transition-transform active:scale-95", color === c ? "ring-foreground" : "ring-transparent")} style={{ backgroundColor: c }} aria-label={c} />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source projects ({picked.size})</span>
              <div className="flex gap-2 text-xs">
                <button onClick={() => setPicked((prev) => new Set([...prev, ...filtered.map((p) => p.id)]))} className="rounded-lg border border-border px-2 py-0.5 hover:bg-accent">{q.trim() ? "Select results" : "Select all"}</button>
                <button onClick={() => setPicked(new Set())} className="rounded-lg border border-border px-2 py-0.5 hover:bg-accent">Clear</button>
              </div>
            </div>
            <div className="relative mb-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="w-full rounded-xl border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary" />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
              {allProjects.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No projects available to pick yet.</p>
              ) : filtered.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No projects match “{q}”.</p>
              ) : filtered.map((p) => (
                <button key={p.id} onClick={() => toggle(p.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", picked.has(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {picked.has(p.id) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? "#7B2FBE" }} />
                  <span className="grid h-5 w-5 shrink-0 place-items-center"><ProjectIcon icon={p.icon} className="max-h-5 max-w-5" /></span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button disabled={!canSave} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save" : "Create calendar"}
          </button>
          {editing && (
            <button onClick={() => { if (confirm("Delete this calendar?")) del.mutate(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.98]"><Trash2 className="h-4 w-4" /> Delete</button>
          )}
          {save.isError && <span className="text-xs font-semibold text-destructive">Something went wrong — check your access / role.</span>}
          {!editing && !workspaceId && <span className="text-xs font-semibold text-muted-foreground">You need at least 1 project first.</span>}
        </div>
      </div>
    </div>
  );
}

function CenterLoader() {
  return <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
}
function Empty({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
      <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
      <div className="text-lg font-bold">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
