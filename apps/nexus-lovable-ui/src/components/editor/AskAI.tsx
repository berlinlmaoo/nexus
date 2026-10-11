import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  ArrowUp, BookOpen, Check, ChevronRight, CornerDownLeft, FileText, Languages, ListChecks, Loader2, MessageSquareText, PenLine,
  RefreshCw, Replace, Sparkles, SpellCheck, StretchHorizontal, Shrink, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { GideonMarkdown } from "@/components/gideon/GideonMarkdown";
import { markdownToDoc, streamGideonWrite, useGideonName, type GideonActionItem, type GideonWriteAction } from "@/lib/gideon-ai";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { ctxOf } from "./editor-context";

/**
 * "Ask AI" inside the block editor (owner, 12 Oct 2026 — Notion AI parity). Opened by:
 *   - Space on an empty line, "/" → Ask AI, or ⌘/Ctrl+J (writes at the cursor: continue, summarise the page,
 *     extract action items, or anything typed);
 *   - "Ask AI" on the selection toolbar (rewrites the selection: improve, fix spelling & grammar, shorter,
 *     longer, tone, summarise, translate, explain, action items).
 * The answer streams into a preview; nothing touches the page until Replace / Insert below / Insert.
 * Action items can become real tasks in this page's project — created by the person through the normal
 * task API (that click is the approval) — or a to-do list on the page.
 */

export type AskAiMode = "selection" | "cursor";
/** The handle lives in the askAiShortcut extension's storage (extensions.ts). */
type Storage = { askAiShortcut?: { open: ((mode: AskAiMode) => void) | null } };

/** Called by the slash item, the shortcut and the selection toolbar. */
export function openAskAi(editor: Editor, mode: AskAiMode) {
  (editor.storage as unknown as Storage).askAiShortcut?.open?.(mode);
}

type Snapshot = { mode: AskAiMode; from: number; to: number; text: string; context: string; rect: DOMRect };
type ActionDef = { id: string; action: GideonWriteAction; label: string; icon: typeof Sparkles; tone?: string; language?: "en" | "id"; group: string };

const SEL_ACTIONS: ActionDef[] = [
  { id: "improve", action: "improve", label: "Improve writing", icon: Wand2, group: "Edit" },
  { id: "fix", action: "fix", label: "Fix spelling & grammar", icon: SpellCheck, group: "Edit" },
  { id: "shorter", action: "shorter", label: "Make shorter", icon: Shrink, group: "Edit" },
  { id: "longer", action: "longer", label: "Make longer", icon: StretchHorizontal, group: "Edit" },
  { id: "tone-professional", action: "tone", tone: "professional", label: "Tone: professional", icon: PenLine, group: "Change tone" },
  { id: "tone-casual", action: "tone", tone: "casual", label: "Tone: casual", icon: PenLine, group: "Change tone" },
  { id: "tone-friendly", action: "tone", tone: "friendly", label: "Tone: friendly", icon: PenLine, group: "Change tone" },
  { id: "tone-confident", action: "tone", tone: "confident", label: "Tone: confident", icon: PenLine, group: "Change tone" },
  { id: "tone-straightforward", action: "tone", tone: "straightforward", label: "Tone: straightforward", icon: PenLine, group: "Change tone" },
  { id: "summarize", action: "summarize", label: "Summarize", icon: FileText, group: "Understand" },
  { id: "explain", action: "explain", label: "Explain this", icon: BookOpen, group: "Understand" },
  { id: "translate-en", action: "translate", language: "en", label: "Translate to English", icon: Languages, group: "Understand" },
  { id: "translate-id", action: "translate", language: "id", label: "Translate to Indonesian", icon: Languages, group: "Understand" },
  { id: "action_items", action: "action_items", label: "Find action items", icon: ListChecks, group: "Understand" },
];
const CURSOR_ACTIONS: ActionDef[] = [
  { id: "continue", action: "continue", label: "Continue writing", icon: PenLine, group: "Write" },
  { id: "summarize", action: "summarize", label: "Summarize this page", icon: FileText, group: "Write" },
  { id: "action_items", action: "action_items", label: "Find action items in this page", icon: ListChecks, group: "Write" },
  { id: "translate-en", action: "translate", language: "en", label: "Translate this page to English", icon: Languages, group: "Write" },
  { id: "translate-id", action: "translate", language: "id", label: "Translate this page to Indonesian", icon: Languages, group: "Write" },
];

