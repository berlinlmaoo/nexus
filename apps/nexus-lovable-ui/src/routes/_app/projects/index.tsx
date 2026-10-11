import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent as CardBody, Chip, Input } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AvatarStack } from "@/components/Avatar";
import { ProgressBar } from "@/components/StatusPill";
import { ProjectMark } from "@/components/projects/ProjectIcon";
import { ProjectTypeChosen, ProjectTypePicker } from "@/components/projects/ProjectTypePicker";
import { TabPreviewCards } from "@/components/projects/TabPreviewCards";
import { projectSettingsErrorText, type ProjectTypeId } from "@/components/projects/project-tabs";
import { MemberMultiPicker } from "@/components/projects/MemberMultiPicker";
import { useLang } from "@/lib/lang";
import { projects as fallbackProjects } from "@/lib/mock-data";
import { nexusApi, ORG_HIERARCHY, type NexusProject, type NexusProjectFolder } from "@/lib/nexus-api";
import { folderPath } from "@/lib/folder-tree-client";
import { invalidateProjectData } from "@/lib/invalidate";
import { Reveal } from "@/components/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  FolderGlyph, ProjectGlyph, TreeMenuBody, folderMenuEntries, projectMenuEntries, useProjectTreeActions, type TreeActions,
} from "@/components/projects/project-tree";
import { canDropInto, dragFromDrop, endTreeDrag, isTreeDrag, startTreeDrag, useTreeDrag } from "@/lib/project-tree-dnd";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Folder,
  FolderPlus,
  Inbox,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_app/projects/")({
  component: ProjectsPage,
  // `?new=1` opens "New project" (the sidebar's "+ New project" lands here, so every project starts by
  // choosing its type — owner, 9 Oct 2026).
  // `&folder=<id>` makes it inside that folder (a folder's "New project here", 10 Oct 2026).
  validateSearch: (s: Record<string, unknown>): { new?: 1; folder?: string } => ({
    new: s.new === 1 || s.new === "1" ? 1 : undefined,
    folder: typeof s.folder === "string" && s.folder ? s.folder : undefined,
  }),
});

const EXPANDED_KEY = "nexus:projects:expanded-folders";

const statusBadge: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "In play", cls: "bg-success/15 text-success" },
  PLANNING: { label: "Warming up", cls: "bg-info/15 text-info" },
  ON_HOLD: { label: "Paused", cls: "bg-warning/20 text-warning-foreground" },
  COMPLETED: { label: "Shipped", cls: "bg-muted text-muted-foreground" },
  ARCHIVED: { label: "Archived", cls: "bg-muted text-muted-foreground" },
  on_track: { label: "On track", cls: "bg-success/15 text-success" },
  at_risk: { label: "At risk", cls: "bg-warning/20 text-warning-foreground" },
  off_track: { label: "Needs rescue", cls: "bg-destructive/15 text-destructive" },
  completed: { label: "Shipped", cls: "bg-muted text-muted-foreground" },
};

const statusOptions = [
  { value: "all", label: "All projects" },
  { value: "ACTIVE", label: "In play" },
  { value: "PLANNING", label: "Warming up" },
  { value: "ON_HOLD", label: "Paused" },
  { value: "COMPLETED", label: "Shipped" },
  { value: "ARCHIVED", label: "Archived" },
];

type ViewMode = "grid" | "list";
type SortMode = "energy" | "name" | "tasks";

type ProjectWithComputed = NexusProject & {
  dueDate?: string | null;
  updatedAt?: string | null;
  owner?: {
    user?: { name?: string | null; email?: string | null } | null;
    name?: string | null;
    email?: string | null;
  } | null;
  totalTasksComputed: number;
  completedTasksComputed: number;
  progressComputed: number;
  memberIds: string[];
  taskListCount: number;
};

