import { useCallback, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, Copy, Download, ExternalLink, Eye, File as FileIcon, FileText, Film,
  FolderPlus, Folder, HardDrive, Image as ImageIcon, Link2, Loader2, Lock, Music,
  MoreVertical, Pencil, RotateCcw, Search, Share2, Trash2, Upload, Users,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ApiError, nexusApi, type VaultItem, type VaultShare, type VaultShareExpiry } from "@/lib/nexus-api";

export const Route = createFileRoute("/_app/vault")({ component: VaultPage });

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

const EXPIRY_LABELS: { value: VaultShareExpiry; label: string }[] = [
  { value: "3d", label: "3 hari" },
  { value: "7d", label: "7 hari" },
  { value: "14d", label: "2 minggu" },
  { value: "30d", label: "1 bulan" },
  { value: "permanent", label: "Permanen" },
];

// ── page ─────────────────────────────────────────────────────────────────────

function VaultPage() {
  const qc = useQueryClient();
  const [parentId, setParentId] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<VaultItem | null>(null);
  const [sharing, setSharing] = useState<VaultItem | null>(null);
  const [renaming, setRenaming] = useState<VaultItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const key = useMemo(
    () => ["vault", trash ? "trash" : "browse", trash ? "" : parentId ?? "root", search] as const,
    [parentId, trash, search],
  );
  const listing = useQuery({
    queryKey: key,
    queryFn: () => nexusApi.vaultList({ parentId, trash, q: search || undefined }),
  });

  const refresh = useCallback(() => { void qc.invalidateQueries({ queryKey: ["vault"] }); }, [qc]);

  const createFolder = useMutation({
    mutationFn: (name: string) => nexusApi.vaultCreateFolder(name, parentId),
    onSuccess: (item) => { toast.success(`Folder "${item.name}" dibuat`); refresh(); },
    onError: (e: Error) => toast.error("Gagal membuat folder", { description: e.message }),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => nexusApi.vaultUpdateItem(id, { name }),
    onSuccess: () => { toast.success("Nama diubah"); setRenaming(null); refresh(); },
    onError: (e: Error) => toast.error("Gagal mengubah nama", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) => nexusApi.vaultDeleteItem(id, purge),
    onSuccess: (_r, args) => { toast.success(args.purge ? "Dihapus permanen" : "Dipindah ke sampah"); refresh(); },
    onError: (e: Error) => toast.error("Gagal menghapus", { description: e.message }),
  });

  const restore = useMutation({
    mutationFn: (id: string) => nexusApi.vaultUpdateItem(id, { restore: true }),
    onSuccess: () => { toast.success("Dikembalikan"); refresh(); },
    onError: (e: Error) => toast.error("Gagal mengembalikan", { description: e.message }),
  });

  const emptyTrash = useMutation({
    mutationFn: () => nexusApi.vaultEmptyTrash(),
    onSuccess: (r) => { toast.success(`Sampah dikosongkan — ${r.purged} item`); refresh(); },
    onError: (e: Error) => toast.error("Gagal mengosongkan sampah", { description: e.message }),
  });

  // Uploads run one at a time on purpose: the server caps concurrent chunk sessions per user, and a
  // browser that fires ten at once would spend the first seconds collecting 429s instead of bytes.
  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    for (const file of list) {
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        await nexusApi.vaultUpload(file, parentId, (pct) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))),
        );
        toast.success(`${file.name} terunggah`);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Upload gagal";
        toast.error(`Gagal: ${file.name}`, { description: msg });
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
    refresh();
  }, [parentId, refresh]);

  const data = listing.data;
  const quotaPct = data ? Math.min(100, Math.round((data.quota.usedBytes / data.quota.totalBytes) * 100)) : 0;

  const openItem = (item: VaultItem) => {
    if (trash) return;
    if (item.kind === "FOLDER") { setParentId(item.id); setSearch(""); }
    else setPreview(item);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Z Vault"
        subtitle="Rak berkas bersama satu kantor — logo, deck, aset."
        icon={<HardDrive className="h-6 w-6" />}
        actions={
          <>
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari berkas…"
                className="pl-8 w-48"
              />
            </div>
            <Button variant={trash ? "default" : "outline"} size="sm" onClick={() => setTrash((t) => !t)}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Sampah
            </Button>
            {!trash && data?.canWrite && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const name = window.prompt("Nama folder");
                    if (name?.trim()) createFolder.mutate(name.trim());
                  }}
                >
                  <FolderPlus className="h-4 w-4 mr-1.5" />
                  Folder
                </Button>
                <Button size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload className="h-4 w-4 mr-1.5" />
                  Unggah
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
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }}
      />

      <div className="px-4 md:px-8 py-4 flex-1 overflow-y-auto">
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
              {humanSize(data.quota.usedBytes)} dari {humanSize(data.quota.totalBytes)} terpakai
            </span>
          </div>
        )}

        {/* breadcrumb */}
        {!trash && !search && (
          <div className="mb-3 flex items-center gap-1 text-sm flex-wrap">
            <button className="hover:underline text-muted-foreground" onClick={() => setParentId(null)}>
              Vault
            </button>
            {(data?.breadcrumb ?? []).map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button className="hover:underline" onClick={() => setParentId(b.id)}>{b.name}</button>
              </span>
            ))}
          </div>
        )}

        {trash && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              Berkas di sampah masih menghabiskan kuota. Mengosongkannya membebaskan kuota; selama 90 hari admin masih bisa memulihkannya dari Control Room → Audit.
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={emptyTrash.isPending || !(data?.items.length)}
              onClick={() => {
                if (window.confirm("Kosongkan sampah? Berkasnya hilang dari Vault; admin masih bisa memulihkannya dari Audit selama 90 hari.")) emptyTrash.mutate();
              }}
            >
              {emptyTrash.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kosongkan"}
            </Button>
          </div>
        )}

        {/* in-flight uploads */}
        {uploads.map((u) => (
          <div key={u.name} className="mb-2 flex items-center gap-3 rounded-lg border border-border px-3 py-2">
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
        ) : !data?.items.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <HardDrive className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {trash ? "Sampah kosong." : search ? "Tidak ada yang cocok." : "Folder ini masih kosong."}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => {
              const Icon = iconFor(item);
              return (
                <div
                  key={item.id}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover:border-primary/50 transition-colors"
                >
                  <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => openItem(item)}>
                    <Icon className={cn("h-5 w-5 shrink-0", item.kind === "FOLDER" ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.kind === "FOLDER"
                          ? `${item.childCount} item`
                          : humanSize(item.size)}
                        {item.shareCount > 0 && ` · ${item.shareCount} link${item.shareCount === 1 ? "" : "s"}`}
                        {item.minReadRole && " · terbatas"}
                      </span>
                    </span>
                  </button>

                  {item.minReadRole && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {trash ? (
                        <>
                          <DropdownMenuItem onClick={() => restore.mutate(item.id)}>
                            <RotateCcw className="h-4 w-4 mr-2" /> Kembalikan
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={!item.canModify}
                            onClick={() => {
                              if (window.confirm(`Delete "${item.name}" permanently?`)) remove.mutate({ id: item.id, purge: true });
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete permanently
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          {item.kind === "FILE" && (
                            <>
                              <DropdownMenuItem onClick={() => setPreview(item)}>
                                <Eye className="h-4 w-4 mr-2" /> Lihat
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <a href={item.downloadUrl ?? "#"}>
                                  <Download className="h-4 w-4 mr-2" /> Download
                                </a>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setSharing(item)}>
                                <Share2 className="h-4 w-4 mr-2" /> Bagikan
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem
                            disabled={!item.canModify}
                            onClick={() => { setRenaming(item); setRenameValue(item.name); }}
                          >
                            <Pencil className="h-4 w-4 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={!item.canModify}
                            onClick={() => remove.mutate({ id: item.id, purge: false })}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Pindah ke sampah
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PreviewDialog item={preview} onClose={() => setPreview(null)} onShare={(i) => { setPreview(null); setSharing(i); }} />
      <ShareDialog item={sharing} onClose={() => setSharing(null)} />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              disabled={!renameValue.trim() || rename.isPending}
              onClick={() => renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── preview ──────────────────────────────────────────────────────────────────

function PreviewDialog({ item, onClose, onShare }: { item: VaultItem | null; onClose: () => void; onShare: (i: VaultItem) => void }) {
  const mime = item?.mimeType || "";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
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
                Jenis berkas ini tidak bisa dipratinjau. Download to open it.
              </div>
            )}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground self-center">
            {humanSize(item?.size)}{item?.uploader ? ` · diunggah ${item.uploader.name}` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => item && onShare(item)}>
              <Share2 className="h-4 w-4 mr-1.5" /> Bagikan
            </Button>
            <Button asChild>
              <a href={item?.downloadUrl ?? "#"}><Download className="h-4 w-4 mr-1.5" /> Download</a>
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
      toast.success("Link created & copied");
      void qc.invalidateQueries({ queryKey: ["vault-shares", item?.id] });
      void qc.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (e: Error) => toast.error("Couldn't create the link", { description: e.message }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.vaultRevokeShare(id),
    onSuccess: () => {
      toast.success("Link revoked, effective now");
      void qc.invalidateQueries({ queryKey: ["vault-shares", item?.id] });
    },
    onError: (e: Error) => toast.error("Gagal mencabut", { description: e.message }),
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="truncate pr-8">Bagikan "{item?.name}"</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
            <Switch checked={requireAuth} onCheckedChange={setRequireAuth} />
            <span className="text-sm">
              <span className="font-medium flex items-center gap-1.5">
                {requireAuth ? <Users className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {requireAuth ? "Internal" : "Eksternal"}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {requireAuth
                  ? "Requires a NEXUS login. On iPhone and Mac the link opens the app straight to this file."
                  : "Anyone with the link can open it, no account needed. It stays in the browser on purpose and never opens the app."}
              </span>
            </span>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer">
            <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
            <span className="text-sm font-medium">Allow download</span>
          </label>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Expiry</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_LABELS.map((e) => (
                <button
                  key={e.value}
                  onClick={() => setExpires(e.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    expires === e.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Link2 className="h-4 w-4 mr-1.5" /> Create link</>}
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
                  {s.status === "active" ? (s.requireAuth ? "internal" : "eksternal") : s.status === "expired" ? "kedaluwarsa" : "dicabut"}
                </span>
                <span className="truncate flex-1 text-muted-foreground">{s.url}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{s.viewCount}×</span>
                <button
                  className="p-1 hover:bg-muted rounded"
                  title="Copy"
                  onClick={() => { void navigator.clipboard.writeText(s.url); toast.success("Disalin"); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {s.status === "active" && (
                  <button className="p-1 hover:bg-muted rounded text-destructive" title="Cabut" onClick={() => revoke.mutate(s.id)}>
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
