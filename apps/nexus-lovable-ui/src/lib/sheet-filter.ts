// The spreadsheet's basic filter, filter views and slicers (Google Sheets parity, 12 Oct 2026).
//
// A filter covers a range whose FIRST row is the header (never hidden). Each column can hide values
// (by the text the cell shows; "" is "(Blanks)"), require a condition (the same conditions as
// conditional formatting), or require a fill / text colour. Slicers add their own criteria on top,
// AND-ed. Rows are identified by id, so hidden rows survive inserts and sorting.
// Tested in sheet-filter.test.mjs.
import type { CellValue, SheetEngine, SheetShape } from "./sheet-formula.ts";
import type { FilterCrit, SheetFilter, SortSpec } from "./sheet-model.ts";
import { rangeRect, type Rect } from "./sheet-validation.ts";
import { matchCondition } from "./sheet-cf.ts";
import { compareValues } from "./sheet-datatools.ts";

export type FilterOpts = {
  shape: SheetShape;
  engine: SheetEngine | null;
  /** The text a cell shows (formatted), used for "Filter by values". */
  display: (rowId: string, colId: string) => string;
  /** The cell's fill / text colour (after conditional formatting), for "Filter by colour". */
  styleOf: (rowId: string, colId: string) => { bg?: string; fc?: string } | undefined;
  slicers?: { colId: string; crit?: FilterCrit }[];
  today?: number;
};

/** Does a column's criteria filter anything? (A filtered column shows a solid funnel.) */
export function critActive(crit: FilterCrit | undefined): boolean {
  return Boolean(crit && ((crit.hidden && crit.hidden.length) || crit.cond || crit.fill || crit.text));
}

const sameColor = (a: string | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();

/** Does one row pass one column's criteria? */
export function passesCrit(crit: FilterCrit, rowId: string, colId: string, at: { r: number; c: number }, origin: { r: number; c: number }, opts: FilterOpts): boolean {
  if (crit.hidden && crit.hidden.length && crit.hidden.includes(opts.display(rowId, colId))) return false;
  if (crit.cond) {
    const v: CellValue = opts.engine ? opts.engine.value(rowId, colId) : opts.display(rowId, colId);
    const ok = matchCondition(crit.cond.kind, crit.cond.values, v, {
      engine: opts.engine, formula: crit.cond.formula, shape: opts.shape, at, origin, today: opts.today,
    });
    if (!ok) return false;
  }
  if (crit.fill || crit.text) {
    const st = opts.styleOf(rowId, colId);
    if (crit.fill && !sameColor(st?.bg ?? "#ffffff", crit.fill)) return false;
    if (crit.text && !sameColor(st?.fc ?? "#000000", crit.text)) return false;
  }
  return true;
}

/** Which body rows the filter (and any slicers) hide. */
export function applyFilter(filter: SheetFilter, opts: FilterOpts): { hidden: Set<string>; headerRow: number; rect: Rect | null } {
  const hidden = new Set<string>();
  const rect = rangeRect(filter.range, opts.shape);
  if (!rect) return { hidden, headerRow: -1, rect: null };
  const checks: { colId: string; c: number; crit: FilterCrit }[] = [];
  const add = (colId: string, crit: FilterCrit | undefined) => {
    const c = opts.shape.columnIds.indexOf(colId);
    if (c >= 0 && crit && critActive(crit)) checks.push({ colId, c, crit });
  };
  for (const [colId, crit] of Object.entries(filter.criteria ?? {})) add(colId, crit);
  for (const s of opts.slicers ?? []) add(s.colId, s.crit);
  if (!checks.length) return { hidden, headerRow: rect.top, rect };
  for (let r = rect.top + 1; r <= rect.bottom; r += 1) {
    const rowId = opts.shape.rowIds[r];
    if (!rowId) continue;
    for (const ch of checks) {
      // Custom formulas are written for the first data row of the column.
      if (!passesCrit(ch.crit, rowId, ch.colId, { r, c: ch.c }, { r: rect.top + 1, c: ch.c }, opts)) { hidden.add(rowId); break; }
    }
  }
  return { hidden, headerRow: rect.top, rect };
}

/**
 * Body row ids in sorted order (one key or several). Numbers before text, empty cells last in both
 * directions, text compared the Indonesian way; ties keep their order.
 */
export function sortedRowIds(rowIds: string[], keys: SortSpec | SortSpec[], valueOf: (rowId: string, colId: string) => CellValue): string[] {
  const list = Array.isArray(keys) ? keys : [keys];
  const idx = rowIds.map((id, i) => ({ id, i, key: list.map((k) => valueOf(id, k.colId)) }));
  idx.sort((a, b) => {
    for (let k = 0; k < list.length; k += 1) {
      const d = compareValues(a.key[k], b.key[k], list[k].dir);
      if (d) return d;
    }
    return a.i - b.i;
  });
  return idx.map((x) => x.id);
}

const valueCollator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

/** The distinct shown values of a column for "Filter by values": "(Blanks)" (key "") first, then A→Z. */
export function distinctValues(rowIds: string[], colId: string, display: (rowId: string, colId: string) => string): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of rowIds) {
    const t = display(id, colId) ?? "";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => (a.text === "" ? -1 : b.text === "" ? 1 : valueCollator.compare(a.text, b.text)));
}

/** The colours present in a column (for "Filter by colour" / "Sort by colour"). */
export function colorsInColumn(rowIds: string[], colId: string, styleOf: FilterOpts["styleOf"]): { fills: string[]; texts: string[] } {
  const fills = new Set<string>(), texts = new Set<string>();
  for (const id of rowIds) {
    const st = styleOf(id, colId);
    if (st?.bg) fills.add(st.bg.toLowerCase());
    if (st?.fc) texts.add(st.fc.toLowerCase());
  }
  return { fills: [...fills], texts: [...texts] };
}

/** Sort by colour: rows with the colour first, others keep their order. */
export function sortByColor(rowIds: string[], colId: string, color: string, kind: "fill" | "text", styleOf: FilterOpts["styleOf"]): string[] {
  const has = (id: string) => sameColor(kind === "fill" ? styleOf(id, colId)?.bg : styleOf(id, colId)?.fc, color);
  return [...rowIds.filter(has), ...rowIds.filter((id) => !has(id))];
}
