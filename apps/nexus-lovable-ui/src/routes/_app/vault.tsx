import {
  useCallback, useEffect, useMemo, useRef, useState,
  type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement,
} from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check, ChevronRight, Download, ExternalLink, Eye, File as FileIcon, FileText, Film,
  FolderInput, FolderPlus, Folder, HardDrive, Image as ImageIcon, ListChecks, Loader2, Lock, Music,
  MoreVertical, Pencil, RefreshCw, RotateCcw, Search, Share2, ShieldCheck, Trash2, Upload, X,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { VaultAccessDialog } from "@/components/vault/VaultAccessDialog";
import { VaultLightbox } from "@/components/vault/VaultLightbox";
import { VaultMoveDialog } from "@/components/vault/VaultMoveDialog";
import { VaultShareDialog } from "@/components/vault/VaultShareDialog";
import { CHECKERBOARD, VaultTilePicture } from "@/components/vault/VaultTilePicture";
import { cn } from "@/lib/utils";
import { useDocumentLang, useLang } from "@/lib/lang";
import { ApiError, nexusApi, type VaultItem } from "@/lib/nexus-api";
import { fillsTile, humanSize, isPdf, mediaKind } from "@/lib/vault-media";
import { VAULT_ITEM_MIME, canMoveInto, dragKind, dropKey, filesOfDrop, type DraggedVaultItem } from "@/lib/vault-dnd";
import { vaultUploads } from "@/lib/vault-uploads";
import { failureList, runBulk, type BulkResult } from "@/lib/vault-bulk";

/**
 * The vault's address (9 Oct 2026): `?folder=<id>` is the folder on screen, so refresh, Back and a
 * pasted link all land in the same place; `?trash=1` the trash; `?item=<id>` opens any item from
 * elsewhere (Control Room → Audit's "Open Vault"): a folder is browsed, a file opens in its folder.
 */
