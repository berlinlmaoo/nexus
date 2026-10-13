// Column stats ("Status kolom", Data ▸ Column stats): what Sheets shows for one column — counts, the
// value-frequency table, a count-per-value chart and a numeric histogram. Pure; tested in
// sheet-stats.test.mjs. Like Sheets, hidden and filtered rows are included (the caller passes every row).
import type { CellValue } from "./sheet-formula.ts";

export type StatsInput = { value: CellValue; text: string };
export type FrequencyRow = { text: string; count: number };
export type HistogramBin = { from: number; to: number; count: number };
export type ColumnStats = {
  /** Rows considered (after the ignored header rows). */
  total: number;
  empty: number;
  /** Distinct non-empty shown texts. */
  unique: number;
  /** How many cells hold a number. */
  numeric: number;
  sum: number | null;
  avg: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Most frequent first; ties in natural (numeric-aware) order. Reverse it for "least frequent". */
  frequency: FrequencyRow[];
  /** One bar per distinct value, in natural order (the "Count" chart). */
  counts: FrequencyRow[];
  /** Histogram of the numeric values (the "Distribution" chart); empty when there are none. */
  distribution: HistogramBin[];
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const isEmpty = (x: StatsInput) => x.value === null || x.value === "" || x.text.trim() === "";

/** Stats for one column's values (top to bottom), skipping the first `ignoreRows` rows. */
export function columnStats(values: StatsInput[], ignoreRows = 0): ColumnStats {
  const rows = values.slice(Math.max(0, Math.floor(ignoreRows)));
  const freq = new Map<string, number>();
  const numbers: number[] = [];
  let empty = 0;
  for (const x of rows) {
    if (isEmpty(x)) { empty += 1; continue; }
    freq.set(x.text, (freq.get(x.text) ?? 0) + 1);
    if (typeof x.value === "number" && Number.isFinite(x.value)) numbers.push(x.value);
  }
  const entries = [...freq].map(([text, count]) => ({ text, count }));
  // Numbers sort by value, not by their formatted text ("1.000" after "200").
  const numOf = new Map<string, number>();
  for (const x of rows) if (!isEmpty(x) && typeof x.value === "number") numOf.set(x.text, x.value);
  const byValue = (a: FrequencyRow, b: FrequencyRow) => {
    const na = numOf.get(a.text), nb = numOf.get(b.text);
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1;
    if (nb !== undefined) return 1;
    return collator.compare(a.text, b.text);
  };
  const natural = [...entries].sort(byValue);
  const frequency = [...natural].sort((a, b) => b.count - a.count);

  const sorted = [...numbers].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = n ? sorted.reduce((s, v) => s + v, 0) : null;
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
  return {
    total: rows.length,
    empty,
    unique: freq.size,
    numeric: n,
    sum,
    avg: n && sum !== null ? sum / n : null,
    median,
    min: n ? sorted[0] : null,
    max: n ? sorted[n - 1] : null,
    frequency,
    counts: natural,
    distribution: histogram(sorted),
  };
}

/** Equal-width bins (Sturges' rule, at most 20); one bin when every value is the same. */
export function histogram(values: number[]): HistogramBin[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  let min = Infinity, max = -Infinity;
  for (const x of v) { if (x < min) min = x; if (x > max) max = x; }
  if (min === max) return [{ from: min, to: max, count: v.length }];
  const k = Math.min(20, Math.max(1, Math.ceil(Math.log2(v.length) + 1)));
  const width = (max - min) / k;
  const bins: HistogramBin[] = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: i === k - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const x of v) bins[Math.min(k - 1, Math.floor((x - min) / width))].count += 1;
  return bins;
}
