import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PIPELINE_STAGES, daysBetween, dealValue, stageGroupOf } from "@/lib/pipeline";
import { servicesOf, type PipelineDeal } from "@/lib/pipeline-api";
import { BlockerBanner, GROUP_TONE, HealthPill, PhaseTrack, fmtDayShort, fmtIdr, fmtIdrFull, personName, useReasonText, useVocabLabels } from "./pipeline-ui";

const DRAG_TYPE = "application/x-nexus-deal";

/** Inside a column: the most urgent first, then the biggest — the GM's order. */
const SEVERITY: Record<string, number> = { CRITICAL: 0, ATTENTION: 1, HEALTHY: 2, NOT_STARTED: 3, NONE: 4 };
export function bySeverity(a: PipelineDeal, b: PipelineDeal): number {
  return (SEVERITY[a.health.key] ?? 9) - (SEVERITY[b.health.key] ?? 9) || (b.netValue || 0) - (a.netValue || 0);
}

/**
 * The phase board: one column per stage, left to right from first contact to closed. Drag a card to
 * another column to move the deal there; the card's "Move" button (on hover or keyboard focus) does the
 * same without dragging, and on a phone the deal's Stage field does.
 *
 * Owner, 9 Oct 2026 ("UI UX ini rapihin dong, jelek bgt"): on a computer the board fills the window and
 * each column scrolls on its own under a fixed header (stage, count, total), so the header never leaves
 * the screen. The strip scrolls sideways with a visible edge fade and arrow buttons, by keyboard (the
 * strip takes focus; arrow keys), by shift + wheel, or by dragging the empty board with the mouse. On a
 * phone the columns are a full screen wide and snap one at a time.
 */
