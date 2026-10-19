import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { PivotFilterSpec, PivotGroupSpec, PivotSpec, PivotSummarize, PivotValueSpec } from "@/lib/sheet-model";
import { PIVOT_FUNCTIONS } from "@/lib/sheet-pivot";
import { FieldLabel, SheetDialog, SidePanel, inputClass, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

type Field = { colId: string; label: string };
type Section = "rows" | "cols" | "values" | "filters";

const SHOW_AS: { v: NonNullable<PivotValueSpec["showAs"]>; label: string }[] = [
  { v: "default", label: "Default" },
  { v: "row", label: "% of row" },
  { v: "col", label: "% of column" },
  { v: "total", label: "% of grand total" },
];

const looksNumeric = (s: string) => /^[-+]?(?:rp\.?\s*)?[\d.,]+%?$/i.test(s.trim());

/**
 * "Pivot table editor" sidebar (Sheets' layout): range, Clear all, Suggested cards, then the Rows /
 * Columns / Values / Filters sections, each with an Add button listing the source fields. Every
 * change is reported live through `onChange`.
 */
export function PivotEditor({
  spec, sourceSheetName, rangeA1, fields, valuesFor, suggestions, canEdit, onChange, onRangeChange, onClose,
}: {
  spec: PivotSpec;
  sourceSheetName: string;
  rangeA1: string;
  fields: Field[];
  valuesFor: (colId: string) => string[];
  suggestions: { label: string; spec: Partial<PivotSpec> }[];
  canEdit: boolean;
  onChange: (next: PivotSpec) => void;
  onRangeChange: (a1: string) => boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const fullRange = rangeA1.includes("!") ? rangeA1 : `${sourceSheetName}!${rangeA1}`;
  const [rangeText, setRangeText] = useState(fullRange);
  const [rangeError, setRangeError] = useState(false);
  const [adding, setAdding] = useState<Section | null>(null);
  const [sugOpen, setSugOpen] = useState(true);
  useEffect(() => { setRangeText(fullRange); setRangeError(false); }, [fullRange]);

  const labelOf = (colId: string) => fields.find((f) => f.colId === colId)?.label ?? colId;
  const empty = !spec.rows.length && !spec.cols.length && !spec.values.length && !spec.filters.length;

  const commitRange = () => {
    if (rangeText.trim() === fullRange) { setRangeError(false); return; }
    setRangeError(!onRangeChange(rangeText.trim()));
  };

  const add = (section: Section, colId: string) => {
    setAdding(null);
    if (section === "rows" || section === "cols") {
      onChange({ ...spec, [section]: [...spec[section], { colId, order: "asc", totals: true } satisfies PivotGroupSpec] });
    } else if (section === "values") {
      const sample = valuesFor(colId).filter((v) => v !== "");
      const fn: PivotSummarize = sample.length && sample.every(looksNumeric) ? "SUM" : "COUNTA";
      onChange({ ...spec, values: [...spec.values, { colId, fn, showAs: "default" }] });
    } else {
      onChange({ ...spec, filters: [...spec.filters, { colId, hidden: [] }] });
    }
  };
  const patch = <K extends Section>(section: K, i: number, next: Partial<PivotSpec[K][number]>) => {
    const list = [...spec[section]] as PivotSpec[K][number][];
    list[i] = { ...list[i], ...next };
    onChange({ ...spec, [section]: list });
  };
  const remove = (section: Section, i: number) => onChange({ ...spec, [section]: (spec[section] as unknown[]).filter((_, j) => j !== i) });
  const move = (section: Section, i: number, d: -1 | 1) => {
    const list = [...(spec[section] as unknown[])];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange({ ...spec, [section]: list });
  };

  const sectionTitle: Record<Section, string> = { rows: t("Rows"), cols: t("Columns"), values: t("Values"), filters: t("Filters") };

  const renderSection = (section: Section) => {
    const items = spec[section] as { colId: string }[];
    return (
      <section key={section} className="space-y-1.5 border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-xs font-semibold">{sectionTitle[section]}</h3>
          <button
            type="button"
            disabled={!canEdit || !fields.length}
            aria-expanded={adding === section}
            onClick={() => setAdding(adding === section ? null : section)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-info hover:bg-muted disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />{t("Add field")}
          </button>
        </div>
        {adding === section && (
          <ul role="listbox" aria-label={sectionTitle[section]} className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-pop">
            {fields.length ? fields.map((f) => (
              <li key={f.colId}>
                <button type="button" role="option" aria-selected={false} onClick={() => add(section, f.colId)} className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted">
                  {f.label}
                </button>
              </li>
            )) : <li className="px-3 py-1.5 text-xs text-muted-foreground">{t("No fields in this range")}</li>}
          </ul>
        )}
        {items.map((item, i) => (
          <ItemCard
            key={`${item.colId}-${i}`}
            title={labelOf(item.colId)}
            canEdit={canEdit}
            first={i === 0}
            last={i === items.length - 1}
            onUp={() => move(section, i, -1)}
            onDown={() => move(section, i, 1)}
            onRemove={() => remove(section, i)}
          >
            {(section === "rows" || section === "cols") && (
              <GroupOptions g={item as PivotGroupSpec} canEdit={canEdit} onPatch={(p) => patch(section as "rows" | "cols", i, p)} />
            )}
            {section === "values" && (
              <ValueOptions v={item as PivotValueSpec} canEdit={canEdit} onPatch={(p) => patch("values", i, p)} />
            )}
            {section === "filters" && (
              <FilterOptions f={item as PivotFilterSpec} values={valuesFor(item.colId)} canEdit={canEdit} onPatch={(p) => patch("filters", i, p)} />
            )}
          </ItemCard>
        ))}
      </section>
    );
  };

  return (
    <SidePanel title={t("Pivot table editor")} onClose={onClose}>
      <div className="space-y-1.5 px-3 py-2.5">
        <FieldLabel htmlFor="pivot-range">{t("Range")}</FieldLabel>
        <input
          id="pivot-range"
          value={rangeText}
          disabled={!canEdit}
          onChange={(e) => { setRangeText(e.target.value); setRangeError(false); }}
          onBlur={commitRange}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRange(); } }}
          aria-invalid={rangeError || undefined}
          className={cn(inputClass, "font-mono", rangeError && "border-destructive")}
        />
        {rangeError && <p role="alert" className="text-[11px] text-destructive">{t("Invalid range")}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!canEdit || empty}
            onClick={() => onChange({ ...spec, rows: [], cols: [], values: [], filters: [] })}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-info hover:bg-muted disabled:opacity-40"
          >
            {t("Clear all")}
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <section className="border-t border-border px-3 py-2.5">
          <button type="button" onClick={() => setSugOpen(!sugOpen)} aria-expanded={sugOpen} className="flex w-full items-center text-xs font-semibold">
            <span className="flex-1 text-left">{t("Suggested")}</span>
            {sugOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {sugOpen && (
            <div className="mt-2 space-y-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onChange({ ...spec, rows: [], cols: [], values: [], filters: [], ...s.spec, source: spec.source, range: spec.range })}
                  className="flex w-full items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  <span aria-hidden className="mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 border-muted-foreground/60" />
                  <span className="min-w-0 flex-1">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {(["rows", "cols", "values", "filters"] as Section[]).map(renderSection)}
    </SidePanel>
  );
}

function ItemCard({ title, canEdit, first, last, onUp, onDown, onRemove, children }: {
  title: string; canEdit: boolean; first: boolean; last: boolean;
  onUp: () => void; onDown: () => void; onRemove: () => void; children: ReactNode;
}) {
  const { t } = useLang();
  const iconBtn = "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
        <button type="button" disabled={!canEdit || first} onClick={onUp} aria-label={t("Move up")} title={t("Move up")} className={iconBtn}><ChevronUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!canEdit || last} onClick={onDown} aria-label={t("Move down")} title={t("Move down")} className={iconBtn}><ChevronDown className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!canEdit} onClick={onRemove} aria-label={t("Remove {name}", { name: title })} title={t("Remove")} className={iconBtn}><X className="h-3.5 w-3.5" /></button>
      </div>
      {children}
    </div>
  );
}

