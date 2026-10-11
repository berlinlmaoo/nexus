// Conditional formatting for the spreadsheet (Google Sheets parity, 12 Oct 2026).
//
// `matchCondition` is the one place a "Format cells if…" condition is judged; the filter's
// "Filter by condition" uses it too, so a condition means the same thing in both. `buildCondFormatter`
// turns a sheet's rules into "what extra style does this cell get": the FIRST matching single-colour
// rule in list order wins (Sheets: an earlier rule has priority), and a colour scale paints the fill
// between its min / (mid) / max points. A scale and a single-colour rule combine; the single rule's
// fields win. Pure functions; tested in sheet-cf.test.mjs.
import {
  formatValue, isError, isoToSerial, parseDateText, parseLocaleNumber, serialToYmd, shiftFormula, todaySerial,
  toDisplay, toStored, ymdToSerial,
  type CellValue, type SheetEngine, type SheetShape,
} from "./sheet-formula.ts";
import type { CondKind, CondRule, CondStyle, Hex, ScalePoint } from "./sheet-model.ts";
import { rangeRect, type Rect } from "./sheet-validation.ts";

export type CondCtx = {
  engine: SheetEngine | null;
  /** Custom formula (stored form), written for `origin`. */
  formula?: string;
  shape: SheetShape;
  /** The cell being judged and the rule's top-left cell (raw row / column indices). */
  at: { r: number; c: number };
  origin: { r: number; c: number };
  /** Today's serial (tests); defaults to today in Asia/Jakarta. */
  today?: number;
};

/** The style a brand-new single-colour rule gets (Sheets' green "Default"). */
export const DEFAULT_COND_STYLE: CondStyle = { bg: "#b7e1cd" };

/** "Default formatting style" presets: text colour + fill, like Sheets' preset tiles. */
export const COND_PRESETS: CondStyle[] = [
  { fc: "#000000", bg: "#b7e1cd" },
  { fc: "#000000", bg: "#fce8b2" },
  { fc: "#000000", bg: "#f4c7c3" },
  { fc: "#000000", bg: "#c9daf8" },
  { fc: "#000000", bg: "#d9d2e9" },
  { fc: "#000000", bg: "#efefef" },
  { fc: "#0b8043", bg: "#b7e1cd" },
  { fc: "#b45f06", bg: "#fce8b2" },
  { fc: "#a50e0e", bg: "#f4c7c3" },
  { fc: "#ffffff", bg: "#57bb8a" },
  { fc: "#ffffff", bg: "#e67c73" },
  { fc: "#ffffff", bg: "#4285f4" },
];

/** Colour-scale preview presets (min, optional mid, max). The first is Sheets' default. */
export type ScalePreset = { min: Hex; mid?: Hex; max: Hex };
export const SCALE_PRESETS: ScalePreset[] = [
  { min: "#ffffff", max: "#57bb8a" },
  { min: "#57bb8a", max: "#ffffff" },
  { min: "#ffffff", max: "#e67c73" },
  { min: "#e67c73", max: "#ffffff" },
  { min: "#ffffff", max: "#7baaf7" },
  { min: "#ffffff", max: "#ffd666" },
  { min: "#e67c73", mid: "#ffd666", max: "#57bb8a" },
  { min: "#57bb8a", mid: "#ffd666", max: "#e67c73" },
  { min: "#e67c73", mid: "#ffffff", max: "#57bb8a" },
  { min: "#57bb8a", mid: "#ffffff", max: "#e67c73" },
];

/** Kinds that take one value / two values in the editor. */
export const COND_ONE_VALUE: CondKind[] = ["textContains", "textNotContains", "textStarts", "textEnds", "textIs", "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq"];
export const COND_TWO_VALUES: CondKind[] = ["between", "notBetween"];
/** Date keywords the date kinds accept as values[0]; anything else is read as an exact date. */
export const DATE_KEYWORDS = ["today", "tomorrow", "yesterday", "week", "month", "year", "exact"] as const;

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgb = (h: string) => {
  const s = /^#?([0-9a-f]{6})$/i.exec(h.trim())?.[1] ?? "ffffff";
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
/** Linear blend of two "#rrggbb" colours; t is clamped to 0…1. */
export function interpolateHex(a: Hex, b: Hex, t: number): Hex {
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const x = rgb(a), y = rgb(b);
  return `#${hex2(x[0] + (y[0] - x[0]) * k)}${hex2(x[1] + (y[1] - x[1]) * k)}${hex2(x[2] + (y[2] - x[2]) * k)}`;
}

const textOf = (v: CellValue): string =>
  v === null ? "" : typeof v === "number" ? formatValue(v, null) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v;
const numOf = (v: CellValue): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseLocaleNumber(v)?.n ?? null;
  return null;
};
const serialOf = (v: CellValue): number | null => {
  if (typeof v === "number") return Math.floor(v);
  if (typeof v === "string") return isoToSerial(v.trim()) ?? parseDateText(v);
  return null;
};
const truthy = (out: CellValue) =>
  !isError(out) && (out === true || (typeof out === "number" && out !== 0) || (typeof out === "string" && out.toUpperCase() === "TRUE"));

