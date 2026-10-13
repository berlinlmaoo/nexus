import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { docTitle } from "@/lib/doc-title";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor, JSONContent } from "@tiptap/core";
import { ArrowLeft, Check, CloudOff, Copy, Link2, Loader2, Lock, MoreHorizontal, MoveHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiFetch, fmtDate, nexusApi, textToTiptap } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { pushGideonPage } from "@/lib/gideon-ai";
import { useRealtimeRoom } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { AvatarFace } from "@/components/Avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { BlockEditor, type RestSaveResult, type SaveStatus } from "@/components/editor/BlockEditor";
import { DocPageHeader } from "@/components/editor/PageHeader";
import { useEditorCtx } from "@/components/editor/useEditorCtx";
import type { CollabUser } from "@/lib/collab-provider";

export const Route = createFileRoute("/_app/docs/$docId")({
  component: DocPage,
  // The page's data starts with the navigation (and on hover of a link to it), not after the editor's code
  // has loaded — perf pass, 12 Oct 2026. Not awaited.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery({ queryKey: ["nexus", "doc", params.docId], queryFn: () => nexusApi.doc(params.docId), staleTime: 30_000, retry: false });
  },
});

/**
 * A doc / project page (block editor, owner-approved item #5): Notion-style header (icon, cover, title),
 * the block body edited live with everyone who has it open, autosaved. Header fields save on their own
 * (debounced PATCH); other people's header edits arrive through `doc-changed` on the project room.
 */
