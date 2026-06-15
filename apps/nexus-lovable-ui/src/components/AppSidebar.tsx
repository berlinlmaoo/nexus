import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Inbox, MessageCircle, CheckSquare, Calendar, CalendarClock, FolderKanban,
  BookOpen, Users, Trophy, ClipboardCheck, Settings, Shield, FileText, Sparkles, Megaphone,
  Search, Plus, PanelLeftClose, ChevronRight, LogOut, Loader2, Pin, FolderPlus, Rocket,
} from "lucide-react";
import { useState, type ReactNode, type DragEvent } from "react";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import nexusLogo from "@/assets/nexus-logo.png";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nexusApi, type NexusProject, type NexusProjectFolder } from "@/lib/nexus-api";
import { ProjectRowMenu, FolderRowMenu, type SidebarActions } from "@/components/SidebarContextMenus";
import { canMoveInto } from "@/lib/folder-tree-client";
import { invalidateProjectData } from "@/lib/invalidate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const groups = [
  {
    label: "Home Base",
    items: [
      { title: "Oracle", url: "/oracle", icon: Sparkles },
      { title: "Morning Brief", url: "/dashboard", icon: LayoutDashboard },
      { title: "Messages", url: "/messages", icon: MessageCircle },
      { title: "Signal Inbox", url: "/inbox", icon: Inbox },
      { title: "My Mission", url: "/my-tasks", icon: CheckSquare },
      { title: "Pengajuan Saya", url: "/submissions", icon: FileText },
      { title: "Time Map", url: "/master-calendar", icon: Calendar },
      { title: "Room Booking", url: "/room-booking", icon: CalendarClock },
    ],
  },
  {
    label: "Missions",
    items: [
      { title: "Mission Control", url: "/projects", icon: FolderKanban },
      { title: "Social Approvals", url: "/social", icon: Megaphone },
      { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { title: "Knowledge Library", url: "/docs", icon: BookOpen },
    ],
  },
  {
    label: "Pulse Check",
    items: [
      { title: "Attendance Playground", url: "/attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Crew Hub", url: "/teams", icon: Users },
      { title: "Tuning Room", url: "/settings", icon: Settings },
      { title: "Control Room", url: "/admin", icon: Shield },
    ],
  },
];

type RowDnd = { draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };

