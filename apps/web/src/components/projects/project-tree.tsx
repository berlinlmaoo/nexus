// ─────────────────────────────────────────────────────────────────────────────
// The project tree's shared parts (owner, 10 Oct 2026): the sidebar and Mission Control show the same
// folders and projects, so they share one set of actions (move, pin, edit, delete…), one menu (right
// click, or the "…" button on touch), one folder form and one delete confirmation.
// Moves are optimistic: the tree changes at once, and goes back with a toast if the server says no.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { toast } from "sonner";
import {
  ArrowUpRight, Check, Folder, FolderInput, FolderOpen, FolderOutput, FolderPlus, ImagePlus, Pencil,
  Pin, PinOff, Plus, Settings2, Trash2, type LucideIcon,
} from "lucide-react";
import {
  ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProjectIcon, ProjectMarkFor } from "@/components/projects/ProjectIcon";
import { nexusApi, type NexusProject, type NexusProjectFolder } from "@/lib/nexus-api";
import { canMoveInto, folderPath } from "@/lib/folder-tree-client";
import { canAddSubfolder } from "@/lib/project-tree-dnd";
import { invalidateProjectData } from "@/lib/invalidate";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

// ── Glyphs: a folder looks like a folder, a project never does ───────────────────────────────────────

const FOLDERISH = new Set(["📁", "📂", "🗂️", "🗂", "folder"]);
const isUploadedIcon = (icon?: string | null) => !!icon && /^(\/|https?:)/.test(icon);
const isCustomIcon = (icon?: string | null) => !!icon && !FOLDERISH.has(icon.trim().toLowerCase());

/** A folder's mark: its own photo or emoji if it has one, else a drawn folder in the folder's colour. */
export function FolderGlyph({ folder, open, size = 16, className }: { folder: Pick<NexusProjectFolder, "icon" | "color">; open?: boolean; size?: number; className?: string }) {
  if (isCustomIcon(folder.icon)) {
    return (
      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded leading-none", className)} style={{ width: size, height: size, fontSize: size - 3 }}>
        <ProjectIcon icon={folder.icon} className="h-full w-full rounded object-cover" />
      </span>
    );
  }
  const Icon = open ? FolderOpen : Folder;
  // A near-black folder colour (the picker offers #111827) would vanish on the dark theme's surfaces:
  // there it draws in the text colour instead. The stored colour is left as it is.
  return <Icon aria-hidden className={cn("shrink-0", isNearBlack(folder.color) && "dark:text-foreground!", className)} style={{ width: size, height: size, color: folder.color || undefined }} strokeWidth={2} />;
}

/** True for a #rgb / #rrggbb colour too dark to read on the dark theme's surfaces (luminance under 4%). */
function isNearBlack(color?: string | null): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) < 0.04;
}

/**
 * A project's mark: its photo, else the one default every project shares — the grey Notion-style page
 * icon (owner: no per-project emoji or colour since 11 Oct 2026; page icon = option A, 14 Oct).
 */
