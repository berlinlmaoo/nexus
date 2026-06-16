import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent as CardBody, Chip } from "@heroui/react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { ProgressBar } from "@/components/StatusPill";
import { celebrate } from "@/components/Celebration";
import { blockText, fmtDate, fmtDue, nexusApi, statusLabel, type CreateTaskPayload, type NexusCustomField, type NexusDoc, type NexusProject, type NexusSprint, type NexusTask } from "@/lib/nexus-api";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { TaskBulkProvider, useTaskBulk } from "@/components/tasks/task-bulk";
import { ProjectSettingsDrawer, TUNE_MORPH_ID } from "@/components/projects/ProjectSettingsDrawer";
import { AutomationsView } from "@/components/automations/AutomationsView";
import { ChatThread } from "@/components/messages/ChatThread";
import { ProjectFormsView } from "@/components/forms/form-kit";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { FinanceDashboardView } from "@/components/finance/FinanceDashboardView";
import { PnlDashboardView } from "@/components/pnl/PnlDashboardView";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Activity,
  Calendar as CalIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Link2,
  FileText,
  Filter,
  Folder,
  FormInput,
  BarChart3,
  GanttChart,
  GripVertical,
  LayoutGrid,
  List,
  ListChecks,
  Loader2,
  MessageSquare,
  Palette,
  Pencil,
  Paperclip,
  Play,
  Plus,
  Search,
  Trash2,
  Settings2,
  Sparkles,
  Tag,
  Target,
  Wallet,
  X,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/_app/projects/$projectId")({ component: ProjectDetail });

type ViewId = "overview" | "board" | "list" | "calendar" | "timeline" | "sprints" | "automations" | "pages" | "forms" | "finance" | "pnl" | "files" | "chat";
// cfSelections: per custom-field-id, the set of values to keep (OR within a field, AND across fields).
type BoardFilters = { query: string; section: string; priority: string; hideDone: boolean; assigneeId: string; cfSelections: Record<string, string[]> };
const EMPTY_FILTERS: BoardFilters = { query: "", section: "ALL", priority: "ALL", hideDone: false, assigneeId: "ALL", cfSelections: {} };


const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
const TASK_PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;

const TABS: { id: ViewId; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  // P&L sits early so it's visible without scrolling the tab strip on mobile (BoD-only anyway).
  { id: "pnl", label: "P&L", icon: Wallet },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "list", label: "List", icon: List },
  { id: "calendar", label: "Calendar", icon: CalIcon },
  { id: "timeline", label: "Timeline", icon: GanttChart },
  { id: "sprints", label: "Sprints", icon: Target },
  { id: "automations", label: "Automations", icon: Zap },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "forms", label: "Forms", icon: FormInput },
  { id: "finance", label: "Finance Dashboard", icon: BarChart3 },
  { id: "files", label: "Files", icon: Folder },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

