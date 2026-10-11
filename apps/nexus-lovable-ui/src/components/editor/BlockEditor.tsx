import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/core";
import * as Y from "yjs";
import { toast } from "sonner";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { nexusApi } from "@/lib/nexus-api";
import { SocketYProvider, colorFor, type CollabUser } from "@/lib/collab-provider";
import { buildExtensions, type MentionItem, type MentionKind } from "./extensions";
import { createMenuStore } from "./menu-store";
import { SlashMenu, MentionMenu } from "./SuggestionMenus";
import { BlockGutter, BlockMenu } from "./BlockGutter";
import { MobileToolbar, SelectionToolbar, TableToolbar } from "./Toolbars";
import { blockAt, currentBlockPos, revealBlockFromHash } from "./block-actions";
import { jakartaDate, type EditorCtx } from "./editor-context";
import type { SlashItem } from "./slash-items";
import "./block-editor.css";

/**
 * The block editor (owner-approved item #5, 12 Oct 2026): Docs/Pages and task descriptions.
 *
 * It always edits a Y.Doc. With the socket up it joins the body's live room (`doc:<id>` /
 * `taskbody:<id>`, src/lib/collab-rooms.ts): the server seeds and saves the document, everyone sees
 * everyone's edits and cursors. Without the socket it seeds the Y.Doc from `initialDoc` itself and
 * saves through `onRestSave` (debounced), which refuses with a conflict when the stored body moved on
 * meanwhile — the page then offers "Load latest" or "Keep mine". Nothing is ever silently overwritten.
 */

export type SaveStatus = "connecting" | "live" | "saving" | "saved" | "offline" | "readonly" | "conflict" | "error";
export type RestSaveResult = { ok: true } | { ok: false; conflict: true; doc: JSONContent } | { ok: false; conflict?: false; error: string };

export type BlockEditorProps = {
  roomKey: string;
  initialDoc: JSONContent | null;
  canEdit: boolean;
  ctx: EditorCtx;
  placeholder?: string;
  variant?: "page" | "embedded";
  onRestSave: (doc: JSONContent, force: boolean) => Promise<RestSaveResult>;
  onStatus?: (status: SaveStatus, info: { savedAt: string | null; peers: CollabUser[] }) => void;
  onReady?: (editor: Editor | null) => void;
  /** Called after a reset (the body changed elsewhere): the page refetches its REST copy. */
  onExternalChange?: () => void;
  className?: string;
};

const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export function BlockEditor(props: BlockEditorProps) {
  // A reset (another lineage of the live document) remounts everything below with a fresh Y.Doc.
  const [generation, setGeneration] = useState(0);
  return <BlockEditorSession key={`${props.roomKey}:${generation}`} {...props} onReset={() => setGeneration((g) => g + 1)} />;
}

