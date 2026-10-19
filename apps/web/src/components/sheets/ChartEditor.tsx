import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChartArea, ChartBar, ChartBarStacked, ChartColumn, ChartColumnBig, ChartColumnIncreasing, ChartColumnStacked, ChartLine,
  ChartNoAxesCombined, ChartPie, ChartScatter, ChartSpline, ChevronDown, CircleDot, Donut, Gauge, Grid2x2, Hash, Plus, Radar,
  Table2, Type, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { colLetter, parseLocaleNumber, type SheetData, type SheetEngine, type SheetShape } from "@/lib/sheet-formula";
import type { ChartSpec, ChartType, Hex } from "@/lib/sheet-model";
import { rangeRect } from "@/lib/sheet-validation";
import {
  PALETTE_80, SERIES_COLORS, addSeriesColumn, chartData, rangesFromA1, rangesToA1, removeSeriesSource, seriesColor,
  stackFamily, stackingOf, withStacking, type Stacking,
} from "@/lib/sheet-chart";
import { Floating, type FloatAnchor } from "./sheet-float";
import { FieldLabel, SidePanel, inputClass, selectClass } from "./sheet-shell";

type Icon = ComponentType<{ className?: string }>;

/** Every chart type with its Sheets name and an icon. */
export const CHART_TYPES: Record<ChartType, { label: string; icon: Icon }> = {
  line: { label: "Line chart", icon: ChartLine },
  lineSmooth: { label: "Smooth line chart", icon: ChartSpline },
  combo: { label: "Combo chart", icon: ChartNoAxesCombined },
  area: { label: "Area chart", icon: ChartArea },
  areaStacked: { label: "Stacked area chart", icon: ChartArea },
  area100: { label: "100% stacked area chart", icon: ChartArea },
  areaStepped: { label: "Stepped area chart", icon: ChartColumnIncreasing },
  column: { label: "Column chart", icon: ChartColumn },
  columnStacked: { label: "Stacked column chart", icon: ChartColumnStacked },
  column100: { label: "100% stacked column chart", icon: ChartColumnBig },
  bar: { label: "Bar chart", icon: ChartBar },
  barStacked: { label: "Stacked bar chart", icon: ChartBarStacked },
  bar100: { label: "100% stacked bar chart", icon: ChartBarStacked },
  pie: { label: "Pie chart", icon: ChartPie },
  donut: { label: "Doughnut chart", icon: Donut },
  scatter: { label: "Scatter chart", icon: ChartScatter },
  bubble: { label: "Bubble chart", icon: CircleDot },
  histogram: { label: "Histogram chart", icon: ChartColumn },
  radar: { label: "Radar chart", icon: Radar },
  waterfall: { label: "Waterfall chart", icon: ChartColumnIncreasing },
  scorecard: { label: "Scorecard chart", icon: Hash },
  table: { label: "Table chart", icon: Table2 },
};

/** The picker's groups, in Sheets' order. */
export const CHART_GROUPS: { label: string; types: ChartType[] }[] = [
  { label: "Line", types: ["line", "lineSmooth"] },
  { label: "Combo", types: ["combo"] },
  { label: "Area", types: ["area", "areaStacked", "area100", "areaStepped"] },
  { label: "Column", types: ["column", "columnStacked", "column100"] },
  { label: "Bar", types: ["bar", "barStacked", "bar100"] },
  { label: "Pie", types: ["pie", "donut"] },
  { label: "Scatter", types: ["scatter", "bubble"] },
  { label: "Other", types: ["waterfall", "histogram", "radar", "scorecard", "table"] },
];

const AGGREGATES: { v: NonNullable<ChartSpec["aggregate"]>; label: string }[] = [
  { v: "sum", label: "Sum" }, { v: "avg", label: "Average" }, { v: "count", label: "Count" }, { v: "max", label: "Max" }, { v: "min", label: "Min" },
];

/**
 * "Chart editor" — the right-hand sidebar with Setup (type, stacking, data range, x-axis, series,
 * aggregate, switch rows/columns, header row, label column) and Customise (style, titles, series
 * colours, legend, axis bounds, gridlines, data labels). Every change goes out at once (`onChange`),
 * so the chart on the grid redraws live like Sheets'.
 */
