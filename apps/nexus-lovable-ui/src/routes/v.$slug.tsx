import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, Download, ExternalLink, File as FileIcon, FileText, Film, Folder, Image as ImageIcon,
  Loader2, Lock, LogIn, Music, RefreshCw,
} from "lucide-react";
import nexusLogo from "@/assets/nexus-logo.png";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VaultLightbox } from "@/components/vault/VaultLightbox";
import { CHECKERBOARD, VaultTilePicture } from "@/components/vault/VaultTilePicture";
import { cn } from "@/lib/utils";
import { setLang, useDocumentLang, useLang } from "@/lib/lang";
import { ApiError, nexusApi, type VaultItem, type VaultPublicFile, type VaultPublicItem } from "@/lib/nexus-api";
import { fillsTile, humanSize, isPdf, mediaKind } from "@/lib/vault-media";

// Two routes, one component, one API. `/v/*` is claimed in the AASA and opens the iOS/Mac app when
// one is installed; `/s/*` is deliberately not claimed, so an external link handed to a client always
// stays in their browser. Which prefix a link uses is decided when it is made, from the same
// requireAuth flag the server enforces on every request.
//
// Phase 2 (owner, 9 Oct 2026): this page is what a client sees, so it carries the company's mark, says
// who shared the file and how big it is, speaks English or Indonesian (switch in the corner), and says
// plainly why a link no longer works and what to do about it. A link can also open a FOLDER: the
// page browses its subtree (never above it), with thumbnails, the vault's own viewer, a download per
// file and a .zip of the lot when the link allows downloads. `?f=<folderId>` keeps the folder in the
// address, so Back goes up a level.
type ShareSearch = { f?: string };
export const validateShareSearch = (s: Record<string, unknown>): ShareSearch => ({
  f: typeof s.f === "string" && s.f ? s.f : undefined,
});

export const Route = createFileRoute("/v/$slug")({ component: VaultSharePage, validateSearch: validateShareSearch });

/** A link item, in the shape the vault's viewer and tiles already take. */
function asVaultItem(p: VaultPublicItem): VaultItem {
  return {
    id: p.id, kind: p.kind, name: p.name, position: 0, icon: null, color: null, mimeType: p.mimeType, size: p.size,
    width: p.width, height: p.height, parentId: null, url: p.previewUrl, downloadUrl: p.downloadUrl, thumbUrl: p.thumbUrl,
    uploader: null, owner: null, childCount: p.childCount, shareCount: 0, minReadRole: null, minWriteRole: null,
    trashed: false, deletedAt: null, createdAt: "", updatedAt: "", canModify: false, fileVersion: p.fileVersion,
  };
}

/** The root of an older server's answer, which has no `item`. */
function rootItemOf(data: VaultPublicFile): VaultPublicItem {
  if (data.item) return data.item;
  return {
    id: data.slug, kind: "FILE", name: data.file.name, mimeType: data.file.mimeType, size: data.file.size,
    width: data.file.width, height: data.file.height, childCount: 0, previewKind: null, previewUrl: data.previewUrl,
    downloadUrl: data.downloadUrl, thumbUrl: data.thumbUrl ?? null, fileVersion: null,
  };
}

/** What a picture, film, sound or PDF can be shown as. Older servers send no previewKind. */
function previewKindOf(p: VaultPublicItem): VaultPublicItem["previewKind"] {
  if (p.previewKind !== undefined && p.previewKind !== null) return p.previewKind;
  if (p.kind !== "FILE" || !p.previewUrl) return null;
  const m = (p.mimeType || "").toLowerCase();
  if (isPdf(p)) return "pdf";
  if (m.startsWith("image/") && m !== "image/svg+xml") return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return null;
}

