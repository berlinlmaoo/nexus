import { memo, useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, type CalIndex, type DayCell } from "@/lib/calendar/core";
import { fmtDay, UnitDot, weekdayNames } from "./bits";

/** Keys that move the selected day while a day of the grid has focus (and only then). */
const MOVE: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, "[": -1, "]": 1 };

/**
 * The month: Monday first, always six weeks. One dot per unit at the focus level that has a task that
 * day (filled = still something to do, ring = only done / status-less), in Bagan order — the same order as the legend.
 * Desktop also shows the day's count; a red bar under the number = a task overdue (within the window)
 * is due that day. Days of other months sit on a muted background and carry no dots.
 * `fill` = the grid stretches its six rows over the height it is given (the desktop pane), so a whole
 * month fits a laptop screen; otherwise each row has a fixed minimum height and the page scrolls.
 * Hovering a legend chip dims the other units' dots through CSS (CalendarPage), via data-unit.
 */
export const MonthGrid = memo(function MonthGrid({
  days, month, cells, selected, today, holidays, ix, onSelect, busy, compact, fill = false,
}: {
  days: string[]; month: string; cells: Map<string, DayCell>; selected: string; today: string
  holidays: Map<string, string>; ix: CalIndex
  onSelect: (day: string) => void; busy: boolean; compact: boolean; fill?: boolean
}) {
  const { t, locale, lang } = useLang();
  const names = weekdayNames(locale);
  const maxDots = compact ? 3 : 4;
  const gridRef = useRef<HTMLDivElement>(null);
  // Arrow keys on a day keep the keyboard focus on the newly selected day.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[role="gridcell"][data-day="${selected}"]`)?.focus();
  }, [selected]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const delta = MOVE[e.key];
    const from = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-day]')?.dataset.day;
    if (delta === undefined || !from) return;
    e.preventDefault();
    refocus.current = true;
    onSelect(addDays(from, delta));
  };
  return (
    <div
      ref={gridRef}
      role="grid"
      data-cal-grid=""
      aria-label={fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale)}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      // overflow-clip, not hidden: rounds the corners without making the grid a scroll container, so in
      // `fill` mode it keeps its content height as a minimum and the pane scrolls instead of the rows overlapping.
      className={cn("overflow-clip rounded-2xl border border-border bg-card shadow-soft", fill && "flex flex-1 flex-col")}
    >
      <div role="row" className="relative grid grid-cols-7 border-b border-border bg-muted/40">
        {names.map((n, i) => (
          <div key={i} role="columnheader" className={cn("min-w-0 overflow-hidden whitespace-nowrap py-2 text-center text-2xs font-semibold uppercase text-muted-foreground md:text-left", compact ? "px-0" : "px-2 tracking-wide")}>{n}</div>
        ))}
        {/* Another month is loading: a bar under the weekday names, not faded text. */}
        {busy && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-cal-accent/50 motion-safe:animate-pulse" />}
      </div>
      <div className={cn("grid grid-cols-7", fill && "flex-1 grid-rows-[repeat(6,minmax(min-content,1fr))]")}>
        {Array.from({ length: 6 }, (_, w) => (
        <div key={w} role="row" className="contents">
        {days.slice(w * 7, w * 7 + 7).map((day, j) => {
          const i = w * 7 + j;
          const inMonth = day.slice(0, 7) === month;
          const cell = inMonth ? cells.get(day) : undefined;
          const isToday = day === today;
          const isSel = day === selected;
          const holiday = holidays.get(day);
          const weekend = i % 7 >= 5;
          const dots = cell?.dots ?? [];
          const shown = dots.slice(0, maxDots);
          const more = dots.length - shown.length;
          const label = [
            fmtDay(day, { weekday: "long", day: "numeric", month: "long" }, locale),
            cell?.count ? t(cell.count === 1 ? "{n} task" : "{n} tasks", { n: cell.count }) : t("No tasks"),
            cell?.overdue ? t("Overdue") : "",
            holiday ?? "",
            isToday ? t("Today") : "",
          ].filter(Boolean).join(", ");
          const button = (
            <button
              type="button"
              role="gridcell"
              aria-selected={isSel}
              tabIndex={isSel ? 0 : -1}
              aria-label={label}
              data-day={day}
              onClick={() => onSelect(day)}
              className={cn(
                "group relative flex min-w-0 flex-col items-stretch border-b border-r border-border/70 p-1.5 text-left outline-none transition-colors md:p-2",
                fill ? "min-h-16" : compact ? "min-h-13" : "min-h-22 lg:min-h-25",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                // Days of other months are quieter through their background only: their number stays
                // readable (muted text, ≥4.5:1) and they remain buttons that select the day.
                !inMonth ? "bg-muted/40" : weekend && "bg-muted/25",
                "hover:bg-cal-accent/[0.06] focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-cal-accent",
                isSel && "z-[1] ring-2 ring-inset ring-cal-accent",
              )}
            >
              <span className={cn("flex items-start gap-1", compact ? "justify-center" : "justify-between")}>
                <span className={cn(
                  "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold tabular-nums md:h-7 md:min-w-7 md:text-sm",
                  isToday ? "bg-cal-accent text-cal-accent-foreground"
                    : !inMonth ? "text-muted-foreground"
                    : holiday ? "text-rose-700 dark:text-rose-300" : "text-foreground",
                )}>
                  {+day.slice(8)}
                </span>
                {!compact && cell && cell.count > 0 && <span className="pt-1 text-2xs font-semibold tabular-nums text-muted-foreground">{cell.count}</span>}
              </span>
              {cell?.overdue && <span aria-hidden className={cn("mt-0.5 h-[2px] w-4 rounded-full bg-rose-500", compact && "mx-auto")} />}
              {!compact && holiday && (
                <span className={cn("mt-0.5 line-clamp-1 text-2xs font-medium", inMonth ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>{holiday}</span>
              )}
              <span className={cn("mt-auto flex flex-wrap items-center gap-[3px] pt-1", compact && "justify-center")}>
                {shown.map((d) => (
                  <span key={d.unitId} data-unit={d.unitId} className={cn("inline-flex transition-opacity", busy && "opacity-40")}>
                    <UnitDot unit={ix.byId.get(d.unitId)} filled={d.filled} size={compact ? 6 : 7} />
                  </span>
                ))}
                {more > 0 && <span className="text-2xs font-bold leading-none text-muted-foreground">+{more}</span>}
              </span>
            </button>
          );
          if (compact || !cell || cell.count === 0) return <div key={day} className="contents">{button}</div>;
          return (
            <div key={day} className="contents">
              <Tooltip delayDuration={350}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent lang={lang} side="top" className="max-w-[16.25rem]">
                  <div className="text-xs font-semibold">{fmtDay(day, { weekday: "short", day: "numeric", month: "short" }, locale)} · {t(cell.count === 1 ? "{n} task" : "{n} tasks", { n: cell.count })}</div>
                  <div className="mt-0.5 text-2xs opacity-80">
                    {cell.dots.map((d) => `${d.unitId === "other" ? t("Other") : (ix.byId.get(d.unitId)?.name ?? "?")} ${d.count}`).join(" · ")}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        </div>
        ))}
      </div>
    </div>
  );
});