function BlockEditorSession(props: BlockEditorProps & { onReset: () => void }) {
  const { roomKey, ctx, onReset } = props;
  const { t } = useLang();
  const me: CollabUser = useMemo(() => ({ id: ctx.me?.id ?? "anon", name: ctx.me?.name ?? t("Someone"), color: colorFor(ctx.me?.id ?? "anon"), avatar: ctx.me?.avatar ?? null }), [ctx.me?.id, ctx.me?.name, ctx.me?.avatar, t]);
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [phase, setPhase] = useState<"joining" | "live" | "rest">("joining");
  const [provider, setProvider] = useState<SocketYProvider | null>(null);

  useEffect(() => {
    const p = new SocketYProvider(roomKey, ydoc, me);
    let alive = true;
    const offReset = p.onReset((reason) => {
      if (!alive) return;
      if (reason === "external" || reason === "epoch") toast.message(t("This page was changed elsewhere. Showing the latest version."));
      props.onExternalChange?.();
      onReset();
    });
    p.connect(4000).then((ok) => {
      if (!alive) return;
      if (ok) {
        setProvider(p);
        setPhase("live");
      } else {
        offReset();
        p.destroy();
        setPhase("rest");
      }
    });
    return () => {
      alive = false;
      offReset();
      p.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, ydoc]);

  useEffect(() => () => ydoc.destroy(), [ydoc]);

  if (phase === "joining") return <StaticPreview doc={props.initialDoc} variant={props.variant} className={props.className} />;
  return <LiveEditor {...props} ydoc={ydoc} provider={phase === "live" ? provider : null} me={me} />;
}

/** What the page looks like while the live room is being joined (same CSS, no editor yet). */
function StaticPreview({ doc, variant, className }: { doc: JSONContent | null; variant?: "page" | "embedded"; className?: string }) {
  const html = useMemo(() => {
    try {
      return generateHTML(doc ?? EMPTY, buildExtensions({
        ctx: { projectId: null, me: null, upload: () => Promise.reject(new Error("offline")), blockLinkBase: "" },
        placeholder: "", slashStore: createMenuStore(), mentionStore: createMenuStore(), mentionSource: async () => [], onFiles: () => undefined,
        collab: { doc: new Y.Doc(), provider: null, user: { id: "", name: "", color: "" } },
      }).filter((e) => !["collaboration", "collaborationCaret", "slashCommand", "fileHandler", "placeholder"].includes(e.name)));
    } catch {
      return "";
    }
  }, [doc]);
  return (
    <div className={cn("nx-editor", variant === "embedded" && "is-embedded", className)} aria-busy="true">
      <div className="tiptap ProseMirror nx-static" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

type LiveProps = BlockEditorProps & { ydoc: Y.Doc; provider: SocketYProvider | null; me: CollabUser };

function LiveEditor(props: LiveProps) {
  const { t } = useLang();
  const { ydoc, provider, me, ctx, canEdit, onRestSave, onStatus } = props;
  const slashStore = useMemo(() => createMenuStore<SlashItem>(), []);
  const mentionStore = useMemo(() => createMenuStore<MentionItem>(), []);
  const [restStatus, setRestStatus] = useState<SaveStatus>("saved");
  const [restSavedAt, setRestSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<JSONContent | null>(null);
  const [focused, setFocused] = useState(false);
  const [mobileMenu, setMobileMenu] = useState<{ pos: number; rect: DOMRect } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeded = useRef(false);
  const host = useRef<HTMLDivElement>(null);

  const mentionSource = useCallback(async (query: string, kind: MentionKind | null): Promise<MentionItem[]> => {
    const q = query.trim();
    const items: MentionItem[] = [];
    if (!q) {
      if (!kind || kind === "user") {
        const ws = await nexusApi.workspaceMembers().catch(() => null);
        for (const m of (ws?.members ?? []).filter((x) => x.userId !== ctx.me?.id).slice(0, 6)) items.push({ id: m.userId, label: m.name || m.email, kind: "user", avatar: m.avatar });
      }
      if (!kind) {
        items.push({ id: "today", kind: "date", label: t("Today"), date: jakartaDate() });
        items.push({ id: "tomorrow", kind: "date", label: t("Tomorrow"), date: jakartaDate(1) });
        items.push({ id: "remind", kind: "date", label: t("Remind me tomorrow 09:00"), date: jakartaDate(1), remind: true });
      }
      return items;
    }
    const res = await nexusApi.search(q).catch(() => null);
    const want = (k: MentionKind) => !kind || kind === k;
    if (want("user")) for (const m of res?.members ?? []) items.push({ id: m.id, label: m.name || m.email || "", kind: "user" });
    if (want("task")) for (const x of res?.tasks ?? []) items.push({ id: x.id, label: x.title, kind: "task" });
    if (want("doc")) for (const x of res?.docs ?? []) items.push({ id: x.id, label: x.title, kind: "doc" });
    if (want("project")) for (const x of res?.projects ?? []) items.push({ id: x.id, label: x.name, kind: "project", color: x.color ?? null });
    if (!kind) {
      const lower = q.toLowerCase();
      if ("today".startsWith(lower) || "hari ini".startsWith(lower)) items.push({ id: "today", kind: "date", label: t("Today"), date: jakartaDate() });
      if ("tomorrow".startsWith(lower) || "besok".startsWith(lower)) items.push({ id: "tomorrow", kind: "date", label: t("Tomorrow"), date: jakartaDate(1) });
      if ("remind".startsWith(lower) || "ingatkan".startsWith(lower)) items.push({ id: "remind", kind: "date", label: t("Remind me tomorrow 09:00"), date: jakartaDate(1), remind: true });
    }
    return items.slice(0, 24);
  }, [t, ctx.me?.id]);

  const onFiles = useCallback((editor: Editor, files: File[], pos?: number) => {
    if (!editor.isEditable) return;
    for (const file of files.slice(0, 10)) {
      const id = toast.loading(t("Uploading {name}…", { name: file.name }));
      ctx.upload(file).then((res) => {
        const node = res.type.startsWith("image/") ? { type: "image", attrs: { src: res.url, alt: res.name } } : { type: "fileBlock", attrs: { url: res.url, name: res.name, size: res.size, mime: res.type } };
        if (typeof pos === "number") editor.chain().insertContentAt(Math.min(pos, editor.state.doc.content.size), node).run();
        else editor.chain().focus().insertContent(node).run();
        toast.success(t("Uploaded"), { id });
      }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : t("Upload failed."), { id }));
    }
  }, [ctx, t]);

  const extensions = useMemo(() => buildExtensions({
    ctx,
    placeholder: props.placeholder ?? t("Write something, or type '/' for commands…"),
    slashStore, mentionStore, mentionSource, onFiles,
    collab: { doc: ydoc, provider, user: me },
  }), [ydoc, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (editor: Editor, force = false) => {
    setRestStatus("saving");
    try {
      const res = await onRestSave(editor.getJSON(), force);
      if (res.ok) {
        setRestStatus("saved");
        setRestSavedAt(new Date().toISOString());
      } else if (res.conflict) {
        setConflict(res.doc);
        setRestStatus("conflict");
      } else {
        setRestStatus("error");
      }
    } catch {
      setRestStatus("error");
    }
  }, [onRestSave]);

  const editor = useEditor({
    extensions,
    editable: canEdit && (!provider || provider.canWrite),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "nx-prose", spellcheck: "true", "aria-label": t("Page content") },
    },
    onCreate: ({ editor: e }) => {
      if (!provider && !seeded.current) {
        // Offline: this browser seeds its own (unshared) Y.Doc from the stored JSON.
        seeded.current = true;
        e.commands.setContent(props.initialDoc ?? EMPTY, { emitUpdate: false });
      }
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (provider || !e.isEditable || !transaction.docChanged) return;
      setRestStatus("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(e), 900);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  }, [extensions]);

  // Flush a pending REST save when leaving the page.
  useEffect(() => () => {
    if (saveTimer.current && editor && !provider) {
      clearTimeout(saveTimer.current);
      void onRestSave(editor.getJSON(), false);
    }
  }, [editor, provider, onRestSave]);

  useEffect(() => {
    editor?.setEditable(canEdit && (!provider || provider.canWrite));
  }, [editor, canEdit, provider]);

  useEffect(() => {
    if (!editor) return;
    (editor.storage as unknown as { nexus: { ctx: EditorCtx } }).nexus.ctx = ctx;
  }, [editor, ctx]);

  useEffect(() => {
    props.onReady?.(editor);
    if (editor) window.setTimeout(() => revealBlockFromHash(host.current), 120);
    return () => props.onReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Live status for the page header: saving/saved + who else is here.
  const tick = useSyncExternalStore(
    useCallback((f: () => void) => (provider ? provider.subscribe(f) : () => undefined), [provider]),
    () => (provider ? `${provider.status}|${provider.pending}|${provider.lastSavedAt}|${provider.awareness.getStates().size}` : "rest"),
    () => "rest",
  );
  useEffect(() => {
    if (!onStatus) return;
    if (provider) {
      const status: SaveStatus = !canEdit || !provider.canWrite ? "readonly" : provider.status === "offline" ? "offline" : provider.pending ? "saving" : provider.lastSavedAt ? "saved" : "live";
      onStatus(status, { savedAt: provider.lastSavedAt, peers: provider.peers() });
    } else {
      onStatus(!canEdit ? "readonly" : restStatus, { savedAt: restSavedAt, peers: [] });
    }
  }, [tick, restStatus, restSavedAt, provider, canEdit, onStatus]);

  if (!editor) return null;
  const isCoarse = coarse();
  return (
    <div ref={host} className={cn("nx-editor", props.variant === "embedded" && "is-embedded", props.className)}>
      {conflict && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1">{t("Someone else changed this while you were editing.")}</span>
          <button type="button" className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted" onClick={() => { setConflict(null); setRestStatus("saved"); editor.commands.setContent(conflict, { emitUpdate: false }); }}>{t("Load latest")}</button>
          <button type="button" className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={() => { setConflict(null); void save(editor, true); }}>{t("Keep mine")}</button>
        </div>
      )}
      {editor.isEditable && !isCoarse && <BlockGutter editor={editor} />}
      <EditorContent editor={editor} />
      {editor.isEditable && <SelectionToolbar editor={editor} />}
      {editor.isEditable && <TableToolbar editor={editor} />}
      <SlashMenu store={slashStore} />
      <MentionMenu store={mentionStore} />
      {editor.isEditable && isCoarse && focused && (
        <MobileToolbar editor={editor} onBlockMenu={(el) => { const pos = currentBlockPos(editor); if (pos !== null) setMobileMenu({ pos, rect: el.getBoundingClientRect() }); }} />
      )}
      {mobileMenu && (() => {
        const node = blockAt(editor, mobileMenu.pos);
        return node ? <BlockMenu editor={editor} target={{ node, pos: mobileMenu.pos }} anchor={mobileMenu.rect} onClose={() => setMobileMenu(null)} /> : null;
      })()}
    </div>
  );
}
