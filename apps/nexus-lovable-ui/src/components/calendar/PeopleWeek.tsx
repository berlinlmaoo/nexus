import { memo, useId, useMemo } from "react";
import { ChevronDown, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import type { CalIndex, CalItem, CalScope, WeekRow } from "@/lib/calendar/core";
import { overdueState } from "@/lib/calendar/core";
import { SLATE } from "@/lib/calendar/tone";
import {
  CAPS, Face, FOCUS_ROW, fmtDay, Heading, StatusGlyph, TOUCH_ROW, unitVars, UnitMark, useCollapsed, weekdayNames, YouTag,
  type PeopleLookup,
} from "./bits";

/**
 * The name column grows with the room the week has, 170px up to 320px (it was capped at 220px, which cut
 * "Muhammad Ra…" even on a 1440px screen); names wrap to two lines rather than being cut.
 */
const COLS = "grid grid-cols-[minmax(170px,clamp(220px,24%,320px))_repeat(7,minmax(0,1fr))]";
/** The header row's tint, made opaque so rows scrolling under it (and under the name column) stay hidden. */
const HEAD_BG = "bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]";
/** Indent per Bagan level, capped: deep rows lost up to 68px of the name column to it. */
const indent = (depth: number, step: number) => Math.min(depth, 3) * step;
/** Headings under the view's h2: the focus card is an h3, each level below one deeper (h6 at most). */
const levelOf = (depth: number) => 3 + Math.min(depth, 3);

/**
 * "People": one week, a row per person under their Bagan card (Bagan order, the viewer first in each
 * card), a column per day. Desktop/tablet = a table (two task chips per cell, then "+N"; a click opens
 * that day in the month with the person lens). Phone = a list: card › person › their tasks of the week
 * with the day in front; its cards fold away (remembered with the day panel's).
 * `scope`, `onShowEveryone`, `filtersActive` and `onResetFilters` (optional) let an empty week say why.
 */
export const PeopleWeek = memo(function PeopleWeek({
  rows, days, today, nowMs, windowDays, ix, people, onOpenDay, onOpen, compact, meId = null,
  scope, onShowEveryone, filtersActive, onResetFilters,
}: {
  rows: WeekRow[]; days: string[]; today: string; nowMs: number; windowDays: number; ix: CalIndex
  people: PeopleLookup; onOpenDay: (day: string) => void; onOpen: (i: CalItem) => void; compact: boolean
  meId?: string | null; scope?: CalScope; onShowEveryone?: () => void; filtersActive?: boolean; onResetFilters?: () => void
}) {
  const { t, tn, locale } = useLang();
  const names = weekdayNames(locale);
  const headId = useId();
  const [collapsed, toggle] = useCollapsed();
  const ordered = useMemo(() => viewerFirstRows(rows, meId), [rows, meId]);
  const range = days.length === 7
    ? `${fmtDay(days[0], { day: "numeric", month: "short" }, locale)} – ${fmtDay(days[6], { day: "numeric", month: "short", year: "numeric" }, locale)}`
    : "";

  if (rows.length === 0) {
    const narrowed = !filtersActive && !!onShowEveryone && (scope === "me" || scope === "division");
    if (narrowed) {
      return (
        <EmptyState icon={scope === "me" ? UserRound : Users} tone="muted"
          title={scope === "me" ? t("You have nothing due this week") : t("Nothing due in your division this week")}
          message={scope === "me" ? t("Only your own tasks are shown.") : t("Only your division's tasks are shown.")}
          action={<EmptyAction onClick={onShowEveryone}>{t("Show everyone")}</EmptyAction>} />
      );
    }
    return (
      <EmptyState icon={Users} tone="muted" title={t("Nobody has a task this week")} message={t("Pick another week, or reset the filters.")}
        action={filtersActive && onResetFilters ? <EmptyAction onClick={onResetFilters}>{t("Reset filters")}</EmptyAction> : undefined} />
    );
  }

  if (compact) {
    // A folded card hides every row under it, down to the next row at its own depth or higher.
    const shown: WeekRow[] = [];
    let foldedAt: number | null = null;
    for (const r of ordered) {
      if (foldedAt !== null && r.depth > foldedAt) continue;
      foldedAt = null;
      shown.push(r);
      const key = foldKey(r);
      if (key && collapsed.has(key)) foldedAt = r.depth;
    }
    return (
      <div className="space-y-2">
        <h2 id={headId} tabIndex={-1} className="sr-only">{range}</h2>
        {shown.map((r) => {
          const key = foldKey(r);
          const closed = !!key && collapsed.has(key);
          if (r.kind === "unplaced" || (r.kind === "unit" && r.unit.kind === "GROUP")) {
            // "Not in the chart yet" and Bagan groups: a quiet label that folds what is under it.
            const label = r.kind === "unplaced"
              ? t("Not in the chart yet · {n}", { n: r.count })
              : <>{r.unit.name}<span aria-hidden> · {r.count}</span><span className="sr-only">, {tn(r.count, "{n} task", "{n} tasks")}</span></>;
            const cls = cn("flex min-h-8 w-full items-center gap-1.5 rounded-lg px-[4px] pb-1 pt-2 text-left", CAPS, r.kind === "unplaced" ? "text-muted-foreground" : SLATE.text);
            return (
              <Heading key={rowKey(r)} level={levelOf(r.depth)} style={{ marginLeft: indent(r.depth, 10) }}>
                {key ? (
                  <button type="button" aria-expanded={!closed} onClick={() => toggle(key)} className={cn(cls, TOUCH_ROW, FOCUS_ROW)}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                    <Chevron closed={closed} />
                  </button>
                ) : (
                  // A group in focus frames the whole list, like the focus card: it does not fold.
                  <span className={cls}><span className="min-w-0 [overflow-wrap:anywhere]">{label}</span></span>
                )}
              </Heading>
            );
          }
          if (r.kind === "unit") {
            const u = r.unit;
            const head = (
              <>
                <UnitMark unit={u} size={20} />
                <span className={cn("min-w-0 flex-1 [overflow-wrap:anywhere]", CAPS)}>{u.name}</span>
                <span aria-hidden className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{r.count}</span>
                <span className="sr-only">{tn(r.count, "{n} task", "{n} tasks")}</span>
              </>
            );
            const card = "flex w-full items-center gap-2 rounded-xl border-l-[3px] border-[var(--c)] bg-card px-[10px] py-2 text-left shadow-soft dark:border-[var(--cd)]";
            return (
              <Heading key={rowKey(r)} level={levelOf(r.depth)} style={{ ...unitVars(u), marginLeft: indent(r.depth, 10) }}>
                {/* The focus card frames the whole list and does not fold; every card under it does. */}
                {!key ? <div className={card}>{head}<span aria-hidden className="h-4 w-4 shrink-0" /></div> : (
                  <button type="button" aria-expanded={!closed} onClick={() => toggle(key)} className={cn(card, "hover:bg-muted/50", TOUCH_ROW, FOCUS_ROW)}>
                    {head}
                    <Chevron closed={closed} />
                  </button>
                )}
              </Heading>
            );
          }
          const list = r.days.flatMap((d, i) => d.map((item) => ({ item, day: days[i] })));
          const p = r.kind === "person" ? people(r.userId) : null;
          const isViewer = r.kind === "person" && !!meId && r.userId === meId;
          return (
            <div key={rowKey(r)} style={{ marginLeft: indent(r.depth, 10) }} className="rounded-xl border border-border bg-card px-[10px] py-2">
              {/* With a large text size the week strip and count drop under the name instead of squeezing it. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="flex min-w-[9rem] flex-1 items-center gap-2">
                  {p ? <Face name={p.name} avatar={p.avatar} size={24} /> : null}
                  <Heading level={levelOf(r.depth)} className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm", p ? "font-semibold" : "italic text-muted-foreground")}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{p ? p.name : t("Tasks without a person")}</span>
                    {isViewer && <YouTag />}
                  </Heading>
                </div>
                <Heat days={r.days} />
                <span aria-hidden className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{list.length}</span>
                <span className="sr-only">{tn(list.length, "{n} task", "{n} tasks")}</span>
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
                  <summary className={cn("flex min-h-8 cursor-pointer list-none items-center rounded-md px-1 py-1.5 text-xs font-semibold text-cal-accent", TOUCH_ROW, FOCUS_ROW)}>{t("+{n} more", { n: list.length - 3 })}</summary>
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
      <h2 id={headId} tabIndex={-1} className="sr-only">{range}</h2>
      <div role="table" aria-labelledby={headId} className="min-w-[760px]">
        <div role="row" className={cn(COLS, "sticky top-0 z-[2] border-b border-border", HEAD_BG)}>
          <div role="columnheader" className={cn("sticky left-0 z-[1] px-3 py-2 text-muted-foreground", CAPS, HEAD_BG)}>{t("Person")}</div>
          {days.map((d, i) => (
            <div key={d} role="columnheader" aria-current={d === today ? "date" : undefined} className="flex min-w-0">
              <button type="button" onClick={() => onOpenDay(d)}
                className={cn("w-full px-2 py-2 text-left hover:bg-muted", CAPS, TOUCH_ROW, FOCUS_ROW,
                  d === today ? "text-cal-accent shadow-[inset_0_2px_0_var(--cal-accent)]" : "text-muted-foreground")}>
                {names[i]} <span className="tabular-nums">{fmtDay(d, { day: "numeric" }, locale)}</span>
              </button>
            </div>
          ))}
        </div>
        {ordered.map((r) => {
          if (r.kind === "unplaced") {
            return (
              <div key={rowKey(r)} role="row" className={cn(COLS, "border-b border-border/70 bg-muted/25")}>
                {/* One header across the 8 columns, said so to assistive tech too. */}
                <div role="rowheader" aria-colspan={8} className="col-span-8 py-1.5">
                  <Heading level={3} className={cn("sticky left-0 block w-max max-w-full px-3 text-muted-foreground", CAPS)}>{t("Not in the chart yet · {n}", { n: r.count })}</Heading>
                </div>
              </div>
            );
          }
          if (r.kind === "unit") {
            const u = r.unit;
            return (
              <div key={rowKey(r)} role="row" style={unitVars(u)} className={cn(COLS, "border-b border-border/70", u.kind === "GROUP" ? "bg-cal-accent-soft/40 dark:bg-cal-accent-soft/30" : "bg-muted/25")}>
                <div role="rowheader" aria-colspan={8} className="col-span-8 py-1.5">
                  <Heading level={levelOf(r.depth)} className="sticky left-0 flex w-max max-w-full items-center gap-2 pr-3" style={{ paddingLeft: 12 + indent(r.depth, 14) }}>
                    {u.kind === "GROUP" ? null : <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--c)] dark:bg-[var(--cd)]" />}
                    <span className={cn("min-w-0 [overflow-wrap:anywhere]", CAPS, u.kind === "GROUP" && SLATE.text)}>{u.name}</span>
                    <span aria-hidden className="text-2xs font-semibold tabular-nums text-muted-foreground">{r.count}</span>
                    <span className="sr-only">{tn(r.count, "{n} task", "{n} tasks")}</span>
                  </Heading>
                </div>
              </div>
            );
          }
          const p = r.kind === "person" ? people(r.userId) : null;
          const isViewer = r.kind === "person" && !!meId && r.userId === meId;
          return (
            <div key={rowKey(r)} role="row" className={cn(COLS, "border-b border-border/60 last:border-b-0")}>
              <div role="rowheader" className="sticky left-0 z-[1] flex min-w-0 items-center gap-2 bg-card py-1.5 pr-2" style={{ paddingLeft: 12 + indent(r.depth, 14) }}>
                {p ? <Face name={p.name} avatar={p.avatar} size={22} /> : null}
                <span title={p?.name} className={cn("line-clamp-2 min-w-0 text-sm [overflow-wrap:anywhere]", p ? "font-semibold" : "italic text-muted-foreground")}>{p ? p.name : t("Tasks without a person")}</span>
                {isViewer && <YouTag />}
              </div>
              {r.days.map((list, i) => {
                const over = list.some((x) => overdueState(x, today, nowMs, windowDays) === "recent");
                return (
                  <div key={i} role="cell" className={cn("relative min-w-0 border-l border-border/50 p-1", days[i] === today && "bg-cal-accent-soft/60")}>
                    {over && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cal-overdue" />}
                    {list.slice(0, 2).map((item) => <ChipRow key={item.key} item={item} day={days[i]} today={today} nowMs={nowMs} windowDays={windowDays} onOpen={onOpen} locale={locale} />)}
                    {list.length > 2 && (
                      <button type="button" onClick={() => onOpenDay(days[i])} className={cn("min-h-6 rounded-md px-1 py-0.5 text-xs font-semibold text-cal-accent hover:underline", TOUCH_ROW, FOCUS_ROW)}>{t("+{n} more", { n: list.length - 2 })}</button>
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

/** A row's React key: stable while cards fold and the viewer's row moves up (an index was not). */
function rowKey(r: WeekRow): string {
  return r.kind === "unit" ? `u:${r.unit.id}` : r.kind === "unplaced" ? "x" : r.kind === "loose" ? `l:${r.unitId}` : `p:${r.unitId ?? "-"}:${r.userId}`;
}

/** The fold key of a header row in the phone list (shared with the day panel's cards), or null. */
function foldKey(r: WeekRow): string | null {
  if (r.kind === "unplaced") return "unplaced";
  if (r.kind === "unit" && r.depth > 0) return r.unit.id;
  return null;
}

/**
 * The viewer's own row first among the people of each card (and of "Not in the chart yet"); everyone
 * else keeps the Bagan order. A display rule: weekRows (core.ts) and its golden files are unchanged.
 * The people of a card sit together right under its header, so only that run moves.
 */
function viewerFirstRows(rows: WeekRow[], meId: string | null): WeekRow[] {
  if (!meId) return rows;
  const out = [...rows];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r.kind !== "person" || r.userId !== meId) continue;
    let j = i;
    while (j > 0) {
      const prev = out[j - 1];
      if (prev.kind === "person" && prev.unitId === r.unitId && prev.depth === r.depth) j--;
      else break;
    }
    if (j < i) {
      out.splice(i, 1);
      out.splice(j, 0, r);
    }
  }
  return out;
}

function Chevron({ closed }: { closed: boolean }) {
  return <ChevronDown aria-hidden className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", closed && "-rotate-90")} />;
}

/** 7 small squares: how busy each day of the week is (0 / 1–2 / 3–4 / 5+). */
function Heat({ days }: { days: CalItem[][] }) {
  return (
    <span className="flex shrink-0 gap-[2px]" aria-hidden>
      {days.map((d, i) => (
        <span key={i} className={cn("h-2 w-2 rounded-[2px]", d.length === 0 ? "bg-muted" : d.length <= 2 ? "bg-cal-accent/30" : d.length <= 4 ? "bg-cal-accent/60" : "bg-cal-accent")} />
      ))}
    </span>
  );
}

/**
 * One task: at least 24px tall (WCAG 2.5.8), 44px on a touch screen. In the phone list (`withDay`) the
 * title takes two lines rather than being cut: revisions differ at the end ("— revisi kedua …").
 */
function ChipRow({ item, day, today, nowMs, windowDays, onOpen, withDay = false, locale }: {
  item: CalItem; day: string; today: string; nowMs: number; windowDays: number; onOpen: (i: CalItem) => void; withDay?: boolean; locale: string
}) {
  const { t } = useLang();
  const clickable = !item.masked && !!item.id;
  const inner = (
    <>
      <StatusGlyph item={item} today={today} nowMs={nowMs} windowDays={windowDays} size={12} />
      {withDay && <span className="shrink-0 text-2xs font-semibold tabular-nums text-muted-foreground">{fmtDay(day, { weekday: "short", day: "numeric" }, locale)}</span>}
      <span className={cn("min-w-0 flex-1 text-xs", withDay ? "line-clamp-2 min-w-[9rem] [overflow-wrap:anywhere]" : "truncate", item.masked && "italic text-muted-foreground", item.done && "text-muted-foreground line-through")}>
        {item.masked ? t("Internal task") : item.title}
      </span>
    </>
  );
  // In the phone list the title moves under the day when a large text size leaves it under 9rem.
  const cls = cn("flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left", withDay && "flex-wrap", TOUCH_ROW);
  return clickable
    ? <button type="button" title={item.title ?? undefined} onClick={() => onOpen(item)} className={cn(cls, "hover:bg-muted", FOCUS_ROW)}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}