function ProjectDetail() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<ViewId>("board");
  const [openTask, setOpenTask] = useState<NexusTask | null>(null);
  const [composerListId, setComposerListId] = useState<string | null>(null);
  const [composerDueDate, setComposerDueDate] = useState<string>("");
  const [pageComposerOpen, setPageComposerOpen] = useState(false);
  const [openDoc, setOpenDoc] = useState<NexusDoc | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const project = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), retry: false });
  const data = project.data;
  // P&L is BoD-and-above only: the tab renders only when the Tune toggle is on AND the viewer is
  // BoD+ — checked against THIS project's workspace (a multi-workspace user's role can differ).
  const wsm = useQuery({
    queryKey: ["nexus", "workspace-members", data?.workspaceId ?? ""],
    queryFn: () => nexusApi.workspaceMembers(data?.workspaceId ?? undefined),
    retry: false,
    staleTime: 60_000,
    enabled: !!data,
  });
  const isBod = wsm.data?.role === "BOD" || wsm.data?.role === "ONE_ABOVE_ALL";
  const rootQc = useQueryClient();
  // Set a task's due date by dragging it onto a calendar day.
  const setTaskDue = useMutation({
    mutationFn: ({ taskId, dueDate }: { taskId: string; dueDate: string }) => nexusApi.updateTask(taskId, { dueDate }),
    onSuccess: () => rootQc.invalidateQueries({ queryKey: ["nexus", "project", projectId] }),
  });
  const taskLists = data?.taskLists ?? [];
  const allTasks = taskLists.flatMap((list) => (list.tasks ?? []).map((task) => ({ ...task, taskList: task.taskList ?? { id: list.id, name: list.name, projectId: data?.id } })));
  const filteredTaskLists = filterTaskLists(taskLists, filters);
  const filteredTasks = filteredTaskLists.flatMap((list) => (list.tasks ?? []).map((task) => ({ ...task, taskList: task.taskList ?? { id: list.id, name: list.name, projectId: data?.id } })));
  const activeFilterCount = [filters.query.trim(), filters.section !== "ALL", filters.priority !== "ALL", filters.hideDone, filters.assigneeId !== "ALL"].filter(Boolean).length + Object.values(filters.cfSelections).filter((v) => v.length > 0).length;
  const totalTasks = allTasks.length || data?._count?.tasks || 0;
  const completedTasks = allTasks.filter((task) => isDone(task.status)).length;
  const progress = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : Number(data?.progress ?? 0);

  return (
    <div>
      <PageHeader
        icon={<span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/60 text-2xl leading-none">{data?.icon ? <ProjectIcon icon={data.icon} className="max-h-9 max-w-9 rounded-lg object-cover" /> : "🚀"}</span>}
        title={data?.name || "Mission Board"}
        subtitle={data?.description || (project.isLoading ? "Loading live NEXUS board..." : "Project detail board needs login/session or access.")}
        actions={
          <>
            {data && <ProjectMembersAvatars project={data} />}
            <motion.div layoutId={TUNE_MORPH_ID} style={{ borderRadius: 24 }} className="inline-block">
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5" />Tune</Button>
            </motion.div>
            <Button size="sm" variant="primary" onClick={() => setComposerListId(taskLists[0]?.id ?? null)}><Plus className="h-3.5 w-3.5" />Add task</Button>
          </>
        }
        tabs={
          <div className="flex items-center gap-0.5 -mb-px overflow-x-auto">
            {TABS.filter((t) => (t.id !== "finance" || /finance/i.test(data?.name ?? "")) && (t.id !== "pnl" || (!!data?.enablePnlDashboard && isBod))).map((t) => (
              <button key={t.id} onClick={() => setView(t.id)}
                className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 transition whitespace-nowrap ${view === t.id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-4 md:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/30">
        <Chip size="sm" variant="soft" color={project.isError ? "danger" : "success"}>{project.isError ? "Locked" : "Live board"}</Chip>
        <div className="text-xs text-muted-foreground">Mission energy</div>
        <div className="flex-1 min-w-32 max-w-xs"><ProgressBar value={progress} /></div>
        <div className="text-xs font-bold">{progress}%</div>
        <div className="text-xs text-muted-foreground hidden sm:block">· {filteredTasks.length}/{totalTasks} cards visible · {taskLists.length} lanes</div>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">{activeFilterCount > 0 && <Chip size="sm" color="accent" variant="soft">{activeFilterCount} filters</Chip>}</div>
      </div>

      {!project.isLoading && !project.isError && data && (
        <BoardFilterBar filters={filters} onChange={setFilters} total={totalTasks} visible={filteredTasks.length} tasks={allTasks} sections={taskLists} projectId={data.id} />
      )}

      {project.isLoading && <div className="p-8"><Card><CardBody className="text-sm text-muted-foreground">Loading mission lanes...</CardBody></Card></div>}
      {project.isError && <div className="p-8"><Empty title="Board locked" message="Login/session atau project access dibutuhkan untuk buka board live ini." /></div>}
      {!project.isLoading && !project.isError && data && (
        // Provider gates multi-select duplicate behind the project's "Task duplicate mode" flag.
        <TaskBulkProvider projectId={data.id} enabled={!!data.enableTaskBatchDuplicate}>
          {view === "overview" && <OverviewView project={data} tasks={filteredTasks} progress={progress} />}
          {view === "board" && <BoardView project={data} taskLists={filteredTaskLists} onOpen={setOpenTask} onCreate={setComposerListId} />}
          {view === "list" && <ListView taskLists={filteredTaskLists} onOpen={setOpenTask} />}
          {view === "calendar" && <CalendarView projectId={data.id} tasks={filteredTasks} onOpen={setOpenTask} onCreate={(due) => { setComposerDueDate(due); setComposerListId(taskLists[0]?.id ?? null); }} onSetDue={(taskId, due) => setTaskDue.mutate({ taskId, dueDate: due })} />}
          {view === "timeline" && <TimelineView projectId={data.id} taskLists={filteredTaskLists} onOpen={setOpenTask} />}
          {view === "sprints" && <SprintsView project={data} tasks={filteredTasks} onOpenTask={setOpenTask} />}
          {view === "automations" && <AutomationsView projectId={data.id} />}
          {view === "pages" && <PagesView project={data} onCreate={() => setPageComposerOpen(true)} onOpen={setOpenDoc} />}
          {view === "forms" && <ProjectFormsView projectId={data.id} />}
          {view === "finance" && <div className="p-4 md:p-8"><FinanceDashboardView projectId={data.id} /></div>}
          {view === "pnl" && !!data.enablePnlDashboard && isBod && <PnlDashboardView projectId={data.id} />}
          {view === "files" && <ProjectFiles projectId={data.id} />}
          {view === "chat" && <ProjectChat projectId={data.id} />}
        </TaskBulkProvider>
      )}

      {openTask && <TaskDetailPanel taskId={openTask.id} onClose={() => setOpenTask(null)} morphId={["board", "list", "calendar", "timeline"].includes(view) ? `${view}-taskcard-${openTask.id}` : undefined} />}
      {settingsOpen && data && <ProjectSettingsDrawer project={data} onClose={() => setSettingsOpen(false)} onDeleted={() => { setSettingsOpen(false); navigate({ to: "/projects" }); }} />}
      {composerListId && data && <TaskComposer project={data} selectedListId={composerListId} initialDueDate={composerDueDate} onClose={() => { setComposerListId(null); setComposerDueDate(""); }} />}
      {pageComposerOpen && data && <PageComposer project={data} onClose={() => setPageComposerOpen(false)} />}
      {openDoc && data && <DocDrawer doc={openDoc} projectId={data.id} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

function BoardFilterBar({ filters, onChange, total, visible, tasks, sections, projectId }: { filters: BoardFilters; onChange: (filters: BoardFilters) => void; total: number; visible: number; tasks: NexusTask[]; sections: NonNullable<NexusProject["taskLists"]>; projectId: string }) {
  const sectionOpts = useMemo(() => sections.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [sections]);
  const reset = () => onChange(EMPTY_FILTERS);
  // Options derived from ALL tasks (not the filtered set) so they stay stable while you filter — same
  // approach as the calendar colour-rules.
  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    let hasUnassigned = false;
    for (const t of tasks) {
      const as = t.assignees ?? [];
      if (as.length === 0) hasUnassigned = true;
      for (const a of as) if (a.user?.id) m.set(a.user.id, a.user.name ?? a.user.email ?? a.user.id);
    }
    return { people: [...m].map(([value, label]) => ({ value, label })), hasUnassigned };
  }, [tasks]);
  // One filter panel per project: each custom field (from the project's DEFINITIONS) with its FULL defined
  // option set (in definition order) as multi-select checkboxes — plus any on-task values that fall outside
  // the defined options (e.g. free-text / date fields, or legacy values). Falls back to task-derived fields
  // only while the definitions are still loading.
  const cfDefs = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), staleTime: 60_000, retry: false });
  const panelFields = useMemo(() => {
    const taskVals = new Map<string, { name: string; values: Set<string> }>();
    for (const t of tasks) for (const c of t.customFieldValues ?? []) {
      const v = c.value == null ? "" : String(c.value);
      if (!v) continue;
      const e = taskVals.get(c.customFieldId) ?? { name: c.customField?.name ?? c.customFieldId, values: new Set<string>() };
      e.values.add(v);
      taskVals.set(c.customFieldId, e);
    }
    const defs = cfDefs.data?.fields;
    if (defs) {
      return defs
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((f) => {
          const choices = cfChoices(f); // full defined option list, in definition order
          const seen = new Set(choices);
          const extra = [...(taskVals.get(f.id)?.values ?? [])].filter((v) => !seen.has(v)).sort((a, b) => a.localeCompare(b));
          return { id: f.id, name: f.name, values: [...choices, ...extra] };
        })
        .filter((f) => f.values.length > 0);
    }
    return [...taskVals].map(([id, e]) => ({ id, name: e.name, values: [...e.values].sort((a, b) => a.localeCompare(b)) }));
  }, [cfDefs.data, tasks]);
  const cfActiveFields = Object.values(filters.cfSelections).filter((v) => v.length > 0).length;
  const toggleCfValue = (fieldId: string, value: string) => {
    const cur = filters.cfSelections[fieldId] ?? [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    const sel = { ...filters.cfSelections };
    if (next.length) sel[fieldId] = next; else delete sel[fieldId];
    onChange({ ...filters, cfSelections: sel });
  };
  const clearCfField = (fieldId: string) => {
    const sel = { ...filters.cfSelections };
    delete sel[fieldId];
    onChange({ ...filters, cfSelections: sel });
  };
  const selectCls = "rounded-2xl border border-border bg-background px-3 py-2 text-sm";
  return (
    <div className="border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search mission cards, tags, assignees..."
            className="w-full rounded-2xl border border-border bg-muted/30 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-background"
          />
        </div>
        {/* Section = the board's own columns (TaskLists) for THIS project — not a fixed global enum. */}
        <select value={filters.section} onChange={(e) => onChange({ ...filters, section: e.target.value })} className={selectCls} title="Filter by section (board column)">
          <option value="ALL">All sections</option>
          {sectionOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => onChange({ ...filters, priority: e.target.value })} className={selectCls}>
          <option value="ALL">All priority</option>
          {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{statusLabel(priority)}</option>)}
        </select>
        {/* Assignee */}
        <select value={filters.assigneeId} onChange={(e) => onChange({ ...filters, assigneeId: e.target.value })} className={selectCls} title="Filter by assignee">
          <option value="ALL">All assignees</option>
          {assignees.hasUnassigned && <option value="NONE">Unassigned</option>}
          {assignees.people.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {/* Custom fields → one panel, multi-select values per field */}
        {panelFields.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(selectCls, "inline-flex items-center gap-2 font-semibold", cfActiveFields > 0 && "border-primary text-primary")} title="Filter by custom fields">
                <Filter className="h-3.5 w-3.5" /> Filter
                {cfActiveFields > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{cfActiveFields}</span>}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-[60vh] w-72 space-y-3 overflow-y-auto p-3">
              {panelFields.map((f) => {
                const sel = filters.cfSelections[f.id] ?? [];
                return (
                  <div key={f.id}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{f.name}</span>
                      {sel.length > 0 && <button onClick={() => clearCfField(f.id)} className="text-[10px] font-semibold text-primary hover:underline">clear</button>}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {f.values.map((v) => {
                        const checked = sel.includes(v);
                        return (
                          <button key={v} onClick={() => toggleCfValue(f.id, v)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent">
                            <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{checked && <Check className="h-3 w-3" />}</span>
                            <span className="truncate">{v}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </PopoverContent>
          </Popover>
        )}
        <button
          onClick={() => onChange({ ...filters, hideDone: !filters.hideDone })}
          className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-bold transition ${filters.hideDone ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
        >
          <Filter className="h-3.5 w-3.5" /> Hide slayed
        </button>
        <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>
        <div className="ml-auto text-xs font-bold text-muted-foreground">{visible}/{total} cards visible</div>
      </div>
    </div>
  );
}


function BoardView({ project, taskLists, onOpen, onCreate }: { project: NexusProject; taskLists: NonNullable<NexusProject["taskLists"]>; onOpen: (task: NexusTask) => void; onCreate: (listId: string) => void }) {
  const qc = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const moveTask = useMutation({
    mutationFn: ({ taskId, listId, position }: { taskId: string; listId: string; position: number }) => nexusApi.updateTask(taskId, { taskListId: listId, position, projectContextId: project.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "tasks"] });
      celebrate("Card moved. Board energy updated ⚡");
    },
  });

  if (taskLists.length === 0) return <div className="p-8"><Empty title="No lanes yet" message="Project ini belum punya task list/lane yang kebaca dari NEXUS." /></div>;

  // Tasks linked into this project from elsewhere → grouped into read-only lanes by their source project.
  const linkedBySource = new Map<string, { name: string; tasks: NexusTask[] }>();
  for (const list of taskLists) {
    for (const tp of list.taskProjects ?? []) {
      const t = tp.task;
      if (!t?.id) continue;
      const srcId = t.taskList?.projectId ?? "linked";
      if (srcId === project.id) continue;
      const g = linkedBySource.get(srcId) ?? { name: t.taskList?.project?.name ?? "Project lain", tasks: [] };
      if (!g.tasks.some((x) => x.id === t.id)) g.tasks.push(t);
      linkedBySource.set(srcId, g);
    }
  }
  const linkedLanes = Array.from(linkedBySource.entries()).map(([id, g]) => ({
    id,
    name: g.name,
    tasks: g.tasks.sort((a, b) => (isDone(a.status) ? 1 : 0) - (isDone(b.status) ? 1 : 0)),
  }));

  return (
    <div className="p-4 md:p-6 overflow-x-auto bg-[radial-gradient(circle_at_top_left,rgba(78,179,1,0.08),transparent_32%),radial-gradient(circle_at_top_right,rgba(123,77,255,0.10),transparent_28%)]">
      <div className="flex gap-4 min-w-max pb-4">
        {/* Linked lanes (tasks linked from other projects), grouped by source project, on the left — parity with core NEXUS. */}
        {linkedLanes.map((lane) => (
          <section key={`linked-${lane.id}`} className="w-80 shrink-0 rounded-[28px] border border-dashed border-violet-300/70 bg-violet-50/50 p-3 shadow-soft">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-black tracking-tight">{lane.name}</h3>
                <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-700">Linked</span>
              </div>
              <p className="shrink-0 text-[11px] text-muted-foreground">{lane.tasks.length}</p>
            </div>
            <div className="space-y-3 min-h-32">
              {lane.tasks.map((task) => (
                <TaskCard key={task.id} task={task} currentProjectId={project.id} onOpen={() => onOpen(task)} onDrag={() => {}} moving={false} />
              ))}
            </div>
          </section>
        ))}
        {taskLists.map((list, laneIndex) => {
          // Own tasks only; done sinks to bottom (parity with core NEXUS). Linked tasks live in their own lanes above.
          const items = [...(list.tasks ?? [])].sort((a, b) => (isDone(a.status) ? 1 : 0) - (isDone(b.status) ? 1 : 0));
          return (
            <section
              key={list.id}
              className="w-80 shrink-0 rounded-[28px] border border-border bg-muted/40 p-3 shadow-soft backdrop-blur"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId) moveTask.mutate({ taskId: draggingId, listId: list.id, position: items.length + 1 });
                setDraggingId(null);
              }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-2xl bg-primary/10 text-sm font-black text-primary">{laneIndex + 1}</span>
                  <div>
                    <h3 className="text-sm font-black tracking-tight">{list.name}</h3>
                    <p className="text-[11px] text-muted-foreground">{items.length} cards in play</p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <ListMenu projectId={project.id} list={{ id: list.id, name: list.name }} />
                  <Button isIconOnly size="sm" variant="ghost" className="rounded-full" onClick={() => onCreate(list.id)}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="space-y-3 min-h-32">
                <button onClick={() => onCreate(list.id)} className="w-full rounded-2xl border border-dashed border-border bg-muted/50 py-3 text-xs font-bold text-muted-foreground transition hover:border-primary/40 hover:text-primary">+ Spawn card</button>
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} currentProjectId={project.id} onOpen={() => onOpen(task)} onDrag={() => setDraggingId(task.id)} moving={moveTask.isPending && draggingId === task.id} />
                ))}
              </div>
            </section>
          );
        })}
        <AddListColumn projectId={project.id} />
      </div>
      {moveTask.isError && <p className="mt-2 text-sm font-semibold text-red-600">Move failed. Check permission/session or target lane.</p>}
    </div>
  );
}

function AddListColumn({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => nexusApi.createSection(projectId, name.trim()),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] }); },
  });
  return (
    <div className="w-72 shrink-0">
      <div className="rounded-[28px] border border-dashed border-border bg-card/50 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); }}
          placeholder="New list name…"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
        />
        <button
          onClick={() => name.trim() && create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add list
        </button>
        {create.isError && <p className="mt-1 text-xs font-semibold text-destructive">Gagal bikin list.</p>}
      </div>
    </div>
  );
}

