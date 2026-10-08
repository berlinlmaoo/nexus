import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, Copy, Download, ExternalLink, Eye, File as FileIcon, FileText, Film,
  FolderInput, FolderPlus, Folder, HardDrive, Image as ImageIcon, Link2, Loader2, Lock, Music,
  MoreVertical, Pencil, Play, RotateCcw, Search, Share2, Trash2, Upload, Users,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { VaultLightbox } from "@/components/vault/VaultLightbox";
import { VaultMoveDialog } from "@/components/vault/VaultMoveDialog";
import { cn } from "@/lib/utils";
import { useDocumentLang, useLang } from "@/lib/lang";
import { ApiError, nexusApi, type VaultItem, type VaultShare, type VaultShareExpiry } from "@/lib/nexus-api";
import { fillsTile, formatDuration, mediaKind, thumbSrc } from "@/lib/vault-media";
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

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function iconFor(item: VaultItem) {
  if (item.kind === "FOLDER") return Folder;
  const m = item.mimeType || "";
  if (m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Film;
  if (m.startsWith("audio/")) return Music;
  if (m === "application/pdf" || m.startsWith("text/")) return FileText;
  return FileIcon;
}

const EXPIRY_OPTIONS: { value: VaultShareExpiry; label: string }[] = [
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "2 weeks" },
  { value: "30d", label: "1 month" },
  { value: "permanent", label: "Permanent" },
];

/** Where something can be dropped or moved to: a folder (null = the top of the vault) and its name. */
type Destination = { id: string | null; name: string };

