import type { NexusSheetCellValue, NexusSheetColumn, NexusSheetColumnType, NexusSheetRow, NexusSheetRule } from "@/lib/nexus-api";
import {
  detectInput, editTyped, engineFor, formatResult, formatScalar, formatValue, isError, isFormulaCell, isTypedCell,
  isoToSerial, parseDateText, parseLocaleNumber, serialToIso, toDisplay, toStored,
  type CellValue, type SheetData, type SheetEngine, type SheetShape, type TypedCell,
} from "@/lib/sheet-formula";

export type { NexusSheetCellValue, NexusSheetColumn, NexusSheetColumnType, NexusSheetRow, NexusSheetRule };

/**
 * Header tints. Full class strings, never built by interpolation — Tailwind only ships classes it can
 * see in the source, so `bg-${color}-100` would compile to nothing at all.
 */
export const COLUMN_COLOR_CLASS: Record<string, string> = {
  rose: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  violet: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  slate: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
};
/** English source text; shown through t() (Indonesian in lib/i18n/id-sheets.ts). */
export const COLUMN_COLOR_LABEL: Record<string, string> = {
  rose: "Red", amber: "Yellow", green: "Green", blue: "Blue", violet: "Purple", slate: "Grey",
};

/** Chip tints for dropdown choices — stronger than the header tints so a pill reads as a pill. */
export const CHIP_COLOR_CLASS: Record<string, string> = {
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  slate: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
};
export const CHIP_COLORS = ["rose", "amber", "green", "blue", "violet", "slate"] as const;

/**
 * The chip colour for one dropdown choice.
 *
 * Falls back to cycling the palette by the choice's position, so a fresh dropdown is legible the
 * moment it's created instead of six identical grey pills waiting to be coloured by hand. An explicit
 * pick always wins.
 */
export function optionColor(col: NexusSheetColumn, value: string): string {
  const explicit = col.optionColors?.[value];
  if (explicit) return CHIP_COLOR_CLASS[explicit] ?? CHIP_COLOR_CLASS.slate;
  const i = (col.options ?? []).indexOf(value);
  if (i < 0) return CHIP_COLOR_CLASS.slate;
  return CHIP_COLOR_CLASS[CHIP_COLORS[i % CHIP_COLORS.length]];
}

/** English source text; shown through t() (Indonesian in lib/i18n/id-sheets.ts). */
export const COLUMN_TYPE_LABEL: Record<NexusSheetColumnType, string> = {
  text: "Text",
  number: "Number",
  currency: "Rupiah",
  date: "Date",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  task: "Task",
  link: "Link",
};

export const RULE_OP_LABEL: Record<NexusSheetRule["op"], string> = {
  gt: "greater than", lt: "less than", gte: "≥", lte: "≤",
  eq: "is equal to", neq: "is not equal to", contains: "contains",
  empty: "is empty", notEmpty: "is not empty",
};

/** Tailwind classes per style. Kept here so the rule editor and the cell agree on the swatches. */
export const RULE_STYLE_CLASS: Record<NexusSheetRule["style"], string> = {
  red: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  grey: "bg-muted text-muted-foreground",
  bold: "font-black",
};

/**
 * First matching rule wins. Comparison is numeric when both sides look numeric, otherwise text —
 * so a rule like "lebih dari 1000000" behaves on a Rupiah column and "mengandung batal" on a text one.
 */
export function matchRule(rules: NexusSheetRule[] | undefined, value: CellValue | undefined): NexusSheetRule | null {
  if (!rules?.length) return null;
  const empty = value === undefined || value === null || value === "";
  // An error result is not "empty" and not a match for anything but notEmpty.
  if (isError(value)) return rules.find((r) => r.op === "notEmpty") ?? null;
  for (const rule of rules) {
    if (rule.op === "empty") { if (empty) return rule; continue; }
    if (rule.op === "notEmpty") { if (!empty) return rule; continue; }
    if (empty) continue;
    const target = rule.value ?? "";
    const targetNum = target === "" ? null : parseLocaleNumber(target)?.n ?? null;
    const bothNumeric = typeof value === "number" && targetNum !== null;
    if (rule.op === "contains") {
      if (String(value).toLowerCase().includes(target.toLowerCase())) return rule;
      continue;
    }
    if (bothNumeric) {
      const a = value as number;
      const b = targetNum as number;
      const hit = rule.op === "gt" ? a > b : rule.op === "lt" ? a < b
        : rule.op === "gte" ? a >= b : rule.op === "lte" ? a <= b
        : rule.op === "neq" ? a !== b : a === b;
      if (hit) return rule;
      continue;
    }
    const cmp = String(value).localeCompare(target, "id");
    const hit = rule.op === "gt" ? cmp > 0 : rule.op === "lt" ? cmp < 0
      : rule.op === "gte" ? cmp >= 0 : rule.op === "lte" ? cmp <= 0
      : rule.op === "neq" ? cmp !== 0 : cmp === 0;
    if (hit) return rule;
  }
  return null;
}

