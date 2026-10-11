// Data validation for the spreadsheet (owner, 12 Oct 2026: "exactly like Google Sheets").
//
// A rule applies to one or more ranges, stored in the same id-space form as formula ranges
// ("{colId!rowId}:{colId!rowId}", whole columns "{colId!*}:{colId!*}"), so inserted rows and
// columns never move them and the server shrinks them when a corner is deleted. This file turns
// rules into "which rule covers this cell" and "is this value valid", and translates ranges to and
// from what people type ("Sheet1!B2:B20", "C:C"). Pure functions; tested in sheet-validation.test.mjs.
import {
  colLetter, formatValue, isError, isFormulaCell, isoToSerial, letterToIndex, parseDateText, parseLocaleNumber,
  shiftFormula, todaySerial, toDisplay, toStored,
  type CellValue, type SheetEngine, type SheetShape,
} from "./sheet-formula.ts";

export type ValidationKind =
  | "list" | "listRange"
  | "textContains" | "textNotContains" | "textIs" | "email" | "url"
  | "dateIs" | "dateBefore" | "dateAfter" | "dateBetween" | "dateValid"
  | "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "notBetween"
  | "checkbox" | "formula";

export type ValidationRule = {
  id: string;
  ranges: string[];
  kind: ValidationKind;
  values?: string[];
  colors?: Record<string, string>;
  source?: string;
  formula?: string;
  multiple?: boolean;
  strict?: boolean;
  display?: "chip" | "arrow" | "plain";
  help?: string;
  checked?: string;
  unchecked?: string;
};

export const DROPDOWN_KINDS: ValidationKind[] = ["list", "listRange"];
export const isDropdown = (r: ValidationRule | null | undefined) => Boolean(r && DROPDOWN_KINDS.includes(r.kind));

export type Rect = { top: number; bottom: number; left: number; right: number };

const RANGE = /^\{\$?([^!}]+)!\$?([^}]+)\}:\{\$?([^!}]+)!\$?([^}]+)\}$/;

/** A stored range as raw row / column indices (rows to the end of the sheet for whole columns). */
export function rangeRect(stored: string, shape: SheetShape): Rect | null {
  const m = RANGE.exec(stored);
  if (!m) return null;
  const c1 = shape.columnIds.indexOf(m[1]), c2 = shape.columnIds.indexOf(m[3]);
  if (c1 < 0 || c2 < 0) return null;
  const r1 = m[2] === "*" ? 0 : shape.rowIds.indexOf(m[2]);
  const r2 = m[4] === "*" ? shape.rowIds.length - 1 : shape.rowIds.indexOf(m[4]);
  if (r1 < 0 || r2 < 0) return null;
  return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) };
}

/** A stored range as people read it: "B2:B20", "C:C", "D5". */
export function rangeToA1(stored: string, shape: SheetShape): string {
  const m = RANGE.exec(stored);
  if (!m) return "#REF!";
  const c1 = shape.columnIds.indexOf(m[1]), c2 = shape.columnIds.indexOf(m[3]);
  if (c1 < 0 || c2 < 0) return "#REF!";
  if (m[2] === "*" || m[4] === "*") return `${colLetter(c1)}:${colLetter(c2)}`;
  const r1 = shape.rowIds.indexOf(m[2]), r2 = shape.rowIds.indexOf(m[4]);
  if (r1 < 0 || r2 < 0) return "#REF!";
  const a = `${colLetter(c1)}${r1 + 1}`, b = `${colLetter(c2)}${r2 + 1}`;
  return a === b ? a : `${a}:${b}`;
}

/** A typed range ("Sheet1!B2:B20", "b2", "C:C", "A1:C") to the stored form; null if unreadable. */
export function rangeFromA1(text: string, shape: SheetShape): string | null {
  const s = text.trim().replace(/^(?:'[^']*'|[^!]*)!/, "").replace(/\$/g, "").toUpperCase();
  let m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(s);
  if (m) {
    const a = shape.columnIds[letterToIndex(m[1])], b = shape.columnIds[letterToIndex(m[2])];
    return a && b ? `{${a}!*}:{${b}!*}` : null;
  }
  m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+)?)?$/.exec(s);
  if (!m) return null;
  const c1 = shape.columnIds[letterToIndex(m[1])], r1 = shape.rowIds[Number(m[2]) - 1];
  const c2 = shape.columnIds[letterToIndex(m[3] ?? m[1])];
  // "A2:A" (open-ended, like Sheets) runs to the last row.
  const r2 = m[3] ? (m[4] ? shape.rowIds[Number(m[4]) - 1] : shape.rowIds[shape.rowIds.length - 1]) : r1;
  if (!c1 || !c2 || !r1 || !r2) return null;
  return `{${c1}!${r1}}:{${c2}!${r2}}`;
}

