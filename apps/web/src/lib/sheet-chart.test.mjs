// node --experimental-strip-types src/lib/sheet-chart.test.mjs   (from apps/web)
//
// Charts: ranges -> categories and series (headers, labels, switched rows/columns, aggregate,
// several ranges), Insert ▸ Chart's pick, histogram buckets and waterfall steps, range editing.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const C = await import("./sheet-chart.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const cols = ["ca", "cb", "cc", "cd", "ce"]
const sheet = (rows, types) => {
  const rowIds = rows.map((_, i) => `r${i + 1}`)
  const cells = new Map(rows.map((row, i) => [rowIds[i], Object.fromEntries(row.map((v, j) => [cols[j], v]).filter(([, v]) => v !== undefined))]))
  const data = { shape: { columnIds: cols, rowIds }, cells, types: types ? new Map(Object.entries(types)) : undefined }
  return { data, engine: new F.SheetEngine(data), shape: data.shape }
}
const R = (a, b) => `{${a}}:{${b}}` // R("ca!r1", "cc!r8")

// The inventory's example: Nama | Kategori | Jumlah.
const fruit = sheet([
  ["Nama", "Kategori", "Jumlah", "Tanggal"],
  ["Apel", "Buah", 12, "2026-10-01"],
  ["Bayam", "Sayur", 5, "2026-10-03"],
  ["Ceri", "Buah", 30, "2026-10-05"],
  ["Apel", "Buah", { f: F.toStored("=C2/2", { columnIds: cols, rowIds: ["r1", "r2", "r3", "r4", "r5"] }) }, "2026-10-02"],
], { cd: "date" })

{
  const d = C.chartData({ ranges: [R("ca!r1", "cc!r5")] }, fruit.data, fruit.engine)
  eq(d.headerRow, true, "row 1 detected as header (text over numbers)")
  eq(d.labels, true, "column A detected as labels (text)")
  eq(d.categories, ["Apel", "Bayam", "Ceri", "Apel"], "categories from column A")
  eq(d.series.map((s) => s.name), ["Jumlah"], "text-only column B is not a series")
  eq(d.series[0].values, [12, 5, 30, 6], "values include formula results")
  eq(d.series[0].source, 2, "series source column")
  eq(d.xName, "Nama", "x-axis chip name")
  eq(d.empty, false, "not empty")
}
{
  const d = C.chartData({ ranges: [R("ca!r1", "cc!r5")], headers: false }, fruit.data, fruit.engine)
  eq(d.categories[0], "Nama", "headers off: row 1 is data")
  eq(d.series[0].name, "C", "headers off: series named after its column")
  eq(d.series[0].values[0], null, "non-numeric value -> null")
}
{
  const d = C.chartData({ ranges: [R("ca!r1", "cc!r5")], labels: false }, fruit.data, fruit.engine)
  eq(d.categories, ["1", "2", "3", "4"], "labels off: categories are row numbers")
  eq(d.labels, false, "labels flag")
}
{
  const d = C.chartData({ ranges: [R("ca!r1", "cc!r5")], aggregate: "sum" }, fruit.data, fruit.engine)
  eq(d.categories, ["Apel", "Bayam", "Ceri"], "aggregate: distinct categories in order")
  eq(d.series[0].values, [18, 5, 30], "aggregate sum")
  const avg = C.chartData({ ranges: [R("ca!r1", "cc!r5")], aggregate: "avg" }, fruit.data, fruit.engine)
  eq(avg.series[0].values, [9, 5, 30], "aggregate average")
  const cnt = C.chartData({ ranges: [R("ca!r1", "cc!r5")], aggregate: "count" }, fruit.data, fruit.engine)
  eq(cnt.series[0].values, [2, 1, 1], "aggregate count")
  eq(C.chartData({ ranges: [R("ca!r1", "cc!r5")], aggregate: "max" }, fruit.data, fruit.engine).series[0].values, [12, 5, 30], "aggregate max")
}
{
  // Dates as labels read the way the cells show them.
  const d = C.chartData({ ranges: [R("cd!r1", "cd!r5"), R("cc!r1", "cc!r5")] }, fruit.data, fruit.engine)
  eq(d.xKind, "date", "date x-axis")
  eq(d.categories[0], F.formatDateSerial(F.ymdToSerial(2026, 10, 1)), "date category text uses the cell format")
  eq(d.series[0].name, "Jumlah", "multi-range: second range is the series")
  eq(d.series[0].values, [12, 5, 30, 6], "multi-range values side by side")
}

// Switch rows/columns.
const wide = sheet([
  ["", "Q1", "Q2", "Q3"],
  ["Venue", 10, 20, 30],
  ["Talent", 1, 2, 3],
])
{
  const d = C.chartData({ ranges: [R("ca!r1", "cd!r3")] }, wide.data, wide.engine)
  eq(d.series.map((s) => s.name), ["Q1", "Q2", "Q3"], "unswitched: columns are series")
  const t = C.chartData({ ranges: [R("ca!r1", "cd!r3")], transpose: true }, wide.data, wide.engine)
  eq(t.categories, ["Q1", "Q2", "Q3"], "switched: row 1 becomes the x-axis")
  eq(t.series.map((s) => s.name), ["Venue", "Talent"], "switched: rows are series")
  eq(t.series[0].values, [10, 20, 30], "switched values")
  eq(t.series[1].source, 2, "switched series source is the sheet row")
}

