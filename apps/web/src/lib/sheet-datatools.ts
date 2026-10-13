// Data tools of the spreadsheet (Google Sheets parity, 12 Oct 2026): sort range, randomise range,
// split text to columns, remove duplicates, trim whitespace, find and replace. Pure functions over
// plain values; the grid decides which cells to read and writes the results back as one edit.
// Tested in sheet-datatools.test.mjs.
import { isError, type CellValue } from "./sheet-formula.ts";

export type Separator = "," | ";" | "." | " " | "\t";
export type SplitSep = "auto" | Separator | { custom: string };

const DETECT_ORDER: Separator[] = [",", ";", "\t", " ", "."];

/**
 * "Detect automatically": the separator found in the most texts (ties go to comma, semicolon, tab,
 * space, period — in that order). null when none of them appears.
 */
export function detectSeparator(texts: string[]): Separator | null {
  let best: Separator | null = null, bestScore = 0;
  const filled = texts.filter((t) => t && t.trim() !== "");
  for (const sep of DETECT_ORDER) {
    const score = filled.filter((t) => t.trim().includes(sep)).length;
    if (score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
}

/**
 * One cell's text split into columns. Parts are trimmed; runs of spaces count as one separator when
 * splitting on space. "auto" detects from this text alone (the grid passes a detected one instead
 * when splitting a whole column).
 */
export function splitText(text: string, sep: SplitSep): string[] {
  const s = text ?? "";
  const actual = sep === "auto" ? detectSeparator([s]) : typeof sep === "object" ? sep.custom : sep;
  if (!actual) return [s];
  if (actual === " ") return s.trim().split(/ +/);
  return s.split(actual).map((p) => p.trim());
}

/**
 * Remove duplicates: which rows to keep (indices into `rows`) comparing the shown text of `cols`
 * exactly (case-sensitive, nothing trimmed). The first occurrence stays. With `header`, row 0 is kept
 * and never compared.
 */
export function dedupe(rows: string[][], cols: number[], opts: { header?: boolean } = {}): { keep: number[]; removed: number } {
  const seen = new Set<string>();
  const keep: number[] = [];
  rows.forEach((row, i) => {
    if (opts.header && i === 0) { keep.push(i); return; }
    const key = cols.map((c) => row[c] ?? "").join("\u0001");
    if (seen.has(key)) return;
    seen.add(key);
    keep.push(i);
  });
  return { keep, removed: rows.length - keep.length };
}

/** Trim whitespace like Sheets: outer whitespace removed, inner runs of spaces collapsed to one. */
export function trimCell(text: string): string {
  return (text ?? "").replace(/[  ]+/g, " ").replace(/^\s+|\s+$/g, "");
}

/** Rank of a value in an ascending sort: numbers, then text, then booleans, then errors; empty last. */
const rank = (v: CellValue): number => {
  if (v === null || v === "") return 9;
  if (isError(v)) return 3;
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return 2;
  return 1;
};
const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

/** Compare two cell values for sorting. Empty cells always go last, whatever the direction. */
export function compareValues(a: CellValue, b: CellValue, dir: "asc" | "desc" = "asc"): number {
  const ra = rank(a), rb = rank(b);
  if (ra === 9 || rb === 9) return ra === rb ? 0 : ra === 9 ? 1 : -1;
  let d = 0;
  if (ra !== rb) d = ra - rb;
  else if (ra === 0) d = (a as number) - (b as number);
  else if (ra === 2) d = Number(a) - Number(b);
  else d = collator.compare(String(a), String(b));
  return dir === "desc" ? -d : d;
}

/** A stable multi-key sort: returns the new order as indices into `rows`. */
export function sortBlock(rows: { key: CellValue[] }[], keys: { idx: number; dir: "asc" | "desc" }[]): number[] {
  const order = rows.map((_, i) => i);
  order.sort((i, j) => {
    for (const k of keys) {
      const d = compareValues(rows[i].key[k.idx] ?? null, rows[j].key[k.idx] ?? null, k.dir);
      if (d) return d;
    }
    return i - j;
  });
  return order;
}

/** Randomise range: a random permutation of 0…n-1 (Fisher–Yates). */
export function shuffle(n: number, rng: () => number = Math.random): number[] {
  const out = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Find and replace ────────────────────────────────────────────────────────────────────────────

export type MatchOpts = { find: string; matchCase?: boolean; entire?: boolean; regex?: boolean };

/** The search as a global RegExp; null for an empty search or an invalid regular expression. */
export function buildMatcher(o: MatchOpts): RegExp | null {
  if (!o.find) return null;
  const body = o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(o.entire ? `^(?:${body})$` : body, o.matchCase ? "g" : "gi");
  } catch {
    return null;
  }
}

/** Does a cell's text match? */
export function textMatches(text: string, o: MatchOpts): boolean {
  const re = buildMatcher(o);
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text ?? "");
}

/**
 * Replace every match in one cell's text. With regex on, "$1" in the replacement refers to groups
 * (as in Sheets). Returns the new text and how many matches were replaced.
 */
export function replaceText(text: string, o: MatchOpts & { replace: string }): { text: string; count: number } {
  const re = buildMatcher(o);
  if (!re) return { text, count: 0 };
  let count = 0;
  const out = (text ?? "").replace(re, (...args: unknown[]) => {
    count += 1;
    if (!o.regex) return o.replace;
    const rest = args.slice(1);
    if (typeof rest[rest.length - 1] === "object") rest.pop(); // named groups
    rest.splice(-2, 2); // offset, whole string
    const groups = rest as (string | undefined)[];
    return o.replace.replace(/\$(\d+|&)/g, (_, g: string) => (g === "&" ? String(args[0]) : groups[Number(g) - 1] ?? ""));
  });
  return { text: out, count };
}
