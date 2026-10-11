// Charts for the spreadsheet (Google Sheets parity, 12 Oct 2026): what a chart's ranges mean as
// categories and series, the chart Sheets picks when you insert one, and the maths behind the
// histogram and waterfall types. Pure functions (no React); tested in sheet-chart.test.mjs.
//
// A chart's ranges are stored in id space (like formulas and data validation), so inserting rows or
// columns never detaches it. Several ranges are read side by side, Sheets' "A1:A8,C1:C8".
import {
  colLetter, formatGrouped, formatResult, isError, isoToSerial,
  type CellValue, type SheetData, type SheetEngine, type SheetShape,
} from "./sheet-formula.ts";
import type { ChartSpec, ChartType, Hex } from "./sheet-model.ts";
import { rangeFromA1, rangeRect, rangeToA1, type Rect } from "./sheet-validation.ts";

/** Sheets' default series colours, in order. */
export const SERIES_COLORS: Hex[] = [
  "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6",
  "#7baaf7", "#f07b72", "#fcd04f", "#71c287", "#ff994d", "#7ed1d7",
];

/** The 10×8 colour grid of Sheets' palette (palette.txt), row by row. */
export const PALETTE_80: Hex[] = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
  "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79",
  "#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47",
  "#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130",
];

/** Colour of series `i`: the chart's own, else the sheet theme's accents, else Sheets' defaults. */
export function seriesColor(i: number, spec: Pick<ChartSpec, "colors">, theme?: Hex[] | null): Hex {
  const own = spec.colors?.[i];
  if (own) return own;
  if (theme && theme.length) return theme[i % theme.length];
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

type Kind = "num" | "date" | "text" | "bool" | "error" | "empty";
type GCell = { v: CellValue; kind: Kind; text: string };
const EMPTY: GCell = { v: null, kind: "empty", text: "" };

const MAX_ROWS = 2000;
const MAX_COLS = 200;

function readCell(data: SheetData, engine: SheetEngine, r: number, c: number): GCell {
  const rowId = data.shape.rowIds[r], colId = data.shape.columnIds[c];
  if (rowId === undefined || colId === undefined) return EMPTY;
  const v = engine.value(rowId, colId);
  if (v === null || v === "") return EMPTY;
  if (isError(v)) return { v, kind: "error", text: v };
  const type = data.types?.get(colId) ?? "text";
  const nf = engine.format(rowId, colId);
  const text = formatResult(type, v, nf);
  if (typeof v === "number") return { v, kind: nf === "date" || type === "date" ? "date" : "num", text };
  if (typeof v === "boolean") return { v, kind: "bool", text };
  if (nf === "date" && isoToSerial(v) !== null) return { v: isoToSerial(v), kind: "date", text };
  return { v, kind: "text", text };
}

/** The ranges read side by side into one matrix (rows × columns), trailing empty rows dropped. */
function matrixOf(rects: Rect[], data: SheetData, engine: SheetEngine) {
  const height = Math.min(MAX_ROWS, Math.max(0, ...rects.map((r) => r.bottom - r.top + 1)));
  const cols: { src: number; rect: Rect }[] = [];
  for (const rect of rects) for (let c = rect.left; c <= rect.right && cols.length < MAX_COLS; c += 1) cols.push({ src: c, rect });
  const m: GCell[][] = [];
  for (let i = 0; i < height; i += 1) {
    m.push(cols.map(({ src, rect }) => (rect.top + i <= rect.bottom ? readCell(data, engine, rect.top + i, src) : EMPTY)));
  }
  while (m.length && m[m.length - 1].every((x) => x.kind === "empty")) m.pop();
  const top = rects[0]?.top ?? 0;
  return { m, colSrc: cols.map((c) => c.src), rowSrc: m.map((_, i) => top + i) };
}

const transposeM = (m: GCell[][]): GCell[][] => (m.length ? m[0].map((_, j) => m.map((row) => row[j])) : []);
const isNumeric = (k: Kind) => k === "num" || k === "date";

/** Sheets' guess: row 1 is a header when it is all text while the rows below hold numbers. */
function autoHeaders(m: GCell[][]): boolean {
  if (m.length < 2) return false;
  const first = m[0].filter((x) => x.kind !== "empty");
  if (!first.length || !first.every((x) => x.kind === "text")) return false;
  return m.slice(1).some((row) => row.some((x) => isNumeric(x.kind)));
}

/** Column A is the labels (x-axis) when it holds text or dates and there's something to plot beside it. */
function autoLabels(m: GCell[][], headers: boolean): boolean {
  if (!m.length || m[0].length < 2) return false;
  const body = m.slice(headers ? 1 : 0).map((row) => row[0]).filter((x) => x.kind !== "empty");
  return body.length > 0 && body.every((x) => x.kind === "text" || x.kind === "date" || x.kind === "bool");
}

export type ChartSeries = {
  name: string;
  values: (number | null)[];
  /** Where the series comes from: a sheet column index, or a sheet row index when rows/columns are switched. */
  source: number;
};
export type ChartData = {
  categories: string[];
  series: ChartSeries[];
  headerRow: boolean;
  /** The first column (row, when switched) is used as labels. */
  labels: boolean;
  /** What the x values are; numeric x (scatter/bubble) is in `xValues`. */
  xKind: "text" | "date" | "num" | "none";
  xValues: (number | null)[];
  /** The label column's header text, or its column letter (the "X-axis" chip). */
  xName: string;
  /** The label column's source (sheet column, or row when switched); -1 without labels. */
  xSource: number;
  empty: boolean;
};

const EMPTY_DATA: ChartData = {
  categories: [], series: [], headerRow: false, labels: false, xKind: "none", xValues: [], xName: "", xSource: -1, empty: true,
};

function rectsOf(ranges: string[], shape: SheetShape): Rect[] {
  return ranges.map((r) => rangeRect(r, shape)).filter((r): r is Rect => Boolean(r));
}

type Aggregate = NonNullable<ChartSpec["aggregate"]>;
export function aggregateValues(fn: Aggregate, values: number[]): number | null {
  if (fn === "count") return values.length;
  if (!values.length) return null;
  switch (fn) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
  }
  return null;
}

