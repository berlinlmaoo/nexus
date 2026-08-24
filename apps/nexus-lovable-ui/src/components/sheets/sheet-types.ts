import type { NexusSheetCellValue, NexusSheetColumn, NexusSheetColumnType, NexusSheetRow, NexusSheetRule } from "@/lib/nexus-api";
import { evaluateCell, isError, isFormulaCell, toDisplay, type SheetData, type SheetShape } from "@/lib/sheet-formula";

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
export const COLUMN_COLOR_LABEL: Record<string, string> = {
  rose: "Merah", amber: "Kuning", green: "Hijau", blue: "Biru", violet: "Ungu", slate: "Abu",
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

export const COLUMN_TYPE_LABEL: Record<NexusSheetColumnType, string> = {
  text: "Teks",
  number: "Angka",
  currency: "Rupiah",
  date: "Tanggal",
  select: "Pilihan",
  multiselect: "Pilihan ganda",
  checkbox: "Centang",
  task: "Task",
  link: "Link",
};

export const RULE_OP_LABEL: Record<NexusSheetRule["op"], string> = {
  gt: "lebih dari", lt: "kurang dari", gte: "≥", lte: "≤",
  eq: "sama dengan", neq: "tidak sama dengan", contains: "mengandung",
  empty: "kosong", notEmpty: "ada isinya",
};

/** Tailwind classes per style. Kept here so the rule editor and the cell agree on the swatches. */
export const RULE_STYLE_CLASS: Record<NexusSheetRule["style"], string> = {
  red: "bg-rose-100 text-rose-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  blue: "bg-sky-100 text-sky-800",
  grey: "bg-muted text-muted-foreground",
  bold: "font-black",
};

/**
 * First matching rule wins. Comparison is numeric when both sides look numeric, otherwise text —
 * so a rule like "lebih dari 1000000" behaves on a Rupiah column and "mengandung batal" on a text one.
 */
export function matchRule(rules: NexusSheetRule[] | undefined, value: NexusSheetCellValue | undefined): NexusSheetRule | null {
  if (!rules?.length) return null;
  const empty = value === undefined || value === null || value === "";
  for (const rule of rules) {
    if (rule.op === "empty") { if (empty) return rule; continue; }
    if (rule.op === "notEmpty") { if (!empty) return rule; continue; }
    if (empty) continue;
    const target = rule.value ?? "";
    const bothNumeric = typeof value === "number" && target !== "" && Number.isFinite(Number(target));
    if (rule.op === "contains") {
      if (String(value).toLowerCase().includes(target.toLowerCase())) return rule;
      continue;
    }
    if (bothNumeric) {
      const a = value as number;
      const b = Number(target);
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

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** Build the evaluation context once per render, not once per cell. */
export function buildSheetData(columns: NexusSheetColumn[], rows: NexusSheetRow[]): SheetData {
  return {
    shape: { columnIds: columns.map((c) => c.id), rowIds: rows.map((r) => r.id) },
    cells: new Map(rows.map((r) => [r.id, r.cells as Record<string, unknown>])),
  };
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

/** A formula cell shows its RESULT; everything else shows itself. */
export function displayCell(
  type: NexusSheetColumnType,
  raw: unknown,
  ctx: { data: SheetData; rowId: string; colId: string } | null,
): string {
  // The label is what a link READS as — sorting, filtering, find & replace and the footer counts all
  // go through here, so they all see the text rather than a URL nobody typed.
  if (Array.isArray(raw)) return raw.join(", ");
  if (isLinkCell(raw)) return raw.t || raw.u;
  if (isFormulaCell(raw)) {
    if (!ctx) return raw.f;
    const v = evaluateCell(ctx.data, ctx.rowId, ctx.colId);
    // Errors print as-is (#REF!, #CYCLE!) — formatting them as Rupiah would hide the problem.
    if (isError(v)) return v;
    return formatCell(type, v as NexusSheetCellValue);
  }
  return formatCell(type, raw as NexusSheetCellValue | undefined);
}

/** What goes in the editor for a formula cell: the A1 form, translated from the stored ids. */
export function editFormula(raw: unknown, shape: SheetShape): string | null {
  return isFormulaCell(raw) ? toDisplay(raw.f, shape) : null;
}

/** What a cell shows when it's NOT being edited. */
export function formatCell(type: NexusSheetColumnType, value: NexusSheetCellValue | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  switch (type) {
    case "currency":
      return typeof value === "number" ? `Rp ${idr.format(value)}` : String(value);
    case "number":
      return typeof value === "number" ? idr.format(value) : String(value);
    case "date": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
    }
    case "checkbox":
      return value ? "✓" : "";
    default:
      return String(value);
  }
}

/** What goes INTO the input when editing — raw, so numbers stay editable. */
export function editValue(type: NexusSheetColumnType, value: NexusSheetCellValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (type === "checkbox") return value ? "true" : "";
  // Multi-select round-trips as a comma list, which is also what a paste from Excel looks like.
  if (Array.isArray(value)) return (value as unknown as string[]).join(", ");
  return String(value);
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

export type Aggregate = { sum: number; avg: number; filled: number; count: number };

/** Footer aggregates, computed client-side from the loaded rows. */
export function aggregate(rows: NexusSheetRow[], col: NexusSheetColumn, data?: SheetData): Aggregate {
  let sum = 0;
  let numeric = 0;
  let filled = 0;
  for (const r of rows) {
    let v: unknown = r.cells[col.id];
    // A formula's RESULT is what the column total should count — otherwise a sheet full of
    // computed line totals shows a footer of 0.
    if (isFormulaCell(v)) v = data ? evaluateCell(data, r.id, col.id) : null;
    if (v === undefined || v === null || v === "" || isError(v)) continue;
    filled += 1;
    if (typeof v === "number") { sum += v; numeric += 1; }
  }
  return { sum, avg: numeric ? sum / numeric : 0, filled, count: rows.length };
}

/**
 * Work out what dragging the fill handle should produce.
 *
 * Copies the source block, except when it looks like a series — 1,2,3 or 10,20,30 or "Hari 1","Hari 2"
 * — in which case it continues the series, which is the whole reason people drag the handle.
 */
export function fillValues(source: (NexusSheetCellValue | undefined)[], count: number): (NexusSheetCellValue | null)[] {
  const clean = source.filter((v) => v !== undefined && v !== null && v !== "") as NexusSheetCellValue[];
  const out: (NexusSheetCellValue | null)[] = [];

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
  for (let i = 0; i < count; i += 1) out.push((source[i % source.length] ?? null) as NexusSheetCellValue | null);
  return out;
}