export function VaultSharePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const search = useSearch({ strict: false }) as ShareSearch;
  const navigate = useNavigate();
  const { t, lang } = useLang();
  useDocumentLang(lang);

  const q = useQuery({
    queryKey: ["vault-public", slug],
    queryFn: () => nexusApi.vaultPublic(slug),
    retry: false,
  });

  const data = q.data;
  const isFolder = data?.kind === "FOLDER";
  const folderId = isFolder ? search.f ?? null : null;
  const openFolder = (id: string | null) => {
    void navigate({ to: ".", search: (id ? { f: id } : {}) as never });
  };

  const name = data ? (isFolder ? data.folder?.name ?? data.file.name : data.file.name) : null;
  useEffect(() => {
    const before = document.title;
    document.title = q.isError ? `${t("Link unavailable")} · Z Vault` : name ? `${name} · Z Vault` : "Z Vault";
    return () => { document.title = before; };
  }, [name, q.isError, t]);

  if (q.isLoading) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </Shell>
    );
  }

  if (q.error || !data) {
    return (
      <Shell>
        <LinkProblem error={q.error as ApiError | null} onRetry={() => void q.refetch()} />
      </Shell>
    );
  }

  const meta = [
    !isFolder && data.file.size != null ? humanSize(data.file.size) : null,
    data.sharedBy?.name ? t("Shared by {name}", { name: data.sharedBy.name }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {isFolder ? <Folder className="h-5 w-5" /> : <FileGlyph item={rootItemOf(data)} className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-lg font-semibold leading-snug md:text-xl">{name}</h1>
            {meta && <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>}
            {data.expiresAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("Available until {date}", { date: new Date(data.expiresAt).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) })}
              </p>
            )}
          </div>
        </div>

        {isFolder ? (
          <SharedFolder slug={slug} data={data} folderId={folderId} onOpenFolder={openFolder} />
        ) : (
          <SharedFile item={rootItemOf(data)} allowDownload={data.allowDownload} />
        )}

        {!data.allowDownload && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t("This link is view-only. The sender turned downloads off.")}
          </p>
        )}
      </div>
    </Shell>
  );
}

// ── the frame: the company's mark, and the language switch ────────────────────