/** Evaluate a stored formula written for `origin`, shifted to `at`. */
function evalShifted(stored: string, ctx: CondCtx): CellValue {
  if (!ctx.engine) return null;
  const shifted = toStored(shiftFormula(toDisplay(stored, ctx.shape), ctx.at.r - ctx.origin.r, ctx.at.c - ctx.origin.c), ctx.shape);
  return ctx.engine.evaluateFormula(shifted, ctx.shape.rowIds[ctx.at.r] ?? null);
}

/** A criteria value: "=…" is evaluated (shifted like a custom formula) when an engine is there. */
function criterion(raw: string | undefined, ctx: CondCtx | undefined): string {
  const s = raw ?? "";
  if (ctx?.engine && s.trim().startsWith("=")) {
    try { return textOf(evalShifted(toStored(s.trim(), ctx.shape), ctx)); } catch { return s; }
  }
  return s;
}

const minusMonths = (serial: number, months: number) => {
  const { y, m, d } = serialToYmd(serial);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ymdToSerial(ny, nm, Math.min(d, last));
};

/** A date criterion as an inclusive [from, to] serial span, or null when unreadable. */
export function dateSpan(values: string[] | undefined, today: number): [number, number] | null {
  const k = (values?.[0] ?? "").trim().toLowerCase();
  switch (k) {
    case "today": case "hari ini": return [today, today];
    case "tomorrow": case "besok": return [today + 1, today + 1];
    case "yesterday": case "kemarin": return [today - 1, today - 1];
    case "week": return [today - 7, today];
    case "month": return [minusMonths(today, 1), today];
    case "year": return [minusMonths(today, 12), today];
    case "exact": {
      const d = serialOf(values?.[1] ?? null);
      return d === null ? null : [d, d];
    }
  }
  const d = serialOf(values?.[0] ?? null);
  return d === null ? null : [d, d];
}

/**
 * Does a value meet a condition? Text conditions ignore case; number conditions read numeric text
 * too ("1.500"); "is equal to" falls back to text when either side isn't a number. Date values take
 * today / tomorrow / yesterday / week (the past week) / month / year or an exact date.
 */
export function matchCondition(kind: CondKind, values: string[] | undefined, v: CellValue, ctx?: CondCtx): boolean {
  if (isError(v) && kind !== "notEmpty" && kind !== "formula") return false;
  const text = textOf(v);
  const crit = (i: number) => criterion(values?.[i], ctx);
  switch (kind) {
    case "empty": return text === "";
    case "notEmpty": return text !== "";
    case "textContains": return text.toLowerCase().includes(crit(0).toLowerCase());
    case "textNotContains": return !text.toLowerCase().includes(crit(0).toLowerCase());
    case "textStarts": return text.toLowerCase().startsWith(crit(0).toLowerCase());
    case "textEnds": return text.toLowerCase().endsWith(crit(0).toLowerCase());
    case "textIs": return text.toLowerCase() === crit(0).toLowerCase();
    case "dateIs": case "dateBefore": case "dateAfter": {
      if (text === "") return false;
      const d = serialOf(v);
      const span = dateSpan(values?.[0]?.trim().startsWith("=") ? [crit(0)] : values, ctx?.today ?? todaySerial());
      if (d === null || !span) return false;
      if (kind === "dateIs") return d >= span[0] && d <= span[1];
      if (kind === "dateBefore") return d < span[0];
      return d > span[1];
    }
    case "gt": case "gte": case "lt": case "lte": case "eq": case "neq": case "between": case "notBetween": {
      const a = numOf(crit(0)), b = COND_TWO_VALUES.includes(kind) ? numOf(crit(1)) : null;
      const n = text === "" ? null : numOf(v);
      if (kind === "eq" || kind === "neq") {
        const same = n !== null && a !== null ? n === a : text.toLowerCase() === crit(0).trim().toLowerCase();
        return kind === "eq" ? same : !same;
      }
      if (n === null || a === null) return false;
      switch (kind) {
        case "gt": return n > a;
        case "gte": return n >= a;
        case "lt": return n < a;
        case "lte": return n <= a;
        case "between": return b !== null && n >= Math.min(a, b) && n <= Math.max(a, b);
        default: return b !== null && (n < Math.min(a, b) || n > Math.max(a, b));
      }
    }
    case "formula": {
      const f = ctx?.formula;
      if (!f || !ctx?.engine) return false;
      try { return truthy(evalShifted(f, ctx)); } catch { return false; }
    }
  }
  return false;
}