/** Build the evaluation context once per render, not once per cell. */
export function buildSheetData(columns: NexusSheetColumn[], rows: NexusSheetRow[], names?: { name: string; range: string }[] | null): SheetData {
  return {
    shape: { columnIds: columns.map((c) => c.id), rowIds: rows.map((r) => r.id) },
    cells: new Map(rows.map((r) => [r.id, r.cells as Record<string, unknown>])),
    types: new Map(columns.map((c) => [c.id, c.type])),
    ...(names?.length ? { names: new Map(names.map((n) => [n.name.toUpperCase(), n.range])) } : {}),
  };
}

/** The value a cell COMPUTES to (formula result, typed number, link label…), for sort/filter/rules. */
export function cellValue(data: SheetData, rowId: string, colId: string): CellValue {
  return engineFor(data).value(rowId, colId);
}

/**
 * The choices held by a multi-select cell.
 *
 * A plain comma string counts, so a column switched over from Teks or Pilihan shows its existing
 * "Suwara, ViralZ" values as chips straight away instead of needing the data rewritten first.
 */
export function readMulti(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map(String) : String(value ?? "").split(",");
  return [...new Set(list.map((v) => v.trim()).filter(Boolean))];
}

export function isLinkCell(v: unknown): v is { t: string; u: string } {
  return Boolean(v) && typeof v === "object" && typeof (v as { u?: unknown }).u === "string";
}

/**
 * A formula cell shows its RESULT; everything else shows itself. The same functions build the
 * server's GET ?computed=1 text (lib/sheet-formula), so web and phones read identical text.
 */
export function displayCell(
  type: NexusSheetColumnType,
  raw: unknown,
  ctx: { data: SheetData; rowId: string; colId: string } | null,
): string {
  if (isFormulaCell(raw)) {
    if (!ctx) return raw.f;
    const engine = engineFor(ctx.data);
    return formatResult(type, engine.value(ctx.rowId, ctx.colId), engine.format(ctx.rowId, ctx.colId));
  }
  return formatScalar(type, raw);
}

/** What goes in the editor for a formula cell: the A1 form (Indonesian separators) from the stored ids. */
export function editFormula(raw: unknown, shape: SheetShape): string | null {
  return isFormulaCell(raw) ? toDisplay(raw.f, shape) : null;
}

/** What a cell shows when it's NOT being edited (stored values only — formulas go through displayCell). */
export function formatCell(type: NexusSheetColumnType, value: unknown): string {
  return formatScalar(type, value);
}

/** A computed value under its column type (footer totals, status bar). */
export function formatComputed(type: NexusSheetColumnType, v: CellValue, nf: TypedCell["nf"] | null = null): string {
  return formatResult(type, v, nf);
}

/**
 * What goes INTO the input when editing — text that, typed back, gives the same value: numbers with
 * an Indonesian decimal comma ("1,5"), typed values in the style they were typed ("Rp 1.500.000").
 */
export function editValue(type: NexusSheetColumnType, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "checkbox") return value ? "true" : "";
  // Multi-select round-trips as a comma list, which is also what a paste from Excel looks like.
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (isTypedCell(value)) return editTyped(value);
  if (isLinkCell(value)) return value.t || value.u;
  if (isFormulaCell(value)) return value.f;
  if (typeof value === "number") return formatValue(value, null);
  if (typeof value === "object") return "";
  return String(value);
}

