import { memo } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyState } from "@/components/EmptyState";
import type { CalIndex, CalItem, WeekRow } from "@/lib/calendar/core";
import { overdueState } from "@/lib/calendar/core";
import { Face, FOCUS_ROW, fmtDay, StatusGlyph, unitVars, UnitMark, weekdayNames, type PeopleLookup } from "./bits";

const COLS = "grid grid-cols-[minmax(170px,220px)_repeat(7,minmax(0,1fr))]";
/** The header row's tint, made opaque so rows scrolling under it (and under the name column) stay hidden. */
const HEAD_BG = "bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";

/**
 * "People": one week, a row per person under their Bagan card (Bagan order), a column per day.
 * Desktop/tablet = a table (two task chips per cell, then "+N"; a click opens that day in the month
 * with the person lens). Phone = a list: card › person › their tasks of the week with the day in front.
 */
export const PeopleWeek = memo(function PeopleWeek({
  rows, days, today, nowMs, windowDays, ix, people, onOpenDay, onOpen, compact,
}: {
  rows: WeekRow[]; days: string[]; today: string; nowMs: number; windowDays: number; ix: CalIndex
  people: PeopleLookup; onOpenDay: (day: string) => void; onOpen: (i: CalItem) => void; compact: boolean
}) {
  const { t, locale } = useLang();
  const names = weekdayNames(locale);
  if (rows.length === 0) {
    return <EmptyState icon={Users} tone="muted" title={t("Nobody has a task this week")} message={t("Pick another week, or reset the filters.")} />;
  }
  if (compact) {
    return (
      <div className="space-y-2">
        {rows.map((r, idx) => {
          if (r.kind === "unplaced") return <div key={`x${idx}`} className="px-1 pt-2 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("Not in the chart yet · {n}", { n: r.count })}</div>;
          if (r.kind === "unit") {
            const u = r.unit;
            if (u.kind === "GROUP") return <div key={`u${idx}`} className="px-1 pt-2 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground" style={{ paddingLeft: 4 + r.depth * 10 }}>{u.name} · {r.count}</div>;
            return (
              <div key={`u${idx}`} style={{ ...unitVars(u), marginLeft: r.depth * 10 }} className="flex items-center gap-2 rounded-xl border-l-[3px] border-[var(--c)] bg-card px-2.5 py-2 shadow-soft dark:border-[var(--cd)]">
                <UnitMark unit={u} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.06em]">{u.name}</span>
                <span className="text-xs font-bold tabular-nums text-muted-foreground">{r.count}</span>
              </div>
            );
          }
          const list = r.days.flatMap((d, i) => d.map((item) => ({ item, day: days[i] })));
          const p = r.kind === "person" ? people(r.userId) : null;
          return (
            <div key={`p${idx}`} style={{ marginLeft: r.depth * 10 }} className="rounded-xl border border-border bg-card px-2.5 py-2">
              <div className="flex items-center gap-2">
                {p ? <Face name={p.name} avatar={p.avatar} size={24} /> : null}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p ? p.name : t("Tasks without a person")}</span>
                <Heat days={r.days} />
                <span className="text-xs font-bold tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {list.slice(0, 3).map(({ item, day }) => (
                  <li key={`${item.key}${day}`}>
                    <ChipRow item={item} day={day} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} withDay locale={locale} />
                  </li>
                ))}
              </ul>
              {list.length > 3 && (
                <details className="group mt-1">
                  <summary className={cn("flex min-h-8 cursor-pointer list-none items-center rounded-md px-1 py-1.5 text-xs font-semibold text-cal-accent pointer-coarse:min-h-11", FOCUS_ROW)}>{t("+{n} more", { n: list.length - 3 })}</summary>
                  <ul className="space-y-1">
                    {list.slice(3).map(({ item, day }) => (
                      <li key={`${item.key}${day}`}><ChipRow item={item} day={day} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} withDay locale={locale} /></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  // The card is its own scroller in both directions, so the day header stays on top and the names stay
  // on the left while the week scrolls (a tablet beside the sidebar has less than the 760px it needs).
  // Its height leaves room for the page header while that sticks (--cal-sticky-top, set by the page)
  // and for the page padding.
  return (
    <div className="max-h-[max(20rem,calc(100dvh-var(--cal-sticky-top,6.5rem)-3rem))] overflow-auto rounded-2xl border border-border bg-card shadow-soft">
      <div role="table" className="min-w-[760px]">
        <div role="row" className={cn(COLS, "sticky top-0 z-[2] border-b border-border", HEAD_BG)}>
          <div role="columnheader" className={cn("sticky left-0 z-[1] px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground", HEAD_BG)}>{t("Person")}</div>
          {days.map((d, i) => (
            <div key={d} role="columnheader" aria-current={d === today ? "date" : undefined} className="flex min-w-0">
              <button type="button" onClick={() => onOpenDay(d)}
                className={cn("w-full px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wide hover:bg-muted pointer-coarse:min-h-11", FOCUS_ROW, d === today ? "text-cal-accent" : "text-muted-foreground")}>
                {names[i]} <span className="tabular-nums">{fmtDay(d, { day: "numeric" }, locale)}</span>
              </button>
            </div>
          ))}
        </div>
        {rows.map((r, idx) => {
          if (r.kind === "unplaced") {
            return (
              <div key={`x${idx}`} role="row" className={cn(COLS, "border-b border-border/70 bg-muted/25")}>
                <div role="rowheader" className="col-span-8 py-1.5">
                  <span className="sticky left-0 block w-max max-w-full px-3 text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("Not in the chart yet · {n}", { n: r.count })}</span>
                </div>
              </div>
            );
          }
          if (r.kind === "unit") {
            const u = r.unit;
            return (
              <div key={`u${idx}`} role="row" style={unitVars(u)} className={cn(COLS, "border-b border-border/70", u.kind === "GROUP" ? "bg-cal-accent-soft/40 dark:bg-cal-accent-soft/30" : "bg-muted/25")}>
                <div role="rowheader" className="col-span-8 py-1.5">
                  <span className="sticky left-0 flex w-max max-w-full items-center gap-2 pr-3" style={{ paddingLeft: 12 + r.depth * 14 }}>
                    {u.kind === "GROUP" ? null : <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--c)] dark:bg-[var(--cd)]" />}
                    <span className={cn("truncate", u.kind === "GROUP" ? "text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground" : "text-xs font-bold uppercase tracking-[0.06em]")}>{u.name}</span>
                    <span className="text-2xs font-semibold tabular-nums text-muted-foreground">{r.count}</span>
                  </span>
                </div>
              </div>
            );
          }
          const p = r.kind === "person" ? people(r.userId) : null;
          return (
            <div key={`p${idx}`} role="row" className={cn(COLS, "border-b border-border/60 last:border-b-0")}>
              <div role="rowheader" className="sticky left-0 z-[1] flex min-w-0 items-center gap-2 bg-card py-1.5 pr-2" style={{ paddingLeft: 12 + r.depth * 14 }}>
                {p ? <Face name={p.name} avatar={p.avatar} size={22} /> : null}
                <span title={p?.name} className={cn("truncate text-sm", p ? "font-semibold" : "italic text-muted-foreground")}>{p ? p.name : t("Tasks without a person")}</span>
              </div>
              {r.days.map((list, i) => {
                const over = list.some((x) => overdueState(x, today, nowMs, windowDays) === "recent");
                return (
                  <div key={i} role="cell" className={cn("relative min-w-0 border-l border-border/50 p-1", days[i] === today && "bg-cal-accent/[0.035] dark:bg-white/[0.03]")}>
                    {over && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />}
                    {list.slice(0, 2).map((item) => <ChipRow key={item.key} item={item} day={days[i]} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} locale={locale} />)}
                    {list.length > 2 && (
                      <button type="button" onClick={() => onOpenDay(days[i])} className={cn("min-h-6 rounded-md px-1 py-0.5 text-xs font-semibold text-cal-accent hover:underline pointer-coarse:min-h-11", FOCUS_ROW)}>{t("+{n} more", { n: list.length - 2 })}</button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** 7 small squares: how busy each day of the week is (0 / 1–2 / 3–4 / 5+). */
function Heat({ days }: { days: CalItem[][] }) {
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {days.map((d, i) => (
        <span key={i} className={cn("h-2 w-2 rounded-[2px]", d.length === 0 ? "bg-muted" : d.length <= 2 ? "bg-cal-accent/30" : d.length <= 4 ? "bg-cal-accent/60" : "bg-cal-accent")} />
      ))}
    </span>
  );
}

/** One task: at least 24px tall (WCAG 2.5.8), 44px on a touch screen. */
function ChipRow({ item, day, today, nowMs, windowDays, onOpen, withDay = false, locale }: {
  item: CalItem; day: string; today: string; nowMs: number; windowDays: number; onOpen: (i: CalItem) => void; withDay?: boolean; locale: string
}) {
  const { t } = useLang();
  const clickable = !item.masked && !!item.id;
  const inner = (
    <>
      <StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={12} />
      {withDay && <span className="shrink-0 text-2xs font-semibold tabular-nums text-muted-foreground">{fmtDay(day, { weekday: "short", day: "numeric" }, locale)}</span>}
      <span className={cn("min-w-0 flex-1 truncate text-xs", item.masked && "italic text-muted-foreground", item.done && "text-muted-foreground line-through")}>
        {item.masked ? t("Internal task") : item.title}
      </span>
    </>
  );
  const cls = "flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left pointer-coarse:min-h-11";
  return clickable
    ? <button type="button" title={item.title ?? undefined} onClick={() => onOpen(item)} className={cn(cls, "hover:bg-muted", FOCUS_ROW)}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}
