// ─────────────────────────────────────────────────────────────────────────────
// The sidebar's Projects tree (owner, 10 Oct 2026: "UI side bar folder dan project web tuh
// membingungkan banget, tolong rapihin dong").
//
//   Pinned      shortcuts: pinned folders (expandable) and pinned projects
//   Folders     folder › subfolder › project, one guide line per level, folders in medium weight with a
//               folder mark, projects in regular weight with their own icon or colour square
//   No folder   projects outside every folder; also the drop zone to take a project out of its folder
//
// A click anywhere on a folder row opens or closes it; what is open is remembered per browser, and the
// folders above the project you are on open by themselves. Right click (or the "…" button, which is
// always there on touch) opens the same menu as on Mission Control. BoD / Manager / One Above All can
// drag projects and folders into folders, onto "No folder", or between rows to reorder.
// ─────────────────────────────────────────────────────────────────────────────
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, FolderPlus, MoreHorizontal, Pin, Plus, Rocket, Inbox } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { nexusApi, type NexusProject, type NexusProjectFolder } from "@/lib/nexus-api";
import { canMoveInto } from "@/lib/folder-tree-client";
import { invalidateProjectData } from "@/lib/invalidate";
import { canDropInto, dragFromDrop, endTreeDrag, isTreeDrag, startTreeDrag, useTreeDrag, type TreeDrag } from "@/lib/project-tree-dnd";
import {
  FolderGlyph, ProjectGlyph, TreeMenuBody, folderMenuEntries, projectMenuEntries, useProjectTreeActions,
} from "@/components/projects/project-tree";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { FitText } from "@/components/FitText";

const EXPANDED_KEY = "nexus:sidebar:expanded-folders";
const ROOT = "__root__";

const byPos = (a: { position?: number | null; name?: string | null }, b: { position?: number | null; name?: string | null }) =>
  ((a.position ?? 0) - (b.position ?? 0)) || (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });

function readExpanded(): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(EXPANDED_KEY) : null;
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeExpanded(s: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...s])); } catch { /* storage is a convenience */ }
}

/** A quiet sub-heading inside the Projects group. Doubles as a drop target when given handlers. */
function TreeLabel({ children, icon, active, ...drop }: { children: ReactNode; icon?: ReactNode; active?: boolean } & HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      role="presentation"
      {...drop}
      className={cn(
        "mt-2 flex h-6 list-none items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-sidebar-foreground/55 first:mt-0",
        active && "bg-primary/10 text-primary ring-1 ring-inset ring-primary/50",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </li>
  );
}

/** A thin slot between sibling rows while a matching row is dragged: drop here to reorder. */
function ReorderSlot({ active, onDrop }: { active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false);
  if (!active) return null;
  return (
    <li
      aria-hidden
      role="presentation"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onDrop(); }}
      className="-my-[3px] flex h-1.5 list-none items-center px-2"
    >
      <span className={cn("h-0.5 w-full rounded-full transition-colors", over ? "bg-primary" : "bg-transparent")} />
    </li>
  );
}