export function ChartEditor({ spec, shape, sheetName, columnLabel, onChange, onClose, data, engine, theme }: {
  spec: ChartSpec;
  shape: SheetShape;
  sheetName: string;
  /** A column's name for the "Add series" list (its header text, else its letter). */
  columnLabel: (colIndex: number) => string;
  onChange: (next: ChartSpec) => void;
  onClose: () => void;
  /** The sheet's data and engine: lets the editor show the series the chart actually draws. */
  data?: SheetData;
  engine?: SheetEngine;
  theme?: Hex[];
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<"setup" | "custom">("setup");
  const set = (patch: Partial<ChartSpec>) => onChange({ ...spec, ...patch });

  // What the chart draws now (with data) — else a best guess from the ranges.
  const cd = useMemo(() => (data && engine ? chartData(spec, data, engine) : null), [spec, data, engine]);
  const firstRect = useMemo(() => (spec.ranges[0] ? rangeRect(spec.ranges[0], shape) : null), [spec.ranges, shape]);
  const series = useMemo(() => {
    if (cd) return cd.series.map((s) => ({ name: s.name, source: s.source }));
    const cols: number[] = [];
    for (const r of spec.ranges) {
      const rc = rangeRect(r, shape);
      if (rc) for (let c = rc.left; c <= rc.right; c += 1) cols.push(c);
    }
    return cols.slice(spec.labels === false ? 0 : 1).map((c) => ({ name: columnLabel(c), source: c }));
  }, [cd, spec.ranges, spec.labels, shape, columnLabel]);
  const headerRow = cd ? cd.headerRow : spec.headers !== false;
  const labels = cd ? cd.labels : spec.labels !== false;
  const xName = cd ? cd.xName : firstRect ? columnLabel(firstRect.left) : "";

  return (
    <SidePanel title={t("Chart editor")} onClose={onClose}>
      <div role="tablist" className="flex border-b border-border">
        {([["setup", t("Setup")], ["custom", t("Customise")]] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("flex-1 border-b-2 px-3 py-2 text-xs font-semibold transition", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "setup" ? (
        <div className="space-y-4 p-3">
          <TypePicker type={spec.type} onPick={(type) => set({ type })} />

          {stackFamily(spec.type) && (
            <div className="space-y-1">
              <FieldLabel htmlFor="chart-stacking">{t("Stacking")}</FieldLabel>
              <select id="chart-stacking" className={selectClass} value={stackingOf(spec.type)} onChange={(e) => set({ type: withStacking(spec.type, e.target.value as Stacking) })}>
                <option value="none">{t("None")}</option>
                <option value="standard">{t("Standard")}</option>
                <option value="percent">100%</option>
              </select>
            </div>
          )}

          <RangeField spec={spec} shape={shape} sheetName={sheetName} onCommit={(ranges) => set({ ranges })} />

          {spec.type !== "scorecard" && (
            <>
              <div className="space-y-1.5">
                <div className="text-xs font-semibold">{t("X-axis")}</div>
                {labels && xName ? (
                  <div className="flex h-8 items-center gap-2 rounded-full bg-muted px-3 text-xs">
                    <Type className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{xName}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">{t("None")}</div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold">{t("Series")}</div>
                {series.map((s, i) => (
                  <div key={`${s.source}-${i}`} className="flex h-8 items-center gap-2 rounded-full bg-muted pl-3 pr-1 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor(i, spec, theme) }} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <button
                      type="button"
                      aria-label={t("Remove series {name}", { name: s.name })}
                      title={t("Remove")}
                      onClick={() => set({ ranges: removeSeriesSource(spec.ranges, s.source, shape, Boolean(spec.transpose)) })}
                      className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <AddSeries
                  disabled={Boolean(spec.transpose)}
                  shape={shape}
                  columnLabel={columnLabel}
                  used={new Set([...series.map((s) => s.source), ...(labels && cd ? [cd.xSource] : [])])}
                  onPick={(c) => set({ ranges: addSeriesColumn(spec.ranges, c, shape) })}
                />
              </div>

              <div className="space-y-2">
                <Check checked={Boolean(spec.aggregate)} onChange={(on) => set({ aggregate: on ? "sum" : undefined })}>{t("Aggregate")}</Check>
                {spec.aggregate && (
                  <select aria-label={t("Aggregate")} className={cn(selectClass, "ml-6 w-[calc(100%-1.5rem)]")} value={spec.aggregate} onChange={(e) => set({ aggregate: e.target.value as ChartSpec["aggregate"] })}>
                    {AGGREGATES.map((a) => <option key={a.v} value={a.v}>{t(a.label)}</option>)}
                  </select>
                )}
                <Check checked={Boolean(spec.transpose)} onChange={(on) => set({ transpose: on })}>{t("Switch rows/columns")}</Check>
                <Check checked={headerRow} onChange={(on) => set({ headers: on })}>
                  {t("Use row {n} as headers", { n: (firstRect?.top ?? 0) + 1 })}
                </Check>
                <Check checked={labels} onChange={(on) => set({ labels: on })}>
                  {t("Use column {c} as labels", { c: colLetter(firstRect?.left ?? 0) })}
                </Check>
              </div>
            </>
          )}
        </div>
      ) : (
        <CustomiseTab spec={spec} set={set} series={series} theme={theme} empty={Boolean(cd?.empty) && spec.type !== "scorecard"} />
      )}
    </SidePanel>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" className="h-4 w-4 accent-ring" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function TypePicker({ type, onPick }: { type: ChartType; onPick: (t: ChartType) => void }) {
  const { t } = useLang();
  const [at, setAt] = useState<FloatAnchor | null>(null);
  const cur = CHART_TYPES[type];
  const CurIcon = cur.icon;
  return (
    <div className="space-y-1">
      <FieldLabel>{t("Chart type")}</FieldLabel>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(at)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
        }}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-2 text-xs hover:bg-muted/50"
      >
        <CurIcon className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{t(cur.label)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setAt(null)} />
          <Floating anchor={at} role="listbox" className="w-[288px] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop"
            onKeyDown={(e) => { if (e.key === "Escape") setAt(null); }}>
            {CHART_GROUPS.map((g) => (
              <div key={g.label} className="mb-1.5">
                <div className="px-1 pb-1 text-[11px] font-semibold text-muted-foreground">{t(g.label)}</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {g.types.map((ty) => {
                    const I = CHART_TYPES[ty].icon;
                    const label = t(CHART_TYPES[ty].label);
                    return (
                      <button
                        key={ty}
                        type="button"
                        role="option"
                        aria-selected={ty === type}
                        aria-label={label}
                        title={label}
                        onClick={() => { onPick(ty); setAt(null); }}
                        className={cn(
                          "grid h-12 place-items-center rounded-md border transition",
                          ty === type ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className="relative">
                          <I className="h-6 w-6" />
                          {(ty.endsWith("100")) && <span className="absolute -right-2.5 -top-1.5 text-[8px] font-bold">%</span>}
                          {ty === "areaStepped" && <span className="absolute -right-2 -top-1.5 text-[8px] font-bold">⌐</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Floating>
        </>,
        document.body,
      )}
    </div>
  );
}

function RangeField({ spec, shape, sheetName, onCommit }: { spec: ChartSpec; shape: SheetShape; sheetName: string; onCommit: (ranges: string[]) => void }) {
  const { t } = useLang();
  const current = rangesToA1(spec.ranges, shape);
  const [text, setText] = useState(current);
  const [error, setError] = useState(false);
  useEffect(() => { setText(current); setError(false); }, [current]);
  const commit = () => {
    if (text.trim() === current) { setError(false); return; }
    const next = rangesFromA1(text, shape);
    if (!next) { setError(true); return; }
    setError(false);
    onCommit(next);
  };
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor="chart-range">{t("Data range")}</FieldLabel>
      <div className={cn("flex items-center gap-1 rounded-md border bg-background pl-2", error ? "border-destructive" : "border-border")}>
        <Grid2x2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sheetName}!</span>
        <input
          id="chart-range"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          placeholder="A1:C8"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 bg-transparent pr-2 font-mono text-xs outline-none"
        />
      </div>
      {error && <div className="text-[11px] text-destructive">{t("Invalid range")}</div>}
    </div>
  );
}

function AddSeries({ disabled, shape, columnLabel, used, onPick }: {
  disabled: boolean; shape: SheetShape; columnLabel: (c: number) => string; used: Set<number>; onPick: (c: number) => void;
}) {
  const { t } = useLang();
  const [at, setAt] = useState<FloatAnchor | null>(null);
  const cols = shape.columnIds.map((_, i) => i).filter((i) => !used.has(i));
  return (
    <>
      <button
        type="button"
        disabled={disabled || !cols.length}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
        }}
        className="flex h-8 w-full items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-foreground/80 hover:bg-muted disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />{t("Add series")}
      </button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setAt(null)} />
          <Floating anchor={at} role="menu" className="max-h-72 min-w-48 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop"
            onKeyDown={(e) => { if (e.key === "Escape") setAt(null); }}>
            {cols.map((c) => (
              <button key={c} type="button" role="menuitem" onClick={() => { onPick(c); setAt(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted">
                <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">{colLetter(c)}</span>
                <span className="min-w-0 flex-1 truncate">{columnLabel(c)}</span>
              </button>
            ))}
          </Floating>
        </>,
        document.body,
      )}
    </>
  );
}

// ── Customise ───────────────────────────────────────────────────────────────────────────────────

function Section({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="border-b border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold hover:bg-muted/50">
        <span className="flex-1">{title}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </div>
  );
}

/** A text field that writes through as you type (titles redraw live). */
function TextField({ id, label, value, onChange }: { id: string; label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input id={id} className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value ? e.target.value : undefined)} />
    </div>
  );
}

/** A number field (Indonesian "1.000,5" accepted), committed on blur / Enter; empty = automatic. */
function NumberField({ id, label, value, onCommit }: { id: string; label: string; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const { t } = useLang();
  const shown = value === undefined ? "" : String(value).replace(".", ",");
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const s = text.trim();
    if (!s) { onCommit(undefined); return; }
    const n = parseLocaleNumber(s)?.n;
    if (n === undefined || !Number.isFinite(n)) { setText(shown); return; }
    onCommit(n);
  };
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input id={id} inputMode="decimal" className={inputClass} placeholder={t("Auto")} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </div>
  );
}

function Swatch({ label, value, fallback, onPick }: { label: string; value: Hex | undefined; fallback: Hex | null; onPick: (c: Hex | undefined) => void }) {
  const { t } = useLang();
  const [at, setAt] = useState<FloatAnchor | null>(null);
  const shown = value ?? fallback;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
        }}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-background px-2 text-xs hover:bg-muted/50"
      >
        <span className="h-4 w-4 shrink-0 rounded-sm border border-border" style={{ background: shown ?? "transparent" }} />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground">{value ?? t("Default colour")}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setAt(null)} />
          <Floating anchor={at} role="dialog" className="w-[236px] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop"
            onKeyDown={(e) => { if (e.key === "Escape") setAt(null); }}>
            <button type="button" onClick={() => { onPick(undefined); setAt(null); }} className="mb-2 w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted">
              {t("Default colour")}
            </button>
            <div className="grid grid-cols-10 gap-[3px]">
              {PALETTE_80.map((c) => (
                <button key={c} type="button" aria-label={c} title={c} onClick={() => { onPick(c); setAt(null); }}
                  className={cn("h-[19px] w-[19px] rounded-full border", value === c ? "border-foreground ring-2 ring-primary/40" : "border-black/10")}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-10 gap-[3px] border-t border-border pt-2">
              {SERIES_COLORS.slice(0, 10).map((c) => (
                <button key={c} type="button" aria-label={c} title={c} onClick={() => { onPick(c); setAt(null); }}
                  className={cn("h-[19px] w-[19px] rounded-full border", value === c ? "border-foreground ring-2 ring-primary/40" : "border-black/10")}
                  style={{ background: c }} />
              ))}
            </div>
          </Floating>
        </>,
        document.body,
      )}
    </>
  );
}

function CustomiseTab({ spec, set, series, theme, empty }: {
  spec: ChartSpec; set: (p: Partial<ChartSpec>) => void; series: { name: string; source: number }[]; theme?: Hex[]; empty: boolean;
}) {
  const { t } = useLang();
  if (empty) return <div className="p-4 text-xs text-muted-foreground">{t("Please add data to the chart before customising it")}</div>;
  const horizontalValues = stackFamily(spec.type) === "bar";
  const setColor = (i: number, c: Hex | undefined) => {
    // Colours are positional: fill the gap with the colours shown now, then drop a default tail.
    const fallback = (k: number) => seriesColor(k, {}, theme);
    const next = [...(spec.colors ?? [])];
    for (let k = next.length; k <= i; k += 1) next[k] = fallback(k);
    next[i] = c ?? fallback(i);
    while (next.length && next[next.length - 1] === fallback(next.length - 1)) next.pop();
    set({ colors: next.length ? next : undefined });
  };
  const bounds = (
    <div className="flex gap-2">
      <NumberField id="chart-min" label={t("Min")} value={spec.yMin} onCommit={(v) => set({ yMin: v })} />
      <NumberField id="chart-max" label={t("Max")} value={spec.yMax} onCommit={(v) => set({ yMax: v })} />
    </div>
  );
  return (
    <div>
      <Section title={t("Chart style")} open>
        <div className="space-y-1">
          <FieldLabel>{t("Background colour")}</FieldLabel>
          <Swatch label={t("Background colour")} value={spec.bg} fallback={null} onPick={(c) => set({ bg: c })} />
        </div>
      </Section>
      <Section title={t("Chart & axis titles")}>
        <TextField id="chart-title" label={t("Chart title")} value={spec.title} onChange={(v) => set({ title: v })} />
        <TextField id="chart-subtitle" label={t("Chart subtitle")} value={spec.subtitle} onChange={(v) => set({ subtitle: v })} />
        <TextField id="chart-xtitle" label={t("Horizontal axis title")} value={spec.xTitle} onChange={(v) => set({ xTitle: v })} />
        <TextField id="chart-ytitle" label={t("Vertical axis title")} value={spec.yTitle} onChange={(v) => set({ yTitle: v })} />
      </Section>
      <Section title={t("Series")}>
        {series.length === 0 && <div className="text-[11px] text-muted-foreground">{t("None")}</div>}
        {series.map((s, i) => (
          <div key={`${s.source}-${i}`} className="space-y-1">
            <FieldLabel>{s.name}</FieldLabel>
            <Swatch label={t("Colour")} value={spec.colors?.[i]} fallback={seriesColor(i, {}, theme)} onPick={(c) => setColor(i, c)} />
          </div>
        ))}
        <Check checked={Boolean(spec.dataLabels)} onChange={(on) => set({ dataLabels: on || undefined })}>{t("Data labels")}</Check>
      </Section>
      <Section title={t("Legend")}>
        <div className="space-y-1">
          <FieldLabel htmlFor="chart-legend">{t("Position")}</FieldLabel>
          <select id="chart-legend" className={selectClass} value={spec.legend ?? ""} onChange={(e) => set({ legend: (e.target.value || undefined) as ChartSpec["legend"] })}>
            <option value="">{t("Auto")}</option>
            <option value="top">{t("Above the chart")}</option>
            <option value="bottom">{t("Below the chart")}</option>
            <option value="left">{t("Left of the chart")}</option>
            <option value="right">{t("Right of the chart")}</option>
            <option value="none">{t("None")}</option>
          </select>
        </div>
      </Section>
      <Section title={t("Horizontal axis")}>
        {horizontalValues ? bounds : <div className="text-[11px] text-muted-foreground">{t("The horizontal axis shows the labels.")}</div>}
      </Section>
      <Section title={t("Vertical axis")}>
        {!horizontalValues ? bounds : <div className="text-[11px] text-muted-foreground">{t("The vertical axis shows the labels.")}</div>}
      </Section>
      <Section title={t("Gridlines and ticks")}>
        <Check checked={spec.gridlines !== false} onChange={(on) => set({ gridlines: on ? undefined : false })}>{t("Major gridlines")}</Check>
      </Section>
    </div>
  );
}

/** Lucide icon of a chart type (for menus like Insert ▸ Chart). */
export const chartTypeIcon = (type: ChartType): Icon => CHART_TYPES[type]?.icon ?? Gauge;
