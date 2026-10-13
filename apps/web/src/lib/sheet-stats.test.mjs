// node --experimental-strip-types src/lib/sheet-stats.test.mjs   (from apps/web)
//
// Column stats: counts, frequency table order, numeric totals, ignored header rows, histogram.
import assert from "node:assert/strict"

const S = await import("./sheet-stats.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const num = (v) => ({ value: v, text: String(v) })
const txt = (t) => ({ value: t, text: t })
const blank = { value: null, text: "" }

// The Sheets sample: header "Jumlah", then 12 5 30 2 18 12 7, then empties.
const col = [txt("Jumlah"), num(12), num(5), num(30), num(2), num(18), num(12), num(7), blank, blank]
{
  const s = S.columnStats(col, 0)
  eq(s.total, 10, "total rows")
  eq(s.empty, 2, "empty cells")
  eq(s.unique, 7, "unique incl. the header text")
  eq(s.numeric, 7, "numeric count")
  eq(s.sum, 86, "sum")
  eq(Math.round(s.avg * 1e8) / 1e8, 12.28571429, "average")
  eq(s.median, 12, "median (odd)")
  eq(s.min, 2, "min")
  eq(s.max, 30, "max")
  eq(s.frequency[0], { text: "12", count: 2 }, "most frequent first")
  eq(s.counts.map((x) => x.text), ["2", "5", "7", "12", "18", "30", "Jumlah"], "counts: numbers by value, then text")
}
{
  const s = S.columnStats(col, 1)
  eq(s.total, 9, "ignore 1 header row")
  eq(s.unique, 6, "header no longer counted")
  eq(S.columnStats(col, 100).total, 0, "ignore more rows than exist")
  eq(S.columnStats(col, 100).sum, null, "no numbers → sum null")
}
{
  const s = S.columnStats([num(1), num(2), num(3), num(4)])
  eq(s.median, 2.5, "median (even)")
  const t = S.columnStats([txt("b"), txt("a"), txt("b"), txt("c"), { value: "", text: "" }])
  eq(t.frequency.map((x) => x.text), ["b", "a", "c"], "ties in natural order")
  eq(t.empty, 1, "empty string counts as empty")
  eq(t.distribution, [], "no histogram for text")
}
{
  eq(S.histogram([]), [], "empty histogram")
  eq(S.histogram([5, 5, 5]), [{ from: 5, to: 5, count: 3 }], "one bin when all equal")
  const h = S.histogram([2, 5, 30, 2, 18, 12, 7, 12])
  eq(h.reduce((a, b) => a + b.count, 0), 8, "every value lands in a bin")
  eq(h[0].from, 2, "first bin starts at min")
  eq(h[h.length - 1].to, 30, "last bin ends at max")
  eq(h.length, 4, "Sturges: ceil(log2 8 + 1) = 4 bins")
}

console.log(`sheet-stats: ${n} checks passed`)
