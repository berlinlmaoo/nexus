import {
  lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ComponentPropsWithRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Globe2, Keyboard, Lock, SlidersHorizontal, X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentLang, useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  activeFilterCount, addDays, byDay, dayCell, dayTree, filterItems, gridRange, indexStructure, legend, monthGrid,
  mondayOf, NO_FILTERS, overdueRail, shiftMonth, underFocus, weekRows,
  type CalFilters, type CalItem, type CalScope,
} from "@/lib/calendar/core";
import { fmtDay, UnitDot, wibToday, type PeopleLookup } from "./bits";
import { MonthGrid } from "./MonthGrid";
import { DayPanel, type Lens } from "./DayPanel";
import { PeopleWeek } from "./PeopleWeek";
import { FilterPanel } from "./FilterPanel";
import { TaskPreview } from "./TaskPreview";

// The full task panel is big and only opens on ?task= for a task the viewer can edit: load it on demand,
// and warm it up when the pointer or the keyboard reaches a task row.
const loadTaskPanel = () => import("@/components/tasks/TaskDetailPanel");
const TaskDetailPanel = lazy(() => loadTaskPanel().then((m) => ({ default: m.TaskDetailPanel })));
let taskPanelWarm = false;
function warmTaskPanel(e: SyntheticEvent) {
  if (taskPanelWarm || !(e.target as HTMLElement).closest?.("[data-cal-item]")) return;
  taskPanelWarm = true;
  void loadTaskPanel();
}

/** What the URL carries (see routes/_app/calendar.tsx). Defaults are left out of the URL. */
export type CalSearch = {
  date?: string
  view?: "people"
  lens?: "person"
  focus?: string
  scope?: "me" | "division"
  unit?: string
  person?: string
  project?: string
  prio?: string
  done?: "0"
  overdue?: "1"
  task?: string
};

const POLL_MS = 60_000;
const list = (s?: string) => (s ? s.split(",").filter(Boolean) : []);
const joined = (l: string[]) => (l.length ? l.join(",") : undefined);

/** The calendar's own keyboard-focus ring (the Bagan navy), for every control of the header. */
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cal-accent";
// Touch: at least 44px (a finger, not the text size, sets it); a larger text size still grows the control.
const coarseText = "py-1 pointer-coarse:h-auto pointer-coarse:min-h-[44px]";
const coarseIcon = "pointer-coarse:size-[44px]";

// ── Layout from the calendar's own width ─────────────────────────────────────────────────────────────
// The app sidebar (16rem, or 3rem collapsed) sits beside the calendar from md up, so the viewport says
// little about the room the calendar has. Every layout switch below reads the calendar root's width, in
// rem so a larger browser text size gets the roomier layout sooner.

type CalLayout = {
  /** Day panel beside the month (desktop pane layout) instead of under it. */
  wide: boolean
  /** The wider day panel (26.25rem instead of 23.75rem). */
  wideAside: boolean
  /** Month cells without counts and holiday names: a column would be under 4rem. */
  gridCompact: boolean
  /** People as a list instead of the week table (the table needs ~50rem). */
  peopleCompact: boolean
};

const PHONE_QUERY = "(max-width: 767px)";

