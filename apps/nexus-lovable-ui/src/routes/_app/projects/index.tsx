import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent as CardBody, Chip, Input } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { AvatarStack } from "@/components/Avatar";
import { ProgressBar } from "@/components/StatusPill";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { projects as fallbackProjects } from "@/lib/mock-data";
import { nexusApi, ORG_HIERARCHY, type NexusProject, type NexusProjectFolder } from "@/lib/nexus-api";
import { folderPath } from "@/lib/folder-tree-client";
import { invalidateProjectData } from "@/lib/invalidate";
import { Reveal } from "@/components/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  FolderPlus,
  ImagePlus,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_app/projects/")({ component: ProjectsPage });

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
  { value: "all", label: "All missions" },
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
  const [newProjectIcon, setNewProjectIcon] = useState("🚀");
  const [newProjectColor, setNewProjectColor] = useState("#a168be");
  const [newProjectWorkspaceId, setNewProjectWorkspaceId] = useState("");

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

  const createProject = useMutation({
    mutationFn: () =>
      nexusApi.createProject({
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || null,
        icon: newProjectIcon.trim() || "🚀",
        color: newProjectColor,
        workspaceId: newProjectWorkspaceId || workspaceOptions[0]?.id || "",
      }),
    onSuccess: async (project) => {
      invalidateProjectData(queryClient);
      setIsCreateOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
  });

  const createErrorMessage =
    createProject.error instanceof Error
      ? createProject.error.message
      : "Create failed. Check session and workspace permission.";

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

  // Default = semua folder group KETUTUP (collapsed). Kita track set `expanded` (kosong = semua ketutup),
  // jadi folder yang baru muncul pun otomatis ketutup sampai user buka manual.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const [folderForm, setFolderForm] = useState<{ mode: "create" | "edit"; id?: string; name: string; icon: string; color: string; parentId?: string | null; parentName?: string; iconFile?: File | null } | null>(null);
  const invalidateFolders = () => invalidateProjectData(queryClient);
  const folderSave = useMutation({
    mutationFn: async (f: { mode: "create" | "edit"; id?: string; name: string; icon: string; color: string; parentId?: string | null; iconFile?: File | null }) => {
      // Don't overwrite an uploaded photo with the emoji field unless the user actually changed it:
      // when icon is an uploaded URL we keep it as-is (backend stores the URL in the same column).
      const saved = f.mode === "create"
        ? await nexusApi.projectFolderCreate(primaryWorkspaceId, { name: f.name.trim(), icon: f.icon, color: f.color, parentFolderId: f.parentId ?? null })
        : await nexusApi.projectFolderUpdate(f.id!, { name: f.name.trim(), icon: f.icon, color: f.color });
      // Photo picked? Upload AFTER save — create mode needs the new folder's id first.
      const folderId = f.mode === "create" ? saved?.id : f.id;
      if (f.iconFile && folderId) await nexusApi.uploadFolderIcon(folderId, f.iconFile);
      return saved;
    },
    onSuccess: () => { invalidateFolders(); setFolderForm(null); },
    onError: (e: unknown) => toast.error("Gagal simpan folder", { description: e instanceof Error ? e.message : undefined }),
  });
  const folderDelete = useMutation({
    mutationFn: (id: string) => nexusApi.projectFolderDelete(id),
    onSuccess: () => { invalidateFolders(); toast.success("Folder dihapus — project-nya jadi tanpa folder"); },
    onError: (e: unknown) => toast.error("Gagal hapus folder", { description: e instanceof Error ? e.message : undefined }),
  });
  const moveProject = useMutation({
    mutationFn: ({ projectId, folderId }: { projectId: string; folderId: string | null }) => nexusApi.updateProject(projectId, { folderId }),
    onSuccess: () => { invalidateProjectData(queryClient); },
    onError: (e: unknown) => toast.error("Gagal pindah project", { description: e instanceof Error ? e.message : undefined }),
  });
  const onMoveProject = (projectId: string, folderId: string | null) => moveProject.mutate({ projectId, folderId });

  // ── Drag & drop: drag a project card/row onto a folder section to move it IN (or onto "Tanpa folder"
  //    to pull it OUT). Mirrors the sidebar's native-HTML5 DnD; gated to folder managers like the move
  //    menu. Cards are <Link>s, but a drag never fires a click, so navigation isn't triggered.
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // hovered folder id, or "__none__"
  const projectDragHandlers = (projectId: string): DragProps =>
    canManageFolders
      ? {
          draggable: true,
          onDragStart: (e) => { setDragProjectId(projectId); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", projectId); } catch { /* ignore */ } },
          onDragEnd: () => { setDragProjectId(null); setDropTarget(null); },
        }
      : {};
  const folderDropHandlers = (folderId: string | null): DropProps => {
    if (!canManageFolders) return {};
    const key = folderId ?? "__none__";
    return {
      onDragOver: (e) => { if (dragProjectId) { e.preventDefault(); setDropTarget(key); } },
      onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
      onDrop: (e) => { e.preventDefault(); const pid = dragProjectId; setDragProjectId(null); setDropTarget(null); if (pid) onMoveProject(pid, folderId); },
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
                placeholder="Search missions, owners, lanes…"
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
                onPress={() => setFolderForm({ mode: "create", name: "", icon: "📁", color: "#7B2FBE" })}
                aria-label="New folder"
              >
                <FolderPlus className="h-3.5 w-3.5" /> Folder
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onPress={() => {
                if (!newProjectWorkspaceId && workspaceOptions[0])
                  setNewProjectWorkspaceId(workspaceOptions[0].id);
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New mission
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
          <div className="w-full max-w-lg rounded-[32px] border border-border bg-card p-5 shadow-pop">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Real NEXUS project
                </div>
                <h2 className="mt-3 text-2xl font-black tracking-tight">Launch a new mission</h2>
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

            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-[72px_1fr] gap-3">
                <label className="text-xs font-semibold text-muted-foreground">
                  Icon
                  <input
                    value={newProjectIcon}
                    onChange={(e) => setNewProjectIcon(e.target.value)}
                    maxLength={8}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-center text-xl"
                  />
                </label>
                <label className="text-xs font-semibold text-muted-foreground">
                  Mission name
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
                  placeholder="What's the mission, who owns it, and what should move first?"
                  className="mt-1 min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              {/* Workspace picker only matters when you belong to >1 workspace. With a single workspace
                  (the normal case) it's auto-selected and hidden — a project always lives in your one space. */}
              <div className={cn("grid gap-3", workspaceOptions.length > 1 ? "md:grid-cols-[1fr_160px]" : "md:grid-cols-[160px]")}>
                {workspaceOptions.length > 1 && (
                  <label className="text-xs font-semibold text-muted-foreground">
                    Workspace
                    <select
                      value={newProjectWorkspaceId}
                      onChange={(e) => setNewProjectWorkspaceId(e.target.value)}
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
                <label className="text-xs font-semibold text-muted-foreground">
                  Color
                  <input
                    value={newProjectColor}
                    onChange={(e) => setNewProjectColor(e.target.value)}
                    type="color"
                    className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-2 py-1"
                  />
                </label>
              </div>

              {!workspaceOptions.length && (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  No workspace visible yet. Login/session must load projects with workspaceId before
                  creating a mission.
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
                {createProject.isPending ? "Creating mission…" : "Create mission + open board"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-8 space-y-5">
        <section className="rounded-[28px] border border-border bg-card p-4 md:p-5 shadow-soft overflow-hidden relative">
          <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-primary/10" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" /> {visibleProjects.length}/
                {computedProjects.length} missions visible
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
                    {option.label}
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
              Click any mission card to enter its live board.
            </div>
          </div>
        </section>

        {(() => {
          const renderItems = (items: ProjectWithComputed[]) =>
            viewMode === "grid" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((p, i) => (
                  <Reveal key={p.id} delay={Math.min(i, 8) * 0.04} className="h-full">
                    <ProjectCard project={p} folders={folderList} canMove={canManageFolders} onMove={(fid) => onMoveProject(p.id, fid)} dragProps={projectDragHandlers(p.id)} dragging={dragProjectId === p.id} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-soft">
                <div className="divide-y divide-border">
                  {items.map((p) => (
                    <ProjectRow key={p.id} project={p} folders={folderList} canMove={canManageFolders} onMove={(fid) => onMoveProject(p.id, fid)} dragProps={projectDragHandlers(p.id)} dragging={dragProjectId === p.id} />
                  ))}
                </div>
              </div>
            );

          if (visibleProjects.length === 0) {
            return (
              <div className="rounded-[28px] border border-dashed border-border bg-card p-10 text-center shadow-soft">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Search className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">No mission matches that signal.</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reset filters or search another project name, owner, or lane.
                </p>
              </div>
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
                    canManage={canManageFolders}
                    dropProps={folderDropHandlers(folder.id)}
                    isDropTarget={dropTarget === folder.id}
                    onEdit={() => setFolderForm({ mode: "edit", id: folder.id, name: folder.name, icon: folder.icon ?? "📁", color: folder.color ?? "#7B2FBE" })}
                    onDelete={() => folderDelete.mutate(folder.id)}
                    onNewSub={() => setFolderForm({ mode: "create", parentId: folder.id, parentName: folder.name, name: "", icon: "📁", color: "#7B2FBE" })}
                  >
                    {renderFolderTree(folder.id, depth + 1)}
                    {items.length ? renderItems(items) : (subCount === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted-foreground">Folder kosong — pindahin project ke sini, atau bikin subfolder.</p>
                    ) : null)}
                  </FolderSection>
                );
              });

          return (
            <div className="space-y-4">
              {renderFolderTree(null, 0)}
              {grouped.none.length > 0 && (
                <FolderSection
                  folder={null}
                  depth={0}
                  count={grouped.none.length}
                  collapsed={!expanded.has("__none__")}
                  onToggle={() => toggleExpand("__none__")}
                  canManage={false}
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

      {folderForm && (
        <FolderFormModal
          form={folderForm}
          saving={folderSave.isPending}
          canSave={!!folderForm.name.trim() && (folderForm.mode === "edit" || !!primaryWorkspaceId)}
          onChange={(patch) => setFolderForm((f) => (f ? { ...f, ...patch } : f))}
          onCancel={() => setFolderForm(null)}
          onSave={() => folderForm && folderSave.mutate(folderForm)}
        />
      )}
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
              <ProjectIcon icon={p.icon} />
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
          <ProjectIcon icon={p.icon} />
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
  const [open, setOpen] = useState(false);
  const pick = (e: React.MouseEvent, folderId: string | null) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onMove(folderId); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition hover:border-primary hover:text-primary"
          title="Pindah ke folder"
          aria-label="Pindah ke folder"
        >
          <Folder className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pindah ke folder</div>
        <div className="max-h-64 overflow-y-auto">
          <button type="button" onClick={(e) => pick(e, null)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            <span className="grid h-4 w-4 place-items-center">{currentFolderId === null && <Check className="h-3.5 w-3.5 text-primary" />}</span>
            <span className="text-muted-foreground">Tanpa folder</span>
          </button>
          {(() => {
            const byId = new Map(folders.map((f) => [f.id, f]));
            return folders
              .map((f) => ({ f, path: folderPath(f, byId) }))
              .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))
              .map(({ f, path }) => (
                <button key={f.id} type="button" onClick={(e) => pick(e, f.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <span className="grid h-4 w-4 shrink-0 place-items-center">{currentFolderId === f.id && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                  <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded">
                    <ProjectIcon icon={f.icon ?? "📁"} className="max-h-4 max-w-4 rounded object-cover" />
                  </span>
                  <span className="truncate">{path}</span>
                </button>
              ));
          })()}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FolderManageMenu({ name, onEdit, onDelete, onNewSub }: { name: string; onEdit: () => void; onDelete: () => void; onNewSub?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent" aria-label="Folder options">
          <MoreVertical className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1.5">
        {onNewSub && (
          <button type="button" onClick={() => { setOpen(false); onNewSub(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            <FolderPlus className="h-3.5 w-3.5" /> Subfolder baru
          </button>
        )}
        <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
          <Pencil className="h-3.5 w-3.5" /> Ubah folder
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); if (window.confirm(`Hapus folder "${name}"? Project di dalamnya jadi tanpa folder (nggak ikut kehapus).`)) onDelete(); }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Hapus folder
        </button>
      </PopoverContent>
    </Popover>
  );
}

function FolderSection({ folder, count, collapsed, onToggle, canManage, onEdit, onDelete, onNewSub, depth = 0, children, dropProps, isDropTarget }: {
  folder: NexusProjectFolder | null; count: number; collapsed: boolean; onToggle: () => void;
  canManage: boolean; onEdit?: () => void; onDelete?: () => void; onNewSub?: () => void; depth?: number; children: React.ReactNode;
  dropProps?: DropProps; isDropTarget?: boolean;
}) {
  return (
    <section
      {...dropProps}
      className={cn("border p-3 shadow-soft transition-colors", depth > 0 ? "mt-3 rounded-2xl bg-card/20" : "rounded-[28px] bg-card/40", isDropTarget ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "border-border")}
    >
      <div className="flex items-center gap-2 px-1">
        <button type="button" onClick={onToggle} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent" aria-label={collapsed ? "Expand folder" : "Collapse folder"}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: folder?.color || "#94a3b8" }} />
        {folder ? (
          <Link to="/folders/$folderId" params={{ folderId: folder.id }} className="flex min-w-0 items-center gap-2 transition hover:text-primary" title="Buka folder view (board + calendar gabungan)">
            <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md text-base leading-none">
              <ProjectIcon icon={folder.icon || "📁"} className="max-h-6 max-w-6 rounded-md object-cover" />
            </span>
            <h3 className="truncate font-bold tracking-tight">{folder.name}</h3>
          </Link>
        ) : (
          <>
            <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md text-base leading-none">
              <ProjectIcon icon="🗂️" className="max-h-6 max-w-6 rounded-md object-cover" />
            </span>
            <h3 className="truncate font-bold tracking-tight">Tanpa folder</h3>
          </>
        )}
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{count}</span>
        {canManage && folder && onEdit && onDelete && (
          <div className="ml-auto"><FolderManageMenu name={folder.name} onEdit={onEdit} onDelete={onDelete} onNewSub={onNewSub} /></div>
        )}
      </div>
      {!collapsed && <div className="mt-3">{children}</div>}
    </section>
  );
}

const FOLDER_COLORS = ["#7B2FBE", "#4EB301", "#2563EB", "#DB2777", "#F59E0B", "#10B981", "#0EA5E9", "#111827"];

function FolderFormModal({ form, saving, canSave, onChange, onCancel, onSave }: {
  form: { mode: "create" | "edit"; id?: string; name: string; icon: string; color: string; parentName?: string; iconFile?: File | null };
  saving: boolean; canSave: boolean;
  onChange: (patch: Partial<{ name: string; icon: string; color: string; iconFile: File | null }>) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Preview priority: freshly-picked file > already-uploaded URL > emoji input box.
  const pickedPreview = useMemo(() => (form.iconFile ? URL.createObjectURL(form.iconFile) : null), [form.iconFile]);
  useEffect(() => () => { if (pickedPreview) URL.revokeObjectURL(pickedPreview); }, [pickedPreview]);
  const uploadedUrl = !form.iconFile && form.icon.startsWith("/") ? form.icon : null;
  const photoPreview = pickedPreview ?? uploadedUrl;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-[28px] border border-border bg-card p-5 shadow-pop">
        <h2 className="text-lg font-black tracking-tight">{form.mode === "create" ? (form.parentName ? "Subfolder baru" : "Folder baru") : "Ubah folder"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{form.parentName ? `Di dalam folder "${form.parentName}". ` : ""}Kelompokin project biar Mission Control rapi.</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-10 w-12 shrink-0 rounded-xl border border-border object-cover" />
            ) : (
              <input value={form.icon} onChange={(e) => onChange({ icon: e.target.value.slice(0, 4) })} className="h-10 w-12 rounded-xl border border-border bg-background text-center text-xl outline-none focus:border-primary" aria-label="Emoji" />
            )}
            <input
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Nama folder"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && canSave && !saving) onSave(); }}
              className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          {/* foto folder — sama kaya icon project (PNG/JPG/SVG/WEBP maks 5MB) */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-accent">
              <ImagePlus className="h-3.5 w-3.5" />{photoPreview ? "Ganti foto" : "Upload foto"}
            </button>
            {photoPreview && (
              <button type="button" onClick={() => { onChange({ iconFile: null, icon: "📁" }); if (fileRef.current) fileRef.current.value = ""; }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />Pakai emoji lagi
              </button>
            )}
            <span className="text-[10px] text-muted-foreground">PNG/JPG/SVG/WEBP, maks 5MB</span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange({ iconFile: f }); }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => onChange({ color: c })} className={cn("h-7 w-7 rounded-full border-2 transition", form.color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")} style={{ background: c }} aria-label={`color ${c}`} />
            ))}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onPress={onCancel}>Batal</Button>
          <Button size="sm" variant="primary" isDisabled={!canSave || saving} onPress={onSave}>{saving ? "Nyimpen…" : "Simpan"}</Button>
        </div>
      </div>
    </div>
  );
}
