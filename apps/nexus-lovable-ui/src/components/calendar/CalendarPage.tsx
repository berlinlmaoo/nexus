import {
  lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ComponentPropsWithRef, type ReactNode, type RefObject, type SyntheticEvent,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Focus, Globe2, Keyboard, Lock, SlidersHorizontal, X } from "lucide-react";
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
  addDays, bucketOf, byDay, clearFilters, dayCell, dayTree, filterCount, filterItems, gridRange, indexStructure, legend,
  monthGrid, mondayOf, overdueRail, shiftMonth, underFocus, weekRows,
  type CalFilters, type CalItem, type CalScope,
} from "@/lib/calendar/core";
import { CAL_SWITCH, DoneTick, FOCUS_PILL, fmtDay, TOUCH_ICON, TOUCH_ROW, UnitDot, wibToday, type PeopleLookup } from "./bits";
import { HOLIDAY_CUE, MonthGrid } from "./MonthGrid";
import { DayPanel, type Lens } from "./DayPanel";
import { PeopleWeek } from "./PeopleWeek";
import { FilterPanel } from "./FilterPanel";
import { TaskPreview } from "./TaskPreview";
import { Segmented, type SegmentedOption } from "./Segmented";

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
const cssId = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id);
const pick = (root: RefObject<HTMLElement | null>, selector: string) => root.current?.querySelector<HTMLElement>(selector) ?? null;

