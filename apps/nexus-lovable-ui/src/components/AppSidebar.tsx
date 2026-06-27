import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Inbox, MessageCircle, CheckSquare, Calendar, CalendarClock, FolderKanban,
  BookOpen, Users, Trophy, ClipboardCheck, Settings, Shield, FileText, Sparkles, Megaphone,
  Search, Plus, PanelLeftClose, ChevronRight, LogOut, Loader2, Pin, FolderPlus, Rocket, Maximize2, AtSign, ShieldAlert, Ticket, Sun, Moon,
} from "lucide-react";
import { Fragment, useRef, useState, type ReactNode, type DragEvent } from "react";
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
import { useTheme } from "@/lib/theme";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const groups = [
  {
    label: "Home Base",
    items: [
      { title: "Oracle", url: "/oracle", icon: Sparkles },
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Messages", url: "/messages", icon: MessageCircle },
      { title: "Notification", url: "/inbox", icon: Inbox },
      { title: "Threads", url: "/threads", icon: AtSign },
      { title: "My Mission", url: "/my-tasks", icon: CheckSquare },
      { title: "My Submissions", url: "/submissions", icon: FileText },
      { title: "Team Calendar", url: "/master-calendar", icon: Calendar },
      { title: "Room Booking", url: "/room-booking", icon: CalendarClock },
    ],
  },
  {
    label: "Missions",
    items: [
      { title: "Mission Control", url: "/projects", icon: FolderKanban },
      { title: "Social Approvals", url: "/social", icon: Megaphone },
      { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
      { title: "Integrity", url: "/peer-reports", icon: ShieldAlert },
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
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Ticket", url: "/complaints", icon: Ticket },
      { title: "Crew Hub", url: "/teams", icon: Users },
      { title: "Setting", url: "/settings", icon: Settings },
      { title: "Control Room", url: "/admin", icon: Shield },
    ],
  },
];

type RowDnd = { draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void };

/** A thin drop slot shown between sibling rows while dragging a matching item — drop here to reorder. */
function ReorderZone({ active, onDrop }: { active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      aria-hidden
      onDragOver={active ? (e) => { e.preventDefault(); e.stopPropagation(); setOver(true); } : undefined}
      onDragLeave={active ? () => setOver(false) : undefined}
      onDrop={active ? (e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onDrop(); } : undefined}
      className={cn("mx-2 rounded-full transition-[height] duration-150", active ? (over ? "h-2 bg-primary" : "h-2") : "h-0")}
    />
  );
}

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
          title={pinned ? "Unpin" : "Pin to top"}
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
  const { isDark, toggle: toggleTheme } = useTheme();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const profileQuery = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const me = profileQuery.data?.user;
  const qc = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false, staleTime: 60_000 });
  const foldersQuery = useQuery({ queryKey: ["nexus", "project-folders"], queryFn: () => nexusApi.projectFolders(), retry: false, staleTime: 60_000 });
  const pinsQuery = useQuery({ queryKey: ["nexus", "project-pins"], queryFn: nexusApi.projectPins, retry: false, staleTime: 60_000 });
  const folderPinsQuery = useQuery({ queryKey: ["nexus", "folder-pins"], queryFn: nexusApi.folderPins, retry: false, staleTime: 60_000 });
  const projects = projectsQuery.data ?? [];
  const pinnedIds = new Set(pinsQuery.data?.projectIds ?? []);
  const pinnedFolderIds = new Set(folderPinsQuery.data?.folderIds ?? []);

  // Custom ordering: by saved `position`, then name as a stable tiebreak (so items with no explicit
  // position yet — all 0 — still read A-Z until the user drags to reorder).
  const byPos = (a: { position?: number | null; name?: string | null }, b: { position?: number | null; name?: string | null }) =>
    ((a.position ?? 0) - (b.position ?? 0)) || (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  const folders = [...(foldersQuery.data ?? [])].sort(byPos);
  const unfiled = projects.filter((p) => !p.folderId).sort(byPos);
  const pinnedProjects = projects.filter((p) => pinnedIds.has(p.id)).sort(byPos);
  const pinnedFolders = folders.filter((f) => pinnedFolderIds.has(f.id)).sort(byPos);

  const togglePin = useMutation({
    mutationFn: ({ projectId, pinned }: { projectId: string; pinned: boolean }) => nexusApi.setProjectPin(projectId, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "project-pins"] }),
  });
  const onTogglePin = (projectId: string) => togglePin.mutate({ projectId, pinned: !pinnedIds.has(projectId) });
  const toggleFolderPin = useMutation({
    mutationFn: ({ folderId, pinned }: { folderId: string; pinned: boolean }) => nexusApi.setFolderPin(folderId, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus", "folder-pins"] }),
  });
  const onToggleFolderPin = (folderId: string) => toggleFolderPin.mutate({ folderId, pinned: !pinnedFolderIds.has(folderId) });

  // Org role gates management-only nav (Control Room /admin + Crew Hub /teams):
  // visible to BoD/Manager, hidden from Staff (and while role is still unknown).
  const orgRoleQuery = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const canManageOrg = ["ONE_ABOVE_ALL", "BOD", "MANAGER"].includes(orgRoleQuery.data?.role ?? "");
  const canManageAttendance = ["ONE_ABOVE_ALL", "BOD"].includes(orgRoleQuery.data?.role ?? "");
  const canSeeOracle = orgRoleQuery.data?.role === "ONE_ABOVE_ALL";
  // Threads / Integrity / Ticket are visible in nav to ALL roles, but Manager-and-below land on a
  // "Coming Soon" page (gated inside each route component) — no ETA yet, so we tease, not hide.
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
  const onMutationError = (e: unknown) => window.alert(e instanceof Error ? e.message : "Something went wrong — try again.");
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
    const name = window.prompt("New project name:", "");
    if (!name || !name.trim()) return;
    const workspaceId = folders[0]?.workspaceId ?? projects.find((p) => p.workspaceId)?.workspaceId;
    if (!workspaceId) { window.alert("Workspace unknown."); return; }
    createProjectM.mutate({ workspaceId, name: name.trim() });
  };
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const sidebarActions: SidebarActions = {
    folders,
    isPinned: (id) => pinnedIds.has(id),
    isPinnedFolder: (id) => pinnedFolderIds.has(id),
    renameProject: (p) => { const name = window.prompt("New project name:", p.name); if (name && name.trim() && name.trim() !== p.name) renameProjectM.mutate({ id: p.id, name: name.trim() }); },
    moveProject: (id, folderId) => moveProjectM.mutate({ id, folderId }),
    removeProject: (p) => { if (window.confirm(`Delete project "${p.name}"?\n\nThis is PERMANENT and removes every task inside it.`)) deleteProjectM.mutate(p.id); },
    togglePin: (id) => onTogglePin(id),
    toggleFolderPin: (id) => onToggleFolderPin(id),
    openFolderView: (id) => navigate({ to: "/folders/$folderId", params: { folderId: id } }),
    createSubfolder: (parent) => {
      const name = window.prompt(parent ? `Subfolder name inside "${parent.name}":` : "New folder name:", "");
      if (!name || !name.trim()) return;
      const workspaceId = parent?.workspaceId ?? folders[0]?.workspaceId;
      if (!workspaceId) { window.alert("Workspace unknown."); return; }
      createFolderM.mutate({ workspaceId, name: name.trim(), parentFolderId: parent?.id ?? null });
    },
    renameFolder: (f) => { const name = window.prompt("New folder name:", f.name); if (name && name.trim() && name.trim() !== f.name) renameFolderM.mutate({ id: f.id, name: name.trim() }); },
    moveFolder: (id, parentFolderId) => moveFolderM.mutate({ id, parentFolderId }),
    removeFolder: (f) => { if (window.confirm(`Delete folder "${f.name}"?\n\nProjects & subfolders inside it are NOT deleted — they get moved out one level.`)) deleteFolderM.mutate(f.id); },
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

  // ── Reorder: drop the dragged item just before `beforeId` (null = end) within a sibling group.
  // Folders reorder among sibling folders, projects among sibling projects; a cross-container drop also
  // moves the item into that container. Renumbers the group (position 0..n) and persists only what changed.
  const reordering = useRef(false);
  const reorder = async (kind: "project" | "folder", containerId: string | null, beforeId: string | null) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || d.kind !== kind || reordering.current) return;
    if (kind === "folder" && !canMoveInto(d, containerId, folders)) return; // no folder-into-own-subtree
    const dragged = (kind === "folder" ? folders : projects).find((x) => x.id === d.id);
    if (!dragged) return;
    const group = (kind === "folder"
      ? folders.filter((f) => (f.parentFolderId ?? null) === containerId)
      : projects.filter((p) => (p.folderId ?? null) === containerId)
    ).slice().sort(byPos);
    const without = group.filter((g) => g.id !== d.id);
    const at = beforeId ? without.findIndex((g) => g.id === beforeId) : without.length;
    const idx = at === -1 ? without.length : at;
    const next = [...without.slice(0, idx), dragged, ...without.slice(idx)];
    reordering.current = true;
    try {
      await Promise.all(
        next.flatMap((item, i) => {
          const isDragged = item.id === d.id;
          const cur = kind === "folder" ? ((item as NexusProjectFolder).parentFolderId ?? null) : ((item as NexusProject).folderId ?? null);
          const moved = isDragged && cur !== containerId;
          if ((item.position ?? 0) === i && !moved) return [];
          return [
            kind === "folder"
              ? nexusApi.projectFolderUpdate(item.id, { position: i, ...(moved ? { parentFolderId: containerId } : {}) })
              : nexusApi.updateProject(item.id, { position: i, ...(moved ? { folderId: containerId } : {}) }),
          ];
        }),
      );
    } catch (e) {
      onMutationError(e);
    } finally {
      reordering.current = false;
      invalidateSidebar(); // always re-sync with server truth (also recovers from a partial-failure batch)
    }
  };

  // Render a folder + its subfolders (recursively) + its projects. Folders nest up to 3 levels and may
  // hold a mix of subfolders and projects. A folder with nothing inside is hidden.
  const renderFolderNode = (folder: NexusProjectFolder, depth: number): ReactNode => {
    const subfolders = folders.filter((f) => (f.parentFolderId ?? null) === folder.id);
    const inFolder = projects.filter((p) => (p.folderId ?? null) === folder.id).sort(byPos);
    if (subfolders.length === 0 && inFolder.length === 0) return null;
    const open = isFolderOpen(folder.id);
    const count = subfolders.length + inFolder.length;
    return (
      <div key={folder.id} className="mb-0.5">
        {!collapsed && (
          <FolderRowMenu folder={folder} actions={sidebarActions}>
            <div
              {...folderDropHandlers(folder.id)}
              className={cn(
                "group/folder flex w-full items-center gap-0.5 rounded-md pr-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                dropTarget === folder.id && "bg-primary/15 ring-2 ring-inset ring-primary",
              )}
            >
              <button
                type="button"
                onClick={() => toggleFolder(folder.id)}
                aria-expanded={open}
                style={{ paddingLeft: 8 + depth * 12 }}
                {...dragHandlers("folder", folder.id)}
                className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 py-1 text-left active:cursor-grabbing"
              >
                <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform duration-200", open && "rotate-90")} />
                <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded text-xs">
                  <ProjectIcon icon={folder.icon || "📁"} className="max-h-4 max-w-4 rounded object-cover" />
                </span>
                <span className="flex-1 truncate">{folder.name}</span>
              </button>
              <Link
                to="/folders/$folderId"
                params={{ folderId: folder.id }}
                title="Open folder view"
                onClick={(e) => e.stopPropagation()}
                className="hidden shrink-0 rounded p-1 text-muted-foreground/70 hover:bg-primary/15 hover:text-primary group-hover/folder:block"
              >
                <Maximize2 className="h-3 w-3" />
              </Link>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60 group-hover/folder:hidden">{count}</span>
            </div>
          </FolderRowMenu>
        )}
        {open && (
          <>
            {subfolders.map((sf) => (
              <Fragment key={sf.id}>
                <ReorderZone active={drag?.kind === "folder"} onDrop={() => reorder("folder", folder.id, sf.id)} />
                {renderFolderNode(sf, depth + 1)}
              </Fragment>
            ))}
            {subfolders.length > 0 && <ReorderZone active={drag?.kind === "folder"} onDrop={() => reorder("folder", folder.id, null)} />}
            {inFolder.map((p) => (
              <Fragment key={p.id}>
                <ReorderZone active={drag?.kind === "project"} onDrop={() => reorder("project", folder.id, p.id)} />
                <ProjectNavItem project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={depth + 1} pinned={pinnedIds.has(p.id)} onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} dnd={dragHandlers("project", p.id)} />
              </Fragment>
            ))}
            {inFolder.length > 0 && <ReorderZone active={drag?.kind === "project"} onDrop={() => reorder("project", folder.id, null)} />}
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
                  <button type="button" title="Add project / folder" className="text-muted-foreground hover:text-foreground p-0.5 rounded"><Plus className="h-3.5 w-3.5" /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1.5">
                  <button type="button" onClick={() => { setAddMenuOpen(false); newProjectFromSidebar(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <Rocket className="h-3.5 w-3.5 text-primary" /> New project
                  </button>
                  <button type="button" onClick={() => { setAddMenuOpen(false); sidebarActions.createSubfolder(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> New folder
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {!collapsed && (pinnedProjects.length > 0 || pinnedFolders.length > 0) && (
                <div className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Pinned</div>
                  {/* Pinned folders render as the full expandable tree (so their projects show + can expand),
                      and are dropped from the root list below to avoid a duplicated, sync-expanding row. */}
                  {pinnedFolders.map((f) => renderFolderNode(f, 0))}
                  {pinnedProjects.map((p) => (
                    <ProjectNavItem key={`pin-${p.id}`} project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={0} pinned onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} />
                  ))}
                  <div className="mx-2 my-1 h-px bg-sidebar-border/60" />
                </div>
              )}
              {/* Root folders render recursively (subfolders nested inside, up to 3 levels).
                  Pinned root folders are already shown (expandable) in the Pinned section above. */}
              {folders.filter((f) => !(f.parentFolderId ?? null) && !pinnedFolderIds.has(f.id)).map((folder) => (
                <Fragment key={folder.id}>
                  <ReorderZone active={drag?.kind === "folder"} onDrop={() => reorder("folder", null, folder.id)} />
                  {renderFolderNode(folder, 0)}
                </Fragment>
              ))}
              <ReorderZone active={drag?.kind === "folder"} onDrop={() => reorder("folder", null, null)} />
              {/* Unfiled projects double as the "root" drop zone — drop here to pull an item out of its folder. */}
              <div
                onDragOver={(e) => { if (canDrop(null)) { e.preventDefault(); setDropTarget("ROOT"); } }}
                onDragLeave={() => setDropTarget((t) => (t === "ROOT" ? null : t))}
                onDrop={(e) => { e.preventDefault(); performDrop(null); }}
                className={cn("rounded-md", dropTarget === "ROOT" && "bg-primary/10 ring-2 ring-inset ring-primary")}
              >
                {drag && !collapsed && (
                  <div className="px-2 py-1 text-[10px] italic text-muted-foreground/60">↩︎ Drop here to pull it out of the folder</div>
                )}
                {unfiled.map((p) => (
                  <Fragment key={p.id}>
                    <ReorderZone active={drag?.kind === "project"} onDrop={() => reorder("project", null, p.id)} />
                    <ProjectNavItem project={p} active={isActive(`/projects/${p.id}`)} collapsed={collapsed} depth={0} pinned={pinnedIds.has(p.id)} onTogglePin={() => onTogglePin(p.id)} actions={sidebarActions} dnd={dragHandlers("project", p.id)} />
                  </Fragment>
                ))}
                {unfiled.length > 0 && <ReorderZone active={drag?.kind === "project"} onDrop={() => reorder("project", null, null)} />}
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
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={isDark ? "Light mode" : "Dark mode"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
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
