import { useMemo, useState } from "react";
import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, SlidersHorizontal, ChevronLeft, ChevronRight, Check, Loader2, X, Clock,
} from "lucide-react";
import { nexusApi, type NexusTask, type NexusProject } from "@/lib/nexus-api";
import { descendantFolderIds, folderPath } from "@/lib/folder-tree-client";
import { invalidateProjectData } from "@/lib/invalidate";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Avatar } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/folders/$folderId")({ component: FolderAggregatePage });

type ProjLookup = Map<string, NexusProject>;

// Shared palette with ProjectSettingsDrawer, so a colour picked here is also valid there.
const COLORS = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"];
const DEFAULT_PROJECT_COLOR = "#7b68ee";
const colorOf = (p?: NexusProject | null) => p?.color || DEFAULT_PROJECT_COLOR;

// Translucent version of a project colour (hex → rgba) for chip/card backgrounds. Falls back to the raw
// value for any non-#RRGGBB input so a stray named colour still renders something sane.
function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function FolderAggregatePage() {
  const { folderId } = useParams({ from: "/_app/folders/$folderId" });
  const navigate = useNavigate();

  const foldersQuery = useQuery({ queryKey: ["nexus", "project-folders"], queryFn: () => nexusApi.projectFolders(), retry: false });
  const projectsQuery = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false });
  const folders = foldersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const folder = folders.find((f) => f.id === folderId) ?? null;

  // Every project inside this folder OR any of its sub-folders.
  const folderProjects = useMemo(() => {
    const subtree = descendantFolderIds(folderId, folders);
    subtree.add(folderId);
    return projects.filter((p) => p.folderId && subtree.has(p.folderId));
  }, [folderId, folders, projects]);

  // Curated selection (aggregateProjectIds) wins; empty falls back to every project in the folder.
  const configured = folder?.aggregateProjectIds ?? [];
  const selectedIds = useMemo(() => {
    const all = folderProjects.map((p) => p.id);
    if (!configured.length) return all;
    const set = new Set(all);
    return configured.filter((id) => set.has(id)); // drop ids no longer in the folder
  }, [configured, folderProjects]);

  const tasksQuery = useQuery({
    queryKey: ["nexus", "folder-tasks", folderId, selectedIds.slice().sort().join(",")],
    queryFn: () => (selectedIds.length ? nexusApi.tasks(`projectIds=${selectedIds.join(",")}`) : Promise.resolve([] as NexusTask[])),
    enabled: selectedIds.length > 0,
    retry: false,
  });
  const tasks = tasksQuery.data ?? [];
  // Tasks come back with taskList.projectId but not the nested project — resolve the project (name + icon
  // + colour) client-side from the already-loaded list so each card shows which project it belongs to.
  const projById = useMemo<ProjLookup>(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const selectedProjects = useMemo(
    () => selectedIds.map((id) => projById.get(id)).filter((p): p is NexusProject => !!p),
    [selectedIds, projById],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  const byId = new Map(folders.map((f) => [f.id, f]));
  const subtitle = folder ? folderPath(folder, byId) : "Folder";

  return (
    <div className="min-h-full">
      <PageHeader
        title={folder?.name ?? "Folder"}
        subtitle={`${subtitle} · ${selectedIds.length} project${selectedIds.length === 1 ? "" : "s"} · ${tasks.length} task`}
        icon={<span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg text-2xl leading-none"><ProjectIcon icon={folder?.icon ?? "🗂️"} className="max-h-8 max-w-8 rounded-lg object-cover" /></span>}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate({ to: "/projects" })} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              <ArrowLeft className="h-3.5 w-3.5" /> Projects
            </button>
            <button onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Pilih project
            </button>
          </div>
        }
      />

      <div className="p-4 md:p-8">
        {selectedProjects.length > 0 && <ProjectColorLegend projects={selectedProjects} />}
        {tasksQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat task…</div>
        ) : selectedIds.length === 0 ? (
          <EmptyState text="Folder ini belum punya project. Pindahin project ke sini dulu, atau pilih project lewat 'Pilih project'." />
        ) : (
          <CalendarView tasks={tasks} projById={projById} />
        )}
      </div>

      {pickerOpen && folder && (
        <ProjectPicker
          folderId={folderId}
          allProjects={folderProjects}
          selected={selectedIds}
          usingAll={!configured.length}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-soft">{text}</div>
  );
}

// Colour legend for the folder view: one chip per project, tinted with that project's colour. Click a chip
// to recolour the project inline (same palette as project settings) — board + calendar re-tint instantly.
// Collapsed by default (it gets long with many projects); collapsed/expanded is remembered per-browser.
const LEGEND_KEY = "nexus.folderLegendOpen";
function ProjectColorLegend({ projects }: { projects: NexusProject[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(LEGEND_KEY) === "1"; } catch { return false; }
  });
  const toggle = () => setOpen((v) => {
    const next = !v;
    try { localStorage.setItem(LEGEND_KEY, next ? "1" : "0"); } catch { /* best-effort */ }
    return next;
  });
  const recolor = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) => nexusApi.updateProject(id, { color }),
    onSuccess: () => invalidateProjectData(qc),
  });

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-accent"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        Warna project
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{projects.length}</span>
        {!open && (
          <span className="ml-1 flex items-center -space-x-1">
            {projects.slice(0, 10).map((p) => (
              <span key={p.id} className="h-2.5 w-2.5 rounded-full ring-1 ring-card" style={{ background: colorOf(p) }} />
            ))}
            {projects.length > 10 && <span className="ml-1.5 normal-case text-[10px] text-muted-foreground/70">+{projects.length - 10}</span>}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {projects.map((p) => {
            const color = colorOf(p);
            return (
              <Popover key={p.id}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Klik buat ganti warna project"
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition hover:brightness-105"
                    style={{ borderColor: tint(color, 0.4), background: tint(color, 0.12), color }}
                  >
                    <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: color }} />
                    <span className="grid h-4 w-4 place-items-center"><ProjectIcon icon={p.icon} className="max-h-4 max-w-4" /></span>
                    <span className="max-w-[140px] truncate">{p.name}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">Warna untuk “{p.name}”</div>
                  <div className="flex items-center gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => recolor.mutate({ id: p.id, color: c })}
                        className={cn("h-6 w-6 rounded-full ring-2 transition", color.toLowerCase() === c ? "ring-foreground" : "ring-transparent hover:ring-border")}
                        style={{ background: c }}
                        aria-label={`Set warna ${c}`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
          {recolor.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  );
}

const projectOf = (t: NexusTask, byId: ProjLookup) => byId.get(t.taskList?.projectId ?? "") ?? null;
const projectName = (t: NexusTask, byId: ProjLookup) => projectOf(t, byId)?.name ?? t.taskList?.project?.name ?? "—";
const dueOf = (t: NexusTask) => (t.dueDate ? new Date(t.dueDate) : null);

// Dispatcher: the desktop month-grid crams badly into a phone, so mobile gets a dedicated dot-grid +
// day-detail layout. useIsMobile() is the only hook here, so the early branch never trips hook order.
function CalendarView({ tasks, projById }: { tasks: NexusTask[]; projById: ProjLookup }) {
  const isMobile = useIsMobile();
  return isMobile
    ? <MobileCalendarView tasks={tasks} projById={projById} />
    : <DesktopCalendarView tasks={tasks} projById={projById} />;
}

function DesktopCalendarView({ tasks, projById }: { tasks: NexusTask[]; projById: ProjLookup }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  const month = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const leadingBlanks = (new Date(year, mon, 1).getDay() + 6) % 7; // Monday-first

  const byDay = useMemo(() => {
    const map = new Map<number, NexusTask[]>();
    for (const t of tasks) {
      const d = dueOf(t);
      if (d && d.getFullYear() === year && d.getMonth() === mon) {
        const day = d.getDate();
        (map.get(day) ?? map.set(day, []).get(day)!).push(t);
      }
    }
    return map;
  }, [tasks, year, mon]);

  return (
    <div className="rounded-[28px] border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setMonthOffset((o) => o - 1)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-accent"><ChevronLeft className="h-4 w-4" /></button>
        <h3 className="font-bold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3>
        <button onClick={() => setMonthOffset((o) => o + 1)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-accent"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-semibold text-muted-foreground">{d}</div>
        ))}
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const items = byDay.get(day) ?? [];
          return (
            <div key={day} className="min-h-[84px] rounded-xl border border-border/60 p-1.5">
              <div className="text-[11px] font-semibold text-muted-foreground">{day}</div>
              <div className="mt-1 flex flex-col gap-1">
                {items.slice(0, 3).map((t) => {
                  const color = colorOf(projectOf(t, projById));
                  return (
                    <Link
                      key={t.id}
                      to="/tasks/$taskId"
                      params={{ taskId: t.id }}
                      className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium transition hover:brightness-95"
                      style={{ background: tint(color, 0.16), color }}
                      title={`${t.title} · ${projectName(t, projById)}`}
                    >
                      {t.title}
                    </Link>
                  );
                })}
                {items.length > 3 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="px-1 text-left text-[10px] font-semibold text-muted-foreground transition hover:text-foreground">+{items.length - 3} lagi</button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-60 p-2">
                      <div className="mb-1.5 px-1 text-[11px] font-bold text-muted-foreground">{day} {month.toLocaleDateString("id-ID", { month: "short" })} · {items.length} task</div>
                      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                        {items.map((t) => {
                          const c = colorOf(projectOf(t, projById));
                          return (
                            <Link
                              key={t.id}
                              to="/tasks/$taskId"
                              params={{ taskId: t.id }}
                              className="truncate rounded px-1.5 py-1 text-[11px] font-medium transition hover:brightness-95"
                              style={{ background: tint(c, 0.16), color: c }}
                              title={`${t.title} · ${projectName(t, projById)}`}
                            >
                              {t.title}
                            </Link>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PRIORITY_PILL: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-info/15 text-info",
  HIGH: "bg-warning/15 text-warning",
  URGENT: "bg-destructive/15 text-destructive",
};
function PriorityPill({ priority }: { priority?: string | null }) {
  const key = (priority ?? "NONE").toUpperCase();
  if (key === "NONE" || !PRIORITY_PILL[key]) return null;
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", PRIORITY_PILL[key])}>{key.charAt(0) + key.slice(1).toLowerCase()}</span>;
}

// One task row in the mobile day-detail list (checkbox · title · project + due · priority · assignee).
function MobileTaskRow({ t, projById }: { t: NexusTask; projById: ProjLookup }) {
  const proj = projectOf(t, projById);
  const color = colorOf(proj);
  const done = (t.status ?? "").toUpperCase() === "DONE";
  const assignee = t.assignees?.[0]?.user;
  const due = dueOf(t);
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: t.id }}
      className="flex items-center gap-3 rounded-2xl border border-l-4 border-border bg-card p-3 shadow-soft transition active:scale-[0.99]"
      style={{ borderLeftColor: color }}
    >
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", done ? "border-success bg-success text-success-foreground" : "border-muted-foreground/40")}>
        {done && <Check className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-semibold", done && "text-muted-foreground line-through")}>{t.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {proj && <span className="grid h-3.5 w-3.5 shrink-0 place-items-center"><ProjectIcon icon={proj.icon} className="max-h-3.5 max-w-3.5" /></span>}
          <span className="truncate font-medium" style={{ color }}>{proj?.name ?? projectName(t, projById)}</span>
          {due && <><span className="shrink-0">·</span><Clock className="h-3 w-3 shrink-0" /><span className="shrink-0">{due.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span></>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PriorityPill priority={t.priority} />
        {assignee && <Avatar userId={assignee.id} name={assignee.name} avatar={assignee.avatar} size={24} />}
      </div>
    </Link>
  );
}

// Mobile calendar: compact dot-grid month (tap a day to select) + a list of that day's tasks below — far
// cleaner on a phone than the desktop month grid with truncated chips crammed into 44px-wide cells.
function MobileCalendarView({ tasks, projById }: { tasks: NexusTask[]; projById: ProjLookup }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const base = new Date();
  const month = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const leadingBlanks = (new Date(year, mon, 1).getDay() + 6) % 7; // Monday-first
  const todayDay = base.getFullYear() === year && base.getMonth() === mon ? base.getDate() : null;

  const byDay = useMemo(() => {
    const map = new Map<number, NexusTask[]>();
    for (const t of tasks) {
      const d = dueOf(t);
      if (d && d.getFullYear() === year && d.getMonth() === mon) {
        const day = d.getDate();
        (map.get(day) ?? map.set(day, []).get(day)!).push(t);
      }
    }
    return map;
  }, [tasks, year, mon]);
  const firstWithTasks = useMemo(() => [...byDay.keys()].sort((a, b) => a - b)[0] ?? null, [byDay]);

  // Manual tap wins; otherwise default to today (current month) else the first day that has tasks.
  const selected = selectedDay ?? todayDay ?? firstWithTasks;
  const dayTasks = selected ? (byDay.get(selected) ?? []) : [];
  const goMonth = (delta: number) => { setSelectedDay(null); setMonthOffset((o) => o + delta); };

  return (
    <div>
      <div className="rounded-[28px] border border-border bg-card p-3 shadow-soft">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => goMonth(-1)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-accent"><ChevronLeft className="h-5 w-5" /></button>
          <h3 className="text-base font-bold capitalize">{month.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</h3>
          <button onClick={() => goMonth(1)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-accent"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => (
            <div key={d} className="py-1 text-center text-[11px] font-semibold text-muted-foreground">{d}</div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const has = byDay.has(day);
            const isSel = day === selected;
            const isToday = day === todayDay;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "relative grid aspect-square place-items-center rounded-2xl text-sm font-semibold transition",
                  isSel ? "bg-primary text-primary-foreground shadow-sm" : has ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent",
                  !isSel && isToday && "ring-1 ring-primary/50",
                )}
              >
                {day}
                {has && <span className={cn("absolute bottom-1.5 h-1.5 w-1.5 rounded-full", isSel ? "bg-primary-foreground" : "bg-primary")} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h4 className="text-sm font-bold">Tanggal {selected ?? "—"}</h4>
          <span className="text-xs text-muted-foreground">{dayTasks.length} task</span>
        </div>
        {dayTasks.length === 0 ? (
          <EmptyState text="Gaada task jatuh tempo di tanggal ini." />
        ) : (
          <div className="flex flex-col gap-2">
            {dayTasks.map((t) => <MobileTaskRow key={t.id} t={t} projById={projById} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPicker({ folderId, allProjects, selected, usingAll, onClose }: {
  folderId: string; allProjects: NexusProject[]; selected: string[]; usingAll: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const save = useMutation({
    // Empty / "all selected" → store [] so the folder auto-includes future projects too.
    mutationFn: () => {
      const all = allProjects.map((p) => p.id);
      const next = picked.size === all.length && all.every((id) => picked.has(id)) ? [] : [...picked];
      return nexusApi.projectFolderUpdate(folderId, { aggregateProjectIds: next });
    },
    onSuccess: () => { invalidateProjectData(qc); onClose(); },
  });
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[28px] border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold">Pilih project</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Pilih project mana yang masuk board + calendar folder ini. {usingAll && "Sekarang lagi nampilin SEMUA project di folder."}
        </p>
        <div className="mb-2 flex gap-2 text-xs">
          <button onClick={() => setPicked(new Set(allProjects.map((p) => p.id)))} className="rounded-lg border border-border px-2 py-1 hover:bg-accent">Pilih semua</button>
          <button onClick={() => setPicked(new Set())} className="rounded-lg border border-border px-2 py-1 hover:bg-accent">Kosongkan</button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {allProjects.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Folder ini belum punya project.</p>
          ) : allProjects.map((p) => (
            <button key={p.id} onClick={() => toggle(p.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", picked.has(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                {picked.has(p.id) && <Check className="h-3 w-3" />}
              </span>
              <span className="grid h-5 w-5 shrink-0 place-items-center"><ProjectIcon icon={p.icon} className="max-h-5 max-w-5" /></span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Batal</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