type VaultSearch = { folder?: string; trash?: "1"; item?: string };
export const Route = createFileRoute("/_app/vault")({
  component: VaultPage,
  validateSearch: (s: Record<string, unknown>): VaultSearch => ({
    folder: typeof s.folder === "string" && s.folder ? s.folder : undefined,
    trash: s.trash === "1" || s.trash === 1 ? "1" : undefined,
    item: typeof s.item === "string" && s.item ? s.item : undefined,
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault — the office's shared drive, one folder at a time.
//
// 9 Oct 2026 (owner): files dragged in from the desktop upload where they are dropped — onto the
// page into the folder on screen, onto a folder card into that folder. An item dragged onto a folder
// card or a crumb of the path moves there, and "Move to…" in every item's menu does the same with a
// keyboard or a finger. Pictures and films show as thumbnails and open in a full-screen viewer. A
// colleague's change shows up live (the server's "vault" ping, lib/realtime.tsx).
//
// English and Indonesian since the same day: every string goes through t() (lib/i18n/id-vault.ts).
//
// Later the same day (owner): uploads go to the app-wide queue and its panel (lib/vault-uploads.ts,
// components/vault/VaultUploadPanel.tsx) instead of rows on this page, so they keep going elsewhere
// in the app. Right-click on any item opens its ⋮ menu. Several items can be selected — Cmd-click on
// a Mac, Ctrl-click elsewhere, Shift-click for a range, Cmd/Ctrl+A for the folder, "Select" on a
// phone — and moved, downloaded as a zip or put in the trash together.
// ─────────────────────────────────────────────────────────────────────────────

/** One entry of an item's menu, drawn both as the ⋮ dropdown and as the right-click menu. */
type MenuEntry =
  | { kind: "item"; key: string; label: string; icon: LucideIcon; onSelect?: () => void; href?: string; disabled?: boolean; destructive?: boolean }
  | { kind: "separator"; key: string };

/** A Mac: Cmd-click selects, and Ctrl-click is the right-click (it must not also select). */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

const asDragged = (i: VaultItem): DraggedVaultItem => ({ id: i.id, kind: i.kind, parentId: i.parentId, name: i.name });

// ── helpers ──────────────────────────────────────────────────────────────────

function iconFor(item: VaultItem) {
  if (item.kind === "FOLDER") return Folder;
  const m = item.mimeType || "";
  if (m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Film;
  if (m.startsWith("audio/")) return Music;
  if (m === "application/pdf" || m.startsWith("text/")) return FileText;
  return FileIcon;
}

/** A role threshold as people say it. */
function roleLabel(role: string | null | undefined): string {
  return role === "BOD_PLUS" ? "BoD and above" : role === "MANAGER_PLUS" ? "Managers and above" : "Everyone";
}

/** Where something can be dropped or moved to: a folder (null = the top of the vault) and its name. */
type Destination = { id: string | null; name: string };

// ── page ─────────────────────────────────────────────────────────────────────

function VaultPage() {
  const qc = useQueryClient();
  const { t, tn, lang } = useLang();
  useDocumentLang(lang);

  const route = Route.useSearch();
  const navigate = useNavigate({ from: "/vault" });
  const parentId = route.folder ?? null;
  const trash = route.trash === "1";
  const [search, setSearch] = useState("");
  // Opening a folder is a step Back can undo, so each one is a history entry.
  const setParentId = useCallback((id: string | null) => {
    setSearch("");
    void navigate({ search: (id ? { folder: id } : {}) as VaultSearch });
  }, [navigate]);
  const setTrash = useCallback((on: boolean) => {
    void navigate({ search: (on ? { trash: "1" } : parentId ? { folder: parentId } : {}) as VaultSearch });
  }, [navigate, parentId]);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "purge"; item: VaultItem } | { kind: "empty" } | null>(null);
  const [preview, setPreview] = useState<VaultItem | null>(null);
  const [sharing, setSharing] = useState<VaultItem | null>(null);
  const [renaming, setRenaming] = useState<VaultItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moving, setMoving] = useState<VaultItem[] | null>(null);
  const [accessing, setAccessing] = useState<VaultItem | null>(null);
  const [replacing, setReplacing] = useState<VaultItem | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [viewer, setViewer] = useState<{ items: VaultItem[]; index: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Multi-select. `selected`: ids, in no order (the page's order is `ordered` below). `anchor`: where a
  // Shift-click range starts. `selectMode`: the "Select" button's mode, for touch, where there is no
  // Cmd or Ctrl to hold — in it (and whenever something is selected) a tap selects instead of opening.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [trashing, setTrashing] = useState<VaultItem[] | null>(null);
  const zipFrame = useRef<HTMLIFrameElement>(null);

  // Drag and drop. `dragging`: the vault item being dragged (null for files from the desktop), and
  // `draggingMany` every selected item when the dragged one is part of a selection.
  // `fileDrag`: files from the desktop are over the page. `target`: the drop target lit up (dropKey).
  const [dragging, setDragging] = useState<DraggedVaultItem | null>(null);
  const [draggingMany, setDraggingMany] = useState<VaultItem[] | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [target, setTarget] = useState<{ key: string; name: string } | null>(null);
  const dragDepth = useRef(0);

  const key = useMemo(
    () => ["vault", trash ? "trash" : "browse", trash ? "" : parentId ?? "root", search] as const,
    [parentId, trash, search],
  );
  const listing = useQuery({
    queryKey: key,
    queryFn: () => nexusApi.vaultList({ parentId, trash, q: search || undefined }),
  });

  const refresh = useCallback(() => { void qc.invalidateQueries({ queryKey: ["vault"] }); }, [qc]);

  const data = listing.data;
  const crumbs = data?.breadcrumb ?? [];
  const here: Destination = { id: parentId, name: crumbs.length ? crumbs[crumbs.length - 1].name : t("Vault") };
  const browsing = !trash && !search;
  const canDropFiles = browsing && !!data?.canWrite;

  const createFolder = useMutation({
    mutationFn: (name: string) => nexusApi.vaultCreateFolder(name, parentId),
    onSuccess: (item) => { toast.success(t("Folder “{name}” created", { name: item.name })); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't create the folder"), { description: e.message }),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => nexusApi.vaultUpdateItem(id, { name }),
    onSuccess: () => { toast.success(t("Renamed")); setRenaming(null); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't rename it"), { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) => nexusApi.vaultDeleteItem(id, purge),
    onSuccess: (_r, args) => { toast.success(args.purge ? t("Deleted permanently") : t("Moved to the trash")); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't delete it"), { description: e.message }),
  });

  const restore = useMutation({
    mutationFn: (id: string) => nexusApi.vaultUpdateItem(id, { restore: true }),
    onSuccess: () => { toast.success(t("Restored")); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't restore it"), { description: e.message }),
  });

  const emptyTrash = useMutation({
    mutationFn: () => nexusApi.vaultEmptyTrash(),
    onSuccess: (r) => { toast.success(tn(r.purged, "Trash emptied — {n} item", "Trash emptied — {n} items")); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't empty the trash"), { description: e.message }),
  });

  // The server's answer is the truth: a folder into its own subfolder, a folder this person may not
  // write in — whatever it refuses, its reason is shown as it gave it.
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: Destination }) => nexusApi.vaultUpdateItem(id, { parentId: to.id }),
    onSuccess: (moved, { to }) => { toast.success(t("“{name}” moved to {folder}", { name: moved.name, folder: to.name })); refresh(); },
    onError: (e: Error) => toast.error(t("Couldn't move it"), { description: e.message }),
  });

  // Uploads go to the app-wide queue (lib/vault-uploads.ts): one at a time — the server caps chunked
  // sessions per person — and on through navigation. Its panel shows progress, failures and Retry;
  // the folder on screen refreshes as each file lands.
  const uploadFiles = useCallback((files: File[], to: Destination) => {
    vaultUploads.enqueue(files, to);
  }, []);

  // Replace file… (9 Oct 2026): new bytes for the same item — same id, same place, same links. Through
  // the same queue as uploads.
  const replaceFile = useCallback((item: VaultItem, file: File, folderName: string) => {
    vaultUploads.enqueueReplace(item, file, folderName);
  }, []);

  // Several items at once: one request per item, a few at a time (lib/vault-bulk.ts), and one line
  // that says how many went and, when some did not, which and why.
  const reportBulk = useCallback((result: BulkResult<unknown>, success: (n: number) => string, partial: (done: number, total: number) => string) => {
    const total = result.ok.length + result.failed.length;
    if (!result.failed.length) toast.success(success(result.ok.length));
    else toast.error(partial(result.ok.length, total), {
      description: t("{n} failed: {list}", { n: result.failed.length, list: failureList(result.failed) }),
    });
    refresh();
  }, [refresh, t]);

  const moveMany = useCallback(async (list: VaultItem[], to: Destination) => {
    const result = await runBulk(list, (i) => nexusApi.vaultUpdateItem(i.id, { parentId: to.id }));
    reportBulk(
      result,
      (n) => tn(n, "{n} item moved to {folder}", "{n} items moved to {folder}", { folder: to.name }),
      (done, total) => t("{done} of {total} moved", { done, total }),
    );
  }, [reportBulk, t, tn]);

  const trashMany = useCallback(async (list: VaultItem[]) => {
    const result = await runBulk(list, (i) => nexusApi.vaultDeleteItem(i.id, false));
    reportBulk(
      result,
      (n) => tn(n, "{n} item moved to the trash", "{n} items moved to the trash"),
      (done, total) => t("{done} of {total} moved to the trash", { done, total }),
    );
  }, [reportBulk, t, tn]);

  const quotaPct = data ? Math.min(100, Math.round((data.quota.usedBytes / data.quota.totalBytes) * 100)) : 0;

  // Folders, then pictures and films as a gallery, then everything else — the server's order inside
  // each. The trash stays one flat list: nothing in it opens.
  const items = useMemo(() => data?.items ?? [], [data]);
  const folders = useMemo(() => (trash ? [] : items.filter((i) => i.kind === "FOLDER")), [items, trash]);
  const media = useMemo(() => (trash ? [] : items.filter((i) => mediaKind(i) !== null)), [items, trash]);
  const others = useMemo(
    () => (trash ? items : items.filter((i) => i.kind !== "FOLDER" && mediaKind(i) === null)),
    [items, trash],
  );

  // ── selection ──────────────────────────────────────────────────────────────

  /** The page's order — folders, gallery, files — which is what a Shift-click range follows. */
  const ordered = useMemo(() => (trash ? [] : [...folders, ...media, ...others]), [trash, folders, media, others]);
  const selecting = selectMode || selected.size > 0;
  const selectedItems = useMemo(() => ordered.filter((i) => selected.has(i.id)), [ordered, selected]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
    setSelectMode(false);
  }, []);

  // Another folder, or the trash: a selection belongs to what was on screen.
  useEffect(() => { clearSelection(); }, [parentId, trash, clearSelection]);
  // A new listing (a search, a colleague's change): keep only what is still there.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const here = new Set(ordered.map((i) => i.id));
      const next = new Set([...prev].filter((id) => here.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ordered]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setAnchor(id);
  }, []);

  /** Shift-click: everything from the anchor to here, added to what is already selected. */
  const selectRange = useCallback((id: string) => {
    const from = anchor ? ordered.findIndex((i) => i.id === anchor) : -1;
    const to = ordered.findIndex((i) => i.id === id);
    if (from < 0 || to < 0) { toggle(id); return; }
    const [a, b] = from <= to ? [from, to] : [to, from];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of ordered.slice(a, b + 1)) next.add(i.id);
      return next;
    });
  }, [anchor, ordered, toggle]);

  // Cmd/Ctrl+A selects the folder; Esc lets go. Not while typing, and not while a dialog or a menu
  // has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (trash) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "a") {
        if (!ordered.length) return;
        e.preventDefault();
        setSelected(new Set(ordered.map((i) => i.id)));
        setAnchor(ordered[0].id);
      } else if (e.key === "Escape" && (selected.size > 0 || selectMode)) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trash, ordered, selected.size, selectMode, clearSelection]);

  /** A click on an item: Shift extends, Cmd (Mac) / Ctrl (elsewhere) toggles, and while selecting a
   *  plain click toggles too; otherwise it opens. On a Mac Ctrl-click is the right-click and never
   *  reaches here as a click. */
  const onItemClick = (item: VaultItem) => (e: ReactMouseEvent<HTMLElement>) => {
    if (trash) { openItem(item); return; }
    // A browser that still sends the click after a Mac's Ctrl-click (the right-click) must not also
    // open the item under the menu.
    if (IS_MAC && e.ctrlKey) return;
    const toggleKey = IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey;
    if (e.shiftKey) { e.preventDefault(); selectRange(item.id); return; }
    if (toggleKey) { e.preventDefault(); toggle(item.id); return; }
    if (selecting) { toggle(item.id); return; }
    openItem(item);
  };
  /** Shift-click must not also select the text between two cards. */
  const noTextSelect = (e: ReactMouseEvent<HTMLElement>) => { if (e.shiftKey) e.preventDefault(); };

  /** Several items, or any folder, as one zip; a single file as itself. The size is asked first so a
   *  selection over the ceiling is refused here, not by a download that fails in the browser's list. */
  const downloadItems = async (list: VaultItem[]) => {
    if (!list.length) return;
    if (list.length === 1 && list[0].kind === "FILE" && list[0].downloadUrl) {
      window.location.assign(list[0].downloadUrl);
      return;
    }
    const ids = list.map((i) => i.id);
    try {
      await nexusApi.vaultZipCheck(ids);
    } catch (e) {
      const tooBig = e instanceof ApiError && e.status === 413;
      toast.error(tooBig ? t("Too big for one zip. Download fewer items at a time.") : t("Couldn't make the zip"),
        tooBig ? undefined : { description: e instanceof Error ? e.message : undefined });
      return;
    }
    // A plain form post into a hidden frame: the browser streams the archive to disk (no 1 GB blob in
    // memory), and the page stays where it is.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/vault/zip";
    form.target = zipFrame.current?.name ?? "_self";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "ids";
    input.value = ids.join(",");
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    toast.success(tn(list.length, "Preparing a zip of {n} item…", "Preparing a zip of {n} items…"));
  };

  const openItem = (item: VaultItem) => {
    if (trash) return;
    if (item.kind === "FOLDER") { setParentId(item.id); return; }
    const at = media.findIndex((m) => m.id === item.id);
    if (at >= 0) setViewer({ items: media, index: at });
    else setPreview(item);
  };

  // `?item=<id>` from elsewhere (Audit's "Open Vault"): find where it lives, go there, open it. Then
  // the param is dropped, so a refresh shows the folder rather than reopening the file.
  const deepItem = route.item;
  useEffect(() => {
    if (!deepItem) return;
    let gone = false;
    nexusApi.vaultItem(deepItem).then(({ item }) => {
      if (gone) return;
      if (item.trashed) void navigate({ search: { trash: "1" } as VaultSearch, replace: true });
      else if (item.kind === "FOLDER") void navigate({ search: { folder: item.id } as VaultSearch, replace: true });
      else {
        void navigate({ search: (item.parentId ? { folder: item.parentId } : {}) as VaultSearch, replace: true });
        setPreview(item);
      }
    }).catch(() => {
      if (!gone) void navigate({ search: {} as VaultSearch, replace: true });
    });
    return () => { gone = true; };
  }, [deepItem, navigate]);

  // ── drag and drop ──────────────────────────────────────────────────────────

  const endDrag = useCallback(() => {
    dragDepth.current = 0;
    setFileDrag(false);
    setTarget(null);
    setDragging(null);
    setDraggingMany(null);
  }, []);

  // A drag that ends anywhere (dropped outside the window, Esc) must not leave the page lit up. And a
  // file let go anywhere else while this page is open — over a dialog, the sidebar — must not make
  // the browser leave the app to open it: those drops are swallowed here.
  useEffect(() => {
    const off = () => endDrag();
    const guard = (e: DragEvent) => {
      if (dragKind(e.dataTransfer?.types) !== "files") return;
      // Over the page itself the page has already answered; anywhere else the answer is "no".
      const answered = e.defaultPrevented;
      e.preventDefault();
      if (e.type === "dragover" && e.dataTransfer && !answered) e.dataTransfer.dropEffect = "none";
    };
    const dropped = (e: DragEvent) => { guard(e); off(); };
    window.addEventListener("dragend", off);
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", dropped);
    return () => {
      window.removeEventListener("dragend", off);
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", dropped);
    };
  }, [endDrag]);

  /** The folders above a target, top first, as far as this page knows them. */
  const trailOf = (targetId: string | null): string[] => {
    if (targetId === null) return [];
    const at = crumbs.findIndex((c) => c.id === targetId);
    if (at >= 0) return crumbs.slice(0, at).map((c) => c.id);
    // A folder card: in the folder on screen, under its crumbs. In search results: unknown.
    return browsing ? [...crumbs.map((c) => c.id)] : [];
  };

  /** What a drag over `to` would do, or null when nothing (the drop is then refused). */
  const dropAction = (e: ReactDragEvent, to: Destination): "upload" | "move" | null => {
    if (trash) return null;
    const kind = dragKind(e.dataTransfer?.types);
    if (kind === "files") return "upload";
    if (kind === "item" && draggingMany) {
      // A selection: the drop is good when at least one of it can go there, and none of it IS there.
      const trail = trailOf(to.id);
      if (draggingMany.some((i) => i.id === to.id)) return null;
      return draggingMany.some((i) => canMoveInto(asDragged(i), to.id, trail) === "ok") ? "move" : null;
    }
    if (kind === "item" && dragging && canMoveInto(dragging, to.id, trailOf(to.id)) === "ok") return "move";
    return null;
  };

  /** dragenter/dragover/dragleave/drop for a folder card or a crumb. Lit from dragenter, not only the
   *  first dragover, so the target answers the moment the pointer arrives. dragenter still bubbles:
   *  the page counts enters against leaves to know when files have left it. */
  const targetProps = (k: string, to: Destination) => {
    const over = (e: ReactDragEvent<HTMLElement>, isEnter: boolean) => {
      const action = dropAction(e, to);
      if (!action) return;
      e.preventDefault();
      if (!isEnter) e.stopPropagation();
      e.dataTransfer.dropEffect = action === "move" ? "move" : "copy";
      if (target?.key !== k) setTarget({ key: k, name: to.name });
    };
    return {
    onDragEnter: (e: ReactDragEvent<HTMLElement>) => over(e, true),
    onDragOver: (e: ReactDragEvent<HTMLElement>) => over(e, false),
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setTarget((cur) => (cur?.key === k ? null : cur));
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      const action = dropAction(e, to);
      e.preventDefault();
      e.stopPropagation();
      const moved = dragging;
      const many = draggingMany;
      const dropped = action === "upload" ? filesOfDrop(e.dataTransfer) : null;
      endDrag();
      if (action === "move" && many) {
        const trail = trailOf(to.id);
        void moveMany(many.filter((i) => canMoveInto(asDragged(i), to.id, trail) === "ok"), to);
      } else if (action === "move" && moved) move.mutate({ id: moved.id, to });
      else if (dropped) receiveFiles(dropped, to);
    },
    };
  };

  const receiveFiles = (dropped: { files: File[]; folders: string[] }, to: Destination) => {
    if (dropped.folders.length) {
      toast.info(
        tn(dropped.folders.length, "A folder can't be dropped yet", "{n} folders can't be dropped yet"),
        { description: t("Open the folder on your computer and drop the files inside it. To keep them together here, make the folder in the vault first.") },
      );
    }
    uploadFiles(dropped.files, to);
  };

  // The page itself: files from the desktop land in the folder on screen. In the trash and in search
  // results there is no folder on screen to speak of, and the page says no (folder cards still say yes).
  const pageDrop = {
    onDragEnter: (e: ReactDragEvent<HTMLDivElement>) => {
      if (dragKind(e.dataTransfer?.types) !== "files" || !canDropFiles) return;
      dragDepth.current += 1;
      setFileDrag(true);
    },
    onDragLeave: () => {
      if (dragDepth.current === 0) return;
      dragDepth.current -= 1;
      if (dragDepth.current === 0) setFileDrag(false);
    },
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => {
      if (dragKind(e.dataTransfer?.types) !== "files") return;
      e.preventDefault();
      e.dataTransfer.dropEffect = canDropFiles ? "copy" : "none";
      if (target) setTarget(null);
    },
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => {
      if (dragKind(e.dataTransfer?.types) !== "files") { endDrag(); return; }
      e.preventDefault();
      const dropped = canDropFiles ? filesOfDrop(e.dataTransfer) : null;
      endDrag();
      if (dropped) receiveFiles(dropped, here);
    },
  };

  /** The props that make an item card draggable (when this person may move it). */
  const dragProps = (item: VaultItem) =>
    !trash && item.canModify
      ? {
          draggable: true,
          onDragStart: (e: ReactDragEvent<HTMLElement>) => {
            e.dataTransfer.setData(VAULT_ITEM_MIME, item.id);
            e.dataTransfer.setData("text/plain", item.name);
            e.dataTransfer.effectAllowed = "move";
            setDragging(asDragged(item));
            // Picked up from inside a selection: the whole selection goes (what may be moved of it).
            const group = selected.has(item.id) && selected.size > 1 ? selectedItems.filter((i) => i.canModify) : null;
            setDraggingMany(group && group.length > 1 ? group : null);
          },
          onDragEnd: () => endDrag(),
        }
      : {};

  const banner = target
    ? draggingMany
      ? tn(draggingMany.length, "Drop to move {n} item to {folder}", "Drop to move {n} items to {folder}", { folder: target.name })
      : dragging
      ? t("Drop to move “{name}” to {folder}", { name: dragging.name, folder: target.name })
      : t("Drop to upload to {folder}", { folder: target.name })
    : fileDrag
      ? t("Drop to upload to {folder}", { folder: here.name })
      : null;

  // ── the item's menu ────────────────────────────────────────────────────────

  /** One list of actions for an item, drawn by both the ⋮ button and the right-click menu, so the
   *  two can never offer different things. */
  const menuEntries = (item: VaultItem): MenuEntry[] => {
    if (trash) {
      return [
        { kind: "item", key: "restore", label: t("Restore"), icon: RotateCcw, onSelect: () => restore.mutate(item.id) },
        { kind: "item", key: "purge", label: t("Delete permanently"), icon: Trash2, destructive: true, onSelect: () => setConfirming({ kind: "purge", item }) },
      ];
    }
    const out: MenuEntry[] = [{ kind: "item", key: "share", label: t("Share…"), icon: Share2, onSelect: () => setSharing(item) }];
    if (!browsing && item.path) out.push({ kind: "item", key: "show", label: t("Show in its folder"), icon: Folder, onSelect: () => setParentId(item.parentId) });
    if (item.kind === "FILE") {
      out.push({ kind: "item", key: "open", label: t("Open"), icon: Eye, onSelect: () => openItem(item) });
      out.push({ kind: "item", key: "download", label: t("Download"), icon: Download, href: item.downloadUrl ?? "#" });
      if (item.canModify) out.push({ kind: "item", key: "replace", label: t("Replace file…"), icon: RefreshCw, onSelect: () => setReplacing(item) });
    } else {
      out.push({ kind: "item", key: "zip", label: t("Download as zip"), icon: Download, onSelect: () => void downloadItems([item]) });
    }
    out.push({ kind: "separator", key: "sep" });
    out.push({ kind: "item", key: "rename", label: t("Rename"), icon: Pencil, disabled: !item.canModify, onSelect: () => { setRenaming(item); setRenameValue(item.name); } });
    out.push({ kind: "item", key: "move", label: t("Move to…"), icon: FolderInput, disabled: !item.canModify, onSelect: () => setMoving([item]) });
    if (data?.canManageAccess) out.push({ kind: "item", key: "access", label: t("Access…"), icon: ShieldCheck, onSelect: () => setAccessing(item) });
    out.push({ kind: "item", key: "trash", label: t("Move to trash"), icon: Trash2, destructive: true, disabled: !item.canModify, onSelect: () => remove.mutate({ id: item.id, purge: false }) });
    return out;
  };

  /** What the right-click menu offers on an item that is part of a selection of several. */
  const selectionEntries = (): MenuEntry[] => {
    const n = selectedItems.length;
    const movable = selectedItems.filter((i) => i.canModify);
    return [
      { kind: "item", key: "sel-move", label: tn(movable.length, "Move {n} item to…", "Move {n} items to…"), icon: FolderInput, disabled: !movable.length, onSelect: () => setMoving(movable) },
      { kind: "item", key: "sel-zip", label: tn(n, "Download {n} item as zip", "Download {n} items as zip"), icon: Download, onSelect: () => void downloadItems(selectedItems) },
      { kind: "separator", key: "sel-sep" },
      { kind: "item", key: "sel-clear", label: t("Clear selection"), icon: X, onSelect: clearSelection },
      { kind: "item", key: "sel-trash", label: tn(movable.length, "Move {n} item to trash", "Move {n} items to trash"), icon: Trash2, destructive: true, disabled: !movable.length, onSelect: () => setTrashing(movable) },
    ];
  };

  const dropdownEntries = (entries: MenuEntry[]) => entries.map((e) => {
    if (e.kind === "separator") return <DropdownMenuSeparator key={e.key} />;
    const Icon = e.icon;
    const body = <><Icon className="h-4 w-4 mr-2" /> {e.label}</>;
    return e.href ? (
      <DropdownMenuItem key={e.key} asChild disabled={e.disabled}><a href={e.href}>{body}</a></DropdownMenuItem>
    ) : (
      <DropdownMenuItem key={e.key} disabled={e.disabled} className={e.destructive ? "text-destructive" : undefined} onSelect={e.onSelect}>{body}</DropdownMenuItem>
    );
  });

  const contextEntries = (entries: MenuEntry[]) => entries.map((e) => {
    if (e.kind === "separator") return <ContextMenuSeparator key={e.key} />;
    const Icon = e.icon;
    const body = <><Icon className="h-4 w-4 mr-2" /> {e.label}</>;
    return e.href ? (
      <ContextMenuItem key={e.key} asChild disabled={e.disabled}><a href={e.href}>{body}</a></ContextMenuItem>
    ) : (
      <ContextMenuItem key={e.key} disabled={e.disabled} className={e.destructive ? "text-destructive" : undefined} onSelect={e.onSelect}>{body}</ContextMenuItem>
    );
  });

  /** Right-click (or long-press, or the menu key / Shift+F10 on a focused card) opens the same menu as
   *  ⋮, at the pointer — or, on an item inside a selection of several, the selection's menu. The
   *  trash's padlocked items have no menu, so they keep the browser's. */
  const withContextMenu = (item: VaultItem, node: ReactElement) => {
    if (trash && !item.canModify) return node;
    const forSelection = !trash && selected.size > 1 && selected.has(item.id);
    return (
      <ContextMenu key={item.id}>
        <ContextMenuTrigger asChild>{node}</ContextMenuTrigger>
        <ContextMenuContent lang={lang} className="min-w-[13rem]">
          {contextEntries(forSelection ? selectionEntries() : menuEntries(item))}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  /** The menu key and Shift+F10 open the right-click menu from the keyboard, where the browser does
   *  not already (Safari) — at the card itself rather than at the top-left corner of the window. */
  const menuKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return false;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: r.left + Math.min(32, r.width / 2), clientY: r.top + r.height / 2,
    }));
    return true;
  };

  /** The selection checkbox: on a card at its start, on a tile over the picture's corner. Shown while
   *  selecting, and on hover or keyboard focus otherwise. */
  const checkbox = (item: VaultItem, overlay = false) => {
    const on = selected.has(item.id);
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={t("Select {name}", { name: item.name })}
        onClick={(e) => { e.stopPropagation(); if (e.shiftKey) selectRange(item.id); else toggle(item.id); }}
        onMouseDown={noTextSelect}
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
          on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-card",
          !selecting && "opacity-0 group-hover:opacity-100",
          overlay && "absolute left-2 top-2 z-10 shadow-sm",
        )}
      >
        {on && <Check className="h-3.5 w-3.5" aria-hidden />}
      </button>
    );
  };

  const itemMenu = (item: VaultItem, tone: "card" | "tile" = "card") => trash && !item.canModify ? (
    // In the trash, restoring and deleting for good are both the uploader's or BoD's to do (the server
    // refuses everyone else): no menu that only offers what would be refused.
    <span
      className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground/60"
      title={t("Only whoever uploaded it, or BoD, can restore it")}
      aria-label={t("Only whoever uploaded it, or BoD, can restore it")}
      role="img"
    >
      <Lock className="h-3.5 w-3.5" aria-hidden />
    </span>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn("grid place-items-center rounded-md hover:bg-muted shrink-0", tone === "tile" ? "h-8 w-8" : "h-8 w-8")}
          aria-label={t("Actions for {name}", { name: item.name })}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" lang={lang}>
        {dropdownEntries(menuEntries(item))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /** A search result's folders, from the top: "Vault › LOGO › INTOO". */
  const pathText = (item: VaultItem) => [t("Vault"), ...(item.path ?? []).map((p) => p.name)].join(" › ");

  /** What a lock badge says on hover: who may open it, and for a folder who may add to it. */
  const lockTitle = (item: VaultItem) =>
    [
      item.minReadRole ? t("Opens for: {who}", { who: t(roleLabel(item.minReadRole)) }) : null,
      item.kind === "FOLDER" && item.minWriteRole ? t("adding: {who}", { who: t(roleLabel(item.minWriteRole)) }) : null,
    ].filter(Boolean).join(" · ");

  /** Share, on every card and tile — not only behind ⋮ (owner, 9 Oct 2026: nobody found it there). */
  const shareButton = (item: VaultItem, size: "card" | "tile" = "card") =>
    trash ? null : (
      <button
        type="button"
        onClick={() => setSharing(item)}
        className={cn(
          "grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "h-8 w-8",
        )}
        aria-label={t("Share {name}", { name: item.name })}
        title={t("Share")}
      >
        <Share2 className="h-4 w-4" />
      </button>
    );

  /** Enter on a focused card opens it, as a click does; Space does too, or selects it while selecting.
   *  The menu key or Shift+F10 opens its right-click menu. */
  const activate = (item: VaultItem) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (menuKey(e)) return;
    if (e.key === " " && selecting && !trash) { e.preventDefault(); toggle(item.id); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItem(item); }
  };

  // ── a folder or file as a card (a row) ─────────────────────────────────────

  const card = (item: VaultItem) => {
    const Icon = iconFor(item);
    const isFolder = item.kind === "FOLDER";
    const k = dropKey.folder(item.id);
    const lit = target?.key === k;
    const on = selected.has(item.id);
    return withContextMenu(item,
      <div
        key={item.id}
        data-vault-item=""
        {...dragProps(item)}
        {...(isFolder && !trash ? targetProps(k, { id: item.id, name: item.name }) : {})}
        className={cn(
          "group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors",
          lit ? "border-primary ring-2 ring-primary/40 bg-primary/5"
            : on ? "border-primary bg-primary/10 ring-1 ring-primary/40"
            : "border-border hover:border-primary/50",
          (dragging?.id === item.id || (draggingMany && on)) && "opacity-50",
        )}
      >
        {!trash && checkbox(item)}
        {/* A div, not a <button>: Firefox will not start a drag from inside a button. */}
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selecting && !trash ? on : undefined}
          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onItemClick(item)}
          onMouseDown={noTextSelect}
          onKeyDown={activate(item)}
        >
          <Icon className={cn("h-5 w-5 shrink-0", isFolder ? "text-primary" : "text-muted-foreground")} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {isFolder ? tn(item.childCount, "{n} item", "{n} items") : humanSize(item.size)}
              {item.shareCount > 0 && ` · ${tn(item.shareCount, "{n} link", "{n} links")}`}
              {item.minReadRole && ` · ${t(roleLabel(item.minReadRole))}`}
              {isFolder && item.minWriteRole && ` · ${t("adding: {who}", { who: t(roleLabel(item.minWriteRole)) })}`}
            </span>
            {item.path && !browsing && (
              <span className="block truncate text-[11px] text-muted-foreground/80" title={pathText(item)}>
                {t("in {path}", { path: pathText(item) })}
              </span>
            )}
          </span>
        </div>

        {(item.minReadRole || (isFolder && item.minWriteRole)) && (
          <span className="shrink-0 text-muted-foreground" role="img" aria-label={`${t("Locked")}: ${lockTitle(item)}`} title={lockTitle(item)}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        {shareButton(item)}
        {itemMenu(item)}
      </div>,
    );
  };

  // ── a picture or film as a gallery tile ────────────────────────────────────

  const tile = (item: VaultItem) => {
    const on = selected.has(item.id);
    return withContextMenu(item,
    <div
      key={item.id}
      data-vault-item=""
      {...dragProps(item)}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card overflow-hidden transition-colors",
        on ? "border-primary ring-2 ring-primary/50" : "border-border hover:border-primary/50",
        (dragging?.id === item.id || (draggingMany && on)) && "opacity-50",
      )}
    >
      {!trash && checkbox(item, true)}
      <div
        role="button"
        tabIndex={0}
        aria-label={t("Open {name}", { name: item.name })}
        aria-pressed={selecting && !trash ? on : undefined}
        className={cn(
          "relative aspect-square overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          selecting ? "cursor-pointer" : "cursor-zoom-in",
        )}
        style={fillsTile(item) ? undefined : CHECKERBOARD}
        onClick={onItemClick(item)}
        onMouseDown={noTextSelect}
        onKeyDown={activate(item)}
      >
        <VaultTilePicture item={item} />
        {on && <span className="pointer-events-none absolute inset-0 bg-primary/15" aria-hidden />}
      </div>
      <div className="flex items-center gap-1 pl-2.5 pr-1 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={item.name}>{item.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {humanSize(item.size)}
            {item.shareCount > 0 && ` · ${tn(item.shareCount, "{n} link", "{n} links")}`}
          </p>
          {item.path && !browsing && (
            <p className="truncate text-[11px] text-muted-foreground/80" title={pathText(item)}>{t("in {path}", { path: pathText(item) })}</p>
          )}
        </div>
        {item.minReadRole && (
          <span className="shrink-0 text-muted-foreground" role="img" aria-label={`${t("Locked")}: ${lockTitle(item)}`} title={lockTitle(item)}>
            <Lock className="h-3 w-3" aria-hidden />
          </span>
        )}
        {shareButton(item, "tile")}
        {itemMenu(item, "tile")}
      </div>
    </div>,
    );
  };

  const sectionLabel = (text: string) => (
    <h2 className="mb-2 mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{text}</h2>
  );
  const sections = [folders.length > 0, media.length > 0, others.length > 0].filter(Boolean).length;

  return (
    <div lang={lang} className="relative flex flex-col h-full" {...pageDrop}>
      <PageHeader
        title={t("Z Vault")}
        subtitle={t("The whole office's shared shelf — logos, decks, assets.")}
        icon={<HardDrive className="h-6 w-6" />}
        actions={
          <>
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Search files…")}
                aria-label={t("Search files…")}
                className="pl-8 w-48"
              />
            </div>
            {!trash && items.length > 0 && (
              // Touch has no Cmd or Ctrl to hold: this is how a phone selects several.
              <Button
                variant={selecting ? "default" : "outline"}
                size="sm"
                aria-pressed={selecting}
                onClick={() => (selecting ? clearSelection() : setSelectMode(true))}
              >
                <ListChecks className="h-4 w-4 mr-1.5" />
                {selecting ? t("Done") : t("Select")}
              </Button>
            )}
            <Button variant={trash ? "default" : "outline"} size="sm" onClick={() => setTrash(!trash)}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              {t("Trash")}
            </Button>
            {!trash && data?.canWrite && (
              <>
                <Button variant="outline" size="sm" onClick={() => setNewFolder("")}>
                  <FolderPlus className="h-4 w-4 mr-1.5" />
                  {t("Folder")}
                </Button>
                <Button size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload className="h-4 w-4 mr-1.5" />
                  {t("Upload")}
                </Button>
              </>
            )}
          </>
        }
      />

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { uploadFiles(Array.from(e.target.files ?? []), here); e.target.value = ""; }}
      />
      <input
        ref={replaceInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replacing;
          e.target.value = "";
          setReplacing(null);
          if (file && target) replaceFile(target, file, here.name);
        }}
      />

      <div
        className={cn(
          "px-4 md:px-8 py-4 flex-1 overflow-y-auto transition-shadow",
          fileDrag && !target && "ring-2 ring-inset ring-primary/60 bg-primary/[0.03]",
          selected.size > 0 && "pb-24",
        )}
        onClick={(e) => {
          // A click on empty space lets go of the selection (not in Select mode, where a phone's
          // stray tap between cards would otherwise end it).
          if (selected.size > 0 && !selectMode && !(e.target as HTMLElement).closest("[data-vault-item]")) clearSelection();
        }}
      >
        {/* Search on a phone: the header's field is hidden below sm, so it lives here. */}
        <div className="relative mb-3 sm:hidden">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search files…")}
            aria-label={t("Search files…")}
            className="pl-8 w-full"
          />
        </div>

        {/* quota */}
        {data && (
          <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-1.5 w-40 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full", quotaPct > 90 ? "bg-destructive" : "bg-primary")}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
            <span>
              {t("{used} of {total} used", { used: humanSize(data.quota.usedBytes), total: humanSize(data.quota.totalBytes) })}
            </span>
          </div>
        )}

        {/* breadcrumb — every crumb is also a drop target: "Vault" is the top level */}
        {browsing && (
          <nav aria-label={t("Folder path")} className="mb-3 flex items-center gap-1 text-sm flex-wrap">
            <button
              className={cn(
                "rounded px-1.5 py-0.5 hover:underline text-muted-foreground",
                target?.key === dropKey.crumb(null) && "bg-primary/10 text-primary ring-2 ring-primary/40 no-underline",
              )}
              onClick={() => setParentId(null)}
              {...targetProps(dropKey.crumb(null), { id: null, name: t("Vault") })}
            >
              {t("Vault")}
            </button>
            {crumbs.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <button
                  className={cn(
                    "rounded px-1.5 py-0.5 hover:underline",
                    target?.key === dropKey.crumb(b.id) && "bg-primary/10 text-primary ring-2 ring-primary/40 no-underline",
                  )}
                  onClick={() => setParentId(b.id)}
                  {...targetProps(dropKey.crumb(b.id), { id: b.id, name: b.name })}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {trash && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("Files in the trash still count against the quota. Emptying it frees the space; for 90 days an admin can still bring them back from Control Room → Audit.")}
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={emptyTrash.isPending || !(data?.items.length)}
              onClick={() => setConfirming({ kind: "empty" })}
            >
              {emptyTrash.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Empty")}
            </Button>
          </div>
        )}

        {listing.isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : listing.isError && !data ? (
          // A failed load is not an empty folder (it used to say "This folder is empty.").
          <div role="alert" className="flex flex-col items-center justify-center py-20 text-center">
            <HardDrive className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">
              {(listing.error as ApiError)?.status === 404 ? t("This folder doesn't exist any more.") : t("Couldn't load the vault.")}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {(listing.error as ApiError)?.status === 403 ? t("It's locked to certain roles.") : t("Check your connection and try again.")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void listing.refetch()}>{t("Try again")}</Button>
              {(parentId || trash) && <Button variant="ghost" size="sm" onClick={() => setParentId(null)}>{t("Go to the top of the vault")}</Button>}
            </div>
          </div>
        ) : !items.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <HardDrive className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {trash ? t("The trash is empty.") : search ? t("Nothing matches.") : t("This folder is empty.")}
            </p>
            {canDropFiles && (
              <p className="mt-1 text-xs text-muted-foreground">{t("Drop files here, or use Upload.")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {folders.length > 0 && (
              <section>
                {sections > 1 && sectionLabel(t("Folders"))}
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{folders.map(card)}</div>
              </section>
            )}
            {media.length > 0 && (
              <section>
                {sections > 1 && sectionLabel(t("Photos and videos"))}
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{media.map(tile)}</div>
              </section>
            )}
            {others.length > 0 && (
              <section>
                {sections > 1 && sectionLabel(t("Files"))}
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{others.map(card)}</div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* The selection's actions. On a phone at the top, clear of the tab bar, GIDEON and the upload
          pill; from md up at the bottom of the window. */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4 md:top-auto md:bottom-6">
          <div
            role="toolbar"
            aria-label={t("Selected items")}
            lang={lang}
            className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-border bg-card px-1.5 py-1.5 shadow-pop"
          >
            <span className="whitespace-nowrap px-2.5 text-sm font-semibold tabular-nums" aria-live="polite">
              {t("{n} selected", { n: selected.size })}
            </span>
            <Button
              variant="ghost" size="sm"
              disabled={!selectedItems.some((i) => i.canModify)}
              onClick={() => setMoving(selectedItems.filter((i) => i.canModify))}
              title={t("Move to…")}
            >
              <FolderInput className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{t("Move to…")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void downloadItems(selectedItems)} title={t("Download")}>
              <Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{t("Download")}</span>
            </Button>
            {selectedItems.length === 1 && (
              <Button variant="ghost" size="sm" onClick={() => setSharing(selectedItems[0])} title={t("Share")}>
                <Share2 className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{t("Share")}</span>
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              className="text-destructive hover:text-destructive"
              disabled={!selectedItems.some((i) => i.canModify)}
              onClick={() => setTrashing(selectedItems.filter((i) => i.canModify))}
              title={t("Move to trash")}
            >
              <Trash2 className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{t("Move to trash")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} aria-label={t("Clear selection")} title={t("Clear selection")}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {/* Where a zip download is posted, so the page itself never navigates. */}
      <iframe ref={zipFrame} name="vault-zip-download" title="" aria-hidden className="hidden" />

      {/* What a drop would do, where. Never in the way of the drop itself. */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg max-w-full">
            {dragging ? <FolderInput className="h-4 w-4 shrink-0" /> : <Upload className="h-4 w-4 shrink-0" />}
            <span className="truncate">{banner}</span>
          </div>
        </div>
      )}

      <VaultLightbox
        items={viewer?.items ?? []}
        index={viewer?.index ?? null}
        onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))}
        onClose={() => setViewer(null)}
        onShare={(i) => { setViewer(null); setSharing(i); }}
      />
      <VaultAccessDialog
        item={accessing}
        onClose={() => setAccessing(null)}
        onSaved={() => { setAccessing(null); refresh(); }}
      />
      <VaultMoveDialog
        items={moving}
        onClose={() => setMoving(null)}
        onMoved={(result, destination) => {
          setMoving(null);
          if (result.ok.length === 1 && !result.failed.length) {
            toast.success(t("“{name}” moved to {folder}", { name: result.ok[0].result.name, folder: destination }));
            refresh();
          } else {
            reportBulk(
              result,
              (n) => tn(n, "{n} item moved to {folder}", "{n} items moved to {folder}", { folder: destination }),
              (done, total) => t("{done} of {total} moved", { done, total }),
            );
          }
          if (result.ok.length) clearSelection();
        }}
      />
      <PreviewDialog item={preview} onClose={() => setPreview(null)} onShare={(i) => { setPreview(null); setSharing(i); }} />
      <VaultShareDialog item={sharing} onClose={() => setSharing(null)} />

      <Dialog open={newFolder !== null} onOpenChange={(o) => !o && setNewFolder(null)}>
        <DialogContent lang={lang} className="max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = (newFolder ?? "").trim();
              if (!name) return;
              createFolder.mutate(name);
              setNewFolder(null);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("New folder")}</DialogTitle>
              <DialogDescription>{t("In {folder}", { folder: here.name })}</DialogDescription>
            </DialogHeader>
            <Input value={newFolder ?? ""} onChange={(e) => setNewFolder(e.target.value)} autoFocus aria-label={t("Folder name")} placeholder={t("Folder name")} maxLength={180} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolder(null)}>{t("Cancel")}</Button>
              <Button type="submit" disabled={!(newFolder ?? "").trim() || createFolder.isPending}>{t("Create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent lang={lang}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.kind === "purge" ? t("Delete “{name}” permanently?", { name: confirming.item.name }) : t("Empty the trash?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.kind === "purge"
                ? t("It leaves the Vault and its links stop working. An admin can still bring it back from Control Room → Audit for 90 days.")
                : t("The files leave the Vault; an admin can still bring them back from Audit for 90 days.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirming?.kind === "purge") remove.mutate({ id: confirming.item.id, purge: true });
                else if (confirming?.kind === "empty") emptyTrash.mutate();
                setConfirming(null);
              }}
            >
              {confirming?.kind === "purge" ? t("Delete permanently") : t("Empty")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!trashing} onOpenChange={(o) => !o && setTrashing(null)}>
        <AlertDialogContent lang={lang}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {trashing && trashing.length === 1
                ? t("Move “{name}” to the trash?", { name: trashing[0].name })
                : tn(trashing?.length ?? 0, "Move {n} item to the trash?", "Move {n} items to the trash?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Its links stop working. Whoever uploaded it, or BoD, can restore it from the trash.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const list = trashing ?? [];
                setTrashing(null);
                clearSelection();
                void trashMany(list);
              }}
            >
              {t("Move to trash")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!replacing} onOpenChange={(o) => !o && setReplacing(null)}>
        <DialogContent lang={lang} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{t("Replace “{name}”", { name: replacing?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("Pick the new version. It keeps this file's place and links — everyone with a link sees the new version from now on.")}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("If the new file is another type, the name keeps its first part and takes the new extension. The previous version can be brought back from Control Room → Audit for 90 days.")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(null)}>{t("Cancel")}</Button>
            <Button onClick={() => replaceInput.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" /> {t("Choose file…")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent lang={lang}>
          <DialogHeader><DialogTitle>{t("Rename")}</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus aria-label={t("Name")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>{t("Cancel")}</Button>
            <Button
              disabled={!renameValue.trim() || rename.isPending}
              onClick={() => renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── preview (PDFs, sound, everything that is not a picture or a film) ────────

function PreviewDialog({ item, onClose, onShare }: { item: VaultItem | null; onClose: () => void; onShare: (i: VaultItem) => void }) {
  const { t, lang } = useLang();
  const mime = item?.mimeType || "";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent lang={lang} className="max-w-3xl">
        <DialogHeader><DialogTitle className="truncate pr-8">{item?.name}</DialogTitle></DialogHeader>
        {item && (
          <div className="max-h-[65vh] overflow-auto rounded-lg bg-muted/40">
            {mime.startsWith("image/") ? (
              <img src={item.url ?? ""} alt={item.name} className="w-full h-auto" />
            ) : mime.startsWith("video/") ? (
              // controls + the origin's Range support is what makes this scrub instead of stall.
              <video src={item.url ?? ""} controls className="w-full" />
            ) : mime.startsWith("audio/") ? (
              <audio src={item.url ?? ""} controls className="w-full p-4" />
            ) : isPdf(item) ? (
              <iframe src={item.url ?? ""} title={item.name} className="w-full h-[65vh]" />
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {t("This kind of file can't be previewed. Download it to open it.")}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground self-center">
            {humanSize(item?.size)}{item?.uploader ? ` · ${t("uploaded by {name}", { name: item.uploader.name })}` : ""}
          </span>
          <div className="flex flex-wrap gap-2 justify-end">
            {item && isPdf(item) && item.url && (
              // An iframe shows only the first page on iPhone Safari: this opens the PDF itself.
              <Button variant="outline" asChild>
                <a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" /> {t("Open PDF")}</a>
              </Button>
            )}
            <Button variant="outline" onClick={() => item && onShare(item)}>
              <Share2 className="h-4 w-4 mr-1.5" /> {t("Share")}
            </Button>
            <Button asChild>
              <a href={item?.downloadUrl ?? "#"}><Download className="h-4 w-4 mr-1.5" /> {t("Download")}</a>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