/** The categories and series a chart draws from its ranges and Setup options. */
export function chartData(
  spec: Pick<ChartSpec, "ranges" | "headers" | "labels" | "transpose" | "aggregate">,
  data: SheetData,
  engine: SheetEngine,
): ChartData {
  const rects = rectsOf(spec.ranges ?? [], data.shape);
  if (!rects.length) return EMPTY_DATA;
  const base = matrixOf(rects, data, engine);
  if (!base.m.length) return EMPTY_DATA;
  const switched = Boolean(spec.transpose);
  const m = switched ? transposeM(base.m) : base.m;
  // A source index per matrix column / row (sheet column, or sheet row when switched).
  const colSrc = switched ? base.rowSrc : base.colSrc;
  if (!m.length || !m[0].length) return EMPTY_DATA;

  const headerRow = spec.headers ?? autoHeaders(m);
  const labels = (spec.labels ?? autoLabels(m, headerRow)) && m[0].length >= 1;
  const body = m.slice(headerRow ? 1 : 0);
  const nameOf = (j: number) => {
    const h = headerRow ? m[0][j]?.text : "";
    return h || (switched ? String(colSrc[j] + 1) : colLetter(colSrc[j]));
  };

  const xCells = labels ? body.map((row) => row[0]) : [];
  const xNonEmpty = xCells.filter((x) => x.kind !== "empty");
  const xKind: ChartData["xKind"] = !labels ? "none"
    : xNonEmpty.length && xNonEmpty.every((x) => x.kind === "date") ? "date"
      : xNonEmpty.length && xNonEmpty.every((x) => x.kind === "num") ? "num" : "text";
  let categories = labels ? xCells.map((x) => x.text) : body.map((_, i) => String(i + 1));
  let xValues: (number | null)[] = labels
    ? xCells.map((x) => (isNumeric(x.kind) ? (x.v as number) : null))
    : body.map((_, i) => i + 1);

  const series: ChartSeries[] = [];
  for (let j = labels ? 1 : 0; j < m[0].length; j += 1) {
    const cells = body.map((row) => row[j]);
    if (!cells.some((x) => isNumeric(x.kind))) continue;
    series.push({ name: nameOf(j), values: cells.map((x) => (isNumeric(x.kind) ? (x.v as number) : null)), source: colSrc[j] });
  }

  if (spec.aggregate && labels) {
    const order: string[] = [];
    const idx = new Map<string, number[]>();
    categories.forEach((c, i) => {
      if (!idx.has(c)) { idx.set(c, []); order.push(c); }
      idx.get(c)!.push(i);
    });
    const fn = spec.aggregate;
    for (const s of series) {
      s.values = order.map((c) => aggregateValues(fn, idx.get(c)!.map((i) => s.values[i]).filter((v): v is number => v !== null)));
    }
    xValues = order.map((c) => xValues[idx.get(c)![0]]);
    categories = order;
  }

  return {
    categories, series, headerRow, labels, xKind, xValues,
    xName: labels ? nameOf(0) : "",
    xSource: labels ? colSrc[0] : -1,
    empty: !series.length || !categories.length,
  };
}

