import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import type { CalIndex, CalItem, DayTree, PersonRow, TreeNode } from "@/lib/calendar/core";
import { dayDiff } from "@/lib/calendar/core";
import { Face, fmtDay, ItemRow, unitVars, UnitMark, type PeopleLookup } from "./bits";

export type Lens = "division" | "person";

const COLLAPSE_KEY = "nexus.calendar.collapsed";
function readCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/**
 * The day under the grid (phone) or beside it (desktop): who has what that day, grouped exactly like the
 * Bagan. "Per division": card › sub-card › tasks with the people doing them. "Per person": card › people
 * › their tasks. A card keeps its place in Bagan order; the viewer's own cards are marked "You".
 */
export function DayPanel({
  day, today, nowMs, windowDays, holiday, tree, rail, ix, lens, onLens, onPrev, onNext, onOpen, people,
  myHomes, filtersActive, onResetFilters, onToday, monthEmpty, compact,
}: {
  day: string; today: string; nowMs: number; windowDays: number; holiday: string | null
  tree: DayTree; rail: CalItem[]; ix: CalIndex; lens: Lens; onLens: (l: Lens) => void
  onPrev: () => void; onNext: () => void; onOpen: (i: CalItem) => void; people: PeopleLookup
  myHomes: string[]; filtersActive: boolean; onResetFilters: () => void; onToday: () => void
  monthEmpty: boolean; compact: boolean
}) {
  const { t, tn, locale } = useLang();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [railOpen, setRailOpen] = useState(false);
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const mine = ix.subtree(myHomes);
  const rel = dayDiff(today, day);
  const relLabel = rel === 0 ? t("Today") : rel === 1 ? t("Tomorrow") : rel === -1 ? t("Yesterday") : null;
  const common = { ix, people, today, nowMs, windowDays, onOpen };

  const root = tree.root;
  const sections: TreeNode[] = root ? root.children : [];
  const rootOwn = root && (root.items.length > 0 || root.people.length > 0) ? root : null;
  const placementsShown = root ? countPlacements(root) : 0;

  return (
    <section aria-label={t("Day")} className="flex min-h-0 flex-col">
      {/* Header */}
      <div className={cn("border-b border-border bg-card/95 px-4 pb-3 pt-3.5 backdrop-blur", !compact && "sticky top-0 z-10")}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-[17px] font-bold tracking-tight">{fmtDay(day, { weekday: "long", day: "numeric", month: "short", year: "numeric" }, locale)}</h2>
              {relLabel && <span className="rounded-md bg-[#1e3a5f]/10 px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-[#1e3a5f] dark:bg-[#9fb6d6]/15 dark:text-[#9fb6d6]">{relLabel}</span>}
            </div>
            {holiday && <div className="mt-0.5 text-[12px] font-semibold text-rose-600 dark:text-rose-400">{holiday}</div>}
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {tree.total > 0 ? `${tn(tree.total, "{n} task", "{n} tasks")} · ${tn(tree.people, "{n} person", "{n} people")}` : t("No tasks")}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onPrev} aria-label={t("Previous day")} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={onNext} aria-label={t("Next day")} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div role="tablist" aria-label={t("Group by")} className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5">
          {(["division", "person"] as const).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lens === l} onClick={() => onLens(l)}
              className={cn("rounded-md py-1.5 text-[12.5px] font-semibold transition-colors", lens === l ? "bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "text-muted-foreground hover:bg-muted")}>
              {l === "division" ? t("By division") : t("By person")}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        {/* Overdue rail (today only) */}
        {day === today && rail.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-1.5 dark:border-rose-500/25 dark:bg-rose-500/[0.07]">
            <button type="button" onClick={() => setRailOpen((v) => !v)} className="flex w-full items-center justify-between px-2 py-1 text-left">
              <span className="text-[12px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">{t("Overdue · {n}", { n: rail.length })}</span>
              <span className="text-[11.5px] font-semibold text-rose-700/80 dark:text-rose-300/80">{railOpen ? t("Show less") : rail.length > 2 ? t("Show all") : ""}</span>
            </button>
            {(railOpen ? rail : rail.slice(0, 2)).map((i) => (
              <ItemRow key={i.key} item={i} unitId={i.placements[0]?.unitId ?? null} {...common} trailing={<span className="shrink-0 pt-px text-[11px] text-rose-700/80 dark:text-rose-300/80">{fmtDay(i.day, { day: "numeric", month: "short" }, locale)}</span>} />
            ))}
          </div>
        )}

        {tree.total === 0 ? (
          <EmptyState
            compact
            icon={filtersActive ? FilterX : CalendarDays}
            tone="muted"
            title={filtersActive ? t("Nothing matches the filters on this day") : t("No tasks on this day")}
            message={filtersActive ? t("Filters are hiding the rest. Reset them to see everything.") : monthEmpty ? t("Nothing has a due date this month yet.") : t("Nobody has a task due on this date.")}
            action={filtersActive ? <EmptyAction onClick={onResetFilters}>{t("Reset filters")}</EmptyAction> : day !== today ? <EmptyAction onClick={onToday}>{t("Back to today")}</EmptyAction> : undefined}
          />
        ) : (
          <>
            {rootOwn && (
              <SectionCard node={rootOwn} own collapsed={collapsed} toggle={toggle} mine={mine} lens={lens} common={common} />
            )}
            {sections.map((n) => (
              <SectionCard key={n.unit.id} node={n} collapsed={collapsed} toggle={toggle} mine={mine} lens={lens} common={common} />
            ))}
            {lens === "person" && tree.unplaced.length > 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-card p-2">
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("Not in the chart yet · {n}", { n: tree.unplaced.length })}</div>
                {tree.unplaced.map((p) => <PersonBlock key={p.userId} row={p} unitId={null} common={common} />)}
              </div>
            )}
            {placementsShown > tree.total && (
              <p className="px-2 pb-2 text-[11.5px] text-muted-foreground">{t("A task can show under several divisions. Total: {n} unique tasks.", { n: tree.total })}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

type Common = { ix: CalIndex; people: PeopleLookup; today: string; nowMs: number; windowDays: number; onOpen: (i: CalItem) => void };

function countPlacements(n: TreeNode): number {
  return n.items.length + n.children.reduce((s, k) => s + countPlacements(k), 0);
}

/** A card right under the focus (Finance & Tech, Framework Agency, …), or the focus itself for the people sitting on it. */
function SectionCard({ node, own = false, collapsed, toggle, mine, lens, common }: {
  node: TreeNode; own?: boolean; collapsed: Set<string>; toggle: (id: string) => void; mine: Set<string>; lens: Lens; common: Common
}) {
  const { t } = useLang();
  const isMine = mine.has(node.unit.id) || [...common.ix.subtree([node.unit.id])].some((id) => mine.has(id));
  const key = own ? `own:${node.unit.id}` : node.unit.id;
  const closed = collapsed.has(key);
  const count = own ? new Set([...node.items.map((i) => i.key), ...node.people.flatMap((p) => p.items.map((i) => i.key))]).size : node.count;
  return (
    <div style={unitVars(common.ix.byId.get(node.unit.id))} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <button type="button" onClick={() => toggle(key)} aria-expanded={!closed}
        className="flex w-full items-center gap-2.5 border-l-[3px] border-[var(--c)] px-3 py-2.5 text-left hover:bg-muted/50 dark:border-[var(--cd)]">
        <UnitMark unit={node.unit} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold uppercase tracking-[0.08em]">{node.unit.name}</span>
        </span>
        {isMine && <span className="rounded-md bg-[#1e3a5f] px-1.5 py-px text-[10px] font-bold uppercase text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]">{t("You")}</span>}
        <span className="rounded-full bg-muted px-2 py-px text-[11.5px] font-bold tabular-nums">{count}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", closed && "-rotate-90")} />
      </button>
      {!closed && (
        <div className="px-1.5 pb-2">
          <NodeBody node={node} own={own} lens={lens} common={common} depth={0} />
        </div>
      )}
    </div>
  );
}

function NodeBody({ node, own, lens, common, depth }: { node: TreeNode; own?: boolean; lens: Lens; common: Common; depth: number }): ReactNode {
  return (
    <>
      {lens === "division"
        ? node.items.map((i) => <ItemRow key={i.key} item={i} unitId={node.unit.id} {...common} />)
        : (
          <>
            {node.people.map((p) => <PersonBlock key={p.userId} row={p} unitId={node.unit.id} common={common} />)}
            {node.loose.map((i) => <ItemRow key={i.key} item={i} unitId={node.unit.id} {...common} showPeople={false} />)}
          </>
        )}
      {!own && node.children.map((k) => <SubNode key={k.unit.id} node={k} lens={lens} common={common} depth={depth + 1} />)}
    </>
  );
}

/** A sub-card inside a section, or a group drawn as a thin ribbon ("CREATIVE · 1") around its cards. */
function SubNode({ node, lens, common, depth }: { node: TreeNode; lens: Lens; common: Common; depth: number }) {
  if (node.unit.kind === "GROUP") {
    return (
      <div className="mx-1 mt-2 rounded-xl border border-dashed border-[#c6d4e7] bg-[#edf2f9]/50 px-1 pb-1 pt-1.5 dark:border-[#2e4565] dark:bg-[#1a2a41]/40">
        <div className="px-1.5 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#5a6b83] dark:text-[#9fb0c8]">{node.unit.name} · {node.count}</div>
        {node.children.map((k) => <SubNode key={k.unit.id} node={k} lens={lens} common={common} depth={depth + 1} />)}
      </div>
    );
  }
  return (
    <div style={unitVars(common.ix.byId.get(node.unit.id))} className="mt-1.5">
      <div className="flex items-center gap-2 px-2.5 pb-0.5 pt-1">
        <span className="h-3.5 w-[3px] rounded-full bg-[var(--c)] dark:bg-[var(--cd)]" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground/85">{node.unit.name}</span>
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{node.count}</span>
      </div>
      <div className="pl-2">
        <NodeBody node={node} lens={lens} common={common} depth={depth} />
      </div>
    </div>
  );
}

/** A person with their tasks of the day (lens "per person"); "also in …" lists their other cards. */
function PersonBlock({ row, unitId, common }: { row: PersonRow; unitId: string | null; common: Common }) {
  const { t } = useLang();
  const p = common.people(row.userId);
  const person = common.ix.person.get(row.userId);
  const also = (person?.homeUnitIds ?? []).filter((id) => id !== unitId).map((id) => common.ix.byId.get(id)?.name).filter(Boolean) as string[];
  return (
    <div className="mt-1 rounded-xl px-1">
      <div className="flex items-center gap-2 px-1.5 py-1.5">
        <Face name={p.name} avatar={p.avatar} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{p.name}</div>
          {also.length > 0 && <div className="truncate text-[11px] text-muted-foreground">{t("also in {units}", { units: also.join(", ") })}</div>}
          {!p.inChart && <div className="text-[11px] text-muted-foreground">{t("not in the chart")}</div>}
        </div>
        <span className="rounded-full bg-muted px-2 py-px text-[11px] font-bold tabular-nums">{row.items.length}</span>
      </div>
      <div className="ml-4 border-l border-border pl-1">
        {row.items.map((i) => <ItemRow key={i.key} item={i} unitId={unitId} {...common} showPeople={false} />)}
      </div>
    </div>
  );
}
