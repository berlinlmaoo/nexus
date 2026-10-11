import { useEffect, useRef, useState } from "react";
import { Calendar, Loader2, Maximize2, MoreHorizontal, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import type { NexusTask } from "@/lib/nexus-api";

/**
 * Notion's inline new card (owner, 12 Oct 2026): "+ New task" in a column (or a List group) opens a draft
 * right there — title focused, a "Add due date" property under it, ⤢ and ••• on hover. Enter saves and
 * opens the next empty draft in the same place; Esc, or clicking away with no title, discards; clicking
 * away with a title saves. ⤢ (or ⌘/Ctrl+Enter) saves and opens the task popup for full editing. The big
 * Add task modal is only the toolbar's.
 */
export function InlineTaskDraft({ variant, onCreate, onExpand, onClose, accent }: {
  variant: "card" | "row";
  onCreate: (p: { title: string; dueDate: string | null }) => Promise<NexusTask | null>;
  onExpand: (task: NexusTask) => void;
  onClose: () => void;
  /** The column's colour (CSS colour) for the focus ring. */
  accent?: string;
}) {
  const { t, locale } = useLang();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ title, due });
  latest.current = { title, due };
  const savingRef = useRef(false);

  const save = async (then: "next" | "close" | "expand") => {
    const name = latest.current.title.trim();
    if (!name) { if (then !== "next") onClose(); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const task = await onCreate({ title: name, dueDate: latest.current.due || null });
      if (then === "next") { setTitle(""); setDue(""); requestAnimationFrame(() => input.current?.focus()); }
      else if (then === "expand" && task) { onClose(); onExpand(task); }
      else onClose();
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  // Click-away: save when there is a title, else discard. Popovers (the date picker) are portaled, so
  // a click inside them does not count as away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (root.current?.contains(el) || el.closest("[data-radix-popper-content-wrapper]")) return;
      void save("close");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dueLabel = due ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${due}T00:00:00`)) : null;
  const card = variant === "card";
  return (
    <div
      ref={root}
      className={cn(
        "group/draft relative bg-card",
        card ? "flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 shadow-[0_1px_2px_rgba(15,15,15,0.06)]" : "flex min-h-9 items-center gap-2 border-b border-border/70 px-2 py-1",
      )}
      style={card ? { borderColor: accent ?? "var(--border)" } : undefined}
    >
      <div className={cn("flex items-center gap-1.5", !card && "min-w-0 flex-1")}>
        <input
          ref={input}
          autoFocus
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save("expand"); }
            else if (e.key === "Enter") { e.preventDefault(); void save("next"); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
          placeholder={t("New task")}
          aria-label={t("New task title")}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/70"
        />
        {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <div className={cn("flex shrink-0 items-center gap-0.5", card && "opacity-0 transition-opacity focus-within:opacity-100 group-hover/draft:opacity-100")}>
          <button type="button" onClick={() => void save("expand")} disabled={!title.trim() || busy} title={t("Open as task (⌘/Ctrl+Enter)")} aria-label={t("Open as task")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={t("More")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button type="button" onClick={onClose} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"><Trash2 className="h-3.5 w-3.5" />{t("Discard")}</button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn("inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted", due ? "text-foreground" : "text-muted-foreground")}>
            <Calendar className="h-3.5 w-3.5" />{dueLabel ?? t("Add due date")}
            {due && <X className="h-3 w-3 opacity-60" onClick={(e) => { e.stopPropagation(); setDue(""); }} aria-label={t("Clear due date")} />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <input type="date" autoFocus value={due} onChange={(e) => { setDue(e.target.value); setDateOpen(false); requestAnimationFrame(() => input.current?.focus()); }} className="h-8 rounded-md border border-border bg-card px-2 text-sm" aria-label={t("Due date")} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