/** What Insert ▸ Chart picks for a selection (Sheets' recommendation). */
export function defaultChart(rect: Rect, data: SheetData, engine: SheetEngine): Pick<ChartSpec, "type" | "headers" | "labels"> {
  if (rect.top === rect.bottom && rect.left === rect.right) return { type: "scorecard", headers: false, labels: false };
  const { m } = matrixOf([rect], data, engine);
  const headers = autoHeaders(m);
  const body = m.slice(headers ? 1 : 0);
  const width = m[0]?.length ?? 0;
  const firstCol = body.map((row) => row[0]).filter((x) => x && x.kind !== "empty");
  if (width >= 2 && firstCol.length && firstCol.every((x) => x.kind === "num")) return { type: "scatter", headers, labels: true };
  const labels = autoLabels(m, headers);
  const seriesCols: number[] = [];
  for (let j = labels ? 1 : 0; j < width; j += 1) if (body.some((row) => isNumeric(row[j].kind))) seriesCols.push(j);
  if (labels && firstCol.length && firstCol.every((x) => x.kind === "date") && body.length >= 10) return { type: "line", headers, labels };
  if (labels && seriesCols.length === 1 && body.length >= 2 && body.length <= 8) {
    const vals = body.map((row) => row[seriesCols[0]]);
    const names = body.map((row) => row[0].text);
    const allPositive = vals.every((x) => x.kind === "num" && (x.v as number) > 0);
    // Repeated labels (two "Apel" rows) read as separate bars, not slices — Sheets keeps a column chart.
    if (allPositive && new Set(names).size === names.length) return { type: "pie", headers, labels };
  }
  return { type: "column", headers, labels };
}

export type HistogramBin = { from: number; to: number; count: number };

/** Equal-width buckets over the numbers (Sturges' rule unless a count is given); the last includes the max. */
export function histogramBins(values: (number | null | undefined)[], bucketCount?: number): HistogramBin[] {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return [];
  let min = Infinity, max = -Infinity;
  for (const v of xs) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) return [{ from: min, to: max, count: xs.length }];
  const k = Math.max(1, Math.min(100, Math.round(bucketCount ?? Math.ceil(Math.log2(xs.length)) + 1)));
  const width = (max - min) / k;
  const bins: HistogramBin[] = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: i === k - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const v of xs) bins[Math.min(k - 1, Math.floor((v - min) / width))].count += 1;
  return bins;
}

export type WaterfallStep = { start: number; end: number; value: number; kind: "up" | "down" | "total" };

/** Running-total bars: each value rises or falls from where the last ended; a final total bar from 0. */
export function waterfallSteps(values: (number | null | undefined)[], opts: { total?: boolean } = {}): WaterfallStep[] {
  const out: WaterfallStep[] = [];
  let run = 0;
  for (const raw of values) {
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    out.push({ start: run, end: run + v, value: v, kind: v < 0 ? "down" : "up" });
    run += v;
  }
  if (out.length && opts.total !== false) out.push({ start: 0, end: run, value: run, kind: "total" });
  return out;
}

/** A scorecard's key value (the `key` cell, else the first series summed) and its baseline. */
export function scorecardValues(spec: ChartSpec, data: SheetData, engine: SheetEngine): {
  key: number | null; keyText: string; baseline: number | null; baselineText: string;
} {
  const cellOf = (stored: string | undefined) => {
    const rc = stored ? rangeRect(stored, data.shape) : null;
    if (!rc) return null;
    return readCell(data, engine, rc.top, rc.left);
  };
  const toNum = (c: GCell | null) => (c && isNumeric(c.kind) ? (c.v as number) : null);
  let keyCell = cellOf(spec.key);
  if (!keyCell) {
    const rects = rectsOf(spec.ranges, data.shape);
    if (rects.length === 1 && rects[0].top === rects[0].bottom && rects[0].left === rects[0].right) keyCell = readCell(data, engine, rects[0].top, rects[0].left);
  }
  let key = toNum(keyCell);
  let keyText = keyCell?.text ?? "";
  if (!keyCell) {
    const cd = chartData(spec, data, engine);
    const vals = cd.series[0]?.values.filter((v): v is number => v !== null) ?? [];
    key = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    keyText = key === null ? "" : formatGrouped(key);
  }
  const b = cellOf(spec.baseline);
  return { key, keyText, baseline: toNum(b), baselineText: b?.text ?? "" };
}