/**
 * Typed text -> the value to store for this column. The one path for typing, paste, fill-from-text,
 * replace and the phone view, so they can never disagree.
 *
 *   "=…"          -> a formula, bound to ids at the current positions
 *   text column   -> "Rp 1.500.000" / "15%" / "1.500" / "11/10/2026" become numbers or dates with a
 *                    format; anything else stays text exactly as typed (never silently dropped)
 *   number/Rupiah -> a number when it reads as one ("007" is 7 here), else the text itself
 *   date          -> ISO date (day first: 11/10/2026 is 11 Oct), else the text itself
 */
export function inputToCell(
  col: NexusSheetColumn,
  text: string,
  shape: SheetShape,
  prevRaw?: unknown,
): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("=") && trimmed.length > 1 && col.type !== "checkbox") return { f: toStored(trimmed, shape) };
  switch (col.type) {
    case "checkbox":
      return ["true", "1", "ya", "yes", "y", "✓", "x"].includes(trimmed.toLowerCase());
    case "link": {
      // Typing over a link edits what it SAYS; the URL survives (it's the part nobody can retype).
      const prevUrl = isLinkCell(prevRaw) ? prevRaw.u : "";
      return prevUrl ? { t: trimmed, u: prevUrl } : trimmed;
    }
    case "multiselect":
    case "select":
    case "task":
      return trimmed;
    case "number":
    case "currency": {
      const d = detectInput(trimmed);
      if (d.kind === "number") return d.nf === "pct" || d.nf === "date" ? { v: d.v, nf: d.nf } : d.v;
      const plain = parseLocaleNumber(trimmed);
      return plain ? plain.n : text;
    }
    case "date": {
      const serial = parseDateText(trimmed);
      return serial === null ? text : serialToIso(serial);
    }
    default: {
      const d = detectInput(text);
      if (d.kind === "number") return d.nf ? { v: d.v, nf: d.nf } : d.v;
      return text;
    }
  }
}

/** Two stored values are the same cell content (so a no-op edit doesn't spend a request). */
export function sameCell(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Sort key: numbers (and dates, typed values, numeric text) sort as numbers, the rest as text. */
export function sortKey(v: CellValue): { n: number } | { s: string } | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") return { n: v };
  if (typeof v === "boolean") return { n: v ? 1 : 0 };
  if (isError(v)) return { s: `\uffff${v}` };
  const iso = isoToSerial(v);
  if (iso !== null) return { n: iso };
  return { s: v };
}

/** Copy/paste interchange. Excel and Google Sheets both put TSV on `text/plain`. */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t")).join("\n");
}

/**
 * Parse pasted TSV. Handles quoted cells containing tabs/newlines, which is what Excel emits for
 * multi-line text — splitting naively on \t and \n mangles those.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  // Excel usually ends with a trailing newline — drop the phantom empty row it creates.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

export type Aggregate = { sum: number; avg: number; filled: number; numeric: number; count: number; min: number; max: number };

/**
 * Footer / status-bar aggregates over computed values: a formula's RESULT and a typed "Rp 1.500.000"
 * count as numbers. Callers memoise this — evaluating every formula per selection change was the lag.
 */
export function aggregate(rows: NexusSheetRow[], col: NexusSheetColumn, engine?: SheetEngine): Aggregate {
  let sum = 0, numeric = 0, filled = 0, min = Infinity, max = -Infinity;
  for (const r of rows) {
    const raw: unknown = r.cells[col.id];
    const v = engine ? engine.value(r.id, col.id) : isFormulaCell(raw) ? null : (raw as CellValue);
    if (v === undefined || v === null || v === "" || isError(v)) continue;
    filled += 1;
    if (typeof v === "number") { sum += v; numeric += 1; min = Math.min(min, v); max = Math.max(max, v); }
  }
  return { sum, avg: numeric ? sum / numeric : 0, filled, numeric, count: rows.length, min, max };
}

/**
 * Work out what dragging the fill handle should produce.
 *
 * Copies the source block, except when it looks like a series — 1,2,3 or 10,20,30 or "Hari 1","Hari 2"
 * — in which case it continues the series, which is the whole reason people drag the handle.
 */
