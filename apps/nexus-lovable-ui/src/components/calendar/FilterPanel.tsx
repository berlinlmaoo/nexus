import { useId, useMemo, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Switch } from "@/components/ui/switch";
import type { CalFilters, CalIndex, CalItem } from "@/lib/calendar/core";
import { SLATE } from "@/lib/calendar/tone";
import { CAL_SWITCH, CAPS, Face, FOCUS_PILL, FOCUS_ROW, SWATCH_EDGE, TOUCH_ROW, UnitDot, type PeopleLookup } from "./bits";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
/** Rows a list shows before "Show all": the panel is the only scroller, lists never scroll on their own. */
const LIST_CAP = 8;

const ROW = cn("flex w-full items-center gap-2 border-b border-border/60 py-1.5 text-left last:border-b-0 hover:bg-muted/60", TOUCH_ROW, FOCUS_ROW);

/**
 * Every filter of the Calendar. They all run in the browser over what is already loaded, and move the
 * dots, counts, legend, day panel and People view together. The server only decides what may be seen.
 * `onDone` (optional) adds a "Done" button that closes the popover or drawer around the panel.
 * Show (Everyone / Mine / My division) is not here: it is a view, not a filter, so it lives in the page
 * header on every screen size, the badge never counts it and Reset never changes it.
 */
export function FilterPanel({ filters, onChange, onReset, onDone, ix, items, people }: {
  filters: CalFilters; onChange: (f: CalFilters) => void; onReset: () => void; onDone?: () => void
  ix: CalIndex; items: CalItem[]; people: PeopleLookup
}) {
  const { t, lang } = useLang();
  const [personQ, setPersonQ] = useState("");
  const [projectQ, setProjectQ] = useState("");
  const [open, setOpen] = useState<Record<"units" | "people" | "projects", boolean>>({ units: false, people: false, projects: false });
  const set = (patch: Partial<CalFilters>) => onChange({ ...filters, ...patch });
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const peopleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of items) for (const a of i.assigneeIds) ids.add(a)
    return [...ids].sort((a, b) => people(a).name.localeCompare(people(b).name, "id"))
  }, [items, people]);
  const projects = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const i of items) if (i.project) m.set(i.project.id, i.project);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [items]);
  const pq = personQ.trim().toLowerCase();
  const prq = projectQ.trim().toLowerCase();

  /** The first rows of a list, plus any row that is on, until "Show all"; a search shows every match. */
  const capped = <T,>(key: keyof typeof open, all: T[], on: (x: T) => boolean, searching = false) =>
    searching || open[key] ? all : all.filter((x, i) => i < LIST_CAP || on(x));
  const toggleOpen = (key: keyof typeof open) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const peopleShown = peopleIds.filter((id) => !pq || people(id).name.toLowerCase().includes(pq));
  const projectsShown = projects.filter((p) => !prq || p.name.toLowerCase().includes(prq));


  return (
    // The panel renders in a portal (popover, drawer), outside the page's lang root.
    <div lang={lang} className="space-y-5">

      <Block title={t("Divisions")} count={filters.units.length}>
        <div className="overflow-hidden rounded-xl border border-border">
          {capped("units", ix.units, (u) => filters.units.includes(u.id)).map((u) => {
            const on = filters.units.includes(u.id);
            return (
              <button key={u.id} type="button" role="checkbox" aria-checked={on} onClick={() => set({ units: flip(filters.units, u.id) })}
                className={cn(ROW, "pr-3")} style={{ paddingLeft: 10 + u.depth * 14 }}>
                <CheckBox on={on} />
                <UnitDot unit={u} size={8} />
                <span className={cn("min-w-0 flex-1 [overflow-wrap:anywhere]", u.kind === "GROUP" ? cn(CAPS, SLATE.text) : "text-sm font-medium")}>{u.name}</span>
              </button>
            );
          })}
        </div>
        <MoreToggle total={ix.units.length} open={open.units} onClick={() => toggleOpen("units")} />
      </Block>

      <Block title={t("People")} count={filters.people.length}>
        <SearchBox value={personQ} onChange={setPersonQ} placeholder={t("Search people…")} />
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border">
          {capped("people", peopleShown, (id) => filters.people.includes(id), !!pq).map((id) => {
            const p = people(id);
            const on = filters.people.includes(id);
            return (
              <button key={id} type="button" role="checkbox" aria-checked={on} onClick={() => set({ people: flip(filters.people, id) })} className={cn(ROW, "px-2.5")}>
                <CheckBox on={on} />
                <Face name={p.name} avatar={p.avatar} size={20} />
                <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{p.name}</span>
              </button>
            );
          })}
          {peopleIds.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">{t("Nobody has a task this month.")}</div>}
        </div>
        {!pq && <MoreToggle total={peopleIds.length} open={open.people} onClick={() => toggleOpen("people")} />}
      </Block>

      <Block title={t("Projects")} count={filters.projects.length}>
        <SearchBox value={projectQ} onChange={setProjectQ} placeholder={t("Search projects…")} />
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border">
          {capped("projects", projectsShown, (p) => filters.projects.includes(p.id), !!prq).map((p) => {
            const on = filters.projects.includes(p.id);
            return (
              <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => set({ projects: flip(filters.projects, p.id) })} className={cn(ROW, "px-2.5")}>
                <CheckBox on={on} />
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", SWATCH_EDGE)} style={{ background: p.color }} />
                <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{p.name}</span>
              </button>
            );
          })}
          {projects.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">{t("No project has a task this month.")}</div>}
        </div>
        {!prq && <MoreToggle total={projects.length} open={open.projects} onClick={() => toggleOpen("projects")} />}
      </Block>

      <Block title={t("Priority")} count={filters.priorities.length}>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => {
            const on = filters.priorities.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => set({ priorities: flip(filters.priorities, p) })}
                className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition-colors", TOUCH_ROW, FOCUS_PILL, on ? "border-cal-accent bg-cal-accent text-cal-accent-foreground" : "border-border text-muted-foreground hover:border-cal-accent/40 hover:text-foreground")}>
                {priorityLabel(p, t)}
              </button>
            );
          })}
        </div>
      </Block>

      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className={cn("flex items-center justify-between gap-3 text-sm font-medium", TOUCH_ROW)}>
          {t("Hide done tasks")}
          <Switch checked={filters.hideDone} onCheckedChange={(v) => set({ hideDone: v })} className={CAL_SWITCH} />
        </label>
        <label className={cn("flex items-center justify-between gap-3 text-sm font-medium", TOUCH_ROW)}>
          {t("Only overdue")}
          <Switch checked={filters.overdueOnly} onCheckedChange={(v) => set({ overdueOnly: v })} className={CAL_SWITCH} />
        </label>
      </div>

      {/* Stays at the bottom of the popover / drawer while the lists scroll under it. Both give the panel
          1rem of side padding (hence -mx-4); the popover also pads its bottom by 1rem, which a sticky box
          stops short of, so there it sticks 1rem lower. The drawer's surface is the page background.
          Reset clears the filters only: Show is a view and stays as it is (the page's reset keeps it). */}
      <div data-cal-sticky-foot="" className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-popover px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 [[data-radix-popper-content-wrapper]_&]:-bottom-4 [[data-vaul-drawer]_&]:bg-background">
        <button type="button" onClick={onReset} className={cn("min-h-9 flex-1 rounded-xl border border-border py-2 text-sm font-semibold hover:bg-muted", TOUCH_ROW, FOCUS_PILL)}>{t("Reset filters")}</button>
        {onDone && (
          <button type="button" onClick={onDone} className={cn("min-h-9 flex-1 rounded-xl bg-cal-accent py-2 text-sm font-semibold text-cal-accent-foreground hover:bg-cal-accent/90", TOUCH_ROW, FOCUS_PILL)}>{t("Done")}</button>
        )}
      </div>
    </div>
  );
}

