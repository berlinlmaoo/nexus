import { memo, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FilterX, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { Segmented } from "@/components/calendar/Segmented";
import type { CalIndex, CalItem, CalScope, DayTree, PersonRow, TreeNode } from "@/lib/calendar/core";
import { dayDiff } from "@/lib/calendar/core";
import { SLATE } from "@/lib/calendar/tone";
import {
  CAPS, Face, FOCUS_PILL, FOCUS_ROW, fmtDay, Heading, ItemRow, scrollerOf, stickyRoom, TOUCH_ICON, TOUCH_ROW, unitVars, UnitMark,
  useCollapsed, viewerFirst, YouTag, type PeopleLookup,
} from "./bits";

export type Lens = "division" | "person";

/** The header stops sticking once it is taller than this share of the screen (large text, a phone on its side). */
const STICKY_MAX = 0.25;
/**
 * Card and group headings stop at h5, so a person (one level under their card) is always an h6 at most
 * and never lands on the same level as the card itself, however deep the Bagan goes.
 */
const UNIT_LEVEL_MAX = 5;
const subLevel = (level: number) => Math.min(level + 1, UNIT_LEVEL_MAX);

/**
 * The day under the grid (phone) or beside it (desktop): who has what that day, grouped exactly like the
 * Bagan. "Per division": card › sub-card › tasks with the people doing them. "Per person": card › people
 * › their tasks, the viewer first in each card. A card keeps its place in Bagan order; the viewer's own
 * cards are marked "You".
 *
 * Headings follow the same tree under the day's h2: a card is an h3, a sub-card or group one level
 * deeper (h5 at most), a person one level under their card, so a screen reader can skim the day by heading.
 * `scope` + `onShowEveryone` (optional) let an empty day say that Show is narrowed to the viewer.
 */
export const DayPanel = memo(function DayPanel({
  day, today, nowMs, windowDays, holiday, tree, rail, ix, lens, onLens, onPrev, onNext, onOpen, people,
  myHomes, filtersActive, onResetFilters, onToday, monthEmpty, compact, meId = null, scope, onShowEveryone,
}: {
  day: string; today: string; nowMs: number; windowDays: number; holiday: string | null
  tree: DayTree; rail: CalItem[]; ix: CalIndex; lens: Lens; onLens: (l: Lens) => void
  onPrev: () => void; onNext: () => void; onOpen: (i: CalItem) => void; people: PeopleLookup
  myHomes: string[]; filtersActive: boolean; onResetFilters: () => void; onToday: () => void
  monthEmpty: boolean; compact: boolean; meId?: string | null
  scope?: CalScope; onShowEveryone?: () => void
}) {
  const { t, tn, locale } = useLang();
  const [collapsed, toggle] = useCollapsed();
  const [railOpen, setRailOpen] = useState(false);
  const railId = useId();
  const mine = ix.subtree(myHomes);
  const rel = dayDiff(today, day);
  const relLabel = rel === 0 ? t("Today") : rel === 1 ? t("Tomorrow") : rel === -1 ? t("Yesterday") : null;
  const common: Common = { ix, people, today, nowMs, windowDays, onOpen, meId };

  // The header sticks only while it is short. At a 200% text size it grew to 45% of a phone screen and
  // covered the very tasks being read; then (or on a phone on its side) it scrolls away with the day.
  // Measured against the layout viewport, which a phone's toolbar does not resize mid-scroll.
  // While it sticks, the scroller under it (the side panel, or the page below the grid) keeps room for it
  // at its top: Shift+Tab up a long day never leaves the focused row under the header (WCAG 2.4.11).
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useLayoutEffect(() => {
    const el = headRef.current;
    const section = sectionRef.current;
    if (!el || !section) return;
    const room = stickyRoom();
    const check = () => {
      const sticks = el.offsetHeight <= (document.documentElement.clientHeight || window.innerHeight) * STICKY_MAX;
      setPinned(sticks);
      // On the page it sticks under the page header while that sticks (--cal-sticky-top); in the side panel at its top.
      const scroller = scrollerOf(section);
      const below = scroller === document.documentElement ? parseFloat(getComputedStyle(el).getPropertyValue("--cal-sticky-top")) || 0 : 0;
      room.set(scroller, sticks ? below + el.offsetHeight + 8 : null);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
      room.release();
    };
  }, []);

  // An empty state's action replaces the very button that has focus; the day's heading takes it instead,
  // so the keyboard stays in the panel rather than dropping to the top of the page.
  const dayRef = useRef<HTMLHeadingElement>(null);
  const thenToDay = (fn: () => void) => () => {
    fn();
    requestAnimationFrame(() => dayRef.current?.focus());
  };

  const root = tree.root;
  const sections: TreeNode[] = root ? root.children : [];
  const rootOwn = root && (root.items.length > 0 || root.people.length > 0) ? root : null;
  const placementsShown = root ? countPlacements(root) : 0;

  // Why the day is empty, most specific first: filters, a month with nothing at all, Show narrowed to
  // the viewer ("Nobody has a task" would be wrong there), or simply nothing that day.
  const narrowed = !filtersActive && !monthEmpty && !!onShowEveryone && (scope === "me" || scope === "division");
  const empty = filtersActive
    ? { icon: FilterX, title: t("Nothing matches the filters on this day"), message: t("Filters are hiding the rest. Reset them to see everything."), action: <EmptyAction onClick={thenToDay(onResetFilters)}>{t("Reset filters")}</EmptyAction> }
    : narrowed
      ? {
        icon: scope === "me" ? UserRound : Users,
        title: scope === "me" ? t("You have nothing due on this day") : t("Nothing due in your division on this day"),
        message: scope === "me" ? t("Only your own tasks are shown.") : t("Only your division's tasks are shown."),
        action: onShowEveryone && <EmptyAction onClick={thenToDay(onShowEveryone)}>{t("Show everyone")}</EmptyAction>,
      }
      : {
        icon: CalendarDays,
        title: t("No tasks on this day"),
        message: monthEmpty ? t("Nothing has a due date this month yet.") : t("Nobody has a task due on this date."),
        action: day !== today ? <EmptyAction onClick={thenToDay(onToday)}>{t("Back to today")}</EmptyAction> : undefined,
      };

  return (
    <section ref={sectionRef} aria-label={t("Day")} className="flex min-h-0 flex-col">
      {/* Header: stays in reach while the day scrolls, as long as it is short. Beside the grid it sticks to
          the top of the panel; under the grid it sticks below the page header (--cal-sticky-top, set by
          the page when that header is sticky). Solid card: a blur behind 95% opacity cost a filter pass
          per scroll frame. Side gutters in px (see ItemRow). */}
      <div ref={headRef} className={cn("border-b border-border bg-card px-[16px] pb-3 pt-3.5", pinned && cn("sticky z-10", compact ? "top-[var(--cal-sticky-top,0px)]" : "top-0"))}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 ref={dayRef} tabIndex={-1} className={cn("rounded-sm font-display text-lg font-bold tracking-tight", FOCUS_PILL)}>{fmtDay(day, { weekday: "long", day: "numeric", month: "short", year: "numeric" }, locale)}</h2>
              {relLabel && <span className={cn("rounded-md bg-cal-accent/10 px-1.5 py-px text-cal-accent dark:bg-cal-accent/15", CAPS)}>{relLabel}</span>}
            </div>
            {holiday && <div className="mt-0.5 text-xs font-semibold text-cal-holiday">{holiday}</div>}
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tree.total > 0 ? `${tn(tree.total, "{n} task", "{n} tasks")} · ${tn(tree.people, "{n} person", "{n} people")}` : t("No tasks")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 pointer-coarse:gap-2">
            <button type="button" onClick={onPrev} aria-label={t("Previous day")} className={cn("grid size-8 place-items-center rounded-lg border border-border hover:bg-muted", TOUCH_ICON, FOCUS_PILL)}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={onNext} aria-label={t("Next day")} className={cn("grid size-8 place-items-center rounded-lg border border-border hover:bg-muted", TOUCH_ICON, FOCUS_PILL)}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        {/* One of two ways to group the same list: the calendar's radio group, like View and Show. */}
        <Segmented
          label={t("Group by")}
          value={lens}
          onChange={(v) => onLens(v as Lens)}
          options={[{ value: "division", label: t("By division") }, { value: "person", label: t("By person") }]}
          size="md"
          className="mt-3 w-full"
        />
      </div>

      <div data-cal-under-sticky="" className="space-y-3 px-[12px] py-3">
        {/* Overdue rail (today only) */}
        {day === today && rail.length > 0 && (
          <div className="rounded-xl border border-cal-overdue/25 bg-cal-overdue/[0.05] p-[6px] dark:bg-cal-overdue/[0.07]">
            {rail.length > 2 ? (
              <Heading level={3}>
                <button type="button" onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen} aria-controls={railId}
                  className={cn("flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-[8px] py-1 text-left", TOUCH_ROW, FOCUS_ROW)}>
                  <span className={cn("text-cal-overdue", CAPS)}>{t("Overdue · {n}", { n: rail.length })}</span>
                  <span className="shrink-0 text-xs font-semibold text-cal-overdue">{railOpen ? t("Show less") : t("Show all")}</span>
                </button>
              </Heading>
            ) : (
              // Two or fewer: everything is already shown, there is nothing to expand.
              <Heading level={3} className={cn("flex min-h-8 items-center px-[8px] py-1 text-cal-overdue", CAPS)}>{t("Overdue · {n}", { n: rail.length })}</Heading>
            )}
            <div id={railId}>
              {(railOpen ? rail : rail.slice(0, 2)).map((i) => (
                <ItemRow key={i.key} item={i} unitId={i.placements[0]?.unitId ?? null} {...common} trailing={<span className="shrink-0 pt-px text-2xs text-cal-overdue">{fmtDay(i.day, { day: "numeric", month: "short" }, locale)}</span>} />
              ))}
            </div>
          </div>
        )}

        {tree.total === 0 ? (
          <EmptyState compact icon={empty.icon} tone="muted" title={empty.title} message={empty.message} action={empty.action} />
        ) : (
          <>
            {rootOwn && (
              <SectionCard node={rootOwn} own collapsed={collapsed} toggle={toggle} mine={mine} lens={lens} common={common} />
            )}
            {sections.map((n) => (
              <SectionCard key={n.unit.id} node={n} collapsed={collapsed} toggle={toggle} mine={mine} lens={lens} common={common} />
            ))}
            {lens === "person" && tree.unplaced.length > 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-card p-[8px]">
                <Heading level={3} className={cn("px-[8px] py-1 text-muted-foreground", CAPS)}>{t("Not in the chart yet · {n}", { n: tree.unplaced.length })}</Heading>
                {viewerFirst(tree.unplaced, (p) => p.userId === meId).map((p) => <PersonBlock key={p.userId} row={p} unitId={null} level={4} common={common} />)}
              </div>
            )}
            {placementsShown > tree.total && (
              <p className="px-[8px] pb-2 text-xs text-muted-foreground">
                {tn(tree.total, "A task can show under several divisions. Total: {n} unique task.", "A task can show under several divisions. Total: {n} unique tasks.")}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
});

type Common = {
  ix: CalIndex; people: PeopleLookup; today: string; nowMs: number; windowDays: number; onOpen: (i: CalItem) => void
  /** The viewer: first among the people of a card, tagged "You". */
  meId: string | null
};

function countPlacements(n: TreeNode): number {
  return n.items.length + n.children.reduce((s, k) => s + countPlacements(k), 0);
}

/** A task count read out after a name, where the screen only shows the bare number. */
function SrCount({ n }: { n: number }) {
  const { tn } = useLang();
  return <span className="sr-only">{tn(n, "{n} task", "{n} tasks")}</span>;
}

/**
 * A card right under the focus (Finance & Tech, Framework Agency, …), or the focus itself for the people
 * sitting on it. Its header is an h3 holding the button that folds it (the disclosure pattern).
 */
function SectionCard({ node, own = false, collapsed, toggle, mine, lens, common }: {
  node: TreeNode; own?: boolean; collapsed: Set<string>; toggle: (id: string) => void; mine: Set<string>; lens: Lens; common: Common
}) {
  const isMine = mine.has(node.unit.id) || [...common.ix.subtree([node.unit.id])].some((id) => mine.has(id));
  const key = own ? `own:${node.unit.id}` : node.unit.id;
  const closed = collapsed.has(key);
  const count = own ? new Set([...node.items.map((i) => i.key), ...node.people.flatMap((p) => p.items.map((i) => i.key))]).size : node.count;
  return (
    <div style={unitVars(common.ix.byId.get(node.unit.id))} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <Heading level={3}>
        <button type="button" onClick={() => toggle(key)} aria-expanded={!closed}
          className={cn("flex w-full items-center gap-[10px] border-l-[3px] border-[var(--c)] px-[12px] py-2.5 text-left hover:bg-muted/50 dark:border-[var(--cd)]", FOCUS_ROW)}>
          <UnitMark unit={node.unit} size={24} />
          {/* Wraps instead of truncating (at a large text size "FRAMEWORK AGENCY" was cut to "FR…"); "You"
              drops under the name when the two do not fit side by side. */}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", CAPS)}>{node.unit.name}</span>
            {isMine && <YouTag />}
          </span>
          <span aria-hidden className="shrink-0 rounded-full bg-muted px-2 py-px text-xs font-bold tabular-nums">{count}</span>
          <SrCount n={count} />
          <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", closed && "-rotate-90")} />
        </button>
      </Heading>
      {!closed && (
        <div className="px-[6px] pb-2">
          <NodeBody node={node} own={own} lens={lens} level={3} common={common} />
        </div>
      )}
    </div>
  );
}

/** What sits in a card or sub-card (`level` = its own heading level): tasks or people, then its sub-cards. */
function NodeBody({ node, own, lens, level, common }: { node: TreeNode; own?: boolean; lens: Lens; level: number; common: Common }): ReactNode {
  return (
    <>
      {lens === "division"
        ? node.items.map((i) => <ItemRow key={i.key} item={i} unitId={node.unit.id} {...common} />)
        : (
          <>
            {viewerFirst(node.people, (p) => p.userId === common.meId).map((p) => (
              <PersonBlock key={p.userId} row={p} unitId={node.unit.id} level={level + 1} common={common} />
            ))}
            {node.loose.map((i) => <ItemRow key={i.key} item={i} unitId={node.unit.id} {...common} showPeople={false} />)}
          </>
        )}
      {!own && node.children.map((k) => <SubNode key={k.unit.id} node={k} lens={lens} level={subLevel(level)} common={common} />)}
    </>
  );
}

/** A sub-card inside a section, or a group drawn as a thin ribbon ("CREATIVE · 1") around its cards. */
function SubNode({ node, lens, level, common }: { node: TreeNode; lens: Lens; level: number; common: Common }) {
  if (node.unit.kind === "GROUP") {
    return (
      <div className="mx-[4px] mt-2 rounded-xl border border-dashed border-cal-line bg-cal-accent-soft/50 px-[4px] pb-1 pt-1.5 dark:bg-cal-accent-soft/40">
        <Heading level={level} className={cn("px-[6px] pb-0.5 [overflow-wrap:anywhere]", CAPS, SLATE.text)}>
          {node.unit.name}<span aria-hidden> · {node.count}</span><span className="sr-only">, </span><SrCount n={node.count} />
        </Heading>
        {node.children.map((k) => <SubNode key={k.unit.id} node={k} lens={lens} level={subLevel(level)} common={common} />)}
      </div>
    );
  }
  return (
    <div style={unitVars(common.ix.byId.get(node.unit.id))} className="mt-1.5">
      <Heading level={level} className="flex items-center gap-2 px-[10px] pb-0.5 pt-1">
        <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--c)] dark:bg-[var(--cd)]" />
        <span className="min-w-0 flex-1 text-xs font-semibold text-foreground/85 [overflow-wrap:anywhere]">{node.unit.name}</span>
        <span aria-hidden className="shrink-0 text-2xs font-semibold tabular-nums text-muted-foreground">{node.count}</span>
        <SrCount n={node.count} />
      </Heading>
      <div className="pl-[8px]">
        <NodeBody node={node} lens={lens} level={level} common={common} />
      </div>
    </div>
  );
}

/** A person with their tasks of the day (lens "per person"); "also in …" lists their other cards. */
function PersonBlock({ row, unitId, level, common }: { row: PersonRow; unitId: string | null; level: number; common: Common }) {
  const { t } = useLang();
  const p = common.people(row.userId);
  const person = common.ix.person.get(row.userId);
  const also = (person?.homeUnitIds ?? []).filter((id) => id !== unitId).map((id) => common.ix.byId.get(id)?.name).filter(Boolean) as string[];
  const isViewer = !!common.meId && row.userId === common.meId;
  return (
    <div className="mt-1 rounded-xl px-[4px]">
      <div className="flex items-center gap-2 px-[6px] py-1.5">
        <Face name={p.name} avatar={p.avatar} size={26} />
        <div className="min-w-0 flex-1">
          <Heading level={level} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold">
            <span className="min-w-0 [overflow-wrap:anywhere]">{p.name}</span>
            {isViewer && <YouTag />}
          </Heading>
          {also.length > 0 && <div className="text-2xs text-muted-foreground [overflow-wrap:anywhere]">{t("also in {units}", { units: also.join(", ") })}</div>}
          {!p.inChart && <div className="text-2xs text-muted-foreground">{t("not in the chart")}</div>}
        </div>
        <span aria-hidden className="shrink-0 rounded-full bg-muted px-2 py-px text-2xs font-bold tabular-nums">{row.items.length}</span>
        <SrCount n={row.items.length} />
      </div>
      <div className="ml-[16px] border-l border-border pl-[4px]">
        {row.items.map((i) => <ItemRow key={i.key} item={i} unitId={unitId} {...common} showPeople={false} />)}
      </div>
    </div>
  );
}
