import { useCallback, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Globe2, Keyboard, Lock, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
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

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * The Calendar (master calendar, owner 5 Oct 2026): every task with a due date in the company, dots per
 * Bagan division on the month, the day split by division or by person, and a week "People" table.
 * Rules: lib/calendar/core.ts (client) and the server's lib/calendar (who sees what, where a task sits).
 */
export function CalendarPage({ search, setSearch }: { search: CalSearch; setSearch: (patch: Partial<CalSearch>) => void }) {
  const { t, tn, locale, lang } = useLang();
  const compact = useIsMobile();
  const wide = useWide();
  const qc = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = wibToday(nowMs);
  const date = search.date ?? today;
  const view = search.view === "people" ? "people" : "month";
  const lens: Lens = search.lens === "person" ? "person" : "division";
  const filters: CalFilters = useMemo(() => ({
    scope: (search.scope ?? "all") as CalScope,
    units: list(search.unit), people: list(search.person), projects: list(search.project), priorities: list(search.prio),
    hideDone: search.done === "0", overdueOnly: search.overdue === "1",
  }), [search.scope, search.unit, search.person, search.project, search.prio, search.done, search.overdue]);
  const nFilters = activeFilterCount(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);

  // ── Data ──
  const structureQ = useQuery({ queryKey: ["nexus", "calendar-tasks", "structure"], queryFn: nexusApi.calendarStructure, staleTime: 5 * 60_000, retry: 1 });
  const range = gridRange(date);
  const itemsQ = useQuery({
    queryKey: ["nexus", "calendar-tasks", "items", range.from, range.to],
    queryFn: () => nexusApi.calendarItems(range.from, range.to),
    staleTime: 60_000, refetchInterval: POLL_MS, placeholderData: keepPreviousData, retry: 1,
  });
  const overdueQ = useQuery({ queryKey: ["nexus", "calendar-tasks", "overdue"], queryFn: nexusApi.calendarOverdue, staleTime: 60_000, refetchInterval: POLL_MS, retry: 1 });
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

  const fctx = useMemo(() => ({ ix, meId, myHomes, today, nowMs, windowDays }), [ix, meId, myHomes, today, nowMs, windowDays]);
  const items = itemsQ.data?.items;
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

  // ── Navigation ──
  const go = useCallback((d: string) => setSearch({ date: d === today ? undefined : d }), [setSearch, today]);
  const step = (n: number) => go(view === "people" ? addDays(date, 7 * n) : shiftMonth(date, n));
  const setFilters = (f: CalFilters) => setSearch({
    scope: f.scope === "all" ? undefined : f.scope, unit: joined(f.units), person: joined(f.people), project: joined(f.projects),
    prio: joined(f.priorities), done: f.hideDone ? "0" : undefined, overdue: f.overdueOnly ? "1" : undefined,
  });
  const resetFilters = () => setFilters(NO_FILTERS);
  const open = (i: CalItem) => { if (i.id) setSearch({ task: i.id }); };
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
  const refocus = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Radix tooltips/popovers and the drawer call preventDefault when Escape closes them.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || search.task || filterOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key;
      if (helpOpen) { if (k === "Escape" || k === "?") { e.preventDefault(); setHelpOpen(false); } return; }
      // Any other dialog of the app (attendance, announcement…) sits on top.
      if (document.querySelector('[aria-modal="true"]')) return;
      const map: Record<string, () => void> = {
        t: () => go(today), T: () => go(today),
        j: () => step(-1), k: () => step(1),
        ArrowLeft: () => go(addDays(date, -1)), ArrowRight: () => go(addDays(date, 1)),
        ArrowUp: () => go(addDays(date, -7)), ArrowDown: () => go(addDays(date, 7)),
        "[": () => go(addDays(date, -1)), "]": () => go(addDays(date, 1)),
        l: () => setSearch({ lens: lens === "division" ? "person" : undefined }),
        m: () => setSearch({ view: undefined }), p: () => setSearch({ view: "people" }),
        f: () => setFilterOpen(true),
        "?": () => setHelpOpen((v) => !v),
        Escape: () => (helpOpen ? setHelpOpen(false) : search.focus ? setSearch({ focus: undefined }) : undefined),
      };
      const fn = map[k];
      if (!fn) return;
      e.preventDefault();
      // Arrow keys on a day keep the keyboard focus on the newly selected day.
      refocus.current = /^(Arrow(Left|Right|Up|Down)|\[|\])$/.test(k) && el?.getAttribute("role") === "gridcell";
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    document.querySelector<HTMLElement>(`[role="gridcell"][data-day="${date}"]`)?.focus();
  }, [date]);

  // ── States before there is a calendar to draw ──
  const access = structure?.access ?? itemsQ.data?.access;
  const firstLoad = (structureQ.isLoading || itemsQ.isLoading) && !itemsQ.data;
  const failed = (structureQ.isError && !structure) || (itemsQ.isError && !itemsQ.data);
  const tzNotWib = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone !== "Asia/Jakarta"; } catch { return false; } }, []);

  const header = (
    <header className={cn("z-30 border-b border-border bg-background/85 backdrop-blur", !(wide && view === "month") && "sticky top-0")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2.5 pt-3 md:px-6 md:pt-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#0f2742] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]"><CalendarDays className="h-4 w-4" /></span>
          <h1 className="font-display text-lg font-bold tracking-tight">{t("Calendar")}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label={view === "people" ? t("Previous week") : t("Previous month")} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[132px] text-center font-display text-[15px] font-bold tabular-nums md:min-w-[150px]">
            {view === "people"
              ? `${fmtDay(weekDays[0], { day: "numeric", month: "short" }, locale)} – ${fmtDay(weekDays[6], { day: "numeric", month: "short", year: "numeric" }, locale)}`
              : fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale)}
          </div>
          <button type="button" onClick={() => step(1)} aria-label={view === "people" ? t("Next week") : t("Next month")} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => go(today)} disabled={date === today} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50">{t("Today")}</button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented value={view} onChange={(v) => setSearch({ view: v === "people" ? "people" : undefined })} options={[{ id: "month", label: t("Month") }, { id: "people", label: t("People") }]} />
          {!compact && (
            <Segmented value={filters.scope} onChange={(v) => setFilters({ ...filters, scope: v as CalScope })}
              options={[{ id: "all", label: t("Everyone") }, { id: "me", label: t("Mine") }, { id: "division", label: t("My division"), disabled: myHomes.length === 0 }]} />
          )}
          {compact ? (
            <Drawer open={filterOpen} onOpenChange={setFilterOpen} shouldScaleBackground={false}>
              <DrawerTrigger asChild><FilterButton count={nFilters} /></DrawerTrigger>
              <DrawerContent className="max-h-[92dvh]">
                <DrawerHeader><DrawerTitle>{t("Filters")}</DrawerTitle></DrawerHeader>
                <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} ix={ix} items={items ?? []} people={people} myHomes={myHomes} />
                </div>
              </DrawerContent>
            </Drawer>
          ) : (
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild><FilterButton count={nFilters} /></PopoverTrigger>
              <PopoverContent align="end" className="max-h-[78vh] w-[360px] overflow-y-auto rounded-2xl p-4">
                <FilterPanel filters={filters} onChange={setFilters} onReset={resetFilters} ix={ix} items={items ?? []} people={people} myHomes={myHomes} />
              </PopoverContent>
            </Popover>
          )}
          {nFilters > 0 && (
            <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" />{t("Reset")}</button>
          )}
          {!compact && (
            <button type="button" onClick={() => setHelpOpen(true)} aria-label={t("Keyboard shortcuts")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Keyboard className="h-4 w-4" /></button>
          )}
        </div>
      </div>
      {structure && access !== "none" && access !== "off" && (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] md:px-6">
          {focusId !== ix.top?.id && (
            <nav aria-label={t("Focus")} className="flex shrink-0 items-center gap-1 text-[12px] font-semibold">
              {[...ix.ancestors(focusId)].reverse().concat(focusId).map((id, i, all) => (
                <span key={id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  <button type="button" disabled={i === all.length - 1} onClick={() => setSearch({ focus: id === ix.top?.id ? undefined : id })}
                    className={cn("rounded-md px-1.5 py-0.5", i === all.length - 1 ? "bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    {i === 0 ? t("All") : ix.byId.get(id)?.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {legendRows.map((l) => {
            const u = ix.byId.get(l.unitId);
            const canZoom = !!u && l.unitId !== focusId && (ix.children.get(l.unitId)?.length ?? 0) > 0;
            return (
              <button key={l.unitId} type="button"
                onMouseEnter={() => setHoverUnit(l.unitId)} onMouseLeave={() => setHoverUnit(null)} onFocus={() => setHoverUnit(l.unitId)} onBlur={() => setHoverUnit(null)}
                onClick={() => (canZoom ? setSearch({ focus: l.unitId }) : setFilters({ ...filters, units: filters.units.includes(l.unitId) ? filters.units.filter((x) => x !== l.unitId) : [...filters.units, l.unitId] }))}
                title={canZoom ? t("Zoom into {unit}", { unit: u?.name ?? "" }) : t("Filter by {unit}", { unit: u?.name ?? "" })}
                className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  filters.units.includes(l.unitId) ? "border-[#1e3a5f] bg-[#1e3a5f]/10 dark:border-[#9fb6d6]" : "border-border bg-card hover:border-[#1e3a5f]/40")}>
                <UnitDot unit={u} size={8} />
                <span className="max-w-[160px] truncate">{l.unitId === "other" ? t("Other") : u?.name}</span>
                <span className="tabular-nums text-muted-foreground">{l.count}</span>
              </button>
            );
          })}
          {tzNotWib && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground"><Globe2 className="h-3 w-3" />{t("Times in WIB")}</span>}
        </div>
      )}
    </header>
  );

  let body: ReactNode;
  if (failed) {
    body = <div className="p-4 md:p-6"><EmptyState icon={AlertTriangle} tone="muted" title={t("The calendar could not be loaded")} message={t("Check the connection and try again.")} action={<EmptyAction onClick={() => { void structureQ.refetch(); void itemsQ.refetch(); }}>{t("Try again")}</EmptyAction>} /></div>;
  } else if (access === "none") {
    body = <div className="p-4 md:p-6"><EmptyState icon={Lock} title={t("This calendar is for members of the company")} message={t("You are in a personal workspace. Ask a BoD or Manager to add you to the company's workspace; the Calendar then shows the tasks of everyone there.")} action={<EmptyAction to="/my-tasks">{t("Open My Mission")}</EmptyAction>} /></div>;
  } else if (access === "off") {
    body = <div className="p-4 md:p-6"><EmptyState icon={CalendarDays} title={t("The Calendar is on its way")} message={t("It opens for BoD and Managers first, then for everyone. Your own tasks are still in My Mission.")} action={<EmptyAction to="/my-tasks">{t("Open My Mission")}</EmptyAction>} /></div>;
  } else if (firstLoad) {
    body = <SkeletonCalendar compact={compact} />;
  } else {
    const banner = allMonthCount === 0 && view === "month"
      ? <Banner text={t("Nothing has a due date in {month} yet.", { month: fmtDay(`${month}-01`, { month: "long", year: "numeric" }, locale) })} action={month !== today.slice(0, 7) ? { label: t("Go to this month"), onClick: () => go(today) } : undefined} />
      : monthItems.length === 0 && nFilters > 0 && view === "month"
        ? <Banner text={t("Nothing matches the filters this month.")} action={{ label: t("Reset filters"), onClick: resetFilters }} />
        : null;
    const panel = (
      <DayPanel day={date} today={today} nowMs={nowMs} windowDays={windowDays} holiday={holidays.get(date) ?? null} tree={tree} rail={rail} ix={ix}
        lens={lens} onLens={(l) => setSearch({ lens: l === "person" ? "person" : undefined })}
        onPrev={() => go(addDays(date, -1))} onNext={() => go(addDays(date, 1))} onOpen={open} people={people} myHomes={myHomes}
        filtersActive={nFilters > 0} onResetFilters={resetFilters} onToday={() => go(today)} monthEmpty={allMonthCount === 0} compact={!wide} />
    );
    body = view === "people" ? (
      <div className="space-y-3 p-3 md:p-6">
        <PeopleWeek rows={rows} days={weekDays} today={today} nowMs={nowMs} windowDays={windowDays} ix={ix} people={people}
          onOpenDay={(d) => setSearch({ view: undefined, date: d === today ? undefined : d, lens: "person" })} onOpen={open} compact={compact} />
      </div>
    ) : wide ? (
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-6">
          {banner}
          <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} hoverUnit={hoverUnit} onSelect={go} busy={itemsQ.isPlaceholderData} compact={false} />
          <Legend />
          {itemsQ.data?.truncated && <Banner text={t("This month has more tasks than the calendar can show at once.")} />}
        </div>
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-card/40 xl:w-[420px]">
          {panel}
        </aside>
      </div>
    ) : (
      <div className="space-y-3 p-3 md:p-6">
        {banner}
        <MonthGrid days={days} month={month} cells={cells} selected={date} today={today} holidays={holidays} ix={ix} hoverUnit={hoverUnit} onSelect={go} busy={itemsQ.isPlaceholderData} compact={compact} />
        {!compact && <Legend />}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">{panel}</div>
      </div>
    );
  }

  return (
    <div lang={lang} className={cn("flex flex-col", wide && view === "month" && !failed && access !== "none" && access !== "off" ? "h-[100dvh]" : "min-h-[100dvh]")}>
      {header}
      {body}
      {search.task && !deciding && (editable
        ? <TaskDetailPanel taskId={search.task} onClose={() => setSearch({ task: undefined })} />
        : <TaskPreview taskId={search.task} projectName={openItem?.project?.name ?? null} notMember={openItem !== null || !!lookupQ.data?.found} masked={openMasked} onClose={() => setSearch({ task: undefined })} />)}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <span className="sr-only" aria-live="polite">{tree.total ? tn(tree.total, "{n} task", "{n} tasks") : ""}</span>
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; label: string; disabled?: boolean }[] }) {
  return (
    <div role="tablist" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} disabled={o.disabled} onClick={() => onChange(o.id)}
          className={cn("rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.id ? "bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "text-muted-foreground hover:bg-muted")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterButton({ count, ...rest }: { count: number } & ComponentPropsWithRef<"button">) {
  const { t } = useLang();
  return (
    <button {...rest} type="button" className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold transition-colors",
      count ? "border-[#1e3a5f] bg-[#1e3a5f]/10 text-foreground dark:border-[#9fb6d6]" : "border-border hover:bg-muted")}>
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {t("Filters")}
      {count > 0 && <span className="rounded-full bg-[#1e3a5f] px-1.5 text-[10.5px] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]">{count}</span>}
    </button>
  );
}