export function fillValues(source: unknown[], count: number): unknown[] {
  const out: unknown[] = [];
  const present = source.filter((v) => v !== undefined && v !== null && v !== "");

  // Dates — ISO strings (date columns) or typed date serials — continue by day, or by month when the
  // source steps by whole months (1 Jan, 1 Feb -> 1 Mar). "2026-10-31" + 1 is 1 Nov, never "2026-10-32".
  const serials = present.map((v) => (isTypedCell(v) && v.nf === "date" ? v.v : isoToSerial(v)));
  if (present.length >= 1 && serials.every((s) => s !== null)) {
    const iso = typeof present[0] === "string";
    const wrap = (serial: number) => (iso ? serialToIso(serial) : { v: serial, nf: "date" as const });
    const ss = serials as number[];
    const ymd = (s: number) => { const d = new Date(Date.UTC(1899, 11, 30) + s * 86_400_000); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; };
    if (ss.length >= 2) {
      const a = ymd(ss[0]), b = ymd(ss[1]);
      const monthStep = (b.y - a.y) * 12 + (b.m - a.m);
      const byMonth = a.d === b.d && monthStep !== 0 && ss.every((s, i) => { const x = ymd(s); return x.d === a.d && (x.y - a.y) * 12 + (x.m - a.m) === monthStep * i; });
      if (byMonth) {
        const last = ymd(ss[ss.length - 1]);
        for (let i = 1; i <= count; i += 1) {
          const t = new Date(Date.UTC(last.y, last.m + monthStep * i, 1));
          const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
          out.push(wrap(Math.round((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(a.d, dim)) - Date.UTC(1899, 11, 30)) / 86_400_000)));
        }
        return out;
      }
    }
    const step = ss.length >= 2 ? ss[1] - ss[0] : 1;
    const constant = ss.every((s, i) => i === 0 || s - ss[i - 1] === step);
    if (constant && step !== 0) {
      let next = ss[ss.length - 1];
      for (let i = 0; i < count; i += 1) { next += step; out.push(wrap(next)); }
      return out;
    }
  }

  // Typed numbers (Rp, %) continue their series and keep their format.
  if (present.length >= 2 && present.every((v) => isTypedCell(v) && v.nf !== "date")) {
    const typed = present as TypedCell[];
    const step = typed[1].v - typed[0].v;
    if (step !== 0 && typed.every((t, i) => i === 0 || Math.abs(t.v - typed[i - 1].v - step) < 1e-9)) {
      let next = typed[typed.length - 1].v;
      for (let i = 0; i < count; i += 1) { next += step; out.push({ v: next, nf: typed[0].nf }); }
      return out;
    }
  }

  const clean = present.filter((v) => typeof v !== "object") as NexusSheetCellValue[];
  if (clean.length !== present.length) {
    for (let i = 0; i < count; i += 1) out.push(source[i % source.length] ?? null);
    return out;
  }

  // Numeric series: two or more numbers with a constant gap.
  if (clean.length >= 2 && clean.every((v) => typeof v === "number")) {
    const nums = clean as number[];
    const step = nums[1] - nums[0];
    const constant = nums.every((n, i) => i === 0 || n - nums[i - 1] === step);
    if (constant && step !== 0) {
      let next = nums[nums.length - 1];
      for (let i = 0; i < count; i += 1) { next += step; out.push(next); }
      return out;
    }
  }

  // Text ending in a number: "Hari 1" -> "Hari 2". A single cell counts, because that's the common
  // case — but only when there IS a prefix.
  if (clean.length >= 1 && clean.every((v) => typeof v === "string")) {
    const strs = clean as string[];
    const m = /^(.*?)(\d+)$/.exec(strs[strs.length - 1]);
    if (m) {
      const prefix = m[1];
      const samePrefix = strs.every((x) => x.startsWith(prefix));
      const step = strs.length >= 2
        ? (Number(/(\d+)$/.exec(strs[strs.length - 1])?.[1]) - Number(/(\d+)$/.exec(strs[strs.length - 2])?.[1]))
        : 1;
      // A lone "100" in a text column is a number written as text, not the start of a series, so it
      // copies — same as Sheets, and same as the number 100 in a number column. Two or more cells
      // still extrapolate even with an empty prefix ("1","2" -> 3,4), because there the user has
      // spelled the pattern out.
      const bareSingle = strs.length === 1 && prefix === "";
      if (samePrefix && !bareSingle && Number.isFinite(step) && step !== 0) {
        let n = Number(m[2]);
        for (let i = 0; i < count; i += 1) { n += step; out.push(`${prefix}${n}`); }
        return out;
      }
    }
  }

  // Otherwise repeat the block.
  for (let i = 0; i < count; i += 1) out.push(source[i % source.length] ?? null);
  return out;
}
