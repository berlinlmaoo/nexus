import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { ArrowRightLeft, CalendarClock, Check, ChevronLeft, ChevronRight, Lock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { localeOf, useLang } from "@/lib/lang";
import { Avatar } from "@/components/Avatar";
import { GideonMark } from "@/components/gideon/GideonMark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTouchDrag } from "@/components/projects/views/touch-drag";
import type { Complaint } from "@/lib/nexus-api";

const DRAG_TYPE = "application/x-nexus-ticket";

/**
 * The ticket board (owner, 19 Oct 2026, U-4): one column per ComplaintStatus, replacing the Inbox / In review /
 * All tabs. Done holds RESOLVED and CLOSED together (CLOSED carries a grey label).
 *
 * BoD/OAA drag a card to another column — or use the card's ⇄ menu by keyboard — and that is the same
 * PATCH /api/complaints/[id] { status } the ticket thread's buttons send, with the same server checks.
 * "Awaiting decision" is written by the system only (GIDEON answering, a proposal landing): the server refuses
 * it by hand, so the board refuses it too and says why. Staff see their own tickets on the same board, read-only.
 *
 * Same mechanics as the pipeline board (PipelineBoard.tsx): HTML5 drag, touch through useTouchDrag, columns a
 * screen wide that snap on a phone, the strip scrolls sideways by keys, arrows, shift + wheel or mouse pan.
 */
/** The board tints from styles.css (--st-*), so light and dark follow the project boards. */
const tone = (c: string) => ({ dot: `var(--st-${c}-dot)`, lane: `var(--st-${c}-lane)`, text: `var(--st-${c}-fg)` });
export type TicketColumnKey = "OPEN" | "AWAITING_DECISION" | "IN_REVIEW" | "DONE";
export const TICKET_COLUMNS: { key: TicketColumnKey; label: string; empty: string; dot: string; lane: string; text: string }[] = [
  { key: "OPEN", label: "New", empty: "No new tickets", ...tone("yellow") },
  { key: "AWAITING_DECISION", label: "Awaiting decision", empty: "Nothing waiting for a decision", ...tone("purple") },
  { key: "IN_REVIEW", label: "In review", empty: "Nothing in review", ...tone("blue") },
  { key: "DONE", label: "Done", empty: "Nothing done yet", ...tone("green") },
];
export const columnOf = (status: string): TicketColumnKey =>
  status === "RESOLVED" || status === "CLOSED" ? "DONE" : status === "AWAITING_DECISION" || status === "IN_REVIEW" ? status : "OPEN";
/** The status a drop into a column writes. Done = Resolved; Closed is picked from the ⇄ menu or the thread. */
const DROP_STATUS: Record<TicketColumnKey, string | null> = { OPEN: "OPEN", AWAITING_DECISION: null, IN_REVIEW: "IN_REVIEW", DONE: "RESOLVED" };
/** The ⇄ menu: every status a director may set by hand (AWAITING_DECISION is the system's). */
const MOVE_TARGETS: { status: string; label: string }[] = [
  { status: "OPEN", label: "New" },
  { status: "IN_REVIEW", label: "In review" },
  { status: "RESOLVED", label: "Resolved" },
  { status: "CLOSED", label: "Closed" },
];

const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(localeOf(), { day: "numeric", month: "short" });

export function TicketBoard({
  tickets, canEdit, showReporter, categoryLabel, onOpen, onMove, onRefused,
}: {
  tickets: Complaint[];
  canEdit: boolean;
  showReporter: boolean;
  categoryLabel: (key: string) => string;
  onOpen: (id: string) => void;
  onMove: (id: string, status: string) => void;
  /** A drop the server would refuse (Awaiting decision): the board says why instead of sending it. */
  onRefused: () => void;
}) {
  const { t } = useLang();
  useTouchDrag();
  const [over, setOver] = useState<TicketColumnKey | null>(null);
  const byCol = new Map<TicketColumnKey, Complaint[]>(TICKET_COLUMNS.map((c) => [c.key, []]));
  for (const c of tickets) byCol.get(columnOf(c.status))!.push(c);

  const drop = (col: TicketColumnKey) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const ticket = tickets.find((x) => x.id === id);
    if (!ticket || columnOf(ticket.status) === col) return;
    const status = DROP_STATUS[col];
    if (!status) { onRefused(); return; }
    onMove(id, status);
  };

  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }));
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tickets.length]);
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(300, el.clientWidth * 0.75), behavior: reduce ? "auto" : "smooth" });
  };
  // Mouse pan from empty board space (never from a card or a control), as on the pipeline board.
  const pan = useRef<{ x: number; left: number; id: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("article,button,a,input,select,textarea,[role='dialog']")) return;
    pan.current = { x: e.clientX, left: e.currentTarget.scrollLeft, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (!p.moved && Math.abs(dx) < 4) return;
    if (!p.moved) { p.moved = true; e.currentTarget.setPointerCapture(p.id); }
    e.currentTarget.scrollLeft = p.left - dx;
  };
  const endPan = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    pan.current = null;
    if (p?.moved && e.currentTarget.hasPointerCapture(p.id)) e.currentTarget.releasePointerCapture(p.id);
  };
  const arrow = "pointer-events-auto absolute top-1/2 z-20 -translate-y-1/2 hidden h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-pop transition-[opacity,transform] hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring md:grid";

  return (
    <div className="relative -mx-4 md:-mx-8" data-touch-drag-root={canEdit ? "" : undefined}>
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={t("Ticket board. Scrolls sideways: arrow keys, or drag the empty space.")}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className="snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-3 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 md:cursor-grab md:snap-none md:px-8"
      >
        <div className="flex w-max gap-3 md:h-[max(26rem,calc(100dvh-15rem))] md:min-w-full">
          {TICKET_COLUMNS.map((col) => {
            const list = byCol.get(col.key) ?? [];
            const system = col.key === "AWAITING_DECISION";
            return (
              <section
                key={col.key}
                data-ticket-column={col.key}
                aria-label={t("{status}, {n} tickets", { status: t(col.label), n: list.length })}
                // Awaiting decision accepts the drop on purpose and refuses it in `drop` with a toast: a dropEffect of
                // "none" there made the browser skip the drop, so nothing said why the card went back (QA 19 Oct 2026).
                onDragOver={canEdit ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(col.key); } } : undefined}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
                onDrop={canEdit ? drop(col.key) : undefined}
                style={{ backgroundColor: col.lane, ...(over === col.key ? { boxShadow: `inset 0 0 0 1.5px ${system ? "var(--border)" : col.dot}` } : {}) }}
                className="flex w-[calc(100vw-2.5rem)] max-w-[22rem] shrink-0 snap-start flex-col rounded-lg transition-shadow md:h-full md:w-0 md:min-w-[15rem] md:max-w-none md:flex-1"
              >
                <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5" style={{ color: col.text }}>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: col.dot }} />
                  <h3 className="min-w-0 truncate text-sm font-semibold">{t(col.label)}</h3>
                  <span className="shrink-0 text-xs tabular-nums opacity-80">{list.length}</span>
                  {system && canEdit && (
                    <span className="ml-auto shrink-0" title={t("Set automatically when GIDEON answers or a correction is proposed")}>
                      <Lock aria-hidden className="h-3.5 w-3.5 opacity-60" />
                      <span className="sr-only">{t("Set automatically when GIDEON answers or a correction is proposed")}</span>
                    </span>
                  )}
                </header>
                <div className="flex min-h-16 flex-1 flex-col gap-1.5 px-1.5 pb-1.5 [scrollbar-width:thin] md:overflow-y-auto">
                  {list.map((c) => (
                    <TicketCard key={c.id} c={c} canEdit={canEdit} showReporter={showReporter} categoryLabel={categoryLabel} onOpen={onOpen} onMove={onMove} />
                  ))}
                  {list.length === 0 && (
                    <p className={cn("rounded-md px-2 py-3 text-xs", over === col.key && !system ? "border border-dashed text-center" : "opacity-70")} style={{ color: col.text, borderColor: over === col.key ? col.dot : undefined }}>
                      {over === col.key && !system ? t("Drop a ticket here") : t(col.empty)}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background via-background/70 to-transparent transition-opacity md:w-16", edges.start ? "opacity-100" : "opacity-0")} />
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-background via-background/70 to-transparent transition-opacity md:w-16", edges.end ? "opacity-100" : "opacity-0")} />
      {edges.start && (
        <button type="button" onClick={() => page(-1)} aria-label={t("Earlier columns")} className={cn(arrow, "left-3 md:left-4")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edges.end && (
        <button type="button" onClick={() => page(1)} aria-label={t("Later columns")} className={cn(arrow, "right-3 md:right-4")}>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** One ticket: title, category, reporter, comments, date; GIDEON replied / correction waiting as small icons. */
const TicketCard = memo(function TicketCard({
  c, canEdit, showReporter, categoryLabel, onOpen, onMove,
}: { c: Complaint; canEdit: boolean; showReporter: boolean; categoryLabel: (key: string) => string; onOpen: (id: string) => void; onMove: (id: string, status: string) => void }) {
  const { t } = useLang();
  const [dragging, setDragging] = useState(false);
  const who = c.reporter?.name ?? t("Former member");
  // The first message is the ticket's own text: the count is the replies after it.
  const replies = Math.max(0, (c.messageCount ?? 0) - 1);
  return (
    <article
      draggable={canEdit}
      data-ticket-card={c.id}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, c.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a,input,select,textarea,[role='dialog']")) onOpen(c.id); }}
      className={cn(
        "group relative shrink-0 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(15,15,15,0.05)] transition-[box-shadow,border-color,opacity] duration-150 hover:border-foreground/15 hover:shadow-[0_2px_8px_rgba(15,15,15,0.08)]",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* The title is a real button for the keyboard; the mouse can click anywhere on the card. */}
        <h4 className="min-w-0 flex-1 text-sm font-medium leading-snug">
          <button type="button" onClick={() => onOpen(c.id)} draggable={false} className="line-clamp-2 break-words text-left focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring">
            {c.subject}
          </button>
        </h4>
        {canEdit && <MoveMenu c={c} onMove={onMove} />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-1.5 py-px font-medium">{categoryLabel(c.category)}</span>
        {c.status === "CLOSED" && <span className="rounded-full bg-slate-100 px-1.5 py-px font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:ring-slate-500/30">{t("Closed")}</span>}
        {c.pendingCorrection && c.status !== "AWAITING_DECISION" && (
          <span className="inline-flex items-center" title={t("Correction awaiting decision")}>
            <CalendarClock aria-hidden className="h-3.5 w-3.5" /><span className="sr-only">{t("Correction awaiting decision")}</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
        {showReporter && (
          <span className="flex min-w-0 items-center gap-1.5">
            {c.reporter && <Avatar userId={c.reporter.id} name={c.reporter.name} avatar={c.reporter.avatar ?? null} size={18} />}
            <span className="min-w-0 truncate">{who}</span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
          {c.gideonReplied && (
            <span className="inline-flex items-center" title={t("GIDEON replied")}>
              <GideonMark className="h-3.5 w-3.5" /><span className="sr-only">{t("GIDEON replied")}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1" title={t("Replies")}><MessageSquare aria-hidden className="h-3 w-3" />{replies}</span>
          <span>{fmtShort(c.lastMessageAt)}</span>
        </span>
      </div>
    </article>
  );
});

/** ⇄ "Move to": the same as a drag, by keyboard or click (and on a phone without dragging). */
function MoveMenu({ c, onMove }: { c: Complaint; onMove: (id: string, status: string) => void }) {
  const { t } = useLang();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable={false}
          aria-label={t("Move {name} to another status", { name: c.subject })}
          title={t("Move to status")}
          className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("Move to status")}</p>
        {MOVE_TARGETS.map((m) => (
          <button
            key={m.status}
            type="button"
            disabled={m.status === c.status}
            onClick={() => onMove(c.id, m.status)}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:font-semibold disabled:hover:bg-transparent pointer-coarse:min-h-[44px]"
          >
            {t(m.label)}
            {m.status === c.status && <Check aria-hidden className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
