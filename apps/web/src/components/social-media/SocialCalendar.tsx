import { useMemo } from "react";
import { NotebookPen, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAPS } from "@/components/calendar/bits";
import { useLang } from "@/lib/lang";
import { MarkerLegend, dayLong, monthLabel } from "@/components/outlet-sales/outlet-ui";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import type { SocialMonthResponse } from "@/lib/social-media-api";
import { num } from "./social-ui";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The 42 days shown for a month: Monday first, six weeks, as the NEXUS Calendar and the outlet. */
function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * The report's month (owner, 14 Oct 2026): every day with its engagement (all platforms) and posts, a mark
 * on a day with notes or its own target. A day opens its sheet: figures per platform, notes, day targets.
 */
export function SocialCalendar({ data, onOpen }: { data: SocialMonthResponse; onOpen: (date: string) => void }) {
  const { t, tn, lang, locale } = useLang();
  const coarse = useCoarsePointer();
  const cells = useMemo(() => monthGrid(data.month), [data.month]);
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const custom = useMemo(() => new Set(data.dayTargets.map((d) => d.date)), [data.dayTargets]);
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(`2026-10-${String(5 + i).padStart(2, "0")}T00:00:00`).toLocaleDateString(locale, { weekday: "short" })),
    [locale],
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={monthLabel(data.month, locale)} className="overflow-clip rounded-xl border border-border bg-card">
        <div aria-hidden className="grid grid-cols-7 border-b border-border bg-muted/40">
          {/* One month-grid style (UI tour run 15, R15-WB-3): "MON TUE" as the Calendar writes them. */}
          {weekdays.map((w) => <div key={w} className={cn("truncate px-1.5 py-2 text-left text-muted-foreground sm:px-2", CAPS)}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d.slice(0, 7) === data.month;
            const day = inMonth ? byDate.get(d) : undefined;
            const isToday = d === data.today;
            const future = d > data.today;
            const notes = !!day && (day.worked !== "" || day.didntWork !== "");
            const hasTarget = inMonth && custom.has(d);
            const label = [
              dayLong(d, locale, data.today.slice(0, 4)),
              day && day.engagement !== null ? t("{n} engagement", { n: num(day.engagement, lang) }) : "",
              day && day.posts !== null ? tn(day.posts, "1 post", "{n} posts") : "",
              notes ? t("Has notes") : "",
              hasTarget ? t("Own daily target") : "",
              isToday ? t("Today") : "",
              inMonth && !day?.recorded && !future ? t("Not recorded") : "",
            ].filter(Boolean).join(", ");
            return (
              <button
                key={d}
                type="button"
                disabled={!inMonth}
                aria-label={label}
                onClick={() => onOpen(d)}
                className={cn(
                  "relative flex min-h-[3.75rem] min-w-0 flex-col items-stretch gap-0.5 border-border p-1 text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:min-h-[6rem] sm:p-1.5",
                  i % 7 !== 6 && "border-r",
                  i < 35 && "border-b",
                  inMonth ? "bg-card hover:bg-muted/40" : "bg-muted/30 text-muted-foreground/50",
                  future && inMonth && "text-muted-foreground",
                )}
              >
                {/* Date top-left on every width, as on every month grid (UI tour run 15, R15-WB-3). A phone's cell is too
                    narrow for the marks beside it, so there they get their own row under it. */}
                <span className="flex items-center justify-start gap-1 sm:justify-between">
                  {/* The day-target mark right after the date number, neutral, on every width (decision 12, UI tour
                      run 20): not in the corner, not in the accent colour. */}
                  <span className="flex min-w-0 items-center gap-0.5 pr-0.5">
                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs tabular-nums", isToday && "bg-cal-accent font-semibold text-cal-accent-foreground dark:bg-primary dark:text-primary-foreground")}>
                      {Number(d.slice(8))}
                    </span>
                    {hasTarget && <Target aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </span>
                  <span aria-hidden className="hidden items-center gap-0.5 text-muted-foreground sm:flex">
                    {notes && <NotebookPen className="h-3 w-3" />}
                  </span>
                </span>
                {notes && (
                  <span aria-hidden className="flex items-center gap-0.5 text-muted-foreground sm:hidden">
                    <NotebookPen className="h-3 w-3" />
                  </span>
                )}
                {day && day.engagement !== null && (
                  <span aria-hidden className="truncate text-left text-xs font-semibold tabular-nums text-foreground sm:text-sm">
                    {/* Plain dotted count, never "3k" / "2.2k" (UI tour run 14, R14-WB-2). */}
                    {num(day.engagement, lang)}
                  </span>
                )}
                {/* On a phone too (UI tour run 13, W-M14): the posts were dropped below sm. */}
                {day && day.posts !== null && (
                  <span aria-hidden className="truncate text-left text-[10px] tabular-nums text-muted-foreground sm:text-[11px]">
                    {tn(day.posts, "1 post", "{n} posts")}
                  </span>
                )}
                {inMonth && !future && !day?.recorded && (
                  <span aria-hidden className="mt-auto h-1.5 w-1.5 rounded-full border border-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <MarkerLegend
        items={[
          { mark: <Target className="h-3 w-3 text-muted-foreground" />, label: t("Day target") },
          { mark: <NotebookPen className="h-3 w-3" />, label: t("Note") },
          { mark: <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground" />, label: t("Not recorded") },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {t("Each day shows its engagement (likes + comments + shares) across platforms, and the posts published.")}{" "}
        {coarse ? t("Tap a day to record it.") : t("Click a day to record it.")}
      </p>
    </div>
  );
}