const PAGE_TEXT_MAX = 12000;

type Member = { id: string; name: string };
/**
 * The project member an action item's owner names — only when exactly one member matches the full name or
 * the first name (case-insensitive). Anything else stays unassigned (the name goes into the description).
 */
export function matchOwner(owner: string | null | undefined, members: Member[]): string | null {
  const o = (owner ?? "").trim().toLowerCase();
  if (!o) return null;
  const full = members.filter((m) => m.name.trim().toLowerCase() === o);
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return null;
  const first = members.filter((m) => m.name.trim().toLowerCase().split(/\s+/)[0] === o.split(/\s+/)[0] && o.split(/\s+/).length === 1);
  return first.length === 1 ? first[0].id : null;
}
const TONE_LABEL: Record<string, string> = { professional: "Professional", casual: "Casual", friendly: "Friendly", confident: "Confident", straightforward: "Straightforward" };

function snapshot(editor: Editor, mode: AskAiMode): Snapshot | null {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const pageText = state.doc.textBetween(0, state.doc.content.size, "\n", " ");
  const hasSel = mode === "selection" && from !== to;
  const text = hasSel ? state.doc.textBetween(from, to, "\n", " ") : "";
  const before = pageText.slice(0, Math.max(0, state.doc.textBetween(0, from, "\n", " ").length));
  let rect: DOMRect;
  try {
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    const host = view.dom.getBoundingClientRect();
    rect = new DOMRect(host.left, Math.min(a.top, b.top), host.width, Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top));
  } catch {
    rect = view.dom.getBoundingClientRect();
  }
  return { mode: hasSel ? "selection" : "cursor", from, to, text, context: hasSel ? pageText.slice(0, 4000) : before.slice(-4000), rect };
}

/** The end of the top-level block that contains `pos` (where "Insert below" goes). */
function blockEnd(editor: Editor, pos: number): number {
  const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  return $pos.depth >= 1 ? $pos.after(1) : editor.state.doc.content.size;
}

/** One paragraph of plain inline content → just its inline nodes (so Replace keeps the sentence in its line). */
function inlineOnly(doc: JSONContent): JSONContent[] | null {
  const blocks = doc.content ?? [];
  if (blocks.length === 1 && blocks[0].type === "paragraph") return blocks[0].content ?? [];
  return null;
}

