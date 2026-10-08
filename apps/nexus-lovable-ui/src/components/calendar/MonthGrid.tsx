import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, mondayOf, shiftMonth, type CalIndex, type MonthCell } from "@/lib/calendar/core";
import { CAPS, fmtDay, UnitDot, weekdayNames } from "./bits";

/** A public holiday's day number where its name does not fit: a dotted underline, so colour is not the only cue. */
export const HOLIDAY_CUE = "underline decoration-dotted decoration-[1.5px] underline-offset-[3px]";

/**
 * Where a key pressed on a day moves the selection, as the APG date grid has it: the arrows and [ ] by a
 * day or a week, Home / End to the first / last day of that week, PageUp / PageDown by a month (with
 * Shift, a year). null = not a key of the grid.
 */
function keyTarget(day: string, e: KeyboardEvent): string | null {
  switch (e.key) {
    case "ArrowLeft": case "[": return addDays(day, -1);
    case "ArrowRight": case "]": return addDays(day, 1);
    case "ArrowUp": return addDays(day, -7);
    case "ArrowDown": return addDays(day, 7);
    case "Home": return mondayOf(day);
    case "End": return addDays(mondayOf(day), 6);
    case "PageUp": return shiftMonth(day, e.shiftKey ? -12 : -1);
    case "PageDown": return shiftMonth(day, e.shiftKey ? 12 : 1);
    default: return null;
  }
}

/** Weekday names Monday…Sunday at another width than weekdayNames' short one. */
function weekdays(locale: string, weekday: "narrow" | "long"): string[] {
  // 2026-10-05 is a Monday.
  return Array.from({ length: 7 }, (_, i) => fmtDay(`2026-10-${String(5 + i).padStart(2, "0")}`, { weekday }, locale));
}

/**
 * The month: Monday first, always six weeks. One dot per unit at the focus level that has a task that
 * day (filled = still something to do, tick = only done / status-less), in Bagan order — the same order as the legend.
 * Desktop also shows the day's count; a red bar under the number = a task overdue (within the window)
 * is due that day. Days of other months sit on a muted background and carry no dots.
 * `fill` = the grid stretches its six rows over the height it is given (the desktop pane), so a whole
 * month fits a laptop screen; otherwise each row has a fixed minimum height and the page scrolls.
 * Hovering a legend chip dims the other units' dots through CSS (CalendarPage), via data-unit.
 *
 * A screen reader hears what the marks show: the label gives the count and how many are still to do,
 * and a description (aria-describedby, on every screen size) names each division with its count, saying
 * which ones only have done or status-less tasks (the ticks). The tooltip is for the pointer only.
 */
