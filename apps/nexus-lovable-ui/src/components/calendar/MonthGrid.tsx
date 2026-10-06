import { memo } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CalIndex, DayCell } from "@/lib/calendar/core";
import { fmtDay, UnitDot, weekdayNames } from "./bits";

/**
 * The month: Monday first, always six weeks. One dot per unit at the focus level that has a task that
 * day (filled = still something to do, ring = only done / status-less), in Bagan order — the same order as the legend.
 * Desktop also shows the day's count; a red bar under the number = a task overdue (within the window)
 * is due that day. Days of other months are faded and carry no dots.
 */
export const MonthGrid = memo(function MonthGrid({
  days, month, cells, selected, today, holidays, ix, hoverUnit, onSelect, busy, compact,
}: {
  days: string[]; month: string; cells: Map<string, DayCell>; selected: string; today: string
  holidays: Map<string, string>; ix: CalIndex; hoverUnit: string | null
  onSelect: (day: string) => void; busy: boolean; compact: boolean
}) {
  const { t, locale } = useLang();
  const names = weekdayNames(locale, "short");
  const maxDots = compact ? 3 : 4;
  return (
    <div role="grid" aria-label={fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale)} className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-opacity", busy && "opacity-60")}>
      <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/40">
        {names.map((n, i) => (
          <div key={i} role="columnheader" className={cn("px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:text-left", i >= 5 && "text-muted-foreground/70")}>{n}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
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
                compact ? "min-h-[52px]" : "min-h-[88px] lg:min-h-[100px]",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                weekend && "bg-muted/25",
                !inMonth && "opacity-40",
                "hover:bg-[#1e3a5f]/[0.04] dark:hover:bg-white/[0.04] focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#1e3a5f] dark:focus-visible:outline-[#9fb6d6]",
                isSel && "z-[1] ring-2 ring-inset ring-[#1e3a5f] dark:ring-[#9fb6d6]",
              )}
            >
              <span className={cn("flex items-start gap-1", compact ? "justify-center" : "justify-between")}>
                <span className={cn(
                  "grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12.5px] font-semibold tabular-nums md:h-7 md:min-w-7 md:text-[13px]",
                  isToday ? "bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : holiday ? "text-rose-600 dark:text-rose-400" : "text-foreground",
                )}>
                  {+day.slice(8)}
                </span>
                {!compact && cell && cell.count > 0 && <span className="pt-1 text-[11px] font-semibold tabular-nums text-muted-foreground">{cell.count}</span>}
              </span>
              {cell?.overdue && <span aria-hidden className={cn("mt-0.5 h-[2px] w-4 rounded-full bg-rose-500", compact && "mx-auto")} />}
              {!compact && holiday && <span className="mt-0.5 line-clamp-1 text-[10px] font-medium text-rose-600/90 dark:text-rose-400/90">{holiday}</span>}
              <span className={cn("mt-auto flex flex-wrap items-center gap-[3px] pt-1", compact && "justify-center")}>
                {shown.map((d) => (
                  <UnitDot key={d.unitId} unit={ix.byId.get(d.unitId)} filled={d.filled} size={compact ? 6 : 7} dim={!!hoverUnit && hoverUnit !== d.unitId} />
                ))}
                {more > 0 && <span className="text-[9.5px] font-bold leading-none text-muted-foreground">+{more}</span>}
              </span>
            </button>
          );
          if (compact || !cell || cell.count === 0) return <div key={day} className="contents">{button}</div>;
          return (
            <div key={day} className="contents">
              <Tooltip delayDuration={350}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  <div className="text-[12px] font-semibold">{fmtDay(day, { weekday: "short", day: "numeric", month: "short" }, locale)} · {t(cell.count === 1 ? "{n} task" : "{n} tasks", { n: cell.count })}</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
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