function Legend() {
  const { t } = useLang();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full bg-[#1e3a5f] dark:bg-[#9fb6d6]" />{t("has tasks to do")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[#1e3a5f] dark:border-[#9fb6d6]" />{t("done or no status")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[2px] w-4 rounded-full bg-rose-500" />{t("overdue")}</span>
      <span>{t("Dots follow the IP & Division Chart. Click a name above to zoom in.")}</span>
    </div>
  );
}

function Banner({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-[12.5px] text-muted-foreground">
      <span className="min-w-0 flex-1">{text}</span>
      {action && <button type="button" onClick={action.onClick} className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground">{action.label}</button>}
    </div>
  );
}

function SkeletonCalendar({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-3 p-3 md:p-6" aria-busy>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="h-9 border-b border-border bg-muted/40" />
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }, (_, i) => (
            <div key={i} className={cn("border-b border-r border-border/60 p-2", compact ? "h-[52px]" : "h-[96px]")}>
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

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const rows: [string, string][] = [
    ["T", t("Today")], ["J / K", t("Previous / next month (week in People)")], ["← → ↑ ↓", t("Move the selected day")],
    ["[ ]", t("Previous / next day")], ["L", t("Switch by division / by person")], ["M / P", t("Month / People")],
    ["F", t("Filters")], ["Esc", t("Close, then leave the zoom")], ["?", t("This list")],
  ];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={t("Keyboard shortcuts")} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-pop">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">{t("Keyboard shortcuts")}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt><kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{k}</kbd></dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}