// ── Editing ranges from the chart editor ────────────────────────────────────────────────────────

const RANGE = /^\{\$?([^!}]+)!\$?([^}]+)\}:\{\$?([^!}]+)!\$?([^}]+)\}$/;

/** Ranges as typed: "A1:C8, E1:E8". */
export function rangesToA1(ranges: string[], shape: SheetShape): string {
  return ranges.map((r) => rangeToA1(r, shape)).join(", ");
}
/** "Sheet1!A1:C8, E1:E8" → stored ranges; null when any part can't be read. */
export function rangesFromA1(text: string, shape: SheetShape): string[] | null {
  const parts = text.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: string[] = [];
  for (const p of parts) {
    const s = rangeFromA1(p, shape);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/** "Add series": another column beside the data, over the same rows as the first range. */
export function addSeriesColumn(ranges: string[], colIndex: number, shape: SheetShape): string[] {
  const colId = shape.columnIds[colIndex];
  if (!colId) return ranges;
  const m = ranges.length ? RANGE.exec(ranges[0]) : null;
  if (m && (m[2] === "*" || m[4] === "*")) return [...ranges, `{${colId}!*}:{${colId}!*}`];
  const rc = ranges.length ? rangeRect(ranges[0], shape) : null;
  const top = shape.rowIds[rc?.top ?? 0], bottom = shape.rowIds[rc?.bottom ?? shape.rowIds.length - 1];
  if (!top || !bottom) return ranges;
  return [...ranges, `{${colId}!${top}}:{${colId}!${bottom}}`];
}

/**
 * Remove one series: cut its column (or its row, when rows/columns are switched) out of every range
 * that holds it, splitting a range in two when the series sits in the middle.
 */
export function removeSeriesSource(ranges: string[], source: number, shape: SheetShape, byRow = false): string[] {
  const out: string[] = [];
  for (const stored of ranges) {
    const m = RANGE.exec(stored);
    const rc = rangeRect(stored, shape);
    if (!m || !rc) { out.push(stored); continue; }
    const [lo, hi] = byRow ? [rc.top, rc.bottom] : [rc.left, rc.right];
    if (source < lo || source > hi) { out.push(stored); continue; }
    const whole = m[2] === "*" || m[4] === "*";
    const make = (a: number, b: number) => {
      if (byRow) {
        const c1 = shape.columnIds[rc.left], c2 = shape.columnIds[rc.right];
        return `{${c1}!${shape.rowIds[a]}}:{${c2}!${shape.rowIds[b]}}`;
      }
      const c1 = shape.columnIds[a], c2 = shape.columnIds[b];
      return whole ? `{${c1}!*}:{${c2}!*}` : `{${c1}!${shape.rowIds[rc.top]}}:{${c2}!${shape.rowIds[rc.bottom]}}`;
    };
    if (source > lo) out.push(make(lo, source - 1));
    if (source < hi) out.push(make(source + 1, hi));
  }
  return out;
}

// ── Type families (editor + renderer) ───────────────────────────────────────────────────────────

export type Stacking = "none" | "standard" | "percent";
const STACK_FAMILY: Record<string, [ChartType, ChartType, ChartType]> = {
  column: ["column", "columnStacked", "column100"],
  bar: ["bar", "barStacked", "bar100"],
  area: ["area", "areaStacked", "area100"],
};
export function stackFamily(type: ChartType): keyof typeof STACK_FAMILY | null {
  for (const [k, list] of Object.entries(STACK_FAMILY)) if ((list as string[]).includes(type)) return k;
  return null;
}
export function stackingOf(type: ChartType): Stacking {
  const fam = stackFamily(type);
  if (!fam) return "none";
  const i = STACK_FAMILY[fam].indexOf(type);
  return i === 1 ? "standard" : i === 2 ? "percent" : "none";
}
export function withStacking(type: ChartType, stacking: Stacking): ChartType {
  const fam = stackFamily(type);
  if (!fam) return type;
  return STACK_FAMILY[fam][stacking === "standard" ? 1 : stacking === "percent" ? 2 : 0];
}