export function AskAiLayer({ editor }: { editor: Editor }) {
  const { t } = useLang();
  const name = useGideonName();
  const qc = useQueryClient();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [prompt, setPrompt] = useState("");
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"menu" | "running" | "done" | "error">("menu");
  const [result, setResult] = useState("");
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [items, setItems] = useState<Array<GideonActionItem & { on: boolean; assigneeId: string | null }> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ def: ActionDef | null; prompt: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const close = useCallback(() => {
    abort.current?.abort();
    setSnap(null);
    setPrompt("");
    setPhase("menu");
    setResult("");
    setDoc(null);
    setItems(null);
    setError(null);
    // After the menu has unmounted, or the focus lands on nothing and the next keystroke is lost.
    window.setTimeout(() => editor.commands.focus(), 0);
  }, [editor]);

  // The editor's handle for the slash item / shortcut / toolbar.
  useEffect(() => {
    const storage = (editor.storage as unknown as Storage).askAiShortcut;
    if (!storage) return;
    storage.open = (mode) => {
      const s = snapshot(editor, mode);
      if (!s) return;
      abort.current?.abort();
      setSnap(s);
      setPrompt("");
      setIndex(0);
      setPhase("menu");
      setResult("");
      setDoc(null);
      setItems(null);
      setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    return () => { storage.open = null; };
  }, [editor]);

  useLayoutEffect(() => {
    if (!snap) { setPos(null); return; }
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const width = Math.min(560, vw - 16);
    const left = Math.min(Math.max(8, snap.rect.left), vw - width - 8);
    const below = snap.rect.bottom + 8;
    const top = below + 260 > vh && snap.rect.top > 300 ? Math.max(8, snap.rect.top - 8 - Math.min(420, boxRef.current?.offsetHeight ?? 320)) : below;
    setPos({ top, left, width });
  }, [snap, phase, result.length]);

  // Click outside closes the menu (not a finished answer: that waits for a choice).
  useEffect(() => {
    if (!snap) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      if (phase === "menu" || phase === "error") close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [snap, phase, close]);

  const actions = snap?.mode === "selection" ? SEL_ACTIONS : CURSOR_ACTIONS;
  const filtered = useMemo(() => {
    const q = prompt.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => t(a.label).toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
  }, [actions, prompt, t]);

  const run = async (def: ActionDef | null, custom: string) => {
    if (!snap) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLast({ def, prompt: custom });
    setPhase("running");
    setResult("");
    setDoc(null);
    setItems(null);
    setError(null);
    const pageText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ").slice(0, PAGE_TEXT_MAX);
    const action: GideonWriteAction = def?.action ?? "custom";
    // Whole-page actions read the page; continue reads what is before the cursor; selection actions the selection.
    const text = snap.mode === "selection" ? snap.text : action === "continue" ? snap.context : action === "custom" ? "" : pageText;
    const ctx = ctxOf(editor);
    let acc = "";
    let failed: string | null = null;
    await streamGideonWrite(
      {
        action,
        text,
        context: snap.mode === "selection" ? snap.context : action === "custom" ? pageText.slice(0, 4000) : "",
        tone: def?.tone,
        language: def?.language,
        prompt: custom || undefined,
        docTitle: document.title.replace(/ · .*$/, "").slice(0, 200),
        ...(ctx?.blockLinkBase?.startsWith("/docs/") ? { docId: ctx.blockLinkBase.split("/")[2] } : {}),
        ...(ctx?.blockLinkBase?.startsWith("/tasks/") ? { taskId: ctx.blockLinkBase.split("/")[2] } : {}),
      },
      (ev) => {
        if (ev.type === "delta") { acc += ev.content; setResult(acc); }
        else if (ev.type === "reset") { acc = ""; setResult(""); }
        else if (ev.type === "final") {
          acc = ev.content;
          setResult(ev.content);
          setDoc(markdownToDoc(ev.content));
          if (ev.items) setItems(ev.items.map((i) => ({ ...i, on: true, assigneeId: null })));
        } else if (ev.type === "error") failed = ev.content ?? t("Something went wrong.");
      },
      controller.signal,
    ).catch((e) => { if (!controller.signal.aborted) failed = e instanceof Error ? e.message : t("Something went wrong."); });
    if (controller.signal.aborted) return;
    if (failed || !acc.trim()) {
      setError(failed ?? t("GIDEON couldn't write that. Try again."));
      setPhase("error");
      return;
    }
    setDoc((d) => d ?? markdownToDoc(acc));
    setPhase("done");
  };

  const submit = () => {
    if (phase !== "menu") return;
    const typed = prompt.trim();
    if (typed) void run(null, typed);
    else if (filtered[index]) void run(filtered[index], "");
  };

  // Action items: the page's project members, so an owner the text names can be assigned (owner, 12 Oct 2026).
  const itemsKey = items ? items.map((i) => i.owner ?? "").join("|") : null;
  useEffect(() => {
    const projectId = ctxOf(editor)?.projectId;
    if (itemsKey === null || !projectId) return;
    let alive = true;
    nexusApi.projectMembers(projectId).then((res) => {
      if (!alive) return;
      const rows = Array.isArray(res) ? res : res.members ?? [];
      const list = rows.map((r) => ({ id: r.user?.id ?? r.userId ?? "", name: r.user?.name ?? "" })).filter((m) => m.id && m.name);
      setMembers(list);
      setItems((cur) => cur?.map((i) => ({ ...i, assigneeId: i.assigneeId ?? matchOwner(i.owner, list) })) ?? cur);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [itemsKey, editor]);

  const content = () => doc ?? markdownToDoc(result);
  const replace = () => {
    if (!snap) return;
    const d = content();
    const inline = inlineOnly(d);
    editor.chain().focus().insertContentAt({ from: snap.from, to: snap.to }, inline ?? d.content ?? []).run();
    close();
  };
  const insertBelow = () => {
    if (!snap) return;
    const d = content();
    const at = snap.mode === "selection" ? blockEnd(editor, snap.to) : snap.from;
    // On an empty line the answer takes the line's place; elsewhere it goes after the block.
    const $from = editor.state.doc.resolve(Math.min(snap.from, editor.state.doc.content.size));
    const emptyLine = snap.mode === "cursor" && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
    if (emptyLine) editor.chain().focus().insertContentAt({ from: $from.before(), to: $from.after() }, d.content ?? []).run();
    else editor.chain().focus().insertContentAt(snap.mode === "selection" ? at : blockEnd(editor, snap.from), d.content ?? []).run();
    close();
  };
  const insertTodos = () => {
    if (!items || !snap) return;
    const picked = items.filter((i) => i.on);
    const md = picked.map((i) => `- [ ] ${i.title}${i.due ? ` (${i.due})` : ""}${i.owner ? ` — ${i.owner}` : ""}`).join("\n");
    const d = markdownToDoc(md);
    editor.chain().focus().insertContentAt(snap.mode === "selection" ? blockEnd(editor, snap.to) : blockEnd(editor, snap.from), d.content ?? []).run();
    close();
  };
  const createTasks = async () => {
    const projectId = ctxOf(editor)?.projectId;
    if (!items || !projectId) return;
    const picked = items.filter((i) => i.on);
    if (!picked.length) return;
    setCreating(true);
    try {
      const project = await nexusApi.project(projectId);
      // The default To-do section: the first section bound to the To-do status, else the first section.
      const lists = [...(project.taskLists ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const list = lists.find((l) => l.taskStatus === "TODO") ?? lists[0];
      if (!list) throw new Error(t("This project has no section to put tasks in."));
      let made = 0;
      for (const i of picked) {
        await nexusApi.createTask({
          title: i.title, projectId, taskListId: list.id, status: "TODO", dueDate: i.due ?? null,
          ...(i.assigneeId ? { assigneeIds: [i.assigneeId] } : {}),
          description: i.owner && !i.assigneeId ? t("Owner (from the page): {name}", { name: i.owner }) : null,
        });
        made++;
      }
      qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
      toast.success(t("{n} tasks created in {name}", { n: made, name: project.name }));
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Couldn't create the tasks."));
    } finally {
      setCreating(false);
    }
  };

  if (!snap || typeof document === "undefined") return null;
  const groups = [...new Set(filtered.map((a) => a.group))];
  const canTasks = Boolean(ctxOf(editor)?.projectId);
  return createPortal(
    <div
      ref={boxRef}
      className="nx-menu fixed z-[140] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width ?? 560 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
      }}
    >
      {(phase === "running" || phase === "done") && (
        <div className="max-h-[45vh] overflow-y-auto border-b border-border px-4 py-3 text-sm">
          {items && phase === "done" ? (
            items.length ? (
              <ul className="space-y-1.5">
                {items.map((i, n) => (
                  <li key={n}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" checked={i.on} onChange={(e) => setItems((cur) => cur!.map((x, k) => (k === n ? { ...x, on: e.target.checked } : x)))} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                      <span className="min-w-0">
                        <span className="block">{i.title}</span>
                        {i.due && <span className="block text-[11px] text-muted-foreground">{i.due}</span>}
                      </span>
                    </label>
                    {canTasks && (
                      <select
                        value={i.assigneeId ?? ""}
                        onChange={(e) => setItems((cur) => cur!.map((x, k) => (k === n ? { ...x, assigneeId: e.target.value || null } : x)))}
                        aria-label={t("Assignee")}
                        className="ml-6 mt-1 max-w-[16rem] rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none focus:border-primary"
                      >
                        <option value="">{i.owner ? t("Unassigned (“{name}” in the description)", { name: i.owner }) : t("Unassigned")}</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">{t("No action items found.")}</p>
          ) : result ? (
            <GideonMarkdown text={result} />
          ) : (
            <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("{assistant} is writing…", { assistant: name })}</span>
          )}
        </div>
      )}

      {phase === "error" && <div className="border-b border-border px-4 py-3 text-sm text-destructive">{error}</div>}

      {phase === "menu" && (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <input
              ref={inputRef}
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0)); }
                else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const typed = prompt.trim();
                  if (typed && filtered.length === 0) void run(null, typed);
                  else if (typed && e.shiftKey) void run(null, typed);
                  else if (filtered[index]) void run(filtered[index], "");
                  else if (typed) void run(null, typed);
                }
              }}
              placeholder={snap.mode === "selection" ? t("Ask AI to edit or explain the selection…") : t("Ask AI to write anything…")}
              aria-label={t("Ask AI")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button type="button" onClick={submit} disabled={!prompt.trim()} aria-label={t("Send")} className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp className="h-3.5 w-3.5" /></button>
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={t("Ask AI")}>
            {groups.map((g) => g === "Change tone" ? (
              <div key={g} className="px-2 pb-1 pt-2">
                <div className="pb-1.5 text-[11px] font-semibold text-muted-foreground">{t(g)}</div>
                <div className="flex flex-wrap gap-1">
                  {filtered.filter((a) => a.group === g).map((a) => {
                    const i = filtered.indexOf(a);
                    return (
                      <button key={a.id} type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => void run(a, "")} className={cn("rounded-full border px-2.5 py-1 text-xs", i === index ? "border-primary/50 bg-muted" : "border-border hover:bg-muted/60")}>
                        {t(TONE_LABEL[a.tone ?? ""] ?? a.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div key={g}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{t(g)}</div>
                {filtered.filter((a) => a.group === g).map((a) => {
                  const i = filtered.indexOf(a);
                  const Icon = a.icon;
                  return (
                    <button key={a.id} type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => void run(a, "")} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm", i === index ? "bg-muted" : "hover:bg-muted/60")}>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1 truncate">{t(a.label)}</span>
                      {i === index && <CornerDownLeft className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {prompt.trim() && (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void run(null, prompt.trim())} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60">
                <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1 truncate">{t("Ask: “{q}”", { q: prompt.trim() })}</span><ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </>
      )}

      {phase !== "menu" && (
        <div className="flex flex-wrap items-center gap-1 px-2 py-2">
          {phase === "running" && (
            <button type="button" onClick={() => { abort.current?.abort(); setPhase("menu"); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" />{t("Stop")}</button>
          )}
          {phase === "done" && items && (
            <>
              {canTasks && (
                <button type="button" disabled={creating || !items.some((i) => i.on)} onClick={() => void createTasks()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{t("Create {n} tasks", { n: items.filter((i) => i.on).length })}
                </button>
              )}
              <button type="button" disabled={!items.some((i) => i.on)} onClick={insertTodos} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"><ListChecks className="h-3.5 w-3.5" />{t("Insert as to-do list")}</button>
            </>
          )}
          {phase === "done" && !items && (
            <>
              {snap.mode === "selection" && (
                <button type="button" onClick={replace} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><Replace className="h-3.5 w-3.5" />{t("Replace selection")}</button>
              )}
              <button type="button" onClick={insertBelow} className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold", snap.mode === "selection" ? "border border-border hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-primary/90")}>
                <CornerDownLeft className="h-3.5 w-3.5" />{snap.mode === "selection" ? t("Insert below") : t("Insert")}
              </button>
            </>
          )}
          {(phase === "done" || phase === "error") && (
            <button type="button" onClick={() => last && void run(last.def, last.prompt)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent"><RefreshCw className="h-3.5 w-3.5" />{t("Try again")}</button>
          )}
          <button type="button" onClick={close} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" />{t("Discard")}</button>
        </div>
      )}
    </div>,
    document.body,
  );
}
