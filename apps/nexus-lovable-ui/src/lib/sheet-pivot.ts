// Pivot tables for the spreadsheet (Google Sheets parity, Oct 2026).
//
// A pivot reads a source range whose first row holds the field names, groups the records below it
// by the Rows and Columns fields (multi-level), summarises the Values fields and lays the result out
// the way Sheets does: column field names on top, row field names on the bottom header row, per-group
// "<value> Total" subtotals for every level that has a deeper one, and a "Grand Total" row/column.
// Labels produced here are English ("Grand Total", "SUM of Jumlah"); the UI translates them.
// Pure functions; tested in sheet-pivot.test.mjs.
import {
  formatValue, isError, numberFromText,
  type CellValue, type SheetData, type SheetEngine,
} from "./sheet-formula.ts";
import type { PivotGroupSpec, PivotSpec, PivotSummarize, PivotValueSpec } from "./sheet-model.ts";
import { rangeRect } from "./sheet-validation.ts";

export const PIVOT_FUNCTIONS: PivotSummarize[] = [
  "SUM", "COUNTA", "COUNT", "COUNTUNIQUE", "AVERAGE", "MAX", "MIN", "MEDIAN", "PRODUCT", "STDEV", "STDEVP", "VAR", "VARP",
];
export const PIVOT_MAX_COLUMNS = 50;

export type PivotSource = { data: SheetData; engine: SheetEngine; headerOf(colId: string): string };
export type PivotCell = string | number | null;
export type PivotFormat = null | "num" | "pct";
export type PivotResult = { grid: PivotCell[][]; formats: PivotFormat[][]; error?: string };

/** A suggestion: an English template ("SUM of {value} for each {row}") + its vars, for t(template, vars). */
export type PivotSuggestion = { template: string; vars: Record<string, string>; label: string; spec: Partial<PivotSpec> };

// ── Reading the source ──────────────────────────────────────────────────────────────────────────

type Field = { colId: string; name: string };
type Source = { fields: Field[]; rowIds: string[] };

function readSource(src: PivotSource, range: string): Source | null {
  const shape = src.data.shape;
  const rc = rangeRect(range, shape);
  if (!rc) return null;
  const headerRow = shape.rowIds[rc.top];
  const fields: Field[] = [];
  for (let c = rc.left; c <= rc.right; c += 1) {
    const colId = shape.columnIds[c];
    const v = src.engine.value(headerRow, colId);
    const text = v === null || v === "" ? "" : typeof v === "number" ? formatValue(v, null) : String(v === true ? "TRUE" : v === false ? "FALSE" : v);
    fields.push({ colId, name: text.trim() || src.headerOf(colId) });
  }
  return { fields, rowIds: shape.rowIds.slice(rc.top + 1, rc.bottom + 1) };
}

const isDate = (src: PivotSource, rowId: string, colId: string) => src.engine.format(rowId, colId) === "date";

/** The text a value is filtered and listed by (dates as dates, numbers in the sheet locale). */
function textOf(src: PivotSource, rowId: string, colId: string, v: CellValue): string {
  if (v === null || v === "") return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatValue(v, isDate(src, rowId, colId) ? "date" : null);
  return v;
}

/** A group key: equal values group together; numbers and text never mix. */
type GroupVal = { key: string; sort: number | string | null; label: PivotCell };
function groupVal(src: PivotSource, rowId: string, colId: string): GroupVal {
  const v = src.engine.value(rowId, colId);
  if (v === null || v === "") return { key: "b:", sort: null, label: "" };
  if (typeof v === "number") {
    const label = isDate(src, rowId, colId) ? formatValue(v, "date") : v;
    return { key: `n:${v}`, sort: v, label };
  }
  const text = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v;
  return { key: `s:${text}`, sort: text, label: text };
}

const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });
/** Numbers numerically and before text, text by the Indonesian collation, blanks last (either order). */
function compareGroup(a: GroupVal, b: GroupVal, desc: boolean): number {
  if (a.sort === null || b.sort === null) return a.sort === b.sort ? 0 : a.sort === null ? 1 : -1;
  let r: number;
  if (typeof a.sort === "number" && typeof b.sort === "number") r = a.sort - b.sort;
  else if (typeof a.sort === "number") r = -1;
  else if (typeof b.sort === "number") r = 1;
  else r = collator.compare(a.sort, b.sort) || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
  return desc ? -r : r;
}

// ── Summarising ─────────────────────────────────────────────────────────────────────────────────

const NUMERIC_TYPES = new Set(["number", "currency", "percent"]);