/** Which rule covers a cell: the LAST rule listed wins, like a newer rule applied over an older one. */
export function buildRuleIndex(rules: ValidationRule[], shape: SheetShape) {
  const rects = rules.map((r) => ({ rule: r, rects: r.ranges.map((x) => rangeRect(x, shape)).filter((x): x is Rect => Boolean(x)) }));
  return (rawRow: number, col: number): ValidationRule | null => {
    for (let i = rects.length - 1; i >= 0; i -= 1) {
      for (const rc of rects[i].rects) {
        if (rawRow >= rc.top && rawRow <= rc.bottom && col >= rc.left && col <= rc.right) return rects[i].rule;
      }
    }
    return null;
  };
}

/** The top-left cell of a rule's first range (custom formulas are written relative to it). */
export function ruleOrigin(rule: ValidationRule, shape: SheetShape): { r: number; c: number } {
  const rc = rule.ranges.map((x) => rangeRect(x, shape)).find(Boolean);
  return rc ? { r: rc.top, c: rc.left } : { r: 0, c: 0 };
}

const textOf = (v: CellValue): string => (v === null ? "" : typeof v === "number" ? formatValue(v, null) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v);

/** The choices of a dropdown rule: its items, or the distinct values of its source range. */
export function dropdownOptions(rule: ValidationRule, engine: SheetEngine | null, shape: SheetShape): string[] {
  if (rule.kind === "list") return (rule.values ?? []).filter((v) => v.trim() !== "");
  if (rule.kind !== "listRange" || !rule.source || !engine) return [];
  const rc = rangeRect(rule.source, shape);
  if (!rc) return [];
  const out = new Set<string>();
  for (let r = rc.top; r <= Math.min(rc.bottom, rc.top + 5000); r += 1) {
    for (let c = rc.left; c <= rc.right; c += 1) {
      const v = engine.value(shape.rowIds[r], shape.columnIds[c]);
      if (v === null || v === "" || isError(v)) continue;
      out.add(textOf(v));
    }
  }
  return [...out];
}

/** The picked items of a (multi-)dropdown cell. */
export function pickedValues(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) return raw.map(String).map((x) => x.trim()).filter(Boolean);
  return String(raw).split(",").map((x) => x.trim()).filter(Boolean);
}

/** Is the checkbox ticked? TRUE, or the rule's custom "checked" value. */
export function isChecked(rule: ValidationRule | null, raw: unknown): boolean {
  if (raw === true) return true;
  if (rule?.checked) return String(raw ?? "") === rule.checked;
  return typeof raw === "string" && raw.trim().toUpperCase() === "TRUE";
}
/** The value a checkbox writes when toggled. */
export function checkboxValue(rule: ValidationRule | null, on: boolean): unknown {
  if (rule?.checked || rule?.unchecked) return on ? (rule.checked || true) : (rule.unchecked ?? null);
  return on ? true : false;
}

const asSerial = (v: CellValue): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return isoToSerial(v) ?? parseDateText(v);
  return null;
};
const criteriaSerial = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === "today" || t === "hari ini") return todaySerial();
  if (t === "tomorrow" || t === "besok") return todaySerial() + 1;
  if (t === "yesterday" || t === "kemarin") return todaySerial() - 1;
  return parseDateText(s);
};
const criteriaNumber = (s: string | undefined): number | null => (s ? parseLocaleNumber(s)?.n ?? null : null);

/**
 * Does a cell's value pass its rule? Blank always passes (Sheets doesn't flag empty cells).
 * `raw` is the stored value, `computed` the engine's value for it; `at` is the cell's raw position
 * (custom formulas are shifted from the rule's top-left to it).
 */