function ProjectNavItem({ project, active, collapsed, depth = 0, pinned, onTogglePin, actions, dnd }: { project: NexusProject; active: boolean; collapsed: boolean; depth?: number; pinned?: boolean; onTogglePin?: () => void; actions?: SidebarActions; dnd?: RowDnd }) {
  // Nested-folder indentation: each level adds a step of left padding (only when expanded view).
  const indentStyle = !collapsed && depth > 0 ? { paddingLeft: 8 + depth * 12 } : undefined;
  const row = (
    <SidebarMenuItem className={cn("group/pin relative", dnd && "cursor-grab active:cursor-grabbing")} {...(dnd ?? {})}>
      <SidebarMenuButton asChild isActive={active} tooltip={project.name}>
        <Link to="/projects/$projectId" params={{ projectId: project.id }} draggable={false} style={indentStyle} className={cn("flex items-center gap-2", !collapsed && onTogglePin && "pr-6")}>
          {project.icon ? (
            <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded text-[13px] leading-none">
              <ProjectIcon icon={project.icon} className="max-h-4 max-w-4 object-cover" />
            </span>
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: project.color ?? "#7b68ee" }} />
          )}
          <span className="truncate">{project.name}</span>
        </Link>
      </SidebarMenuButton>
      {!collapsed && onTogglePin && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(); }}
          title={pinned ? "Lepas pin" : "Pin ke atas"}
          aria-label={pinned ? "Unpin project" : "Pin project"}
          className={cn(
            "absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded transition-opacity hover:text-foreground",
            pinned ? "text-primary opacity-100" : "text-muted-foreground/70 opacity-0 focus-visible:opacity-100 group-hover/pin:opacity-100",
          )}
        >
          <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
        </button>
      )}
    </SidebarMenuItem>
  );
  // Right-click → context menu (rename / move to folder / pin / delete). Only when actions are wired.
  return actions ? <ProjectRowMenu project={project} actions={actions}>{row}</ProjectRowMenu> : row;
}

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const profileQuery = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const me = profileQuery.data?.user;
  const qc = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false, staleTime: 60_000 });
  const foldersQuery = useQuery({ queryKey: ["nexus", "project-folders"], queryFn: () => nexusApi.projectFolders(), retry: false, staleTime: 60_000 });
  const pinsQuery = useQuery({ queryKey: ["nexus", "project-pins"], queryFn: nexusApi.projectPins, retry: false, staleTime: 60_000 });
  const projects = projectsQuery.data ?? [];
  const pinnedIds = new Set(pinsQuery.data?.projectIds ?? []);

  // A-Z ordering (case-insensitive) for both folders and projects.
  const byName = (a: { name?: string | null }, b: { name?: string | null }) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  const folders = [...(foldersQuery.data ?? [])].sort(byName);
  const unfiled = projects.filter((p) => !p.folderId).sort(byName);
  const pinnedProjects = projects.filter((p) => pinnedIds.has(p.id)).sort(byName);

  const togglePin = useMutation({
    mutationFn: ({ projectId, pinned }: { projectId: string; pinned: boolean }) => nexusApi.setProjectPin(projectId, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "project-pins"] }),
  });
  const onTogglePin = (projectId: string) => togglePin.mutate({ projectId, pinned: !pinnedIds.has(projectId) });

  // Org role gates management-only nav (Control Room /admin + Crew Hub /teams):
  // visible to BoD/Manager, hidden from Staff (and while role is still unknown).
  const orgRoleQuery = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const canManageOrg = ["ONE_ABOVE_ALL", "BOD", "MANAGER"].includes(orgRoleQuery.data?.role ?? "");
  const canManageAttendance = ["ONE_ABOVE_ALL", "BOD"].includes(orgRoleQuery.data?.role ?? "");
  const canSeeOracle = orgRoleQuery.data?.role === "ONE_ABOVE_ALL";
  const MANAGER_ONLY_URLS = new Set(["/admin", "/teams"]);
  const ONE_ABOVE_ALL_URLS = new Set(["/oracle", "/social"]);

  // Live nav badges. Inbox = unread notifications (shared cache w/ the inbox page). Attendance =
  // pending offsite-checkout approvals (BoD only). Both refresh every 45s + on relevant mutations.
  const notifQuery = useQuery({ queryKey: ["nexus", "notifications"], queryFn: () => nexusApi.notifications(false), retry: false, refetchInterval: 45_000 });
  const offsiteQuery = useQuery({ queryKey: ["offsite-checkouts"], queryFn: () => nexusApi.offsiteCheckouts("PENDING"), enabled: canManageAttendance, retry: false, refetchInterval: 45_000 });
  const badgeFor = (url: string): number => {
    if (url === "/inbox") return notifQuery.data?.unreadCount ?? 0;
    if (url === "/attendance") return canManageAttendance ? (offsiteQuery.data?.pendingCount ?? 0) : 0;
    return 0;
  };
  const badgeText = (n: number) => (n > 9 ? "9+" : String(n));
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => (canManageOrg || !MANAGER_ONLY_URLS.has(item.url)) && (canSeeOracle || !ONE_ABOVE_ALL_URLS.has(item.url))) }))
    .filter((g) => g.items.length > 0);

  // Collapsible folders (ClickUp-style). Folders are COLLAPSED by default for a clean sidebar; we
  // remember which ones YOU opened (localStorage) and always auto-open the folder of the project
  // you're currently viewing, so you never lose your place.
  const FOLDERS_KEY = "nexus:sidebar:expanded-folders";
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(FOLDERS_KEY) : null;
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(FOLDERS_KEY, JSON.stringify([...next])); } catch { /* storage best-effort */ }
      return next;
    });
  // Auto-open the folder that contains the project you're currently on — and ALL its ancestor folders,
  // so a deeply-nested active project is always visible.
  const activeProjectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] ?? null : null;
  const activeFolderId = activeProjectId ? projects.find((p) => p.id === activeProjectId)?.folderId ?? null : null;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const activeAncestorFolders = (() => {
    const set = new Set<string>();
    let fid: string | null = activeFolderId;
    while (fid) { set.add(fid); fid = folderById.get(fid)?.parentFolderId ?? null; }
    return set;
  })();
  const isFolderOpen = (id: string) => expandedFolders.has(id) || activeAncestorFolders.has(id);

  // ── Right-click actions (rename / move / delete / new subfolder) for projects & folders ──
  const invalidateSidebar = () => invalidateProjectData(qc);
  const onMutationError = (e: unknown) => window.alert(e instanceof Error ? e.message : "Gagal — coba lagi.");
  const renameProjectM = useMutation({ mutationFn: (v: { id: string; name: string }) => nexusApi.updateProject(v.id, { name: v.name }), onSuccess: invalidateSidebar, onError: onMutationError });
  const moveProjectM = useMutation({ mutationFn: (v: { id: string; folderId: string | null }) => nexusApi.updateProject(v.id, { folderId: v.folderId }), onSuccess: invalidateSidebar, onError: onMutationError });
  const deleteProjectM = useMutation({ mutationFn: (id: string) => nexusApi.deleteProject(id), onSuccess: invalidateSidebar, onError: onMutationError });
  const createFolderM = useMutation({ mutationFn: (v: { workspaceId: string; name: string; parentFolderId: string | null }) => nexusApi.projectFolderCreate(v.workspaceId, { name: v.name, parentFolderId: v.parentFolderId }), onSuccess: invalidateSidebar, onError: onMutationError });
  const renameFolderM = useMutation({ mutationFn: (v: { id: string; name: string }) => nexusApi.projectFolderUpdate(v.id, { name: v.name }), onSuccess: invalidateSidebar, onError: onMutationError });
  const moveFolderM = useMutation({ mutationFn: (v: { id: string; parentFolderId: string | null }) => nexusApi.projectFolderUpdate(v.id, { parentFolderId: v.parentFolderId }), onSuccess: invalidateSidebar, onError: onMutationError });
  const deleteFolderM = useMutation({ mutationFn: (id: string) => nexusApi.projectFolderDelete(id), onSuccess: invalidateSidebar, onError: onMutationError });
  // Create a new project straight from the sidebar "+" (workspace inferred from existing folders/projects).
  const navigate = useNavigate();
  const createProjectM = useMutation({
    mutationFn: (v: { workspaceId: string; name: string }) => nexusApi.createProject({ name: v.name, workspaceId: v.workspaceId }),
    onSuccess: (project) => { invalidateSidebar(); navigate({ to: "/projects/$projectId", params: { projectId: project.id } }); },
    onError: onMutationError,
  });
  const newProjectFromSidebar = () => {
    const name = window.prompt("Nama project baru:", "");
    if (!name || !name.trim()) return;
    const workspaceId = folders[0]?.workspaceId ?? projects.find((p) => p.workspaceId)?.workspaceId;
    if (!workspaceId) { window.alert("Workspace tidak diketahui."); return; }
    createProjectM.mutate({ workspaceId, name: name.trim() });
  };
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const sidebarActions: SidebarActions = {
    folders,
    isPinned: (id) => pinnedIds.has(id),
    renameProject: (p) => { const name = window.prompt("Nama project baru:", p.name); if (name && name.trim() && name.trim() !== p.name) renameProjectM.mutate({ id: p.id, name: name.trim() }); },
    moveProject: (id, folderId) => moveProjectM.mutate({ id, folderId }),
    removeProject: (p) => { if (window.confirm(`Hapus project "${p.name}"?\n\nIni PERMANEN dan menghapus semua task di dalamnya.`)) deleteProjectM.mutate(p.id); },
    togglePin: (id) => onTogglePin(id),
    createSubfolder: (parent) => {
      const name = window.prompt(parent ? `Nama subfolder di dalam "${parent.name}":` : "Nama folder baru:", "");
      if (!name || !name.trim()) return;
      const workspaceId = parent?.workspaceId ?? folders[0]?.workspaceId;
      if (!workspaceId) { window.alert("Workspace tidak diketahui."); return; }
      createFolderM.mutate({ workspaceId, name: name.trim(), parentFolderId: parent?.id ?? null });
    },
    renameFolder: (f) => { const name = window.prompt("Nama folder baru:", f.name); if (name && name.trim() && name.trim() !== f.name) renameFolderM.mutate({ id: f.id, name: name.trim() }); },
    moveFolder: (id, parentFolderId) => moveFolderM.mutate({ id, parentFolderId }),
    removeFolder: (f) => { if (window.confirm(`Hapus folder "${f.name}"?\n\nProject & subfolder di dalamnya TIDAK ikut terhapus — dipindah keluar satu level.`)) deleteFolderM.mutate(f.id); },
  };

  // ── Drag & drop: drag a project/folder onto a folder (move into) or the root zone (move to top) ──
  const [drag, setDrag] = useState<{ kind: "project" | "folder"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "ROOT" | null>(null);
  const canDrop = (targetFolderId: string | null) => !!drag && canMoveInto(drag, targetFolderId, folders);
  const performDrop = (targetFolderId: string | null) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || !canMoveInto(d, targetFolderId, folders)) return;
    if (d.kind === "project") sidebarActions.moveProject(d.id, targetFolderId);
    else sidebarActions.moveFolder(d.id, targetFolderId);
  };
  const dragHandlers = (kind: "project" | "folder", id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => { e.stopPropagation(); setDrag({ kind, id }); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } catch { /* ignore */ } },
    onDragEnd: () => { setDrag(null); setDropTarget(null); },
  });
  const folderDropHandlers = (folderId: string) => ({
    onDragOver: (e: DragEvent) => { if (canDrop(folderId)) { e.preventDefault(); e.stopPropagation(); setDropTarget(folderId); } },
    onDragLeave: () => setDropTarget((t) => (t === folderId ? null : t)),
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); performDrop(folderId); },
  });

  // Render a folder + its subfolders (recursively) + its projects. Folders nest up to 3 levels and may
  // hold a mix of subfolders and projects. A folder with nothing inside is hidden.
  const renderFolderNode = (folder: NexusProjectFolder, depth: number): ReactNode => {
    const subfolders = folders.filter((f) => (f.parentFolderId ?? null) === folder.id);
    const inFolder = projects.filter((p) => (p.folderId ?? null) === folder.id).sort(byName);
    if (subfolders.length === 0 && inFolder.length === 0) return null;
    const open = isFolderOpen(folder.id);
    const count = subfolders.length + inFolder.length;
    return (
      <div key={folder.id} className="mb-0.5">
        {!collapsed && (
          <FolderRowMenu folder={folder} actions={sidebarActions}>
            <button
              type="button"
              onClick={() => toggleFolder(folder.id)}
              aria-expanded={open}
              style={{ paddingLeft: 8 + depth * 12 }}
              {...dragHandlers("folder", folder.id)}
              {...folderDropHandlers(folder.id)}
              className={cn(
                "flex w-full cursor-grab items-center gap-1.5 rounded-md py-1 pr-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:cursor-grabbing",
                dropTarget === folder.id && "bg-primary/15 ring-2 ring-inset ring-primary",
              )}
            >
              <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform duration-200", open && "rotate-90")} />
              <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded text-xs">
                <ProjectIcon icon={folder.icon || "📁"} className="max-h-4 max-w-4 rounded object-cover" />
              </span>
              <span className="flex-1 truncate text-left">{folder.name}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">{count}</span>
            </button>
          </FolderRowMenu>
        )}
        {open && (
          <>
            {subfolders.map((sf) => renderFolderNode(sf, depth + 1))}
            {inFolder.map((p) => (
              <ProjectNavItem key={p.id} project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={depth + 1} pinned={pinnedIds.has(p.id)} onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} dnd={dragHandlers("project", p.id)} />
            ))}
          </>
        )}
      </div>
    );
  };

  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await nexusApi.logout(); } catch { /* ignore — clear cookies best-effort, still redirect */ }
    window.location.href = "/login"; // full reload drops all session state
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b border-sidebar-border">
        {/* Stable row (no flex-direction / mount swaps) — the brand text clips via
            overflow as the bar narrows, and the controls fade out via CSS, so the
            logo never jumps or pops when expanding/collapsing. */}
        <div className="flex items-center gap-1 overflow-hidden">
          <Link to="/dashboard" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5">
            <img src={nexusLogo} alt="NEXUS" className="h-8 w-8 shrink-0 object-contain" />
            <div className="flex min-w-0 flex-col whitespace-nowrap leading-tight">
              <span className="truncate text-sm font-semibold tracking-tight">NEXUS</span>
              <span className="truncate text-[11px] text-muted-foreground">Phaëthon</span>
            </div>
          </Link>
          <button
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            title="Collapse (⌘B)"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }))}
          className="mx-2 my-1 flex items-center gap-2 overflow-hidden rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{item.title}</span>
                        {badgeFor(item.url) > 0 ? (
                          <span className={cn("ml-auto rounded-full text-[10px] font-bold px-1.5 py-0.5", item.url === "/attendance" ? "bg-amber-500 text-white" : "bg-primary/10 text-primary")}>{badgeText(badgeFor(item.url))}</span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup>
          {!collapsed && (
            <div className="flex items-center justify-between px-2">
              <SidebarGroupLabel className="m-0">Projects</SidebarGroupLabel>
              <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                <PopoverTrigger asChild>
                  <button type="button" title="Tambah project / folder" className="text-muted-foreground hover:text-foreground p-0.5 rounded"><Plus className="h-3.5 w-3.5" /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1.5">
                  <button type="button" onClick={() => { setAddMenuOpen(false); newProjectFromSidebar(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <Rocket className="h-3.5 w-3.5 text-primary" /> Project baru
                  </button>
                  <button type="button" onClick={() => { setAddMenuOpen(false); sidebarActions.createSubfolder(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> Folder baru
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {!collapsed && pinnedProjects.length > 0 && (
                <div className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Pinned</div>
                  {pinnedProjects.map((p) => (
                    <ProjectNavItem key={`pin-${p.id}`} project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={0} pinned onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} />
                  ))}
                  <div className="mx-2 my-1 h-px bg-sidebar-border/60" />
                </div>
              )}
              {/* Root folders render recursively (subfolders nested inside, up to 3 levels). */}
              {folders.filter((f) => !(f.parentFolderId ?? null)).map((folder) => renderFolderNode(folder, 0))}
              {/* Unfiled projects double as the "root" drop zone — drop here to pull an item out of its folder. */}
              <div
                onDragOver={(e) => { if (canDrop(null)) { e.preventDefault(); setDropTarget("ROOT"); } }}
                onDragLeave={() => setDropTarget((t) => (t === "ROOT" ? null : t))}
                onDrop={(e) => { e.preventDefault(); performDrop(null); }}
                className={cn("rounded-md", dropTarget === "ROOT" && "bg-primary/10 ring-2 ring-inset ring-primary")}
              >
                {drag && !collapsed && (
                  <div className="px-2 py-1 text-[10px] italic text-muted-foreground/60">↩︎ Lepas di sini buat keluarin dari folder</div>
                )}
                {unfiled.map((p) => <ProjectNavItem key={p.id} project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={0} pinned={pinnedIds.has(p.id)} onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} dnd={dragHandlers("project", p.id)} />)}
              </div>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 overflow-hidden px-1 py-1">
          {me?.avatar ? (
            <img src={me.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-sidebar-border" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary ring-1 ring-sidebar-border">
              {(me?.name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">{me?.name ?? "—"}</span>
            <span className="truncate text-[10px] text-muted-foreground">{me?.email ?? ""}</span>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label="Log out"
            title="Log out"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 group-data-[collapsible=icon]:hidden"
          >
            {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
