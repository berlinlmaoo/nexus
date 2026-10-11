import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  AlertTriangle, ArrowUp, Check, ChevronDown, ChevronRight, Copy, FileText, FolderKanban, ImagePlus, ListChecks, Loader2,
  Maximize2, MessageSquare, Minimize2, Paperclip, ShieldCheck, Trash2, X,
} from "lucide-react";
import { GideonMark } from "./GideonMark";
import { GideonMarkdown } from "./GideonMarkdown";
import {
  clearGideonHistory, decideGideonProposal, gideonAttachmentLink, loadGideonHistory, pendingGideonProposals, streamGideon,
  GIDEON_APPROVAL_MODES, GIDEON_DEFAULT_APPROVAL, GIDEON_DEFAULT_TIER, GIDEON_FILE_ACCEPT, GIDEON_MAX_FILE_BYTES, GIDEON_TIERS,
  isAcceptedGideonFile,
  type GideonApprovalMode, type GideonAttachment, type GideonCard, type GideonContext, type GideonFile, type GideonMessage,
  type GideonProposal, type GideonRef, type GideonStep, type GideonTier, type GideonTurn,
} from "@/lib/gideon";
import { useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * GIDEON chat (rebuilt 12 Oct 2026, owner: "reply like Notion's agent chat"): the answer streams in as it
 * is written and renders as Markdown; above it, the steps GIDEON is taking ("Searching tasks…", "Reading
 * project Atlas"); below it, the sources it read, cards for what it created or changed, and — depending
 * on the approval mode — the changes it wants to make, each with Apply / Discard. Opened from a project,
 * it carries that project as context (the chip above the box).
 */

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
    case "get_project_summary": return a ? t("Reading project {name}", { name: a }) : t("Reading a project");
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

export function GideonPanel({ onClose, context, onClearContext, wide, onToggleWide }: {
  onClose: () => void;
  /** The project/task GIDEON was opened from (chip above the box). */
  context?: GideonContext | null;
  onClearContext?: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
}) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** A data URL, held only until the next message is sent. */
  const [image, setImage] = useState<string | null>(null);
  /** A picked document, held only until the next message is sent. Rides alongside an image, not instead of it. */
  const [doc, setDoc] = useState<GideonFile | null>(null);
  /** Why the last pick was refused before it was ever uploaded. Cleared by the next pick, or by sending. */
  const [attachError, setAttachError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  // Remembered per browser: somebody who picks Terra for quick questions should not have to pick it
  // again every time the panel opens.
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
  /** Proposals waiting for this person that no turn on screen shows (e.g. from an @GIDEON comment). */
  const [waiting, setWaiting] = useState<GideonProposal[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Every blob: handle minted for a chip on a turn sent in this session, so all of them can go at once. */
  const localUrls = useRef<string[]>([]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useEffect(() => () => {
    abortRef.current?.abort();
    // Released together with the chips that used them. The launcher unmounts this panel when it is
    // closed, so a session's blobs live exactly as long as the messages pointing at them — and the
    // stored copy takes over the moment the panel is opened again.
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    localUrls.current = [];
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, [context?.projectId]);

  // Restore the saved conversation on open. If the user already started typing a turn before the
  // history landed, their turn wins — a late response must never wipe live messages.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadGideonHistory(), pendingGideonProposals().catch(() => ({ proposals: [] as GideonProposal[] }))]).then(([rows, pending]) => {
      if (cancelled) return;
      const restored = rows.map(fromHistory);
      if (restored.length) setTurns((cur) => (cur.length ? cur : restored));
      const shown = new Set(restored.flatMap((r) => (r.proposals ?? []).map((p) => p.id)));
      setWaiting(pending.proposals.filter((p) => !shown.has(p.id)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const clearHistory = async () => {
    setConfirmClear(false);
    setTurns([]);
    await clearGideonHistory();
  };

  // Both checks are the route's own, run again here: refusing at the picker costs nothing, while
  // discovering the same refusal after uploading ten megabytes costs the whole upload.
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
    setAttachError(null);
    const history: GideonMessage[] = [...turns.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];

    // The chip on the turn being sent points at a copy of the bytes this tab is already holding; on the
    // next open this turn comes back from history and the chip is drawn from the stored file instead.
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

    await streamGideon(history, (ev) => {
      switch (ev.type) {
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
    }, { signal: controller.signal, model: tier, image, file: doc, approvalMode: mode, context }).catch(() => {
      patchLast((x) => ({ ...x, failed: true, content: x.content || t("GIDEON can't be reached right now. Try again in a moment.") }));
    });
    // Cleared whatever happened: an attachment silently riding along on the NEXT question would be
    // baffling, and re-attaching is one click.
    setImage(null);
    setDoc(null);
    patchLast((x) => ({ ...x, streaming: false, steps: (x.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "done" } : s)) }));
    setBusy(false);
    // Something changed in NEXUS: lists and boards on screen refetch (realtime covers open project rooms).
    if (wroteSomething) qc.invalidateQueries({ queryKey: ["nexus"] });
  };

  const onDecided = (p: GideonProposal) => {
    setTurns((cur) => cur.map((x) => (x.proposals?.some((q) => q.id === p.id) ? { ...x, proposals: x.proposals.map((q) => (q.id === p.id ? p : q)) } : x)));
    setWaiting((cur) => cur.map((q) => (q.id === p.id ? p : q)));
    if (p.status === "APPLIED") qc.invalidateQueries({ queryKey: ["nexus"] });
  };

  const suggestions = useMemo(() => (
    context
      ? [
          t("Summarize where {name} stands this week", { name: context.projectName }),
          t("What's overdue in {name}, and who owns it?", { name: context.projectName }),
          t("Turn the next steps of {name} into tasks", { name: context.projectName }),
        ]
      : [t("What's overdue for me?"), t("Summarize my week across projects"), t("Which tasks are due in the next 7 days?")]
  ), [context, t]);

  const modeDef = GIDEON_APPROVAL_MODES.find((m) => m.id === mode) ?? GIDEON_APPROVAL_MODES[1];
  const openWaiting = waiting.filter((p) => p.status === "PENDING" || p.status === "APPLYING");

  return (
    <div lang={L.lang} className="flex h-full w-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
      <div className="flex items-center gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-muted text-foreground"><GideonMark className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">GIDEON</div>
          <div className="truncate text-[11px] text-muted-foreground">{t("Acts in NEXUS as you")}</div>
        </div>
        <select
          value={tier}
          onChange={(e) => {
            const next = e.target.value as GideonTier;
            setTier(next);
            try { localStorage.setItem("gideon-tier", next); } catch { /* private mode */ }
          }}
          title={GIDEON_TIERS.find((x) => x.id === tier)?.blurb}
          aria-label={t("GIDEON tier")}
          className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground outline-none focus:border-primary"
        >
          {GIDEON_TIERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {onToggleWide && (
          <button type="button" onClick={onToggleWide} title={wide ? t("Narrow") : t("Widen")} aria-label={wide ? t("Narrow") : t("Widen")} className="hidden rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex">
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        {turns.length > 0 && (
          <button type="button" onClick={() => !busy && setConfirmClear(true)} title={t("Clear chat history")} aria-label={t("Clear chat history")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Trash2 className="h-4 w-4" /></button>
        )}
        <button type="button" onClick={onClose} aria-label={t("Close GIDEON")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {openWaiting.length > 0 && (
          <section className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"><ShieldCheck className="h-3.5 w-3.5" /> {L.tn(openWaiting.length, "1 change is waiting for your approval", "{n} changes are waiting for your approval")}</div>
            {openWaiting.map((p) => <ProposalCard key={p.id} proposal={p} onDecided={onDecided} />)}
          </section>
        )}
        {loading && turns.length === 0 && (
          <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}
        {!loading && turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <GideonMark className="mb-3 h-8 w-8 text-foreground/70" />
            <p className="text-sm font-semibold">{context ? t("Ask GIDEON about {name}", { name: context.projectName }) : t("What can GIDEON do for you?")}</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("It reads your projects and tasks with your access, and shows you what it read.")}</p>
            <div className="mt-4 flex w-full max-w-sm flex-col gap-1.5">
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
          <AssistantTurn key={i} turn={turn} onDecided={onDecided} />
        ))}
      </div>

      <div className="border-t border-border p-3">
        {context && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <FolderKanban className="h-3 w-3 shrink-0" />
              <span className="truncate">{context.taskTitle ? `${context.projectName} › ${context.taskTitle}` : context.projectName}</span>
              {onClearContext && <button type="button" onClick={onClearContext} aria-label={t("Remove this context")} className="-mr-1 rounded-full p-0.5 hover:bg-accent hover:text-foreground"><X className="h-3 w-3" /></button>}
            </span>
          </div>
        )}
        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-muted/40 focus-within:border-primary/50">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder={context ? t("Ask about {name}…", { name: context.projectName }) : t("Ask GIDEON…")}
            rows={2}
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
            <label title={t("Attach an image")} className="flex cursor-pointer items-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <ImagePlus className="h-4 w-4" />
              <span className="sr-only">{t("Attach an image")}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <label title={t("Attach a file (PDF, Word, Excel, text…)")} className="flex cursor-pointer items-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Paperclip className="h-4 w-4" />
              <span className="sr-only">{t("Attach a file (PDF, Word, Excel, text…)")}</span>
              <input
                type="file"
                accept={GIDEON_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  if (picked) attachDocument(picked);
                }}
              />
            </label>
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

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Clear the GIDEON chat history?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Every message and attached file in this chat is deleted for good. Tasks and docs GIDEON made stay.")}</AlertDialogDescription>
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

function AssistantTurn({ turn, onDecided }: { turn: ChatTurn; onDecided: (p: GideonProposal) => void }) {
  const L = useLang();
  const { t } = L;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const steps = turn.steps ?? [];
  const running = steps.filter((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "error").length;
  const sources = turn.sources ?? [];
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
                  {s.status === "running" ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" /> : s.status === "error" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" /> : <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />}
                  <span className="min-w-0">{stepText(s, t)}{s.status === "error" && s.error ? <span className="block text-destructive/80">{s.error}</span> : null}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {(turn.content || (turn.streaming && !steps.length)) && (
        <div className={cn("max-w-full rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", turn.failed ? "border border-destructive/30 bg-destructive/5" : "bg-muted")}>
          {turn.content ? <GideonMarkdown text={turn.content} /> : <Loader2 className="h-4 w-4 animate-spin" />}
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
          {sources.slice(0, 8).map((r) => <SourceChip key={`${r.kind}-${r.id}`} source={r} />)}
          {sources.length > 8 && <span className="text-[11px] text-muted-foreground">{t("+{n} more", { n: sources.length - 8 })}</span>}
        </div>
      )}

      {!turn.streaming && turn.content && !turn.failed && (
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(turn.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? t("Copied") : t("Copy")}
          </button>
        </div>
      )}
    </div>
  );
}

function useGo() {
  const router = useRouter();
  return (path: string) => router.history.push(path);
}

function SourceChip({ source }: { source: GideonRef }) {
  const go = useGo();
  const Icon = source.kind === "project" ? FolderKanban : source.kind === "doc" ? FileText : ListChecks;
  return (
    <a
      href={source.url}
      onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(source.url); }}
      className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
      title={source.title}
    >
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
        <ShieldCheck className={cn("h-4 w-4 shrink-0", open ? "text-amber-600" : "text-muted-foreground")} />
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
