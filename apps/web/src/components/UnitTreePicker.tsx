import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { OrgUnit } from "@/lib/nexus-api";

/**
 * Pick divisions / units of the IP & Division Chart: one trigger ("Everyone" / the names picked) and a
 * searchable, indented tree in a popover (QA BoD R2 N04: 26 long breadcrumb chips were a wall). Groups
 * (arrangement only) show as headings but can't be picked. Empty selection = everyone.
 */
export function UnitTreePicker({ units, value, onChange, disabled }: {
  units: OrgUnit[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const children = useMemo(() => {
    const m = new Map<string | null, OrgUnit[]>();
    for (const u of units) {
      const k = u.parentId && byId.has(u.parentId) ? u.parentId : null;
      (m.get(k) ?? m.set(k, []).get(k)!).push(u);
    }
    for (const list of m.values()) list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "id"));
    return m;
  }, [units, byId]);
  const path = (id: string) => {
    const parts: string[] = [];
    let cur = byId.get(id);
    for (let i = 0; cur && i < 8; i++) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return parts.join(" › ");
  };
  const toggle = (id: string) => { const n = new Set(value); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };

  // Flat rows in tree order with their depth; a search keeps the matches plus the units above them.
  const rows = useMemo(() => {
    const out: Array<{ u: OrgUnit; depth: number }> = [];
    const walk = (parent: string | null, depth: number) => {
      for (const u of children.get(parent) ?? []) { out.push({ u, depth }); walk(u.id, depth + 1); }
    };
    walk(null, 0);
    const term = q.trim().toLowerCase();
    if (!term) return out;
    const keep = new Set<string>();
    for (const { u } of out) {
      if (!u.name.toLowerCase().includes(term)) continue;
      let cur: OrgUnit | undefined = u;
      for (let i = 0; cur && i < 8; i++) { keep.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    }
    return out.filter((r) => keep.has(r.u.id));
  }, [children, q, byId]);

  const picked = [...value].filter((id) => byId.has(id));
  const summary = picked.length === 0 ? t("Everyone") : picked.length <= 2 ? picked.map((id) => byId.get(id)!.name).join(", ") : t("{n} divisions", { n: picked.length });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} className="inline-flex min-w-[12rem] max-w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:border-ring/40 disabled:opacity-50 pointer-coarse:min-h-11">
            <span className="truncate">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search divisions")} aria-label={t("Search divisions")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div role="listbox" aria-multiselectable="true" aria-label={t("Divisions")} className="max-h-72 overflow-y-auto p-1">
            <button type="button" role="option" aria-selected={value.size === 0} onClick={() => onChange(new Set())} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span className={cn("grid h-4 w-4 place-items-center rounded border", value.size === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{value.size === 0 && <Check className="h-3 w-3" />}</span>
              {t("Everyone")}
            </button>
            {rows.map(({ u, depth }) => {
              const group = u.kind === "GROUP";
              const on = value.has(u.id);
              return group ? (
                <div key={u.id} style={{ paddingLeft: 8 + depth * 14 }} className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{u.name}</div>
              ) : (
                <button key={u.id} type="button" role="option" aria-selected={on} title={path(u.id)} onClick={() => toggle(u.id)} style={{ paddingLeft: 8 + depth * 14 }} className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent">
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{on && <Check className="h-3 w-3" />}</span>
                  <span className={cn("truncate", u.kind === "IP" && "font-semibold")}>{u.name}</span>
                </button>
              );
            })}
            {rows.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t("No division matches “{q}”.", { q })}</p>}
          </div>
        </PopoverContent>
      </Popover>
      {picked.map((id) => (
        <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-semibold text-primary" title={path(id)}>
          <span className="truncate">{byId.get(id)!.name}</span>
          <button type="button" aria-label={t("Remove {name}", { name: byId.get(id)!.name })} onClick={() => toggle(id)} className="rounded-full p-0.5 hover:bg-primary/15"><X className="h-3 w-3" /></button>
        </span>
      ))}
    </div>
  );
}
