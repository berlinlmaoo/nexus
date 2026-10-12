import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docTitle } from "@/lib/doc-title";
import { isEditableTarget, modKey } from "@/lib/keyboard";
import { SelectPicker } from "@/components/SelectPicker";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  AlertTriangle, ArrowDownToLine, ArrowUp, AtSign, Check, ChevronDown, ChevronRight, ClipboardList, Copy, ExternalLink, FilePlus2, FileText,
  FolderKanban, History, ImagePlus, ListChecks, Loader2, Maximize2, MessageCircle, MessageSquare, Minimize2, MoreHorizontal, PanelRight,
  Paperclip, Pencil, Plus, Search, ShieldCheck, SquarePen, Trash2, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { GideonMark } from "./GideonMark";
import { GideonMarkdown } from "./GideonMarkdown";
import {
  clearGideonHistory, decideGideonProposal, gideonAttachmentLink, loadGideonHistory, pendingGideonProposals, streamGideon,
  GIDEON_APPROVAL_MODES, GIDEON_DEFAULT_APPROVAL, GIDEON_DEFAULT_TIER, GIDEON_FILE_ACCEPT, GIDEON_MAX_FILE_BYTES, GIDEON_TIERS,
  isAcceptedGideonFile,
  type GideonApprovalMode, type GideonAttachment, type GideonCard, type GideonContext, type GideonContextRef, type GideonFile, type GideonMessage,
  type GideonProposal, type GideonRef, type GideonStep, type GideonTier, type GideonTurn,
} from "@/lib/gideon";
import {
  deleteGideonChat, getGideonPrefs, listGideonChats, markdownToDoc, renameGideonChat, saveGideonAnswerAsDoc, saveGideonPrefs, setCachedGideonPrefs,
  setGideonLayout, useGideonEditorTarget, useGideonLayout, useGideonName, useGideonPage, useGideonPrefs,
  type GideonChatRow, type GideonPageRef,
} from "@/lib/gideon-ai";
import { nexusApi } from "@/lib/nexus-api";
import { useLang, type LangApi } from "@/lib/lang";
import { citedSources } from "@/lib/gideon-cite";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/LoadError";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * GIDEON chat (owner, 12 Oct 2026: "1:1 like Notion AI, reading what each account can see with its own
 * access"). The answer streams in as Markdown with the steps GIDEON takes, the sources it read (a workspace
 * search runs before every question), cards for what it created or changed, and — per approval mode — the
 * changes waiting for Apply / Discard.
 *
 * Like Notion AI: conversations with a searchable history and New chat (⌘/Ctrl+O); the page you are on is
 * attached as context automatically, more pages with "@"; "+" attaches images and files; Personalize (what
 * you call it + your own instructions); floating, docked as a side panel, or the full page (/gideon); an
 * answer can be copied, inserted into the open page, or saved as a new doc.
 */

/** What was typed in the composer and not sent, kept while the panel is closed and reopened (bughunt G-BUG-2). */
let composerDraft = "";

type ChatTurn = GideonTurn & { streaming?: boolean; steps?: GideonStep[]; sources?: GideonRef[]; cards?: GideonCard[]; proposals?: GideonProposal[]; failed?: boolean };

function fromHistory(row: GideonTurn): ChatTurn {
  const m = row.meta;
  return { ...row, steps: m?.steps ?? [], sources: m?.sources ?? [], cards: m?.cards ?? [], proposals: m?.proposals ?? [] };
}

/** The step line, translated. The server sends the tool and its human handle (a query, a name). */
function stepText(s: GideonStep, t: LangApi["t"]): string {
  const a = s.arg ? s.arg.slice(0, 60) : "";
  switch (s.tool) {
    case "list_projects": return t("Listing projects");
    case "list_members": return t("Looking up people");
    case "list_tasks": return a ? t("Listing tasks in {name}", { name: a }) : t("Listing tasks");
    case "search_tasks": return a ? t("Searching tasks for “{q}”", { q: a }) : t("Searching tasks");
    case "search_workspace": return a ? t("Searching your workspace for “{q}”", { q: a }) : t("Searching your workspace");
    case "get_project_summary": return a ? t("Reading project {name}", { name: a }) : t("Reading a project");
    case "read_context": return a ? t("Reading {name}", { name: a }) : t("Reading a project");
    case "list_custom_fields": return t("Reading the project's fields");
    case "get_task": return a ? t("Reading task {name}", { name: a }) : t("Reading a task");
    case "search_docs": return a ? t("Searching docs for “{q}”", { q: a }) : t("Searching docs");
    case "get_doc": return a ? t("Reading doc {name}", { name: a }) : t("Reading a doc");
    case "create_task": return a ? t("Creating task {name}", { name: a }) : t("Creating a task");
    case "update_task": return a ? t("Updating task {name}", { name: a }) : t("Updating a task");
    case "add_task_comment": return a ? t("Commenting on {name}", { name: a }) : t("Commenting on a task");
    case "create_document": return a ? t("Writing doc {name}", { name: a }) : t("Writing a doc");
    case "vision_analyze": case "vision": return t("Looking at the image");
    default: return s.label || s.tool;
  }
}

const STATUS_WORD: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };

export type GideonPanelVariant = "float" | "side" | "page";

/** The page ref → what the chat route takes as `context` (project / task / doc it was opened from). */
function contextOf(ref: GideonPageRef | null, explicit: GideonContext | null | undefined): GideonContext | null {
  // The page on screen wins: after moving from project A to project B with the panel open, the chip (and
  // what the next question is about) follows B, not the project "Ask GIDEON" was pressed on (bughunt G-BUG-1).
  const fromPage = pageContextOf(ref);
  if (explicit) return fromPage && (fromPage.projectId !== explicit.projectId || fromPage.taskId || fromPage.docId) ? fromPage : explicit;
  return fromPage;
}

function pageContextOf(ref: GideonPageRef | null): GideonContext | null {
  if (!ref) return null;
  if (ref.kind === "project") return { projectId: ref.id, projectName: ref.title };
  if (ref.kind === "task" && ref.projectId) return { projectId: ref.projectId, projectName: ref.projectName ?? "", taskId: ref.id, taskTitle: ref.title };
  if (ref.kind === "doc" && ref.projectId) return { projectId: ref.projectId, projectName: ref.projectName ?? "", docId: ref.id, docTitle: ref.title };
  return null;
}

function chipLabel(c: GideonContext): string {
  if (c.taskTitle) return c.taskTitle;
  if (c.docTitle) return c.docTitle;
  return c.projectName;
}