export const MonthGrid = memo(function MonthGrid({
  days, month, cells, selected, today, holidays, ix, onSelect, busy, compact, fill = false, refocus,
}: {
  days: string[]; month: string; cells: Map<string, MonthCell>; selected: string; today: string
  holidays: Map<string, string>; ix: CalIndex
  onSelect: (day: string) => void; busy: boolean; compact: boolean; fill?: boolean
  /** The page sets it before a shortcut pressed on a day (T, J / K) selects another one: focus follows. */
  refocus?: MutableRefObject<boolean>
}) {
  const { t, tn, locale, lang } = useLang();
  const names = weekdayNames(locale);
  const narrow = useMemo(() => weekdays(locale, "narrow"), [locale]);
  const long = useMemo(() => weekdays(locale, "long"), [locale]);
  const maxDots = compact ? 3 : 4;
  const gridRef = useRef<HTMLDivElement>(null);
  const descId = useId();
  const unitName = (unitId: string) => (unitId === "other" ? t("Other") : (ix.byId.get(unitId)?.name ?? "?"));
  // A key pressed on a day keeps the keyboard focus on the newly selected day, also when that day is in
  // another month (the days are keyed by date, so the cell that had focus is gone then).
  const ownRefocus = useRef(false);
  const want = refocus ?? ownRefocus;
  useEffect(() => {
    if (!want.current) return;
    want.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[role="gridcell"][data-day="${selected}"]`)?.focus();
  }, [selected, want]);
  // Every day is the same element tree (a tooltip trigger), with the tooltip held open from here and
  // drawn only for a day with tasks: a poll that gives a day its first task, or takes its last, must not
  // remount the cell that has the keyboard focus.
  const [tipDay, setTipDay] = useState<string | null>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>('[role="gridcell"][data-day]')?.dataset.day;
    const to = from ? keyTarget(from, e) : null;
    if (!from || !to) return;
    e.preventDefault();
    if (to === from) return;
    want.current = true;
    onSelect(to);
  };
  return (
    <div
      ref={gridRef}
      role="grid"
      data-cal-grid=""
      data-cal-region="grid"
      aria-label={fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale)}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      // overflow-clip, not hidden: rounds the corners without making the grid a scroll container, so in
      // `fill` mode it keeps its content height as a minimum and the pane scrolls instead of the rows overlapping.
      className={cn("overflow-clip rounded-2xl border border-border bg-card shadow-soft", fill && "flex flex-1 flex-col")}
    >
      {/* A container: under ~13rem (a large text size on a phone) "SEN SEL RAB" no longer fits and each
          day is named by one letter, as a printed calendar has it. Screen readers get the full name. */}
      <div role="row" className="@container relative grid grid-cols-7 border-b border-border bg-muted/40">
        {names.map((n, i) => (
          <div key={i} role="columnheader" className={cn("min-w-0 overflow-hidden whitespace-nowrap py-2 text-muted-foreground", CAPS, compact ? "px-0.5 text-center" : "px-2 text-left")}>
            <span aria-hidden className="@max-[13rem]:hidden">{n}</span>
            <span aria-hidden className="hidden @max-[13rem]:inline">{narrow[i]}</span>
            <span className="sr-only">{long[i]}</span>
          </div>
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
          const tip = !compact && !!cell && cell.count > 0;
          const label = [
            fmtDay(day, { weekday: "long", day: "numeric", month: "long" }, locale),
            cell?.count ? `${tn(cell.count, "{n} task", "{n} tasks")}, ${t("{n} still to do", { n: cell.open })}` : t("No tasks"),
            cell?.overdue ? t("Overdue") : "",
            holiday ?? "",
            isToday ? t("Today") : "",
          ].filter(Boolean).join(", ");
          const described = !!cell && cell.dots.length > 0;
          return (
            <div key={day} className="contents">
              <Tooltip delayDuration={350} open={tip && tipDay === day} onOpenChange={(o) => setTipDay((cur) => (o && tip ? day : cur === day ? null : cur))}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="gridcell"
                    aria-selected={isSel}
                    tabIndex={isSel ? 0 : -1}
                    aria-label={label}
                    // Wins over the tooltip's own describedby (the child's props win in Radix's Slot): the
                    // same names and counts, and the done-only divisions too.
                    aria-describedby={described ? `${descId}${day}` : undefined}
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
                          : holiday ? "text-cal-holiday" : "text-foreground",
                        compact && inMonth && holiday && HOLIDAY_CUE,
                      )}>
                        {+day.slice(8)}
                      </span>
                      {!compact && cell && cell.count > 0 && <span className="pt-1 text-2xs font-semibold tabular-nums text-muted-foreground">{cell.count}</span>}
                    </span>
                    {cell?.overdue && <span aria-hidden className={cn("mt-0.5 h-[2px] w-4 rounded-full bg-cal-overdue", compact && "mx-auto")} />}
                    {!compact && holiday && (
                      <span className={cn("mt-0.5 line-clamp-1 text-2xs font-medium", inMonth ? "text-cal-holiday" : "text-muted-foreground")}>{holiday}</span>
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
                </TooltipTrigger>
                {tip && (
                  <TooltipContent lang={lang} side="top" className="max-w-[16.25rem]">
                    <div className="text-xs font-semibold">{fmtDay(day, { weekday: "short", day: "numeric", month: "short" }, locale)} · {tn(cell.count, "{n} task", "{n} tasks")}</div>
                    <div className="mt-0.5 text-2xs opacity-80">
                      {cell.dots.map((d) => `${unitName(d.unitId)} ${d.count}`).join(" · ")}
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          );
        })}
        </div>
        ))}
      </div>
      {/* The days' descriptions: hidden, so they are read only through each day's aria-describedby (a
          hidden element still gives its text that way), never a second time while browsing, and they
          stay out of the grid's rows, which may hold cells only. */}
      <div hidden>
        {days.map((day) => {
          const cell = day.slice(0, 7) === month ? cells.get(day) : undefined;
          if (!cell || cell.dots.length === 0) return null;
          return (
            <span key={day} id={`${descId}${day}`}>
              {cell.dots.map((d) => {
                const part = tn(d.count, "{unit}, {n} task", "{unit}, {n} tasks", { unit: unitName(d.unitId) });
                return d.filled ? part : `${part}, ${t("all done or without a status")}`;
              }).join("; ")}
            </span>
          );
        })}
      </div>
    </div>
  );
});
