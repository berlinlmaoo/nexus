import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent as CardBody, Chip } from "@heroui/react";
import { motion } from "framer-motion";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { ProjectMark } from "@/components/projects/ProjectIcon";
import { Avatar, AvatarStack } from "@/components/Avatar";
import { celebrate } from "@/components/Celebration";
import { fmtDate, nexusApi, statusLabel, type CreateTaskPayload, type NexusCustomField, type NexusDoc, type NexusProject, type NexusProjectView, type NexusTask, type NexusTaskStatus } from "@/lib/nexus-api";
import { TaskBulkProvider, useTaskBulk } from "@/components/tasks/task-bulk";
import { GideonMark } from "@/components/gideon/GideonMark";
import { openGideon } from "@/lib/gideon";
import { pushGideonPage } from "@/lib/gideon-ai";
import type { OutletView } from "@/components/outlet-sales/OutletSalesView";
import { hiddenTabsOf, projectSettingsErrorText, TUNE_MORPH_ID } from "@/components/projects/project-tabs";
import type { OverviewDrill } from "@/components/projects/ProjectOverview";
import { useProjectViews } from "@/components/projects/views/use-project-views";
import { FilterButton, FilterChips, GroupButton, SortButton, ToolbarButton, sortSummary, usePropLabel } from "@/components/projects/views/view-controls";
import { AddViewButton, LAYOUT_ICON, ViewSettingsPanel } from "@/components/projects/views/view-settings";
import { Incremental } from "@/components/projects/views/incremental";
import { holdProject, insertDraftTask, patchTaskInCaches, settleTaskWrite } from "@/lib/task-cache";
import { plainPreview } from "@/lib/plain-preview";
import { AddTaskSplit, ToolbarSearch, ViewTabsBar, type ToolbarTab } from "@/components/projects/views/view-toolbar";
import { cardTint, GalleryView, GroupHeader, PropLine } from "@/components/projects/views/view-layouts";
import { InlineTaskDraft } from "@/components/projects/views/inline-draft";
import { optionColorKey, StatusOptionMenu, StatusPicker } from "@/components/tasks/StatusPicker";
import { defaultOption, orderedOptions, statusForNewOption, statusGroupOf, STATUS_GROUPS, usesStatusOptions, type StatusGroupKey } from "@/lib/status-options";
import {
  activeFilterCount,
  BUILTIN_KEYS,
  COLOR_PRESETS,
  decodeFilter,
  decodeSort,
  EMPTY_GROUP,
  encodeFilter,
  encodeSort,
  filterFromDrill,
  groupCalcValue,
  groupLabelIsBuiltin,
  optionColor,
  groupTasks,
  isBuiltinTab,
  newId,
  propDef,
  propDefs,
  resolveConfig,
  sameFilter,
  sameSort,
  sortTasks,
  taskColor,
  taskMatches,
  taskValues,
  viewName,
  visibleProps,
  type PropDef,
  type SortRule,
  type TaskGroup,
  type ViewConfig,
  type ViewCtx,
  type ViewFilter,
  type ViewLayout,
} from "@/lib/project-views";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { priorityTone } from "@/lib/calendar/tone";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Activity,
  Calendar as CalIcon,
  Check,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CornerDownRight,
  FileText,
  Filter,
  FormInput,
  GanttChart,
  GripVertical,
  LayoutGrid,
  Loader2,
  Lock,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
  Sparkles,
  Sheet as SheetIcon,
} from "lucide-react";

// Heavy tabs and dialogs load when first used, not with every project (perf pass, 12 Oct 2026). The task popup
// and the composer are fetched in the background once the board is up (preloadProjectExtras), so opening a
// card never waits for code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function named<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const loadTaskPanel = () => import("@/components/tasks/TaskDetailPanel");
const loadComposer = () => import("@/components/tasks/TaskComposer");
const TaskDetailPanel = named(loadTaskPanel, "TaskDetailPanel");
const TaskComposer = named(loadComposer, "TaskComposer");
const ProjectSettingsDrawer = named(() => import("@/components/projects/ProjectSettingsDrawer"), "ProjectSettingsDrawer");
const AddProjectMembersDialog = named(() => import("@/components/projects/AddProjectMembersDialog"), "AddProjectMembersDialog");
const AutomationsView = named(() => import("@/components/automations/AutomationsView"), "AutomationsView");
const GideonProjectCard = named(() => import("@/components/gideon/GideonProjectCard"), "GideonProjectCard");
const AutofillPanel = named(() => import("@/components/gideon/AutofillPanel"), "AutofillPanel");
const ChatThread = named(() => import("@/components/messages/ChatThread"), "ChatThread");
const ProjectFormsView = named(() => import("@/components/forms/form-kit"), "ProjectFormsView");
const ProjectSheetView = named(() => import("@/components/sheets/ProjectSheetView"), "ProjectSheetView");
const PipelineView = named(() => import("@/components/pipeline/PipelineView"), "PipelineView");
const OutletSalesView = named(() => import("@/components/outlet-sales/OutletSalesView"), "OutletSalesView");
const loadTable = () => import("@/components/projects/ProjectTableView");
const ProjectTableView = named(loadTable, "ProjectTableView");
const ProjectOverview = named(() => import("@/components/projects/ProjectOverview"), "ProjectOverview");
let extrasPreloaded = false;
/** The popup's and composer's code (and the block editor behind them), fetched while the browser is idle. */
function preloadProjectExtras() {
  if (extrasPreloaded || typeof window === "undefined") return;
  extrasPreloaded = true;
  const go = () => { void loadTaskPanel().then((m) => m.preloadTaskBody()); void loadComposer(); void loadTable(); };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(go, { timeout: 2500 }); else setTimeout(go, 1200);
}

/** A lazy piece's placeholder: the same box the skeletons use, so nothing jumps when it arrives. */
function Pending({ children, rows = 3 }: { children: ReactNode; rows?: number }) {
  return <Suspense fallback={<div className="space-y-2 px-4 py-6 md:px-8" aria-busy>{Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>}>{children}</Suspense>;
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectDetail,
  // Start the project's data with the navigation — and on hover/focus of any link to it (router preload
  // "intent") — instead of after the page's code has loaded and rendered (perf pass, 12 Oct 2026). Not
  // awaited: the page renders at once and the queries below pick these requests up in flight.
  loader: ({ context, params }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery({ queryKey: ["nexus", "project", params.projectId], queryFn: () => nexusApi.project(params.projectId), staleTime: 30_000, retry: false });
    void qc.prefetchQuery({ queryKey: ["nexus", "project-views", params.projectId], queryFn: () => nexusApi.projectViews(params.projectId), staleTime: 30_000, retry: false });
    void qc.prefetchQuery({ queryKey: ["nexus", "project-calendar-tasks", params.projectId, "subtasks"], queryFn: () => nexusApi.tasks(`projectId=${params.projectId}&subtasksOnly=1`), staleTime: 30_000, retry: false });
  },
  // `?settings=1` opens Project settings (the project tree's "Project settings" menu item, 10 Oct 2026).
  // An Outlet Sales Dashboard (10 Oct 2026): `?view=overview|calendar|board|form`, `&date=YYYY-MM-DD`,
  // `&event=<id>` — the shared form link opens the report form, on one event when it names one.
  // Saved views (owner, 12 Oct 2026): `?v=` the open tab — a view id, a built-in view's key ("board", …)
  // or one of the project's other tabs ("overview", "sheet", "automations", "pages", "forms", "chat");
  // `&q=` the search box; `&f=` / `&s=` the filter / sort on screen while it differs from the saved view
  // (lib/project-views.ts encodes them). A reload or a shared link keeps all of it.
  validateSearch: (s: Record<string, unknown>): { settings?: 1; view?: OutletView; date?: string; event?: string; v?: string; q?: string; f?: Record<string, unknown>; s?: string } => ({
    settings: s.settings === 1 || s.settings === "1" ? 1 : undefined,
    view: s.view === "overview" || s.view === "calendar" || s.view === "board" || s.view === "form" ? s.view : undefined,
    date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
    event: typeof s.event === "string" && s.event.length <= 64 ? s.event : undefined,
    v: searchString(s.v, 64),
    q: searchString(s.q, 200),
    // Kept as an OBJECT: the router JSON-encodes search values itself, so a string here was encoded twice
    // (f="{\"simple\"…}") as soon as another param changed. Old double-encoded links still open.
    f: searchObject(s.f, 8000),
    s: searchString(s.s, 400),
  }),
});

/** The filter draft (`f`): an object, or a JSON object written as text (links from before 12 Oct 2026). */
function searchObject(v: unknown, max: number): Record<string, unknown> | undefined {
  let o = v;
  for (let i = 0; i < 2 && typeof o === "string"; i++) {
    if (o.length > max) return undefined;
    try { o = JSON.parse(o); } catch { return undefined; }
  }
  return o && typeof o === "object" && !Array.isArray(o) && JSON.stringify(o).length <= max ? (o as Record<string, unknown>) : undefined;
}