function layoutFor(px: number, remPx: number, phone: boolean): CalLayout {
  const w = px / remPx;
  const wide = !phone && w >= 62.5;
  const wideAside = wide && w >= 75;
  // Page padding: p-3 on a phone, md:px-8 from md up; the side panel takes its width in the wide layout.
  const gridW = wide ? w - (wideAside ? 26.25 : 23.75) - 4 : w - (phone ? 1.5 : 4);
  return { wide, wideAside, gridCompact: phone || gridW / 7 < 4, peopleCompact: phone || w < 50 };
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** First guess before the root is measured: the viewport minus the sidebar (from its cookie). */
function guessWidth(): number {
  const vw = window.innerWidth;
  if (vw < 768) return vw;
  return vw - (/(?:^|; )sidebar_state=false/.test(document.cookie) ? 48 : 256);
}

function useCalLayout(ref: RefObject<HTMLElement | null>): CalLayout {
  const [lay, setLay] = useState<CalLayout>(() => (typeof window === "undefined"
    ? { wide: true, wideAside: false, gridCompact: false, peopleCompact: false }
    : layoutFor(guessWidth(), remPx(), window.matchMedia(PHONE_QUERY).matches)));
  // Measured before paint; a state update only when a switch actually flips, not on every pixel of a resize.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = layoutFor(el.getBoundingClientRect().width, remPx(), window.matchMedia(PHONE_QUERY).matches);
      setLay((prev) => (prev.wide === next.wide && prev.wideAside === next.wideAside && prev.gridCompact === next.gridCompact && prev.peopleCompact === next.peopleCompact ? prev : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return lay;
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;
/** The next WIB midnight after `ms` (WIB is UTC+7 all year). */
const nextWibMidnight = (ms: number) => Math.floor((ms + WIB_MS) / DAY_MS) * DAY_MS + DAY_MS - WIB_MS;

/**
 * "Now" for overdue states. It only matters when something changes with it — a timed task passing its
 * due time, or the WIB day turning over — so it ticks exactly then (at least hourly, and when the tab
 * comes back), instead of re-drawing the whole calendar every minute.
 */
function useCalendarClock(items: CalItem[] | undefined): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let next = nextWibMidnight(nowMs);
    for (const i of items ?? []) {
      if (i.time === null || i.done || i.noStatus || i.status === "CANCELLED") continue;
      const due = Date.parse(i.due);
      if (due > nowMs && due < next) next = due;
    }
    const id = window.setTimeout(() => setNowMs(Date.now()), Math.min(Math.max(next - Date.now(), 0) + 250, 3_600_000));
    const onVisible = () => { if (document.visibilityState === "visible") setNowMs(Date.now()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [nowMs, items]);
  return nowMs;
}

// ── Single-key shortcuts (WCAG 2.1.4: they can be turned off) ────────────────────────────────────────

const SHORTCUTS_KEY = "nexus.calendar.shortcuts";
function readShortcuts(): boolean {
  try { return localStorage.getItem(SHORTCUTS_KEY) !== "off"; } catch { return true; }
}
/** Focus on these takes its own keys (arrows, typing); single-key shortcuts stay out of the way. */
const OWN_KEYS = '[role="radio"],[role="tab"],[role="option"],[role="menuitem"],[role="switch"],[role="checkbox"],[data-cal-item]';

/**
 * The Calendar (master calendar, owner 5 Oct 2026): every task with a due date in the company, dots per
 * Bagan division on the month, the day split by division or by person, and a week "People" table.
 * Rules: lib/calendar/core.ts (client) and the server's lib/calendar (who sees what, where a task sits).
 */
export function CalendarPage({ search, setSearch }: { search: CalSearch; setSearch: (patch: Partial<CalSearch>) => void }) {
  const { t, tn, locale, lang } = useLang();
  useDocumentLang(lang);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const phone = useIsMobile();
  const lay = useCalLayout(rootRef);
  const qc = useQueryClient();
  const view = search.view === "people" ? "people" : "month";
  const lens: Lens = search.lens === "person" ? "person" : "division";
  const filters: CalFilters = useMemo(() => ({
    scope: (search.scope ?? "all") as CalScope,
    units: list(search.unit), people: list(search.person), projects: list(search.project), priorities: list(search.prio),
    hideDone: search.done === "0", overdueOnly: search.overdue === "1",
  }), [search.scope, search.unit, search.person, search.project, search.prio, search.done, search.overdue]);
  const nFilters = activeFilterCount(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const closeFilters = useCallback(() => setFilterOpen(false), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpener = useRef<HTMLElement | null>(null);
  const openHelp = useCallback(() => {
    helpOpener.current = document.activeElement as HTMLElement | null;
    setHelpOpen(true);
  }, []);
  const [shortcutsOn, setShortcutsOn] = useState(readShortcuts);
  const changeShortcuts = useCallback((on: boolean) => {
    setShortcutsOn(on);
    try { localStorage.setItem(SHORTCUTS_KEY, on ? "on" : "off"); } catch { /* ignore */ }
  }, []);

  // ── Data ──
  // Same keys and options as the route's loader (routes/_app/calendar.tsx), which starts these requests early.
  const structureQ = useQuery({ queryKey: ["nexus", "calendar-tasks", "structure"], queryFn: nexusApi.calendarStructure, staleTime: 5 * 60_000, retry: 1 });
  const overdueQ = useQuery({ queryKey: ["nexus", "calendar-tasks", "overdue"], queryFn: nexusApi.calendarOverdue, staleTime: 60_000, refetchInterval: POLL_MS, retry: 1 });
  const dateParam = search.date;
  // The clock below reads the items, so the items query cannot wait for its `today`: it takes the URL
  // date or the device's WIB day right now (the clock ticks at WIB midnight, so the two agree).
  const range = gridRange(dateParam ?? wibToday());
  const itemsQ = useQuery({
    queryKey: ["nexus", "calendar-tasks", "items", range.from, range.to],
    queryFn: () => nexusApi.calendarItems(range.from, range.to),
    staleTime: 60_000, refetchInterval: POLL_MS, placeholderData: keepPreviousData, retry: 1,
  });
  const items = itemsQ.data?.items;
  const nowMs = useCalendarClock(items);
  const today = wibToday(nowMs);
  const date = dateParam ?? today;
  // The months either side, so ‹ › is instant.
  useEffect(() => {
    for (const n of [-1, 1]) {
      const r = gridRange(shiftMonth(date, n));
      void qc.prefetchQuery({ queryKey: ["nexus", "calendar-tasks", "items", r.from, r.to], queryFn: () => nexusApi.calendarItems(r.from, r.to), staleTime: 60_000 });
    }
  }, [date, qc]);
  // A changed Bagan (structureVersion) → fetch the structure again.
  const sv = itemsQ.data?.structureVersion;
  useEffect(() => {
    if (sv && structureQ.data?.version && sv !== structureQ.data.version) void structureQ.refetch();
  }, [sv, structureQ]);

  const structure = structureQ.data;
  const ix = useMemo(() => indexStructure(structure?.units ?? [], structure?.people ?? []), [structure]);
  const focusId = search.focus && ix.byId.has(search.focus) ? search.focus : (ix.top?.id ?? "");
  const windowDays = itemsQ.data?.rules?.overdueWindowDays ?? 14;
  const meId = structure?.me?.userId ?? null;
  const myHomes = useMemo(() => structure?.me?.homeUnitIds ?? [], [structure]);
  const extra = useMemo(() => ({ ...(overdueQ.data?.people ?? {}), ...(itemsQ.data?.people ?? {}) }), [itemsQ.data, overdueQ.data]);
  const people: PeopleLookup = useCallback((id: string) => {
    const p = ix.person.get(id);
    if (p) return { name: p.name ?? "?", avatar: p.avatar, inChart: p.homeUnitIds.length > 0 };
    const x = extra[id];
    return { name: x?.name ?? t("Former member"), avatar: x?.avatar ?? null, inChart: false };
  }, [ix, extra, t]);

  // filterItems reads the clock only for "Only overdue"; otherwise a tick must not re-filter everything.
  const filterNow = filters.overdueOnly ? nowMs : 0;
  const fctx = useMemo(() => ({ ix, meId, myHomes, today, nowMs: filterNow, windowDays }), [ix, meId, myHomes, today, filterNow, windowDays]);
  const visible = useMemo(() => underFocus(filterItems(items ?? [], filters, fctx), ix, focusId), [items, filters, fctx, ix, focusId]);
  const perDay = useMemo(() => byDay(visible), [visible]);
  const days = useMemo(() => monthGrid(date), [date]);
  const month = date.slice(0, 7);
  const cells = useMemo(() => new Map(days.map((d) => [d, dayCell(d, perDay.get(d) ?? [], ix, focusId, today, nowMs, windowDays)])), [days, perDay, ix, focusId, today, nowMs, windowDays]);
  const monthItems = useMemo(() => visible.filter((i) => i.day.startsWith(month)), [visible, month]);
  const legendRows = useMemo(() => legend(monthItems, ix, focusId), [monthItems, ix, focusId]);
  const tree = useMemo(() => dayTree(perDay.get(date) ?? [], ix, focusId, today, nowMs, windowDays), [perDay, date, ix, focusId, today, nowMs, windowDays]);
  const rail = useMemo(() => (date === today
    ? overdueRail(underFocus(filterItems(overdueQ.data?.items ?? [], filters, fctx), ix, focusId), perDay.get(today) ?? [], today, nowMs, windowDays)
    : []), [date, today, overdueQ.data, filters, fctx, ix, focusId, perDay, nowMs, windowDays]);
  const monday = mondayOf(date);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const rows = useMemo(() => (view === "people" ? weekRows(visible, ix, focusId, monday, today, nowMs, windowDays) : []), [view, visible, ix, focusId, monday, today, nowMs, windowDays]);
  const holidays = useMemo(() => new Map((itemsQ.data?.holidays ?? []).map((h) => [h.day, h.name])), [itemsQ.data]);
  const allMonthCount = useMemo(() => (items ?? []).filter((i) => i.day.startsWith(month)).length, [items, month]);

  // Hovering (or tabbing to) a legend chip dims the other units' dots in the month. Pure CSS, one rule
  // per chip, so moving the pointer along the chips re-renders nothing.
  const hoverCss = useMemo(() => legendRows.map((l) => {
    const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(l.unitId) : l.unitId;
    return `[data-cal-root]:has([data-legend="${id}"]:is(:hover,:focus-visible)) [data-cal-grid] [data-unit]:not([data-unit="${id}"]){opacity:.25}`;
  }).join("\n"), [legendRows]);

  // ── Navigation ──
  const go = useCallback((d: string) => setSearch({ date: d === today ? undefined : d }), [setSearch, today]);
  const step = (n: number) => go(view === "people" ? addDays(date, 7 * n) : shiftMonth(date, n));
  const setFilters = useCallback((f: CalFilters) => setSearch({
    scope: f.scope === "all" ? undefined : f.scope, unit: joined(f.units), person: joined(f.people), project: joined(f.projects),
    prio: joined(f.priorities), done: f.hideDone ? "0" : undefined, overdue: f.overdueOnly ? "1" : undefined,
  }), [setSearch]);
  const resetFilters = useCallback(() => setFilters(NO_FILTERS), [setFilters]);
  const open = useCallback((i: CalItem) => { if (i.id) setSearch({ task: i.id }); }, [setSearch]);
  const openDay = useCallback((d: string) => setSearch({ view: undefined, date: d === today ? undefined : d, lens: "person" }), [setSearch, today]);
  const setLens = useCallback((l: Lens) => setSearch({ lens: l === "person" ? "person" : undefined }), [setSearch]);
  const prevDay = useCallback(() => go(addDays(date, -1)), [go, date]);
  const nextDay = useCallback(() => go(addDays(date, 1)), [go, date]);
  const goToday = useCallback(() => go(today), [go, today]);
  // A day picked on the grid announces itself through the focused cell; the live region stays quiet then.
  const quietLive = useRef(false);
  const selectFromGrid = useCallback((d: string) => {
    if (d !== date) quietLive.current = true;
    go(d);
  }, [go, date]);
  const foundItem = useMemo(() => (search.task ? [...(items ?? []), ...(overdueQ.data?.items ?? [])].find((i) => i.id === search.task) ?? null : null), [search.task, items, overdueQ.data]);
  // Decide once per opened task: saving a new due date (or cancelling) refetches the items without it,
  // and the open panel must not turn into the read-only preview mid-edit.
  const keptItem = useRef<CalItem | null>(null);
  if (foundItem) keptItem.current = foundItem;
  const openItem = foundItem ?? (keptItem.current?.id === search.task ? keptItem.current : null);
  // A task that is not in what is loaded (a shared link, another month): ask the server how it may open.
  const lookupQ = useQuery({
    queryKey: ["nexus", "calendar-tasks", "task", search.task],
    queryFn: () => nexusApi.calendarTask(search.task!),
    enabled: !!search.task && !openItem && !itemsQ.isLoading && !overdueQ.isLoading,
    staleTime: 60_000, retry: false,
  });
  const deciding = !!search.task && !openItem && (itemsQ.isLoading || overdueQ.isLoading || lookupQ.isLoading);
  // The full panel saves against the task's home project; editing through a linked project would be
  // refused there, so that case opens read-only too.
  const editable = openItem
    ? openItem.canEdit && openItem.editProjectId === openItem.project?.id
    : !!lookupQ.data?.canEdit && lookupQ.data.editProjectId === lookupQ.data.projectId;
  const openMasked = openItem ? openItem.masked : !!lookupQ.data?.masked;

  // ── Keyboard ──
  // Arrow keys and [ ] belong to the month grid (MonthGrid, only while a day has focus). The single-key
  // shortcuts below fire only where the calendar owns the keyboard — nothing focused, or a plain control
  // of the calendar — never in a field, a dialog, a radio group or on a task row, and they can be turned
  // off in the shortcut list. They are not offered on a phone, where that list is not reachable.
  const singleKeys = shortcutsOn && !phone;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Radix tooltips/popovers/dialogs and the drawer call preventDefault when Escape closes them.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (helpOpen) {
        if (k === "?" && singleKeys) { e.preventDefault(); setHelpOpen(false); }
        return;
      }
      if (search.task || filterOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // Any other dialog of the app (attendance, announcement…) sits on top.
      if (document.querySelector('[aria-modal="true"]')) return;
      const onPage = !el || el === document.body || el === document.documentElement;
      if (!onPage && !rootRef.current?.contains(el)) return;
      if (k === "Escape") {
        if (search.focus) { e.preventDefault(); setSearch({ focus: undefined }); }
        return;
      }
      if (!singleKeys || el?.closest?.(OWN_KEYS)) return;
      const map: Record<string, () => void> = {
        t: () => go(today), T: () => go(today),
        j: () => step(-1), k: () => step(1),
        l: () => setSearch({ lens: lens === "division" ? "person" : undefined }),
        m: () => setSearch({ view: undefined }), p: () => setSearch({ view: "people" }),
        f: () => setFilterOpen(true),
        "?": openHelp,
      };
      const fn = map[k];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── States before there is a calendar to draw ──
  const access = structure?.access ?? itemsQ.data?.access;
  const firstLoad = (structureQ.isLoading || itemsQ.isLoading) && !itemsQ.data;
  const failed = (structureQ.isError && !structure) || (itemsQ.isError && !itemsQ.data);
  const tzNotWib = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone !== "Asia/Jakarta"; } catch { return false; } }, []);
  const paneLayout = lay.wide && view === "month" && !failed && access !== "none" && access !== "off";

  // ── Screen-reader announcement: the day and its count when the day changes off the grid (‹ › of the
  // day panel, T, Today) or its tasks change. Nothing on page load.
  const liveMsg = `${fmtDay(date, { weekday: "long", day: "numeric", month: "long" }, locale)} · ${tree.total ? tn(tree.total, "{n} task", "{n} tasks") : t("No tasks")}`;
  const [live, setLive] = useState("");
  const lastMsg = useRef<string | null>(null);
  useEffect(() => {
    if (firstLoad) return;
    const prev = lastMsg.current;
    lastMsg.current = liveMsg;
    if (prev === null || prev === liveMsg) return;
    if (quietLive.current) { quietLive.current = false; return; }
    setLive(liveMsg);
  }, [liveMsg, firstLoad]);

  // The page header sticks only over the People week table (its week controls stay with the table it
  // scrolls). In the month it scrolls away with the grid it drives: below the grid the day panel's own
  // header sticks instead (day ‹ ›, by division / by person), so reading a day never loses a fifth of the
  // screen to month controls — on a phone, and on a tablet whose header wraps to 3–4 rows. The pane
  // layout's panes scroll on their own. Written straight onto the root, no re-render: --cal-header-h =
  // the header's height, --cal-sticky-top = the same while it sticks, else 0 (offset for what sticks under it).
  const headerSticky = view === "people" && !lay.peopleCompact;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const head = headerRef.current;
    if (!root || !head) return;
    const set = () => {
      const h = `${head.offsetHeight}px`;
      root.style.setProperty("--cal-header-h", h);
      root.style.setProperty("--cal-sticky-top", headerSticky ? h : "0px");
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => ro.disconnect();
  }, [headerSticky]);

  const iconButton = cn("grid size-8 shrink-0 place-items-center rounded-lg hover:bg-muted", coarseIcon, focusRing);

  const header = (
    <header ref={headerRef} className={cn("z-30 border-b border-border", headerSticky ? "sticky top-0 bg-background/85 backdrop-blur" : "bg-background")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2.5 pt-3 md:px-8 md:pt-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-cal-accent text-cal-accent-foreground"><CalendarDays className="h-4 w-4" /></span>
          <h1 className="font-display text-xl font-bold tracking-tight md:text-2xl">{t("Calendar")}</h1>
        </div>
        {/* On a phone the month controls take their own line under the title and the view switch. */}
        <div className={cn("flex min-w-0 flex-wrap items-center gap-1", phone && "order-last")}>
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={() => step(-1)} aria-label={view === "people" ? t("Previous week") : t("Previous month")} className={iconButton}><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-[min(8.25rem,40vw)] truncate text-center font-display text-base font-bold tabular-nums md:min-w-40">
              {view === "people"
                ? `${fmtDay(weekDays[0], { day: "numeric", month: "short" }, locale)} – ${fmtDay(weekDays[6], { day: "numeric", month: "short", year: "numeric" }, locale)}`
                : fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale)}
            </div>
            <button type="button" onClick={() => step(1)} aria-label={view === "people" ? t("Next week") : t("Next month")} className={iconButton}><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={goToday} disabled={date === today}
            className={cn("ml-1 inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50", coarseText, focusRing)}>
            {t("Today")}
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label={t("View")} value={view} onChange={(v) => setSearch({ view: v === "people" ? "people" : undefined })} options={[{ id: "month", label: t("Month") }, { id: "people", label: t("People") }]} />
          {!phone && (
            <Segmented label={t("Show")} value={filters.scope} onChange={(v) => setFilters({ ...filters, scope: v as CalScope })}
              options={[{ id: "all", label: t("Everyone") }, { id: "me", label: t("Mine") }, { id: "division", label: t("My division"), disabled: myHomes.length === 0 }]} />
          )}
          {phone ? (
            <Drawer open={filterOpen} onOpenChange={setFilterOpen} shouldScaleBackground={false}>
              <DrawerTrigger asChild><FilterButton count={nFilters} /></DrawerTrigger>
              <DrawerContent lang={lang} aria-describedby={undefined} className="max-h-[92dvh]">
                <DrawerHeader><DrawerTitle>{t("Filters")}</DrawerTitle></DrawerHeader>
                {/* The drawer body is the one scroller; the panel's Reset / Done footer sticks to its bottom. */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
                  <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} onDone={closeFilters} ix={ix} items={items ?? []} people={people} myHomes={myHomes} />
                </div>
              </DrawerContent>
            </Drawer>
          ) : (
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild><FilterButton count={nFilters} /></PopoverTrigger>
              <PopoverContent lang={lang} aria-label={t("Filters")} align="end" className="max-h-[78vh] w-90 overflow-y-auto overscroll-contain rounded-2xl p-4">
                <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} ix={ix} items={items ?? []} people={people} myHomes={myHomes} />
              </PopoverContent>
            </Popover>
          )}
          {nFilters > 0 && (
            <button type="button" onClick={resetFilters}
              className={cn("inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground", coarseText, focusRing)}>
              <X className="h-3.5 w-3.5" />{t("Reset")}
            </button>
          )}
          {!phone && (
            <button type="button" onClick={openHelp} aria-label={t("Keyboard shortcuts")} className={cn(iconButton, "text-muted-foreground")}><Keyboard className="h-4 w-4" /></button>
          )}
        </div>
      </div>
      {structure && access !== "none" && access !== "off" && (
        // Below md the chips scroll sideways (snapping, the right edge fading out); from md up they wrap.
        <div className="flex snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4 pb-2.5 max-md:pr-8 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] max-md:[scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-8">
          {focusId !== ix.top?.id && (
            <nav aria-label={t("Focus")} className="flex shrink-0 snap-start items-center gap-1 text-xs font-semibold">
              {[...ix.ancestors(focusId)].reverse().concat(focusId).map((id, i, all) => (
                <span key={id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  <button type="button" disabled={i === all.length - 1} onClick={() => setSearch({ focus: id === ix.top?.id ? undefined : id })}
                    aria-current={i === all.length - 1 ? "location" : undefined}
                    className={cn("inline-flex h-7 items-center rounded-md px-1.5", coarseText, focusRing,
                      i === all.length - 1 ? "bg-cal-accent text-cal-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    {i === 0 ? t("All") : ix.byId.get(id)?.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {legendRows.map((l) => {
            const u = ix.byId.get(l.unitId);
            const name = l.unitId === "other" ? t("Other") : (u?.name ?? "");
            const canZoom = !!u && l.unitId !== focusId && (ix.children.get(l.unitId)?.length ?? 0) > 0;
            const on = filters.units.includes(l.unitId);
            return (
              <button key={l.unitId} type="button" data-legend={l.unitId}
                onClick={() => (canZoom ? setSearch({ focus: l.unitId }) : setFilters({ ...filters, units: on ? filters.units.filter((x) => x !== l.unitId) : [...filters.units, l.unitId] }))}
                // A chip either zooms into its division (magnifier) or toggles it as a filter (pressed state).
                aria-pressed={canZoom ? undefined : on}
                aria-label={canZoom
                  ? tn(l.count, "Zoom into {unit}, {n} task", "Zoom into {unit}, {n} tasks", { unit: name })
                  : tn(l.count, "{unit}, {n} task", "{unit}, {n} tasks", { unit: name })}
                title={canZoom ? t("Zoom into {unit}", { unit: name }) : t("Filter by {unit}", { unit: name })}
                className={cn("inline-flex h-7 shrink-0 snap-start items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors", coarseText, focusRing,
                  on ? "border-cal-accent bg-cal-accent-soft" : "border-border bg-card hover:border-cal-accent/40")}>
                <UnitDot unit={u} size={8} />
                <span className="max-w-40 truncate">{name}</span>
                <span className="tabular-nums text-muted-foreground">{l.count}</span>
                {canZoom && <ZoomIn aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
          {tzNotWib && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"><Globe2 className="h-3 w-3" />{t("Times in WIB")}</span>}
        </div>
      )}
    </header>
  );

  let body: ReactNode;
  if (failed) {
    body = <div className="p-4 md:px-8 md:py-6"><EmptyState icon={AlertTriangle} tone="muted" title={t("The calendar could not be loaded")} message={t("Check the connection and try again.")} action={<EmptyAction onClick={() => { void structureQ.refetch(); void itemsQ.refetch(); }}>{t("Try again")}</EmptyAction>} /></div>;
  } else if (access === "none") {
    body = <div className="p-4 md:px-8 md:py-6"><EmptyState icon={Lock} title={t("This calendar is for members of the company")} message={t("You are in a personal workspace. Ask a BoD or Manager to add you to the company's workspace; the Calendar then shows the tasks of everyone there.")} action={<EmptyAction to="/my-tasks">{t("Open My Mission")}</EmptyAction>} /></div>;
  } else if (access === "off") {
    body = <div className="p-4 md:px-8 md:py-6"><EmptyState icon={CalendarDays} title={t("The Calendar is on its way")} message={t("It opens for BoD and Managers first, then for everyone. Your own tasks are still in My Mission.")} action={<EmptyAction to="/my-tasks">{t("Open My Mission")}</EmptyAction>} /></div>;
  } else if (firstLoad) {
    body = <SkeletonCalendar compact={lay.gridCompact} />;
  } else {
    const banner = allMonthCount === 0 && view === "month"
      ? <Banner text={t("Nothing has a due date in {month} yet.", { month: fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale) })} action={month !== today.slice(0, 7) ? { label: t("Go to this month"), onClick: goToday } : undefined} />
      : monthItems.length === 0 && nFilters > 0 && view === "month"
        ? <Banner text={t("Nothing matches the filters this month.")} action={{ label: t("Reset filters"), onClick: resetFilters }} />
        : null;
    const panel = (
      <DayPanel day={date} today={today} nowMs={nowMs} windowDays={windowDays} holiday={holidays.get(date) ?? null} tree={tree} rail={rail} ix={ix}
        lens={lens} onLens={setLens}
        onPrev={prevDay} onNext={nextDay} onOpen={open} people={people} myHomes={myHomes}
        filtersActive={nFilters > 0} onResetFilters={resetFilters} onToday={goToday} monthEmpty={allMonthCount === 0} compact={!lay.wide} />
    );
    body = view === "people" ? (
      <div className="space-y-3 p-3 md:px-8 md:py-6">
        <PeopleWeek rows={rows} days={weekDays} today={today} nowMs={nowMs} windowDays={windowDays} ix={ix} people={people}
          onOpenDay={openDay} onOpen={open} compact={lay.peopleCompact} />
      </div>
    ) : paneLayout ? (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-8 py-6">
          {banner}
          <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} onSelect={selectFromGrid} busy={itemsQ.isPlaceholderData} compact={lay.gridCompact} fill />
          <Legend />
          {itemsQ.data?.truncated && <Banner text={t("This month has more tasks than the calendar can show at once.")} />}
        </div>
        <aside className={cn("shrink-0 overflow-y-auto border-l border-border bg-card/40", lay.wideAside ? "w-105" : "w-95")}>
          {panel}
        </aside>
      </div>
    ) : (
      <div className="space-y-3 p-3 md:px-8 md:py-6">
        {banner}
        <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} onSelect={selectFromGrid} busy={itemsQ.isPlaceholderData} compact={lay.gridCompact} />
        {!phone && <Legend />}
        {/* overflow-clip, not hidden: rounds the corners but leaves the page as the scroller, so the day
            panel's header can stick while its list scrolls. */}
        <div className="overflow-clip rounded-2xl border border-border bg-card shadow-soft">{panel}</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} lang={lang} data-cal-root="" onPointerOver={warmTaskPanel} onFocusCapture={warmTaskPanel}
      className={cn("flex flex-col", paneLayout ? "h-[100dvh]" : "min-h-[100dvh]")}>
      {hoverCss && <style>{hoverCss}</style>}
      {header}
      {body}
      {search.task && !deciding && (editable
        ? <Suspense fallback={null}><TaskDetailPanel taskId={search.task} onClose={() => setSearch({ task: undefined })} /></Suspense>
        : <TaskPreview taskId={search.task} projectName={openItem?.project?.name ?? null} notMember={openItem !== null || !!lookupQ.data?.found} masked={openMasked} onClose={() => setSearch({ task: undefined })} />)}
      {!phone && <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} returnFocus={helpOpener} enabled={shortcutsOn} onEnabledChange={changeShortcuts} />}
      <span className="sr-only" aria-live="polite">{live}</span>
    </div>
  );
}

/**
 * A one-of-n switch (view, scope): a radio group — Tab reaches the chosen option, the arrow keys move the
 * choice, as the radio pattern promises.
 */
function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string; disabled?: boolean }[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  const chosen = options.findIndex((o) => o.id === value);
  const tabStop = chosen >= 0 && !options[chosen].disabled ? chosen : enabled[0];
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const at = enabled.indexOf(i);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? enabled[(at + 1) % enabled.length]
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? enabled[(at - 1 + enabled.length) % enabled.length]
      : e.key === "Home" ? enabled[0]
      : e.key === "End" ? enabled[enabled.length - 1]
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    if (options[next].id !== value) onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      {options.map((o, i) => (
        <button key={o.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o.id}
          tabIndex={i === tabStop ? 0 : -1} disabled={o.disabled} onClick={() => onChange(o.id)} onKeyDown={(e) => onKeyDown(e, i)}
          className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40", coarseText, focusRing,
            value === o.id ? "bg-cal-accent text-cal-accent-foreground" : "text-muted-foreground hover:bg-muted")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterButton({ count, className, ...rest }: { count: number } & ComponentPropsWithRef<"button">) {
  const { t } = useLang();
  return (
    <button {...rest} type="button" className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors", coarseText, focusRing,
      count ? "border-cal-accent bg-cal-accent-soft text-foreground" : "border-border hover:bg-muted", className)}>
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {t("Filters")}
      {count > 0 && <span className="rounded-full bg-cal-accent px-1.5 text-2xs text-cal-accent-foreground">{count}</span>}
    </button>
  );
}

function Legend() {
  const { t } = useLang();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full bg-cal-accent" />{t("has tasks to do")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-cal-accent" />{t("done or no status")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4 rounded-full bg-rose-500" />{t("overdue")}</span>
      <span>{t("Dots follow the IP & Division Chart. Click a name with a magnifier to zoom in, any other name to filter.")}</span>
    </div>
  );
}

function Banner({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button type="button" onClick={action.onClick} className={cn("inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground", coarseText, focusRing)}>{action.label}</button>
      )}
    </div>
  );
}

function SkeletonCalendar({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-3 p-3 md:px-8 md:py-6" aria-busy>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="h-9 border-b border-border bg-muted/40" />
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }, (_, i) => (
            <div key={i} className={cn("border-b border-r border-border/60 p-2", compact ? "h-13" : "h-24")}>
              <div className="h-4 w-4 rounded-full bg-muted motion-safe:animate-pulse" />
              {i % 3 === 0 && <div className="mt-6 flex gap-1"><div className="h-1.5 w-1.5 rounded-full bg-muted" /><div className="h-1.5 w-1.5 rounded-full bg-muted" /></div>}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-10 rounded-xl bg-muted/70 motion-safe:animate-pulse" />)}
      </div>
    </div>
  );
}

/** The shortcut list, on the Radix dialog (focus kept inside, Escape, focus back to where it was). */
function ShortcutHelp({ open, onOpenChange, returnFocus, enabled, onEnabledChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus: RefObject<HTMLElement | null>
  enabled: boolean; onEnabledChange: (on: boolean) => void
}) {
  const { t, lang } = useLang();
  const switchId = useId();
  const hintId = useId();
  const rows: [string, string][] = [
    ["T", t("Today")], ["J / K", t("Previous / next month (week in People)")], ["← → ↑ ↓", t("Move the selected day")],
    ["[ ]", t("Previous / next day")], ["L", t("Switch by division / by person")], ["M / P", t("Month / People")],
    ["F", t("Filters")], ["Esc", t("Close, then leave the zoom")], ["?", t("This list")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-scrim backdrop-blur-sm" />
        <DialogPrimitive.Content
          lang={lang}
          aria-describedby={undefined}
          // Opened by "?" there is no trigger to return to: go back to whatever had focus before.
          onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus.current?.focus?.(); }}
          className="fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-pop outline-none"
        >
          <div className="mb-3 flex items-center justify-between">
            <DialogTitle className="font-display text-base font-bold leading-normal tracking-normal">{t("Keyboard shortcuts")}</DialogTitle>
            <DialogPrimitive.Close aria-label={t("Close")} className={cn("grid size-8 place-items-center rounded-lg hover:bg-muted", focusRing)}><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t("Arrow keys and [ ] move the day while a date in the month has keyboard focus.")}</p>
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-0">
              <label htmlFor={switchId} className="text-sm font-semibold">{t("Single-key shortcuts")}</label>
              <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">{t("Turn them off if they clash with a screen reader or voice control.")}</p>
            </div>
            <Switch id={switchId} aria-describedby={hintId} checked={enabled} onCheckedChange={onEnabledChange}
              className="mt-0.5 data-[state=checked]:bg-cal-accent data-[state=unchecked]:bg-control-border" />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
