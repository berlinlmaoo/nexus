import { memo } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyState } from "@/components/EmptyState";
import type { CalIndex, CalItem, WeekRow } from "@/lib/calendar/core";
import { overdueState } from "@/lib/calendar/core";
import { Face, fmtDay, StatusGlyph, unitVars, UnitMark, weekdayNames, type PeopleLookup } from "./bits";

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
  const names = weekdayNames(locale, "short");
  if (rows.length === 0) {
    return <EmptyState icon={Users} tone="muted" title={t("Nobody has a task this week")} message={t("Pick another week, or reset the filters.")} />;
  }
  if (compact) {
    return (
      <div className="space-y-2">
        {rows.map((r, idx) => {
          if (r.kind === "unplaced") return <div key={`x${idx}`} className="px-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("Not in the chart yet · {n}", { n: r.count })}</div>;
          if (r.kind === "unit") {
            const u = r.unit;
            if (u.kind === "GROUP") return <div key={`u${idx}`} className="px-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground" style={{ paddingLeft: 4 + r.depth * 10 }}>{u.name} · {r.count}</div>;
            return (
              <div key={`u${idx}`} style={{ ...unitVars(u), marginLeft: r.depth * 10 }} className="flex items-center gap-2 rounded-xl border-l-[3px] border-[var(--c)] bg-card px-2.5 py-2 shadow-soft dark:border-[var(--cd)]">
                <UnitMark unit={u} size={20} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.06em]">{u.name}</span>
                <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">{r.count}</span>
              </div>
            );
          }
          const list = r.days.flatMap((d, i) => d.map((item) => ({ item, day: days[i] })));
          const p = r.kind === "person" ? people(r.userId) : null;
          return (
            <div key={`p${idx}`} style={{ marginLeft: r.depth * 10 }} className="rounded-xl border border-border bg-card px-2.5 py-2">
              <div className="flex items-center gap-2">
                {p ? <Face name={p.name} avatar={p.avatar} size={24} /> : null}
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p ? p.name : t("Tasks without a person")}</span>
                <Heat days={r.days} />
                <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {list.slice(0, 3).map(({ item, day }) => (
                  <li key={`${item.key}${day}`}>
                    <ChipRow item={item} day={day} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} withDay locale={locale} />
                  </li>
                ))}
              </ul>
              {list.length > 3 && (
                <details className="group">
                  <summary className="cursor-pointer list-none px-1 pt-1 text-[12px] font-semibold text-[#1e3a5f] dark:text-[#9fb6d6]">{t("+{n} more", { n: list.length - 3 })}</summary>
                  <ul className="space-y-0.5">
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
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <div role="table" className="min-w-[760px]">
        <div role="row" className="sticky top-0 z-[1] grid grid-cols-[minmax(170px,220px)_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/60 backdrop-blur">
          <div role="columnheader" className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Person")}</div>
          {days.map((d, i) => (
            <button key={d} type="button" role="columnheader" onClick={() => onOpenDay(d)} className={cn("px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide hover:bg-muted", d === today ? "text-[#1e3a5f] dark:text-[#9fb6d6]" : "text-muted-foreground")}>
              {names[i]} <span className="tabular-nums">{fmtDay(d, { day: "numeric" }, locale)}</span>
            </button>
          ))}
        </div>
        {rows.map((r, idx) => {
          if (r.kind === "unplaced") {
            return (
              <div key={`x${idx}`} role="row" className="grid grid-cols-[minmax(170px,220px)_repeat(7,minmax(0,1fr))] border-b border-border/70 bg-muted/25">
                <div role="rowheader" className="col-span-8 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("Not in the chart yet · {n}", { n: r.count })}</div>
              </div>
            );
          }
          if (r.kind === "unit") {
            const u = r.unit;
            return (
              <div key={`u${idx}`} role="row" style={unitVars(u)} className={cn("grid grid-cols-[minmax(170px,220px)_repeat(7,minmax(0,1fr))] border-b border-border/70", u.kind === "GROUP" ? "bg-[#edf2f9]/40 dark:bg-[#1a2a41]/30" : "bg-muted/25")}>
                <div role="rowheader" className="col-span-8 flex items-center gap-2 py-1.5 pr-3" style={{ paddingLeft: 12 + r.depth * 14 }}>
                  {u.kind === "GROUP" ? null : <span className="h-3.5 w-[3px] rounded-full bg-[var(--c)] dark:bg-[var(--cd)]" />}
                  <span className={cn("truncate", u.kind === "GROUP" ? "text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground" : "text-[12px] font-bold uppercase tracking-[0.06em]")}>{u.name}</span>
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{r.count}</span>
                </div>
              </div>
            );
          }
          const p = r.kind === "person" ? people(r.userId) : null;
          return (
            <div key={`p${idx}`} role="row" className="grid grid-cols-[minmax(170px,220px)_repeat(7,minmax(0,1fr))] border-b border-border/60 last:border-b-0">
              <div role="rowheader" className="flex min-w-0 items-center gap-2 py-1.5 pr-2" style={{ paddingLeft: 12 + r.depth * 14 }}>
                {p ? <Face name={p.name} avatar={p.avatar} size={22} /> : null}
                <span className={cn("truncate text-[12.5px]", p ? "font-semibold" : "italic text-muted-foreground")}>{p ? p.name : t("Tasks without a person")}</span>
              </div>
              {r.days.map((list, i) => {
                const over = list.some((x) => overdueState(x, today, nowMs, windowDays) === "recent");
                return (
                  <div key={i} role="cell" className={cn("relative min-w-0 border-l border-border/50 p-1", days[i] === today && "bg-[#1e3a5f]/[0.035] dark:bg-white/[0.03]")}>
                    {over && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />}
                    {list.slice(0, 2).map((item) => <ChipRow key={item.key} item={item} day={days[i]} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} locale={locale} />)}
                    {list.length > 2 && (
                      <button type="button" onClick={() => onOpenDay(days[i])} className="px-1 text-[11px] font-semibold text-[#1e3a5f] hover:underline dark:text-[#9fb6d6]">{t("+{n} more", { n: list.length - 2 })}</button>
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
        <span key={i} className={cn("h-2 w-2 rounded-[2px]", d.length === 0 ? "bg-muted" : d.length <= 2 ? "bg-[#1e3a5f]/30 dark:bg-[#9fb6d6]/30" : d.length <= 4 ? "bg-[#1e3a5f]/60 dark:bg-[#9fb6d6]/60" : "bg-[#1e3a5f] dark:bg-[#9fb6d6]")} />
      ))}
    </span>
  );
}

function ChipRow({ item, day, today, nowMs, windowDays, onOpen, withDay = false, locale }: {
  item: CalItem; day: string; today: string; nowMs: number; windowDays: number; onOpen: (i: CalItem) => void; withDay?: boolean; locale: string
}) {
  const { t } = useLang();
  const clickable = !item.masked && !!item.id;
  const inner = (
    <>
      <StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={12} />
      {withDay && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtDay(day, { weekday: "short", day: "numeric" }, locale)}</span>}
      <span className={cn("min-w-0 flex-1 truncate text-[11.5px]", item.masked && "italic text-muted-foreground", item.done && "text-muted-foreground line-through")}>
        {item.masked ? t("Internal task") : item.title}
      </span>
    </>
  );
  const cls = "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-[3px] text-left";
  return clickable
    ? <button type="button" title={item.title ?? undefined} onClick={() => onOpen(item)} className={cn(cls, "hover:bg-muted")}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}