function ListMenu({ projectId, list }: { projectId: string; list: { id: string; name: string } }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
  const rename = useMutation({ mutationFn: (name: string) => nexusApi.updateSection(projectId, { id: list.id, name }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: () => nexusApi.deleteSection(projectId, list.id), onSuccess: invalidate });
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => { const n = window.prompt("Rename list", list.name); if (n && n.trim() && n !== list.name) rename.mutate(n.trim()); }}
        className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Rename list"
      ><Pencil className="h-3.5 w-3.5" /></button>
      <button
        onClick={() => { if (window.confirm(`Delete list "${list.name}"? Pindahkan/ kosongkan task dulu.`)) del.mutate(); }}
        className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-destructive"
        title="Delete list"
      ><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

const CF_TONE: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-rose-100 text-rose-700",
  blue: "bg-sky-100 text-sky-700",
};
function cfStatusTone(v: string): keyof typeof CF_TONE {
  const s = v.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (["done", "complete", "completed", "selesai"].includes(s)) return "green";
  if (["on progress", "in progress", "progress", "ongoing", "sedang berjalan"].includes(s)) return "amber";
  if (["blocked", "stuck", "terhambat"].includes(s)) return "red";
  if (["not started", "todo", "to do"].includes(s)) return "neutral";
  return "blue";
}
/** Format a task's custom-field value into a board chip (label + tone). Mirrors core-NEXUS. */
function customFieldChip(cfv: NonNullable<NexusTask["customFieldValues"]>[number]): { id: string; label: string; tone: keyof typeof CF_TONE } | null {
  const type = (cfv.customField?.type ?? "").toUpperCase();
  const raw = (cfv.value ?? "").trim();
  if (!raw) return null;
  const opts = cfv.customField?.options;
  const format = opts && typeof opts === "object" && !Array.isArray(opts) ? (opts as { format?: string }).format : undefined;
  if (type === "NUMBER") {
    const digits = raw.replace(/\D+/g, "");
    if (!digits) return null;
    const label = format === "currency-idr"
      ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(digits))
      : raw;
    return { id: cfv.customFieldId, label, tone: "neutral" };
  }
  if (type === "STATUS") return { id: cfv.customFieldId, label: raw, tone: cfStatusTone(raw) };
  if (type === "MULTI_SELECT") {
    try { const a = JSON.parse(raw); const s = Array.isArray(a) ? a.join(", ") : raw; return s ? { id: cfv.customFieldId, label: s, tone: "neutral" } : null; }
    catch { return { id: cfv.customFieldId, label: raw, tone: "neutral" }; }
  }
  if (type === "PLACE") {
    try { const p = JSON.parse(raw) as { label?: string }; return p?.label ? { id: cfv.customFieldId, label: p.label, tone: "neutral" } : null; }
    catch { return { id: cfv.customFieldId, label: raw, tone: "neutral" }; }
  }
  if (type === "DATE" || type === "CREATED") { const d = new Date(raw); return { id: cfv.customFieldId, label: Number.isNaN(d.getTime()) ? raw : fmtDate(raw), tone: "neutral" }; }
  return { id: cfv.customFieldId, label: raw, tone: "neutral" };
}

/** Reusable custom-field chip row for a task (board/list/calendar). Compact + de-duped so the chips
 *  don't pile up or repeat the due date already shown in the card footer. */

/** "☑ 2/5" progress chip — only when the task has subtasks (they're hidden from the board itself). */
function SubtaskChip({ task, className }: { task: NexusTask; className?: string }) {
  const subs = task.subtasks ?? [];
  if (subs.length === 0) return null;
  const done = subs.filter((s) => s.status === "DONE").length;
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
      done === subs.length ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
      className
    )}>
      <ListChecks className="h-3 w-3" /> {done}/{subs.length}
    </span>
  );
}

function TaskCfChips({ task, max = 2, className }: { task: NexusTask; max?: number; className?: string }) {
  const dueKey = task.dueDate ? fmtDate(task.dueDate) : null;
  const chips = ((task.customFieldValues ?? []).map(customFieldChip).filter(Boolean) as Array<{ id: string; label: string; tone: keyof typeof CF_TONE }>)
    .filter((c) => c.label !== dueKey); // a date custom-field equal to the due date is redundant on the card
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {chips.slice(0, max).map((c) => (
        <span key={c.id} className={cn("max-w-[130px] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight", CF_TONE[c.tone])}>{c.label}</span>
      ))}
      {chips.length > max && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">+{chips.length - max}</span>}
    </div>
  );
}