export function ProjectGlyph({ project, size = 16, className }: { project: Pick<NexusProject, "icon" | "color"> & { id?: string }; size?: number; className?: string }) {
  return <ProjectMarkFor projectId={project.id} icon={project.icon} size={size} className={className} />;
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────────

export type TreeActions = {
  folders: NexusProjectFolder[];
  /** Workspace BoD / Manager / One Above All: the only roles the server lets move, edit or delete. */
  canManage: boolean;
  isPinnedProject: (id: string) => boolean;
  isPinnedFolder: (id: string) => boolean;
  openProject: (id: string) => void;
  openFolderView: (id: string) => void;
  projectSettings: (id: string) => void;
  newProjectIn: (folderId: string | null) => void;
  newFolder: (parent: NexusProjectFolder | null) => void;
  editFolder: (f: NexusProjectFolder) => void;
  deleteFolder: (f: NexusProjectFolder) => void;
  moveProject: (p: Pick<NexusProject, "id" | "name" | "folderId">, folderId: string | null) => void;
  moveFolder: (f: NexusProjectFolder, parentFolderId: string | null) => void;
  toggleProjectPin: (id: string) => void;
  toggleFolderPin: (id: string) => void;
};

type FolderForm = { mode: "create" | "edit"; id?: string; name: string; icon: string; color: string; parentId?: string | null; parentName?: string; iconFile?: File | null; workspaceId?: string };

/** Every key of a cached list of projects or folders, in both namespaces (see lib/invalidate.ts). */
const listQueries = (segment: "projects" | "project-folders") => (q: Query) => q.queryKey.includes(segment) && Array.isArray(q.state.data);

/**
 * The tree's actions plus the dialogs they open. `workspaceId`: where a new root folder goes (the
 * caller's workspace); a subfolder always goes where its parent is.
 */
export function useProjectTreeActions({ folders, canManage, workspaceId }: { folders: NexusProjectFolder[]; canManage: boolean; workspaceId?: string | null }): { actions: TreeActions; dialogs: ReactNode } {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useLang();
  const pins = useQuery({ queryKey: ["nexus", "project-pins"], queryFn: nexusApi.projectPins, retry: false, staleTime: 60_000 });
  const folderPins = useQuery({ queryKey: ["nexus", "folder-pins"], queryFn: nexusApi.folderPins, retry: false, staleTime: 60_000 });
  const pinnedProjects = useMemo(() => new Set(pins.data?.projectIds ?? []), [pins.data]);
  const pinnedFolders = useMemo(() => new Set(folderPins.data?.folderIds ?? []), [folderPins.data]);
  const [form, setForm] = useState<FolderForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<NexusProjectFolder | null>(null);

  const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : t("Try again in a moment."));
  const folderName = (id: string | null) => (id ? folders.find((f) => f.id === id)?.name ?? "" : t("No folder"));

  /** Patch one row in every cached list at once; returns the undo. */
  const patchLists = async (segment: "projects" | "project-folders", id: string, patch: Record<string, unknown>) => {
    const predicate = listQueries(segment);
    await qc.cancelQueries({ predicate });
    const before = qc.getQueriesData({ predicate });
    qc.setQueriesData({ predicate }, (old: unknown) =>
      Array.isArray(old) ? old.map((x: { id?: string }) => (x && x.id === id ? { ...x, ...patch } : x)) : old,
    );
    return () => before.forEach(([key, data]) => qc.setQueryData(key, data));
  };

  const moveProject: TreeActions["moveProject"] = async (p, folderId) => {
    const from = p.folderId ?? null;
    if (!canManage || from === folderId) return;
    const undo = await patchLists("projects", p.id, { folderId });
    try {
      await nexusApi.updateProject(p.id, { folderId });
      toast.success(folderId ? t("Moved “{name}” to {folder}", { name: p.name, folder: folderName(folderId) }) : t("Took “{name}” out of its folder", { name: p.name }), {
        action: { label: t("Undo"), onClick: () => moveProject({ ...p, folderId }, from) },
      });
    } catch (e) {
      undo();
      toast.error(t("Couldn't move “{name}”", { name: p.name }), { description: errText(e) });
    } finally {
      invalidateProjectData(qc);
    }
  };

  const moveFolder: TreeActions["moveFolder"] = async (f, parentFolderId) => {
    const from = f.parentFolderId ?? null;
    if (!canManage || from === parentFolderId) return;
    if (!canMoveInto({ kind: "folder", id: f.id }, parentFolderId, folders)) {
      toast.error(t("Couldn't move “{name}”", { name: f.name }), { description: t("Folders go at most 4 levels deep, and never inside themselves.") });
      return;
    }
    const undo = await patchLists("project-folders", f.id, { parentFolderId });
    try {
      await nexusApi.projectFolderUpdate(f.id, { parentFolderId });
      toast.success(parentFolderId ? t("Moved “{name}” to {folder}", { name: f.name, folder: folderName(parentFolderId) }) : t("Moved “{name}” to the top level", { name: f.name }), {
        action: { label: t("Undo"), onClick: () => moveFolder({ ...f, parentFolderId }, from) },
      });
    } catch (e) {
      undo();
      toast.error(t("Couldn't move “{name}”", { name: f.name }), { description: errText(e) });
    } finally {
      invalidateProjectData(qc);
    }
  };

  const togglePin = async (kind: "project" | "folder", id: string) => {
    const key = kind === "project" ? ["nexus", "project-pins"] : ["nexus", "folder-pins"];
    const field = kind === "project" ? "projectIds" : "folderIds";
    const set = kind === "project" ? pinnedProjects : pinnedFolders;
    const pinned = !set.has(id);
    const before = qc.getQueryData(key);
    qc.setQueryData(key, (old: Record<string, string[]> | undefined) => {
      const ids = old?.[field] ?? [];
      return { ...(old ?? {}), [field]: pinned ? [...ids, id] : ids.filter((x) => x !== id) };
    });
    try {
      if (kind === "project") await nexusApi.setProjectPin(id, pinned);
      else await nexusApi.setFolderPin(id, pinned);
    } catch (e) {
      qc.setQueryData(key, before);
      toast.error(t("Couldn't update the pin"), { description: errText(e) });
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const saveForm = async () => {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      let folderId = form.id;
      if (form.mode === "create") {
        const ws = form.workspaceId || workspaceId || folders[0]?.workspaceId;
        if (!ws) throw new Error(t("Your workspace hasn't loaded yet. Refresh the page and try again."));
        const saved = await nexusApi.projectFolderCreate(ws, { name, icon: form.icon, color: form.color, parentFolderId: form.parentId ?? null });
        folderId = saved?.id;
      } else if (form.id) {
        await nexusApi.projectFolderUpdate(form.id, { name, icon: form.icon, color: form.color });
      }
      // A photo goes up after the save: a new folder needs its id first.
      if (form.iconFile && folderId) await nexusApi.uploadFolderIcon(folderId, form.iconFile);
      setForm(null);
    } catch (e) {
      toast.error(t("Couldn't save the folder"), { description: errText(e) });
    } finally {
      setSaving(false);
      invalidateProjectData(qc);
    }
  };

  const confirmDelete = async () => {
    const f = deleting;
    if (!f) return;
    setDeleting(null);
    try {
      await nexusApi.projectFolderDelete(f.id);
      toast.success(t("Folder “{name}” deleted", { name: f.name }), { description: t("What was inside moved up one level.") });
    } catch (e) {
      toast.error(t("Couldn't delete “{name}”", { name: f.name }), { description: errText(e) });
    } finally {
      invalidateProjectData(qc);
    }
  };

  const actions: TreeActions = {
    folders,
    canManage,
    isPinnedProject: (id) => pinnedProjects.has(id),
    isPinnedFolder: (id) => pinnedFolders.has(id),
    openProject: (id) => navigate({ to: "/projects/$projectId", params: { projectId: id } }),
    openFolderView: (id) => navigate({ to: "/folders/$folderId", params: { folderId: id } }),
    projectSettings: (id) => navigate({ to: "/projects/$projectId", params: { projectId: id }, search: { settings: 1 } }),
    newProjectIn: (folderId) => navigate({ to: "/projects", search: { new: 1, folder: folderId ?? undefined } }),
    newFolder: (parent) => {
      if (!canManage) return;
      if (parent && !canAddSubfolder(parent.id, folders)) {
        toast.error(t("Folders go at most 4 levels deep, and never inside themselves."));
        return;
      }
      setForm({ mode: "create", name: "", icon: "📁", color: parent?.color || "#7B2FBE", parentId: parent?.id ?? null, parentName: parent?.name, workspaceId: parent?.workspaceId });
    },
    editFolder: (f) => canManage && setForm({ mode: "edit", id: f.id, name: f.name, icon: f.icon || "📁", color: f.color || "#7B2FBE" }),
    deleteFolder: (f) => canManage && setDeleting(f),
    moveProject,
    moveFolder,
    toggleProjectPin: (id) => void togglePin("project", id),
    toggleFolderPin: (id) => void togglePin("folder", id),
  };

  const dialogs = (
    <>
      {form && (
        <FolderFormModal
          form={form}
          saving={saving}
          canSave={!!form.name.trim()}
          onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
          onCancel={() => setForm(null)}
          onSave={saveForm}
        />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete folder “{name}”?", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("The projects and subfolders inside move up one level — none of them are deleted. The folder itself can be restored from Control Room › Audit.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Delete folder")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { actions, dialogs };
}

// ── Menus: one list of entries, shown by right click (ContextMenu) or the "…" button (DropdownMenu) ──

type MoveTarget = { id: string; path: string; folder: NexusProjectFolder };
export type MenuEntry =
  | { type: "item"; key: string; label: string; icon: LucideIcon; onSelect: () => void; destructive?: boolean; disabled?: boolean }
  | { type: "sep"; key: string }
  | { type: "move"; key: string; label: string; icon: LucideIcon; current: string | null; rootLabel: string | null; targets: MoveTarget[]; onPick: (id: string | null) => void };

function moveTargets(folders: NexusProjectFolder[], allow: (f: NexusProjectFolder) => boolean): MoveTarget[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folders
    .filter(allow)
    .map((f) => ({ id: f.id, path: folderPath(f, byId), folder: f }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export function folderMenuEntries(f: NexusProjectFolder, a: TreeActions, t: (s: string, v?: Record<string, string | number>) => string): MenuEntry[] {
  const pinned = a.isPinnedFolder(f.id);
  const out: MenuEntry[] = [
    { type: "item", key: "open", label: t("Open folder view"), icon: ArrowUpRight, onSelect: () => a.openFolderView(f.id) },
    { type: "item", key: "new-project", label: t("New project here"), icon: Plus, onSelect: () => a.newProjectIn(f.id) },
  ];
  if (a.canManage) {
    out.push(
      { type: "item", key: "new-sub", label: t("New subfolder"), icon: FolderPlus, onSelect: () => a.newFolder(f), disabled: !canAddSubfolder(f.id, a.folders) },
      { type: "sep", key: "s1" },
      { type: "item", key: "edit", label: t("Rename or edit…"), icon: Pencil, onSelect: () => a.editFolder(f) },
      {
        type: "move", key: "move", label: t("Move to…"), icon: FolderInput, current: f.parentFolderId ?? null, rootLabel: t("Top level"),
        targets: moveTargets(a.folders, (x) => canMoveInto({ kind: "folder", id: f.id }, x.id, a.folders)),
        onPick: (id) => a.moveFolder(f, id),
      },
    );
  } else {
    out.push({ type: "sep", key: "s1" });
  }
  out.push({ type: "item", key: "pin", label: pinned ? t("Unpin") : t("Pin to top"), icon: pinned ? PinOff : Pin, onSelect: () => a.toggleFolderPin(f.id) });
  if (a.canManage) {
    out.push({ type: "sep", key: "s2" }, { type: "item", key: "delete", label: t("Delete folder…"), icon: Trash2, destructive: true, onSelect: () => a.deleteFolder(f) });
  }
  return out;
}

export function projectMenuEntries(p: NexusProject, a: TreeActions, t: (s: string, v?: Record<string, string | number>) => string): MenuEntry[] {
  const pinned = a.isPinnedProject(p.id);
  const out: MenuEntry[] = [
    { type: "item", key: "open", label: t("Open"), icon: ArrowUpRight, onSelect: () => a.openProject(p.id) },
    { type: "item", key: "pin", label: pinned ? t("Unpin") : t("Pin to top"), icon: pinned ? PinOff : Pin, onSelect: () => a.toggleProjectPin(p.id) },
  ];
  if (a.canManage) {
    out.push(
      { type: "sep", key: "s1" },
      { type: "move", key: "move", label: t("Move to folder…"), icon: FolderInput, current: p.folderId ?? null, rootLabel: null, targets: moveTargets(a.folders, () => true), onPick: (id) => a.moveProject(p, id) },
    );
    if (p.folderId) out.push({ type: "item", key: "out", label: t("Remove from folder"), icon: FolderOutput, onSelect: () => a.moveProject(p, null) });
  }
  out.push({ type: "sep", key: "s2" }, { type: "item", key: "settings", label: t("Project settings"), icon: Settings2, onSelect: () => a.projectSettings(p.id) });
  return out;
}

type Kit = {
  Item: ComponentType<any>; Sep: ComponentType<any>; Label: ComponentType<any>;
  Sub: ComponentType<any>; SubTrigger: ComponentType<any>; SubContent: ComponentType<any>;
};
const CONTEXT_KIT: Kit = { Item: ContextMenuItem, Sep: ContextMenuSeparator, Label: ContextMenuLabel, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent };
const DROPDOWN_KIT: Kit = { Item: DropdownMenuItem, Sep: DropdownMenuSeparator, Label: DropdownMenuLabel, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent };

/** The body of a tree menu: put it inside a ContextMenuContent (`kind="context"`) or a DropdownMenuContent. */
export function TreeMenuBody({ kind, title, glyph, entries }: { kind: "context" | "dropdown"; title: string; glyph?: ReactNode; entries: MenuEntry[] }) {
  const K = kind === "context" ? CONTEXT_KIT : DROPDOWN_KIT;
  const { t } = useLang();
  // Stops a click inside the menu from reaching a row or link under it (menus portal, events bubble in React).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div onClick={stop} onPointerDown={stop}>
      <K.Label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
        {glyph}
        <span className="truncate" title={title}>{title}</span>
      </K.Label>
      <K.Sep />
      {entries.map((e) => {
        if (e.type === "sep") return <K.Sep key={e.key} />;
        if (e.type === "item") {
          const Icon = e.icon;
          return (
            <K.Item key={e.key} disabled={e.disabled} onSelect={e.onSelect} className={cn("gap-2", e.destructive && "text-destructive focus:bg-destructive/10 focus:text-destructive")}>
              <Icon className="h-3.5 w-3.5 shrink-0" /> {e.label}
            </K.Item>
          );
        }
        const Icon = e.icon;
        return (
          <K.Sub key={e.key}>
            <K.SubTrigger className="gap-2"><Icon className="h-3.5 w-3.5 shrink-0" /> {e.label}</K.SubTrigger>
            <K.SubContent className="max-h-80 w-64 overflow-y-auto">
              <K.Item disabled={e.current === null} onSelect={() => e.onPick(null)} className="gap-2">
                <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">{e.current === null && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                <span className="text-muted-foreground">{e.rootLabel ?? t("No folder")}</span>
              </K.Item>
              {e.targets.length > 0 && <K.Sep />}
              {e.targets.map((x) => (
                <K.Item key={x.id} disabled={x.id === e.current} onSelect={() => e.onPick(x.id)} className="gap-2" title={x.path}>
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">{x.id === e.current && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                  <FolderGlyph folder={x.folder} size={14} className="text-muted-foreground" />
                  <span className="truncate">{x.path}</span>
                </K.Item>
              ))}
            </K.SubContent>
          </K.Sub>
        );
      })}
    </div>
  );
}

// ── Folder form (new / edit), shared by the sidebar and Mission Control ─────────────────────────────

const FOLDER_COLORS = ["#7B2FBE", "#4EB301", "#2563EB", "#DB2777", "#F59E0B", "#10B981", "#0EA5E9", "#111827"];

export function FolderFormModal({ form, saving, canSave, onChange, onCancel, onSave }: {
  form: { mode: "create" | "edit"; name: string; icon: string; color: string; parentName?: string; iconFile?: File | null };
  saving: boolean; canSave: boolean;
  onChange: (patch: Partial<{ name: string; icon: string; color: string; iconFile: File | null }>) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  // Preview priority: freshly-picked file > already-uploaded URL > emoji input box.
  const pickedPreview = useMemo(() => (form.iconFile ? URL.createObjectURL(form.iconFile) : null), [form.iconFile]);
  useEffect(() => () => { if (pickedPreview) URL.revokeObjectURL(pickedPreview); }, [pickedPreview]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const uploadedUrl = !form.iconFile && form.icon.startsWith("/") ? form.icon : null;
  const photoPreview = pickedPreview ?? uploadedUrl;
  const title = form.mode === "create" ? (form.parentName ? t("New subfolder") : t("New folder")) : t("Edit folder");
  return (
    <div className="fixed inset-0 z-[60] grid grid-cols-1 place-items-center bg-black/35 dark:bg-scrim px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-sm rounded-[28px] border border-border bg-card p-5 shadow-pop">
        <h2 className="text-lg font-black tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {form.parentName ? t("Inside “{name}”.", { name: form.parentName }) + " " : ""}{t("Group your projects to keep the Projects page tidy.")}
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-10 w-12 shrink-0 rounded-xl border border-border object-cover" />
            ) : (
              <input value={form.icon} onChange={(e) => onChange({ icon: e.target.value.slice(0, 4) })} className="h-10 w-12 rounded-xl border border-border bg-background text-center text-xl outline-none focus:border-primary" aria-label={t("Emoji")} />
            )}
            <input
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t("Folder name")}
              aria-label={t("Folder name")}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && canSave && !saving) onSave(); }}
              className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-accent">
              <ImagePlus className="h-3.5 w-3.5" />{photoPreview ? t("Change photo") : t("Upload photo")}
            </button>
            {photoPreview && (
              <button type="button" onClick={() => { onChange({ iconFile: null, icon: "📁" }); if (fileRef.current) fileRef.current.value = ""; }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />{t("Back to emoji")}
              </button>
            )}
            <span className="text-[10px] text-muted-foreground">{t("PNG/JPG/SVG/WEBP, max 5MB")}</span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange({ iconFile: f }); }} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Colour")}>
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.color === c} onClick={() => onChange({ color: c })} className={cn("h-7 w-7 rounded-full border-2 transition", form.color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onPress={onCancel}>{t("Cancel")}</Button>
          <Button size="sm" variant="primary" isDisabled={!canSave || saving} onPress={onSave}>{saving ? t("Saving…") : t("Save")}</Button>
        </div>
      </div>
    </div>
  );
}