export function priorityLabel(p: string, t: (s: string) => string): string {
  return p === "URGENT" ? t("Urgent") : p === "HIGH" ? t("High") : p === "MEDIUM" ? t("Medium") : p === "LOW" ? t("Low") : t("None");
}

/** A titled section, announced as a group with that title. */
function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <div className={cn("mb-1.5 flex items-center gap-1.5 text-muted-foreground", CAPS)}>
        <span id={id}>{title}</span>
        {!!count && <span aria-hidden className="rounded-full bg-cal-accent px-1.5 text-2xs text-cal-accent-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/** "Show all (n)" / "Show less" under a list longer than LIST_CAP. */
function MoreToggle({ total, open, onClick }: { total: number; open: boolean; onClick: () => void }) {
  const { t } = useLang();
  if (total <= LIST_CAP) return null;
  return (
    <button type="button" onClick={onClick} aria-expanded={open}
      className={cn("mt-1 min-h-8 rounded-lg px-2 text-xs font-semibold text-cal-accent hover:bg-muted", TOUCH_ROW, FOCUS_PILL)}>
      {open ? t("Show less") : t("Show all ({n})", { n: total })}
    </button>
  );
}

/** The drawn box of a row whose state is exposed by the row itself (role="checkbox"). */
function CheckBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border", on ? "border-cal-accent bg-cal-accent text-cal-accent-foreground" : "border-control-border")}>
      {on && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    // The box shows the focus, so the bare input inside can drop its own outline. The whole box is the
    // input's label: a tap anywhere in it (44px tall on a touch screen) puts the caret in the field.
    <label className={cn("flex items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5 transition-colors focus-within:border-cal-accent focus-within:ring-2 focus-within:ring-cal-accent/20", TOUCH_ROW)}>
      <Search aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
      {/* 16px on phones: iOS zooms into any smaller field on focus. */}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
    </label>
  );
}