function GroupOptions({ g, canEdit, onPatch }: { g: PivotGroupSpec; canEdit: boolean; onPatch: (p: Partial<PivotGroupSpec>) => void }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-2 items-end gap-2">
      <label className="space-y-1">
        <span className="block text-[11px] text-muted-foreground">{t("Order")}</span>
        <select disabled={!canEdit} value={g.order ?? "asc"} onChange={(e) => onPatch({ order: e.target.value as "asc" | "desc" })} className={selectClass}>
          <option value="asc">{t("Ascending")}</option>
          <option value="desc">{t("Descending")}</option>
        </select>
      </label>
      <label className="flex h-8 items-center gap-1.5 text-xs">
        <input type="checkbox" disabled={!canEdit} checked={g.totals !== false} onChange={(e) => onPatch({ totals: e.target.checked })} className="h-3.5 w-3.5 accent-ring" />
        {t("Show totals")}
      </label>
    </div>
  );
}

function ValueOptions({ v, canEdit, onPatch }: { v: PivotValueSpec; canEdit: boolean; onPatch: (p: Partial<PivotValueSpec>) => void }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1">
        <span className="block text-[11px] text-muted-foreground">{t("Summarise by")}</span>
        <select disabled={!canEdit} value={v.fn} onChange={(e) => onPatch({ fn: e.target.value as PivotSummarize })} className={selectClass}>
          {PIVOT_FUNCTIONS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] text-muted-foreground">{t("Show as")}</span>
        <select disabled={!canEdit} value={v.showAs ?? "default"} onChange={(e) => onPatch({ showAs: e.target.value as PivotValueSpec["showAs"] })} className={selectClass}>
          {SHOW_AS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
        </select>
      </label>
    </div>
  );
}

