import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { CondKind, FilterCrit, Hex } from "@/lib/sheet-model";
import { COND_ONE_VALUE, COND_TWO_VALUES } from "@/lib/sheet-cf";
import { COND_LABEL, COND_OPTIONS, DATE_MODES, isDateKind, type DateMode } from "./ConditionalFormatPanel";
import { Floating } from "./sheet-float";
import { inputClass, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

type CondDraft = { kind: CondKind | "none"; values: [string, string]; dateMode: DateMode; formula: string };

function condDraft(crit: FilterCrit | undefined): CondDraft {
  const c = crit?.cond;
  if (!c) return { kind: "none", values: ["", ""], dateMode: "today", formula: "" };
  const v = c.values ?? [];
  if (isDateKind(c.kind)) {
    const known = DATE_MODES.find(([m]) => m === v[0]);
    const mode: DateMode = known ? known[0] : v[0] ? "exact" : "today";
    return { kind: c.kind, values: [mode === "exact" ? (known ? v[1] ?? "" : v[0] ?? "") : "", ""], dateMode: mode, formula: "" };
  }
  return { kind: c.kind, values: [v[0] ?? "", v[1] ?? ""], dateMode: "today", formula: c.formula ?? "" };
}

function condOut(d: CondDraft): FilterCrit["cond"] | undefined {
  if (d.kind === "none") return undefined;
  if (d.kind === "formula") return d.formula.trim() ? { kind: "formula", formula: d.formula.trim() } : undefined;
  if (isDateKind(d.kind)) return { kind: d.kind, values: d.dateMode === "exact" ? [d.values[0].trim()] : [d.dateMode] };
  if (COND_TWO_VALUES.includes(d.kind)) return { kind: d.kind, values: [d.values[0].trim(), d.values[1].trim()] };
  if (COND_ONE_VALUE.includes(d.kind)) return { kind: d.kind, values: [d.values[0].trim()] };
  return { kind: d.kind };
}

/**
 * A column's filter menu, like Sheets': Sort A → Z / Z → A, Sort by colour ▸, Filter by colour ▸,
 * Filter by condition (collapsible) and Filter by values (Select all / Clear, "Showing N", search,
 * checklist with counts, "(Blanks)"), then Cancel / OK.
 *
 * NOTE: a custom-formula condition is returned as typed (display form, "=C2>10"); the caller stores it
 * with toStored(…) like other formulas. Picking a colour applies at once (Sheets does too).
 */
export function FilterMenu({ anchor, columnLabel, values, crit, fills, texts, onSort, onSortByColor, onApply, onClose }: {
  anchor: DOMRect;
  columnLabel: string;
  /** Distinct shown values of the column ("" = blanks), from distinctValues(). */
  values: { text: string; count: number }[];
  crit?: FilterCrit;
  /** Fill / text colours present in the column. */
  fills: string[];
  texts: string[];
  onSort: (dir: "asc" | "desc") => void;
  onSortByColor?: (kind: "fill" | "text", color: Hex) => void;
  onApply: (crit: FilterCrit | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(crit?.hidden ?? []));
  const [cond, setCond] = useState<CondDraft>(() => condDraft(crit));
  const [condOpen, setCondOpen] = useState(Boolean(crit?.cond));
  const [valuesOpen, setValuesOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [sub, setSub] = useState<{ kind: "sortColor" | "filterColor"; rect: DOMRect } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (sub) setSub(null); else onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sub, onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? values.filter((v) => (v.text || t("(Blanks)")).toLowerCase().includes(q)) : values;
  }, [values, query, t]);

  const apply = () => {
    const next: FilterCrit = {};
    const h = values.map((v) => v.text).filter((x) => hidden.has(x));
    if (h.length) next.hidden = h;
    const c = condOut(cond);
    if (c) next.cond = c;
    if (crit?.fill) next.fill = crit.fill;
    if (crit?.text) next.text = crit.text;
    onApply(Object.keys(next).length ? next : undefined);
    onClose();
  };
  const pickColor = (kind: "fill" | "text", color: Hex | undefined) => {
    setSub(null);
    if (sub?.kind === "sortColor") { if (color) onSortByColor?.(kind, color); onClose(); return; }
    const base: FilterCrit = { ...(crit ?? {}) };
    delete base.fill;
    delete base.text;
    const next: FilterCrit = base;
    if (color && kind === "fill") next.fill = color;
    if (color && kind === "text") next.text = color;
    onApply(Object.keys(next).length ? next : undefined);
    onClose();
  };

  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-40";
  const twoValues = cond.kind !== "none" && COND_TWO_VALUES.includes(cond.kind);
  const oneValue = cond.kind !== "none" && COND_ONE_VALUE.includes(cond.kind) && !isDateKind(cond.kind);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <Floating
        anchor={{ rect: anchor }}
        role="dialog"
        style={{ width: 288 }}
        className="flex flex-col rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop"
      >
        <div aria-label={t("Filter {c}", { c: columnLabel })} className="contents">
          <button type="button" className={item} onClick={() => { onSort("asc"); onClose(); }}>{t("Sort A → Z")}</button>
          <button type="button" className={item} onClick={() => { onSort("desc"); onClose(); }}>{t("Sort Z → A")}</button>
          <button type="button" className={item} disabled={!onSortByColor || (!fills.length && !texts.length)}
            onClick={(e) => setSub({ kind: "sortColor", rect: e.currentTarget.getBoundingClientRect() })}>
            <span className="flex-1">{t("Sort by colour")}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <div className="my-1 border-t border-border" />
          <button type="button" className={item} onClick={(e) => setSub({ kind: "filterColor", rect: e.currentTarget.getBoundingClientRect() })}>
            <span className="flex-1">{t("Filter by colour")}</span>
            {(crit?.fill ?? crit?.text) && <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: crit?.fill ?? crit?.text }} />}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          <button type="button" className={cn(item, "font-medium")} aria-expanded={condOpen} onClick={() => setCondOpen((o) => !o)}>
            {condOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {t("Filter by condition")}
          </button>
          {condOpen && (
            <div className="space-y-1.5 px-3 pb-2">
              <select value={cond.kind} aria-label={t("Filter by condition")} className={selectClass}
                onChange={(e) => setCond({ kind: e.target.value as CondKind | "none", values: ["", ""], dateMode: "today", formula: "" })}>
                <option value="none">{t("None")}</option>
                {COND_OPTIONS.map((k, i) => (k
                  ? <option key={k} value={k}>{t(COND_LABEL[k])}</option>
                  : <option key={`sep${i}`} disabled>──────────</option>))}
              </select>
              {cond.kind !== "none" && isDateKind(cond.kind) && (
                <>
                  <select value={cond.dateMode} aria-label={t("Date")} className={selectClass} onChange={(e) => setCond({ ...cond, dateMode: e.target.value as DateMode })}>
                    {DATE_MODES.map(([m, l]) => <option key={m} value={m}>{t(l)}</option>)}
                  </select>
                  {cond.dateMode === "exact" && (
                    <input value={cond.values[0]} onChange={(e) => setCond({ ...cond, values: [e.target.value, ""] })} placeholder="11/10/2026" aria-label={t("Value")} className={inputClass} />
                  )}
                </>
              )}
              {(oneValue || twoValues) && (
                <input value={cond.values[0]} onChange={(e) => setCond({ ...cond, values: [e.target.value, cond.values[1]] })}
                  placeholder={t("Value or formula")} aria-label={t("Value")} className={inputClass} />
              )}
              {twoValues && (
                <input value={cond.values[1]} onChange={(e) => setCond({ ...cond, values: [cond.values[0], e.target.value] })}
                  placeholder={t("Value or formula")} aria-label={t("Second value")} className={inputClass} />
              )}
              {cond.kind === "formula" && (
                <input value={cond.formula} onChange={(e) => setCond({ ...cond, formula: e.target.value })} placeholder="=C2>10" aria-label={t("Custom formula")} className={cn(inputClass, "font-mono")} />
              )}
            </div>
          )}

          <button type="button" className={cn(item, "font-medium")} aria-expanded={valuesOpen} onClick={() => setValuesOpen((o) => !o)}>
            {valuesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {t("Filter by values")}
          </button>
          {valuesOpen && (
            <div className="space-y-1.5 px-3 pb-1">
              <div className="flex items-center gap-1 text-[11px]">
                <button type="button" className="text-info hover:underline"
                  onClick={() => setHidden((h) => { const n = new Set(h); shown.forEach((v) => n.delete(v.text)); return n; })}>
                  {t("Select all ({n})", { n: shown.length })}
                </button>
                <span className="text-muted-foreground">–</span>
                <button type="button" className="text-info hover:underline"
                  onClick={() => setHidden((h) => { const n = new Set(h); shown.forEach((v) => n.add(v.text)); return n; })}>
                  {t("Clear")}
                </button>
                <span className="ml-auto text-muted-foreground">{t("Showing {n}", { n: shown.length })}</span>
              </div>
              <div className="relative">
                <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Search values")} className={cn(inputClass, "pr-7")} />
                <Search className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-muted-foreground" />
              </div>
              <ul className="max-h-48 overflow-y-auto py-0.5" role="listbox" aria-multiselectable="true">
                {shown.map((v) => {
                  const on = !hidden.has(v.text);
                  return (
                    <li key={v.text}>
                      <button type="button" role="option" aria-selected={on}
                        onClick={() => setHidden((h) => { const n = new Set(h); if (on) n.add(v.text); else n.delete(v.text); return n; })}
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted">
                        <span className="grid w-4 shrink-0 place-items-center">{on && <Check className="h-3.5 w-3.5" />}</span>
                        <span className={cn("min-w-0 flex-1 truncate", !v.text && "italic text-muted-foreground")}>{v.text || t("(Blanks)")}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{v.count}</span>
                      </button>
                    </li>
                  );
                })}
                {!shown.length && <li className="px-1 py-2 text-center text-[11px] text-muted-foreground">{t("No matching values")}</li>}
              </ul>
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-border px-3 pb-1 pt-2">
            <button type="button" onClick={onClose} className={cn(secondaryBtn, "border border-border")}>{t("Cancel")}</button>
            <button type="button" onClick={apply} className={primaryBtn}>{t("OK")}</button>
          </div>
        </div>
      </Floating>

      {sub && createPortal(
        <>
          <div className="fixed inset-0 z-[61]" onMouseDown={() => setSub(null)} />
          <Floating anchor={{ x: sub.rect.right, y: sub.rect.top }} style={{ zIndex: 62 }}
            className="w-48 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop">
            {([["fill", "Fill colour", fills], ["text", "Text colour", texts]] as const).map(([kind, label, list]) => (
              <div key={kind}>
                <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t(label)}</div>
                {sub.kind === "filterColor" && (
                  <button type="button" className={item} onClick={() => pickColor(kind, undefined)}>
                    <span className="grid w-3.5 place-items-center">{!crit?.[kind] && <Check className="h-3.5 w-3.5" />}</span>{t("None")}
                  </button>
                )}
                {list.map((c) => (
                  <button key={c} type="button" className={item} onClick={() => pickColor(kind, c)}>
                    <span className="grid w-3.5 place-items-center">{crit?.[kind]?.toLowerCase() === c.toLowerCase() && <Check className="h-3.5 w-3.5" />}</span>
                    <span className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: c }} />
                    <span className="font-mono text-[11px]">{c}</span>
                  </button>
                ))}
                {!list.length && <div className="px-3 py-1 text-[11px] text-muted-foreground">{t("No colours in this column")}</div>}
              </div>
            ))}
          </Floating>
        </>,
        document.body,
      )}
    </>,
    document.body,
  );
}