function DocPage() {
  const { docId } = useParams({ from: "/_app/docs/$docId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useLang();
  const doc = useQuery({ queryKey: ["nexus", "doc", docId], queryFn: () => nexusApi.doc(docId), retry: false });
  const d = doc.data?.doc;
  const projectId = d?.project?.id ?? d?.projectId ?? null;
  useRealtimeRoom(projectId ? `project:${projectId}` : null);
  // GIDEON opened on this page carries it as context (Notion AI's page chip).
  useEffect(() => (d ? pushGideonPage({ kind: "doc", id: d.id, title: docTitle(d.title), projectId, projectName: d.project?.name ?? null }) : undefined), [d?.id, d?.title, projectId, d?.project?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("connecting");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [peers, setPeers] = useState<CollabUser[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const titleDirty = useRef(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = useRef<string | undefined>(undefined);

  // Header fields follow the server unless being typed into here.
  useEffect(() => {
    if (!d) return;
    if (!titleDirty.current) setTitle(d.title === "Untitled" ? "" : d.title ?? "");
    setIcon(d.icon ?? null);
    setCover(d.coverImage ?? null);
    setFullWidth(!!d.fullWidth);
    base.current = d.updatedAt ?? undefined;
  }, [d]);

  const patch = useCallback(async (payload: Parameters<typeof nexusApi.updateDoc>[1]) => {
    try {
      const res = await nexusApi.updateDoc(docId, payload);
      base.current = res.doc.updatedAt ?? base.current;
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      if (projectId) qc.invalidateQueries({ queryKey: ["nexus", "project-docs", projectId] });
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't save."));
      throw e;
    }
  }, [docId, projectId, qc, t]);

  // The title typed but not yet sent (debounced 600 ms). Leaving the page — Back, a link, closing the tab —
  // sends it right away instead of dropping it (bughunt E-BUG-1: a title typed just before Back was lost).
  const pendingTitle = useRef<string | null>(null);
  const onTitle = (v: string) => {
    setTitle(v);
    titleDirty.current = true;
    pendingTitle.current = v;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      pendingTitle.current = null;
      void patch({ title: v.trim() || "Untitled" }).finally(() => { titleDirty.current = false; });
    }, 600);
  };
  useEffect(() => {
    const flush = (unloading: boolean) => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = null;
      const v = pendingTitle.current;
      pendingTitle.current = null;
      if (v === null) return;
      const body = JSON.stringify({ title: v.trim() || "Untitled" });
      // keepalive lets the request finish while the tab is closing.
      void apiFetch(`/api/docs/${docId}`, { method: "PATCH", body, keepalive: unloading })
        .then(() => { qc.invalidateQueries({ queryKey: ["nexus", "doc", docId] }); qc.invalidateQueries({ queryKey: ["nexus", "docs"] }); if (projectId) qc.invalidateQueries({ queryKey: ["nexus", "project-docs", projectId] }); })
        .catch(() => { /* the page is gone; nothing to show the error on */ });
    };
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); flush(false); };
  }, [docId, projectId, qc]);

  const onRestSave = useCallback(async (content: JSONContent, force: boolean): Promise<RestSaveResult> => {
    try {
      await patch({ content, ...(force ? {} : { baseUpdatedAt: base.current }) });
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const latest = (e.payload as { doc?: { content?: unknown; updatedAt?: string } } | null)?.doc;
        base.current = latest?.updatedAt ?? base.current;
        return { ok: false, conflict: true, doc: (latest?.content as JSONContent) ?? textToTiptap("") };
      }
      return { ok: false, error: e instanceof Error ? e.message : "error" };
    }
  }, [patch]);

  const onStatus = useCallback((s: SaveStatus, info: { savedAt: string | null; peers: CollabUser[] }) => {
    setStatus(s);
    setSavedAt(info.savedAt);
    setPeers(info.peers);
  }, []);

  const ctx = useEditorCtx(projectId, `/docs/${docId}`, (taskId) => navigate({ to: "/tasks/$taskId", params: { taskId } }));

  const duplicate = useMutation({
    mutationFn: () => nexusApi.duplicateDoc(docId),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("Couldn't duplicate the page.")),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["nexus", "docs"] }); if (res.doc?.id) navigate({ to: "/docs/$docId", params: { docId: res.doc.id } }); },
  });
  const del = useMutation({
    mutationFn: () => nexusApi.deleteDoc(docId),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("Couldn't delete the page.")),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "docs"] });
      if (projectId) navigate({ to: "/projects/$projectId", params: { projectId } });
      else navigate({ to: "/docs" });
    },
  });

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else if (projectId) navigate({ to: "/projects/$projectId", params: { projectId } });
    else navigate({ to: "/docs" });
  };

  const statusText = (() => {
    switch (status) {
      case "connecting": return t("Connecting…");
      case "saving": return t("Saving…");
      case "saved": return savedAt ? t("Saved") : d?.updatedAt ? t("Edited {when}", { when: fmtDate(d.updatedAt) }) : t("Saved");
      case "live": return d?.updatedAt ? t("Edited {when}", { when: fmtDate(d.updatedAt) }) : "";
      case "offline": return t("Offline: changes are kept here and sent when back online");
      case "readonly": return t("View only");
      case "conflict": return t("Changed elsewhere");
      case "error": return t("Couldn't save. Retrying when you type again.");
    }
  })();

  return (
    <div className="min-h-dvh bg-card pb-24">
      <div className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b border-transparent bg-card/90 px-3 backdrop-blur md:px-4">
        <button type="button" onClick={back} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={t("Back")}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {d?.project && (
            <button type="button" onClick={() => projectId && navigate({ to: "/projects/$projectId", params: { projectId } })} className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <ProjectMarkFor projectId={projectId} icon={(d.project as { icon?: string | null }).icon} size={14} />
              <span className="truncate">{d.project.name}</span>
            </button>
          )}
          {d && <span className="text-muted-foreground/60">/</span>}
          {d && <span className="truncate px-1 text-foreground">{icon ? `${icon} ` : ""}{title || t("Untitled")}</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn("hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex", status === "offline" && "text-warning-foreground dark:text-warning", status === "error" && "text-destructive")} aria-live="polite">
            {status === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
            {status === "saved" && savedAt && <Check className="h-3 w-3" />}
            {status === "offline" && <CloudOff className="h-3 w-3" />}
            {status === "readonly" && <Lock className="h-3 w-3" />}
            {statusText}
          </span>
          {peers.length > 0 && (
            <div className="flex -space-x-1.5" aria-label={t("Also here: {names}", { names: peers.map((p) => p.name).join(", ") })}>
              {peers.slice(0, 4).map((p) => (
                <span key={p.id} title={p.name} className="rounded-full ring-2" style={{ ["--tw-ring-color" as string]: p.color }}>
                  <AvatarFace name={p.name} avatar={p.avatar ?? null} seed={p.id} size={24} />
                </span>
              ))}
              {peers.length > 4 && <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[10px] font-semibold">+{peers.length - 4}</span>}
            </div>
          )}
          {d && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={t("Page options")}><MoreHorizontal className="h-4 w-4" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); const v = !fullWidth; setFullWidth(v); void patch({ fullWidth: v }); }} className="justify-between">
                  <span className="inline-flex items-center gap-2"><MoveHorizontal className="h-4 w-4" />{t("Full width")}</span>
                  <Switch checked={fullWidth} aria-hidden tabIndex={-1} className="pointer-events-none" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(`${window.location.origin}/docs/${docId}`).then(() => toast.success(t("Link copied"))); }}><Link2 className="mr-2 h-4 w-4" />{t("Copy link")}</DropdownMenuItem>
                <DropdownMenuItem disabled={duplicate.isPending} onSelect={() => duplicate.mutate()}><Copy className="mr-2 h-4 w-4" />{t("Duplicate")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (window.confirm(t("Delete this page? You can restore it from Control Room → Audit."))) del.mutate(); }}><Trash2 className="mr-2 h-4 w-4" />{t("Delete")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* A page-shaped placeholder (title + a few lines) in the editor's column, instead of a spinner. */}
      {doc.isLoading && (
        <div className="nx-page-col space-y-3 pb-24 pt-10" aria-busy>
          <div className="h-10 w-3/5 animate-pulse rounded-md bg-muted" />
          {[92, 100, 84, 96, 60].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted/70" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {doc.isError && (
        <div className="nx-page-col py-24 text-center">
          <p className="text-base font-semibold text-foreground">{t("This page can't be opened")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{doc.error instanceof ApiError && doc.error.status === 404 ? t("It was deleted, or the link is wrong.") : t("You may not have access to its project. Ask a project member to add you.")}</p>
          <button type="button" onClick={() => navigate({ to: "/docs" })} className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">{t("Go to Knowledge Library")}</button>
        </div>
      )}

      {d && (
        <>
          <DocPageHeader
            icon={icon}
            cover={cover}
            title={title}
            editable={status !== "readonly"}
            fullWidth={fullWidth}
            onIcon={(v) => { setIcon(v); void patch({ icon: v }); }}
            onCover={(v) => { setCover(v); void patch({ coverImage: v }); }}
            onTitle={onTitle}
            onUploadCover={async (f) => (await ctx.upload(f)).url}
            onEnterBody={() => {
              // Notion: Enter in the title starts a new empty block at the top (or uses the empty one there).
              const ed = editorRef.current;
              if (!ed) return;
              const first = ed.state.doc.firstChild;
              if (ed.isEditable && first && !(first.type.name === "paragraph" && first.content.size === 0)) ed.chain().insertContentAt(0, { type: "paragraph" }).focus("start").run();
              else ed.commands.focus("start");
            }}
          />
          <div className={cn("nx-page-col mt-3", fullWidth && "is-full")}>
            <BlockEditor
              roomKey={`doc:${docId}`}
              initialDoc={(doc.data?.doc.content as JSONContent | null) ?? null}
              canEdit
              ctx={ctx}
              variant="page"
              placeholder={t("Write something, or type '/' for commands…")}
              onRestSave={onRestSave}
              onStatus={onStatus}
              onReady={(e) => { editorRef.current = e; }}
              onExternalChange={() => qc.invalidateQueries({ queryKey: ["nexus", "doc", docId] })}
            />
          </div>
          <div
            className={cn("nx-page-col nx-page-tail", fullWidth && "is-full")}
            onMouseDown={(e) => {
              const ed = editorRef.current;
              if (!ed || !ed.isEditable) return;
              e.preventDefault();
              const last = ed.state.doc.lastChild;
              if (last && !(last.type.name === "paragraph" && last.content.size === 0)) ed.chain().insertContentAt(ed.state.doc.content.size, { type: "paragraph" }).focus("end").run();
              else ed.commands.focus("end");
            }}
          />
        </>
      )}
    </div>
  );
}