function summarize(fn: PivotSummarize, vals: CellValue[], numericColumn: boolean): number | string {
  const nums: number[] = [];
  let nonBlank = 0;
  const distinct = new Set<string>();
  for (const v of vals) {
    if (v === null || v === "") continue;
    nonBlank += 1;
    distinct.add(typeof v === "number" ? `n:${v}` : `s:${String(v)}`);
    if (typeof v === "number") nums.push(v);
    else if (typeof v === "string" && numericColumn && !isError(v)) {
      const n = numberFromText(v);
      if (n !== null) nums.push(n);
    }
  }
  const n = nums.length;
  const sum = () => nums.reduce((a, b) => a + b, 0);
  const variance = (sample: boolean): number | string => {
    if (n < (sample ? 2 : 1)) return "#DIV/0!";
    const mean = sum() / n;
    return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (sample ? n - 1 : n);
  };
  switch (fn) {
    case "SUM": return sum();
    case "COUNTA": return nonBlank;
    case "COUNT": return n;
    case "COUNTUNIQUE": return distinct.size;
    case "AVERAGE": return n ? sum() / n : "#DIV/0!";
    case "MAX": return n ? Math.max(...nums) : 0;
    case "MIN": return n ? Math.min(...nums) : 0;
    case "MEDIAN": {
      if (!n) return "#NUM!";
      const s = [...nums].sort((a, b) => a - b);
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    case "PRODUCT": return n ? nums.reduce((a, b) => a * b, 1) : 0;
    case "VAR": return variance(true);
    case "VARP": return variance(false);
    case "STDEV": { const v = variance(true); return typeof v === "number" ? Math.sqrt(v) : v; }
    case "STDEVP": { const v = variance(false); return typeof v === "number" ? Math.sqrt(v) : v; }
  }
  return "#VALUE!";
}

// ── Group trees ─────────────────────────────────────────────────────────────────────────────────

type Rec = { rowId: string; rowPath: string[]; colPath: string[] };
type Node = { val: GroupVal; path: string[]; children: Node[] };

function buildTree(recs: Rec[], groups: PivotGroupSpec[], vals: (r: Rec, level: number) => GroupVal, pathOf: (r: Rec) => string[]): Node[] {
  const build = (subset: Rec[], level: number, prefix: string[]): Node[] => {
    if (level >= groups.length) return [];
    const byKey = new Map<string, { val: GroupVal; recs: Rec[] }>();
    for (const r of subset) {
      const k = pathOf(r)[level];
      let g = byKey.get(k);
      if (!g) { g = { val: vals(r, level), recs: [] }; byKey.set(k, g); }
      g.recs.push(r);
    }
    const desc = groups[level].order === "desc";
    return [...byKey.values()]
      .sort((a, b) => compareGroup(a.val, b.val, desc))
      .map((g) => {
        const path = [...prefix, g.val.key];
        return { val: g.val, path, children: build(g.recs, level + 1, path) };
      });
  };
  return build(recs, 0, []);
}

/** One row (or column) of the output: a leaf group, a subtotal, or the grand total. */
type Line = { kind: "leaf" | "sub" | "grand"; path: string[]; labels: PivotCell[]; level: number };

function linesOf(tree: Node[], groups: PivotGroupSpec[], withTotals: boolean): Line[] {
  const out: Line[] = [];
  const walk = (nodes: Node[], level: number) => {
    for (const node of nodes) {
      const first = out.length;
      if (level === groups.length - 1) {
        out.push({ kind: "leaf", path: node.path, labels: [], level });
      } else {
        walk(node.children, level + 1);
        if (withTotals && groups[level].totals !== false) {
          out.push({ kind: "sub", path: node.path, labels: [], level });
          out[out.length - 1].labels[level] = `${node.val.label === "" ? "" : String(node.val.label)} Total`.trim();
        }
      }
      // Sheets shows a group's label once, on its first line.
      if (out.length > first) out[first].labels[level] = node.val.label;
    }
  };
  walk(tree, 0);
  if (withTotals && groups.length && groups[0].totals !== false) out.push({ kind: "grand", path: [], labels: ["Grand Total"], level: 0 });
  return out;
}

// ── computePivot ────────────────────────────────────────────────────────────────────────────────

export function valueLabel(v: PivotValueSpec, name: string): string {
  return `${v.fn} of ${name}`;
}

export function computePivot(spec: PivotSpec, src: PivotSource): PivotResult {
  const source = readSource(src, spec.range);
  if (!source) return { grid: [], formats: [], error: "invalid range" };
  const nameOf = new Map(source.fields.map((f) => [f.colId, f.name]));
  const inRange = (g: { colId: string }) => nameOf.has(g.colId);
  const rows = spec.rows.filter(inRange);
  const cols = spec.cols.filter(inRange);
  const values = spec.values.filter(inRange);
  const filters = spec.filters.filter(inRange);

  // Records, minus the filtered-out ones.
  const recs: Rec[] = [];
  for (const rowId of source.rowIds) {
    let hidden = false;
    for (const f of filters) {
      if (!f.hidden?.length) continue;
      if (f.hidden.includes(textOf(src, rowId, f.colId, src.engine.value(rowId, f.colId)))) { hidden = true; break; }
    }
    if (hidden) continue;
    recs.push({
      rowId,
      rowPath: rows.map((g) => groupVal(src, rowId, g.colId).key),
      colPath: cols.map((g) => groupVal(src, rowId, g.colId).key),
    });
  }

  const R = rows.length, C = cols.length, V = values.length;
  if (R === 0 && C === 0 && V === 0) return { grid: [], formats: [] };

  const withTotals = V > 0;
  const rowTree = buildTree(recs, rows, (r, l) => groupVal(src, r.rowId, rows[l].colId), (r) => r.rowPath);
  const colTree = buildTree(recs, cols, (r, l) => groupVal(src, r.rowId, cols[l].colId), (r) => r.colPath);
  const rowLines: Line[] = R ? linesOf(rowTree, rows, withTotals) : (V ? [{ kind: "grand", path: [], labels: [], level: 0 }] : []);
  const colLines: Line[] = C ? linesOf(colTree, cols, withTotals) : [{ kind: "grand", path: [], labels: [], level: 0 }];

  const L = Math.max(R, C > 0 ? 1 : 0);
  const per = Math.max(V, 1);
  const width = L + (C === 0 && V === 0 ? 0 : colLines.length * per);
  const blankRow = (): PivotCell[] => new Array(width).fill(null);
  const grid: PivotCell[][] = [];
  const formats: PivotFormat[][] = [];
  const push = (cells: PivotCell[], fmt?: PivotFormat[]) => { grid.push(cells); formats.push(fmt ?? new Array(width).fill(null)); };
  const vLabels = values.map((v) => valueLabel(v, nameOf.get(v.colId) ?? v.colId));

  // Header rows.
  if (C > 0) {
    const top = blankRow();
    if (V === 1) top[0] = vLabels[0];
    cols.forEach((g, i) => { if (L + i < width) top[L + i] = nameOf.get(g.colId) ?? g.colId; });
    push(top);
    for (let l = 0; l < C; l += 1) {
      const row = blankRow();
      colLines.forEach((line, i) => { const lab = line.labels[l]; if (lab !== undefined) row[L + i * per] = lab; });
      if (l === C - 1 && V <= 1) rows.forEach((g, i) => { row[i] = nameOf.get(g.colId) ?? g.colId; });
      push(row);
    }
    if (V > 1) {
      const row = blankRow();
      rows.forEach((g, i) => { row[i] = nameOf.get(g.colId) ?? g.colId; });
      colLines.forEach((_, i) => vLabels.forEach((lab, j) => { row[L + i * per + j] = lab; }));
      push(row);
    }
  } else {
    const row = blankRow();
    rows.forEach((g, i) => { row[i] = nameOf.get(g.colId) ?? g.colId; });
    vLabels.forEach((lab, j) => { row[L + j] = lab; });
    push(row);
  }

  // Buckets: records per row path prefix ("" = all).
  const pk = (p: string[]) => p.join("\u0001");
  const rowBuckets = new Map<string, Rec[]>();
  for (const r of recs) {
    for (let d = 0; d <= R; d += 1) {
      const k = pk(r.rowPath.slice(0, d));
      let b = rowBuckets.get(k);
      if (!b) { b = []; rowBuckets.set(k, b); }
      b.push(r);
    }
  }
  const numericCol = (colId: string) => NUMERIC_TYPES.has(src.data.types?.get(colId) ?? "");
  const memo = new Map<string, number | string | null>();
  const cell = (rp: string[], cp: string[], vi: number): number | string | null => {
    const key = `${pk(rp)}\u0002${pk(cp)}\u0002${vi}`;
    if (memo.has(key)) return memo.get(key)!;
    const ck = pk(cp);
    const inBucket = (rowBuckets.get(pk(rp)) ?? []).filter((r) => pk(r.colPath.slice(0, cp.length)) === ck);
    const v = values[vi];
    const out = inBucket.length
      ? summarize(v.fn, inBucket.map((r) => src.engine.value(r.rowId, v.colId)), numericCol(v.colId))
      : null;
    memo.set(key, out);
    return out;
  };
  const shown = (rp: string[], cp: string[], vi: number): number | string | null => {
    const raw = cell(rp, cp, vi);
    const mode = values[vi].showAs ?? "default";
    if (mode === "default" || raw === null || typeof raw === "string") return raw;
    const denom = mode === "row" ? cell(rp, [], vi) : mode === "col" ? cell([], cp, vi) : cell([], [], vi);
    if (typeof denom !== "number") return denom;
    return denom === 0 ? "#DIV/0!" : raw / denom;
  };

  // Data rows.
  for (const line of rowLines) {
    const row = blankRow();
    const fmt: PivotFormat[] = new Array(width).fill(null);
    line.labels.forEach((lab, i) => { if (lab !== undefined && i < L) row[i] = lab; });
    if (V > 0) {
      colLines.forEach((cl, i) => values.forEach((v, j) => {
        const at = L + i * per + j;
        const out = shown(line.path, cl.path, j);
        row[at] = out;
        if (typeof out === "number") fmt[at] = (v.showAs ?? "default") === "default" ? "num" : "pct";
      }));
    }
    push(row, fmt);
  }

  if (width > PIVOT_MAX_COLUMNS) {
    return {
      grid: grid.map((r) => r.slice(0, PIVOT_MAX_COLUMNS)),
      formats: formats.map((r) => r.slice(0, PIVOT_MAX_COLUMNS)),
      error: "too many columns",
    };
  }
  return { grid, formats };
}

// ── Editor helpers ──────────────────────────────────────────────────────────────────────────────

/** Every distinct value of a field (as filter text: "" = blank), in ascending group order. */
export function distinctFieldValues(src: PivotSource, range: string, colId: string): string[] {
  const source = readSource(src, range);
  if (!source || !source.fields.some((f) => f.colId === colId)) return [];
  const seen = new Map<string, GroupVal>();
  for (const rowId of source.rowIds) {
    const text = textOf(src, rowId, colId, src.engine.value(rowId, colId));
    if (!seen.has(text)) seen.set(text, groupVal(src, rowId, colId));
  }
  return [...seen.entries()].sort((a, b) => compareGroup(a[1], b[1], false)).map(([t]) => t);
}

/** The source range's fields (header names), for the editor's field lists. */
export function pivotFields(src: PivotSource, range: string): { colId: string; label: string }[] {
  return (readSource(src, range)?.fields ?? []).map((f) => ({ colId: f.colId, label: f.name }));
}

/**
 * Up to four ready-made pivots, like Sheets' "Suggested" cards: a numeric field summed per category,
 * the same split by a second category, an average, and a count.
 */
export function pivotSuggestions(src: PivotSource, range: string): PivotSuggestion[] {
  const source = readSource(src, range);
  if (!source || !source.rowIds.length) return [];
  type Stat = { field: Field; numeric: boolean; distinct: number; nonBlank: number };
  const stats: Stat[] = source.fields.map((field) => {
    let nums = 0, nonBlank = 0, dates = 0;
    const distinct = new Set<string>();
    for (const rowId of source.rowIds) {
      const v = src.engine.value(rowId, field.colId);
      if (v === null || v === "") continue;
      nonBlank += 1;
      distinct.add(textOf(src, rowId, field.colId, v));
      if (typeof v === "number") { nums += 1; if (isDate(src, rowId, field.colId)) dates += 1; }
    }
    return { field, numeric: nonBlank > 0 && nums * 2 >= nonBlank && dates * 2 < nonBlank, distinct: distinct.size, nonBlank };
  });
  const numeric = stats.filter((s) => s.numeric);
  const cats = stats.filter((s) => !s.numeric && s.nonBlank > 0 && s.distinct >= 1);
  if (!cats.length) return [];
  const row = cats[0];
  const col = cats.slice(1).sort((a, b) => a.distinct - b.distinct)[0];
  const out: PivotSuggestion[] = [];
  const add = (template: string, vars: Record<string, string>, spec: Partial<PivotSpec>) => {
    if (out.length >= 4) return;
    const label = template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
    out.push({ template, vars, label, spec: { cols: [], filters: [], ...spec } });
  };
  const g = (s: Stat): PivotGroupSpec => ({ colId: s.field.colId, order: "asc", totals: true });
  const val = (s: Stat, fn: PivotSummarize): PivotValueSpec => ({ colId: s.field.colId, fn, showAs: "default" });
  const num = numeric[0];
  if (num) {
    add("SUM of {value} for each {row}", { value: num.field.name, row: row.field.name }, { rows: [g(row)], values: [val(num, "SUM")] });
    if (col) add("SUM of {value} for each {row} by {col}", { value: num.field.name, row: row.field.name, col: col.field.name }, { rows: [g(row)], cols: [g(col)], values: [val(num, "SUM")] });
    add("AVERAGE of {value} for each {row}", { value: num.field.name, row: row.field.name }, { rows: [g(row)], values: [val(num, "AVERAGE")] });
  }
  if (col) add("COUNTA of {value} for each {row}", { value: row.field.name, row: col.field.name }, { rows: [g(col)], values: [val(row, "COUNTA")] });
  else add("COUNTA of {value} for each {row}", { value: row.field.name, row: row.field.name }, { rows: [g(row)], values: [val(row, "COUNTA")] });
  return out;
}