export function GideonPanel({ onClose, context, onClearContext, wide, onToggleWide, variant = "float", initialChatId = null, startNew = false }: {
  onClose?: () => void;
  /** The project/task GIDEON was explicitly opened about (project header "Ask GIDEON"). */
  context?: GideonContext | null;
  onClearContext?: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
  variant?: GideonPanelVariant;
  /** Open this conversation; null = the latest one (or a new one with `startNew`). */
  initialChatId?: string | null;
  startNew?: boolean;
}) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const router = useRouter();
  const name = useGideonName();
  const prefs = useGideonPrefs();
  const layout = useGideonLayout();
  const page = useGideonPage();
  const editorTarget = useGideonEditorTarget();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatId, setChatId] = useState<string | null>(startNew ? null : initialChatId);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  /** true = the next question starts a new conversation (New chat / ⌘O). */
  const [fresh, setFresh] = useState(startNew);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [input, setInputState] = useState(() => composerDraft);
  const setInput = useCallback((v: string) => { composerDraft = v; setInputState(v); }, []);
  const [busy, setBusy] = useState(false);
  /** A data URL, held only until the next message is sent. */
  const [image, setImage] = useState<string | null>(null);
  /** A picked document, held only until the next message is sent. Rides alongside an image, not instead of it. */
  const [doc, setDoc] = useState<GideonFile | null>(null);
  /** Why the last pick was refused before it was ever uploaded. Cleared by the next pick, or by sending. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!startNew);
  // A conversation that failed to load (QA 13 Oct 2026: the spinner stayed forever). Holds the id to retry.
  const [loadFailed, setLoadFailed] = useState<{ id: string | null; error: unknown } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  /** The page context chip was removed for this conversation. */
  const [pageDismissed, setPageDismissed] = useState(false);
  /** Pages added with "@". */
  const [refs, setRefs] = useState<GideonContextRef[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [tier, setTier] = useState<GideonTier>(() => {
    try {
      const saved = localStorage.getItem("gideon-tier");
      return (GIDEON_TIERS.some((x) => x.id === saved) ? saved : GIDEON_DEFAULT_TIER) as GideonTier;
    } catch {
      return GIDEON_DEFAULT_TIER;
    }
  });
  const [mode, setMode] = useState<GideonApprovalMode>(() => {
    try {
      const saved = localStorage.getItem("gideon-approval");
      return (GIDEON_APPROVAL_MODES.some((x) => x.id === saved) ? saved : GIDEON_DEFAULT_APPROVAL) as GideonApprovalMode;
    } catch {
      return GIDEON_DEFAULT_APPROVAL;
    }
  });
  /** Proposals waiting for this person that no turn on screen shows (e.g. from an @GIDEON comment or AI Autofill). */
  const [waiting, setWaiting] = useState<GideonProposal[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Every blob: handle minted for a chip on a turn sent in this session, so all of them can go at once. */
  const localUrls = useRef<string[]>([]);

  const pageContext = pageDismissed ? null : contextOf(page, context);
  // A removed chip stays removed for this page only; another page brings its own chip back.
  const pageKey = page ? `${page.kind}:${page.id}` : "";
  const firstPageKey = useRef(pageKey);
  useEffect(() => { if (pageKey !== firstPageKey.current) { firstPageKey.current = pageKey; setPageDismissed(false); } }, [pageKey]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useEffect(() => () => {
    abortRef.current?.abort();
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    localUrls.current = [];
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, [pageContext?.projectId, chatId, fresh]);
  useEffect(() => {
    if (prefs) return;
    getGideonPrefs().then(setCachedGideonPrefs).catch(() => undefined);
  }, [prefs]);

  /** Load a conversation (null = the latest). A turn typed before it lands wins over the late response. */
  const openChat = useCallback((id: string | null) => {
    abortRef.current?.abort();
    setView("chat");
    setFresh(false);
    setLoading(true);
    setLoadFailed(null);
    setTurns([]);
    setRefs([]);
    setPageDismissed(false);
    let cancelled = false;
    Promise.all([
      loadGideonHistory(id, (chat) => { if (!cancelled) { setChatId(chat?.id ?? null); setChatTitle(chat?.title ?? null); } }),
      pendingGideonProposals().catch(() => ({ proposals: [] as GideonProposal[] })),
    ]).then(([rows, pending]) => {
      if (cancelled) return;
      const restored = rows.map(fromHistory);
      setTurns((cur) => (cur.length ? cur : restored));
      const shown = new Set(restored.flatMap((r) => (r.proposals ?? []).map((p) => p.id)));
      setWaiting(pending.proposals.filter((p) => !shown.has(p.id)));
      setLoading(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setLoadFailed({ id, error });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (startNew) {
      pendingGideonProposals().then((p) => setWaiting(p.proposals)).catch(() => undefined);
      return;
    }
    return openChat(initialChatId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setChatId(null);
    setChatTitle(null);
    setFresh(true);
    setView("chat");
    setRefs([]);
    setPageDismissed(false);
    setLoading(false);
    setBusy(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // ⌘/Ctrl+O inside the panel = New chat (the launcher handles it when the panel is closed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        // GIDEON's own box takes it; a field or editor elsewhere on the page keeps the key (QA B32).
        if (e.defaultPrevented) return;
        if (isEditableTarget(e.target) && e.target !== inputRef.current) return;
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  const clearHistory = async () => {
    setConfirmClear(false);
    setTurns([]);
    setChatId(null);
    setChatTitle(null);
    setFresh(true);
    await clearGideonHistory();
  };

  const attachDocument = (picked: File) => {
    if (!isAcceptedGideonFile(picked.name)) { setAttachError(t("GIDEON can't read that file type yet.")); return; }
    if (picked.size > GIDEON_MAX_FILE_BYTES) { setAttachError(t("That file is too big. 10 MB at most.")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { setAttachError(t("Couldn't read that file.")); return; }
      setAttachError(null);
      setDoc({ name: picked.name, type: picked.type || "", data: reader.result });
    };
    reader.onerror = () => setAttachError(t("Couldn't read that file."));
    reader.readAsDataURL(picked);
  };

  /** Patch the last (assistant) turn. */
  const patchLast = (fn: (turn: ChatTurn) => ChatTurn) =>
    setTurns((cur) => {
      const next = [...cur];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = fn(last);
      return next;
    });

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setMention(null);
    setAttachError(null);
    const history: GideonMessage[] = [...turns.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];

    const sent: GideonAttachment[] = [];
    if (image) {
      const held = holdLocalFile(image);
      if (held) sent.push({ kind: "image", url: held.url, name: "", mime: held.mime, size: held.size });
    }
    if (doc) {
      const held = holdLocalFile(doc.data);
      if (held) sent.push({ kind: "document", url: held.url, name: doc.name, mime: doc.type || held.mime, size: held.size });
    }
    localUrls.current.push(...sent.map((a) => a.url));

    setTurns((cur) => [...cur, { role: "user", content: text, attachments: sent }, { role: "assistant", content: "", streaming: true, steps: [], sources: [], cards: [], proposals: [] }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    let wroteSomething = false;
    let liveChatId: string | null = fresh ? null : chatId;
    const startFresh = fresh || !chatId;

    await streamGideon(history, (ev) => {
      switch (ev.type) {
        case "chat":
          liveChatId = ev.id;
          setChatId(ev.id);
          setChatTitle((cur) => cur ?? ev.title ?? null);
          setFresh(false);
          break;
        case "run":
          patchLast((x) => ({ ...x, runId: ev.id }));
          break;
        case "delta":
        case "text":
          acc += ev.content;
          patchLast((x) => ({ ...x, content: acc }));
          break;
        case "reset":
          acc = "";
          patchLast((x) => ({ ...x, content: "" }));
          break;
        case "final":
          acc = ev.content;
          patchLast((x) => ({ ...x, content: acc }));
          break;
        case "step":
          patchLast((x) => {
            const steps = [...(x.steps ?? [])];
            const i = steps.findIndex((s) => s.id === ev.step.id);
            if (i >= 0) steps[i] = ev.step; else steps.push(ev.step);
            return { ...x, steps };
          });
          break;
        case "sources":
          patchLast((x) => {
            const sources = [...(x.sources ?? [])];
            for (const r of ev.sources) if (!sources.some((s) => s.kind === r.kind && s.id === r.id)) sources.push(r);
            return { ...x, sources };
          });
          break;
        case "cited":
          // The server's final word on what the answer used: replaces everything the tools read.
          patchLast((x) => ({ ...x, sources: ev.sources }));
          break;
        case "card":
          wroteSomething = true;
          patchLast((x) => ({ ...x, cards: [...(x.cards ?? []), ev.card] }));
          break;
        case "proposal":
          patchLast((x) => {
            const proposals = [...(x.proposals ?? [])];
            const i = proposals.findIndex((p) => p.id === ev.proposal.id);
            if (i >= 0) proposals[i] = ev.proposal; else proposals.push(ev.proposal);
            return { ...x, proposals };
          });
          break;
        case "error":
          patchLast((x) => ({ ...x, failed: true, content: acc ? `${acc}\n\n${ev.content ?? ""}` : ev.content ?? t("Something went wrong.") }));
          break;
      }
    }, {
      signal: controller.signal, model: tier, image, file: doc, approvalMode: mode, context: pageContext, refs,
      chatId: startFresh ? null : chatId, newChat: startFresh,
    }).catch(() => {
      if (controller.signal.aborted) return;
      // The connection dropped mid-answer (a network change, a laptop waking up). The server keeps
      // working and saves the answer to the chat, so fetch it from there instead of leaving an error
      // on screen (audit, 12 Oct 2026).
      patchLast((x) => ({ ...x, failed: true, content: x.content || t("The connection dropped. Getting the answer…") }));
      const id = liveChatId;
      if (!id) return;
      let tries = 0;
      const poll = () => {
        if (controller.signal.aborted || abortRef.current !== controller) return;
        void loadGideonHistory(id).catch(() => []).then((rows) => {
          const last = rows[rows.length - 1];
          if (last && last.role === "assistant" && last.content?.trim()) setTurns(rows.map(fromHistory));
          else if (++tries < 12) window.setTimeout(poll, 5000);
          else patchLast((x) => ({ ...x, failed: true, content: t("GIDEON can't be reached right now. Try again in a moment.") }));
        });
      };
      window.setTimeout(poll, 3000);
    });
    setImage(null);
    setDoc(null);
    patchLast((x) => ({ ...x, streaming: false, steps: (x.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "done" } : s)) }));
    setBusy(false);
    if (wroteSomething) qc.invalidateQueries({ queryKey: ["nexus"] });
    qc.invalidateQueries({ queryKey: ["gideon-chats"] });
  };

  const onDecided = (p: GideonProposal) => {
    setTurns((cur) => cur.map((x) => (x.proposals?.some((q) => q.id === p.id) ? { ...x, proposals: x.proposals.map((q) => (q.id === p.id ? p : q)) } : x)));
    setWaiting((cur) => cur.map((q) => (q.id === p.id ? p : q)));
    if (p.status === "APPLIED") qc.invalidateQueries({ queryKey: ["nexus"] });
  };

  const suggestions = useMemo(() => {
    const c = pageContext;
    if (c?.docId) return [t("Summarize this page"), t("Find the action items in this page"), t("What questions does this page leave open?")];
    if (c?.taskId) return [t("What's the latest on this task?"), t("Break this task into subtasks"), t("Draft a status comment for this task")];
    if (c) return [
      t("Summarize where {name} stands this week", { name: c.projectName }),
      t("What's overdue in {name}, and who owns it?", { name: c.projectName }),
      t("Turn the next steps of {name} into tasks", { name: c.projectName }),
    ];
    return [t("What's overdue for me?"), t("Summarize my week across projects"), t("What did my team decide recently? Cite the sources.")];
  }, [pageContext, t]);

  const modeDef = GIDEON_APPROVAL_MODES.find((m) => m.id === mode) ?? GIDEON_APPROVAL_MODES[1];
  const openWaiting = waiting.filter((p) => p.status === "PENDING" || p.status === "APPLYING");
  // Changes waiting from elsewhere (an @GIDEON comment, AI Autofill) stay folded once a conversation is going.
  const [waitingOpen, setWaitingOpen] = useState<boolean | null>(null);
  const waitingShown = waitingOpen ?? turns.length === 0;

  // "@" in the composer: the word after it is a search for a page to attach.
  const onInputChange = (value: string, caret: number) => {
    setInput(value);
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,40})$/.exec(before);
    setMention(m ? { query: m[2], start: caret - m[2].length - 1 } : null);
  };
  const addRef = (r: GideonContextRef) => {
    setRefs((cur) => (cur.some((x) => x.kind === r.kind && x.id === r.id) ? cur : [...cur, r].slice(0, 8)));
    if (mention) {
      const caret = inputRef.current?.selectionStart ?? input.length;
      setInput(input.slice(0, mention.start) + input.slice(caret));
    }
    setMention(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const startMention = () => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const pre = input.slice(0, caret);
    const next = `${pre}${pre && !/\s$/.test(pre) ? " " : ""}@${input.slice(caret)}`;
    setInput(next);
    const at = next.length - input.slice(caret).length;
    setMention({ query: "", start: at - 1 });
    window.setTimeout(() => { el?.focus(); el?.setSelectionRange(at, at); }, 0);
  };

  const isPage = variant === "page";
  const root = cn(
    "flex h-full w-full flex-col overflow-hidden bg-card",
    variant === "float" && "rounded-3xl border border-border shadow-pop",
    variant === "side" && "border-l border-border",
  );

  const header = (
    <div className="flex items-center gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-muted text-foreground"><GideonMark className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">{chatTitle && !fresh ? chatTitle : t("Acts in NEXUS as you")}</div>
      </div>
      {!isPage && (
        <button type="button" onClick={() => setView((v) => (v === "history" ? "chat" : "history"))} title={t("Chat history")} aria-label={t("Chat history")} aria-pressed={view === "history"} className={cn("rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", view === "history" && "bg-accent text-foreground")}>
          <History className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={newChat} title={t("New chat ({keys})", { keys: modKey("O") })} aria-label={t("New chat")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><SquarePen className="h-4 w-4" /></button>
      <span className="hidden sm:contents" title={GIDEON_TIERS.find((x) => x.id === tier)?.blurb}>
        <SelectPicker
          variant="field"
          size="sm"
          align="end"
          value={tier}
          onChange={(v) => {
            const next = v as GideonTier;
            setTier(next);
            try { localStorage.setItem("gideon-tier", next); } catch { /* private mode */ }
          }}
          ariaLabel={t("GIDEON tier")}
          options={GIDEON_TIERS.map((x) => ({ value: x.id, label: x.name }))}
          className="h-7 px-2 text-[11px] font-semibold text-muted-foreground"
        />
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t("More")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setPersonalizeOpen(true)}><UserRound className="mr-2 h-4 w-4" />{t("Personalize")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">{t("Open as")}</DropdownMenuLabel>
          {!isPage && (
            <DropdownMenuItem onSelect={() => setGideonLayout(layout === "side" ? "float" : "side")}>
              {layout === "side" ? <Minimize2 className="mr-2 h-4 w-4" /> : <PanelRight className="mr-2 h-4 w-4" />}{layout === "side" ? t("Floating window") : t("Side panel")}
            </DropdownMenuItem>
          )}
          {!isPage && variant === "float" && onToggleWide && (
            <DropdownMenuItem onSelect={onToggleWide}><Maximize2 className="mr-2 h-4 w-4" />{wide ? t("Narrow") : t("Widen")}</DropdownMenuItem>
          )}
          {!isPage && (
            <DropdownMenuItem onSelect={() => { onClose?.(); router.history.push(chatId && !fresh ? `/gideon?chat=${chatId}` : "/gideon"); }}>
              <ExternalLink className="mr-2 h-4 w-4" />{t("Full page")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {chatId && !fresh && (
            <DropdownMenuItem onSelect={() => setConfirmDelete(true)}>
              <Trash2 className="mr-2 h-4 w-4" />{t("Delete this chat")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => !busy && setConfirmClear(true)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />{t("Clear all chat history")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onClose && !isPage && <button type="button" onClick={onClose} aria-label={t("Close GIDEON")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>}
    </div>
  );

  const body = view === "history" && !isPage ? (
    <ChatHistoryList activeId={fresh ? null : chatId} onPick={(id) => openChat(id)} onNew={newChat} />
  ) : (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
      <div className={cn("mx-auto w-full space-y-4", isPage && "max-w-3xl")}>
        {openWaiting.length > 0 && (
          <section className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
            <button type="button" onClick={() => setWaitingOpen((v) => !v)} aria-expanded={waitingShown} className="flex w-full items-center gap-1.5 text-left text-xs font-semibold text-amber-700 dark:text-amber-400">
              <ShieldCheck className="h-3.5 w-3.5" /><span className="flex-1">{L.tn(openWaiting.length, "1 change is waiting for your approval", "{n} changes are waiting for your approval")}</span>
              {waitingShown ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {waitingShown && openWaiting.map((p) => <ProposalCard key={p.id} proposal={p} onDecided={onDecided} />)}
          </section>
        )}
        {loading && turns.length === 0 && (
          <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}
        {!loading && turns.length === 0 && loadFailed && (
          <LoadError compact error={loadFailed.error} what={t("this conversation")} onRetry={() => openChat(loadFailed.id)}
            notFoundTitle={t("This conversation doesn't exist any more")} notFoundMessage={t("It was deleted, or the link is wrong. Start a new chat below.")} />
        )}
        {!loading && turns.length === 0 && !loadFailed && (
          <div className={cn("flex flex-col items-center justify-center text-center", isPage ? "pt-[12vh]" : "pt-8")}>
            <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-background"><GideonMark className="h-7 w-7 text-foreground/80" /></span>
            <p className={cn("font-bold tracking-tight", isPage ? "text-2xl" : "text-base")}>
              {pageContext ? t("Ask {assistant} about {name}", { assistant: name, name: chipLabel(pageContext) }) : t("What can {assistant} do for you?", { assistant: name })}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t("It searches and reads your projects, tasks, docs and chats with your access only, and shows what it read.")}</p>
            <div className="mt-5 flex w-full max-w-md flex-col gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-xl border border-border bg-background px-3 py-2 text-left text-xs font-medium transition-colors hover:border-primary/40 hover:bg-accent">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => turn.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
              {turn.attachments && turn.attachments.length > 0 && (
                <div className="mb-1.5 flex flex-col gap-2">
                  {turn.attachments.map((a, j) => <GideonAttachmentChip key={j} kind={a.kind} name={a.name} src={a.kind === "image" ? a.url : undefined} link={gideonAttachmentLink(a)} onBubble />)}
                </div>
              )}
              <span className="whitespace-pre-wrap">{turn.content}</span>
            </div>
          </div>
        ) : (
          <AssistantTurn
            key={i}
            turn={turn}
            onDecided={onDecided}
            question={turns[i - 1]?.role === "user" ? turns[i - 1].content : ""}
            projectId={pageContext?.projectId ?? refs.find((r) => r.kind === "project")?.id ?? null}
            editorTarget={editorTarget}
          />
        ))}
      </div>
    </div>
  );

  const composer = view === "chat" || isPage ? (
    <div className="border-t border-border p-3">
      <div className={cn("relative mx-auto w-full", isPage && "max-w-3xl")}>
        {mention && <MentionPicker query={mention.query} onPick={addRef} onClose={() => setMention(null)} />}
        {(pageContext || refs.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {pageContext && (
              <ContextChip
                icon={pageContext.docId ? FileText : pageContext.taskId ? ListChecks : FolderKanban}
                label={pageContext.taskTitle ? `${pageContext.projectName} › ${pageContext.taskTitle}` : chipLabel(pageContext)}
                hint={t("The page you're on")}
                onRemove={() => { if (context && onClearContext) onClearContext(); setPageDismissed(true); }}
              />
            )}
            {refs.map((r) => (
              <ContextChip key={`${r.kind}-${r.id}`} icon={r.kind === "doc" ? FileText : r.kind === "task" ? ListChecks : FolderKanban} label={r.title} onRemove={() => setRefs((cur) => cur.filter((x) => !(x.kind === r.kind && x.id === r.id)))} />
            ))}
          </div>
        )}
        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-muted/40 focus-within:border-primary/50">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (mention && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                window.dispatchEvent(new CustomEvent("gideon-mention-key", { detail: e.key }));
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            placeholder={t("Ask anything. Type @ to add a page")}
            rows={isPage ? 3 : 2}
            className="w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {(image || doc) && (
            <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2">
              {image && <GideonAttachmentChip kind="image" src={image} onRemove={() => setImage(null)} />}
              {doc && <GideonAttachmentChip kind="document" name={doc.name} onRemove={() => setDoc(null)} />}
            </div>
          )}
          {attachError && <div className="border-t border-border/60 px-3 py-2 text-xs font-semibold text-destructive">{attachError}</div>}
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
              reader.readAsDataURL(file);
            }} />
            <input ref={fileInput} type="file" accept={GIDEON_FILE_ACCEPT} className="hidden" onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) attachDocument(picked);
            }} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title={t("Add")} aria-label={t("Add photos, files or pages")} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Plus className="h-4 w-4" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onSelect={() => imageInput.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />{t("Add a photo")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Paperclip className="mr-2 h-4 w-4" />{t("Add a file (PDF, Word, Excel, text…)")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.setTimeout(startMention, 0)}><AtSign className="mr-2 h-4 w-4" />{t("Add a page, task or project")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title={t(modeDef.blurb)}>
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t(modeDef.name)}</span><ChevronDown className="h-3 w-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-xs">{t("Before GIDEON changes something")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {GIDEON_APPROVAL_MODES.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => { setMode(m.id); try { localStorage.setItem("gideon-approval", m.id); } catch { /* private mode */ } }}
                    className="flex items-start gap-2 py-2"
                  >
                    <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", m.id === mode ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t(m.name)}</span>
                      <span className="block text-xs text-muted-foreground">{t(m.blurb)}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              aria-label={t("Send")}
              className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      lang={L.lang}
      className={root}
      onKeyDown={(e) => {
        // Esc closes the floating/side panel (Notion AI), unless something inside used it first (a menu, the @ picker).
        if (e.key !== "Escape" || e.defaultPrevented || isPage || !onClose || mention) return;
        // Menus and dialogs are portals: their keys bubble here through React but are not inside the panel.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (view === "history") { setView("chat"); e.preventDefault(); return; }
        e.preventDefault();
        onClose();
      }}
    >
      {header}
      {isPage ? (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-72 shrink-0 flex-col border-r border-border md:flex">
            <ChatHistoryList activeId={fresh ? null : chatId} onPick={(id) => { openChat(id); router.history.replace(`/gideon?chat=${id}`); }} onNew={() => { newChat(); router.history.replace("/gideon"); }} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">{body}{composer}</div>
        </div>
      ) : (
        <>{body}{composer}</>
      )}

      <PersonalizeDialog open={personalizeOpen} onOpenChange={setPersonalizeOpen} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this chat?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("The conversation and its attached files are deleted for good. Tasks and docs GIDEON made stay.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const id = chatId; if (id) void deleteGideonChat(id).then(() => { qc.invalidateQueries({ queryKey: ["gideon-chats"] }); newChat(); }).catch(() => toast.error(t("Couldn't delete this chat."))); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Clear every GIDEON chat?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Every conversation, message and attached file is deleted for good. Tasks and docs GIDEON made stay.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clearHistory()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Clear history")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContextChip({ icon: Icon, label, hint, onRemove }: { icon: typeof FileText; label: string; hint?: string; onRemove?: () => void }) {
  const { t } = useLang();
  return (
    <span title={hint} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="max-w-[16rem] truncate">{label}</span>
      {onRemove && <button type="button" onClick={onRemove} aria-label={t("Remove this context")} className="-mr-1 rounded-full p-0.5 hover:bg-accent hover:text-foreground"><X className="h-3 w-3" /></button>}
    </span>
  );
}

type PickItem = GideonContextRef & { sub: string | null };

/** Pages to attach with "@": projects, tasks and docs from the normal search (the person's own access). */
function MentionPicker({ query, onPick, onClose }: { query: string; onPick: (r: GideonContextRef) => void; onClose: () => void }) {
  const { t } = useLang();
  const [items, setItems] = useState<PickItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      nexusApi.search(q).then((res) => {
        if (!alive) return;
        // Same-named tasks/docs are told apart by their project; the closest title match comes first and
        // "Untitled" pages only show up when that is what was typed (bughunt G-BUG-4).
        const lower = q.toLowerCase();
        const untitled = (title: string) => !title || title === "Untitled";
        const next: PickItem[] = [
          ...(res.projects ?? []).slice(0, 4).map((p) => ({ kind: "project" as const, id: p.id, title: p.name, sub: null })),
          ...(res.docs ?? []).filter((d) => !untitled(d.title) || "untitled".startsWith(lower)).slice(0, 4).map((d) => ({ kind: "doc" as const, id: d.id, title: docTitle(d.title), sub: d.project?.name ?? null })),
          ...(res.tasks ?? []).slice(0, 6).map((x) => ({ kind: "task" as const, id: x.id, title: x.title, sub: x.taskList?.project?.name ?? null })),
        ];
        const score = (title: string) => { const s = title.toLowerCase(); return s === lower ? 3 : s.startsWith(lower) ? 2 : s.includes(lower) ? 1 : 0; };
        next.sort((a, b) => score(b.title) - score(a.title));
        setItems(next);
        setIndex(0);
      }).catch(() => alive && setItems([])).finally(() => alive && setLoading(false));
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    const onKey = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === "Escape") onClose();
      else if (key === "ArrowDown") setIndex((i) => (items.length ? (i + 1) % items.length : 0));
      else if (key === "ArrowUp") setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      else if ((key === "Enter" || key === "Tab") && items[index]) onPick({ kind: items[index].kind, id: items[index].id, title: items[index].title });
      else if (key === "Enter" || key === "Tab") onClose();
    };
    window.addEventListener("gideon-mention-key", onKey);
    return () => window.removeEventListener("gideon-mention-key", onKey);
  }, [items, index, onPick, onClose]);
  return (
    <div role="listbox" aria-label={t("Add a page, task or project")} className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-pop">
      <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">{t("Add context")}</div>
      {!query.trim() && <div className="px-2 pb-2 text-xs text-muted-foreground">{t("Type to search projects, tasks and docs you can see.")}</div>}
      {query.trim() && loading && items.length === 0 && <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t("Searching…")}</div>}
      {query.trim() && !loading && items.length === 0 && <div className="px-2 pb-2 text-xs text-muted-foreground">{t("Nothing you can see matches “{q}”.", { q: query })}</div>}
      {items.map((r, i) => {
        const Icon = r.kind === "doc" ? FileText : r.kind === "task" ? ListChecks : FolderKanban;
        return (
          <button key={`${r.kind}-${r.id}`} type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick({ kind: r.kind, id: r.id, title: r.title })} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === index ? "bg-muted" : "hover:bg-muted/60")}>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.title}</span>
              {r.sub && <span className="block truncate text-[11px] text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.kind === "doc" ? t("Doc") : r.kind === "task" ? t("Task") : t("Project")}</span>
          </button>
        );
      })}
    </div>
  );
}

function dayBucket(iso: string): "today" | "yesterday" | "week" | "older" {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return "today";
  if (d.getTime() >= start - 86_400_000) return "yesterday";
  if (d.getTime() >= start - 7 * 86_400_000) return "week";
  return "older";
}

/** The conversation list with search (Notion AI "Chats"). */
export function ChatHistoryList({ activeId, onPick, onNew }: { activeId: string | null; onPick: (id: string) => void; onNew: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<GideonChatRow[] | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<GideonChatRow | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = window.setTimeout(() => setDebounced(q), 220); return () => window.clearTimeout(h); }, [q]);
  useEffect(() => {
    let alive = true;
    // A failed list is not "No chats yet" (QA 13 Oct 2026). Keeps the last rows it had.
    listGideonChats(debounced).then((r) => { if (alive) { setRows(r.chats); setListError(null); } }).catch((e: unknown) => { if (alive) { setListError(e); setRows((cur) => cur ?? []); } });
    return () => { alive = false; };
  }, [debounced, tick, activeId]);
  // Other places (sending a message) invalidate "gideon-chats"; follow along.
  useEffect(() => qc.getQueryCache().subscribe((e) => { if (e.query.queryKey[0] === "gideon-chats" && e.type === "removed") setTick((x) => x + 1); }), [qc]);
  useEffect(() => { const h = window.setInterval(() => setTick((x) => x + 1), 30_000); return () => window.clearInterval(h); }, []);
  const groups: Array<{ key: string; label: string; items: GideonChatRow[] }> = [
    { key: "today", label: t("Today"), items: [] },
    { key: "yesterday", label: t("Yesterday"), items: [] },
    { key: "week", label: t("Previous 7 days"), items: [] },
    { key: "older", label: t("Older"), items: [] },
  ];
  for (const r of rows ?? []) groups.find((g) => g.key === dayBucket(r.updatedAt))!.items.push(r);
  const saveRename = async () => {
    if (!renaming?.title.trim()) { setRenaming(null); return; }
    await renameGideonChat(renaming.id, renaming.title).catch(() => toast.error(t("Couldn't rename this chat.")));
    setRenaming(null);
    setTick((x) => x + 1);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 p-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-primary/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search chats")} aria-label={t("Search chats")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </label>
        <button type="button" onClick={onNew} title={t("New chat ({keys})", { keys: modKey("O") })} aria-label={t("New chat")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border hover:bg-accent"><SquarePen className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {rows === null && <div className="grid h-24 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
        {listError != null && (rows ?? []).length === 0 && <LoadError compact error={listError} what={t("your chats")} onRetry={() => setTick((x) => x + 1)} />}
        {rows !== null && rows.length === 0 && listError == null && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 h-5 w-5" />
            {debounced ? t("No chat mentions “{q}”.", { q: debounced }) : t("No chats yet. Ask something to start one.")}
          </div>
        )}
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.key} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{g.label}</div>
            {g.items.map((r) => (
              <div key={r.id} className={cn("group flex items-center gap-1 rounded-lg", r.id === activeId ? "bg-accent" : "hover:bg-accent/60")}>
                {renaming?.id === r.id ? (
                  <input autoFocus value={renaming.title} onChange={(e) => setRenaming({ id: r.id, title: e.target.value })} onBlur={() => void saveRename()} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(); if (e.key === "Escape") { e.preventDefault(); setRenaming(null); } }} className="m-1 min-w-0 flex-1 rounded-md border border-primary/50 bg-background px-2 py-1 text-sm outline-none" />
                ) : (
                  <button type="button" onClick={() => onPick(r.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                    <span className="block truncate text-sm">{r.title || t("Untitled chat")}</span>
                    {r.match && <span className="block truncate text-[11px] text-muted-foreground">{r.match}</span>}
                  </button>
                )}
                {renaming?.id !== r.id && (
                  <span className="flex shrink-0 opacity-0 pointer-coarse:opacity-100! transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => setRenaming({ id: r.id, title: r.title ?? "" })} aria-label={t("Rename")} className="rounded-md p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setDeleting(r)} aria-label={t("Delete this chat")} className="rounded-md p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this chat?")}</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.title ? `“${deleting.title}”. ` : ""}{t("The conversation and its attached files are deleted for good. Tasks and docs GIDEON made stay.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const r = deleting;
                setDeleting(null);
                if (!r) return;
                setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
                void deleteGideonChat(r.id).then(() => { setTick((x) => x + 1); if (r.id === activeId) onNew(); }).catch(() => { toast.error(t("Couldn't delete this chat.")); setTick((x) => x + 1); });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Personalize (Notion AI): what this person calls GIDEON + their own standing instructions. */
function PersonalizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLang();
  const prefs = useGideonPrefs();
  const [nameValue, setNameValue] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setNameValue(prefs?.assistantName ?? "");
    setInstructions(prefs?.instructions ?? "");
  }, [open, prefs]);
  const save = async () => {
    setSaving(true);
    try {
      setCachedGideonPrefs(await saveGideonPrefs({ assistantName: nameValue.trim() || null, instructions: instructions.trim() || null }));
      toast.success(t("Saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't save."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Personalize GIDEON")}</DialogTitle>
          <DialogDescription>{t("Only for you. GIDEON still acts with your access and nothing more.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold">{t("What do you call it?")}</span>
            <input value={nameValue} maxLength={40} onChange={(e) => setNameValue(e.target.value)} placeholder="GIDEON" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold">{t("Instructions")}</span>
            <span className="block text-[11px] text-muted-foreground">{t("How you like answers: language, length, tone, what to focus on. Applied to every chat of yours.")}</span>
            <textarea value={instructions} maxLength={2000} rows={6} onChange={(e) => setInstructions(e.target.value)} placeholder={t("e.g. Answer in Indonesian, short bullet points. I lead the Atlas launch, so flag anything that blocks it.")} className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <span className="mt-0.5 block text-right text-[10px] tabular-nums text-muted-foreground">{instructions.length}/2000</span>
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">{t("Cancel")}</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Save")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Save as doc": a new page in a project the person can add pages to (default: the chat's project). */
function SaveAsDocButton({ markdown, question, projectId }: { markdown: string; question: string; projectId: string | null }) {
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [find, setFind] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  const title = (question.split("\n")[0] || t("GIDEON answer")).slice(0, 120);
  const save = async (pid: string) => {
    setSaving(true);
    try {
      const { doc } = await saveGideonAnswerAsDoc(pid, title, markdown);
      setOpen(false);
      toast.success(t("Saved as a doc"), { action: { label: t("Open"), onClick: () => router.history.push(doc.url) } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't save."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <DropdownMenu open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFind(""); else window.setTimeout(() => findRef.current?.focus(), 30); if (v && !projects) nexusApi.projects().then((p) => setProjects(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => setProjects([])); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <FilePlus2 className="h-3 w-3" />}{t("Save as doc")}
        </button>
      </DropdownMenuTrigger>
      {/* Opens above the button (the answer stays readable) with a search box: people can be in 90+ projects (bughunt G-BUG-3). */}
      <DropdownMenuContent align="start" side="top" collisionPadding={12} className="flex max-h-80 w-72 flex-col overflow-hidden p-0">
        <div className="border-b border-border p-1.5">
          <DropdownMenuLabel className="px-1.5 pb-1 pt-0.5 text-xs">{t("Save into project")}</DropdownMenuLabel>
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-primary/50">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={findRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              // The menu's type-ahead would steal the letters; arrows/Enter/Esc still drive the menu.
              onKeyDown={(e) => { if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(e.key)) e.stopPropagation(); }}
              placeholder={t("Search projects")}
              aria-label={t("Search projects")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {projectId && !find.trim() && <DropdownMenuItem onSelect={() => void save(projectId)}><FolderKanban className="mr-2 h-4 w-4" />{t("This project")}</DropdownMenuItem>}
          {projects === null && <div className="px-2 py-2 text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /></div>}
          {(() => {
            const q = find.trim().toLowerCase();
            const list = (projects ?? []).filter((p) => (q ? p.name.toLowerCase().includes(q) : p.id !== projectId));
            if (projects && q && list.length === 0) return <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No project matches “{q}”.", { q: find.trim() })}</div>;
            return list.slice(0, 60).map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => void save(p.id)}><span className="truncate">{p.name}</span></DropdownMenuItem>
            ));
          })()}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function AssistantTurn({ turn, onDecided, question, projectId, editorTarget }: {
  turn: ChatTurn;
  onDecided: (p: GideonProposal) => void;
  question: string;
  projectId: string | null;
  editorTarget: ReturnType<typeof useGideonEditorTarget>;
}) {
  const L = useLang();
  const { t } = L;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // A step that failed on its arguments and was retried (the same tool succeeded later) is GIDEON's own
  // detour, not something the person must know about: hidden here, still in the run log (Insights).
  const allSteps = turn.steps ?? [];
  const steps = turn.streaming ? allSteps : allSteps.filter((s, i) => s.status !== "error" || !(/\bis required\b/i.test(s.error ?? "") || allSteps.slice(i + 1).some((x) => x.tool === s.tool && x.status === "done")));
  const running = steps.filter((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "error").length;
  // Only what the answer names (the server already filters new turns; older saved turns are filtered here).
  const sources = useMemo(() => citedSources(turn.content, turn.sources ?? []), [turn.content, turn.sources]);
  const cards = turn.cards ?? [];
  const proposals = turn.proposals ?? [];
  const showSteps = turn.streaming || open;

  return (
    <div className="group flex flex-col gap-2">
      {steps.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <button type="button" onClick={() => setOpen((v) => !v)} disabled={turn.streaming} className="inline-flex items-center gap-1 rounded-md py-0.5 font-medium hover:text-foreground disabled:cursor-default">
            {turn.streaming && running.length > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {turn.streaming && running.length > 0 ? stepText(running[running.length - 1], t) : L.tn(steps.length, "1 step", "{n} steps")}
            {!turn.streaming && failed > 0 && <span className="text-destructive">· {L.tn(failed, "1 failed", "{n} failed")}</span>}
          </button>
          {showSteps && (
            <ol className="mt-1 space-y-0.5 border-l border-border pl-3">
              {steps.map((s) => (
                <li key={s.id} className="flex items-start gap-1.5">
                  {s.status === "running" ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" /> : s.status === "error" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" /> : <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  <span className="min-w-0">{stepText(s, t)}{s.status === "error" && s.error ? <span className="block text-destructive/80">{s.error}</span> : null}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {(turn.content || (turn.streaming && !steps.length)) && (
        <div className={cn("max-w-full rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", turn.failed ? "border border-destructive/30 bg-destructive/5" : "bg-muted")}>
          {turn.content ? <GideonMarkdown text={turn.content} sources={turn.sources} /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => <ProposalCard key={p.id} proposal={p} onDecided={onDecided} />)}
        </div>
      )}

      {cards.length > 0 && (
        <div className="space-y-1.5">
          {cards.map((c, j) => <ResultCard key={`${c.id}-${j}`} card={c} />)}
        </div>
      )}

      {sources.length > 0 && !turn.streaming && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">{t("Sources")}</span>
          {sources.slice(0, 8).map((r, n) => <SourceChip key={`${r.kind}-${r.id}`} source={r} n={n + 1} />)}
          {sources.length > 8 && <span className="text-[11px] text-muted-foreground">{t("+{n} more", { n: sources.length - 8 })}</span>}
        </div>
      )}

      {!turn.streaming && turn.content && !turn.failed && (
        <div className="flex flex-wrap gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(turn.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? t("Copied") : t("Copy")}
          </button>
          {editorTarget && (
            <button
              type="button"
              onClick={() => { editorTarget.insert(markdownToDoc(turn.content)); toast.success(t("Inserted into the page")); }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowDownToLine className="h-3 w-3" />{t("Insert into page")}
            </button>
          )}
          <SaveAsDocButton markdown={turn.content} question={question} projectId={projectId} />
        </div>
      )}
    </div>
  );
}

function useGo() {
  const router = useRouter();
  return (path: string) => router.history.push(path);
}

function SourceChip({ source, n }: { source: GideonRef; n?: number }) {
  const go = useGo();
  const Icon = source.kind === "project" ? FolderKanban : source.kind === "doc" ? FileText : source.kind === "comment" ? MessageSquare : source.kind === "message" ? MessageCircle : source.kind === "form" ? ClipboardList : ListChecks;
  return (
    <a
      href={source.url}
      onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(source.url); }}
      className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
      title={source.excerpt ? `${source.title}\n${source.excerpt}` : source.title}
    >
      {n ? <span className="tabular-nums text-muted-foreground">{n}</span> : null}
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="truncate">{source.title}</span>
    </a>
  );
}

function ResultCard({ card }: { card: GideonCard }) {
  const { t, locale } = useLang();
  const go = useGo();
  const verb = card.action === "created" ? (card.kind === "doc" ? t("Doc created") : t("Task created")) : card.action === "updated" ? t("Task updated") : t("Comment added");
  const Icon = card.kind === "doc" ? FileText : card.kind === "comment" ? MessageSquare : ListChecks;
  const due = card.dueDate ? new Date(card.dueDate).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }) : null;
  return (
    <a
      href={card.url}
      onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(card.url); }}
      className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{verb}</span>
        <span className="block truncate text-sm font-semibold">{card.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {[card.projectName, card.status ? t(STATUS_WORD[card.status] ?? card.status) : null, due, card.assignees?.length ? card.assignees.join(", ") : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

const FIELD_WORD: Record<string, string> = {
  Title: "Title", Section: "Section", Status: "Status", Priority: "Priority", Due: "Due", Assignees: "Assignees",
  Description: "Description", Comment: "Comment", Body: "Body", "Custom fields": "Custom fields",
};

function ProposalCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t } = useLang();
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (d: "apply" | "discard") => {
    setPending(d);
    setError(null);
    try {
      onDecided(await decideGideonProposal(proposal.id, d));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't do that."));
    } finally {
      setPending(null);
    }
  };
  const title = proposal.action === "create_task" ? t("Create a task") : proposal.action === "update_task" ? t("Change a task") : proposal.action === "add_task_comment" ? t("Post a comment") : proposal.action === "create_document" ? t("Write a doc") : proposal.action;
  const open = proposal.status === "PENDING";
  const statusLine =
    proposal.status === "APPLIED" ? t("Applied") :
    proposal.status === "DISCARDED" ? t("Discarded") :
    proposal.status === "FAILED" ? t("Couldn't apply: {reason}", { reason: proposal.error ?? "" }) :
    proposal.status === "APPLYING" ? t("Applying…") : null;
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-background", open ? "border-amber-500/40" : "border-border opacity-90")}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <ShieldCheck className={cn("h-4 w-4 shrink-0", open ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-muted-foreground">{open ? t("Waiting for your approval") : title}</span>
          <span className="block truncate text-sm font-semibold" title={proposal.summary}>{open ? title : proposal.summary}</span>
        </span>
      </div>
      {open && proposal.diff.length > 0 && (
        <dl className="space-y-1 px-3 py-2 text-xs">
          {proposal.diff.map((row, i) => (
            <div key={i} className="grid grid-cols-[6.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">{t(FIELD_WORD[row.field] ?? row.field)}</dt>
              <dd className="min-w-0 break-words">
                {row.from != null && row.from !== "" && <><span className="text-muted-foreground line-through decoration-muted-foreground/60">{row.from}</span> <span aria-hidden>→</span> </>}
                <span className="font-medium">{row.field === "Status" && row.to ? t(row.to) : row.to ?? "—"}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {statusLine && <div className={cn("px-3 py-2 text-xs font-medium", proposal.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{statusLine}</div>}
      {proposal.status === "APPLIED" && proposal.card && <div className="px-3 pb-3"><ResultCard card={proposal.card} /></div>}
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      {open && (
        <div className="flex justify-end gap-2 border-t border-border/60 px-3 py-2">
          <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent disabled:opacity-50">
            {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Discard")}
          </button>
          <button type="button" onClick={() => void decide("apply")} disabled={!!pending} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("Apply")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One attachment, drawn the same way wherever it appears: a 40px thumbnail for a picture, a glyph for a
 * document, and the file's name beside it. In the composer it carries a remove button; on a message it
 * is a link.
 */
function GideonAttachmentChip({ kind, name, src, link, onRemove, onBubble }: {
  kind: "image" | "document";
  name?: string;
  src?: string;
  link?: { href: string; download?: string };
  onRemove?: () => void;
  onBubble?: boolean;
}) {
  const { t } = useLang();
  const [thumbFailed, setThumbFailed] = useState(false);
  const label = name || (kind === "image" ? t("Attached image") : t("Attached file"));
  const body = (
    <>
      {kind === "image" && src && !thumbFailed ? (
        <img src={src} alt="" loading="lazy" onError={() => setThumbFailed(true)} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", onBubble ? "bg-primary-foreground/15" : "bg-muted")}>
          {kind === "image" ? <ImagePlus className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
      )}
      <span className="flex-1 truncate text-xs" title={label}>{label}</span>
    </>
  );
  const tone = onBubble ? "text-primary-foreground/80" : "text-muted-foreground";
  if (link) {
    return <a href={link.href} download={link.download} target="_blank" rel="noreferrer" className={cn("flex items-center gap-2 transition-opacity hover:opacity-80", tone)}>{body}</a>;
  }
  return (
    <div className={cn("flex items-center gap-2", tone)}>
      {body}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={kind === "image" ? t("Remove the image") : t("Remove the file")} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

/**
 * A handle the browser will open, for a file that has not been anywhere yet (a data: url cannot be
 * navigated to; the same bytes as a blob can). Null rather than throwing on anything that is not a data
 * url: a chip that fails to appear is a far smaller loss than a question that fails to send.
 */
function holdLocalFile(dataUrl: string): { url: string; mime: string; size: number } | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) return null;
    const meta = dataUrl.slice("data:".length, comma);
    const base64 = meta.endsWith(";base64");
    const mime = (base64 ? meta.slice(0, -";base64".length) : meta).split(";")[0] || "application/octet-stream";
    const body = dataUrl.slice(comma + 1);
    const bytes = base64 ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
    const blob = new Blob([bytes], { type: mime });
    return { url: URL.createObjectURL(blob), mime, size: blob.size };
  } catch {
    return null;
  }
}