function Shell({ children }: { children: ReactNode }) {
  const { t, lang } = useLang();
  return (
    <div lang={lang} className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 md:px-8 py-3 flex items-center gap-2.5">
        <img src={nexusLogo} alt="" className="h-7 w-7 object-contain" />
        <span className="font-semibold tracking-tight">NEXUS</span>
        <span className="text-sm text-muted-foreground">· Z Vault</span>
        <div className="ml-auto flex items-center rounded-full border border-border p-0.5 text-xs" role="group" aria-label={t("Language")}>
          {(["en", "id"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={cn("rounded-full px-2.5 py-1 font-medium uppercase", lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}

// ── when the link does not open ──────────────────────────────────────────────

function LinkProblem({ error, onRetry }: { error: ApiError | null; onRetry: () => void }) {
  const { t } = useLang();
  const reason = String((error?.payload as { reason?: string } | null)?.reason ?? "");
  const status = error?.status ?? 0;
  const copy: Record<string, { title: string; body: string; ask?: boolean }> = {
    missing: { title: t("This link doesn't exist"), body: t("Check that the whole link was copied."), ask: true },
    revoked: { title: t("This link was turned off"), body: t("The person who shared it has switched it off."), ask: true },
    expired: { title: t("This link has expired"), body: t("It was only available for a limited time."), ask: true },
    gone: { title: t("This is no longer available"), body: t("The file or folder behind this link was removed or moved out of reach."), ask: true },
    auth_required: { title: t("This link is for people at the company"), body: t("Sign in to NEXUS to open it.") },
    not_member: { title: t("This link is for people at the company"), body: t("Your NEXUS account isn't part of the company that shared it.") },
    forbidden: { title: t("You don't have access to this folder"), body: t("It's locked to certain roles. Ask the sender if you need it.") },
  };
  const c = copy[reason] ?? (status === 401 ? copy.auth_required : status === 404 ? copy.missing : null);
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Lock className="h-10 w-10 text-muted-foreground/40" />
        <h1 className="mt-4 text-lg font-semibold">{c ? c.title : t("This link can't be opened right now")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{c ? c.body : t("Something went wrong on our side. Try again in a moment.")}</p>
        {c?.ask && <p className="mt-3 text-sm font-medium">{t("Ask the sender for a new link.")}</p>}
        {(reason === "auth_required" || (!reason && status === 401)) && (
          <Button className="mt-5" asChild>
            <a href={`/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
              <LogIn className="h-4 w-4 mr-1.5" /> {t("Sign in to NEXUS")}
            </a>
          </Button>
        )}
        {!c && (
          <Button className="mt-5" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> {t("Try again")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── one file ─────────────────────────────────────────────────────────────────

function FileGlyph({ item, className }: { item: Pick<VaultPublicItem, "kind" | "mimeType" | "name">; className?: string }) {
  if (item.kind === "FOLDER") return <Folder className={className} />;
  const m = item.mimeType || "";
  const Icon = m.startsWith("image/") ? ImageIcon : m.startsWith("video/") ? Film : m.startsWith("audio/") ? Music
    : isPdf(item) || m.startsWith("text/") ? FileText : FileIcon;
  return <Icon className={className} />;
}

/** A file shown whole: the picture, the film, the sound, the PDF — or why it can't be. */
function FilePreview({ item }: { item: VaultPublicItem }) {
  const { t } = useLang();
  const kind = previewKindOf(item);
  const [failed, setFailed] = useState(false);
  const src = item.previewUrl;
  if (src && !failed && kind === "image") {
    return (
      <div className="grid place-items-center rounded-xl border border-border p-2" style={fillsTile(item) ? undefined : CHECKERBOARD}>
        <img src={src} alt={item.name} onError={() => setFailed(true)} className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  if (src && !failed && kind === "video") {
    return <video src={src} controls playsInline preload="metadata" onError={() => setFailed(true)} className="w-full max-h-[75vh] rounded-xl border border-border bg-black" />;
  }
  if (src && !failed && kind === "audio") {
    return <audio src={src} controls onError={() => setFailed(true)} className="w-full" />;
  }
  if (src && kind === "pdf") {
    return (
      <div className="space-y-2">
        {/* An iframe shows only the first page on iPhone Safari; the button opens the PDF itself. */}
        <iframe src={src} title={item.name} className="h-[70vh] w-full rounded-xl border border-border bg-muted/30" />
        <div className="flex justify-center">
          <Button variant="outline" size="sm" asChild>
            <a href={src} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" /> {t("Open PDF")}</a>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border p-10 text-center">
      <FileGlyph item={item} className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {failed
          ? item.downloadUrl ? t("This can't be shown in this browser. Download it to open it.") : t("This can't be shown in this browser.")
          : item.downloadUrl ? t("This kind of file can't be previewed. Download it to open it.") : t("This kind of file can't be previewed, and the sender turned downloads off.")}
      </p>
    </div>
  );
}

function SharedFile({ item, allowDownload }: { item: VaultPublicItem; allowDownload: boolean }) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <FilePreview item={item} />
      {allowDownload && item.downloadUrl && (
        <div className="flex justify-center">
          <Button asChild><a href={item.downloadUrl}><Download className="h-4 w-4 mr-1.5" /> {t("Download")}</a></Button>
        </div>
      )}
    </div>
  );
}

// ── a folder ─────────────────────────────────────────────────────────────────

function SharedFolder({ slug, data, folderId, onOpenFolder }: {
  slug: string; data: VaultPublicFile; folderId: string | null; onOpenFolder: (id: string | null) => void;
}) {
  const { t, tn } = useLang();
  const rootId = data.folder?.id ?? null;
  const listing = useQuery({
    queryKey: ["vault-public", slug, "items", folderId ?? "root"],
    queryFn: () => nexusApi.vaultPublicItems(slug, folderId),
    retry: false,
  });
  const [viewer, setViewer] = useState<number | null>(null);
  const [opened, setOpened] = useState<VaultPublicItem | null>(null);
  const [zipping, setZipping] = useState(false);

  const items = useMemo(() => listing.data?.items ?? [], [listing.data]);
  const folders = items.filter((i) => i.kind === "FOLDER");
  const media = items.filter((i) => i.kind === "FILE" && mediaKind(i) !== null && i.previewUrl);
  const files = items.filter((i) => i.kind === "FILE" && !media.includes(i));
  const mediaItems = useMemo(() => media.map(asVaultItem), [media]);

  const zipHref = data.zipUrl ? `${data.zipUrl}${folderId && folderId !== rootId ? `?folderId=${encodeURIComponent(folderId)}` : ""}` : null;

  // Asked first (?check=1), so a folder over the cap says so here instead of opening a page of JSON.
  const downloadAll = async () => {
    if (!zipHref || zipping) return;
    setZipping(true);
    try {
      const res = await fetch(`${zipHref}${zipHref.includes("?") ? "&" : "?"}check=1`, { credentials: "include" });
      if (res.ok) { window.location.href = zipHref; return; }
      const body = await res.json().catch(() => null) as { code?: string } | null;
      if (body?.code === "ZIP_TOO_BIG") toast.error(t("Too much for one .zip"), { description: t("Download the files one by one, or open a subfolder and download that.") });
      else toast.error(t("Couldn't make the .zip"), { description: t("Try again in a moment.") });
    } catch {
      toast.error(t("Couldn't make the .zip"), { description: t("Try again in a moment.") });
    } finally {
      setZipping(false);
    }
  };

  const open = (i: VaultPublicItem) => {
    if (i.kind === "FOLDER") { onOpenFolder(i.id === rootId ? null : i.id); return; }
    const at = media.indexOf(i);
    if (at >= 0) setViewer(at);
    else setOpened(i);
  };

  if (listing.isLoading) return <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (listing.isError) {
    const err = listing.error as ApiError;
    const status = err?.status ?? 0;
    return (
      <div className="rounded-xl border border-border p-8 text-center">
        <p className="text-sm font-medium">{status === 404 ? t("This folder isn't part of the link.") : status === 410 ? t("This link no longer works.") : t("Couldn't open this folder.")}</p>
        <div className="mt-4 flex justify-center gap-2">
          {status === 404 && <Button variant="outline" size="sm" onClick={() => onOpenFolder(null)}>{t("Back to the shared folder")}</Button>}
          {status !== 404 && <Button variant="outline" size="sm" onClick={() => void listing.refetch()}><RefreshCw className="h-4 w-4 mr-1.5" /> {t("Try again")}</Button>}
        </div>
      </div>
    );
  }

  const trail = listing.data?.breadcrumb ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t("Folder path")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
          {trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              {i === trail.length - 1 ? (
                <span className="px-1.5 py-0.5 font-medium" aria-current="page">{c.name}</span>
              ) : (
                <button type="button" className="rounded px-1.5 py-0.5 text-muted-foreground hover:underline" onClick={() => onOpenFolder(i === 0 ? null : c.id)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        {zipHref && items.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void downloadAll()} disabled={zipping}>
            {zipping ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />} {t("Download all (.zip)")}
          </Button>
        )}
      </div>

      {!items.length ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          <Folder className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          {t("This folder is empty.")}
        </div>
      ) : (
        <div className="space-y-5">
          {folders.length > 0 && (
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => open(f)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Folder className="h-5 w-5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">{tn(f.childCount, "{n} item", "{n} items")}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {media.length > 0 && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {media.map((m, i) => (
                <div key={m.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    aria-label={t("Open {name}", { name: m.name })}
                    onClick={() => setViewer(i)}
                    className="relative aspect-square overflow-hidden cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={fillsTile(m) ? undefined : CHECKERBOARD}
                  >
                    <VaultTilePicture item={mediaItems[i]} />
                  </button>
                  <div className="flex items-center gap-1 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium" title={m.name}>{m.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{humanSize(m.size)}</p>
                    </div>
                    {m.downloadUrl && (
                      <a href={m.downloadUrl} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted" aria-label={t("Download {name}", { name: m.name })} title={t("Download")}>
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {files.map((f) => {
                const viewable = previewKindOf(f) !== null;
                return (
                  <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => open(f)}
                      disabled={!viewable && !f.downloadUrl}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                    >
                      <FileGlyph item={f} className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{f.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {humanSize(f.size)}{!viewable && !f.downloadUrl ? ` · ${t("can't be opened on a view-only link")}` : ""}
                        </span>
                      </span>
                    </button>
                    {f.downloadUrl && (
                      <a href={f.downloadUrl} className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-muted" aria-label={t("Download {name}", { name: f.name })} title={t("Download")}>
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <VaultLightbox
        items={mediaItems}
        index={viewer}
        onIndexChange={setViewer}
        onClose={() => setViewer(null)}
      />
      <FileDialog item={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

/** A PDF, a sound or anything else opened from a shared folder. */
function FileDialog({ item, onClose }: { item: VaultPublicItem | null; onClose: () => void }) {
  const { t, lang } = useLang();
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent lang={lang} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{item?.name}</DialogTitle>
          <DialogDescription>{humanSize(item?.size)}</DialogDescription>
        </DialogHeader>
        {item && <FilePreview item={item} />}
        {item?.downloadUrl && (
          <div className="flex justify-end">
            <Button asChild><a href={item.downloadUrl}><Download className="h-4 w-4 mr-1.5" /> {t("Download")}</a></Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