function TaskCard({ task, currentProjectId, onOpen, onDrag, moving }: { task: NexusTask; currentProjectId?: string; onOpen: () => void; onDrag: () => void; moving: boolean }) {
  const qc = useQueryClient();
  const bulk = useTaskBulk();
  const cardProps = bulk.bindCard(task, onOpen);
  const selected = bulk.isSelected(task.id);
  const assignee = task.assignees?.[0]?.user;
  const tags = task.tags ?? [];
  const isDone = (task.status ?? "").toUpperCase() === "DONE";
  const linkedFrom = task.taskList?.projectId && currentProjectId && task.taskList.projectId !== currentProjectId ? (task.taskList.project?.name ?? "project lain") : null;
  const toggleDone = useMutation({
    mutationFn: () => nexusApi.updateTask(task.id, { status: isDone ? "TODO" : "DONE" }),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).some((k) => k.includes("project") || k.includes("task") || k.includes("dashboard")) });
      if (!isDone) celebrate(`Slayed: ${task.title.length > 24 ? task.title.slice(0, 22) + "…" : task.title} ⚔️`);
    },
  });
  return (
    <motion.div layoutId={`board-taskcard-${task.id}`} data-morph-id={`board-taskcard-${task.id}`} style={{ borderRadius: 24 }} onContextMenu={cardProps.onContextMenu} onTouchStart={cardProps.onTouchStart} onTouchEnd={cardProps.onTouchEnd} onTouchMove={cardProps.onTouchMove} className={cn("w-full", isDone && "opacity-60", selected && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
    <Card
      draggable={!linkedFrom}
      onDragStart={onDrag}
      onClick={cardProps.onClick}
      className="w-full border border-border/70 bg-card/95 text-left hover:border-primary/40"
    >
      <CardBody className="gap-3 p-4">
        <div className="flex items-start gap-2">
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggleDone.mutate(); }}
            disabled={toggleDone.isPending}
            className="mt-0.5 shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground active:scale-90"
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            title={isDone ? "Mark as not done" : "Mark as done"}
          >
            {toggleDone.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isDone ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 opacity-70" />}
          </button>
          <div className="min-w-0 flex-1">
            {linkedFrom && <span className="mb-1 block truncate text-[11px] font-semibold text-muted-foreground">From {linkedFrom}</span>}
            <h4 className={cn("text-sm font-bold leading-snug tracking-tight", isDone && "text-muted-foreground/70 line-through")}>{task.title}</h4>
          </div>
          {moving ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <PriorityChip priority={task.priority} />}
        </div>
        {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.slice(0, 3).map((tag) => <Chip key={tag} size="sm" variant="soft" className="h-5 text-[10px]">#{tag}</Chip>)}</div>}
        <TaskCfChips task={task} max={Infinity} />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDue(task.dueDate)}</span>
            <SubtaskChip task={task} />
          </span>
          <span className="inline-flex items-center gap-2">
            {typeof task._count?.comments === "number" && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{task._count.comments}</span>}
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[10px] font-black text-primary" title={assignee?.name || "Unassigned"}>{initials(assignee?.name)}</span>
          </span>
        </div>
      </CardBody>
    </Card>
    </motion.div>
  );
}

function ProjectMembersAvatars({ project }: { project: NexusProject }) {
  const qc = useQueryClient();
  const members = project.members ?? [];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "add" | "team">("list");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);

  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const myRole = wsm.data?.role ?? "";
  const canAdd = myRole === "BOD" || myRole === "ONE_ABOVE_ALL"; // BoD ke atas
  const teamsQ = useQuery({ queryKey: ["nexus", "teams"], queryFn: nexusApi.teams, retry: false, enabled: open && canAdd });

  const ids = members.map((m) => m.userId || m.user?.id).filter(Boolean) as string[];
  const memberIds = new Set(ids);
  const addable = (wsm.data?.members ?? []).filter((m) => !memberIds.has(m.userId) && (!search.trim() || (m.name ?? "").toLowerCase().includes(search.toLowerCase()) || (m.email ?? "").toLowerCase().includes(search.toLowerCase())));

  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] });
  const addPerson = useMutation({ mutationFn: (userId: string) => nexusApi.addProjectMember(project.id, userId, "MEMBER"), onSuccess: refresh });
  const addToTeam = useMutation({ mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => nexusApi.addTeamMember(teamId, userId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["nexus", "teams"] }); refresh(); } });

  if (ids.length === 0 && !canAdd) return null;
  const close = () => { setOpen(false); setMode("list"); setSearch(""); setPending(null); };
  const labelCls = "px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center rounded-full transition hover:opacity-80" title="Lihat / kelola anggota project" aria-label="Anggota project">
        {ids.length > 0 ? <AvatarStack ids={ids} size={26} /> : <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">+ Anggota</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card p-2 shadow-pop">
            {mode === "list" && (
              <>
                <div className={labelCls}>Anggota project · {members.length}</div>
                <div className="max-h-72 space-y-0.5 overflow-y-auto">
                  {members.map((m) => {
                    const uid = m.userId || m.user?.id || "";
                    return (
                      <div key={uid} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
                        <Avatar userId={uid} name={m.user?.name} avatar={m.user?.avatar} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{m.user?.name ?? m.user?.email ?? "—"}</div>
                          {m.role && <div className="text-[11px] capitalize text-muted-foreground">{m.role.toLowerCase()}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {canAdd && (
                  <button onClick={() => setMode("add")} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-sm font-semibold text-primary transition hover:bg-accent">
                    <Plus className="h-4 w-4" /> Tambah orang ke project
                  </button>
                )}
              </>
            )}

            {mode === "add" && (
              <>
                <div className="flex items-center justify-between">
                  <span className={labelCls}>Tambah orang</span>
                  <button onClick={() => { setMode("list"); setSearch(""); }} className="px-2 text-xs font-semibold text-muted-foreground hover:text-foreground">Kembali</button>
                </div>
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama / email…" className="mb-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {addable.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Semua udah jadi member / nggak ketemu.</div>}
                  {addable.map((m) => (
                    <button key={m.userId} disabled={addPerson.isPending} onClick={() => addPerson.mutate(m.userId, { onSuccess: () => { setPending({ id: m.userId, name: m.name }); setMode("team"); setSearch(""); } })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-accent disabled:opacity-50">
                      <Avatar userId={m.userId} name={m.name} avatar={m.avatar} size={26} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name || m.email}</span>
                      {addPerson.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {mode === "team" && pending && (
              <>
                <div className="px-2 py-1.5 text-sm"><b>{pending.name}</b> ✅ masuk project.<div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Masukin ke team mana?</div></div>
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {(teamsQ.data ?? []).map((t) => (
                    <button key={t.id} disabled={addToTeam.isPending} onClick={() => addToTeam.mutate({ teamId: t.id, userId: pending.id }, { onSuccess: () => { setMode("list"); setPending(null); } })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-accent disabled:opacity-50">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color ?? "#7b68ee" }} />
                      <span className="flex-1 truncate text-sm font-semibold">{t.name}</span>
                      {addToTeam.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </button>
                  ))}
                  {(teamsQ.data ?? []).length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Belum ada team.</div>}
                </div>
                <button onClick={() => { setMode("list"); setPending(null); }} className="mt-1 w-full rounded-lg px-2 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent">Nanti aja / skip team</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function cfChoices(field: NexusCustomField): string[] {
  const o = field.options as unknown;
  if (!o) return [];
  if (Array.isArray(o)) return o as string[];
  const obj = o as { options?: string[]; choices?: string[] };
  if (Array.isArray(obj.options)) return obj.options;
  if (Array.isArray(obj.choices)) return obj.choices;
  return [];
}

function TaskComposer({ project, selectedListId, initialDueDate, onClose }: { project: NexusProject; selectedListId: string; initialDueDate?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [taskListId, setTaskListId] = useState(selectedListId);
  const [priority, setPriority] = useState<CreateTaskPayload["priority"]>("MEDIUM");
  const [dueDate, setDueDate] = useState(initialDueDate ?? "");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, string | string[]>>({});

  const cfQuery = useQuery({ queryKey: ["nexus", "project-custom-fields", project.id], queryFn: () => nexusApi.projectCustomFields(project.id), retry: false });
  const customFields = cfQuery.data?.fields ?? [];
  const members = project.members ?? [];
  const setCf = (id: string, v: string | string[]) => setCfValues((prev) => ({ ...prev, [id]: v }));

  const create = useMutation({
    mutationFn: async () => {
      const task = await nexusApi.createTask({ title, description: description || null, projectId: project.id, taskListId, priority, dueDate: dueDate || null, status: "TODO", assigneeIds: assigneeIds.length ? assigneeIds : undefined });
      const entries = Object.entries(cfValues).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== ""));
      await Promise.all(entries.map(([fid, v]) => nexusApi.setCustomFieldValue(fid, task.id, Array.isArray(v) ? JSON.stringify(v) : v)));
      return task;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "tasks"] });
      celebrate("Task baru dibuat 🎉");
      onClose();
    },
  });

  const inputCls = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
  const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-lg border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <CardBody className="max-h-[85vh] gap-0 overflow-y-auto p-0">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
            <h2 className="text-lg font-black tracking-tight">Add task</h2>
            <Button isIconOnly size="sm" variant="ghost" className="rounded-full" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-4 p-6">
            <div className="space-y-1">
              <label className={labelCls}>Judul</label>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mau ngerjain apa?" className={cn(inputCls, "text-base font-semibold")} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Deskripsi</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Konteks singkat (opsional)" className={cn(inputCls, "min-h-20 resize-y")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <label className={labelCls}>Lane / Section</label>
                <select value={taskListId} onChange={(e) => setTaskListId(e.target.value)} className={inputCls}>
                  {(project.taskLists ?? []).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Prioritas</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as CreateTaskPayload["priority"])} className={inputCls}>
                  {(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const).map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Deadline</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            {members.length > 0 && (
              <div className="space-y-1.5">
                <label className={labelCls}>Assignee</label>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const uid = m.userId || m.user?.id || "";
                    const on = assigneeIds.includes(uid);
                    return (
                      <button key={uid} type="button" onClick={() => setAssigneeIds((prev) => (on ? prev.filter((x) => x !== uid) : [...prev, uid]))}
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                        {m.user?.name ?? m.user?.email ?? "—"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {customFields.length > 0 && (
              <div className="space-y-3 rounded-xl border border-dashed border-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-primary">Custom fields</div>
                {customFields.map((f) => {
                  const type = (f.type || "").toUpperCase();
                  const choices = cfChoices(f);
                  const val = cfValues[f.id];
                  return (
                    <div key={f.id} className="space-y-1">
                      <label className={labelCls}>{f.name}</label>
                      {type === "NUMBER" ? (
                        <input type="number" value={typeof val === "string" ? val : ""} onChange={(e) => setCf(f.id, e.target.value)} className={inputCls} />
                      ) : type === "DATE" ? (
                        <input type="date" value={typeof val === "string" ? val : ""} onChange={(e) => setCf(f.id, e.target.value)} className={inputCls} />
                      ) : (type === "SELECT" || type === "STATUS") && choices.length ? (
                        <select value={typeof val === "string" ? val : ""} onChange={(e) => setCf(f.id, e.target.value)} className={inputCls}>
                          <option value="">—</option>
                          {choices.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : type === "MULTI_SELECT" && choices.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {choices.map((c) => {
                            const arr = Array.isArray(val) ? val : [];
                            const on = arr.includes(c);
                            return <button key={c} type="button" onClick={() => setCf(f.id, on ? arr.filter((x) => x !== c) : [...arr, c])} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>{c}</button>;
                          })}
                        </div>
                      ) : (
                        <input value={typeof val === "string" ? val : ""} onChange={(e) => setCf(f.id, e.target.value)} className={inputCls} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {create.isError && <p className="text-sm font-semibold text-red-600">Gagal bikin task — cek akses/lane/koneksi.</p>}
          </div>
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-6 py-4">
            <Button variant="ghost" onClick={onClose}>Batal</Button>
            <Button variant="primary" isDisabled={create.isPending || !title.trim() || !taskListId} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Buat task</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function OverviewView({ project, tasks, progress }: { project: NexusProject; tasks: NexusTask[]; progress: number }) {
  const byStatus = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"].map((status) => ({ status, count: tasks.filter((task) => (task.status || "").toUpperCase() === status).length }));
  const rollups = useQuery({ queryKey: ["nexus", "project", project.id, "rollups"], queryFn: () => nexusApi.projectRollups(project.id), retry: false });
  const r = rollups.data;
  const metrics = [
    { label: "Total tasks", value: r?.totalTasks ?? tasks.length },
    { label: "Completed", value: r?.completedTasks ?? tasks.filter((t) => isDone(t.status)).length },
    { label: "Completion", value: `${r?.completionRate ?? progress}%` },
    { label: "Avg days", value: r?.avgCompletionDays ?? "—" },
  ];
  return (
    <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
      <div className="lg:col-span-8 space-y-4 md:space-y-6">
        <Card className="border border-border shadow-soft"><CardBody className="gap-4 p-6"><div className="text-sm font-black uppercase tracking-wider text-primary">Mission brief</div><p className="text-sm leading-relaxed text-muted-foreground">{project.description || "No brief yet."}</p><ProgressBar value={progress} /></CardBody></Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="font-display text-2xl font-bold tracking-tight">{m.value}</div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>
        <StatusUpdatesPanel projectId={project.id} />
      </div>
      <Card className="lg:col-span-4 border border-border shadow-soft"><CardBody className="gap-3 p-6"><div className="text-sm font-black uppercase tracking-wider text-primary">Status loot</div>{byStatus.map((item) => <div key={item.status} className="flex items-center justify-between text-sm"><span>{statusLabel(item.status)}</span><span className="font-black">{item.count}</span></div>)}</CardBody></Card>
    </div>
  );
}

function StatusUpdatesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const updates = useQuery({ queryKey: ["nexus", "project", projectId, "status-updates"], queryFn: () => nexusApi.statusUpdates(projectId), retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "project", projectId, "status-updates"] });
  const create = useMutation({ mutationFn: () => nexusApi.createStatusUpdate(projectId, text.trim()), onSuccess: () => { setText(""); invalidate(); } });
  const generate = useMutation({ mutationFn: () => nexusApi.generateStatusUpdate(projectId), onSuccess: (res) => setText(res.content || "") });
  const rows = updates.data ?? [];
  return (
    <Card className="border border-border shadow-soft">
      <CardBody className="gap-3 p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-black uppercase tracking-wider text-primary">Status updates</div>
          <button onClick={() => generate.mutate()} disabled={generate.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-primary" />} AI draft
          </button>
        </div>
        <div className="flex items-start gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Post a status update… (or let AI draft it)" className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary" />
          <button disabled={!text.trim() || create.isPending} onClick={() => create.mutate()} className="mt-0.5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
          </button>
        </div>
        <div className="space-y-2">
          {updates.isLoading && <p className="text-xs text-muted-foreground">Loading updates…</p>}
          {!updates.isLoading && rows.length === 0 && <p className="text-xs text-muted-foreground">No status updates yet.</p>}
          {rows.map((u) => (
            <div key={u.id} className="rounded-xl bg-muted/50 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground/80">{u.author?.name ?? "Someone"}</span>
                {u.status && <Chip size="sm" variant="soft" color="accent">{statusLabel(u.status)}</Chip>}
                <span className="ml-auto">{fmtDate(u.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{u.text}</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ListRow({ task, onOpen }: { task: NexusTask; onOpen: (task: NexusTask) => void }) {
  const bulk = useTaskBulk();
  const cardProps = bulk.bindCard(task, () => onOpen(task));
  const selected = bulk.isSelected(task.id);
  const done = isDone(task.status);
  const assignee = task.assignees?.[0]?.user;
  const p = (task.priority || "").toUpperCase();
  const dot = p === "URGENT" ? "bg-destructive" : p === "HIGH" ? "bg-warning" : p === "MEDIUM" ? "bg-info" : "bg-muted-foreground/40";
  return (
    <motion.button
      layoutId={`list-taskcard-${task.id}`}
      data-morph-id={`list-taskcard-${task.id}`}
      style={{ borderRadius: 12 }}
      whileHover={{ y: -2 }}
      {...cardProps}
      className={cn("group flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left shadow-soft transition-shadow hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", selected && "ring-2 ring-primary")}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
        {done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm font-medium group-hover:text-primary", done && "text-muted-foreground line-through")}>{task.title}</span>
          <SubtaskChip task={task} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{task.dueDate ? `due ${fmtDue(task.dueDate)}` : "No due date"}</div>
        <TaskCfChips task={task} max={3} className="mt-1 hidden sm:flex" />
      </div>
      <span className="hidden md:block"><PriorityChip priority={task.priority} /></span>
      <Chip size="sm" variant="soft" className="hidden sm:flex">{statusLabel(task.status)}</Chip>
      {assignee && <span title={assignee.name ?? ""} className="hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-border sm:grid">{initials(assignee.name)}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
    </motion.button>
  );
}

function ListView({ taskLists, onOpen }: { taskLists: NonNullable<NexusProject["taskLists"]>; onOpen: (task: NexusTask) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = taskLists.reduce((n, l) => n + (l.tasks?.length ?? 0), 0);
  if (total === 0) return <div className="p-4 md:p-8"><Empty title="No tasks here" message="Belum ada task di filter ini — bikin satu lewat Add task." /></div>;
  return (
    <div className="space-y-5 p-4 md:p-8">
      {taskLists.map((list) => {
        const tasks = list.tasks ?? [];
        if (tasks.length === 0) return null; // hide empty sections (after filters)
        const isCollapsed = collapsed.has(list.id);
        const doneCount = tasks.filter((t) => isDone(t.status)).length;
        return (
          <div key={list.id}>
            {/* section header / divider */}
            <button onClick={() => toggle(list.id)} className="mb-2 flex w-full items-center gap-2 border-b border-border pb-1.5 text-left transition-colors hover:text-primary">
              <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", !isCollapsed && "rotate-90")} />
              <span className="font-display text-sm font-semibold tracking-tight">{list.name}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{doneCount}/{tasks.length}</span>
            </button>
            {!isCollapsed && (
              <div className="space-y-1.5 rounded-2xl bg-muted/40 p-2">
                {tasks.map((task) => <ListRow key={task.id} task={task} onOpen={onOpen} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CAL_CHIP: Record<string, string> = {
  URGENT: "bg-rose-100 text-rose-700",
  HIGH: "bg-amber-100 text-amber-700",
  MEDIUM: "bg-sky-100 text-sky-700",
  LOW: "bg-emerald-100 text-emerald-700",
  NONE: "bg-muted text-muted-foreground",
};
const CAL_STRIPE: Record<string, string> = {
  URGENT: "bg-rose-500",
  HIGH: "bg-amber-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-emerald-500",
  NONE: "bg-muted-foreground/40",
};

// ── Calendar color rules (frozen frontend feature, localStorage per project) ──
const CAL_PRESETS = [
  { name: "Sky", bg: "#dbeafe", border: "#60a5fa", text: "#1e3a8a" },
  { name: "Emerald", bg: "#dcfce7", border: "#34d399", text: "#14532d" },
  { name: "Amber", bg: "#fef3c7", border: "#f59e0b", text: "#78350f" },
  { name: "Rose", bg: "#ffe4e6", border: "#fb7185", text: "#881337" },
  { name: "Violet", bg: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" },
  { name: "Slate", bg: "#e2e8f0", border: "#94a3b8", text: "#0f172a" },
] as const;
type CalColorSource = "status" | "priority" | "assignee" | "task_list" | "custom_field";
type CalColorRule = { id: string; source: CalColorSource; customFieldId?: string; value: string; color: string };
const CAL_SOURCE_LABEL: Record<CalColorSource, string> = { status: "Status", priority: "Priority", assignee: "Assignee", task_list: "List", custom_field: "Custom field" };
function calColorKey(projectId: string) { return `nexus:calendar-color-rules:${projectId}`; }
function calRuleId() { return Math.random().toString(36).slice(2, 10); }
function calRuleValues(task: NexusTask, rule: CalColorRule): string[] {
  switch (rule.source) {
    case "status": return [(task.status ?? "").toUpperCase()];
    case "priority": return [(task.priority ?? "NONE").toUpperCase()];
    case "assignee": return (task.assignees ?? []).map((a) => a.user?.id ?? "").filter(Boolean);
    case "task_list": return [task.taskListId ?? task.taskList?.id ?? ""];
    case "custom_field": return (task.customFieldValues ?? []).filter((c) => c.customFieldId === rule.customFieldId).map((c) => c.value ?? "").filter(Boolean);
    default: return [];
  }
}

function CalendarView({ projectId, tasks, onOpen, onCreate, onSetDue }: { projectId: string; tasks: NexusTask[]; onOpen: (task: NexusTask) => void; onCreate: (dueDate: string) => void; onSetDue: (taskId: string, dueDate: string) => void }) {
  const bulk = useTaskBulk();
  const isMobile = useIsMobile();
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [colorRules, setColorRules] = useState<CalColorRule[]>(() => {
    if (typeof window === "undefined") return [];
    try { const raw = window.localStorage.getItem(calColorKey(projectId)); const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p.filter((r) => r?.id && r?.source && r?.color) : []; } catch { return []; }
  });
  const persistRules = (rules: CalColorRule[]) => { setColorRules(rules); try { window.localStorage.setItem(calColorKey(projectId), JSON.stringify(rules)); } catch { /* ignore */ } };

  // Option pools derived from current tasks.
  const assigneeOpts = useMemo(() => { const m = new Map<string, string>(); for (const t of tasks) for (const a of t.assignees ?? []) if (a.user?.id) m.set(a.user.id, a.user.name ?? a.user.email ?? a.user.id); return [...m].map(([value, label]) => ({ value, label })); }, [tasks]);
  const listOpts = useMemo(() => { const m = new Map<string, string>(); for (const t of tasks) { const id = t.taskListId ?? t.taskList?.id; if (id) m.set(id, t.taskList?.name ?? id); } return [...m].map(([value, label]) => ({ value, label })); }, [tasks]);
  // Field list from the project's DEFINITIONS (matches what's configured), task-derived only as a load-time fallback.
  const cfDefs = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), staleTime: 60_000, retry: false });
  const cfFields = useMemo(() => {
    const defs = cfDefs.data?.fields;
    if (defs) return defs.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((f) => ({ value: f.id, label: f.name }));
    const m = new Map<string, string>(); for (const t of tasks) for (const c of t.customFieldValues ?? []) m.set(c.customFieldId, c.customField?.name ?? c.customFieldId); return [...m].map(([value, label]) => ({ value, label }));
  }, [cfDefs.data, tasks]);
  const cfValuesFor = (fieldId?: string) => { const s = new Set<string>(); if (!fieldId) return []; for (const t of tasks) for (const c of t.customFieldValues ?? []) if (c.customFieldId === fieldId && c.value) s.add(c.value); return [...s].map((value) => ({ value, label: value })); };
  const ruleValueOpts = (rule: CalColorRule): { value: string; label: string }[] => {
    switch (rule.source) {
      case "status": return TASK_STATUSES.map((v) => ({ value: v, label: statusLabel(v) }));
      case "priority": return TASK_PRIORITIES.map((v) => ({ value: v, label: statusLabel(v) }));
      case "assignee": return assigneeOpts;
      case "task_list": return listOpts;
      case "custom_field": return cfValuesFor(rule.customFieldId);
      default: return [];
    }
  };
  const styleForTask = (task: NexusTask): { backgroundColor: string; borderColor: string; color: string } | null => {
    const rule = colorRules.find((r) => r.value && calRuleValues(task, r).includes(r.value));
    if (!rule) return null;
    const p = CAL_PRESETS.find((x) => x.bg === rule.color);
    return p ? { backgroundColor: p.bg, borderColor: p.border, color: p.text } : null;
  };
  const addRule = () => persistRules([...colorRules, { id: calRuleId(), source: "status", value: "IN_PROGRESS", color: CAL_PRESETS[0].bg }]);
  const updateRule = (id: string, patch: Partial<CalColorRule>) => persistRules(colorRules.map((r) => r.id === id ? { ...r, ...patch, ...(patch.source ? { customFieldId: undefined, value: "" } : {}), ...(patch.customFieldId ? { value: "" } : {}) } : r));
  const removeRule = (id: string) => persistRules(colorRules.filter((r) => r.id !== id));

  // Subtasks are hidden from Board/List (Asana-style, nested in the parent panel) but a subtask can have
  // its own due date that matters — so the CALENDAR additionally pulls the project's dated subtasks (the
  // project payload is parentId-only). Board/List stay subtask-free.
  const allProjTasks = useQuery({ queryKey: ["nexus", "project-calendar-tasks", projectId], queryFn: () => nexusApi.tasks(`projectId=${projectId}`), staleTime: 30_000, retry: false });
  const datedSubtasks = useMemo(() => (allProjTasks.data ?? []).filter((t) => t.parentId && parseDate(t.dueDate)), [allProjTasks.data]);

  const dated = [...tasks.filter((task) => parseDate(task.dueDate)), ...datedSubtasks];
  const undated = tasks.filter((task) => !parseDate(task.dueDate));
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [viewMonth, setViewMonth] = useState(() => {
    const base = dated[0] ? parseDate(dated[0].dueDate)! : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const shiftMonth = (delta: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const sameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  // 6-week grid starting on the Monday on/before the 1st
  const gridStart = new Date(viewMonth);
  gridStart.setDate(1 - ((viewMonth.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const todayKey = dayKey(new Date());

  // Mobile agenda — tasks in the viewed month, grouped by day (Time Map / team-calendar style).
  const byDay = new Map<string, { date: Date; items: NexusTask[] }>();
  for (const task of dated) {
    const d = parseDate(task.dueDate)!;
    if (!sameMonth(d, viewMonth)) continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, { date: d, items: [] });
    byDay.get(k)!.items.push(task);
  }
  const agenda = Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-xl font-black tracking-tight">Time Map</h2><p className="text-sm text-muted-foreground">Live due-date calendar from project cards.</p></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setColorPanelOpen((v) => !v)} className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-bold transition", colorPanelOpen || colorRules.length > 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}><Palette className="h-4 w-4" />Colors{colorRules.length > 0 && <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-black">{colorRules.length}</span>}</button>
          <div className="flex items-center gap-1 text-sm font-bold">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[128px] text-center">{viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {colorPanelOpen && (
        <Card className="border border-border shadow-soft">
          <CardBody className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-black">Color rules</div>
              <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-3.5 w-3.5" />Add rule</Button>
            </div>
            {colorRules.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada rule. Warnai task di kalender berdasarkan status, priority, assignee, list, atau custom field.</p>
            ) : (
              <div className="space-y-2">
                {colorRules.map((rule) => {
                  const valueOpts = ruleValueOpts(rule);
                  return (
                    <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-2">
                      <select value={rule.source} onChange={(e) => updateRule(rule.id, { source: e.target.value as CalColorSource })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold">
                        {(Object.keys(CAL_SOURCE_LABEL) as CalColorSource[]).map((s) => <option key={s} value={s}>{CAL_SOURCE_LABEL[s]}</option>)}
                      </select>
                      {rule.source === "custom_field" && (
                        <select value={rule.customFieldId ?? ""} onChange={(e) => updateRule(rule.id, { customFieldId: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold">
                          <option value="">Pilih field…</option>
                          {cfFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      )}
                      <span className="text-xs font-bold text-muted-foreground">=</span>
                      <select value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })} className="min-w-[120px] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-semibold">
                        <option value="">Pilih nilai…</option>
                        {valueOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        {CAL_PRESETS.map((p) => (
                          <button key={p.name} onClick={() => updateRule(rule.id, { color: p.bg })} title={p.name} className={cn("h-6 w-6 rounded-full border-2 transition", rule.color === p.bg ? "scale-110" : "border-transparent hover:scale-105")} style={{ backgroundColor: p.bg, borderColor: rule.color === p.bg ? p.border : undefined }} />
                        ))}
                      </div>
                      <button onClick={() => removeRule(rule.id)} aria-label="Remove rule" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {isMobile ? (
        <div className="space-y-5">
          {agenda.map(({ date, items }) => {
            const isToday = dayKey(date) === todayKey;
            return (
              <div key={dayKey(date)} className="flex gap-4">
                <div className="w-12 shrink-0 text-center">
                  <div className={cn("flex flex-col items-center justify-center rounded-2xl py-2", isToday ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-foreground")}>
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
                    <span className="font-display text-xl font-bold leading-none">{date.getDate()}</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="text-sm font-bold">{date.toLocaleDateString("en-US", { weekday: "long" })}</span>
                    {isToday && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Today</span>}
                    <span className="text-xs text-muted-foreground">· {items.length}</span>
                  </div>
                  {items.map((task) => {
                    const done = isDone(task.status);
                    const assignee = task.assignees?.[0]?.user;
                    const cs = styleForTask(task);
                    return (
                      <motion.button key={task.id} layoutId={`calendar-taskcard-${task.id}`} data-morph-id={`calendar-taskcard-${task.id}`} style={cs && !done ? { borderRadius: 16, backgroundColor: cs.backgroundColor, borderColor: cs.borderColor } : { borderRadius: 16 }} {...bulk.bindCard(task, () => onOpen(task))} className={cn("group flex w-full items-stretch gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft", done && "opacity-60", bulk.isSelected(task.id) && "ring-2 ring-primary")}>
                        <span className={cn("w-1 shrink-0 rounded-full", done && "bg-success", !done && !cs && (CAL_STRIPE[(task.priority ?? "NONE").toUpperCase()] ?? CAL_STRIPE.NONE))} style={cs && !done ? { backgroundColor: cs.borderColor } : undefined} />
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-sm font-semibold group-hover:text-primary", done && "line-through")}>{task.parentId ? `↳ ${task.title}` : task.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                            <span>{statusLabel(task.status)}</span>
                            {assignee?.name && <span className="inline-flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-primary/10 text-[8px] font-bold text-primary">{initials(assignee.name)}</span>{assignee.name}</span>}
                          </div>
                          <TaskCfChips task={task} max={3} className="mt-1.5" />
                        </div>
                        <PriorityChip priority={task.priority} />
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {agenda.length === 0 && dated.length > 0 && <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-soft">Gak ada task jatuh tempo di {viewMonth.toLocaleDateString("en-US", { month: "long" })}.</p>}
        </div>
      ) : (
      <Card className="overflow-hidden border border-border shadow-soft">
        <CardBody className="p-0">
          <div className="grid grid-cols-7 bg-muted/40 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="px-1 py-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = dayKey(day);
              const inMonth = sameMonth(day, viewMonth);
              // Only attach events to in-month days — keeps each task's morph id unique per month.
              const dayTasks = inMonth ? dated.filter((task) => dayKey(parseDate(task.dueDate)!) === key) : [];
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  onDragOver={(e) => { if (dragTaskId && inMonth) { e.preventDefault(); setDropKey(key); } }}
                  onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); if (dragTaskId && inMonth) onSetDue(dragTaskId, ymd(day)); setDragTaskId(null); setDropKey(null); }}
                  className={cn("group/cal relative min-h-20 border-r border-t border-border p-1 last:border-r-0 sm:min-h-28 sm:p-1.5", !inMonth && "bg-muted/20", dropKey === key && "bg-primary/10 ring-2 ring-inset ring-primary")}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <div className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px] font-black", isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/40")}>{day.getDate()}</div>
                    {/* always visible on touch screens (no hover there); hover-reveal on desktop */}
                    {inMonth && <button type="button" onClick={() => onCreate(ymd(day))} title="Tambah task tanggal ini" className="grid h-6 w-6 place-items-center rounded-lg bg-muted/60 text-muted-foreground transition hover:bg-accent hover:text-primary focus-visible:opacity-100 sm:h-5 sm:w-5 sm:bg-transparent sm:opacity-0 sm:group-hover/cal:opacity-100"><Plus className="h-3.5 w-3.5 sm:h-3 sm:w-3" /></button>}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((task) => {
                      const done = isDone(task.status);
                      const cs = styleForTask(task);
                      return (
                        <motion.button key={task.id} layoutId={`calendar-taskcard-${task.id}`} data-morph-id={`calendar-taskcard-${task.id}`} style={cs && !done ? { borderRadius: 6, backgroundColor: cs.backgroundColor, color: cs.color, boxShadow: `inset 2px 0 0 ${cs.borderColor}` } : { borderRadius: 6 }} {...bulk.bindCard(task, () => onOpen(task))} title={task.parentId ? `↳ ${task.title} (subtask)` : task.title} className={cn("block w-full truncate px-1.5 py-0.5 text-left text-[10px] font-bold leading-tight", done ? "bg-muted text-muted-foreground line-through" : !cs && (CAL_CHIP[(task.priority ?? "NONE").toUpperCase()] ?? CAL_CHIP.NONE), bulk.isSelected(task.id) && "ring-1 ring-inset ring-primary")}>
                          {task.parentId ? `↳ ${task.title}` : task.title}
                        </motion.button>
                      );
                    })}
                    {dayTasks.length > 3 && <div className="px-1 text-[10px] font-bold text-muted-foreground">+{dayTasks.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
      )}
      {undated.length > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-muted/20 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tanpa due date · {undated.length}</div>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((task) => (
              <button
                key={task.id}
                draggable
                onDragStart={() => setDragTaskId(task.id)}
                onDragEnd={() => { setDragTaskId(null); setDropKey(null); }}
                onClick={() => onOpen(task)}
                title="Seret ke tanggal buat kasih due date, atau klik buat buka"
                className={cn("max-w-[200px] cursor-grab truncate rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-semibold transition hover:border-primary/40 active:cursor-grabbing", CAL_CHIP[(task.priority ?? "NONE").toUpperCase()] ?? "")}
              >
                {task.title}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Seret ke tanggal di kalender buat ngasih due date, atau klik buat buka.</p>
        </div>
      )}
      {dated.length === 0 && undated.length === 0 && <Empty title="Belum ada task" message="Klik + di tanggal buat bikin task baru, atau tambah lewat board." />}
    </div>
  );
}

const DAY_MS = 86400000;
const GANTT_DAY_W = 40; // px per day
const GANTT_LEFT_W = 460; // px for the frozen left table
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysBetween(a: Date, b: Date) { return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS); }

function tlProgress(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "DONE": return 100;
    case "IN_REVIEW": return 75;
    case "IN_PROGRESS": return 50;
    case "CANCELLED": return 0;
    default: return 8;
  }
}
function pctTone(pct: number) {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 70) return "bg-teal-500";
  if (pct >= 40) return "bg-amber-500";
  if (pct > 0) return "bg-rose-500";
  return "bg-muted-foreground/30";
}
const GANTT_BAR: Record<string, string> = {
  URGENT: "bg-rose-500",
  HIGH: "bg-amber-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-violet-500",
  NONE: "bg-teal-500",
};
function tlInitials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function taskWindow(task: NexusTask): { start: Date; end: Date } {
  let start = parseDate(task.startDate);
  let end = parseDate(task.dueDate);
  if (start && !end) end = new Date(start.getTime() + DAY_MS * 3);
  if (!start && end) start = new Date(end.getTime() - DAY_MS * 3);
  if (!start || !end) { const t = startOfDay(new Date()); start = t; end = new Date(t.getTime() + DAY_MS * 3); }
  start = startOfDay(start); end = startOfDay(end);
  if (end < start) end = start;
  return { start, end };
}

function TlMenuItem({ icon: Icon, label, onClick, danger, shortcut }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean; shortcut?: string }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition", danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent")}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-xs font-medium text-muted-foreground">{shortcut}</span>}
    </button>
  );
}

function TimelineView({ projectId: _projectId, taskLists, onOpen }: { projectId: string; taskLists: NonNullable<NexusProject["taskLists"]>; onOpen: (task: NexusTask) => void }) {
  const bulk = useTaskBulk();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = taskLists.map((list) => {
    const tasks = (list.tasks ?? []).map((t) => ({ task: t, win: taskWindow(t) }));
    tasks.sort((a, b) => a.win.start.getTime() - b.win.start.getTime());
    return { list, tasks };
  });
  const allWins = groups.flatMap((g) => g.tasks.map((t) => t.win));

  if (allWins.length === 0) {
    return <div className="p-4 md:p-8"><Empty title="Belum ada timeline" message="Tambahkan task (start/due date opsional) biar muncul di Gantt." /></div>;
  }

  let min = allWins.reduce((a, w) => (w.start < a ? w.start : a), allWins[0].start);
  let max = allWins.reduce((a, w) => (w.end > a ? w.end : a), allWins[0].end);
  min = startOfDay(new Date(min.getTime() - DAY_MS * 2));
  max = startOfDay(new Date(max.getTime() + DAY_MS * 3));
  const dayCount = daysBetween(min, max) + 1;
  const timelineW = dayCount * GANTT_DAY_W;
  const today = startOfDay(new Date());
  const xOf = (d: Date) => daysBetween(min, d) * GANTT_DAY_W;

  const days = Array.from({ length: dayCount }, (_, i) => new Date(min.getTime() + i * DAY_MS));
  const months: { label: string; days: number }[] = [];
  for (const d of days) {
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const last = months[months.length - 1];
    if (last && last.label === label) last.days++;
    else months.push({ label, days: 1 });
  }

  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">Gantt Timeline</h2>
          <p className="text-sm text-muted-foreground">Start → due windows per section. Right-click a bar for actions.</p>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <div style={{ width: GANTT_LEFT_W + timelineW }}>
          {/* HEADER */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card">
            <div className="sticky left-0 z-30 flex shrink-0 border-r border-border bg-card" style={{ width: GANTT_LEFT_W }}>
              <div className="flex flex-1 items-end px-4 pb-2 pt-6 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Title</div>
              <div className="flex w-[90px] items-end px-2 pb-2 pt-6 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Duration</div>
              <div className="flex w-[150px] items-end border-l border-border px-3 pb-2 pt-6 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Status</div>
            </div>
            <div className="relative" style={{ width: timelineW }}>
              <div className="flex h-8 border-b border-border/50">
                {months.map((m, i) => (
                  <div key={i} className="flex items-center border-l border-border/40 px-2 text-xs font-bold text-foreground/70" style={{ width: m.days * GANTT_DAY_W }}>{m.label}</div>
                ))}
              </div>
              <div className="flex h-9">
                {days.map((d, i) => {
                  const isToday = d.getTime() === today.getTime();
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={i} className={cn("flex flex-col items-center justify-center gap-0.5 border-l border-border/40 text-[10px] leading-none", weekend && "bg-muted/30")} style={{ width: GANTT_DAY_W }}>
                      <span className={cn("font-semibold", isToday ? "text-primary" : "text-muted-foreground/70")}>{WD[d.getDay()]}</span>
                      <span className={cn(isToday ? "grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground" : "font-bold text-foreground/80")}>{d.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BODY */}
          <div className="relative">
            {today >= min && today <= max && (
              <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px bg-primary/50" style={{ left: GANTT_LEFT_W + xOf(today) + GANTT_DAY_W / 2 }} />
            )}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.list.id);
              const wins = g.tasks.map((t) => t.win);
              const gStart = wins.length ? wins.reduce((a, w) => (w.start < a ? w.start : a), wins[0].start) : null;
              const gEnd = wins.length ? wins.reduce((a, w) => (w.end > a ? w.end : a), wins[0].end) : null;
              const gDur = gStart && gEnd ? daysBetween(gStart, gEnd) + 1 : 0;
              const gPct = g.tasks.length ? Math.round(g.tasks.reduce((s, t) => s + tlProgress(t.task.status), 0) / g.tasks.length) : 0;
              return (
                <div key={g.list.id}>
                  {/* GROUP ROW */}
                  <div className="flex border-b border-border bg-muted/40">
                    <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-muted/40" style={{ width: GANTT_LEFT_W }}>
                      <button onClick={() => toggle(g.list.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                        <span className="truncate font-bold tracking-tight">{g.list.name}</span>
                      </button>
                      <div className="w-[90px] px-2 text-xs font-semibold text-muted-foreground">{gDur ? `${gDur} days` : "—"}</div>
                      <div className="flex w-[150px] items-center gap-2 border-l border-border px-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500" style={{ width: `${gPct}%` }} /></div>
                        <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{gPct}%</span>
                      </div>
                    </div>
                    <div className="relative" style={{ width: timelineW }}>
                      {gStart && <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-muted-foreground" style={{ left: xOf(gStart) + 6 }}>{g.list.name}</span>}
                    </div>
                  </div>
                  {/* TASK ROWS */}
                  {!isCollapsed && g.tasks.map(({ task, win }) => {
                    const pct = tlProgress(task.status);
                    const dur = daysBetween(win.start, win.end) + 1;
                    const left = xOf(win.start);
                    const width = Math.max(GANTT_DAY_W * 0.8, daysBetween(win.start, win.end) * GANTT_DAY_W + GANTT_DAY_W);
                    const isDone = (task.status ?? "").toUpperCase() === "DONE";
                    const barColor = GANTT_BAR[(task.priority ?? "NONE").toUpperCase()] ?? GANTT_BAR.NONE;
                    const people = (task.assignees ?? []).map((a) => a.user).filter(Boolean).slice(0, 3);
                    const cp = bulk.bindCard(task, () => onOpen(task));
                    const selected = bulk.isSelected(task.id);
                    return (
                      <div key={task.id} className={cn("flex border-b border-border/50 hover:bg-accent/20", selected && "bg-primary/10 ring-1 ring-inset ring-primary")}>
                        <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card" style={{ width: GANTT_LEFT_W }}>
                          <button {...cp} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
                            {isDone ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                            <span className={cn("truncate text-sm font-medium", isDone && "text-muted-foreground line-through")}>{task.title}</span>
                          </button>
                          <div className="w-[90px] px-2 text-xs text-muted-foreground">{dur} days</div>
                          <div className="flex w-[150px] items-center gap-2 border-l border-border px-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", pctTone(pct))} style={{ width: `${pct}%` }} /></div>
                            <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{pct}%</span>
                          </div>
                        </div>
                        <div className="relative py-2" style={{ width: timelineW }}>
                          <motion.button
                            layoutId={`timeline-taskcard-${task.id}`}
                            data-morph-id={`timeline-taskcard-${task.id}`}
                            whileHover={{ scale: 1.015 }}
                            {...cp}
                            title={`${task.title} · ${fmtDate(win.start.toISOString())} → ${fmtDate(win.end.toISOString())}`}
                            className={cn("group absolute top-1.5 flex h-8 items-center gap-1.5 overflow-hidden px-1.5 text-left shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", barColor)}
                            style={{ left, width, borderRadius: 14 }}
                          >
                            {people.length > 0 && (
                              <div className="flex shrink-0 -space-x-1.5">
                                {people.map((u, i) => (
                                  <span key={i} className="grid h-5 w-5 place-items-center rounded-full bg-white/90 text-[9px] font-black text-foreground ring-1 ring-black/10">{tlInitials(u?.name)}</span>
                                ))}
                              </div>
                            )}
                            <span className="truncate text-xs font-bold text-white drop-shadow-sm">{task.title}</span>
                          </motion.button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Context menu / multi-select handled by the shared TaskBulkProvider (right-click / long-press). */}
    </div>
  );
}


function PagesView({ project, onCreate, onOpen }: { project: NexusProject; onCreate: () => void; onOpen: (doc: NexusDoc) => void }) {
  const docs = useQuery({ queryKey: ["nexus", "project-docs", project.id], queryFn: () => nexusApi.projectDocs(project.id), retry: false });
  const items = docs.data?.docs ?? [];
  return (
    <div className="p-4 md:p-8 space-y-5 bg-[radial-gradient(circle_at_top_left,rgba(78,179,1,0.08),transparent_30%)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">Project Lore</h2>
          <p className="text-sm text-muted-foreground">Live docs scoped to this mission. SOP spells, meeting notes, briefs, and reference pages live here.</p>
        </div>
        <Button variant="primary" onClick={onCreate}><Plus className="h-4 w-4" />Add page</Button>
      </div>
      {docs.isLoading && <Card><CardBody className="p-6 text-sm text-muted-foreground">Loading project lore...</CardBody></Card>}
      {docs.isError && <Empty title="Pages locked" message="Login/session atau project access dibutuhkan untuk load docs project ini." />}
      {!docs.isLoading && !docs.isError && items.length === 0 && <Empty title="No project pages yet" message="Spawn the first page for briefs, SOP, meeting notes, or project lore." />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((doc) => (
          <Card key={doc.id} onClick={() => onOpen(doc)} className="border border-border bg-card text-left shadow-soft hover:border-primary/40">
            <CardBody className="gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg">📜</span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black tracking-tight">{doc.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Updated {fmtDate(doc.updatedAt)} · {doc.owner?.name || doc.author?.name || "NEXUS keeper"}</p>
                </div>
              </div>
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{doc.contentText || "No visible text yet. Open to edit the page shell."}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Chip size="sm" variant="soft">{doc.project?.name || project.name}</Chip>
                <span>Open lore →</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PageComposer({ project, onClose }: { project: NexusProject; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const create = useMutation({
    mutationFn: () => nexusApi.createDoc({ title: title.trim(), projectId: project.id, content: plainTextToTipTap(content) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project-docs", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      celebrate("Project lore page created 📜✨");
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-2xl border border-border bg-card shadow-pop">
        <CardBody className="gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-black tracking-tight">Add project lore</h2><p className="mt-1 text-sm text-muted-foreground">Creates a real project-scoped doc in NEXUS.</p></div>
            <Button isIconOnly size="sm" variant="ghost" className="rounded-full" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title — e.g. Client Brief / MOM / SOP" className="rounded-xl border border-border bg-background px-3 py-2 text-sm" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Drop notes here. Gue convert jadi TipTap doc JSON before sending." className="min-h-52 rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed" />
          {create.isError && <p className="text-sm font-semibold text-red-600">Create page failed. Check permission/session.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" isDisabled={create.isPending || !title.trim()} onClick={() => create.mutate()}>Create real page</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function DocDrawer({ doc, projectId, onClose }: { doc: NexusDoc; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.contentText || "");
  const update = useMutation({
    mutationFn: () => nexusApi.updateDoc(doc.id, { title: title.trim(), content: plainTextToTipTap(content) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project-docs", projectId] });
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      celebrate("Project page saved 📝✨");
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => nexusApi.deleteDoc(doc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project-docs", projectId] });
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      celebrate("Project page archived 🗂️");
      onClose();
    },
  });
  const dirty = title.trim() !== doc.title || content !== (doc.contentText || "");
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="w-full max-w-full border-l border-border bg-background shadow-pop sm:w-[620px] flex flex-col">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Chip size="sm" color="accent" variant="soft">Project page</Chip>
          {dirty && <Chip size="sm" color="warning" variant="soft">Unsaved lore</Chip>}
          <button onClick={onClose} className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary"><FileText className="h-3 w-3" /> Project lore editor</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-2xl font-black leading-snug tracking-tight outline-none focus:border-primary" />
          <div className="mt-3 text-xs text-muted-foreground">Updated {fmtDate(doc.updatedAt)} · Owner {doc.owner?.name || doc.author?.name || "NEXUS keeper"}</div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write project context here..." className="mt-5 min-h-[360px] w-full rounded-2xl border border-border bg-muted/20 p-4 text-sm leading-relaxed outline-none focus:border-primary" />
          {(update.isError || remove.isError) && <p className="mt-4 text-sm font-semibold text-red-600">Page action failed. Check permission/session.</p>}
        </div>
        <div className="border-t border-border p-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" isDisabled={update.isPending || !title.trim() || !dirty || remove.isPending} onClick={() => update.mutate()}>{!update.isPending && <Pencil className="h-4 w-4" />}Save page</Button>
          <Button variant="danger-soft" isDisabled={remove.isPending || update.isPending} onClick={() => remove.mutate()}>{!remove.isPending && <Trash2 className="h-4 w-4" />}Delete</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </aside>
    </div>
  );
}


function SprintsView({ project, tasks, onOpenTask }: { project: NexusProject; tasks: NexusTask[]; onOpenTask: (task: NexusTask) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(toDateInput(new Date().toISOString()));
  const [endDate, setEndDate] = useState(toDateInput(new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString()));
  const [expandedSprintId, setExpandedSprintId] = useState<string | null>(null);
  const [addingToSprintId, setAddingToSprintId] = useState<string | null>(null);
  const [completing, setCompleting] = useState<{ sprintId: string; incomplete: NexusTask[] } | null>(null);
  const sprintsQuery = useQuery({ queryKey: ["nexus", "sprints", project.id], queryFn: () => nexusApi.sprints(project.id), retry: false });
  const sprints = sprintsQuery.data?.sprints ?? [];
  const sprintTaskIds = new Set(sprints.flatMap((sprint) => (sprint.tasks ?? []).map((item) => item.task.id)));
  const availableTasks = tasks.filter((task) => !sprintTaskIds.has(task.id));

  const invalidateSprints = async () => {
    await queryClient.invalidateQueries({ queryKey: ["nexus", "sprints", project.id] });
    await queryClient.invalidateQueries({ queryKey: ["nexus", "project", project.id] });
  };

  const createSprint = useMutation({
    mutationFn: () => nexusApi.createSprint({ name: name.trim(), projectId: project.id, startDate, endDate }),
    onSuccess: async (result) => {
      setName("");
      setExpandedSprintId(result.sprint.id);
      await invalidateSprints();
    },
  });

  const updateSprint = useMutation({
    mutationFn: (payload: { id: string; status?: string; addTaskId?: string; removeTaskId?: string; moveIncompleteTo?: string }) => nexusApi.updateSprint(payload),
    onSuccess: async (result, variables) => {
      setAddingToSprintId(null);
      // Completing a sprint with unfinished cards: backend asks where to move them.
      if (result?.requiresAction && result.incompleteTasks?.length) {
        setCompleting({ sprintId: variables.id, incomplete: result.incompleteTasks as NexusTask[] });
        return;
      }
      setCompleting(null);
      await invalidateSprints();
    },
  });

  const activeSprint = sprints.find((sprint) => sprint.status === "ACTIVE");
  const plannedSprints = sprints.filter((sprint) => sprint.status === "PLANNING").length;
  const completedSprints = sprints.filter((sprint) => sprint.status === "COMPLETED").length;
  const createError = createSprint.error instanceof Error ? createSprint.error.message : "Failed to create sprint.";
  const updateError = updateSprint.error instanceof Error ? updateSprint.error.message : "Failed to update sprint.";

  return (
    <div className="p-4 md:p-8 space-y-5">
      <section className="rounded-[28px] border border-border bg-card p-5 shadow-soft overflow-hidden relative">
        <div className="absolute -right-12 -top-14 h-36 w-36 rounded-full bg-primary/10" />
        <div className="relative grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary"><Target className="h-3.5 w-3.5" /> Sprint Arena</div>
            <h2 className="mt-3 text-2xl font-black tracking-tight">Run the mission in cycles.</h2>
            <p className="mt-1 text-sm text-muted-foreground">Live from `/api/sprints`: create cycles, start/complete them, and attach cards from this board.</p>
            <div className="mt-4 grid grid-cols-3 gap-2 max-w-xl">
              <SprintMetric label="Active" value={activeSprint ? "1" : "0"} />
              <SprintMetric label="Planning" value={String(plannedSprints)} />
              <SprintMetric label="Shipped" value={String(completedSprints)} />
            </div>
          </div>
          <div className="rounded-[24px] border border-border bg-background/80 p-4">
            <div className="text-sm font-black">Create sprint</div>
            <div className="mt-3 space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint name, e.g. Launch Week 01" className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-muted-foreground">Start<input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
                <label className="text-[11px] font-bold text-muted-foreground">End<input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date" className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
              </div>
              {createSprint.isError && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{createError}</p>}
              <button disabled={!name.trim() || !startDate || !endDate || createSprint.isPending} onClick={() => createSprint.mutate()} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {createSprint.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create sprint
              </button>
            </div>
          </div>
        </div>
      </section>

      {sprintsQuery.isLoading && <Card><CardBody className="p-6 text-sm text-muted-foreground">Loading sprint cycles...</CardBody></Card>}
      {sprintsQuery.isError && <Empty title="Sprint arena locked" message="Login/session atau project access dibutuhkan untuk ambil /api/sprints." />}
      {updateSprint.isError && <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{updateError}</p>}
      {!sprintsQuery.isLoading && !sprintsQuery.isError && sprints.length === 0 && <Empty title="No sprint cycles yet" message="Create a sprint to group this mission into a focused execution window." />}

      {!sprintsQuery.isLoading && !sprintsQuery.isError && sprints.length > 0 && (
        <div className="space-y-3">
          {sprints.map((sprint) => {
            const sprintTasks = (sprint.tasks ?? []).map((item) => item.task);
            const doneCount = sprintTasks.filter((task) => isDone(task.status)).length;
            const progress = sprintTasks.length ? Math.round((doneCount / sprintTasks.length) * 100) : 0;
            const nextStatus = sprint.status === "PLANNING" ? "ACTIVE" : sprint.status === "ACTIVE" ? "COMPLETED" : null;
            const expanded = expandedSprintId === sprint.id;
            return (
              <Card key={sprint.id} className="border border-border shadow-soft">
                <CardBody className="p-0">
                  <button onClick={() => setExpandedSprintId(expanded ? null : sprint.id)} className="grid w-full gap-3 p-4 text-left hover:bg-accent/30 md:grid-cols-[1.2fr_0.7fr_0.7fr_auto] md:items-center">
                    <div>
                      <div className="flex items-center gap-2"><span className="font-black">{sprint.name}</span><SprintStatusChip status={sprint.status} /></div>
                      <div className="mt-1 text-xs text-muted-foreground">{fmtDate(sprint.startDate)} → {fmtDate(sprint.endDate)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{doneCount}/{sprintTasks.length} cards slayed</div>
                    <div><ProgressBar value={progress} /><div className="mt-1 text-[11px] text-muted-foreground">{progress}% sprint energy</div></div>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition ${expanded ? "rotate-90" : ""}`} />
                  </button>

                  {expanded && (
                    <div className="border-t border-border p-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {nextStatus && <button disabled={updateSprint.isPending} onClick={() => updateSprint.mutate({ id: sprint.id, status: nextStatus })} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-accent disabled:opacity-50">{nextStatus === "ACTIVE" ? <Play className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{nextStatus === "ACTIVE" ? "Start sprint" : "Complete sprint"}</button>}
                        <button disabled={!availableTasks.length || updateSprint.isPending} onClick={() => setAddingToSprintId(addingToSprintId === sprint.id ? null : sprint.id)} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-accent disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add card</button>
                        <span className="text-xs text-muted-foreground">{availableTasks.length} board cards available</span>
                      </div>

                      {addingToSprintId === sprint.id && (
                        <select defaultValue="" onChange={(e) => e.target.value && updateSprint.mutate({ id: sprint.id, addTaskId: e.target.value })} className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm">
                          <option value="">Pick a board card...</option>
                          {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                        </select>
                      )}

                      {sprintTasks.length ? (
                        <div className="grid gap-2">
                          {sprintTasks.map((task) => {
                            const fullTask = tasks.find((candidate) => candidate.id === task.id) ?? task as NexusTask;
                            return (
                              <div key={task.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-3 py-2 hover:border-primary/40">
                                <button onClick={() => onOpenTask(fullTask)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{task.title}</button>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Chip size="sm" variant="soft">{statusLabel(task.status)}</Chip>
                                  <PriorityChip priority={task.priority} />
                                  <button title="Remove from sprint" disabled={updateSprint.isPending} onClick={() => updateSprint.mutate({ id: sprint.id, removeTaskId: task.id })} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No cards in this sprint yet — add one from the board backlog.</div>}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {completing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setCompleting(null)}>
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold tracking-tight">{completing.incomplete.length} card{completing.incomplete.length === 1 ? "" : "s"} not done</h3>
            <p className="mt-1 text-sm text-muted-foreground">Pindahkan card yang belum selesai ke sprint lain, atau lepas ke backlog saat menutup sprint ini.</p>
            <div className="mt-4 space-y-2">
              {sprints.filter((s) => s.id !== completing.sprintId && s.status !== "COMPLETED").map((s) => (
                <button key={s.id} disabled={updateSprint.isPending} onClick={() => updateSprint.mutate({ id: completing.sprintId, status: "COMPLETED", moveIncompleteTo: s.id })} className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-accent active:scale-[0.98] disabled:opacity-50">
                  <span>Move to “{s.name}”</span><SprintStatusChip status={s.status} />
                </button>
              ))}
              <button disabled={updateSprint.isPending} onClick={() => updateSprint.mutate({ id: completing.sprintId, status: "COMPLETED", moveIncompleteTo: "backlog" })} className="w-full rounded-xl border border-border px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">Move to backlog & complete</button>
              <button onClick={() => setCompleting(null)} className="w-full rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SprintMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-background/80 p-3"><div className="text-xl font-black">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}

function SprintStatusChip({ status }: { status?: string | null }) {
  const s = (status || "PLANNING").toUpperCase();
  const color = s === "ACTIVE" ? "success" : s === "COMPLETED" ? "default" : "warning";
  return <Chip size="sm" variant="soft" color={color}>{statusLabel(s)}</Chip>;
}

function ProjectChat({ projectId }: { projectId: string }) {
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const convos = useQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), retry: false });
  const room = (convos.data?.conversations ?? []).find((c) => c.type === "PROJECT" && c.projectId === projectId);
  return (
    <div className="p-4 md:p-8">
      <div className="mx-auto h-[70vh] max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {convos.isLoading && <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!convos.isLoading && !room && <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground"><div><MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-40" />Project chat room belum aktif (perlu backend Messages).</div></div>}
        {room && <ChatThread conversationId={room.id} meId={me.data?.user?.id} />}
      </div>
    </div>
  );
}

function ComingSoon({ title, message }: { title: string; message: string }) {
  return <div className="p-8"><Empty title={title} message={message} /></div>;
}

function Empty({ title, message }: { title: string; message: string }) {
  return <Card className="border border-dashed border-border bg-card shadow-soft"><CardBody className="p-8 text-center"><div className="text-lg font-black">{title}</div><p className="mt-2 text-sm text-muted-foreground">{message}</p></CardBody></Card>;
}

function PriorityChip({ priority }: { priority?: string | null }) {
  const p = (priority || "NONE").toUpperCase();
  const color = p === "URGENT" || p === "HIGH" ? "danger" : p === "MEDIUM" ? "warning" : "success";
  return <Chip size="sm" variant="soft" color={color}>{statusLabel(priority || "Normal")}</Chip>;
}




function filterTaskLists(taskLists: NonNullable<NexusProject["taskLists"]>, filters: BoardFilters) {
  return taskLists.map((list) => ({
    ...list,
    // Section filter = the board column itself (TaskList), so it's matched here where we know the list.
    tasks: filters.section !== "ALL" && list.id !== filters.section
      ? []
      : (list.tasks ?? []).filter((task) => taskMatchesFilters(task, filters)),
  }));
}

function taskMatchesFilters(task: NexusTask, filters: BoardFilters) {
  const q = filters.query.trim().toLowerCase();
  const status = (task.status || "TODO").toUpperCase();
  const priority = (task.priority || "NONE").toUpperCase();
  if (filters.hideDone && isDone(status)) return false;
  if (filters.priority !== "ALL" && priority !== filters.priority) return false;
  if (filters.assigneeId !== "ALL") {
    const ids = (task.assignees ?? []).map((a) => a.user?.id).filter(Boolean) as string[];
    if (filters.assigneeId === "NONE" ? ids.length > 0 : !ids.includes(filters.assigneeId)) return false;
  }
  // Custom-field filters: a task must match at least one selected value in EVERY field that has selections.
  for (const [fieldId, selected] of Object.entries(filters.cfSelections)) {
    if (!selected.length) continue;
    const vals = (task.customFieldValues ?? []).filter((c) => c.customFieldId === fieldId).map((c) => String(c.value ?? "")).filter(Boolean);
    if (!selected.some((v) => vals.includes(v))) return false;
  }
  if (!q) return true;
  const assignees = (task.assignees ?? []).map((a) => a.user?.name || a.user?.email || "").join(" ");
  const haystack = [task.title, blockText(task.description), task.taskList?.name, priority, status, ...(task.tags ?? []), assignees].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function plainTextToTipTap(value: string) {
  const paragraphs = value.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [""]).map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// LOCAL date key (NOT toISOString, which is UTC). The calendar's day cells are local Date objects, so a
// UTC key shifts tasks by a day in +ve timezones (e.g. WIB: local midnight = previous-day 17:00Z) — that
// was the "due Jun 3 shows on Jun 4" bug.
function localDateKey(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toDateInput(value?: string | null) {
  const d = parseDate(value);
  return d ? localDateKey(d) : "";
}

function dayKey(value: Date) {
  return localDateKey(value);
}

function isDone(status?: string | null) {
  return ["DONE", "COMPLETED", "COMPLETE"].includes((status || "").toUpperCase());
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