function FilterOptions({ f, values, canEdit, onPatch }: { f: PivotFilterSpec; values: string[]; canEdit: boolean; onPatch: (p: Partial<PivotFilterSpec>) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const hidden = useMemo(() => new Set(f.hidden ?? []), [f.hidden]);
  const shownCount = values.filter((v) => !hidden.has(v)).length;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? values.filter((v) => (v || t("(Blanks)")).toLowerCase().includes(needle)) : values;
  }, [values, q, t]);
  const toggle = (v: string, on: boolean) => {
    const next = new Set(hidden);
    if (on) next.delete(v); else next.add(v);
    onPatch({ hidden: [...next] });
  };
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] text-muted-foreground">{t("Status")}</span>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn(selectClass, "flex items-center text-left")}>
        <span className="min-w-0 flex-1 truncate">
          {shownCount === values.length ? t("Showing all items") : t("Showing {n} of {total} items", { n: shownCount, total: values.length })}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="space-y-1.5 rounded-md border border-border bg-popover p-2">
          <div className="text-[11px] font-semibold">{t("Filter by values")}</div>
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" disabled={!canEdit} onClick={() => onPatch({ hidden: [] })} className="font-semibold text-info hover:underline disabled:opacity-40">{t("Select all")}</button>
            <button type="button" disabled={!canEdit} onClick={() => onPatch({ hidden: [...values] })} className="font-semibold text-info hover:underline disabled:opacity-40">{t("Clear")}</button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")} aria-label={t("Search")} className={cn(inputClass, "pl-7")} />
          </div>
          <ul className="max-h-44 space-y-0.5 overflow-y-auto">
            {visible.length ? visible.map((v) => (
              <li key={v}>
                <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted">
                  <input type="checkbox" disabled={!canEdit} checked={!hidden.has(v)} onChange={(e) => toggle(v, e.target.checked)} className="h-3.5 w-3.5 accent-ring" />
                  <span className={cn("min-w-0 flex-1 truncate", v === "" && "italic text-muted-foreground")}>{v === "" ? t("(Blanks)") : v}</span>
                </label>
              </li>
            )) : <li className="px-1 py-0.5 text-xs text-muted-foreground">{t("No matching values")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Create pivot table" dialog: the data range, inserted into a new sheet. Sheets also offers "Existing
 * sheet"; here a pivot always owns its own sheet, because its cells are rewritten whenever the source
 * changes and would clobber whatever else lived there.
 */
export function PivotCreateDialog({ defaultRange, onCreate, onClose }: {
  defaultRange: string;
  onCreate: (opts: { range: string; target: "new" }) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [range, setRange] = useState(defaultRange);
  const ok = range.trim() !== "";
  const submit = () => { if (ok) onCreate({ range: range.trim(), target: "new" }); };
  return (
    <SheetDialog
      title={t("Create pivot table")}
      onClose={onClose}
      width={380}
      footer={<>
        <button type="button" onClick={onClose} className={secondaryBtn}>{t("Cancel")}</button>
        <button type="button" disabled={!ok} onClick={submit} className={primaryBtn}>{t("Create")}</button>
      </>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="space-y-1">
          <FieldLabel htmlFor="pivot-create-range">{t("Data range")}</FieldLabel>
          <input id="pivot-create-range" value={range} onChange={(e) => setRange(e.target.value)} placeholder={t("e.g. Sheet1!A1:D100")} className={cn(inputClass, "font-mono")} />
          {!ok && <p className="text-[11px] text-muted-foreground">{t("Enter a data range")}</p>}
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[11px] font-semibold text-muted-foreground">{t("Insert to")}</legend>
          <label className="flex items-center gap-2 text-xs">
            <input type="radio" name="pivot-target" checked readOnly className="h-3.5 w-3.5 accent-ring" />
            {t("New sheet")}
          </label>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </SheetDialog>
  );
}