function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("energy");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectWorkspaceId, setNewProjectWorkspaceId] = useState("");
  // New project, step one (owner, 9 Oct 2026): what the project is for. null = the picker is showing.
  const [newProjectType, setNewProjectType] = useState<ProjectTypeId | null>(null);
  // The folder a new project goes into (from a folder's "New project here"); null = no folder.
  const [newProjectFolderId, setNewProjectFolderId] = useState<string | null>(null);
  // Set up in the same dialog (owner, 11 Oct 2026): the tabs a Task Project starts without (same keys
  // and Board-or-List rule as Project settings → Tabs) and the people added next to the creator.
  const [newProjectHiddenTabs, setNewProjectHiddenTabs] = useState<string[]>([]);
  const [newProjectMemberIds, setNewProjectMemberIds] = useState<string[]>([]);
  const { t: tr } = useLang();

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: nexusApi.projects, retry: 1 });
  const projects: NexusProject[] = projectsQuery.data?.length
    ? projectsQuery.data
    : fallbackProjects.map(
        (p) =>
          ({
            id: p.id,
            name: p.name,
            description: p.description,
            color: p.color,
            icon: p.emoji,
            status: p.status,
            totalTasks: p.taskCount,
            completedTasks: Math.round((p.progress / 100) * p.taskCount),
            progress: p.progress,
            members: p.members.map((id) => ({ userId: id })),
          }) satisfies NexusProject,
      );

  const computedProjects = useMemo<ProjectWithComputed[]>(() => {
    return projects.map((p) => {
      const taskListTasks = (p.taskLists ?? []).flatMap((list) => list.tasks ?? []);
      const totalTasks = p.totalTasks ?? p._count?.tasks ?? taskListTasks.length ?? 0;
      const completedTasks =
        p.completedTasks ??
        taskListTasks.filter((task) =>
          ["DONE", "COMPLETED"].includes(String(task.status || "").toUpperCase()),
        ).length;
      const progress =
        p.progress ?? (totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0);
      const memberIds = (p.members ?? [])
        .map((m) => m.userId || m.user?.id)
        .filter(Boolean) as string[];
      return {
        ...p,
        totalTasksComputed: totalTasks,
        completedTasksComputed: completedTasks,
        progressComputed: progress,
        memberIds,
        taskListCount: p._count?.taskLists ?? p.taskLists?.length ?? 0,
      };
    });
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return computedProjects
      .filter((p) => {
        const statusMatch =
          statusFilter === "all" || String(p.status || "ACTIVE").toUpperCase() === statusFilter;
        if (!statusMatch) return false;
        if (!needle) return true;
        const ownerName =
          p.owner?.user?.name || p.owner?.name || p.owner?.user?.email || p.owner?.email || "";
        const haystack = [
          p.name,
          p.description,
          p.status,
          ownerName,
          p.taskLists?.map((list) => list.name).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.name.localeCompare(b.name);
        if (sortMode === "tasks") return b.totalTasksComputed - a.totalTasksComputed;
        return b.progressComputed - a.progressComputed;
      });
  }, [computedProjects, query, sortMode, statusFilter]);

  const totalTasks = computedProjects.reduce((sum, p) => sum + p.totalTasksComputed, 0);
  const totalCompleted = computedProjects.reduce((sum, p) => sum + p.completedTasksComputed, 0);
  const liveProgress = totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0;
  const activeFilters = [query.trim(), statusFilter !== "all" ? statusFilter : ""].filter(
    Boolean,
  ).length;
  const workspaceOptions = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => {
      if (project.workspaceId) map.set(project.workspaceId, `${project.name} workspace`);
    });
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [projects]);

  // One company pipeline (owner/GM, 9 Oct 2026): who may see it, and the board itself once it exists.
  const pipelineInfo = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 }).data;
  const openPipelineBoard = (projectId: string) => {
    setIsCreateOpen(false);
    setNewProjectType(null);
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  const createProject = useMutation({
    mutationFn: () =>
      nexusApi.createProject({
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || null,
        workspaceId: newProjectWorkspaceId || workspaceOptions[0]?.id || "",
        type: newProjectType ?? "TASK",
        ...(newProjectFolderId ? { folderId: newProjectFolderId } : {}),
        ...((newProjectType ?? "TASK") === "TASK" && newProjectHiddenTabs.length > 0 ? { hiddenTabs: newProjectHiddenTabs } : {}),
        ...(newProjectMemberIds.length > 0 ? { memberIds: newProjectMemberIds } : {}),
      }),
    onSuccess: async (project) => {
      invalidateProjectData(queryClient);
      setIsCreateOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
      setNewProjectHiddenTabs([]);
      setNewProjectMemberIds([]);
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
    // Someone made the board a moment ago (or this page's copy of the roster is stale): open that one.
    onError: (error) => {
      const payload = (error as { payload?: { code?: unknown; projectId?: unknown } } | null)?.payload;
      if (payload?.code === "PIPELINE_EXISTS" && typeof payload.projectId === "string") {
        queryClient.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
        openPipelineBoard(payload.projectId);
      }
    },
  });

  const createErrorKnown = projectSettingsErrorText((createProject.error as { payload?: { code?: unknown } } | null)?.payload?.code);
  const createErrorMessage = createErrorKnown
    ? tr(createErrorKnown)
    : createProject.error instanceof Error
      ? createProject.error.message
      : "Create failed. Check session and workspace permission.";

  const openCreate = (folderId: string | null = null) => {
    if (!newProjectWorkspaceId && workspaceOptions[0]) setNewProjectWorkspaceId(workspaceOptions[0].id);
    setNewProjectType(null);
    setNewProjectFolderId(folderId);
    setNewProjectHiddenTabs([]);
    setNewProjectMemberIds([]);
    setIsCreateOpen(true);
  };
  const search = Route.useSearch();
  useEffect(() => {
    if (search.new !== 1) return;
    openCreate(search.folder ?? null);
    navigate({ to: "/projects", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.new]);

  // ---- Project folders (grouping) ----
  // Folders + role are scoped to the SAME workspace (the one new folders are created in) so the gate and
  // the create target never disagree. The folder API allows BOD / MANAGER / ONE_ABOVE_ALL, so we mirror
  // that exactly (>= MANAGER), not BoD-only.
  const primaryWorkspaceId = workspaceOptions[0]?.id ?? projects.find((p) => p.workspaceId)?.workspaceId ?? "";
  const foldersQuery = useQuery({ queryKey: ["project-folders", primaryWorkspaceId || "all"], queryFn: () => nexusApi.projectFolders(primaryWorkspaceId || undefined), retry: false });
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members", primaryWorkspaceId || "any"], queryFn: () => nexusApi.workspaceMembers(primaryWorkspaceId || undefined), retry: false, staleTime: 300_000 });
  const canManageFolders = !!primaryWorkspaceId && (ORG_HIERARCHY[wsm.data?.role ?? ""] ?? 0) >= (ORG_HIERARCHY.MANAGER ?? 2);
  const folderList = useMemo(
    () => (foldersQuery.data ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)),
    [foldersQuery.data],
  );

  // Map each folder → its DIRECT projects (the tree is rendered recursively below). Empty folders stay
  // visible to managers so they can be filled / get subfolders.
  const grouped = useMemo(() => {
    const byFolder = new Map<string, ProjectWithComputed[]>();
    for (const p of visibleProjects) {
      const k = p.folderId ?? "__none__";
      const arr = byFolder.get(k) ?? [];
      arr.push(p);
      byFolder.set(k, arr);
    }
    return { byFolder, none: byFolder.get("__none__") ?? [] };
  }, [visibleProjects]);

  // Folders start closed; the ones you open are remembered per browser (owner, 10 Oct 2026).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(EXPANDED_KEY) : null;
      const ids = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const setExpandedFor = (id: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const n = new Set(prev);
      if (open) n.add(id); else n.delete(id);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...n])); } catch { /* a convenience only */ }
      return n;
    });
  const toggleExpand = (id: string) => setExpandedFor(id, !expanded.has(id));

  // Move, pin, edit, delete: the same actions and dialogs as the sidebar (components/projects/project-tree).
  const { actions: tree, dialogs: treeDialogs } = useProjectTreeActions({ folders: folderList, canManage: canManageFolders, workspaceId: primaryWorkspaceId });
  const onMoveProject = (p: NexusProject, folderId: string | null) => tree.moveProject(p, folderId);

  // ── Drag & drop: a project card/row or a folder header onto a folder (in), or onto "No folder" (out).
  //    Shares its drag with the sidebar, so a card can also be dropped on a sidebar folder.
  const drag = useTreeDrag();
  const [dropTarget, setDropTarget] = useState<string | null>(null); // hovered folder id, or "__none__"
  useEffect(() => { if (!drag) setDropTarget(null); }, [drag]);
  const projectDragHandlers = (p: NexusProject): DragProps =>
    canManageFolders
      ? { draggable: true, onDragStart: (e) => startTreeDrag(e, { kind: "project", id: p.id, from: p.folderId ?? null }), onDragEnd: () => endTreeDrag() }
      : {};
  const folderDragHandlers = (f: NexusProjectFolder): DragProps =>
    canManageFolders
      ? { draggable: true, onDragStart: (e) => startTreeDrag(e, { kind: "folder", id: f.id, from: f.parentFolderId ?? null }), onDragEnd: () => endTreeDrag() }
      : {};
  const folderDropHandlers = (folderId: string | null): DropProps => {
    if (!canManageFolders) return {};
    const key = folderId ?? "__none__";
    return {
      onDragOver: (e) => {
        if (!isTreeDrag(e.dataTransfer.types)) return;
        if (drag && !canDropInto(drag, folderId, folderList)) {
          // Over the folder it is already in: no drop here, and not in the folder around it either.
          if (drag.from === folderId) e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation(); // the innermost folder wins, not every section around it
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropTarget((t) => (t === key ? null : t));
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = dragFromDrop(e.dataTransfer);
        endTreeDrag();
        if (!d || !canDropInto(d, folderId, folderList)) return;
        if (d.kind === "project") {
          const p = projects.find((x) => x.id === d.id);
          if (p) onMoveProject(p, folderId);
        } else {
          const f = folderList.find((x) => x.id === d.id);
          if (f) tree.moveFolder(f, folderId);
        }
      },
    };
  };

  return (
    <div>
      <PageHeader
        title="Mission Control"
        subtitle={
          projectsQuery.data
            ? "Live projects from NEXUS Phaëthon — pick a workstream and make it move."
            : "Preview mode with fun NEXUS project cards."
        }
        actions={
          <>
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tr("Search projects, owners, lanes…")}
                variant="secondary"
                className="w-full pl-7 text-sm"
              />
            </div>
            <Button
              isIconOnly
              size="sm"
              variant={viewMode === "grid" ? "primary" : "outline"}
              onPress={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant={viewMode === "list" ? "primary" : "outline"}
              onPress={() => setViewMode("list")}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
            {canManageFolders && (
              <Button
                size="sm"
                variant="outline"
                onPress={() => tree.newFolder(null)}
                aria-label={tr("New folder")}
              >
                <FolderPlus className="h-3.5 w-3.5" /> {tr("Folder")}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onPress={() => openCreate()}
            >
              <Plus className="h-3.5 w-3.5" /> {tr("New project")}
            </Button>
          </>
        }
      />

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/35 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-[32px] border border-border bg-card p-5 shadow-pop">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Real NEXUS project
                </div>
                <h2 className="mt-3 text-2xl font-black tracking-tight">{tr("Create a new project")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Creates a real project, adds default lanes, then drops you into the board.
                </p>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Close create project"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {newProjectType === null ? (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-semibold">{tr("What is this project for?")}</p>
                <ProjectTypePicker
                  onPick={(type) => setNewProjectType(type)}
                  pipeline={pipelineInfo ? { allowed: pipelineInfo.canAccessPipeline === true, exists: !!pipelineInfo.pipelineProjectId } : undefined}
                />
              </div>
            ) : (
            <div className="mt-5 space-y-3">
              <ProjectTypeChosen type={newProjectType} onChange={() => setNewProjectType(null)} />
              {newProjectFolderId && folderList.some((f) => f.id === newProjectFolderId) && (
                <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
                  <FolderGlyph folder={folderList.find((f) => f.id === newProjectFolderId)!} size={14} className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {tr("Inside “{name}”.", { name: folderPath(folderList.find((f) => f.id === newProjectFolderId)!, new Map(folderList.map((f) => [f.id, f]))) })}
                  </span>
                  <button type="button" onClick={() => setNewProjectFolderId(null)} className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">{tr("No folder")}</button>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {tr("Project name")}
                  <input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. Jagain Launch Ops"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="block text-xs font-semibold text-muted-foreground">
                Brief
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder={tr("What's the project, who owns it, and what should move first?")}
                  className="mt-1 min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              {/* Workspace picker only matters when you belong to >1 workspace. With a single workspace
                  (the normal case) it's auto-selected and hidden — a project always lives in your one space. */}
              {workspaceOptions.length > 1 && (
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Workspace
                    <select
                      value={newProjectWorkspaceId}
                      onChange={(e) => { setNewProjectWorkspaceId(e.target.value); setNewProjectMemberIds([]); }}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select workspace…</option>
                      {workspaceOptions.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

              {newProjectType === "TASK" && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">{tr("Tabs")}</div>
                  <p className="text-xs text-muted-foreground">{tr("The tabs this project starts with. You can change them later in Project settings.")}</p>
                  <TabPreviewCards hidden={newProjectHiddenTabs} onChange={setNewProjectHiddenTabs} />
                </div>
              )}

              {(newProjectWorkspaceId || workspaceOptions[0]?.id) && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">{tr("Members")}{newProjectMemberIds.length > 0 && ` · ${newProjectMemberIds.length}`}</div>
                  <p className="text-xs text-muted-foreground">{tr("Optional. You lead the project; the people you pick join as members.")}</p>
                  <MemberMultiPicker workspaceId={newProjectWorkspaceId || workspaceOptions[0]?.id || ""} value={newProjectMemberIds} onChange={setNewProjectMemberIds} />
                </div>
              )}

              {!workspaceOptions.length && (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  No workspace visible yet. Login/session must load projects with workspaceId before
                  creating a project.
                </p>
              )}
              {createProject.isError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {createErrorMessage}
                </p>
              )}

              <Button
                isDisabled={
                  !newProjectName.trim() || !(newProjectWorkspaceId || workspaceOptions[0]?.id) || createProject.isPending
                }
                onPress={() => createProject.mutate()}
                variant="primary"
                className="w-full font-bold"
              >
                {createProject.isPending ? tr("Creating project…") : newProjectType === "PIPELINE" ? tr("Create project + open pipeline") : newProjectType === "OUTLET_SALES" ? tr("Create project + open dashboard") : tr("Create project + open board")}
              </Button>
            </div>
            )}
          </div>
        </div>
      )}

      <div className="p-4 md:p-8 space-y-5">
        <section className="rounded-[28px] border border-border bg-card p-4 md:p-5 shadow-soft overflow-hidden relative">
          <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-primary/10" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" /> {tr("{shown}/{n} projects visible", { shown: visibleProjects.length, n: computedProjects.length })}
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">
                Choose the board, then move the cards.
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Project cards now act as clear launchpads into Kanban, pages, calendar, and
                timeline.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 min-w-[280px]">
              <MiniStat
                icon={<Target className="h-4 w-4" />}
                label="Mission energy"
                value={`${liveProgress}%`}
              />
              <MiniStat
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Slayed cards"
                value={`${totalCompleted}`}
              />
              <MiniStat
                icon={<Users className="h-4 w-4" />}
                label="Crew seats"
                value={`${computedProjects.reduce((sum, p) => sum + p.memberIds.length, 0)}`}
              />
            </div>
          </div>

          <div className="relative mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              </span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-full border border-border bg-background px-3 py-1.5"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === "all" ? tr(option.label) : option.label}
                  </option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="rounded-full border border-border bg-background px-3 py-1.5"
              >
                <option value="energy">Sort by energy</option>
                <option value="tasks">Sort by task load</option>
                <option value="name">Sort A-Z</option>
              </select>
              {activeFilters > 0 && (
                <button
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" /> reset {activeFilters}
                </button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {tr("Click any project card to enter its live board.")}
            </div>
          </div>
        </section>

        {(() => {
          const renderItems = (items: ProjectWithComputed[]) =>
            viewMode === "grid" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((p, i) => (
                  <Reveal key={p.id} delay={Math.min(i, 8) * 0.04} className="h-full">
                    <ProjectContextMenu project={p} actions={tree}>
                      <ProjectCard project={p} folders={folderList} canMove={canManageFolders} onMove={(fid) => onMoveProject(p, fid)} dragProps={projectDragHandlers(p)} dragging={drag?.kind === "project" && drag.id === p.id} />
                    </ProjectContextMenu>
                  </Reveal>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-soft">
                <div className="divide-y divide-border">
                  {items.map((p) => (
                    <ProjectContextMenu key={p.id} project={p} actions={tree}>
                      <ProjectRow project={p} folders={folderList} canMove={canManageFolders} onMove={(fid) => onMoveProject(p, fid)} dragProps={projectDragHandlers(p)} dragging={drag?.kind === "project" && drag.id === p.id} />
                    </ProjectContextMenu>
                  ))}
                </div>
              </div>
            );

          if (visibleProjects.length === 0) {
            return (
              <EmptyState icon={Search} tone="muted" title={tr("No project matches that")}
                message={tr("Try another project name, owner or lane — or clear the search to see every project you're part of.")} />
            );
          }

          // No folders configured → flat list (original behaviour).
          if (folderList.length === 0) return <Reveal>{renderItems(visibleProjects)}</Reveal>;

          // Nested folder tree: each folder shows its subfolders (recursive) then its own projects.
          const renderFolderTree = (parentId: string | null, depth: number): React.ReactNode =>
            folderList
              .filter((f) => (f.parentFolderId ?? null) === parentId)
              .map((folder) => {
                const items = grouped.byFolder.get(folder.id) ?? [];
                const subCount = folderList.filter((f) => (f.parentFolderId ?? null) === folder.id).length;
                if (!canManageFolders && items.length === 0 && subCount === 0) return null;
                return (
                  <FolderSection
                    key={folder.id}
                    folder={folder}
                    depth={depth}
                    count={items.length + subCount}
                    collapsed={!expanded.has(folder.id)}
                    onToggle={() => toggleExpand(folder.id)}
                    actions={tree}
                    dragProps={folderDragHandlers(folder)}
                    dragging={drag?.kind === "folder" && drag.id === folder.id}
                    dropProps={folderDropHandlers(folder.id)}
                    isDropTarget={dropTarget === folder.id}
                  >
                    {renderFolderTree(folder.id, depth + 1)}
                    {items.length ? renderItems(items) : (subCount === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted-foreground">{canManageFolders ? tr("Empty folder — drag a project in here, or make a subfolder.") : tr("Nothing here yet")}</p>
                    ) : null)}
                  </FolderSection>
                );
              });

          return (
            <div className="space-y-4">
              {renderFolderTree(null, 0)}
              {(grouped.none.length > 0 || (drag && canManageFolders && canDropInto(drag, null, folderList))) && (
                <FolderSection
                  folder={null}
                  depth={0}
                  count={grouped.none.length}
                  collapsed={!expanded.has("__none__")}
                  onToggle={() => toggleExpand("__none__")}
                  actions={tree}
                  dropProps={folderDropHandlers(null)}
                  isDropTarget={dropTarget === "__none__"}
                >
                  {renderItems(grouped.none)}
                </FolderSection>
              )}
            </div>
          );
        })()}
      </div>

      {treeDialogs}
    </div>
  );
}

type DragProps = { draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: (e: React.DragEvent) => void };
type DropProps = { onDragOver?: (e: React.DragEvent) => void; onDragLeave?: (e: React.DragEvent) => void; onDrop?: (e: React.DragEvent) => void };

function ProjectCard({ project: p, folders, canMove, onMove, dragProps, dragging }: { project: ProjectWithComputed; folders: NexusProjectFolder[]; canMove: boolean; onMove: (folderId: string | null) => void; dragProps?: DragProps; dragging?: boolean }) {
  const s = statusBadge[p.status || "ACTIVE"] || statusBadge.ACTIVE;
  const dueLabel = p.dueDate
    ? new Date(p.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : "No deadline";
  return (
    <Link
      key={p.id}
      to="/projects/$projectId"
      params={{ projectId: p.id }}
      className={cn("group block h-full", dragging && "opacity-40", dragProps?.draggable && "cursor-grab active:cursor-grabbing")}
      {...dragProps}
    >
      <Card className="relative min-h-[250px] overflow-hidden rounded-[28px] border border-border bg-card shadow-soft transition-all group-hover:border-primary/30 group-hover:shadow-pop">
        <CardBody className="flex h-full flex-col p-5">
          <div
            className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-10"
            style={{ background: p.color || "#a168be" }}
          />
          <div className="absolute right-5 bottom-5 opacity-0 translate-x-2 transition group-hover:translate-x-0 group-hover:opacity-100 text-primary">
            <ArrowRight className="h-5 w-5" />
          </div>
          <div className="flex items-start gap-3 relative">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-muted text-2xl">
              <ProjectMark icon={p.icon} color={p.color} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold tracking-tight transition group-hover:text-primary">
                {p.name}
              </h3>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {p.description || "No brief yet — add one and make the mission clearer."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Chip size="sm" variant="soft" className={s.cls}>
                {s.label}
              </Chip>
              {canMove && folders.length > 0 && (
                <MoveToFolderMenu currentFolderId={p.folderId ?? null} folders={folders} onMove={onMove} />
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <BadgeMetric label="Cards" value={`${p.totalTasksComputed}`} />
            <BadgeMetric label="Done" value={`${p.completedTasksComputed}`} />
            <BadgeMetric label="Lanes" value={`${p.taskListCount}`} />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{p.progressComputed}% mission energy</span>
              <span>{p.totalTasksComputed - p.completedTasksComputed} left</span>
            </div>
            <ProgressBar
              value={p.progressComputed}
              color={
                p.status === "off_track"
                  ? "bg-destructive"
                  : p.status === "at_risk"
                    ? "bg-warning"
                    : "bg-success"
              }
            />
          </div>

          <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
            {p.memberIds.length ? (
              <AvatarStack ids={p.memberIds} size={22} max={4} />
            ) : (
              <span className="text-[11px]">Solo quest</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" /> {dueLabel}
            </span>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

function ProjectRow({ project: p, folders, canMove, onMove, dragProps, dragging }: { project: ProjectWithComputed; folders: NexusProjectFolder[]; canMove: boolean; onMove: (folderId: string | null) => void; dragProps?: DragProps; dragging?: boolean }) {
  const s = statusBadge[p.status || "ACTIVE"] || statusBadge.ACTIVE;
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: p.id }}
      className={cn("group grid gap-3 p-4 hover:bg-accent/50 transition md:grid-cols-[1.5fr_0.7fr_0.9fr_0.7fr_auto] md:items-center", dragging && "opacity-40", dragProps?.draggable && "cursor-grab active:cursor-grabbing")}
      {...dragProps}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-muted text-xl shrink-0">
          <ProjectMark icon={p.icon} color={p.color} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate group-hover:text-primary">{p.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {p.description || "No project brief yet."}
          </div>
        </div>
      </div>
      <Chip size="sm" variant="soft" className={s.cls}>
        {s.label}
      </Chip>
      <div>
        <ProgressBar value={p.progressComputed} color="bg-success" />
        <div className="mt-1 text-[11px] text-muted-foreground">{p.progressComputed}% energy</div>
      </div>
      <div className="text-xs text-muted-foreground">
        {p.completedTasksComputed}/{p.totalTasksComputed} slayed · {p.taskListCount} lanes
      </div>
      <div className="flex items-center justify-end gap-1">
        {canMove && folders.length > 0 && (
          <MoveToFolderMenu currentFolderId={p.folderId ?? null} folders={folders} onMove={onMove} />
        )}
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
      </div>
    </Link>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/80 p-3">
      <div className="text-primary">{icon}</div>
      <div className="mt-2 text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function BadgeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-2">
      <div className="font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

// Small folder-picker on a project card/row. The card is a <Link>, so we preventDefault to stop it
// navigating — but that ALSO makes Radix skip its own open-toggle, so we toggle `open` manually here.
function MoveToFolderMenu({ currentFolderId, folders, onMove }: { currentFolderId: string | null; folders: NexusProjectFolder[]; onMove: (folderId: string | null) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const pick = (e: React.MouseEvent, folderId: string | null) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onMove(folderId); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-primary hover:text-primary"
          title={t("Move to folder…")}
          aria-label={t("Move to folder…")}
        >
          <Folder className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{t("Move to folder…")}</div>
        <div className="max-h-64 overflow-y-auto">
          <button type="button" onClick={(e) => pick(e, null)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            <span className="grid h-4 w-4 place-items-center">{currentFolderId === null && <Check className="h-3.5 w-3.5 text-primary" />}</span>
            <span className="text-muted-foreground">{t("No folder")}</span>
          </button>
          {(() => {
            const byId = new Map(folders.map((f) => [f.id, f]));
            return folders
              .map((f) => ({ f, path: folderPath(f, byId) }))
              .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))
              .map(({ f, path }) => (
                <button key={f.id} type="button" onClick={(e) => pick(e, f.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <span className="grid h-4 w-4 shrink-0 place-items-center">{currentFolderId === f.id && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                  <FolderGlyph folder={f} size={16} className="text-muted-foreground" />
                  <span className="truncate" title={path}>{path}</span>
                </button>
              ));
          })()}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Right click on a project card or row: the same menu as in the sidebar.
function ProjectContextMenu({ project, actions, children }: { project: NexusProject; actions: TreeActions; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild><div className="h-full">{children}</div></ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <TreeMenuBody kind="context" title={project.name} glyph={<ProjectGlyph project={project} size={14} />} entries={projectMenuEntries(project, actions, t)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderSection({ folder, count, collapsed, onToggle, actions, depth = 0, children, dragProps, dragging, dropProps, isDropTarget }: {
  folder: NexusProjectFolder | null; count: number; collapsed: boolean; onToggle: () => void;
  actions: TreeActions; depth?: number; children: React.ReactNode;
  dragProps?: DragProps; dragging?: boolean; dropProps?: DropProps; isDropTarget?: boolean;
}) {
  const { t } = useLang();
  const entries = folder ? folderMenuEntries(folder, actions, t) : [];
  const header = (
    // The whole header row opens / closes the folder (owner, 10 Oct 2026), not only the arrow; the
    // name still opens the folder view and the menu keeps its own clicks.
    <div
      {...dragProps}
      className={cn("flex cursor-pointer items-center gap-2 px-1", dragProps?.draggable && "active:cursor-grabbing")}
      onClick={(e) => {
        // Clicks from the menu bubble here through its portal: only clicks on the row itself count.
        const el = e.target as HTMLElement;
        if (e.currentTarget.contains(el) && !el.closest("a,button")) onToggle();
      }}
    >
      <button type="button" onClick={onToggle} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent" aria-expanded={!collapsed} aria-label={collapsed ? t("Open folder") : t("Close folder")}>
        <ChevronRight className={cn("h-4 w-4 transition-transform duration-150", !collapsed && "rotate-90")} />
      </button>
      {folder ? (
        <Link to="/folders/$folderId" params={{ folderId: folder.id }} draggable={false} className="flex min-w-0 items-center gap-2 transition hover:text-primary" title={t("Open folder view")}>
          <FolderGlyph folder={folder} open={!collapsed} size={20} className={cn(!folder.color && "text-muted-foreground")} />
          <h3 className="truncate font-semibold tracking-tight" title={folder.name}>{folder.name}</h3>
        </Link>
      ) : (
        <>
          <Inbox className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="truncate font-semibold tracking-tight">{t("No folder")}</h3>
        </>
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
      {folder && (
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent" aria-label={t("More for {name}", { name: folder.name })}>
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <TreeMenuBody kind="dropdown" title={folder.name} glyph={<FolderGlyph folder={folder} size={14} />} entries={entries} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
  return (
    <section
      {...dropProps}
      className={cn(
        "border p-3 shadow-soft transition-colors",
        depth > 0 ? "mt-3 rounded-2xl bg-card/20" : "rounded-[28px] bg-card/40",
        isDropTarget ? "border-primary bg-primary/5 ring-2 ring-primary/40" : "border-border",
        dragging && "opacity-50",
      )}
    >
      {folder ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent className="w-60">
            <TreeMenuBody kind="context" title={folder.name} glyph={<FolderGlyph folder={folder} size={14} />} entries={entries} />
          </ContextMenuContent>
        </ContextMenu>
      ) : header}
      {!collapsed && <div className="mt-3">{children}</div>}
    </section>
  );
}