// Empty / invalid.
{
  const blank = sheet([[], []])
  eq(C.chartData({ ranges: [R("ca!r1", "cb!r2")] }, blank.data, blank.engine).empty, true, "empty range")
  eq(C.chartData({ ranges: ["{zz!r1}:{zz!r2}"] }, fruit.data, fruit.engine).empty, true, "invalid range")
  eq(C.chartData({ ranges: [] }, fruit.data, fruit.engine).empty, true, "no ranges")
  eq(C.chartData({ ranges: [R("ca!r1", "cb!r5")] }, fruit.data, fruit.engine).empty, true, "text only: nothing to plot")
}

// Insert ▸ Chart.
{
  eq(C.defaultChart({ top: 0, bottom: 4, left: 0, right: 2 }, fruit.data, fruit.engine).type, "column", "repeated labels: column (as Sheets did)")
  eq(C.defaultChart({ top: 1, bottom: 1, left: 2, right: 2 }, fruit.data, fruit.engine).type, "scorecard", "single cell: scorecard")
  const pie = sheet([["Item", "Biaya"], ["Venue", 10], ["Talent", 5], ["Food", 3]])
  eq(C.defaultChart({ top: 0, bottom: 3, left: 0, right: 1 }, pie.data, pie.engine), { type: "pie", headers: true, labels: true }, "one series, few distinct positive slices: pie")
  const neg = sheet([["Item", "Saldo"], ["A", 10], ["B", -5]])
  eq(C.defaultChart({ top: 0, bottom: 2, left: 0, right: 1 }, neg.data, neg.engine).type, "column", "a negative value: column")
  const xy = sheet([["X", "Y"], [1, 2], [2, 4], [3, 9]])
  eq(C.defaultChart({ top: 0, bottom: 3, left: 0, right: 1 }, xy.data, xy.engine), { type: "scatter", headers: true, labels: true }, "numeric x: scatter")
  const days = sheet([["Tanggal", "Sales"], ...Array.from({ length: 12 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, i * 3])], { ca: "date" })
  eq(C.defaultChart({ top: 0, bottom: 12, left: 0, right: 1 }, days.data, days.engine).type, "line", "many dates: line")
}

// Histogram & waterfall.
{
  const bins = C.histogramBins([1, 2, 2, 3, 4, 5, 10, null], 3)
  eq(bins.length, 3, "three buckets")
  eq(bins.map((b) => b.count), [4, 2, 1], "bucket counts")
  eq(bins[2].to, 10, "last bucket ends at the max")
  eq(bins.reduce((a, b) => a + b.count, 0), 7, "every number counted once")
  eq(C.histogramBins([4, 4, 4]), [{ from: 4, to: 4, count: 3 }], "all equal: one bucket")
  eq(C.histogramBins([]), [], "no numbers")
  eq(C.histogramBins(Array.from({ length: 16 }, (_, i) => i)).length, 5, "Sturges' rule")
  const w = C.waterfallSteps([10, -3, null, 5])
  eq(w.map((s) => [s.start, s.end, s.kind]), [[0, 10, "up"], [10, 7, "down"], [7, 7, "up"], [7, 12, "up"], [0, 12, "total"]], "waterfall running total")
  eq(C.waterfallSteps([1, 2], { total: false }).length, 2, "waterfall without total")
}

// Editing ranges.
{
  const shape = fruit.shape
  eq(C.rangesFromA1("Sheet1!A1:C5, E1:E5", shape), [R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], "typed ranges")
  eq(C.rangesFromA1("A1:C5, nope", shape), null, "one bad part fails")
  eq(C.rangesToA1([R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], shape), "A1:C5, E1:E5", "ranges as text")
  eq(C.addSeriesColumn([R("ca!r1", "cc!r5")], 4, shape), [R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], "add series column over the same rows")
  eq(C.removeSeriesSource([R("ca!r1", "cc!r5")], 1, shape), [R("ca!r1", "ca!r5"), R("cc!r1", "cc!r5")], "remove a middle column splits the range")
  eq(C.removeSeriesSource([R("ca!r1", "cc!r5")], 2, shape), [R("ca!r1", "cb!r5")], "remove the last column")
  eq(C.removeSeriesSource(["{ca!*}:{cb!*}"], 1, shape), ["{ca!*}:{ca!*}"], "whole columns stay whole")
  eq(C.removeSeriesSource([R("ca!r1", "cd!r3")], 2, shape, true), [R("ca!r1", "cd!r2")], "switched: remove a row")
}

// Stacking & colours.
{
  eq(C.stackingOf("column100"), "percent", "stacking of 100% column")
  eq(C.withStacking("bar", "standard"), "barStacked", "stacked bar")
  eq(C.withStacking("pie", "standard"), "pie", "pie has no stacking")
  eq(C.seriesColor(1, {}), "#ea4335", "default second colour")
  eq(C.seriesColor(0, { colors: ["#111111"] }, ["#222222"]), "#111111", "own colour wins")
  eq(C.seriesColor(1, { colors: ["#111111"] }, ["#222222", "#333333"]), "#333333", "theme accents next")
}

console.log(`sheet-chart: ${n} checks passed`)
