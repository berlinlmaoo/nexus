import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, Download, ExternalLink, Eye, File as FileIcon, FileText, Film,
  FolderInput, FolderPlus, Folder, HardDrive, Image as ImageIcon, Loader2, Lock, Music,
  MoreVertical, Pencil, RotateCcw, Search, Share2, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

export const Route = createFileRoute("/_app/vault")({ component: VaultPage });

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
// ─────────────────────────────────────────────────────────────────────────────

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

  const [parentId, setParentId] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<VaultItem | null>(null);
  const [sharing, setSharing] = useState<VaultItem | null>(null);
  const [renaming, setRenaming] = useState<VaultItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moving, setMoving] = useState<VaultItem | null>(null);
  const [accessing, setAccessing] = useState<VaultItem | null>(null);
  const [viewer, setViewer] = useState<{ items: VaultItem[]; index: number } | null>(null);
  const [uploads, setUploads] = useState<{ key: number; name: string; pct: number }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Drag and drop. `dragging`: the vault item being dragged (null for files from the desktop).
  // `fileDrag`: files from the desktop are over the page. `target`: the drop target lit up (dropKey).
  const [dragging, setDragging] = useState<DraggedVaultItem | null>(null);
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

  // Uploads run one at a time on purpose, whichever way they arrived (the button or a drop): the
  // server caps concurrent chunk sessions per user, and a browser that fires ten at once would spend
  // the first seconds collecting 429s instead of bytes. A drop during an upload waits its turn.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextKey = useRef(0);
  const uploadFiles = useCallback((files: File[], to: Destination) => {
    if (!files.length) return;
    const run = async () => {
      let done = 0;
      for (const file of files) {
        const k = ++nextKey.current;
        setUploads((u) => [...u, { key: k, name: file.name, pct: 0 }]);
        try {
          await nexusApi.vaultUpload(file, to.id, (pct) =>
            setUploads((u) => u.map((x) => (x.key === k ? { ...x, pct } : x))),
          );
          done++;
        } catch (e) {
          const msg = e instanceof ApiError || e instanceof Error ? e.message : t("Upload failed");
          toast.error(t("Couldn't upload {name}", { name: file.name }), { description: msg });
        } finally {
          setUploads((u) => u.filter((x) => x.key !== k));
        }
      }
      if (done === 1 && files.length === 1) toast.success(t("{name} uploaded to {folder}", { name: files[0].name, folder: to.name }));
      else if (done > 0) toast.success(tn(done, "{n} file uploaded to {folder}", "{n} files uploaded to {folder}", { folder: to.name }));
      refresh();
    };
    queue.current = queue.current.then(run, run);
  }, [refresh, t, tn]);

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

  const openItem = (item: VaultItem) => {
    if (trash) return;
    if (item.kind === "FOLDER") { setParentId(item.id); setSearch(""); return; }
    const at = media.findIndex((m) => m.id === item.id);
    if (at >= 0) setViewer({ items: media, index: at });
    else setPreview(item);
  };

  // ── drag and drop ──────────────────────────────────────────────────────────

  const endDrag = useCallback(() => {
    dragDepth.current = 0;
    setFileDrag(false);
    setTarget(null);
    setDragging(null);
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
      const dropped = action === "upload" ? filesOfDrop(e.dataTransfer) : null;
      endDrag();
      if (action === "move" && moved) move.mutate({ id: moved.id, to });
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
            setDragging({ id: item.id, kind: item.kind, parentId: item.parentId, name: item.name });
          },
          onDragEnd: () => endDrag(),
        }
      : {};

  const banner = target
    ? dragging
      ? t("Drop to move “{name}” to {folder}", { name: dragging.name, folder: target.name })
      : t("Drop to upload to {folder}", { folder: target.name })
    : fileDrag
      ? t("Drop to upload to {folder}", { folder: here.name })
      : null;

  // ── the item's menu ────────────────────────────────────────────────────────

  const itemMenu = (item: VaultItem, tone: "card" | "tile" = "card") => (
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
        {trash ? (
          <>
            <DropdownMenuItem onClick={() => restore.mutate(item.id)}>
              <RotateCcw className="h-4 w-4 mr-2" /> {t("Restore")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              disabled={!item.canModify}
              onClick={() => {
                if (window.confirm(t("Delete “{name}” permanently?", { name: item.name }))) remove.mutate({ id: item.id, purge: true });
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> {t("Delete permanently")}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={() => setSharing(item)}>
              <Share2 className="h-4 w-4 mr-2" /> {t("Share…")}
            </DropdownMenuItem>
            {item.kind === "FILE" && (
              <>
                <DropdownMenuItem onClick={() => openItem(item)}>
                  <Eye className="h-4 w-4 mr-2" /> {t("Open")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={item.downloadUrl ?? "#"}>
                    <Download className="h-4 w-4 mr-2" /> {t("Download")}
                  </a>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!item.canModify}
              onClick={() => { setRenaming(item); setRenameValue(item.name); }}
            >
              <Pencil className="h-4 w-4 mr-2" /> {t("Rename")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!item.canModify} onClick={() => setMoving(item)}>
              <FolderInput className="h-4 w-4 mr-2" /> {t("Move to…")}
            </DropdownMenuItem>
            {data?.canManageAccess && (
              <DropdownMenuItem onClick={() => setAccessing(item)}>
                <ShieldCheck className="h-4 w-4 mr-2" /> {t("Access…")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              disabled={!item.canModify}
              onClick={() => remove.mutate({ id: item.id, purge: false })}
            >
              <Trash2 className="h-4 w-4 mr-2" /> {t("Move to trash")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

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

  /** Enter or Space on a focused card opens it, as a click does. */
  const activate = (item: VaultItem) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItem(item); }
  };

  // ── a folder or file as a card (a row) ─────────────────────────────────────

  const card = (item: VaultItem) => {
    const Icon = iconFor(item);
    const isFolder = item.kind === "FOLDER";
    const k = dropKey.folder(item.id);
    const lit = target?.key === k;
    return (
      <div
        key={item.id}
        {...dragProps(item)}
        {...(isFolder && !trash ? targetProps(k, { id: item.id, name: item.name }) : {})}
        className={cn(
          "group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors",
          lit ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "border-border hover:border-primary/50",
          dragging?.id === item.id && "opacity-50",
        )}
      >
        {/* A div, not a <button>: Firefox will not start a drag from inside a button. */}
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => openItem(item)}
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
          </span>
        </div>

        {(item.minReadRole || (isFolder && item.minWriteRole)) && (
          <span className="shrink-0 text-muted-foreground" role="img" aria-label={`${t("Locked")}: ${lockTitle(item)}`} title={lockTitle(item)}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        {shareButton(item)}
        {itemMenu(item)}
      </div>
    );
  };

  // ── a picture or film as a gallery tile ────────────────────────────────────

  const tile = (item: VaultItem) => (
    <div
      key={item.id}
      {...dragProps(item)}
      className={cn(
        "group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors",
        dragging?.id === item.id && "opacity-50",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={t("Open {name}", { name: item.name })}
        className="relative aspect-square overflow-hidden cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={fillsTile(item) ? undefined : CHECKERBOARD}
        onClick={() => openItem(item)}
        onKeyDown={activate(item)}
      >
        <VaultTilePicture item={item} />
      </div>
      <div className="flex items-center gap-1 pl-2.5 pr-1 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={item.name}>{item.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {humanSize(item.size)}
            {item.shareCount > 0 && ` · ${tn(item.shareCount, "{n} link", "{n} links")}`}
          </p>
        </div>
        {item.minReadRole && (
          <span className="shrink-0 text-muted-foreground" role="img" aria-label={`${t("Locked")}: ${lockTitle(item)}`} title={lockTitle(item)}>
            <Lock className="h-3 w-3" aria-hidden />
          </span>
        )}
        {shareButton(item, "tile")}
        {itemMenu(item, "tile")}
      </div>
    </div>
  );

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
            <Button variant={trash ? "default" : "outline"} size="sm" onClick={() => setTrash((v) => !v)}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              {t("Trash")}
            </Button>
            {!trash && data?.canWrite && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const name = window.prompt(t("Folder name"));
                    if (name?.trim()) createFolder.mutate(name.trim());
                  }}
                >
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

      <div
        className={cn(
          "px-4 md:px-8 py-4 flex-1 overflow-y-auto transition-shadow",
          fileDrag && !target && "ring-2 ring-inset ring-primary/60 bg-primary/[0.03]",
        )}
      >
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
              onClick={() => {
                if (window.confirm(t("Empty the trash? The files leave the Vault; an admin can still bring them back from Audit for 90 days."))) emptyTrash.mutate();
              }}
            >
              {emptyTrash.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Empty")}
            </Button>
          </div>
        )}

        {/* in-flight uploads */}
        {uploads.map((u) => (
          <div key={u.key} className="mb-2 flex items-center gap-3 rounded-lg border border-border px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm truncate flex-1">{u.name}</span>
            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${u.pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{u.pct}%</span>
          </div>
        ))}

        {listing.isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
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
        item={moving}
        onClose={() => setMoving(null)}
        onMoved={(moved, destination) => {
          setMoving(null);
          toast.success(t("“{name}” moved to {folder}", { name: moved.name, folder: destination }));
          refresh();
        }}
      />
      <PreviewDialog item={preview} onClose={() => setPreview(null)} onShare={(i) => { setPreview(null); setSharing(i); }} />
      <VaultShareDialog item={sharing} onClose={() => setSharing(null)} />

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