// Touch: at least 44px (a finger, not the text size, sets it); a larger text size still grows the control.
// The header's buttons have a fixed height, which a touch screen lets go of.
const coarseText = `py-1 pointer-coarse:h-auto ${TOUCH_ROW}`;
const coarseIcon = TOUCH_ICON;

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
  // Page padding: 12px on a phone, md:px-8 from md up; the side panel takes its width in the wide layout.
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
  const month = date.slice(0, 7);
  // The months either side, so ‹ › is instant: once per month shown, not again on every day picked in it.
  useEffect(() => {
    for (const n of [-1, 1]) {
      const r = gridRange(shiftMonth(`${month}-01`, n));
      void qc.prefetchQuery({ queryKey: ["nexus", "calendar-tasks", "items", r.from, r.to], queryFn: () => nexusApi.calendarItems(r.from, r.to), staleTime: 60_000 });
    }
  }, [month, qc]);
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

  // ── Filters ──
  // Everyone / Mine / My division is the view's scope, not a filter (owner, round 2): it has its own
  // switch in the header, is not counted on the Filters button, and "Reset filters" keeps it. "My
  // division" for someone without a card in the Bagan would hide every task (a widget link can ask for
  // it): it opens as Mine, with a note saying why. Only once the Bagan is in; before that nobody has a card.
  const divisionOff = !!structure && myHomes.length === 0;
  const askedScope: CalScope = search.scope ?? "all";
  const scope: CalScope = askedScope === "division" && divisionOff ? "me" : askedScope;
  const filters: CalFilters = useMemo(() => ({
    scope,
    units: list(search.unit), people: list(search.person), projects: list(search.project), priorities: list(search.prio),
    hideDone: search.done === "0", overdueOnly: search.overdue === "1",
  }), [scope, search.unit, search.person, search.project, search.prio, search.done, search.overdue]);
  const nFilters = filterCount(filters);

  // filterItems reads the clock only for "Only overdue"; otherwise a tick must not re-filter everything.
  const filterNow = filters.overdueOnly ? nowMs : 0;
  const fctx = useMemo(() => ({ ix, meId, myHomes, today, nowMs: filterNow, windowDays }), [ix, meId, myHomes, today, filterNow, windowDays]);
  const visible = useMemo(() => underFocus(filterItems(items ?? [], filters, fctx), ix, focusId), [items, filters, fctx, ix, focusId]);
  const perDay = useMemo(() => byDay(visible), [visible]);
  const days = useMemo(() => monthGrid(date), [date]);
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
  const monthHasHoliday = useMemo(() => [...holidays.keys()].some((d) => d.startsWith(month)), [holidays, month]);
  const allMonthCount = useMemo(() => (items ?? []).filter((i) => i.day.startsWith(month)).length, [items, month]);

  // Hovering (or tabbing to) a legend chip dims the other units' dots in the month. Pure CSS, one rule
  // per chip, so moving the pointer along the chips re-renders nothing. Hover only where a pointer can
  // hover: after a tap, iOS and Android leave :hover on the chip, and the month would stay faded.
  const hoverCss = useMemo(() => {
    const dim = (id: string, state: string) => `[data-cal-root]:has([data-legend="${id}"]${state}) [data-cal-grid] [data-unit]:not([data-unit="${id}"]){opacity:.25}`;
    const ids = legendRows.map((l) => cssId(l.unitId));
    return ids.length ? `@media (hover:hover){${ids.map((id) => dim(id, ":hover")).join("")}}\n${ids.map((id) => dim(id, ":focus-visible")).join("\n")}` : "";
  }, [legendRows]);

  // ── Keyboard focus that an action would drop ──
  // A key pressed on a day that moves to another month, M / P, a breadcrumb, a chip that focuses or one
  // that a poll removes: each replaces the control that has focus, which then falls to <body> (the next
  // Tab starts over at the top of the page, a screen reader hears nothing). After every render the page
  // checks for that and puts focus on a stable control nearby: the planned one, else by where it was.
  // Popovers, drawers and dialogs give focus back on their own, so only the page itself is tracked.
  const gridRefocus = useRef(false);
  const lastFocus = useRef<{ el: HTMLElement; region: string } | null>(null);
  const focusPlan = useRef<(() => HTMLElement | null) | null>(null);
  const onFocusIn = useCallback((e: SyntheticEvent) => {
    warmTaskPanel(e);
    const el = e.target as HTMLElement;
    if (!rootRef.current?.contains(el)) return;
    lastFocus.current = { el, region: el.closest<HTMLElement>("[data-cal-region]")?.dataset.calRegion ?? "" };
  }, []);
  // A click or tap anywhere starts over: focus that the user moved away on purpose is never pulled back.
  useEffect(() => {
    const forget = () => { lastFocus.current = null; };
    document.addEventListener("pointerdown", forget, true);
    return () => document.removeEventListener("pointerdown", forget, true);
  }, []);
  useEffect(() => {
    const plan = focusPlan.current;
    focusPlan.current = null;
    const last = lastFocus.current;
    const active = document.activeElement;
    if (!last || (active && active !== document.body)) return;
    if (last.el.isConnected && !last.el.matches(":disabled")) return;
    const selectedDay = () => pick(rootRef, '[data-cal-grid] [role="gridcell"][aria-selected="true"]');
    const target = plan?.()
      ?? (last.region === "chips" ? pick(rootRef, "[data-cal-crumb][aria-current]") ?? pick(rootRef, "[data-legend]") : null)
      ?? (last.region === "panel" ? pick(rootRef, '[data-cal-region="panel"] h2[tabindex="-1"]') ?? pick(rootRef, '[data-cal-region="panel"] [role="radio"][aria-checked="true"]') ?? selectedDay() : null)
      ?? (last.region === "grid" ? selectedDay() : null)
      ?? (last.region === "people" ? pick(rootRef, '[data-cal-region="people"] h2[tabindex="-1"]') : null)
      ?? pick(rootRef, '[data-cal-view] [role="radio"][aria-checked="true"]');
    target?.focus();
  });

  // ── Navigation ──
  const go = useCallback((d: string) => setSearch({ date: d === today ? undefined : d }), [setSearch, today]);
  const stepDate = (n: number) => (view === "people" ? addDays(date, 7 * n) : shiftMonth(date, n));
  const step = (n: number) => go(stepDate(n));
  const setFilters = useCallback((f: CalFilters) => setSearch({
    scope: f.scope === "all" ? undefined : f.scope, unit: joined(f.units), person: joined(f.people), project: joined(f.projects),
    prio: joined(f.priorities), done: f.hideDone ? "0" : undefined, overdue: f.overdueOnly ? "1" : undefined,
  }), [setSearch]);
  const resetFilters = useCallback(() => setFilters(clearFilters(filters)), [setFilters, filters]);
  const showEveryone = useCallback(() => setFilters({ ...filters, scope: "all" }), [setFilters, filters]);
  const open = useCallback((i: CalItem) => { if (i.id) setSearch({ task: i.id }); }, [setSearch]);
  const openDay = useCallback((d: string) => {
    // From the People list to that day in the month: keyboard focus lands on the day.
    focusPlan.current = () => pick(rootRef, `[data-cal-grid] [data-day="${d}"]`);
    setSearch({ view: undefined, date: d === today ? undefined : d, lens: "person" });
  }, [setSearch, today]);
  const setLens = useCallback((l: Lens) => setSearch({ lens: l === "person" ? "person" : undefined }), [setSearch]);
  const prevDay = useCallback(() => go(addDays(date, -1)), [go, date]);
  const nextDay = useCallback(() => go(addDays(date, 1)), [go, date]);
  const goToday = useCallback(() => go(today), [go, today]);
  // Back to all divisions: the keyboard focus goes to the chip of the division it came from.
  const leaveFocus = () => {
    const from = focusId;
    const top = ix.top?.id;
    focusPlan.current = () => {
      const chip = top ? bucketOf(ix, from, top) : null;
      return chip ? pick(rootRef, `[data-legend="${cssId(chip)}"]`) : null;
    };
    setSearch({ focus: undefined });
  };
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
  // Arrow keys, [ ], Home / End and PageUp / PageDown belong to the month grid (MonthGrid, only while a
  // day has focus). The single-key shortcuts below fire only where the calendar owns the keyboard —
  // nothing focused, or a plain control of the calendar — never in a field, a dialog, a radio group or
  // on a task row, and they can be turned off in the shortcut list. They are not offered on a phone,
  // where that list is not reachable.
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
        if (search.focus) { e.preventDefault(); leaveFocus(); }
        return;
      }
      if (!singleKeys || el?.closest?.(OWN_KEYS)) return;
      // Pressed on a day of the month: the keyboard focus moves with the selection (and the focused day
      // announces itself, so the live region stays quiet).
      const onDay = !!el?.closest?.("[data-cal-grid]");
      const toDay = (d: string) => {
        if (onDay && d !== date) { gridRefocus.current = true; quietLive.current = true; }
        go(d);
      };
      const stepBy = (n: number) => {
        // In the People list the row that had focus may be gone with the week: the ‹ / › of the key takes it.
        if (view === "people") focusPlan.current = () => pick(rootRef, `[data-cal-step="${n}"]`);
        toDay(stepDate(n));
      };
      const map: Record<string, () => void> = {
        t: () => toDay(today), T: () => toDay(today),
        j: () => stepBy(-1), k: () => stepBy(1),
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
  // screen to month controls — on a phone, and on a tablet whose header wraps to 3–4 rows. Over the
  // People list (phone, narrow tablet) only the week controls stick, in a slim bar of their own
  // (weekBar). The pane layout's panes scroll on their own. Written straight onto the root, no
  // re-render: --cal-header-h = the header's height, --cal-sticky-top = the same while it sticks, else 0
  // (offset for what sticks under it).
  const headerSticky = view === "people" && !lay.peopleCompact;
  const weekBar = view === "people" && lay.peopleCompact;
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

  const iconButton = cn("grid size-8 shrink-0 place-items-center rounded-lg hover:bg-muted", coarseIcon, FOCUS_PILL);
  const atToday = date === today;
  const span = view === "people"
    ? `${fmtDay(weekDays[0], { day: "numeric", month: "short" }, locale)} – ${fmtDay(weekDays[6], { day: "numeric", month: "short", year: "numeric" }, locale)}`
    : fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale);

  // ‹ month › and Today (‹ week › in People).
  const dateNav = (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" data-cal-step="-1" onClick={() => step(-1)} aria-label={view === "people" ? t("Previous week") : t("Previous month")} className={iconButton}><ChevronLeft className="h-4 w-4" /></button>
        {/* Wraps onto a second line when a large text size leaves no room, rather than being cut off. */}
        <div className="min-w-[min(8.25rem,40vw)] text-balance text-center font-display text-base font-bold leading-tight tabular-nums md:min-w-40">{span}</div>
        <button type="button" data-cal-step="1" onClick={() => step(1)} aria-label={view === "people" ? t("Next week") : t("Next month")} className={iconButton}><ChevronRight className="h-4 w-4" /></button>
      </div>
      {/* aria-disabled, not disabled: a disabled button drops the keyboard focus it has just been given. */}
      <button type="button" onClick={atToday ? undefined : goToday} aria-disabled={atToday || undefined}
        className={cn("ml-1 inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent", coarseText, FOCUS_PILL)}>
        {t("Today")}
      </button>
    </div>
  );

  // Month / People, and whose tasks: the scope is shown once on every screen size, here (a phone
  // included: inside the Filters drawer it looked like a filter, and the badge no longer counts it).
  const scopeOptions: SegmentedOption<CalScope>[] = [
    { value: "all", label: t("Everyone") }, { value: "me", label: t("Mine") },
    ...(divisionOff ? [] : [{ value: "division" as const, label: t("My division") }]),
  ];
  const switches = (
    <>
      <div data-cal-view="" className="contents">
        <Segmented label={t("View")} value={view} onChange={(v) => setSearch({ view: v === "people" ? "people" : undefined })}
          options={[{ value: "month", label: t("Month") }, { value: "people", label: t("People") }]} />
      </div>
      <Segmented label={t("Show")} value={filters.scope} onChange={(v) => setFilters({ ...filters, scope: v })} options={scopeOptions} />
    </>
  );

  const filterTrigger = phone ? (
    <Drawer open={filterOpen} onOpenChange={setFilterOpen} shouldScaleBackground={false}>
      <DrawerTrigger asChild><FilterButton count={nFilters} /></DrawerTrigger>
      <DrawerContent lang={lang} data-cal-surface="" aria-describedby={undefined} className="max-h-[92dvh]">
        <DrawerHeader><DrawerTitle>{t("Filters")}</DrawerTitle></DrawerHeader>
        {/* The drawer body is the one scroller; the panel's Reset / Done footer sticks to its bottom. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} onDone={closeFilters} ix={ix} items={items ?? []} people={people} />
        </div>
      </DrawerContent>
    </Drawer>
  ) : (
    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
      <PopoverTrigger asChild><FilterButton count={nFilters} /></PopoverTrigger>
      <PopoverContent lang={lang} data-cal-surface="" aria-label={t("Filters")} align="end" className="max-h-[78vh] w-90 overflow-y-auto overscroll-contain rounded-2xl p-4">
        <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} ix={ix} items={items ?? []} people={people} />
      </PopoverContent>
    </Popover>
  );
  // One Reset in the header, drawn like the panel's own outline Reset; the banner no longer repeats it.
  const reset = nFilters > 0 && (
    <button type="button" onClick={resetFilters} aria-label={t("Reset filters")}
      className={cn("inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted", coarseText, FOCUS_PILL)}>
      <X aria-hidden className="h-3.5 w-3.5" />{t("Reset")}
    </button>
  );

  const header = (
    <header ref={headerRef} className={cn("z-30 border-b border-border", headerSticky ? "sticky top-0 bg-background/85 backdrop-blur" : "bg-background")}>
      <div data-cal-region="header" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2.5 pt-3 md:px-8 md:pt-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-cal-accent text-cal-accent-foreground"><CalendarDays className="h-4 w-4" /></span>
          <h1 className="font-display text-xl font-bold tracking-tight md:text-2xl">{t("Calendar")}</h1>
        </div>
        {/* In reading order on every size: a phone has Filters beside the title, the two switches on a
            line of their own, then ‹ month ›. */}
        {phone ? (
          <>
            <div className="ml-auto flex items-center gap-2">{filterTrigger}{reset}</div>
            <div className="flex basis-full flex-wrap items-center gap-2">{switches}</div>
            {!weekBar && dateNav}
          </>
        ) : (
          <>
            {!weekBar && dateNav}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {switches}
              {filterTrigger}
              {reset}
              <button type="button" onClick={openHelp} aria-label={t("Keyboard shortcuts")} className={cn(iconButton, "text-muted-foreground")}><Keyboard className="h-4 w-4" /></button>
            </div>
          </>
        )}
        {askedScope === "division" && divisionOff && (
          <p className="basis-full text-xs text-muted-foreground">{t("You are not in the chart yet, so \"My division\" is off.")}</p>
        )}
      </div>
      {structure && access !== "none" && access !== "off" && (
        // Below md the chips scroll sideways (snapping, the right edge fading out); from md up they wrap.
        <div data-cal-region="chips" className="flex snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4 pb-2.5 max-md:pr-8 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] max-md:[scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-8">
          {focusId !== ix.top?.id && (
            <nav aria-label={t("Focus")} className="flex shrink-0 snap-start items-center gap-1 text-xs font-semibold">
              {[...ix.ancestors(focusId)].reverse().concat(focusId).map((id, i, all) => {
                const current = i === all.length - 1;
                return (
                  <span key={id} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />}
                    {/* The current crumb stays an enabled button: disabling or replacing it would drop the
                        keyboard focus that a click on it (as the parent) has just given it. */}
                    <button type="button" data-cal-crumb="" aria-current={current ? "location" : undefined}
                      onClick={current ? undefined : id === ix.top?.id ? leaveFocus : () => setSearch({ focus: id })}
                      className={cn("inline-flex h-7 items-center rounded-md px-1.5", coarseText, FOCUS_PILL,
                        current ? "cursor-default bg-cal-accent text-cal-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                      {i === 0 ? t("All divisions") : ix.byId.get(id)?.name}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
          {legendRows.map((l) => {
            const u = ix.byId.get(l.unitId);
            const name = l.unitId === "other" ? t("Other") : (u?.name ?? "");
            const canFocus = !!u && l.unitId !== focusId && (ix.children.get(l.unitId)?.length ?? 0) > 0;
            const on = filters.units.includes(l.unitId);
            return (
              // Keyed by what the chip does too: the focused division's own chip is another control than
              // the chip that focused it, so focus moves on (to the breadcrumb) instead of staying on it.
              <button key={canFocus ? `${l.unitId}:focus` : l.unitId} type="button" data-legend={l.unitId}
                onClick={() => (canFocus ? setSearch({ focus: l.unitId }) : setFilters({ ...filters, units: on ? filters.units.filter((x) => x !== l.unitId) : [...filters.units, l.unitId] }))}
                // A chip either focuses the calendar on its division (focus icon) or toggles it as a filter (pressed state).
                aria-pressed={canFocus ? undefined : on}
                aria-label={canFocus
                  ? tn(l.count, "Focus on {unit}, {n} task", "Focus on {unit}, {n} tasks", { unit: name })
                  : tn(l.count, "{unit}, {n} task", "{unit}, {n} tasks", { unit: name })}
                title={canFocus ? t("Focus on {unit}", { unit: name }) : t("Filter by {unit}", { unit: name })}
                className={cn("inline-flex h-7 shrink-0 snap-start items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors", coarseText, FOCUS_PILL,
                  on ? "border-cal-accent bg-cal-accent-soft" : "border-border bg-card hover:border-cal-accent/40")}>
                <UnitDot unit={u} size={8} />
                <span className="max-w-40 truncate">{name}</span>
                <span className="tabular-nums text-muted-foreground">{l.count}</span>
                {canFocus && <Focus aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />}
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
    const monthName = fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale);
    // Why the month is empty. The header's Reset is on screen whenever a filter is on, so the banner
    // only says it; the scope has its own switch right there too.
    const banner = view !== "month" ? null
      : allMonthCount === 0 ? <Banner text={t("Nothing has a due date in {month} yet.", { month: monthName })} action={month !== today.slice(0, 7) ? { label: t("Go to this month"), onClick: goToday } : undefined} />
      : monthItems.length === 0 && nFilters > 0 ? <Banner text={t("Nothing matches the filters this month.")} />
      : monthItems.length === 0 && filters.scope === "me" ? <Banner text={t("You have nothing due in {month}.", { month: monthName })} />
      : monthItems.length === 0 && filters.scope === "division" ? <Banner text={t("Your division has nothing due in {month}.", { month: monthName })} />
      : null;
    const truncated = itemsQ.data?.truncated ? <Banner text={t("This month has more tasks than the calendar can show at once.")} /> : null;
    const legendKey = <Legend holiday={lay.gridCompact && monthHasHoliday} />;
    const panel = (
      <DayPanel day={date} today={today} nowMs={nowMs} windowDays={windowDays} holiday={holidays.get(date) ?? null} tree={tree} rail={rail} ix={ix}
        lens={lens} onLens={setLens} meId={meId} scope={filters.scope} onShowEveryone={showEveryone}
        onPrev={prevDay} onNext={nextDay} onOpen={open} people={people} myHomes={myHomes}
        filtersActive={nFilters > 0} onResetFilters={resetFilters} onToday={goToday} monthEmpty={allMonthCount === 0} compact={!lay.wide} />
    );
    body = view === "people" ? (
      <div data-cal-region="people" className="flex flex-col">
        {weekBar && (
          // The week's ‹ › stay in reach while the list (several screens long on a phone) scrolls.
          <div className="sticky top-0 z-20 border-b border-border bg-background px-[12px] py-1.5 md:px-8">{dateNav}</div>
        )}
        <div className="space-y-3 px-[12px] py-3 md:px-8 md:py-6">
          <PeopleWeek rows={rows} days={weekDays} today={today} nowMs={nowMs} windowDays={windowDays} ix={ix} people={people} meId={meId}
            scope={filters.scope} onShowEveryone={showEveryone} filtersActive={nFilters > 0} onResetFilters={resetFilters}
            onOpenDay={openDay} onOpen={open} compact={lay.peopleCompact} />
        </div>
      </div>
    ) : paneLayout ? (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-8 py-6">
          {banner}
          <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} onSelect={selectFromGrid} busy={itemsQ.isPlaceholderData} compact={lay.gridCompact} refocus={gridRefocus} fill />
          {legendKey}
          {truncated}
        </div>
        <aside data-cal-region="panel" className={cn("shrink-0 overflow-y-auto border-l border-border bg-card/40", lay.wideAside ? "w-105" : "w-95")}>
          {panel}
        </aside>
      </div>
    ) : (
      // Side gutters in px on a phone: they stay 12px when the text size grows, and the text keeps the room.
      <div className="space-y-3 px-[12px] py-3 md:px-8 md:py-6">
        {banner}
        <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} onSelect={selectFromGrid} busy={itemsQ.isPlaceholderData} compact={lay.gridCompact} refocus={gridRefocus} />
        {legendKey}
        {truncated}
        {/* On a phone the day is not a card holding cards: it spans the screen, its sticky header edge to
            edge, so the division cards get the width. Elsewhere one card; overflow-clip, not hidden, rounds
            its corners but leaves the page as the scroller, so the day panel's header can stick. */}
        <div data-cal-region="panel" className={phone ? "-mx-[12px] border-t border-border" : "overflow-clip rounded-2xl border border-border bg-card shadow-soft"}>{panel}</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} lang={lang} data-cal-root="" onPointerOver={warmTaskPanel} onFocusCapture={onFocusIn}
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

function FilterButton({ count, className, ...rest }: { count: number } & ComponentPropsWithRef<"button">) {
  const { t } = useLang();
  return (
    <button {...rest} type="button" className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors", coarseText, FOCUS_PILL,
      count ? "border-cal-accent bg-cal-accent-soft text-foreground" : "border-border hover:bg-muted", className)}>
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {t("Filters")}
      {count > 0 && <span className="rounded-full bg-cal-accent px-1.5 text-2xs text-cal-accent-foreground">{count}</span>}
    </button>
  );
}

/**
 * What the month's marks mean, under the grid on every screen size: the phone has the same dots, bar
 * and chips. A compact grid has no room for a holiday's name, so its dotted day number is explained too.
 */
function Legend({ holiday }: { holiday: boolean }) {
  const { t } = useLang();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[7px] w-[7px] rounded-full bg-cal-accent" />{t("has tasks to do")}</span>
      <span className="inline-flex items-center gap-1.5"><DoneTick accent size={7} />{t("done or no status")}</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-[2px] w-4 rounded-full bg-cal-overdue" />{t("overdue")}</span>
      {holiday && (
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("font-semibold tabular-nums text-cal-holiday", HOLIDAY_CUE)}>1</span>{t("public holiday")}</span>
      )}
      <span>{t("Dots follow the IP & Division Chart. A name with the focus icon focuses the calendar on that division; any other name filters it.")}</span>
    </div>
  );
}

function Banner({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button type="button" onClick={action.onClick} className={cn("inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground", coarseText, FOCUS_PILL)}>{action.label}</button>
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
    ["[ ]", t("Previous / next day")], ["Home / End", t("First / last day of the week")], ["PgUp / PgDn", t("Previous / next month (with Shift: year)")],
    ["L", t("Switch by division / by person")], ["M / P", t("Month / People")],
    ["F", t("Filters")], ["Esc", t("Close, then leave the focus")], ["?", t("This list")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-scrim backdrop-blur-sm" />
        <DialogPrimitive.Content
          lang={lang}
          data-cal-surface=""
          aria-describedby={undefined}
          // Opened by "?" there is no trigger to return to: go back to whatever had focus before.
          onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus.current?.focus?.(); }}
          className="fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-pop outline-none"
        >
          <div className="mb-3 flex items-center justify-between">
            <DialogTitle className="font-display text-base font-bold leading-normal tracking-normal">{t("Keyboard shortcuts")}</DialogTitle>
            <DialogPrimitive.Close aria-label={t("Close")} className={cn("grid size-8 place-items-center rounded-lg hover:bg-muted", FOCUS_PILL)}><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t("Arrow keys, [ ], Home / End and PgUp / PgDn work while a date in the month has keyboard focus.")}</p>
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-0">
              <label htmlFor={switchId} className="text-sm font-semibold">{t("Single-key shortcuts")}</label>
              <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">{t("Turn them off if they clash with a screen reader or voice control.")}</p>
            </div>
            <Switch id={switchId} aria-describedby={hintId} checked={enabled} onCheckedChange={onEnabledChange} className={cn("mt-0.5", CAL_SWITCH)} />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