/** A light checkerboard behind pictures shown whole, so a white logo on a transparent PNG shows. */
const CHECKERBOARD = {
  backgroundImage: "repeating-conic-gradient(color-mix(in srgb, var(--muted-foreground) 13%, transparent) 0 25%, transparent 0 50%)",
  backgroundSize: "16px 16px",
};

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
            {item.kind === "FILE" && (
              <>
                <DropdownMenuItem onClick={() => openItem(item)}>
                  <Eye className="h-4 w-4 mr-2" /> {t("View")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={item.downloadUrl ?? "#"}>
                    <Download className="h-4 w-4 mr-2" /> {t("Download")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSharing(item)}>
                  <Share2 className="h-4 w-4 mr-2" /> {t("Share")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              disabled={!item.canModify}
              onClick={() => { setRenaming(item); setRenameValue(item.name); }}
            >
              <Pencil className="h-4 w-4 mr-2" /> {t("Rename")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!item.canModify} onClick={() => setMoving(item)}>
              <FolderInput className="h-4 w-4 mr-2" /> {t("Move to…")}
            </DropdownMenuItem>
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
              {item.minReadRole && ` · ${t("restricted")}`}
            </span>
          </span>
        </div>

        {item.minReadRole && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label={t("restricted")} />}
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
        <TilePicture item={item} />
      </div>
      <div className="flex items-center gap-1 pl-2.5 pr-1 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={item.name}>{item.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {humanSize(item.size)}
            {item.shareCount > 0 && ` · ${tn(item.shareCount, "{n} link", "{n} links")}`}
          </p>
        </div>
        {item.minReadRole && <Lock className="h-3 w-3 text-muted-foreground shrink-0" aria-label={t("restricted")} />}
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
      <ShareDialog item={sharing} onClose={() => setSharing(null)} />

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

// ── a gallery tile's picture ─────────────────────────────────────────────────

/**
 * The server's thumbnail for a picture. For a film, its first frame (`preload="metadata"`, only once
 * the tile is near the screen, so a folder of films does not start forty downloads) and its length.
 * Whatever cannot be drawn keeps its type icon.
 */
function TilePicture({ item }: { item: VaultItem }) {
  const kind = mediaKind(item);
  const src = kind === "image" ? thumbSrc(item, 320) : null;
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const Icon = kind === "video" ? Film : ImageIcon;

  useEffect(() => {
    if (kind !== "video" || near) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [kind, near]);

  return (
    <div ref={box} className="absolute inset-0 grid place-items-center">
      {kind === "image" && src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn("h-full w-full", fillsTile(item) ? "object-cover" : "object-contain p-3")}
        />
      ) : kind === "video" && near && item.url && !failed ? (
        <video
          src={`${item.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover pointer-events-none bg-muted"
        />
      ) : (
        <Icon className="h-8 w-8 text-muted-foreground/60" aria-hidden />
      )}
      {kind === "video" && (
        <>
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <span className="h-10 w-10 grid place-items-center rounded-full bg-black/55 text-white">
              <Play className="h-4 w-4 translate-x-px fill-current" />
            </span>
          </span>
          {formatDuration(duration) && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
              {formatDuration(duration)}
            </span>
          )}
        </>
      )}
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
            ) : mime === "application/pdf" ? (
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
          <div className="flex gap-2">
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

// ── sharing ──────────────────────────────────────────────────────────────────

function ShareDialog({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { t, lang } = useLang();
  const [requireAuth, setRequireAuth] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [expires, setExpires] = useState<VaultShareExpiry>("permanent");

  const shares = useQuery({
    queryKey: ["vault-shares", item?.id],
    queryFn: () => nexusApi.vaultShares(item!.id),
    enabled: !!item,
  });

  const create = useMutation({
    mutationFn: () => nexusApi.vaultCreateShare({ itemId: item!.id, requireAuth, allowDownload, expires }),
    onSuccess: async (s) => {
      await navigator.clipboard.writeText(s.url).catch(() => {});
      toast.success(t("Link created & copied"));
      void qc.invalidateQueries({ queryKey: ["vault-shares", item?.id] });
      void qc.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (e: Error) => toast.error(t("Couldn't create the link"), { description: e.message }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.vaultRevokeShare(id),
    onSuccess: () => {
      toast.success(t("Link revoked, effective now"));
      void qc.invalidateQueries({ queryKey: ["vault-shares", item?.id] });
    },
    onError: (e: Error) => toast.error(t("Couldn't revoke the link"), { description: e.message }),
  });

  const statusLabel = (s: VaultShare) =>
    s.status === "active" ? (s.requireAuth ? t("internal") : t("external")) : s.status === "expired" ? t("expired") : t("revoked");

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent lang={lang} className="max-w-lg">
        <DialogHeader><DialogTitle className="truncate pr-8">{t("Share “{name}”", { name: item?.name ?? "" })}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
            <Switch checked={requireAuth} onCheckedChange={setRequireAuth} />
            <span className="text-sm">
              <span className="font-medium flex items-center gap-1.5">
                {requireAuth ? <Users className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {requireAuth ? t("Internal") : t("External")}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {requireAuth
                  ? t("Requires a NEXUS login. On iPhone and Mac the link opens the app straight to this file.")
                  : t("Anyone with the link can open it, no account needed. It stays in the browser on purpose and never opens the app.")}
              </span>
            </span>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer">
            <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
            <span className="text-sm font-medium">{t("Allow download")}</span>
          </label>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t("Expiry")}</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_OPTIONS.map((e) => (
                <button
                  key={e.value}
                  onClick={() => setExpires(e.value)}
                  aria-pressed={expires === e.value}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    expires === e.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                  )}
                >
                  {t(e.label)}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Link2 className="h-4 w-4 mr-1.5" /> {t("Create link")}</>}
          </Button>
        </div>

        {!!shares.data?.shares.length && (
          <div className="mt-2 border-t border-border pt-3 space-y-2 max-h-48 overflow-y-auto">
            {shares.data.shares.map((s: VaultShare) => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded shrink-0",
                    s.status === "active" ? "bg-emerald-500/15 text-emerald-600" :
                    s.status === "expired" ? "bg-amber-500/15 text-amber-600" : "bg-muted text-muted-foreground",
                  )}
                >
                  {statusLabel(s)}
                </span>
                <span className="truncate flex-1 text-muted-foreground">{s.url}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{s.viewCount}×</span>
                <button
                  className="p-1 hover:bg-muted rounded"
                  title={t("Copy")}
                  aria-label={t("Copy")}
                  onClick={() => { void navigator.clipboard.writeText(s.url); toast.success(t("Copied")); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {s.status === "active" && (
                  <button className="p-1 hover:bg-muted rounded text-destructive" title={t("Revoke")} aria-label={t("Revoke")} onClick={() => revoke.mutate(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