export function SidebarProjectTree() {
  const { state, isMobile } = useSidebar();
  // On a phone the sidebar is a full-width sheet, whatever the desktop rail was left at.
  const collapsed = state === "collapsed" && !isMobile;
  const { t } = useLang();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  // A folder opens the Calendar filtered to it (one calendar, owner 18 Oct 2026): /calendar?folder=<one id>.
  const calendarFolder = useRouterState({ select: (r) => (r.location.pathname === "/calendar" ? (r.location.search as { folder?: string }).folder ?? null : null) });

  const projectsQuery = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, retry: false, staleTime: 60_000 });
  const foldersQuery = useQuery({ queryKey: ["nexus", "project-folders"], queryFn: () => nexusApi.projectFolders(), retry: false, staleTime: 60_000 });
  const roleQuery = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  // The folder and project PATCH routes allow BoD / Manager / One Above All.
  const canManage = ["ONE_ABOVE_ALL", "BOD", "MANAGER"].includes(roleQuery.data?.role ?? "");

  const projects = projectsQuery.data ?? [];
  const folders = useMemo(() => [...(foldersQuery.data ?? [])].sort(byPos), [foldersQuery.data]);
  const { actions, dialogs } = useProjectTreeActions({ folders, canManage, workspaceId: roleQuery.data?.workspaceId });

  const childFolders = useMemo(() => {
    const m = new Map<string, NexusProjectFolder[]>();
    for (const f of folders) {
      const k = f.parentFolderId ?? ROOT;
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return m;
  }, [folders]);
  const childProjects = useMemo(() => {
    const m = new Map<string, NexusProject[]>();
    for (const p of [...projects].sort(byPos)) {
      const k = p.folderId ?? ROOT;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [projects]);
  // A folder with no project of yours anywhere below it is only shown to those who can fill it.
  const hasProjects = useMemo(() => {
    const memo = new Map<string, boolean>();
    const walk = (id: string, seen: Set<string>): boolean => {
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return false;
      seen.add(id);
      const v = (childProjects.get(id)?.length ?? 0) > 0 || (childFolders.get(id) ?? []).some((f) => walk(f.id, seen));
      memo.set(id, v);
      return v;
    };
    return (id: string) => walk(id, new Set());
  }, [childFolders, childProjects]);
  const visibleFolder = (f: NexusProjectFolder) => canManage || hasProjects(f.id);

  const unfiled = childProjects.get(ROOT) ?? [];
  const rootFolders = (childFolders.get(ROOT) ?? []).filter(visibleFolder);
  const pinnedFolders = folders.filter((f) => actions.isPinnedFolder(f.id) && visibleFolder(f));
  const pinnedProjects = projects.filter((p) => actions.isPinnedProject(p.id)).sort(byPos);

  // ── Open / closed, remembered. Pinned copies keep their own state ("pin:<id>") so opening one
  //    doesn't open the other.
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const setOpen = (key: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key); else next.delete(key);
      writeExpanded(next);
      return next;
    });
  const toggle = (key: string) => setOpen(key, !expanded.has(key));

  // The folders above the project you're on open by themselves (once per project, so you can still close them).
  const activeProjectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] ?? null : null;
  const activeFolderId = calendarFolder && !calendarFolder.includes(",") ? calendarFolder : null;
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const activeChain = useMemo(() => {
    const chain = new Set<string>();
    let fid: string | null = activeProjectId ? projects.find((p) => p.id === activeProjectId)?.folderId ?? null : activeFolderId ? folderById.get(activeFolderId)?.parentFolderId ?? null : null;
    while (fid && !chain.has(fid)) { chain.add(fid); fid = folderById.get(fid)?.parentFolderId ?? null; }
    return chain;
  }, [activeProjectId, activeFolderId, projects, folderById]);
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = activeProjectId ?? activeFolderId;
    if (!key || activeChain.size === 0 || openedFor.current === key) return;
    openedFor.current = key;
    setExpanded((prev) => {
      if ([...activeChain].every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      activeChain.forEach((id) => next.add(id));
      writeExpanded(next);
      return next;
    });
  }, [activeProjectId, activeFolderId, activeChain]);

  // ── Drag and drop ──
  const drag = useTreeDrag();
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id, or ROOT
  const hoverTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current.timer); hoverTimer.current = null; };
  useEffect(() => { if (!drag) { setDropTarget(null); clearHover(); } }, [drag]);

  const dragProps = (d: TreeDrag) =>
    canManage && !collapsed
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => startTreeDrag(e, d),
          onDragEnd: () => endTreeDrag(),
        }
      : {};

  const drop = (target: string | null, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragFromDrop(e.dataTransfer);
    endTreeDrag();
    if (!d || !canDropInto(d, target, folders)) return;
    if (d.kind === "project") {
      const p = projects.find((x) => x.id === d.id);
      if (p) actions.moveProject(p, target);
    } else {
      const f = folderById.get(d.id);
      if (f) actions.moveFolder(f, target);
    }
  };
  /** Drop INTO a folder (or ROOT = out of every folder). Hovering a closed folder opens it after a beat. */
  const dropInto = (target: string | null, openKey?: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!isTreeDrag(e.dataTransfer.types)) return;
      const d = drag ?? null;
      if (d && !canDropInto(d, target, folders)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const key = target ?? ROOT;
      if (dropTarget !== key) setDropTarget(key);
      if (openKey && !expanded.has(openKey) && hoverTimer.current?.id !== openKey) {
        clearHover();
        hoverTimer.current = { id: openKey, timer: setTimeout(() => setOpen(openKey, true), 650) };
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropTarget((cur) => (cur === (target ?? ROOT) ? null : cur));
      if (openKey && hoverTimer.current?.id === openKey) clearHover();
    },
    onDrop: (e: DragEvent) => drop(target, e),
  });

  // Reorder among siblings: drop just before `beforeId` (null = at the end) of `containerId`.
  const reordering = useRef(false);
  const reorder = async (kind: "project" | "folder", containerId: string | null, beforeId: string | null) => {
    const d = drag;
    endTreeDrag();
    if (!d || d.kind !== kind || reordering.current || !canManage) return;
    if (kind === "folder" && !canMoveInto(d, containerId, folders)) return;
    const list: Array<NexusProject | NexusProjectFolder> = kind === "folder" ? folders : projects;
    const dragged = list.find((x) => x.id === d.id);
    if (!dragged) return;
    const group = (kind === "folder" ? childFolders.get(containerId ?? ROOT) ?? [] : childProjects.get(containerId ?? ROOT) ?? []).slice().sort(byPos);
    const without = group.filter((g) => g.id !== d.id);
    const at = beforeId ? without.findIndex((g) => g.id === beforeId) : without.length;
    const next = [...without.slice(0, at === -1 ? without.length : at), dragged, ...without.slice(at === -1 ? without.length : at)];
    reordering.current = true;
    try {
      await Promise.all(
        next.flatMap((item, i) => {
          const cur = kind === "folder" ? ((item as NexusProjectFolder).parentFolderId ?? null) : ((item as NexusProject).folderId ?? null);
          const moved = item.id === d.id && cur !== containerId;
          if ((item.position ?? 0) === i && !moved) return [];
          return [
            kind === "folder"
              ? nexusApi.projectFolderUpdate(item.id, { position: i, ...(moved ? { parentFolderId: containerId } : {}) })
              : nexusApi.updateProject(item.id, { position: i, ...(moved ? { folderId: containerId } : {}) }),
          ];
        }),
      );
    } catch (e) {
      toast.error(t("Couldn't reorder"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      reordering.current = false;
      invalidateProjectData(qc); // always back to the server's truth, also after a half-failed batch
    }
  };

  // ── Rows ──
  const projectRow = (p: NexusProject, opts: { key: string; draggable: boolean }) => {
    const active = pathname === `/projects/${p.id}` || pathname.startsWith(`/projects/${p.id}/`);
    return (
      <SidebarMenuItem key={opts.key} {...(opts.draggable ? dragProps({ kind: "project", id: p.id, from: p.folderId ?? null }) : {})} className={cn(drag?.kind === "project" && drag.id === p.id && "opacity-50")}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {/* A long name takes a second line, then shrinks a little, before an ellipsis (FitText; QA final #2:
                "PATS: INDONESIA TAKEOVER" was cut at 175 px). One-line rows keep their 32 px. */}
            {/* The open project keeps the regular weight (its tint marks it): medium made a long name wider than the
                same name unselected, so it shrank to 75% and was cut (old UI note, 25 Oct 2026). */}
            <SidebarMenuButton asChild isActive={active} tooltip={p.name} className="h-auto min-h-8 py-1.5 pr-7 data-[active=true]:font-normal">
              <Link to="/projects/$projectId" params={{ projectId: p.id }} draggable={false} title={p.name}>
                <ProjectGlyph project={p} />
                <FitText text={p.name} title={null} className="min-w-0 flex-1 leading-tight" />
              </Link>
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-60">
            <TreeMenuBody kind="context" title={p.name} glyph={<ProjectGlyph project={p} size={14} />} entries={projectMenuEntries(p, actions, t)} />
          </ContextMenuContent>
        </ContextMenu>
        {!collapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction showOnHover aria-label={t("More for {name}", { name: p.name })} className="text-sidebar-foreground/60">
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-60">
              <TreeMenuBody kind="dropdown" title={p.name} glyph={<ProjectGlyph project={p} size={14} />} entries={projectMenuEntries(p, actions, t)} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    );
  };

  const folderNode = (f: NexusProjectFolder, keyPrefix: string, path: Set<string>): ReactNode => {
    if (path.has(f.id)) return null; // a cycle in bad data must not hang the sidebar
    const openKey = keyPrefix + f.id;
    const open = expanded.has(openKey);
    const subs = (childFolders.get(f.id) ?? []).filter(visibleFolder);
    const items = childProjects.get(f.id) ?? [];
    const count = subs.length + items.length;
    const isTarget = dropTarget === f.id;
    const pinCopy = keyPrefix !== "";
    const containsActive = !open && activeChain.has(f.id);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(openKey); }
      else if (e.key === "ArrowRight" && !open) { e.preventDefault(); setOpen(openKey, true); }
      else if (e.key === "ArrowLeft" && open) { e.preventDefault(); setOpen(openKey, false); }
    };
    const nextPath = new Set(path).add(f.id);
    return (
      <li key={openKey} className={cn("list-none", drag?.kind === "folder" && drag.id === f.id && "opacity-50")}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={open}
              title={f.name}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("[data-row-action]")) toggle(openKey); }}
              onKeyDown={onKeyDown}
              {...(!pinCopy ? dragProps({ kind: "folder", id: f.id, from: f.parentFolderId ?? null }) : {})}
              {...dropInto(f.id, openKey)}
              className={cn(
                "group/folder relative flex min-h-8 cursor-pointer py-1 select-none items-center gap-1.5 rounded-md pl-1 pr-1 text-sm font-medium text-sidebar-foreground outline-none ring-sidebar-ring transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
                activeFolderId === f.id && "bg-sidebar-accent text-sidebar-accent-foreground",
                isTarget && "bg-primary/10 text-primary ring-1 ring-inset ring-primary/60",
              )}
            >
              <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-150", open && "rotate-90")} />
              <FolderGlyph folder={f} open={open} className={cn(!f.color && "text-sidebar-foreground/60")} />
              <FitText text={f.name} title={null} className="min-w-0 flex-1 leading-tight" />
              {containsActive && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
              {!open && count > 0 && (
                <span className="shrink-0 pr-1 text-[11px] font-normal tabular-nums text-sidebar-foreground/40 group-hover/folder:hidden group-focus-within/folder:hidden [@media(hover:none)]:hidden">{count}</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-row-action
                    aria-label={t("More for {name}", { name: f.name })}
                    className="hidden h-6 w-6 shrink-0 place-items-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:grid group-hover/folder:grid pointer-coarse:grid group-focus-within/folder:grid data-[state=open]:grid [@media(hover:none)]:grid"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-60">
                  <TreeMenuBody kind="dropdown" title={f.name} glyph={<FolderGlyph folder={f} size={14} />} entries={folderMenuEntries(f, actions, t)} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-60">
            <TreeMenuBody kind="context" title={f.name} glyph={<FolderGlyph folder={f} size={14} />} entries={folderMenuEntries(f, actions, t)} />
          </ContextMenuContent>
        </ContextMenu>
        {open && (
          // One guide line per level, drawn under the chevron of the folder it belongs to.
          <ul role="group" className="ml-[10px] mt-0.5 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border pl-1.5">
            {subs.map((sf) => (
              <Fragment key={sf.id}>
                {!pinCopy && <ReorderSlot active={drag?.kind === "folder" && drag.id !== sf.id} onDrop={() => reorder("folder", f.id, sf.id)} />}
                {folderNode(sf, keyPrefix, nextPath)}
              </Fragment>
            ))}
            {!pinCopy && subs.length > 0 && <ReorderSlot active={drag?.kind === "folder"} onDrop={() => reorder("folder", f.id, null)} />}
            {items.map((p) => (
              <Fragment key={p.id}>
                {!pinCopy && <ReorderSlot active={drag?.kind === "project" && drag.id !== p.id} onDrop={() => reorder("project", f.id, p.id)} />}
                {projectRow(p, { key: keyPrefix + p.id, draggable: !pinCopy })}
              </Fragment>
            ))}
            {!pinCopy && items.length > 0 && <ReorderSlot active={drag?.kind === "project"} onDrop={() => reorder("project", f.id, null)} />}
            {count === 0 && (
              <li className="list-none px-2 py-1.5 text-xs text-sidebar-foreground/45">
                {canManage ? t("Empty — drag a project here") : t("Nothing here yet")}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  // ── Icon-only rail: pinned projects, then a folder icon per root folder (opens its folder view),
  //    then the projects outside folders. No labels, no tree.
  if (collapsed) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {pinnedProjects.map((p) => projectRow(p, { key: `pin:${p.id}`, draggable: false }))}
            {rootFolders.map((f) => (
              <SidebarMenuItem key={f.id}>
                <SidebarMenuButton asChild tooltip={f.name} isActive={activeFolderId === f.id || activeChain.has(f.id)}>
                  <Link to="/calendar" search={{ folder: f.id }}>
                    <FolderGlyph folder={f} />
                    <span className="truncate">{f.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {unfiled.map((p) => projectRow(p, { key: p.id, draggable: false }))}
          </SidebarMenu>
        </SidebarGroupContent>
        {dialogs}
      </SidebarGroup>
    );
  }

  const showNoFolder = unfiled.length > 0 || (drag && canDropInto(drag, null, folders));
  return (
    <SidebarGroup>
      {/* Drawn over the nav's bottom fade (AppSidebar), so the header reads whole when it sits in it; faded it
          looked disabled (UI tour run 15, R15-WD-10). */}
      <div className="relative z-10 flex items-center justify-between pr-1">
        <SidebarGroupLabel className="m-0">{t("Projects")}</SidebarGroupLabel>
        <NewMenu canManage={canManage} onNewProject={() => actions.newProjectIn(null)} onNewFolder={() => actions.newFolder(null)} />
      </div>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {(pinnedFolders.length > 0 || pinnedProjects.length > 0) && (
            <>
              <TreeLabel icon={<Pin aria-hidden className="h-3 w-3" />}>{t("Pinned")}</TreeLabel>
              {pinnedFolders.map((f) => folderNode(f, "pin:", new Set()))}
              {pinnedProjects.map((p) => projectRow(p, { key: `pin:${p.id}`, draggable: false }))}
            </>
          )}

          {rootFolders.length > 0 && (
            <>
              <TreeLabel>{t("Folders")}</TreeLabel>
              {rootFolders.map((f) => (
                <Fragment key={f.id}>
                  <ReorderSlot active={drag?.kind === "folder" && drag.id !== f.id} onDrop={() => reorder("folder", null, f.id)} />
                  {folderNode(f, "", new Set())}
                </Fragment>
              ))}
              <ReorderSlot active={drag?.kind === "folder"} onDrop={() => reorder("folder", null, null)} />
            </>
          )}

          {showNoFolder && (
            <>
              <TreeLabel icon={<Inbox aria-hidden className="h-3 w-3" />} active={dropTarget === ROOT} {...dropInto(null)}>
                {drag && canDropInto(drag, null, folders) ? t("No folder — drop here to take it out") : t("No folder")}
              </TreeLabel>
              <li className="list-none" {...dropInto(null)}>
                <ul className={cn("flex min-w-0 flex-col gap-0.5 rounded-md", dropTarget === ROOT && "bg-primary/5")}>
                  {unfiled.map((p) => (
                    <Fragment key={p.id}>
                      <ReorderSlot active={drag?.kind === "project" && drag.id !== p.id} onDrop={() => reorder("project", null, p.id)} />
                      {projectRow(p, { key: p.id, draggable: true })}
                    </Fragment>
                  ))}
                  {unfiled.length > 0 && <ReorderSlot active={drag?.kind === "project"} onDrop={() => reorder("project", null, null)} />}
                </ul>
              </li>
            </>
          )}

          {projects.length === 0 && rootFolders.length === 0 && !projectsQuery.isLoading && (
            <li className="list-none px-2 py-1.5 text-xs text-sidebar-foreground/50">{t("No projects yet")}</li>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      {dialogs}
    </SidebarGroup>
  );
}

function NewMenu({ canManage, onNewProject, onNewFolder }: { canManage: boolean; onNewProject: () => void; onNewFolder: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title={t("New project or folder")} aria-label={t("New project or folder")} className="grid h-6 w-6 place-items-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5">
        <button type="button" onClick={() => { setOpen(false); onNewProject(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
          <Rocket className="h-3.5 w-3.5 text-primary" /> {t("New project")}
        </button>
        {canManage && (
          <button type="button" onClick={() => { setOpen(false); onNewFolder(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" /> {t("New folder")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

