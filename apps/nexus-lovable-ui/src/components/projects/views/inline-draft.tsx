import { useEffect, useRef, useState } from "react";
import { Calendar, Loader2, Maximize2, MoreHorizontal, Trash2, X } from "lucide-react";
import { enGB, id as idLocale } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as DayPicker } from "@/components/ui/calendar";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import type { NexusTask } from "@/lib/nexus-api";

/**
 * Notion's inline new card (owner, 12 Oct 2026): "+ New task" in a column (or a List / Table group) opens a
 * draft right there — title focused, a "Add due date" property under it, ⤢ and ••• on hover. Enter saves and
 * empties the draft for the next one; Esc or clicking away saves a typed title and closes (an empty draft is
 * just discarded). ⤢ (or ⌘/Ctrl+Enter) saves and opens the task popup for full editing. The big Add task
 * modal is only the toolbar's.
 *
 * Typing never waits for the server (bug hunt C-BUG-2, 12 Oct 2026): the field stays editable while a task
 * saves, Enter hands the title to a queue and clears only that text, and the queue saves one task after the
 * other, so a fast Enter-chain makes exactly the tasks typed, in order. A save that fails puts its title back.
 */
export function InlineTaskDraft({ variant, onCreate, onExpand, onClose, accent }: {
  variant: "card" | "row";
  /** `kept()` says, when the save failed, whether this field takes the title back (the caller then
   *  doesn't offer its own "Try again" — two keepers would make the task twice). */
  onCreate: (p: { title: string; dueDate: string | null; kept?: () => boolean }) => Promise<NexusTask | null>;
  onExpand: (task: NexusTask) => void;
  onClose: () => void;
  /** The column's colour (CSS colour) for the focus ring. */
  accent?: string;
}) {
  const { t, locale, lang } = useLang();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [pending, setPending] = useState(0);
  const [dateOpen, setDateOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ title, due });
  latest.current = { title, due };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const closed = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);

  const close = () => { if (closed.current) return; closed.current = true; onClose(); };

  const save = (then: "next" | "close" | "expand") => {
    if (closed.current) return;
    const name = latest.current.title.trim();
    if (!name) { if (then !== "next") close(); return; }
    const dueDate = latest.current.due || null;
    // Clear what was handed over (not what is typed after it), keep the field focused.
    latest.current = { title: "", due: "" };
    setTitle("");
    setDue("");
    if (mounted.current) setPending((n) => n + 1);
    const kept = () => mounted.current && !closed.current && !latest.current.title;
    const job = queue.current.then(() => onCreate({ title: name, dueDate, kept }));
    queue.current = job.catch(() => null);
    void job.then(
      (task) => {
        if (mounted.current) setPending((n) => n - 1);
        if (!task) { if (mounted.current && !latest.current.title) setTitle(name); return; }
        if (then === "expand") onExpand(task);
      },
      () => { if (mounted.current) { setPending((n) => n - 1); if (!latest.current.title) setTitle(name); } },
    );
    if (then === "next") requestAnimationFrame(() => input.current?.focus());
    else close();
  };

  // Click-away: save when there is a title, else discard. Popovers (the date picker) are portaled, so
  // a click inside them does not count as away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (root.current?.contains(el) || el.closest("[data-radix-popper-content-wrapper]")) return;
      save("close");
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
          onChange={(e) => { latest.current = { ...latest.current, title: e.target.value }; setTitle(e.target.value); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save("expand"); }
            else if (e.key === "Enter") { e.preventDefault(); save("next"); }
            // Esc keeps a typed title as a task (Notion); an empty draft just closes (C-BUG-12).
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); save("close"); }
          }}
          placeholder={t("New task")}
          aria-label={t("New task title")}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/70"
        />
        {pending > 0 && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <div className={cn("flex shrink-0 items-center gap-0.5", card && "opacity-0 transition-opacity focus-within:opacity-100 group-hover/draft:opacity-100")}>
          <button type="button" onClick={() => save("expand")} disabled={!title.trim()} title={t("Open as task (⌘/Ctrl+Enter)")} aria-label={t("Open as task")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={t("More")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button type="button" onClick={() => { latest.current = { title: "", due: "" }; close(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"><Trash2 className="h-3.5 w-3.5" />{t("Discard")}</button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn("inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted", due ? "text-foreground" : "text-muted-foreground")}>
            <Calendar className="h-3.5 w-3.5" />{dueLabel ?? t("Add due date")}
            {due && <X className="h-3 w-3 opacity-60" onClick={(e) => { e.stopPropagation(); latest.current = { ...latest.current, due: "" }; setDue(""); }} aria-label={t("Clear due date")} />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          {/* The app's calendar, not the native mm/dd/yyyy input (C-BUG-23). */}
          <DayPicker
            mode="single"
            selected={due ? new Date(`${due}T00:00:00`) : undefined}
            locale={lang === "id" ? idLocale : enGB}
            weekStartsOn={1}
            onSelect={(d) => {
              const v = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
              latest.current = { ...latest.current, due: v };
              setDue(v); setDateOpen(false); requestAnimationFrame(() => input.current?.focus());
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