export function validateCell(
  rule: ValidationRule,
  raw: unknown,
  computed: CellValue,
  ctx: { engine: SheetEngine | null; shape: SheetShape; at: { r: number; c: number } },
): boolean {
  if (rule.kind === "checkbox") {
    if (raw === undefined || raw === null || raw === "" || raw === true || raw === false) return true;
    const s = String(raw);
    if (rule.checked || rule.unchecked) return s === rule.checked || s === rule.unchecked;
    return ["TRUE", "FALSE"].includes(s.trim().toUpperCase());
  }
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) return true;
  if (isError(computed)) return false;
  const text = textOf(computed).trim();
  const values = rule.values ?? [];
  switch (rule.kind) {
    case "list":
    case "listRange": {
      const options = new Set(dropdownOptions(rule, ctx.engine, ctx.shape));
      const picked = rule.multiple ? pickedValues(raw) : [isFormulaCell(raw) ? text : String(Array.isArray(raw) ? raw.join(", ") : raw).trim()];
      return picked.every((p) => options.has(p));
    }
    case "textContains": return text.toLowerCase().includes((values[0] ?? "").toLowerCase());
    case "textNotContains": return !text.toLowerCase().includes((values[0] ?? "").toLowerCase());
    case "textIs": return text === (values[0] ?? "");
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text);
    case "url": return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(text);
    case "dateValid": return asSerial(computed) !== null;
    case "dateIs": case "dateBefore": case "dateAfter": case "dateBetween": {
      const v = asSerial(computed);
      const a = criteriaSerial(values[0]), b = criteriaSerial(values[1]);
      if (v === null || a === null) return false;
      const d = Math.floor(v);
      if (rule.kind === "dateIs") return d === a;
      if (rule.kind === "dateBefore") return d < a;
      if (rule.kind === "dateAfter") return d > a;
      return b !== null && d >= Math.min(a, b) && d <= Math.max(a, b);
    }
    case "gt": case "gte": case "lt": case "lte": case "eq": case "neq": case "between": case "notBetween": {
      const v = typeof computed === "number" ? computed : criteriaNumber(text);
      const a = criteriaNumber(values[0]), b = criteriaNumber(values[1]);
      if (v === null || a === null) return false;
      switch (rule.kind) {
        case "gt": return v > a;
        case "gte": return v >= a;
        case "lt": return v < a;
        case "lte": return v <= a;
        case "eq": return v === a;
        case "neq": return v !== a;
        case "between": return b !== null && v >= Math.min(a, b) && v <= Math.max(a, b);
        default: return b !== null && (v < Math.min(a, b) || v > Math.max(a, b));
      }
    }
    case "formula": {
      if (!rule.formula || !ctx.engine) return true;
      const origin = ruleOrigin(rule, ctx.shape);
      const shifted = toStored(shiftFormula(toDisplay(rule.formula, ctx.shape), ctx.at.r - origin.r, ctx.at.c - origin.c), ctx.shape);
      const out = ctx.engine.evaluateFormula(shifted, ctx.shape.rowIds[ctx.at.r] ?? null);
      if (isError(out)) return false;
      return out === true || (typeof out === "number" && out !== 0) || (typeof out === "string" && out.toUpperCase() === "TRUE");
    }
  }
  return true;
}

/** The message shown for an invalid value: the rule's help text, else Sheets' default wording. */
export function invalidMessage(rule: ValidationRule, t: (en: string, vars?: Record<string, string | number>) => string): string {
  if (rule.help) return rule.help;
  const v = rule.values ?? [];
  switch (rule.kind) {
    case "list": case "listRange": return t("Input must be an item on the specified list");
    case "checkbox": return t("Input must be a checkbox value");
    case "email": return t("Input must be a valid email address");
    case "url": return t("Input must be a valid URL");
    case "dateValid": return t("Input must be a valid date");
    case "textContains": return t("Input must contain \"{v}\"", { v: v[0] ?? "" });
    case "textNotContains": return t("Input must not contain \"{v}\"", { v: v[0] ?? "" });
    case "textIs": return t("Input must be exactly \"{v}\"", { v: v[0] ?? "" });
    case "dateIs": return t("Input must be the date {v}", { v: v[0] ?? "" });
    case "dateBefore": return t("Input must be a date before {v}", { v: v[0] ?? "" });
    case "dateAfter": return t("Input must be a date after {v}", { v: v[0] ?? "" });
    case "dateBetween": return t("Input must be a date between {a} and {b}", { a: v[0] ?? "", b: v[1] ?? "" });
    case "gt": return t("Input must be greater than {v}", { v: v[0] ?? "" });
    case "gte": return t("Input must be greater than or equal to {v}", { v: v[0] ?? "" });
    case "lt": return t("Input must be less than {v}", { v: v[0] ?? "" });
    case "lte": return t("Input must be less than or equal to {v}", { v: v[0] ?? "" });
    case "eq": return t("Input must be equal to {v}", { v: v[0] ?? "" });
    case "neq": return t("Input must not be equal to {v}", { v: v[0] ?? "" });
    case "between": return t("Input must be between {a} and {b}", { a: v[0] ?? "", b: v[1] ?? "" });
    case "notBetween": return t("Input must not be between {a} and {b}", { a: v[0] ?? "", b: v[1] ?? "" });
    case "formula": return t("Input must satisfy the custom formula");
  }
  return t("Invalid value");
}

export const newRuleId = () => `v_${Math.random().toString(36).slice(2, 10)}`;