export function PipelineBoard({
  deals, today, onOpen, onMove, onAdd, canEdit,
}: {
  deals: PipelineDeal[];
  today: string;
  onOpen: (id: string) => void;
  onMove: (id: string, stage: string) => void;
  onAdd: (stage: string) => void;
  canEdit: boolean;
}) {
  const { t, lang } = useLang();
  const labels = useVocabLabels();
  const [over, setOver] = useState<string | null>(null);
  const byStage = new Map<string, PipelineDeal[]>(PIPELINE_STAGES.map((s) => [s, []]));
  for (const d of deals) {
    if (!byStage.has(d.stage)) byStage.set(d.stage, []);
    byStage.get(d.stage)!.push(d);
  }
  const drop = (stage: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const deal = deals.find((d) => d.id === id);
    if (deal && deal.stage !== stage) onMove(id, stage);
  };

  // Which edges have more board beyond them: drives the fades and the arrow buttons.
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
  }, [measure, deals.length]);
  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(300, el.clientWidth * 0.75), behavior: reduce ? "auto" : "smooth" });
  };

  // Drag the board itself sideways with the mouse — only from empty space, never from a card (that is
  // the card's own drag) or a control. Touch already pans natively.
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
  // A touchpad swipe sideways scrolls the board natively. A plain mouse wheel only moves up and down, so
  // over the board it moves sideways instead — unless the pointer is over a column that can still scroll
  // down/up itself (owner, 9 Oct 2026: "kenapa ga bisa scroll aja pake touchpad/mouse?"). Shift+wheel is
  // the browser's own sideways wheel and is left alone.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      let node = e.target as HTMLElement | null;
      while (node && node !== el) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
          const canMove = e.deltaY > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 0;
          if (canMove) return;
        }
        node = node.parentElement;
      }
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const endPan = (e: PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    pan.current = null;
    if (p?.moved && e.currentTarget.hasPointerCapture(p.id)) e.currentTarget.releasePointerCapture(p.id);
  };

  const arrow = "pointer-events-auto absolute top-1/2 z-20 -translate-y-1/2 hidden h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-pop transition-[opacity,transform] hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring md:grid";

  return (
    <div className="relative -mx-4 md:-mx-8">
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={t("Pipeline board. Scrolls sideways: arrow keys, or drag the empty space.")}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className="snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-3 md:cursor-grab outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 md:snap-none md:px-8"
      >
        <div className="flex w-max gap-3 md:h-[max(28rem,calc(100dvh-13rem))]">
          {[...byStage.entries()].map(([stage, list]) => {
            const total = list.reduce((sum, d) => sum + dealValue(d), 0);
            const sorted = [...list].sort(bySeverity);
            const group = stageGroupOf(stage);
            return (
              <section
                key={stage}
                aria-label={t("{stage}, {n} deals", { stage: labels.stage(stage), n: list.length })}
                onDragOver={canEdit ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(stage); } } : undefined}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
                onDrop={canEdit ? drop(stage) : undefined}
                className={cn(
                  "flex w-[calc(100vw-2.5rem)] max-w-[22rem] shrink-0 snap-start flex-col rounded-2xl border bg-muted/40 transition-colors md:h-full md:w-[18rem] md:max-w-none",
                  over === stage ? "border-primary/60 bg-accent/60" : "border-border/70",
                )}
              >
                <header className="flex items-start gap-2 px-3 pb-2 pt-2.5">
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-2 text-sm font-semibold leading-6">
                      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", GROUP_TONE[group])} />
                      <span className="truncate">{labels.stage(stage)}</span>
                      <span className="shrink-0 rounded-md bg-background px-1.5 text-xs font-semibold leading-5 tabular-nums text-muted-foreground ring-1 ring-border">{list.length}</span>
                    </h3>
                    {/* Same height in every column, so the first cards line up across the board. */}
                    <p className="h-4 pl-4 text-xs leading-4 tabular-nums text-muted-foreground" title={total > 0 ? fmtIdrFull(total, lang) : undefined}>
                      {total > 0 ? fmtIdr(total, lang) : ""}
                    </p>
                  </div>
                  {canEdit && stage !== "Lost / Cancelled" && (
                    <button
                      type="button"
                      onClick={() => onAdd(stage)}
                      aria-label={t("Add a deal in {stage}", { stage: labels.stage(stage) })}
                      title={t("Add a deal in {stage}", { stage: labels.stage(stage) })}
                      className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-10"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </header>
                <div className="flex min-h-16 flex-1 flex-col gap-2 overscroll-y-contain px-2 pb-2 [scrollbar-width:thin] md:overflow-y-auto">
                  {sorted.map((d) => (
                    <DealCard key={d.id} deal={d} today={today} onOpen={onOpen} onMove={onMove} canEdit={canEdit} />
                  ))}
                  {sorted.length === 0 && (
                    <p className={cn("rounded-xl px-2 py-3 text-xs text-muted-foreground/80", over === stage && "border border-dashed border-primary/50 text-center text-foreground")}>
                      {over === stage ? t("Drop a deal here") : t("No deals")}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Edges: a fade where more board is hidden, and a button to page to it (a computer; a phone swipes). */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background via-background/70 to-transparent transition-opacity md:w-16", edges.start ? "opacity-100" : "opacity-0")} />
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-background via-background/70 to-transparent transition-opacity md:w-16", edges.end ? "opacity-100" : "opacity-0")} />
      {edges.start && (
        <button type="button" onClick={() => page(-1)} aria-label={t("Earlier stages")} className={cn(arrow, "left-3 md:left-4")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edges.end && (
        <button type="button" onClick={() => page(1)} aria-label={t("Later stages")} className={cn(arrow, "right-3 md:right-4")}>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * A card, the GM's layout (owner, 9 Oct 2026, from his "Control Tower" screenshot: "blocker status di board
 * tiap dealnya belum ada"): code and health pill on top, the name, brand and value, the six-segment phase
 * bar on EVERY deal (grey = not started, which is worth seeing on an open deal too), the blocker as a
 * banner whenever one is written (else the first health reason), then PM (and BD when different) and the
 * services. "No PM yet" on a won deal; the next action's date when there is one.
 */
const DealCard = memo(function DealCard({
  deal, today, onOpen, onMove, canEdit,
}: { deal: PipelineDeal; today: string; onOpen: (id: string) => void; onMove: (id: string, stage: string) => void; canEdit: boolean }) {
  const { t, lang, locale } = useLang();
  const reason = useReasonText();
  const [dragging, setDragging] = useState(false);
  const pm = personName(deal.pm, deal.pmName);
  const bd = personName(deal.bd, deal.bdName);
  const value = dealValue(deal);
  const group = stageGroupOf(deal.stage);
  const flagged = deal.health.key === "CRITICAL" || deal.health.key === "ATTENTION";
  const hasBlocker = !!deal.blocker?.trim();
  // The blocker banner already says the blocker; otherwise the first reason the deal is flagged.
  const firstReason = flagged && !hasBlocker ? deal.health.reasons[0] : undefined;
  const moreReasons = firstReason ? deal.health.reasons.length - 1 : 0;
  const live = group !== "Closed" && group !== "Lost";
  const due = live && deal.nextActionDate ? daysBetween(today, deal.nextActionDate) : null;
  const needsPm = !pm && (group === "Pre-Execution" || group === "Execution");
  const people = [pm && { role: "PM", name: pm, avatar: deal.pm?.avatar ?? null }, bd && bd !== pm && { role: "BD", name: bd, avatar: deal.bd?.avatar ?? null }]
    .filter((x): x is { role: string; name: string; avatar: string | null } => !!x);
  const services = servicesOf(deal).join(", ");
  const hasFooter = people.length > 0 || due !== null || needsPm || !!services;
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, deal.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
      onDragEnd={() => setDragging(false)}
      // A click anywhere on the card opens the deal. This used to be the title button stretched over the
      // whole card, but a drag that starts on a <button> never starts in Chrome — so no card could be
      // dragged to another stage (owner, 9 Oct 2026). Clicks on the card's own controls are theirs.
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a,input,select,textarea,[role='dialog']")) onOpen(deal.id); }}
      className={cn(
        "group relative shrink-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-soft transition-[box-shadow,border-color,opacity] hover:border-control-border hover:shadow-pop",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-semibold tabular-nums text-muted-foreground">{deal.code}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {deal.health.key !== "NONE" && <HealthPill health={deal.health.key} />}
          {canEdit && <MoveMenu deal={deal} onMove={onMove} />}
        </span>
      </div>
      {/* The title stays a real button for the keyboard; the mouse can click anywhere (see onClick above). */}
      <h4 className="mt-1 text-sm font-semibold leading-snug">
        <button
          type="button"
          onClick={() => onOpen(deal.id)}
          draggable={false}
          className="pointer-events-none line-clamp-2 text-left focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring"
        >
          {deal.name || t("Untitled deal")}
        </button>
      </h4>
      {(deal.brand || value > 0) && (
        <div className="mt-0.5 flex items-baseline gap-2 text-xs">
          {deal.brand && <span className="min-w-0 truncate text-muted-foreground">{deal.brand}</span>}
          {value > 0 && (
            <span title={fmtIdrFull(value, lang)} className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">{fmtIdr(value, lang)}</span>
          )}
        </div>
      )}
      <PhaseTrack deal={deal} className="mt-2.5" />
      <BlockerBanner deal={deal} lines={2} className="mt-2" />
      {firstReason && (
        <p className={cn("mt-2 flex items-start gap-1.5 text-xs", deal.health.key === "CRITICAL" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300")}>
          <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">
            {reason(firstReason)}
            {moreReasons > 0 && <span className="ml-1 opacity-70">{t("+{n} more", { n: moreReasons })}</span>}
          </span>
        </p>
      )}
      {hasFooter && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2 text-xs">
          {people.length > 0 && (
            <span className="flex shrink-0 -space-x-1.5" title={people.map((p) => `${p.role}: ${p.name}`).join(" · ")}>
              {people.map((p) => <AvatarFace key={p.role} name={p.name} avatar={p.avatar} size={20} decorative className="ring-2 ring-card" />)}
            </span>
          )}
          {needsPm ? (
            <span className="min-w-0 truncate font-medium text-red-700 dark:text-red-300">{t("No PM yet")}</span>
          ) : people.length > 0 ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {people.map((p, i) => (
                <span key={p.role}>{i > 0 && " · "}<span className="sr-only">{p.role}: </span>{p.name}</span>
              ))}
            </span>
          ) : null}
          <span className="ml-auto flex min-w-0 shrink items-center gap-1.5">
            {due !== null && (
              <span
                title={deal.nextAction ? `${t("Next action")}: ${deal.nextAction}` : t("Next action date")}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums",
                  due < 0 ? "bg-destructive/10 font-medium text-red-700 dark:text-red-300"
                    : due === 0 ? "bg-warning/15 font-medium text-amber-800 dark:text-amber-300"
                      : "text-muted-foreground",
                )}
              >
                <CalendarClock aria-hidden className="h-3 w-3" />
                {due === 0 ? t("Today") : fmtDayShort(deal.nextActionDate, locale)}
              </span>
            )}
            {services && <span title={services} className="min-w-0 max-w-[9rem] truncate text-right text-muted-foreground">{services}</span>}
          </span>
        </div>
      )}
    </article>
  );
});

/**
 * The card's ⇄ "Move to stage" menu: the same as a drag, by keyboard or click. It sits in the card's top
 * row next to the health pill (shown on hover / focus) so it never covers the pill.
 */
function MoveMenu({ deal, onMove }: { deal: PipelineDeal; onMove: (id: string, stage: string) => void }) {
  const { t } = useLang();
  const labels = useVocabLabels();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable={false}
          aria-label={t("Move {name} to another stage", { name: deal.name })}
          title={t("Move to stage")}
          className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:hidden"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t("Move to stage")}</p>
        {PIPELINE_STAGES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={s === deal.stage}
            onClick={() => onMove(deal.id, s)}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:font-semibold disabled:hover:bg-transparent pointer-coarse:min-h-[44px]"
          >
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", GROUP_TONE[stageGroupOf(s)])} />
              {labels.stage(s)}
            </span>
            {s === deal.stage && <Check aria-hidden className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
