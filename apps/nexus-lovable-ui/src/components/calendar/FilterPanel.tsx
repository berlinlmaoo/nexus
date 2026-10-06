import { useMemo, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Switch } from "@/components/ui/switch";
import type { CalFilters, CalIndex, CalItem, CalScope } from "@/lib/calendar/core";
import { Face, UnitDot, type PeopleLookup } from "./bits";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;

/**
 * Every filter of the Calendar. They all run in the browser over what is already loaded, and move the
 * dots, counts, legend, day panel and People view together. The server only decides what may be seen.
 */
export function FilterPanel({ filters, onChange, onReset, ix, items, people, myHomes }: {
  filters: CalFilters; onChange: (f: CalFilters) => void; onReset: () => void
  ix: CalIndex; items: CalItem[]; people: PeopleLookup; myHomes: string[]
}) {
  const { t } = useLang();
  const [personQ, setPersonQ] = useState("");
  const [projectQ, setProjectQ] = useState("");
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

  const scopes: { id: CalScope; label: string; disabled?: boolean }[] = [
    { id: "all", label: t("Everyone") },
    { id: "me", label: t("Mine") },
    { id: "division", label: t("My division"), disabled: myHomes.length === 0 },
  ];

  return (
    <div className="space-y-5">
      <Block title={t("Show")}>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-0.5">
          {scopes.map((s) => (
            <button key={s.id} type="button" disabled={s.disabled} onClick={() => set({ scope: s.id })}
              className={cn("rounded-md py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                filters.scope === s.id ? "bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "text-muted-foreground hover:bg-muted")}>
              {s.label}
            </button>
          ))}
        </div>
        {myHomes.length === 0 && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("You are not in the chart yet, so \"My division\" is off.")}</p>}
      </Block>

      <Block title={t("Divisions")} count={filters.units.length}>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
          {ix.units.map((u) => {
            const on = filters.units.includes(u.id);
            return (
              <button key={u.id} type="button" onClick={() => set({ units: flip(filters.units, u.id) })}
                className="flex w-full items-center gap-2 border-b border-border/60 py-1.5 pr-3 text-left last:border-b-0 hover:bg-muted/60"
                style={{ paddingLeft: 10 + u.depth * 14 + (u.kind === "GROUP" ? 0 : 0) }}>
                <CheckBox on={on} />
                <UnitDot unit={u} size={8} />
                <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", u.kind === "GROUP" ? "font-bold uppercase tracking-[0.08em] text-[11px] text-muted-foreground" : "font-medium")}>{u.name}</span>
              </button>
            );
          })}
        </div>
      </Block>

      <Block title={t("People")} count={filters.people.length}>
        <SearchBox value={personQ} onChange={setPersonQ} placeholder={t("Search people…")} />
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-border">
          {peopleIds.filter((id) => !pq || people(id).name.toLowerCase().includes(pq)).map((id) => {
            const p = people(id);
            const on = filters.people.includes(id);
            return (
              <button key={id} type="button" onClick={() => set({ people: flip(filters.people, id) })} className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-muted/60">
                <CheckBox on={on} />
                <Face name={p.name} avatar={p.avatar} size={20} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.name}</span>
              </button>
            );
          })}
          {peopleIds.length === 0 && <div className="px-3 py-3 text-[12px] text-muted-foreground">{t("Nobody has a task this month.")}</div>}
        </div>
      </Block>

      <Block title={t("Projects")} count={filters.projects.length}>
        <SearchBox value={projectQ} onChange={setProjectQ} placeholder={t("Search projects…")} />
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-border">
          {projects.filter((p) => !prq || p.name.toLowerCase().includes(prq)).map((p) => {
            const on = filters.projects.includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => set({ projects: flip(filters.projects, p.id) })} className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-muted/60">
                <CheckBox on={on} />
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.name}</span>
              </button>
            );
          })}
          {projects.length === 0 && <div className="px-3 py-3 text-[12px] text-muted-foreground">{t("No project has a task this month.")}</div>}
        </div>
      </Block>

      <Block title={t("Priority")} count={filters.priorities.length}>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => {
            const on = filters.priorities.includes(p);
            return (
              <button key={p} type="button" onClick={() => set({ priorities: flip(filters.priorities, p) })}
                className={cn("rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors", on ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-[#9fb6d6] dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "border-border text-muted-foreground hover:border-[#1e3a5f]/40 hover:text-foreground")}>
                {priorityLabel(p, t)}
              </button>
            );
          })}
        </div>
      </Block>

      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className="flex items-center justify-between gap-3 text-[13px] font-medium">
          {t("Hide done tasks")}
          <Switch checked={filters.hideDone} onCheckedChange={(v) => set({ hideDone: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-[13px] font-medium">
          {t("Only overdue")}
          <Switch checked={filters.overdueOnly} onCheckedChange={(v) => set({ overdueOnly: v })} />
        </label>
      </div>

      <button type="button" onClick={onReset} className="w-full rounded-xl border border-border py-2 text-[13px] font-semibold hover:bg-muted">{t("Reset filters")}</button>
    </div>
  );
}

export function priorityLabel(p: string, t: (s: string) => string): string {
  return p === "URGENT" ? t("Urgent") : p === "HIGH" ? t("High") : p === "MEDIUM" ? t("Medium") : p === "LOW" ? t("Low") : t("None");
}

function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
        {!!count && <span className="rounded-full bg-[#1e3a5f] px-1.5 text-[10px] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border", on ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-[#9fb6d6] dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "border-border")}>
      {on && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5">
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
    </label>
  );
}