/** The router JSON-parses search values ("123" → 123), so a text param can arrive as a number. */
function searchString(v: unknown, max: number): string | undefined {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

type ViewId = "pipeline" | "os-overview" | "os-calendar" | "os-board" | "os-form" | "chat";
type ModuleKey = "overview" | "sheet" | "automations" | "pages" | "forms" | "chat";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;

// Pipeline and Outlet Sales projects keep their own fixed tabs.
const SPECIAL_TABS: { id: ViewId; label: string; icon: typeof LayoutGrid }[] = [
  // A Pipeline Dashboard project's main view (owner, 9 Oct 2026); task projects never show it.
  { id: "pipeline", label: "Pipeline", icon: Filter },
  // An Outlet Sales Dashboard project's views (owner, 10 Oct 2026, for Ryan); one OutletSalesView behind them.
  { id: "os-overview", label: "Overview", icon: Activity },
  { id: "os-calendar", label: "Calendar", icon: CalIcon },
  { id: "os-board", label: "Board", icon: LayoutGrid },
  { id: "os-form", label: "Report form", icon: ClipboardList },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

// A task project's tabs that are not views of its tasks (owner, 12 Oct 2026). Overview sits before the
// views, the rest after them. Automations is a toolbar button rather than a tab.
const MODULE_TABS: { id: ModuleKey; label: string; icon: typeof LayoutGrid; before?: boolean }[] = [
  { id: "overview", label: "Overview", icon: Activity, before: true },
  { id: "sheet", label: "Spreadsheet", icon: SheetIcon },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "forms", label: "Forms", icon: FormInput },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

/** The five built-in views as a client-side stand-in, read-only, while the views API is unreachable. */
function fallbackViews(): NexusProjectView[] {
  const now = new Date().toISOString();
  return BUILTIN_KEYS.map((key, i) => ({ id: `fallback:${key}`, name: null, layout: key, builtin: key, position: i, shared: true, ownerId: null, createdById: null, config: {}, createdAt: now, updatedAt: now }));
}

/** A task with its section attached, memoised per task object (see allTasks). */
function useWithList() {
  const cache = useRef(new WeakMap<NexusTask, NexusTask>());
  return useCallback((task: NexusTask, list: { id: string; name: string }, projectId: string | undefined): NexusTask => {
    if (task.taskList) return task;
    const hit = cache.current.get(task);
    if (hit && hit.taskList?.id === list.id && hit.taskList?.name === list.name) return hit;
    const next = { ...task, taskList: { id: list.id, name: list.name, projectId } };
    cache.current.set(task, next);
    return next;
  }, []);
}

/** Collapsed groups are per person and per view (this browser), like Notion. */
function useCollapsedGroups(viewId: string | null) {
  const storageKey = viewId ? `nexus:view-collapsed:${viewId}` : null;
  const read = (): string[] => {
    if (!storageKey || typeof window === "undefined") return [];
    try { const v = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
  };
  const [state, setState] = useState<{ key: string | null; list: string[] }>(() => ({ key: storageKey, list: read() }));
  const list = state.key === storageKey ? state.list : read();
  const set = useMemo(() => new Set(list), [list]);
  const toggle = (k: string) => {
    const next = set.has(k) ? list.filter((x) => x !== k) : [...list, k];
    setState({ key: storageKey, list: next });
    if (storageKey) try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return { collapsed: set, toggle };
}

// The Calendar's colour rules used to live in this browser's localStorage (frozen frontend feature).
// They move into the Calendar view the first time someone who may edit it opens it.
const LEGACY_CAL_COLORS: Record<string, string> = { "#dbeafe": "sky", "#dcfce7": "emerald", "#fef3c7": "amber", "#ffe4e6": "rose", "#ede9fe": "violet", "#e2e8f0": "gray" };
function legacyCalendarRules(projectId: string) {
  try {
    const raw = window.localStorage.getItem(`nexus:calendar-color-rules:${projectId}`);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .map((r: { source?: string; customFieldId?: string; value?: string; color?: string }) => {
        const prop = r.source === "task_list" ? "section" : r.source === "custom_field" ? (r.customFieldId ? `cf:${r.customFieldId}` : "") : r.source ?? "";
        const color = LEGACY_CAL_COLORS[r.color ?? ""];
        return prop && r.value && color ? { id: newId(), prop, value: r.value, color } : null;
      })
      .filter(Boolean) as Array<{ id: string; prop: string; value: string; color: string }>;
  } catch {
    return [];
  }
}

function ProjectDetail() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [specialView, setSpecialView] = useState<ViewId>("pipeline");
  const [openTask, setOpenTask] = useState<NexusTask | null>(null);
  const [composerListId, setComposerListId] = useState<string | null>(null);
  const [composerDueDate, setComposerDueDate] = useState<string>("");
  const [chipsHidden, setChipsHidden] = useState(false);
  // Phone: the view tools (filter/sort/group/search/view settings/automations/autofill) sit behind ⋯ so the
  // header is one title row + one tabs row (audit 12 Oct 2026). Desktop always shows them.
  const [toolsOpen, setToolsOpen] = useState(false);
  const project = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), retry: false });
  const data = project.data;
  // GIDEON opened here carries this project as context (Notion AI's page chip).
  useEffect(() => (data ? pushGideonPage({ kind: "project", id: data.id, title: data.name, projectId: data.id, projectName: data.name }) : undefined), [data?.id, data?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const search = Route.useSearch();
  const { t: tr } = useLang();
  const setSearch = (patch: Partial<typeof search>, replace = true) =>
    navigate({ to: "/projects/$projectId", params: { projectId }, search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never, replace });
  useEffect(() => {
    if (search.settings !== 1 || !data) return;
    setSettingsOpen(true);
    setSearch({ settings: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.settings, data]);
  // Which tabs this project shows (owner, 9 Oct 2026): a project hides the ones it doesn't need
  // (Project settings → Tabs). Hiding only hides — nothing in the tab is touched. Since 12 Oct 2026 the
  // Board / List / Table / Calendar / Timeline keys hide the matching built-in VIEW (same keys, so the
  // released apps and the web agree).
  const hiddenTabs = hiddenTabsOf(data);
  const isPipeline = data?.type === "PIPELINE";
  const isOutlet = data?.type === "OUTLET_SALES";
  const isSpecial = isPipeline || isOutlet;
  const specialTabs = SPECIAL_TABS.filter((tab) => (tab.id === "pipeline" ? isPipeline : tab.id.startsWith("os-") ? isOutlet : true));
  useEffect(() => {
    if (!data || !isSpecial) return;
    if (!specialTabs.some((tab) => tab.id === specialView)) setSpecialView(specialTabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, isSpecial]);
  // A link into an Outlet Sales Dashboard (?view=…&date=…&event=…): open that view once the project is
  // known, hand the day / event to the view (remounted by `nonce`), then drop the query from the address.
  const [outletLink, setOutletLink] = useState<{ date?: string; eventId?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => {
    if (!data || (!search.view && !search.date && !search.event)) return;
    if (data.type === "OUTLET_SALES") {
      setOutletLink((cur) => ({ date: search.date, eventId: search.event, nonce: cur.nonce + 1 }));
      setSpecialView(`os-${search.view ?? (search.event ? "form" : "calendar")}` as ViewId);
    }
    setSearch({ view: undefined, date: undefined, event: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.view, search.date, search.event, data]);
  const rootQc = useQueryClient();
  const taskLists = data?.taskLists ?? [];
  // React Query keeps unchanged tasks as the same objects across refetches (structural sharing); `withList`
  // keeps that identity through this mapping too, so a refetch after one task changed re-renders one card.
  const withList = useWithList();
  const allTasks = useMemo(() => taskLists.flatMap((list) => (list.tasks ?? []).map((task) => withList(task, list, data?.id))), [taskLists, data?.id, withList]);
  // Board + List show subtasks as their own cards/rows (placed in their section, right under their parent).
  // The project payload is parentId-only, so pull the project's full task set and merge subtasks into each
  // lane. Same query key as before → React Query dedupes to one fetch.
  // Only the subtasks (perf pass, 12 Oct 2026): the project payload has every top-level task already, and
  // fetching the whole set again doubled the page's data. Under the same key prefix, so every invalidation of
  // ["nexus","project-calendar-tasks",id] still covers it. A server without `subtasksOnly` returns all tasks;
  // the merge below only takes the ones with a parent either way.
  const allProjTasks = useQuery({ queryKey: ["nexus", "project-calendar-tasks", projectId, "subtasks"], queryFn: () => nexusApi.tasks(`projectId=${projectId}&subtasksOnly=1`), staleTime: 30_000, retry: false, enabled: !!data && !isSpecial });
  const withSubtasks = useMemo(() => {
    const subs = (allProjTasks.data ?? []).filter((t) => t.parentId && t.taskListId);
    if (subs.length === 0) return allTasks;
    const parentTitle = new Map<string, string>();
    for (const t of allTasks) parentTitle.set(t.id, t.title);
    for (const t of allProjTasks.data ?? []) parentTitle.set(t.id, t.title); // subtasks too → resolves any depth
    const subsByList = new Map<string, NexusTask[]>();
    for (const s of subs) {
      const list = taskLists.find((l) => l.id === s.taskListId);
      const withParent = { ...s, parent: s.parentId ? { id: s.parentId, title: parentTitle.get(s.parentId) ?? "" } : s.parent, taskList: s.taskList ?? { id: s.taskListId!, name: list?.name, projectId: data?.id } };
      const arr = subsByList.get(s.taskListId!) ?? []; arr.push(withParent); subsByList.set(s.taskListId!, arr);
    }
    const out: NexusTask[] = [];
    for (const list of taskLists) {
      const parents = (list.tasks ?? []).map((task) => withList(task, list, data?.id));
      const here = subsByList.get(list.id) ?? [];
      const pidSet = new Set(parents.map((t) => t.id));
      for (const p of parents) { out.push(p); for (const s of here) if (s.parentId === p.id) out.push(s); }
      // Parent in another section (or none): at the section's end.
      for (const s of here) if (!s.parentId || !pidSet.has(s.parentId)) out.push(s);
    }
    return out;
  }, [allTasks, allProjTasks.data, taskLists, data?.id, withList]);

  // ── saved views (owner, 12 Oct 2026) ──
  const pv = useProjectViews(projectId, !!data && !isSpecial);
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1, staleTime: 300_000 });
  const meId = me.data?.user?.id ?? null;
  const cfDefs = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), staleTime: 60_000, retry: false, enabled: !!data && !isSpecial });
  // Built from a template (owner, 12 Oct 2026): which tab it opens on. Its Calendar date field and its
  // "My …" preset became real views when the views were first made (server: lib/project-views.ts).
  const templates = useQuery({ queryKey: ["nexus", "project-templates"], queryFn: () => nexusApi.projectTemplates(), staleTime: 5 * 60_000, retry: 1, enabled: !!data?.templateId });
  const template = data?.templateId ? templates.data?.templates.find((tp) => tp.id === data.templateId) ?? null : null;
  const viewsList = useMemo(() => (pv.query.isError ? fallbackViews() : pv.views), [pv.query.isError, pv.views]);
  const visibleViews = viewsList.filter((v) => !(isBuiltinTab(v) && hiddenTabs.has(v.builtin!)));
  const moduleTabs = MODULE_TABS.filter((m) => !hiddenTabs.has(m.id));
  let activeModule: ModuleKey | null = null;
  let activeView: NexusProjectView | null = null;
  if (search.v === "automations") activeModule = "automations";
  else if (search.v && moduleTabs.some((m) => m.id === search.v)) activeModule = search.v as ModuleKey;
  else activeView = visibleViews.find((v) => v.id === search.v) ?? visibleViews.find((v) => v.builtin === search.v) ?? null;
  // A project built from a template opens on the template's tab (lib/project-templates.ts defaultTab).
  if (!activeModule && !activeView && !search.v && template?.defaultTab) {
    if (moduleTabs.some((m) => m.id === template.defaultTab)) activeModule = template.defaultTab as ModuleKey;
    else activeView = visibleViews.find((v) => v.builtin === template.defaultTab) ?? null;
  }
  if (!activeModule && !activeView) activeView = visibleViews[0] ?? null;
  const canEditView = (v: NexusProjectView) => !v.id.startsWith("fallback:") && (v.shared ? pv.canEditShared : true);
  const canEdit = activeView ? canEditView(activeView) : false;
  const select = (key: string) => {
    setViewSettingsOpen(false);
    navigate({ to: "/projects/$projectId", params: { projectId }, search: { v: key } });
  };

  const saved = useMemo(() => (activeView ? resolveConfig(activeView) : null), [activeView]);
  const draftFilter = decodeFilter(search.f);
  const fKey = search.f ? JSON.stringify(search.f) : "";
  const draftSort = decodeSort(search.s);
  // Memoised so the board's cards (memo) only re-render when the view really changed (perf pass, 12 Oct 2026).
  const cfg: ViewConfig | null = useMemo(
    () => (saved ? { ...saved, filter: draftFilter ?? saved.filter, sort: draftSort ?? saved.sort } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, fKey, search.s],
  );
  const dirty = !!saved && ((!!draftFilter && !sameFilter(draftFilter, saved.filter)) || (!!draftSort && !sameSort(draftSort, saved.sort)));
  const query = search.q ?? "";
  // The router JSON-encodes search values itself: hand it the object so the address carries plain JSON.
  const setFilter = (f: ViewFilter) => { if (saved) setSearch({ f: sameFilter(f, saved.filter) ? undefined : (JSON.parse(encodeFilter(f)) as never) }); };
  const setSort = (s: SortRule[]) => { if (saved) setSearch({ s: sameSort(s, saved.sort) ? undefined : encodeSort(s) }); };
  const saveDraft = () => {
    if (!activeView || !cfg || !canEdit) return;
    pv.update.mutate({ id: activeView.id, patch: { filter: cfg.filter, sort: cfg.sort } });
    setSearch({ f: undefined, s: undefined });
  };
  // A personal view saves its filter and sort by itself, a moment after the last change.
  useEffect(() => {
    if (!dirty || !activeView || activeView.shared || !canEdit) return;
    const timer = setTimeout(saveDraft, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, activeView?.id, activeView?.shared, fKey, search.s]);
  const patchConfig = (p: Partial<ViewConfig>) => {
    if (!activeView) return;
    if (!canEdit) { toast(tr("Only project members can change a shared view. Make a personal copy to set it up your way.")); return; }
    pv.update.mutate({ id: activeView.id, patch: p as Record<string, unknown> });
  };
  // Old calendar colour rules (this browser's localStorage) move into the Calendar view once.
  useEffect(() => {
    if (!activeView || activeView.builtin !== "calendar" || !canEdit || (activeView.config as { colorRules?: unknown }).colorRules) return;
    const rules = legacyCalendarRules(projectId);
    if (!rules.length) return;
    pv.update.mutate({ id: activeView.id, patch: { colorRules: rules } });
    try { window.localStorage.removeItem(`nexus:calendar-color-rules:${projectId}`); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView?.id, canEdit]);

  const people = useMemo(() => (data?.members ?? []).map((m) => ({ id: (m.userId || m.user?.id) ?? "", name: m.user?.name ?? m.user?.email ?? "" })).filter((p) => p.id), [data?.members]);
  // Only the sections' own fields count: a refetch that changed a task (and so the taskLists array) keeps ctx,
  // and with it every memoised card.
  const sectionsSig = taskLists.map((l) => `${l.id}|${l.name}|${l.position}|${l.taskStatus ?? ""}|${l.color ?? ""}`).join(";");
  const ctx: ViewCtx = useMemo(() => ({
    sections: taskLists.map((l) => ({ id: l.id, name: l.name, position: l.position, taskStatus: l.taskStatus ?? null, color: l.color ?? null })),
    fields: cfDefs.data?.fields ?? [],
    people,
    meId,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sectionsSig, cfDefs.data, people, meId]);
  const defs = useMemo(() => propDefs(ctx), [ctx]);
  const layout = activeView?.layout ?? "board";
  const base = cfg && (cfg.showSubtasks || layout === "calendar") ? withSubtasks : allTasks;
  const shown = useMemo(
    () => (cfg ? sortTasks(base.filter((task) => taskMatches(task, cfg.filter, query, defs, ctx)), cfg.sort, defs, ctx) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, fKey, search.s, saved, query, defs, ctx],
  );
  const buildGroups = (tasks: NexusTask[], by: string | null, opts: { keepHidden?: boolean; keepEmpty?: boolean } = {}): TaskGroup[] => {
    if (!by || !cfg) return [{ key: "__all__", label: "", tasks, empty: tasks.length === 0 }];
    let gs = groupTasks(tasks, by, defs, ctx);
    if (!opts.keepHidden) gs = gs.filter((g) => !cfg.hiddenGroups.includes(g.key));
    if (cfg.hideEmptyGroups && !opts.keepEmpty) gs = gs.filter((g) => g.tasks.length > 0);
    return gs;
  };
  const { collapsed, toggle: toggleGroup } = useCollapsedGroups(activeView?.id ?? null);
  const keys = useMemo(() => (cfg ? visibleProps(cfg, layout, defs) : []), [cfg, layout, defs]);
  // Once the project is on screen, fetch the task popup's code in the background.
  useEffect(() => { if (data) preloadProjectExtras(); }, [data]);
  const [autofillEver, setAutofillEver] = useState(false);
  useEffect(() => { if (autofillOpen) setAutofillEver(true); }, [autofillOpen]);
  const filterCount = cfg ? activeFilterCount(cfg.filter, defs) : 0;
  const hasRules = !!cfg && (cfg.filter.simple.length > 0 || !!cfg.filter.advanced);
  const showChips = !!cfg && ((hasRules && !chipsHidden) || dirty);
  const label = usePropLabel();

  const setTaskDate = useMutation({
    mutationFn: async ({ task, iso, prop }: { task: NexusTask; iso: string; prop: string }) => {
      if (prop === "due") return nexusApi.updateTask(task.id, { dueDate: iso });
      if (prop === "start") return nexusApi.updateTask(task.id, { startDate: iso } as Parameters<typeof nexusApi.updateTask>[1]);
      if (prop.startsWith("cf:")) return nexusApi.setCustomFieldValue(prop.slice(3), task.id, iso.slice(0, 10));
      throw new Error(tr("This date can't be changed by dragging."));
    },
    onSuccess: () => {
      rootQc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
      rootQc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr("Couldn't move the task")),
  });

  const createView = (p: { layout: ViewLayout; name: string; shared: boolean; config?: Record<string, unknown> }) =>
    pv.create.mutate({ layout: p.layout, name: p.name || null, shared: p.shared, config: p.config }, { onSuccess: ({ view }) => select(view.id) });
  const duplicateView = (v: NexusProjectView) => {
    const vcfg = v.id === activeView?.id && cfg ? { ...v.config, filter: cfg.filter, sort: cfg.sort } : v.config;
    createView({ layout: v.layout, name: tr("{name} (copy)", { name: viewName(v, tr) }), shared: v.shared && pv.canEditShared, config: vcfg });
  };
  const copyViewLink = (v: NexusProjectView) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("v", v.id.replace("fallback:", ""));
    void navigator.clipboard?.writeText(url.toString()).then(() => toast.success(tr("Link copied")), () => toast.error(tr("Couldn't copy the link")));
  };
  const deleteView = (v: NexusProjectView) => {
    if (!window.confirm(tr("Delete the view \"{name}\"? The tasks stay; only this way of looking at them goes. It can be restored from Control Room → Audit.", { name: viewName(v, tr) }))) return;
    setViewSettingsOpen(false);
    pv.remove.mutate(v.id);
    if (activeView?.id === v.id) navigate({ to: "/projects/$projectId", params: { projectId }, search: {} });
  };
  const hideBuiltin = useMutation({
    mutationFn: (key: string) => nexusApi.updateProject(projectId, { hiddenTabs: [...hiddenTabs, key] }),
    onSuccess: () => { rootQc.invalidateQueries({ queryKey: ["nexus", "project", projectId] }); setViewSettingsOpen(false); navigate({ to: "/projects/$projectId", params: { projectId }, search: {} }); },
    onError: (e) => toast.error(projectSettingsErrorText((e as { payload?: { code?: unknown } })?.payload?.code) ? tr(projectSettingsErrorText((e as { payload?: { code?: unknown } }).payload?.code)!) : e instanceof Error ? e.message : tr("Couldn't hide the view")),
  });
  const addTask = (sectionId?: string) => setComposerListId(sectionId ?? defaultOption(taskLists)?.id ?? null);

  // ── the one toolbar row ──
  const beforeTabs: ToolbarTab[] = moduleTabs.filter((m) => m.before).map((m) => ({ key: m.id, label: tr(m.label), icon: m.icon }));
  const viewTabs: ToolbarTab[] = visibleViews.map((v) => ({ key: v.id, label: viewName(v, tr), icon: LAYOUT_ICON[v.layout] ?? LayoutGrid, view: v }));
  const afterTabs: ToolbarTab[] = moduleTabs.filter((m) => !m.before).map((m) => ({ key: m.id, label: tr(m.label), icon: m.icon, compact: true }));
  const lastViewKey = viewTabs.length && afterTabs.length ? viewTabs[viewTabs.length - 1].key : null;
  const activeKey = activeModule ?? activeView?.id ?? null;
  const toolbar = data && !isSpecial ? (
    <div className="pb-px">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        <div className="flex min-w-0 flex-1 basis-0">
        <ViewTabsBar
          tabs={[...beforeTabs, ...viewTabs, ...afterTabs]}
          activeKey={activeKey}
          onSelect={select}
          canEditView={canEditView}
          onReorder={(order) => pv.reorder.mutate(order)}
          onRename={(v, name) => pv.update.mutate({ id: v.id, name })}
          onSettings={() => setViewSettingsOpen(true)}
          onDuplicate={duplicateView}
          onCopyLink={copyViewLink}
          onDelete={deleteView}
          onHide={(v) => isBuiltinTab(v) && hideBuiltin.mutate(v.builtin!)}
          divideAfter={lastViewKey}
          addView={<AddViewButton canShare={pv.canEditShared} busy={pv.create.isPending} onCreate={createView} />}
        />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:hidden">
          <ToolbarButton icon={MoreHorizontal} label={toolsOpen ? tr("Hide view tools") : tr("View tools")} active={toolsOpen || filterCount > 0 || activeModule === "automations"} count={!toolsOpen && filterCount > 0 ? filterCount : undefined} onClick={() => setToolsOpen((o) => !o)} />
          <button type="button" onClick={() => addTask()} aria-label={tr("Add task")} className="ml-0.5 grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"><Plus className="h-4 w-4" /></button>
        </div>
        <div className={cn("shrink-0 items-center gap-0.5 sm:ml-auto sm:flex", toolsOpen ? "flex basis-full justify-end sm:basis-auto" : "hidden")}>
          {cfg && activeView && !activeModule && (
            <>
              <FilterButton filter={cfg.filter} defs={defs} onChange={setFilter} chipsOpen={showChips} onToggleChips={() => setChipsHidden((h) => !h)} />
              <SortButton sort={cfg.sort} defs={defs} onChange={setSort} />
              {layout !== "calendar" && <GroupButton cfg={cfg} layout={layout} defs={defs} ctx={ctx} onPatch={patchConfig} readOnly={!canEdit} />}
            </>
          )}
          <ToolbarButton icon={Zap} label={tr("Automations")} active={activeModule === "automations"} onClick={() => select("automations")} />
          <ToolbarButton icon={Sparkles} label={tr("AI Autofill")} iconOnly active={autofillOpen} onClick={() => setAutofillOpen(true)} />
          {cfg && activeView && !activeModule && (
            <>
              <ToolbarSearch value={query} onChange={(q) => setSearch({ q: q || undefined })} />
              <ToolbarButton icon={SlidersHorizontal} label={tr("View settings")} iconOnly active={viewSettingsOpen} onClick={() => setViewSettingsOpen((o) => !o)} />
            </>
          )}
          <span className="ml-1.5 hidden sm:inline-flex">
            <AddTaskSplit sections={[...taskLists].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((l) => ({ id: l.id, name: l.name }))} onAdd={addTask} />
          </span>
        </div>
      </div>
      {showChips && cfg && (
        <div className="-mx-4 md:-mx-8">
          <FilterChips
            filter={cfg.filter}
            defs={defs}
            onChange={setFilter}
            dirty={dirty && !!activeView?.shared}
            canSave={canEdit}
            saving={pv.update.isPending}
            onSave={saveDraft}
            onReset={() => setSearch({ f: undefined, s: undefined })}
            sortLabel={dirty ? sortSummary(cfg.sort, defs, label) : null}
          />
        </div>
      )}
    </div>
  ) : data && isSpecial ? (
    <div className="flex items-center gap-0.5 -mb-px overflow-x-auto py-1.5">
      {specialTabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => setSpecialView(tab.id)}
          className={cn("inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors", specialView === tab.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
          <tab.icon className="h-3.5 w-3.5" /> {tr(tab.label)}
        </button>
      ))}
    </div>
  ) : undefined;

  const emptyHint = query || filterCount > 0;
  const noTasksAtAll = allTasks.length === 0;
  const emptyState = (
    <div className="px-4 py-10 md:px-8">
      <EmptyState
        icon={emptyHint ? Search : ClipboardList}
        tone="muted"
        title={emptyHint ? tr("No tasks match") : noTasksAtAll ? tr("No tasks yet") : tr("Every group is hidden")}
        message={emptyHint ? tr("Nothing in this project fits the search or filters. Clear them to see every task again.") : noTasksAtAll ? tr("Tasks you add to this project show up here. Start with the first one.") : tr("Every group of this view is hidden. Show some groups again in Group.")}
        action={emptyHint
          ? <EmptyAction onClick={() => setSearch({ q: undefined, f: cfg && saved && !sameFilter(saved.filter, { simple: [], advanced: null }) ? ({ simple: [], advanced: null } as never) : undefined })}>{tr("Clear filters")}</EmptyAction>
          : noTasksAtAll ? <EmptyAction onClick={() => addTask()}><Plus className="h-4 w-4" />{tr("Add task")}</EmptyAction> : undefined}
      />
    </div>
  );

  return (
    <div className="min-h-dvh bg-card">
      <PageHeader
        compact
        className="bg-card/95"
        icon={<span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/60 text-2xl leading-none"><ProjectMark icon={data?.icon} color={data?.color} className="max-h-9 max-w-9 rounded-lg object-cover" /></span>}
        title={data?.name || tr("Project")}
        subtitle={data?.description || (project.isLoading ? tr("Loading…") : project.isError ? tr("Couldn't open this project. You may not be a member.") : undefined)}
        actions={
          <>
            {data && <ProjectMembersAvatars project={data} />}
            {/* Ask GIDEON about this project (12 Oct 2026): opens the chat with the project as context. */}
            {/* Phone: icon-only, so title + actions fit one row (audit 12 Oct 2026). */}
            {data && <Button size="sm" variant="outline" aria-label={tr("Ask GIDEON")} className="max-sm:w-8 max-sm:min-w-8 max-sm:px-0" onClick={() => openGideon({ projectId: data.id, projectName: data.name })}><GideonMark className="h-3.5 w-3.5" /><span className="max-sm:hidden">{tr("Ask GIDEON")}</span></Button>}
            <motion.div layoutId={TUNE_MORPH_ID} style={{ borderRadius: 24 }} className="inline-block">
              <Button size="sm" variant="outline" aria-label={tr("Project settings")} className="max-sm:w-8 max-sm:min-w-8 max-sm:px-0" onPointerEnter={() => void import("@/components/projects/ProjectSettingsDrawer")} onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5" /><span className="max-sm:hidden">{tr("Project settings")}</span></Button>
            </motion.div>
          </>
        }
        tabs={toolbar}
      />

      {project.isLoading && <div className="space-y-2 px-4 py-6 md:px-8" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>}
      {project.isError && <div className="px-4 py-10 md:px-8"><EmptyState icon={Lock} tone="muted" title={tr("You can't open this project")} message={tr("You need to be signed in and be a member of this project. Ask its project lead to add you.")} /></div>}
      {!project.isLoading && !project.isError && data && isPipeline && (
        <Pending>{specialView === "chat" ? <ProjectChat projectId={data.id} />
          : <PipelineView projectId={data.id} workspaceId={data.workspaceId ?? ""} />}</Pending>
      )}
      {!project.isLoading && !project.isError && data && isOutlet && (
        <Pending>{specialView === "chat" ? <ProjectChat projectId={data.id} />
          : (
            <OutletSalesView
              key={outletLink.nonce}
              projectId={data.id}
              view={specialView.startsWith("os-") ? (specialView.slice(3) as OutletView) : "overview"}
              onView={(v) => setSpecialView(`os-${v}` as ViewId)}
              initial={outletLink.nonce ? { date: outletLink.date, eventId: outletLink.eventId } : undefined}
            />
          )}</Pending>
      )}
      {!project.isLoading && !project.isError && data && !isSpecial && (
        // Multi-select + duplicate is on in every project (owner, 11 Oct 2026 — it used to be a per-project switch).
        <TaskBulkProvider projectId={data.id}>
          {/* A view or tab switch fades in over 150 ms (none with reduced motion); the key restarts it. */}
          <div key={activeKey ?? "none"} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
          <Pending>
          {activeModule === "overview" && (
            <ProjectOverview
              project={data}
              tasks={allTasks}
              onOpenTask={setOpenTask}
              onDrill={(drill: OverviewDrill) => {
                // A count on the Overview opens the tasks behind it: open ones only, on the Board (else the List),
                // as an unsaved filter on that view (Reset brings the view back).
                const target = visibleViews.find((v) => v.builtin === "board") ?? visibleViews.find((v) => v.builtin === "list") ?? visibleViews[0];
                if (!target) return;
                navigate({ to: "/projects/$projectId", params: { projectId }, search: { v: target.id, f: JSON.parse(encodeFilter(filterFromDrill({ hideDone: true, ...drill }))) as never } });
              }}
              onEditBrief={() => setSettingsOpen(true)}
              onAddTask={() => addTask()}
            />
          )}
          {activeModule === "sheet" && (
            <ProjectSheetView
              projectId={data.id}
              onOpenTask={(taskId) => {
                const found = allProjTasks.data?.find((t) => t.id === taskId) ?? allTasks.find((t) => t.id === taskId);
                setOpenTask(found ?? ({ id: taskId, title: "" } as NexusTask));
              }}
            />
          )}
          {activeModule === "automations" && <><GideonProjectCard projectId={data.id} projectName={data.name} /><AutomationsView projectId={data.id} /></>}
          {activeModule === "pages" && <PagesView project={data} onOpen={(doc) => navigate({ to: "/docs/$docId", params: { docId: doc.id } })} />}
          {activeModule === "forms" && <ProjectFormsView projectId={data.id} />}
          {activeModule === "chat" && <ProjectChat projectId={data.id} />}
          {!activeModule && !activeView && (pv.query.isLoading
            ? <div className="space-y-2 px-4 py-6 md:px-8" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>
            : <div className="px-4 py-10 md:px-8"><EmptyState icon={LayoutGrid} tone="muted" title={tr("No views to show")} message={tr("Every view of this project is hidden. Turn Board or List back on in Project settings → Tabs, or add a view with +.")} /></div>)}
          {/* Subtask cards are placed under their parents: wait for them (they come with the project, see the
              loader) rather than drawing the board and pushing cards down when they land. */}
          {!activeModule && activeView && cfg && (cfg.showSubtasks || layout === "calendar") && allProjTasks.isLoading && (
            <div className="space-y-2 px-4 py-6 md:px-8" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>
          )}
          {!activeModule && activeView && cfg && !((cfg.showSubtasks || layout === "calendar") && allProjTasks.isLoading) && (() => {
            const groupBy = layout === "board" ? cfg.groupBy ?? "section" : layout === "calendar" ? null : cfg.groupBy;
            const groups = buildGroups(shown, groupBy);
            // An empty Board still shows its lanes (to add the first task into one), unless a filter emptied it.
            if (shown.length === 0 && layout !== "calendar" && (emptyHint || (noTasksAtAll && layout !== "board"))) return emptyState;
            if (layout !== "calendar" && shown.length > 0 && groups.length === 0) return emptyState;
            switch (layout) {
              case "board":
                return <BoardView project={data} tasks={shown} groupBy={groupBy ?? "section"} cfg={cfg} defs={defs} ctx={ctx} keys={keys} buildGroups={buildGroups} collapsed={collapsed} onToggleGroup={toggleGroup} onOpen={setOpenTask} onCreate={addTask} />;
              case "list":
                return <ListView project={data} groups={groups} groupBy={groupBy} subGroupBy={cfg.subGroupBy} buildGroups={buildGroups} cfg={cfg} defs={defs} ctx={ctx} keys={keys} collapsed={collapsed} onToggleGroup={toggleGroup} onOpen={setOpenTask} />;
              case "table":
                return <ProjectTableView project={data} groups={groups} groupBy={groupBy} subGroupBy={cfg.subGroupBy} buildGroups={buildGroups} cfg={cfg} defs={defs} columns={keys} canEditColumns={canEdit} onColumnsChange={(cols) => patchConfig({ visibleProps: cols })} collapsed={collapsed} onToggleGroup={toggleGroup} onOpen={setOpenTask} />;
              case "gallery":
                return <GalleryView projectId={data.id} groups={groups} groupBy={groupBy} cfg={cfg} keys={keys} defs={defs} ctx={ctx} collapsed={collapsed} onToggleGroup={toggleGroup} onOpen={setOpenTask} onCreate={() => addTask()} />;
              case "calendar":
                return <CalendarView tasks={shown} cfg={cfg} defs={defs} ctx={ctx} onOpen={setOpenTask} onCreate={(due) => { setComposerDueDate(due); addTask(); }} onSetDate={(task, iso) => setTaskDate.mutate({ task, iso, prop: cfg.dateProp })} canDrag={["due", "start"].includes(cfg.dateProp) || cfg.dateProp.startsWith("cf:")} />;
              case "timeline":
                return <TimelineView groups={groups} groupBy={groupBy} cfg={cfg} defs={defs} ctx={ctx} collapsed={collapsed} onToggleGroup={toggleGroup} onOpen={setOpenTask} />;
            }
          })()}
          </Pending>
          </div>
        </TaskBulkProvider>
      )}

      {viewSettingsOpen && activeView && cfg && !activeModule && (
        <ViewSettingsPanel
          view={activeView}
          cfg={cfg}
          defs={defs}
          ctx={ctx}
          canEdit={canEdit}
          canShare={pv.canEditShared}
          sort={cfg.sort}
          onSort={setSort}
          onPatch={patchConfig}
          onRename={(name) => pv.update.mutate({ id: activeView.id, name })}
          onLayout={(l) => pv.update.mutate({ id: activeView.id, layout: l })}
          onShare={(shared) => pv.update.mutate({ id: activeView.id, shared })}
          onDuplicate={() => duplicateView(activeView)}
          onDelete={() => deleteView(activeView)}
          onHide={() => isBuiltinTab(activeView) && hideBuiltin.mutate(activeView.builtin!)}
          onCopyLink={() => copyViewLink(activeView)}
          onClose={() => setViewSettingsOpen(false)}
        />
      )}
      <Suspense fallback={null}>
      {openTask && <TaskDetailPanel taskId={openTask.id} onClose={() => setOpenTask(null)} morphId={["board", "list", "calendar", "timeline", "gallery"].includes(layout) && !activeModule ? `${layout}-taskcard-${openTask.id}` : undefined} />}
      {data && autofillEver && <AutofillPanel projectId={data.id} open={autofillOpen} onOpenChange={setAutofillOpen} />}
      {settingsOpen && data && <ProjectSettingsDrawer project={data} onClose={() => setSettingsOpen(false)} onDeleted={() => { setSettingsOpen(false); navigate({ to: "/projects" }); }} />}
      {composerListId && data && <TaskComposer project={data} selectedListId={composerListId} initialDueDate={composerDueDate} onClose={() => { setComposerListId(null); setComposerDueDate(""); }} />}
      </Suspense>
    </div>
  );
}

const LANE_W: Record<ViewConfig["cardSize"], string> = { small: "w-64", medium: "w-72", large: "w-96" };

/** Which group properties a card can be dragged between (the drop writes the new value). */
function droppable(by: string, defs: PropDef[]): boolean {
  if (by === "section" || by === "status" || by === "priority" || by === "assignee" || by === "tags") return true;
  const d = propDef(defs, by);
  return !!d && !d.builtin && (d.kind === "select" || d.kind === "multi" || d.kind === "person");
}

/** Move a task from one group to another of property `by`: the write that makes it belong there. */
async function moveToGroup(task: NexusTask, by: string, from: string, to: string, defs: PropDef[], projectId: string) {
  if (from === to) return;
  const none = to === EMPTY_GROUP;
  if (by === "section") return nexusApi.updateTask(task.id, { taskListId: to, projectContextId: projectId } as Parameters<typeof nexusApi.updateTask>[1]);
  if (by === "status") return nexusApi.updateTask(task.id, { status: to });
  if (by === "priority") return nexusApi.updateTask(task.id, { priority: to });
  if (by === "assignee") {
    if (from !== EMPTY_GROUP) await nexusApi.removeAssignee(task.id, from);
    if (!none) await nexusApi.addAssignee(task.id, to);
    return;
  }
  if (by === "tags") {
    const tags = (task.tags ?? []).filter((x) => x !== from);
    return nexusApi.updateTask(task.id, { tags: none ? tags : Array.from(new Set([...tags, to])) });
  }
  const def = propDef(defs, by);
  if (!def || !by.startsWith("cf:")) return;
  const fieldId = by.slice(3);
  if (def.kind === "select") return nexusApi.setCustomFieldValue(fieldId, task.id, none ? "" : to);
  const list = taskValues(task, by).filter((x) => x !== from);
  const next = none ? list : Array.from(new Set([...list, to]));
  return nexusApi.setCustomFieldValue(fieldId, task.id, def.kind === "person" || def.kind === "multi" ? JSON.stringify(next) : next[0] ?? "");
}

/**
 * A task made inline in a group (board column, list group): in the group's section when the view groups
 * by status/section, else in the default status; then the group's (and sub-group's) value is written as
 * a drop would. The server gives it its section's status.
 */
async function createTaskInGroup({ project, defs, groupBy, groupKey, sub, subKey, title, dueDate }: {
  project: NexusProject; defs: PropDef[]; groupBy: string | null; groupKey: string | null; sub: string | null; subKey: string | null; title: string; dueDate: string | null;
}): Promise<NexusTask | null> {
  const sections = project.taskLists ?? [];
  const bySection = groupBy === "section" && groupKey && groupKey !== EMPTY_GROUP;
  const sectionId = bySection ? groupKey! : sub === "section" && subKey && subKey !== EMPTY_GROUP ? subKey : defaultOption(sections)?.id ?? sections[0]?.id;
  if (!sectionId) return null;
  const task = await nexusApi.createTask({ title, projectId: project.id, taskListId: sectionId, dueDate });
  if (groupBy && groupBy !== "section" && groupKey && groupKey !== EMPTY_GROUP && droppable(groupBy, defs)) await moveToGroup(task, groupBy, EMPTY_GROUP, groupKey, defs, project.id);
  if (sub && sub !== "section" && subKey && subKey !== EMPTY_GROUP && droppable(sub, defs)) await moveToGroup(task, sub, EMPTY_GROUP, subKey, defs, project.id);
  return task;
}

const noop = () => {};
const noDrag: CardDrag = () => {};

type GroupBuilder = (tasks: NexusTask[], by: string | null, opts?: { keepHidden?: boolean; keepEmpty?: boolean }) => TaskGroup[];

function BoardView({ project, tasks, groupBy, cfg, defs, ctx, keys, buildGroups, collapsed, onToggleGroup, onOpen, onCreate }: {
  project: NexusProject; tasks: NexusTask[]; groupBy: string; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx; keys: string[];
  buildGroups: GroupBuilder; collapsed: Set<string>; onToggleGroup: (k: string) => void; onOpen: (task: NexusTask) => void; onCreate: (listId?: string) => void;
}) {
  const qc = useQueryClient();
  const { t } = useLang();
  const [drag, setDrag] = useState<{ id: string; from: string; fromRow: string | null } | null>(null);
  const [dragLaneId, setDragLaneId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const isSection = groupBy === "section";
  const sub = cfg.subGroupBy && cfg.subGroupBy !== groupBy ? cfg.subGroupBy : null;
  const canDrop = droppable(groupBy, defs);
  const multiValued = (key: string | null) => !!key && (key === "assignee" || key === "tags" || ["multi", "person"].includes(propDef(defs, key)?.kind ?? ""));
  const singleValued = !multiValued(groupBy) && !multiValued(sub);
  const canDropRow = !!sub && droppable(sub, defs);
  const refresh = () => settleTaskWrite(qc, project.id);
  // A drop lands at once (perf pass, 12 Oct 2026): the card moves in the cache before the request, for the
  // groupings whose value maps onto the task directly (section/status column, status, priority).
  const optimisticMove = (task: NexusTask, by: string, to: string): (() => void) | null => {
    if (to === EMPTY_GROUP) return null;
    if (by === "section") {
      const target = (project.taskLists ?? []).find((l) => l.id === to);
      return patchTaskInCaches(qc, task.id, target?.taskStatus ? { status: target.taskStatus } : {}, { moveToListId: to });
    }
    if (by === "status") return patchTaskInCaches(qc, task.id, { status: to });
    if (by === "priority") return patchTaskInCaches(qc, task.id, { priority: to });
    return null;
  };
  const move = useMutation({
    mutationFn: async ({ task, to, toRow, from, fromRow }: { task: NexusTask; to: string; toRow: string | null; from: string; fromRow: string | null }) => {
      await moveToGroup(task, groupBy, from, to, defs, project.id);
      if (sub && toRow !== null && fromRow !== null) await moveToGroup(task, sub, fromRow, toRow, defs, project.id);
    },
    onMutate: async ({ task, to, toRow, from, fromRow }) => {
      await holdProject(qc, project.id);
      const undo = [from !== to ? optimisticMove(task, groupBy, to) : null, sub && toRow !== null && fromRow !== null && toRow !== fromRow ? optimisticMove(task, sub, toRow) : null];
      return { rollback: () => undo.reverse().forEach((u) => u?.()) };
    },
    onError: (e, _v, c) => { c?.rollback(); toast.error(t("Couldn't move the task"), { description: e instanceof Error ? e.message : undefined }); },
    onSettled: refresh,
  });
  const onCardDrag = useCallback<CardDrag>((task, from, fromRow) => setDrag({ id: task.id, from, fromRow }), []);
  const onCardDragEnd = useCallback(() => { setDrag(null); setOver(null); }, []);

  // Reorder sections (lanes) left/right — the ←/→ buttons or dragging the lane's handle. Optimistic.
  const reorderLane = useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) => nexusApi.updateSection(project.id, { id, position }),
    onMutate: async ({ id, position }) => {
      await qc.cancelQueries({ queryKey: ["nexus", "project", project.id] });
      const prev = qc.getQueryData<NexusProject>(["nexus", "project", project.id]);
      qc.setQueryData<NexusProject>(["nexus", "project", project.id], (old) => {
        if (!old?.taskLists) return old;
        const ls = [...old.taskLists].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const from = ls.findIndex((l) => l.id === id);
        if (from === -1) return old;
        const [moved] = ls.splice(from, 1);
        ls.splice(Math.max(0, Math.min(position, ls.length)), 0, moved);
        return { ...old, taskLists: ls.map((l, i) => ({ ...l, position: i })) };
      });
      return { prev };
    },
    onError: (_e, _v, ctx2) => { if (ctx2?.prev) qc.setQueryData(["nexus", "project", project.id], ctx2.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["nexus", "project", project.id] }),
  });

  // Tasks linked into this project from elsewhere → read-only lanes by source project (section grouping only).
  const linkedLanes = useMemo(() => {
    if (!isSection || sub) return [];
    const bySource = new Map<string, { name: string; tasks: NexusTask[] }>();
    for (const list of project.taskLists ?? []) {
      for (const tp of list.taskProjects ?? []) {
        const tk = tp.task;
        if (!tk?.id) continue;
        const srcId = tk.taskList?.projectId ?? "linked";
        if (srcId === project.id) continue;
        if (!taskMatches(tk, cfg.filter, "", defs, ctx)) continue;
        const g = bySource.get(srcId) ?? { name: tk.taskList?.project?.name ?? t("Another project"), tasks: [] };
        if (!g.tasks.some((x) => x.id === tk.id)) g.tasks.push(tk);
        bySource.set(srcId, g);
      }
    }
    return [...bySource.entries()].map(([id, g]) => ({ id, name: g.name, tasks: g.tasks.sort((a, b) => (isDone(a.status) ? 1 : 0) - (isDone(b.status) ? 1 : 0)) }));
  }, [isSection, sub, project, cfg.filter, defs, ctx, t]);

  const lanes = buildGroups(tasks, groupBy);
  const sections = [...(project.taskLists ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const statusOptions = usesStatusOptions(sections);
  const laneLabel = (g: TaskGroup) => (groupLabelIsBuiltin(groupBy, g.key, defs) ? t(g.label) : g.label);
  const laneW = LANE_W[cfg.cardSize];
  // Notion's coloured board (owner, 12 Oct 2026): each column takes its status option's colour (or the
  // group value's), a light tint behind white cards, the header as a pill with the count in its hue.
  const laneColor = (g: TaskGroup): string => {
    if (isSection) { const s = sections.find((x) => x.id === g.key); return s && (statusOptions || s.color) ? optionColorKey(s) : "gray"; }
    if (g.key === EMPTY_GROUP) return "gray";
    const kind = propDef(defs, groupBy)?.kind;
    return kind === "select" || kind === "multi" ? optionColor(groupBy, g.key, defs) : "gray";
  };
  const [draft, setDraft] = useState<string | null>(null);
  // Inline new card: into the column's section (status columns), else the default status, then the
  // column's (and row's) value is written like a drop.
  // The new card shows the moment Enter is pressed (a placeholder in its column while the server saves it),
  // when the column is a section/status column and so certainly where the task will land.
  const createInline = async (g: TaskGroup, rowKey: string | null, p: { title: string; dueDate: string | null }) => {
    const section = isSection && !sub && g.key !== EMPTY_GROUP ? (project.taskLists ?? []).find((l) => l.id === g.key) : undefined;
    const undo = section
      ? insertDraftTask(qc, project.id, section.id, { id: `draft-${Date.now()}`, title: p.title, dueDate: p.dueDate, status: section.taskStatus ?? "TODO", taskListId: section.id, taskList: { id: section.id, name: section.name, projectId: project.id }, assignees: [], tags: [] })
      : null;
    const task = await createTaskInGroup({ project, defs, groupBy, groupKey: g.key, sub, subKey: rowKey, ...p }).catch((e) => { undo?.(); toast.error(t("Couldn't add the task"), { description: e instanceof Error ? e.message : undefined }); return null; });
    refresh();
    return task;
  };

  const renderLane = (g: TaskGroup, rowKey: string | null, laneTasks: NexusTask[], showHeader: boolean) => {
    const id = `${rowKey ?? ""}::${g.key}`;
    const isCollapsed = collapsed.has(g.key);
    const section = isSection ? sections.find((s) => s.id === g.key) : undefined;
    const tone = COLOR_PRESETS[laneColor(g)];
    // Manual order inside a column (owner, 12 Oct 2026): done tasks no longer sink; Done is its own column.
    const items = laneTasks;
    const dropOk = (drag && (canDrop || g.key === drag.from) && (rowKey === null || canDropRow || rowKey === drag.fromRow)) || dragLaneId;
    if (isCollapsed) {
      return (
        <button key={id} type="button" onClick={() => onToggleGroup(g.key)} title={laneLabel(g)} style={{ backgroundColor: tone.lane, color: tone.text }} className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg py-3 transition-[filter] hover:brightness-95">
          <ChevronRight className="h-4 w-4" />
          <span className="text-xs tabular-nums">{laneTasks.length}</span>
          <span className="max-h-48 truncate text-sm font-medium [writing-mode:vertical-rl]">{laneLabel(g)}</span>
        </button>
      );
    }
    const quiet = "grid h-7 w-7 place-items-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/10";
    return (
      <section
        key={id}
        aria-label={laneLabel(g)}
        style={{ backgroundColor: tone.lane, ...(over === id && dropOk ? { boxShadow: `inset 0 0 0 1.5px ${tone.dot}` } : {}) }}
        className={cn("group/lane flex shrink-0 flex-col rounded-lg p-1.5 transition-shadow", laneW, dragLaneId === g.key && "opacity-40")}
        onDragOver={(e) => { if (dropOk) { e.preventDefault(); if (over !== id) setOver(id); } }}
        onDragLeave={() => setOver((o) => (o === id ? null : o))}
        onDrop={() => {
          setOver(null);
          if (dragLaneId && isSection && dragLaneId !== g.key && section) {
            const from = sections.find((s) => s.id === dragLaneId);
            // Columns are ordered by status group; a column moves within its group.
            if (from && statusOptions && statusGroupOf(from.taskStatus) !== statusGroupOf(section.taskStatus)) toast(t("A column moves within its group. Change its group from its ••• menu."));
            else reorderLane.mutate({ id: dragLaneId, position: section.position ?? 0 });
          } else if (drag) {
            const task = tasks.find((x) => x.id === drag.id);
            if (task && (g.key !== drag.from || (rowKey !== null && rowKey !== drag.fromRow))) move.mutate({ task, to: g.key, from: drag.from, toRow: rowKey, fromRow: drag.fromRow });
          }
          setDrag(null); setDragLaneId(null);
        }}
      >
        {showHeader && (
          <div className="mb-1 flex items-center gap-1 px-0.5" style={{ color: tone.text }}>
            <button type="button" onClick={() => onToggleGroup(g.key)} aria-label={t("Collapse {name}", { name: laneLabel(g) })} className={cn(quiet, "h-6 w-5 opacity-0 focus-visible:opacity-100 group-hover/lane:opacity-100")}>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <span
              draggable={!!section}
              onDragStart={(e) => { if (!section) return; setDragLaneId(g.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", g.key); }}
              onDragEnd={() => setDragLaneId(null)}
              title={section ? t("Drag to reorder columns") : undefined}
              className={cn("inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-sm font-medium", section && "cursor-grab active:cursor-grabbing")}
              style={{ backgroundColor: tone.bg, color: tone.text }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
              <span className="truncate">{laneLabel(g)}</span>
            </span>
            <span className="text-xs tabular-nums" title={t(groupCalcValue(laneTasks, cfg.groupCalc, defs).label)}>{groupCalcValue(laneTasks, cfg.groupCalc, defs).value}</span>
            <div className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/lane:opacity-100">
              {section && (
                <StatusOptionMenu projectId={project.id} option={section} sections={sections} trigger={<button type="button" aria-label={t("Column options")} className={quiet}><MoreHorizontal className="h-3.5 w-3.5" /></button>} />
              )}
              <button type="button" aria-label={t("New task")} onClick={() => setDraft(id)} className={quiet}><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}
        <div className="flex min-h-16 flex-col gap-1.5">
          {/* "+ New task" sits at the TOP of the column (owner, 10 Oct 2026: "Add task di atas lane"). */}
          {draft === id ? (
            <InlineTaskDraft variant="card" accent={tone.dot} onCreate={(p) => createInline(g, rowKey, p)} onExpand={onOpen} onClose={() => setDraft(null)} />
          ) : (
            <button type="button" onClick={() => setDraft(id)} style={{ color: tone.text }} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-left text-sm opacity-80 transition-[opacity,background-color] hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
              <Plus className="h-3.5 w-3.5" />{t("New task")}
            </button>
          )}
          <Incremental
            items={items}
            keyOf={(task) => `${task.id}-${g.key}`}
            render={(task) => (
              <TaskCard
                task={task}
                currentProjectId={project.id}
                keys={keys}
                cfg={cfg}
                defs={defs}
                ctx={ctx}
                onOpen={onOpen}
                onDrag={onCardDrag}
                onDragEnd={onCardDragEnd}
                lane={g.key}
                row={rowKey}
                moving={false}
                morph={singleValued}
              />
            )}
          />
        </div>
      </section>
    );
  };

  const linkedLaneEls = linkedLanes.map((lane) => (
    <section key={`linked-${lane.id}`} className={cn("flex shrink-0 flex-col rounded-lg border border-dashed border-border p-1.5", laneW)}>
      <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1">
        <span className="truncate text-sm font-semibold">{lane.name}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{t("Linked")}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{lane.tasks.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Incremental items={lane.tasks} keyOf={(task) => task.id} render={(task) => <TaskCard task={task} currentProjectId={project.id} keys={keys} cfg={cfg} defs={defs} ctx={ctx} onOpen={onOpen} onDrag={noDrag} onDragEnd={noop} lane={`linked-${lane.id}`} row={null} moving={false} />} />
      </div>
    </section>
  ));

  if (!sub) {
    return (
      <div className="overflow-x-auto px-4 pb-6 pt-3 md:px-8">
        <div className="flex min-w-max items-start gap-2.5">
          {linkedLaneEls}
          {lanes.map((g) => renderLane(g, null, g.tasks, true))}
          {isSection && <AddListColumn projectId={project.id} statusOptions={statusOptions} />}
        </div>
        {move.isError && <p className="mt-2 text-sm text-destructive">{t("The task couldn't be moved. Check your access to this project and try again.")}</p>}
      </div>
    );
  }

  // Sub-groups: one row (swimlane) per sub-group value, the same lanes in each row.
  const rows = buildGroups(tasks, sub, { keepHidden: true });
  return (
    <div className="overflow-x-auto px-4 pb-6 pt-3 md:px-8">
      <div className="min-w-max space-y-3">
        <div className="flex gap-2.5 pl-0.5">
          {lanes.map((g) => (
            <div key={g.key} className={cn("shrink-0 px-1.5", collapsed.has(g.key) ? "w-10" : laneW)}>
              <GroupHeader group={g} groupBy={groupBy} defs={defs} cfg={cfg} collapsed={collapsed.has(g.key)} onToggle={() => onToggleGroup(g.key)} />
            </div>
          ))}
        </div>
        {rows.map((row) => {
          const rowCollapsed = collapsed.has(`row:${row.key}`);
          const cells = new Map(groupTasks(row.tasks, groupBy, defs, ctx).map((x) => [x.key, x.tasks]));
          return (
            <div key={row.key} className="border-t border-border pt-2">
              <GroupHeader group={row} groupBy={sub} defs={defs} cfg={cfg} collapsed={rowCollapsed} onToggle={() => onToggleGroup(`row:${row.key}`)} sticky className="mb-1.5 w-fit" />
              {!rowCollapsed && (
                <div className="flex items-start gap-2.5">
                  {lanes.map((g) => renderLane(g, row.key, cells.get(g.key) ?? [], false))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddListColumn({ projectId, statusOptions }: { projectId: string; statusOptions: boolean }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const [name, setName] = useState("");
  const [group, setGroup] = useState<StatusGroupKey>("todo");
  const [open, setOpen] = useState(false);
  // A new column is a new status option (owner, 12 Oct 2026): it asks which group it belongs to.
  const create = useMutation({
    mutationFn: () => nexusApi.createSection(projectId, name.trim(), statusOptions ? { taskStatus: statusForNewOption(group, name) as NexusTaskStatus } : {}),
    onSuccess: () => { setName(""); setGroup("todo"); setOpen(false); qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] }); },
  });
  const label = statusOptions ? t("Add status") : t("Add section");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-56 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
        <Plus className="h-4 w-4" />{label}
      </button>
    );
  }
  return (
    <div className="w-64 shrink-0 space-y-1.5 rounded-lg bg-muted/50 p-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); if (e.key === "Escape") setOpen(false); }}
        placeholder={statusOptions ? t("Status name") : t("Section name")}
        className="h-8 w-full rounded-md border border-border bg-card px-2 text-sm outline-none transition-colors focus:border-[color:var(--accent-foreground)]"
      />
      {statusOptions && (
        <div className="flex gap-1" role="radiogroup" aria-label={t("Group")}>
          {STATUS_GROUPS.map((g) => (
            <button key={g.key} type="button" role="radio" aria-checked={group === g.key} onClick={() => setGroup(g.key)}
              className={cn("h-7 flex-1 rounded-md border text-xs transition-colors", group === g.key ? "border-[color:var(--accent-foreground)] bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-card")}>
              {t(g.label)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => name.trim() && create.mutate()} disabled={!name.trim() || create.isPending} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{label}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-card">{t("Cancel")}</button>
      </div>
      {create.isError && <p className="text-xs text-destructive">{t("Couldn't add the section. Try again.")}</p>}
    </div>
  );
}

/** "+X XP" — when the task is part of one or more task-bundle quests. XP = sum across quests. */
function QuestChip({ task, className }: { task: NexusTask; className?: string }) {
  const { t } = useLang();
  const quests = task.quests ?? [];
  if (quests.length === 0) return null;
  const xp = quests.reduce((s, q) => s + (q.xpReward ?? 0), 0);
  return (
    <span
      title={t("Quest: {titles} (+{xp} XP)", { titles: quests.map((q) => q.title).join(", "), xp })}
      className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--accent-foreground)] bg-accent", className)}
    >
      +{xp} XP
    </span>
  );
}

const CARD_PAD: Record<ViewConfig["cardSize"], string> = { small: "gap-1 px-2 py-1.5", medium: "gap-1.5 px-2.5 py-2", large: "gap-2 px-3 py-2.5" };

type CardDrag = (task: NexusTask, from: string, fromRow: string | null) => void;

/**
 * A board card. Memoised: a drag hover, a realtime refetch of one task or the draft opening in another
 * column re-renders only the cards whose task changed (perf pass, 12 Oct 2026). Plain elements, no framer
 * `layoutId`: the popup's morph measures the card itself (`data-morph-id`, TaskDetailPanel), and 350 shared-
 * layout cards made every render measure the whole board.
 */
const TaskCard = memo(function TaskCard({ task, currentProjectId, keys, cfg, defs, ctx, onOpen, onDrag, onDragEnd, lane, row, moving, morph = true }: {
  task: NexusTask; currentProjectId?: string; keys: string[]; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx;
  onOpen: (task: NexusTask) => void; onDrag: CardDrag; onDragEnd: () => void; lane: string; row: string | null; moving: boolean;
  /** False when the same task shows twice (grouped by people or tags): one morph id per task. */
  morph?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useLang();
  const bulk = useTaskBulk();
  const draft = task.id.startsWith("draft-");
  const cardProps = bulk.bindCard(task, () => onOpen(task));
  const selected = bulk.isSelected(task.id);
  const done = isDone(task.status);
  const linkedFrom = task.taskList?.projectId && currentProjectId && task.taskList.projectId !== currentProjectId ? (task.taskList.project?.name ?? t("another project")) : null;
  const projectId = task.taskList?.projectId ?? currentProjectId;
  // Optimistic: the circle fills at once; the server's answer (and the move to the Done column) follows.
  const toggleDone = useMutation({
    mutationFn: (next: string) => nexusApi.updateTask(task.id, { status: next }),
    onMutate: async (next) => {
      await holdProject(qc, projectId);
      const rollback = patchTaskInCaches(qc, task.id, { status: next });
      if (next === "DONE") celebrate(t("Done: {title}", { title: task.title.length > 28 ? task.title.slice(0, 26) + "…" : task.title }));
      return { rollback };
    },
    onError: (e, _v, c) => { c?.rollback(); toast.error(e instanceof Error ? e.message : t("Couldn't update the task.")); },
    onSettled: () => settleTaskWrite(qc, projectId, task.id),
  });
  const tint = cardTint(task, cfg, defs, ctx);
  return (
    <div data-morph-id={morph && !draft ? `board-taskcard-${task.id}` : undefined} data-bulk-task={draft ? undefined : cardProps["data-bulk-task"]} style={{ borderRadius: 8 }} onContextMenu={draft ? undefined : cardProps.onContextMenu} onTouchStart={cardProps.onTouchStart} onTouchEnd={cardProps.onTouchEnd} onTouchMove={cardProps.onTouchMove} className={cn("w-full", done && "opacity-60", draft && "pointer-events-none opacity-70", selected && "ring-2 ring-[color:var(--accent-foreground)] ring-offset-1 ring-offset-background")}>
      <div
        role="button"
        tabIndex={0}
        draggable={!linkedFrom && !draft}
        onDragStart={() => onDrag(task, lane, row)}
        onDragEnd={onDragEnd}
        onClick={cardProps.onClick}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") prefetchTask(qc, task.id); }}
        onPointerLeave={() => prefetchTask(qc, null)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(task); }}
        style={tint}
        className={cn("flex w-full cursor-pointer flex-col rounded-lg border border-border bg-card text-left shadow-[0_1px_2px_rgba(15,15,15,0.05)] transition-[box-shadow,border-color] duration-150 hover:border-foreground/15 hover:shadow-[0_2px_8px_rgba(15,15,15,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/40", CARD_PAD[cfg.cardSize])}
      >
        {linkedFrom && <span className="truncate text-[11px] text-muted-foreground">{t("From {name}", { name: linkedFrom })}</span>}
        {task.parentId && (
          <span className="inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground" title={task.parent?.title ? t("Subtask of {title}", { title: task.parent.title }) : t("Subtask")}>
            <CornerDownRight className="h-3 w-3 shrink-0" />
            <span className="truncate">{task.parent?.title || t("Subtask")}</span>
          </span>
        )}
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggleDone.mutate(done ? "TODO" : "DONE"); }}
            disabled={draft}
            className="mt-px shrink-0 rounded-full text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-90"
            aria-label={done ? t("Mark as not done") : t("Mark as done")}
            title={done ? t("Mark as not done") : t("Mark as done")}
          >
            {moving || draft ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-4 w-4 opacity-60" />}
          </button>
          <span className={cn("min-w-0 flex-1 text-sm font-medium leading-snug", cfg.cardSize === "small" && "text-[13px]", done && "text-muted-foreground line-through")}>{task.title}</span>
          <QuestChip task={task} />
        </div>
        <PropLine task={task} keys={keys} defs={defs} ctx={ctx} className="pl-[22px]" />
      </div>
    </div>
  );
});

/**
 * Resting the pointer on a card for a moment fetches its popup's data, so a click opens a filled popup
 * (desktop). Sweeping across the board fetches nothing: only a 120 ms rest counts.
 */
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
function prefetchTask(qc: ReturnType<typeof useQueryClient>, taskId: string | null) {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = null;
  if (!taskId || taskId.startsWith("draft-")) return;
  hoverTimer = setTimeout(() => {
    void qc.prefetchQuery({ queryKey: ["task", taskId], queryFn: () => nexusApi.taskDetail(taskId), staleTime: 30_000 });
  }, 120);
}

function ProjectMembersAvatars({ project }: { project: NexusProject }) {
  const qc = useQueryClient();
  const members = project.members ?? [];
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const { t } = useLang();
  const isMobile = useIsMobile();

  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const myRole = wsm.data?.role ?? "";
  const canAdd = myRole === "BOD" || myRole === "ONE_ABOVE_ALL"; // BoD ke atas

  const ids = members.map((m) => m.userId || m.user?.id).filter(Boolean) as string[];
  const memberIds = new Set(ids);

  if (ids.length === 0 && !canAdd) return null;
  const close = () => setOpen(false);
  const labelCls = "px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center rounded-full transition hover:opacity-80" title={t("Project members")} aria-label={t("Project members")}>
        {ids.length > 0 ? <AvatarStack ids={ids} size={isMobile ? 24 : 26} max={isMobile ? 2 : 4} /> : <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">+ {t("Members")}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-card p-2 shadow-pop">
            <div className={labelCls}>{t("Project members · {n}", { n: members.length })}</div>
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
              // Multi-select (owner, 11 Oct 2026): tick several people, one "Add N people", and no
              // "which team should they join?" step afterwards.
              <button onClick={() => { setOpen(false); setPicking(true); }} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-sm font-semibold text-primary transition hover:bg-accent">
                <Plus className="h-4 w-4" /> {t("Add people to project")}
              </button>
            )}
          </div>
        </>
      )}
      {picking && <Suspense fallback={null}><AddProjectMembersDialog projectId={project.id} memberIds={memberIds} onClose={() => setPicking(false)} onAdded={() => setPicking(false)} /></Suspense>}
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

/** A List row. Memoised and plain (no framer layoutId), like the board's cards (perf pass, 12 Oct 2026). */
const ListRow = memo(function ListRow({ task, keys, cfg, defs, ctx, onOpen, morph }: { task: NexusTask; keys: string[]; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx; onOpen: (task: NexusTask) => void; morph: boolean }) {
  const { t } = useLang();
  const bulk = useTaskBulk();
  const cardProps = bulk.bindCard(task, () => onOpen(task));
  const selected = bulk.isSelected(task.id);
  const done = isDone(task.status);
  const tint = cardTint(task, cfg, defs, ctx);
  return (
    <button
      type="button"
      data-morph-id={morph ? `list-taskcard-${task.id}` : undefined}
      style={{ borderRadius: 6, ...tint }}
      {...cardProps}
      className={cn("group flex min-h-9 w-full items-center gap-2.5 border-b border-border/70 px-2 py-1.5 text-left transition-colors [contain-intrinsic-size:auto_37px] [content-visibility:auto] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-foreground)]/40", selected && "bg-accent", task.parentId && "pl-7")}
    >
      {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {task.parentId && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t("Subtask")} />}
        <span className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>{task.title}</span>
        {task.parentId && task.parent?.title && <span className="hidden truncate text-xs text-muted-foreground md:inline">· {task.parent.title}</span>}
        <QuestChip task={task} />
      </span>
      <PropLine task={task} keys={keys} defs={defs} ctx={ctx} className="hidden shrink-0 flex-nowrap justify-end sm:flex [&>*]:shrink-0" />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
    </button>
  );
});

function ListView({ project, groups, groupBy, subGroupBy, buildGroups, cfg, defs, ctx, keys, collapsed, onToggleGroup, onOpen }: {
  project: NexusProject; groups: TaskGroup[]; groupBy: string | null; subGroupBy: string | null; buildGroups: GroupBuilder; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx; keys: string[];
  collapsed: Set<string>; onToggleGroup: (k: string) => void; onOpen: (task: NexusTask) => void;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const multi = (k: string | null) => !!k && (k === "assignee" || k === "tags" || ["multi", "person"].includes(propDef(defs, k)?.kind ?? ""));
  const morph = !multi(groupBy) && !multi(subGroupBy);
  const rows = (tasks: NexusTask[]) => <Incremental items={tasks} first={50} step={30} keyOf={(task) => task.id} render={(task) => <ListRow task={task} keys={keys} cfg={cfg} defs={defs} ctx={ctx} onOpen={onOpen} morph={morph} />} />;
  const create = async (gKey: string | null, subKey: string | null, p: { title: string; dueDate: string | null }) => {
    const task = await createTaskInGroup({ project, defs, groupBy, groupKey: gKey, sub: subGroupBy, subKey, ...p }).catch((e) => { toast.error(t("Couldn't add the task"), { description: e instanceof Error ? e.message : undefined }); return null; });
    settleTaskWrite(qc, project.id);
    return task;
  };
  // "+ New task" at the TOP of each group (owner, 10 Oct 2026), opening an inline row (12 Oct 2026).
  const newRow = (id: string, gKey: string | null, subKey: string | null) => (draft === id
    ? <InlineTaskDraft variant="row" onCreate={(p) => create(gKey, subKey, p)} onExpand={onOpen} onClose={() => setDraft(null)} />
    : (
      <button type="button" onClick={() => setDraft(id)} className="flex h-9 w-full items-center gap-2 border-b border-border/70 px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
        <Plus className="h-4 w-4" />{t("New task")}
      </button>
    ));
  if (!groupBy) {
    return <div className="px-4 py-3 md:px-8">{newRow("all", null, null)}{rows(groups[0]?.tasks ?? [])}</div>;
  }
  return (
    <div className="space-y-5 px-4 py-3 md:px-8">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const subs = subGroupBy && subGroupBy !== groupBy ? buildGroups(g.tasks, subGroupBy, { keepHidden: true }).filter((x) => x.tasks.length > 0) : null;
        return (
          <section key={g.key} aria-label={g.label}>
            <GroupHeader group={g} groupBy={groupBy} defs={defs} cfg={cfg} collapsed={isCollapsed} onToggle={() => onToggleGroup(g.key)} className="mb-0.5 border-b border-border pb-1" />
            {!isCollapsed && (subs ? (
              <div className="space-y-2 pl-5 pt-1.5">
                {newRow(g.key, g.key, null)}
                {subs.map((s) => {
                  const k = `${g.key}/${s.key}`;
                  return (
                    <div key={k}>
                      <GroupHeader group={s} groupBy={subGroupBy} defs={defs} cfg={cfg} collapsed={collapsed.has(k)} onToggle={() => onToggleGroup(k)} />
                      {!collapsed.has(k) && rows(s.tasks)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>{newRow(g.key, g.key, null)}{rows(g.tasks)}</div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const CAL_CHIP: Record<string, string> = {
  URGENT: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  MEDIUM: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  LOW: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  NONE: "bg-muted text-foreground",
};
const CAL_STRIPE: Record<string, string> = {
  URGENT: "bg-rose-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-emerald-500",
  NONE: "bg-muted-foreground/40",
};

function CalendarView({ tasks, cfg, defs, ctx, onOpen, onCreate, onSetDate, canDrag }: {
  tasks: NexusTask[]; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx;
  onOpen: (task: NexusTask) => void; onCreate: (dueDate: string) => void; onSetDate: (task: NexusTask, iso: string) => void; canDrag: boolean;
}) {
  const { t, locale } = useLang();
  const bulk = useTaskBulk();
  const isMobile = useIsMobile();
  // The view's date property (owner, 12 Oct 2026): due date by default, or the start date / a date field.
  const dateOf = (task: NexusTask) => parseDate(taskValues(task, cfg.dateProp)[0]);
  const dated = tasks.filter((task) => dateOf(task));
  const undated = tasks.filter((task) => !dateOf(task));
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [viewMonth, setViewMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const shiftMonth = (delta: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const sameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const keys = visibleProps(cfg, "calendar", defs);
  const chipStyle = (task: NexusTask) => cardTint(task, cfg, defs, ctx);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: locale.startsWith("id") ? "short" : "narrow" }).format(new Date(2026, 9, 12 + i))), [locale]);

  // 6-week grid starting on the Monday on/before the 1st
  const gridStart = new Date(viewMonth);
  gridStart.setDate(1 - ((viewMonth.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const todayKey = dayKey(new Date());

  // Mobile agenda — tasks in the viewed month, grouped by day.
  const byDay = new Map<string, { date: Date; items: NexusTask[] }>();
  for (const task of dated) {
    const d = dateOf(task)!;
    if (!sameMonth(d, viewMonth)) continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, { date: d, items: [] });
    byDay.get(k)!.items.push(task);
  }
  const agenda = Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const dropOn = (day: Date) => {
    if (!dragTaskId) return;
    const src = tasks.find((x) => x.id === dragTaskId);
    if (!src) return;
    const prev = dateOf(src);
    if (prev && dayKey(prev) === dayKey(day)) return; // same day = no write
    // Moving a task keeps its CLOCK TIME — these calendars hold timed events ("10:00 PM"), and sending a
    // bare date would silently reset them to midnight. Undated tasks land on the plain date.
    onSetDate(src, prev ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), prev.getHours(), prev.getMinutes(), 0, 0).toISOString() : ymd(day));
  };

  return (
    <div className="space-y-3 px-4 py-3 md:px-8">
      <div className="flex items-center gap-1">
        <h2 className="mr-auto text-base font-semibold capitalize">{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(viewMonth)}</h2>
        <button type="button" onClick={() => { const n = new Date(); setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="h-8 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{t("Today")}</button>
        <button type="button" onClick={() => shiftMonth(-1)} aria-label={t("Previous month")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => shiftMonth(1)} aria-label={t("Next month")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {isMobile ? (
        <div className="space-y-5">
          {agenda.map(({ date, items }) => {
            const isToday = dayKey(date) === todayKey;
            return (
              <div key={dayKey(date)} className="flex gap-3">
                <div className={cn("flex w-11 shrink-0 flex-col items-center rounded-lg py-1.5", isToday ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
                  <span className="text-[10px] font-medium uppercase opacity-80">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date)}</span>
                  <span className="text-lg font-semibold leading-none">{date.getDate()}</span>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {items.map((task) => {
                    const done = isDone(task.status);
                    const cs = chipStyle(task);
                    return (
                      <button key={task.id} data-morph-id={`calendar-taskcard-${task.id}`} style={{ borderRadius: 8, ...(cs && !done ? cs : {}) }} {...bulk.bindCard(task, () => onOpen(task))} className={cn("flex w-full items-stretch gap-2.5 rounded-lg border border-border bg-card p-2.5 text-left", done && "opacity-60", bulk.isSelected(task.id) && "ring-2 ring-[color:var(--accent-foreground)]")}>
                        <span className={cn("w-1 shrink-0 rounded-full", done ? "bg-emerald-500" : CAL_STRIPE[(task.priority ?? "NONE").toUpperCase()] ?? CAL_STRIPE.NONE)} />
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-sm font-medium", done && "line-through")}>{task.parentId ? `↳ ${task.title}` : task.title}</div>
                          <PropLine task={task} keys={keys} defs={defs} ctx={ctx} className="mt-1" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {agenda.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("Nothing on the calendar this month.")}</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 border-b border-border text-xs text-muted-foreground">
            {weekdays.map((d, i) => <div key={i} className="px-2 py-1.5 text-right">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, idx) => {
              const key = dayKey(day);
              const inMonth = sameMonth(day, viewMonth);
              // Only attach events to in-month days — keeps each task's morph id unique per month.
              const dayTasks = inMonth ? dated.filter((task) => dayKey(dateOf(task)!) === key) : [];
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  onDragOver={(e) => { if (dragTaskId && inMonth && canDrag) { e.preventDefault(); setDropKey(key); } }}
                  onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); if (inMonth) dropOn(day); setDragTaskId(null); setDropKey(null); }}
                  className={cn("group/cal relative min-h-28 border-border p-1", idx % 7 !== 6 && "border-r", idx >= 7 && "border-t", !inMonth && "bg-muted/30", dropKey === key && "bg-accent")}
                >
                  <div className="mb-1 flex items-center justify-between">
                    {inMonth ? <button type="button" onClick={() => onCreate(ymd(day))} aria-label={t("Add a task on this date")} title={t("Add a task on this date")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/cal:opacity-100"><Plus className="h-3.5 w-3.5" /></button> : <span />}
                    <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums", isToday ? "bg-rose-500 font-semibold text-white" : inMonth ? "text-foreground" : "text-muted-foreground/50")}>{day.getDate()}</span>
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((task) => {
                      const done = isDone(task.status);
                      const cs = chipStyle(task);
                      return (
                        <button
                          key={task.id}
                          data-morph-id={`calendar-taskcard-${task.id}`}
                          style={{ borderRadius: 4, ...(cs && !done ? cs : {}) }}
                          {...bulk.bindCard(task, () => onOpen(task))}
                          draggable={canDrag}
                          onDragStart={() => setDragTaskId(task.id)}
                          onDragEnd={() => { setDragTaskId(null); setDropKey(null); }}
                          title={task.title}
                          className={cn("block w-full truncate px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight", canDrag && "cursor-grab active:cursor-grabbing", done ? "bg-muted text-muted-foreground line-through" : !cs && (CAL_CHIP[(task.priority ?? "NONE").toUpperCase()] ?? CAL_CHIP.NONE), dragTaskId === task.id && "opacity-40", bulk.isSelected(task.id) && "ring-1 ring-inset ring-[color:var(--accent-foreground)]")}
                        >
                          {task.parentId ? `↳ ${task.title}` : task.title}
                        </button>
                      );
                    })}
                    {dayTasks.length > 3 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="w-full px-1 text-left text-[11px] text-muted-foreground transition hover:text-foreground">{t("{n} more", { n: dayTasks.length - 3 })}</button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-60 p-2">
                          <div className="mb-1.5 px-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(day)}</div>
                          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                            {dayTasks.map((task) => {
                              const done = isDone(task.status);
                              const cs = chipStyle(task);
                              return (
                                <button key={task.id} type="button" onClick={() => onOpen(task)} style={cs && !done ? cs : undefined} className={cn("truncate rounded px-1.5 py-1 text-left text-xs font-medium transition hover:brightness-95", done ? "bg-muted text-muted-foreground line-through" : !cs && (CAL_CHIP[(task.priority ?? "NONE").toUpperCase()] ?? CAL_CHIP.NONE))}>
                                  {task.parentId ? `↳ ${task.title}` : task.title}
                                </button>
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
      )}
      {undated.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <div className="mb-2 text-xs text-muted-foreground">{t("No date · {n}", { n: undated.length })}{canDrag && !isMobile ? ` — ${t("drag one onto a day to give it a date")}` : ""}</div>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((task) => (
              <button
                key={task.id}
                type="button"
                draggable={canDrag}
                onDragStart={() => setDragTaskId(task.id)}
                onDragEnd={() => { setDragTaskId(null); setDropKey(null); }}
                onClick={() => onOpen(task)}
                className={cn("max-w-[220px] truncate rounded-md border border-border bg-card px-2 py-1 text-xs transition hover:border-foreground/20", canDrag && "cursor-grab active:cursor-grabbing")}
              >
                {task.title}
              </button>
            ))}
          </div>
        </div>
      )}
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
    default: return 0; // not started: an empty bar, not a red 8% sliver
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
  HIGH: "bg-red-500",
  MEDIUM: "bg-sky-500",
  LOW: "bg-violet-500",
  NONE: "bg-teal-500",
};
function tlInitials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function taskWindow(task: NexusTask, startProp = "start", endProp = "due"): { start: Date; end: Date } {
  let start = parseDate(taskValues(task, startProp)[0]);
  let end = parseDate(taskValues(task, endProp)[0]);
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

function TimelineView({ groups: taskGroups, groupBy, cfg, defs, ctx, collapsed, onToggleGroup, onOpen }: {
  groups: TaskGroup[]; groupBy: string | null; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx; collapsed: Set<string>; onToggleGroup: (k: string) => void; onOpen: (task: NexusTask) => void;
}) {
  const bulk = useTaskBulk();
  const { t, tn, locale } = useLang();
  // Phone: the frozen column is the title only, ~40% of the width, so the bars have room (Duration and
  // Progress are hidden; the bar's tooltip and the task itself still say both). Audit 12 Oct 2026.
  const compact = useIsMobile();
  const leftW = compact ? Math.round(Math.min(200, Math.max(120, ((typeof window !== "undefined" ? window.innerWidth : 390) - 32) * 0.4))) : GANTT_LEFT_W;
  const groups = taskGroups.map((g) => {
    const tasks = g.tasks.map((task) => ({ task, win: taskWindow(task, cfg.startProp, cfg.endProp) }));
    // The view's own sort wins; without one, bars run by start date.
    if (!cfg.sort.length) tasks.sort((a, b) => a.win.start.getTime() - b.win.start.getTime());
    return { list: { id: g.key, name: groupLabelIsBuiltin(groupBy, g.key, defs) ? t(g.label) : g.label }, tasks };
  });
  const allWins = groups.flatMap((g) => g.tasks.map((t) => t.win));

  if (allWins.length === 0) {
    return <div className="px-4 py-10 md:px-8"><EmptyState icon={GanttChart} tone="muted" title={t("Nothing on the timeline")} message={t("Tasks show here as bars from their start date to their due date.")} /></div>;
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
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
    const last = months[months.length - 1];
    if (last && last.label === label) last.days++;
    else months.push({ label, days: 1 });
  }

  const toggle = onToggleGroup;
  const single = !groupBy;
  void ctx;

  return (
    <div className="px-4 py-3 md:px-8">
      {/* Opens on today (Notion does), not on the oldest task's month: a callback ref scrolls once. */}
      <div ref={(el) => { if (el && !el.dataset.scrolled) { el.dataset.scrolled = "1"; el.scrollLeft = Math.max(0, xOf(today) - GANTT_DAY_W * (compact ? 1 : 3)); } }} className="relative overflow-x-auto rounded-lg border border-border bg-card">
        <div style={{ width: leftW + timelineW }}>
          {/* HEADER */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card">
            <div className="sticky left-0 z-30 flex shrink-0 border-r border-border bg-card" style={{ width: leftW }}>
              <div className={cn("flex flex-1 items-end pb-2 pt-6 text-xs text-muted-foreground", compact ? "px-3" : "px-4")}>{t("Name")}</div>
              {!compact && <div className="flex w-[90px] items-end px-2 pb-2 pt-6 text-xs text-muted-foreground">{t("Duration")}</div>}
              {!compact && <div className="flex w-[150px] items-end border-l border-border px-3 pb-2 pt-6 text-xs text-muted-foreground">{t("Progress")}</div>}
            </div>
            <div className="relative" style={{ width: timelineW }}>
              <div className="flex h-8 border-b border-border/50">
                {months.map((m, i) => (
                  <div key={i} className="flex items-center border-l border-border/40 px-2 text-xs font-bold text-foreground/70" style={{ width: m.days * GANTT_DAY_W }}><span className="sticky whitespace-nowrap" style={{ left: leftW + 8 }}>{m.label}</span></div>
                ))}
              </div>
              <div className="flex h-9">
                {days.map((d, i) => {
                  const isToday = d.getTime() === today.getTime();
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={i} className={cn("flex flex-col items-center justify-center gap-0.5 border-l border-border/40 text-[10px] leading-none", weekend && "bg-muted/30")} style={{ width: GANTT_DAY_W }}>
                      <span className={cn("font-semibold", isToday ? "text-primary" : "text-muted-foreground/70")}>{new Intl.DateTimeFormat(locale, { weekday: locale.startsWith("id") ? "short" : "narrow" }).format(d)}</span>
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
              <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px bg-primary/50" style={{ left: leftW + xOf(today) + GANTT_DAY_W / 2 }} />
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
                  {!single && <div className="flex border-b border-border bg-muted/40">
                    <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-muted" style={{ width: leftW }}>
                      <button onClick={() => toggle(g.list.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                        <span className="truncate font-bold tracking-tight">{g.list.name}</span>
                      </button>
                      {!compact && <div className="w-[90px] px-2 text-xs text-muted-foreground">{gDur ? tn(gDur, "{n} day", "{n} days") : "—"}</div>}
                      {!compact && <div className="flex w-[150px] items-center gap-2 border-l border-border px-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500" style={{ width: `${gPct}%` }} /></div>
                        <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{gPct}%</span>
                      </div>}
                    </div>
                    <div className="relative" style={{ width: timelineW }}>
                      {gStart && <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-muted-foreground" style={{ left: xOf(gStart) + 6 }}>{g.list.name}</span>}
                    </div>
                  </div>}
                  {/* TASK ROWS */}
                  {!isCollapsed && <Incremental items={g.tasks} first={40} step={25} keyOf={(x) => x.task.id} render={({ task, win }) => {
                    const pct = tlProgress(task.status);
                    const dur = daysBetween(win.start, win.end) + 1;
                    const left = xOf(win.start);
                    const width = Math.max(GANTT_DAY_W * 0.8, daysBetween(win.start, win.end) * GANTT_DAY_W + GANTT_DAY_W);
                    const isDone = (task.status ?? "").toUpperCase() === "DONE";
                    const tint = taskColor(task, cfg, defs, ctx);
                    const barColor = tint ? "" : GANTT_BAR[(task.priority ?? "NONE").toUpperCase()] ?? GANTT_BAR.NONE;
                    const people = (task.assignees ?? []).map((a) => a.user).filter(Boolean).slice(0, 3);
                    const cp = bulk.bindCard(task, () => onOpen(task));
                    const selected = bulk.isSelected(task.id);
                    return (
                      <div key={task.id} className={cn("flex border-b border-border/50 hover:bg-accent/20", selected && "bg-primary/10 ring-1 ring-inset ring-primary")}>
                        <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card" style={{ width: leftW }}>
                          <button {...cp} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
                            {isDone ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                            <span className={cn("truncate text-sm font-medium", isDone && "text-muted-foreground line-through")}>{task.title}</span>
                          </button>
                          {!compact && <div className="w-[90px] px-2 text-xs text-muted-foreground">{tn(dur, "{n} day", "{n} days")}</div>}
                          {!compact && <div className="flex w-[150px] items-center gap-2 border-l border-border px-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", pctTone(pct))} style={{ width: `${pct}%` }} /></div>
                            <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{pct}%</span>
                          </div>}
                        </div>
                        <div className="relative py-2" style={{ width: timelineW }}>
                          <button
                            data-morph-id={`timeline-taskcard-${task.id}`}
                            {...cp}
                            title={`${task.title} · ${fmtDate(win.start.toISOString())} → ${fmtDate(win.end.toISOString())}`}
                            className={cn("group absolute top-1.5 flex h-8 items-center gap-1.5 overflow-hidden px-1.5 text-left shadow-soft transition-transform duration-150 hover:scale-[1.015] motion-reduce:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", barColor)}
                            style={{ left, width, borderRadius: 8, ...(tint ? { backgroundColor: COLOR_PRESETS[tint].dot } : {}) }}
                          >
                            {people.length > 0 && (
                              <div className="flex shrink-0 -space-x-1.5">
                                {people.map((u, i) => (
                                  <span key={i} className="grid h-5 w-5 place-items-center rounded-full bg-white/90 text-[9px] font-black text-foreground ring-1 ring-black/10">{tlInitials(u?.name)}</span>
                                ))}
                              </div>
                            )}
                            <span className="truncate text-xs font-bold text-white drop-shadow-sm">{task.title}</span>
                          </button>
                        </div>
                      </div>
                    );
                  }} />}
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


function PagesView({ project, onOpen }: { project: NexusProject; onOpen: (doc: NexusDoc) => void }) {
  const docs = useQuery({ queryKey: ["nexus", "project-docs", project.id], queryFn: () => nexusApi.projectDocs(project.id), retry: false });
  const items = docs.data?.docs ?? [];
  const qc = useQueryClient();
  const { t: tr } = useLang();
  // "Add page" makes an empty page and opens it in the block editor, as Notion does (no composer).
  const create = useMutation({
    mutationFn: () => nexusApi.createDoc({ title: "Untitled", projectId: project.id }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["nexus", "project-docs", project.id] });
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      if (res.doc?.id) onOpen(res.doc);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tr("Couldn't create the page.")),
  });
  const onCreate = () => create.mutate();
  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">{tr("Pages")}</h2>
          <p className="text-sm text-muted-foreground">{tr("SOPs, meeting notes, briefs and reference pages for this project.")}</p>
        </div>
        <Button variant="primary" isDisabled={create.isPending} onClick={onCreate}><Plus className="h-4 w-4" />{tr("Add page")}</Button>
      </div>
      {docs.isLoading && <Card><CardBody className="p-6 text-sm text-muted-foreground">{tr("Loading pages…")}</CardBody></Card>}
      {docs.isError && <Empty title={tr("Couldn't load pages")} message={tr("Check that you're a member of this project, then try again.")} />}
      {!docs.isLoading && !docs.isError && items.length === 0 && <Empty title={tr("No pages yet")} message={tr("Add the first page for a brief, an SOP or meeting notes.")} />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((doc) => (
          <Card key={doc.id} onClick={() => onOpen(doc)} className="border border-border bg-card text-left shadow-soft hover:border-primary/40">
            <CardBody className="gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg">{doc.icon || "📄"}</span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black tracking-tight">{doc.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{tr("Updated {date}", { date: fmtDate(doc.updatedAt) })}{(doc.owner?.name || doc.author?.name) ? ` · ${doc.owner?.name || doc.author?.name}` : ""}</p>
                </div>
              </div>
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{plainPreview(doc.contentText) || tr("No content yet")}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Chip size="sm" variant="soft">{doc.project?.name || project.name}</Chip>
                <span>{tr("Open")} →</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProjectChat({ projectId }: { projectId: string }) {
  const { t } = useLang();
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const convos = useQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), retry: false });
  const room = (convos.data?.conversations ?? []).find((c) => c.type === "PROJECT" && c.projectId === projectId);
  return (
    <div className="p-4 md:p-8">
      <div className="mx-auto h-[70vh] max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        {convos.isLoading && <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!convos.isLoading && !room && <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground"><div><MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-40" />{t("This project's chat room isn't active yet.")}</div></div>}
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
  // A compact pill (owner, 10 Oct 2026: the HeroUI chip was too big beside the card title). Colours from
  // the shared priorityTone, so the board reads like the Calendar, folders and My Mission.
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4", priorityTone(priority))}>{statusLabel(priority || "Normal")}</span>;
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