/** The rectangles of a rule's ranges (unreadable ranges dropped). */
export function condRects(rule: { ranges: string[] }, shape: SheetShape): Rect[] {
  return rule.ranges.map((x) => rangeRect(x, shape)).filter((x): x is Rect => Boolean(x));
}
const inRects = (rects: Rect[], r: number, c: number) => rects.some((x) => r >= x.top && r <= x.bottom && c >= x.left && c <= x.right);

/** PERCENTILE.INC over sorted numbers. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const k = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lo = Math.floor(k), hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

/** A scale point's threshold over the range's numbers; null when it can't be read. */
export function scalePointValue(p: ScalePoint, sorted: number[]): number | null {
  if (!sorted.length) return null;
  const min = sorted[0], max = sorted[sorted.length - 1];
  const x = p.value !== undefined && p.value !== "" ? parseLocaleNumber(String(p.value))?.n ?? null : null;
  switch (p.type) {
    case "min": return min;
    case "max": return max;
    case "num": return x;
    case "pct": return x === null ? null : min + ((max - min) * x) / 100;
    case "pctile": return x === null ? null : percentile(sorted, x / 100);
    default: return null;
  }
}

/** The fill a colour scale gives a number, given the range's sorted numbers. */
export function scaleColor(scale: NonNullable<CondRule["scale"]>, n: number, sorted: number[]): Hex | null {
  const lo = scalePointValue(scale.min, sorted), hi = scalePointValue(scale.max, sorted);
  if (lo === null || hi === null) return null;
  const mid = scale.mid && scale.mid.type !== "none" ? scalePointValue(scale.mid, sorted) : null;
  if (hi <= lo) return n <= lo ? scale.min.color : scale.max.color;
  if (n <= lo) return scale.min.color;
  if (n >= hi) return scale.max.color;
  if (mid !== null && scale.mid && mid > lo && mid < hi) {
    return n <= mid
      ? interpolateHex(scale.min.color, scale.mid.color, (n - lo) / (mid - lo))
      : interpolateHex(scale.mid.color, scale.max.color, (n - mid) / (hi - mid));
  }
  return interpolateHex(scale.min.color, scale.max.color, (n - lo) / (hi - lo));
}

/**
 * The sheet's rules as a per-cell lookup. Colour scales read their range's numbers once, on first use.
 * Returns null when no rule touches the cell.
 */
export function buildCondFormatter(rules: CondRule[], shape: SheetShape, engine: SheetEngine | null, today?: number): (rawRow: number, col: number) => CondStyle | null {
  const prepared = rules.map((rule) => {
    const rects = condRects(rule, shape);
    const origin = rects.length ? { r: rects[0].top, c: rects[0].left } : { r: 0, c: 0 };
    return { rule, rects, origin, sorted: null as number[] | null };
  });
  if (!prepared.some((p) => p.rects.length)) return () => null;
  const valueAt = (r: number, c: number): CellValue => {
    const rowId = shape.rowIds[r], colId = shape.columnIds[c];
    return engine && rowId && colId ? engine.value(rowId, colId) : null;
  };
  const numbersOf = (rects: Rect[]): number[] => {
    const out: number[] = [];
    for (const rc of rects) {
      for (let r = rc.top; r <= Math.min(rc.bottom, rc.top + 20000); r += 1) {
        for (let c = rc.left; c <= rc.right; c += 1) {
          const v = valueAt(r, c);
          if (typeof v === "number" && Number.isFinite(v)) out.push(v);
        }
      }
    }
    return out.sort((a, b) => a - b);
  };
  return (rawRow, col) => {
    let single: CondStyle | null = null;
    let scaled: CondStyle | null = null;
    let value: CellValue | undefined;
    for (const p of prepared) {
      if (single && scaled) break;
      if (!inRects(p.rects, rawRow, col)) continue;
      if (value === undefined) value = valueAt(rawRow, col);
      if (p.rule.type === "scale") {
        if (scaled || !p.rule.scale || typeof value !== "number") continue;
        if (!p.sorted) p.sorted = numbersOf(p.rects);
        const bg = scaleColor(p.rule.scale, value, p.sorted);
        if (bg) scaled = { bg };
      } else if (!single && p.rule.cond) {
        const ok = matchCondition(p.rule.cond, p.rule.values, value, {
          engine, formula: p.rule.formula, shape, at: { r: rawRow, c: col }, origin: p.origin, today,
        });
        if (ok) single = p.rule.style ?? DEFAULT_COND_STYLE;
      }
    }
    if (!single && !scaled) return null;
    return { ...(scaled ?? {}), ...(single ?? {}) };
  };
}

export const newCondId = () => `cf_${Math.random().toString(36).slice(2, 10)}`;
