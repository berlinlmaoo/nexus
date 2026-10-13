// node --experimental-strip-types src/lib/sheet-pivot.test.mjs   (from apps/web)
//
// Pivot tables: grouping (multi-level, ordering), subtotals and grand totals, every summarise
// function, "show as" percentages, filters, suggestions and the distinct values of a field.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const P = await import("./sheet-pivot.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }
const near = (a, b, msg) => { assert.ok(typeof a === "number" && Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`); n++ }

// The sheet from the Sheets run (r36): Nama, Kategori, Jumlah, Tanggal, Status.
const cols = ["cn", "ck", "cj", "ct", "cs"]
const table = [
  ["Nama", "Kategori", "Jumlah", "Tanggal", "Status"],
  ["Apel", "Buah", 12, "2026-10-01", "Baru"],
  ["Bayam", "Sayur", 5, "2026-10-03", "Proses"],
  ["Ceri", "Buah", 30, "2026-10-05", "Selesai"],
  ["Durian", "Buah", 2, "2026-10-02", "Baru"],
  ["Edamame", "Sayur", 18, "2026-10-08", "Proses"],
  ["Apel", "Buah", 12, "2026-10-01", "Baru"],
  ["Fig", "Buah", 7, "2026-10-09", "Selesai"],
]
function makeSrc(rowsData, colIds = cols, types = new Map([["ct", "date"]])) {
  const rowIds = rowsData.map((_, i) => `r${i + 1}`)
  const cells = new Map()
  rowsData.forEach((r, i) => {
    const rec = {}
    r.forEach((v, j) => { if (v !== null && v !== undefined) rec[colIds[j]] = v })
    cells.set(rowIds[i], rec)
  })
  const data = { shape: { columnIds: colIds, rowIds }, cells, types }
  return { data, engine: F.engineFor(data), headerOf: (c) => `Column ${c}` }
}
const src = makeSrc(table)
const RANGE = "{cn!r1}:{cs!r8}"
const spec = (over) => ({ source: "s1", range: RANGE, rows: [], cols: [], values: [], filters: [], ...over })
const pv = (over) => P.computePivot(spec(over), src)

// ── Single row group, SUM ───────────────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck" }], values: [{ colId: "cj", fn: "SUM" }] })
  eq(r.grid[0], ["Kategori", "SUM of Jumlah"], "header: row field name + value label")
  eq(r.grid[1], ["Buah", 63], "Buah sum")
  eq(r.grid[2], ["Sayur", 23], "Sayur sum")
  eq(r.grid[3], ["Grand Total", 86], "grand total row")
  eq(r.formats[1], [null, "num"], "value cells are numbers")
  eq(r.error, undefined, "no error")
}

// ── Desc order ──────────────────────────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck", order: "desc" }], values: [{ colId: "cj", fn: "SUM" }] })
  eq(r.grid.map((x) => x[0]), ["Kategori", "Sayur", "Buah", "Grand Total"], "descending groups")
}

// ── Rows + columns ──────────────────────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck" }], cols: [{ colId: "cs" }], values: [{ colId: "cj", fn: "SUM" }] })
  eq(r.grid[0], ["SUM of Jumlah", "Status", null, null, null], "top row: value label + column field")
  eq(r.grid[1], ["Kategori", "Baru", "Proses", "Selesai", "Grand Total"], "column values + grand total column")
  eq(r.grid[2], ["Buah", 26, null, 37, 63], "Buah across statuses (empty intersection = blank)")
  eq(r.grid[3], ["Sayur", null, 23, null, 23], "Sayur across statuses")
  eq(r.grid[4], ["Grand Total", 26, 23, 37, 86], "grand total row")
  eq(r.grid.every((row) => row.length === 5), true, "rectangular")
}

// ── Multi-level rows with subtotals ─────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck" }, { colId: "cs" }], values: [{ colId: "cj", fn: "SUM" }] })
  eq(r.grid.map((x) => x.slice(0, 3)), [
    ["Kategori", "Status", "SUM of Jumlah"],
    ["Buah", "Baru", 26],
    [null, "Selesai", 37],
    ["Buah Total", null, 63],
    ["Sayur", "Proses", 23],
    ["Sayur Total", null, 23],
    ["Grand Total", null, 86],
  ], "two row levels with subtotals")
  const noSub = pv({ rows: [{ colId: "ck", totals: false }, { colId: "cs" }], values: [{ colId: "cj", fn: "SUM" }] })
  eq(noSub.grid.length, 4, "totals off: no subtotals and no grand total")
}

// ── Every summarise function (Jumlah: 12 5 30 2 18 12 7) ───────────────────────────────────────
{
  const one = (fn, colId = "cj") => pv({ values: [{ colId, fn }] }).grid[1][0]
  eq(one("SUM"), 86, "SUM")
  eq(one("COUNTA", "cn"), 7, "COUNTA")
  eq(one("COUNT"), 7, "COUNT")
  eq(one("COUNT", "cn"), 0, "COUNT of text")
  eq(one("COUNTUNIQUE", "cn"), 6, "COUNTUNIQUE (Apel twice)")
  near(one("AVERAGE"), 86 / 7, "AVERAGE")
  eq(one("MAX"), 30, "MAX")
  eq(one("MIN"), 2, "MIN")
  eq(one("MEDIAN"), 12, "MEDIAN")
  eq(one("PRODUCT"), 12 * 5 * 30 * 2 * 18 * 12 * 7, "PRODUCT")
  const xs = [12, 5, 30, 2, 18, 12, 7], m = 86 / 7
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0)
  near(one("VAR"), ss / 6, "VAR")
  near(one("VARP"), ss / 7, "VARP")
  near(one("STDEV"), Math.sqrt(ss / 6), "STDEV")
  near(one("STDEVP"), Math.sqrt(ss / 7), "STDEVP")
  eq(one("AVERAGE", "cn"), "#DIV/0!", "AVERAGE of no numbers")
  eq(pv({ values: [{ colId: "cj", fn: "SUM" }] }).grid[0], ["SUM of Jumlah"], "values only: one header")
}

// ── Show as ─────────────────────────────────────────────────────────────────────────────────────
{
  const base = { rows: [{ colId: "ck" }], cols: [{ colId: "cs" }] }
  const total = pv({ ...base, values: [{ colId: "cj", fn: "SUM", showAs: "total" }] })
  near(total.grid[2][1], 26 / 86, "% of grand total")
  eq(total.grid[4][4], 1, "grand total = 100%")
  eq(total.formats[2][1], "pct", "pct format")
  const row = pv({ ...base, values: [{ colId: "cj", fn: "SUM", showAs: "row" }] })
  near(row.grid[2][1], 26 / 63, "% of row")
  eq(row.grid[3][4], 1, "row total = 100%")
  const col = pv({ ...base, values: [{ colId: "cj", fn: "SUM", showAs: "col" }] })
  near(col.grid[2][1], 1, "% of column (Baru all Buah)")
  near(col.grid[4][4], 1, "column grand total")
}

// ── Multiple values with columns: value label row ───────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck" }], cols: [{ colId: "cs" }], values: [{ colId: "cj", fn: "SUM" }, { colId: "cn", fn: "COUNTA" }] })
  eq(r.grid[2].slice(0, 3), ["Kategori", "SUM of Jumlah", "COUNTA of Nama"], "value labels row")
  eq(r.grid[3].slice(0, 3), ["Buah", 26, 3], "two values per status")
  eq(r.grid[0].length, 1 + 4 * 2, "width = labels + columns × values")
}

// ── Filters ─────────────────────────────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "ck" }], values: [{ colId: "cj", fn: "SUM" }], filters: [{ colId: "cs", hidden: ["Baru"] }] })
  eq(r.grid.map((x) => x[1]), ["SUM of Jumlah", 37, 23, 60], "Baru rows filtered out")
  const all = pv({ rows: [{ colId: "ck" }], values: [{ colId: "cj", fn: "SUM" }], filters: [{ colId: "cs", hidden: ["Baru", "Proses", "Selesai"] }] })
  eq(all.grid, [["Kategori", "SUM of Jumlah"], ["Grand Total", null]], "everything hidden: header and an empty Grand Total")
}

// ── No values: just the group labels ────────────────────────────────────────────────────────────
{
  const r = pv({ rows: [{ colId: "cs" }] })
  eq(r.grid, [["Status"], ["Baru"], ["Proses"], ["Selesai"]], "labels only, no totals")
  const rc = pv({ rows: [{ colId: "ck" }], cols: [{ colId: "cs" }] })
  eq(rc.grid[1], ["Kategori", "Baru", "Proses", "Selesai"], "column labels without grand total")
  eq(pv({}).grid, [], "empty spec = empty grid")
}

// ── Number vs text ordering, dates ──────────────────────────────────────────────────────────────
{
  const s = makeSrc([["K", "V"], [10, 1], ["b", 1], [9, 1], ["A", 1], [null, 1], [100, 1]], ["ca", "cb"], new Map())
  const r = P.computePivot({ source: "s", range: "{ca!r1}:{cb!r7}", rows: [{ colId: "ca" }], cols: [], values: [{ colId: "cb", fn: "SUM" }], filters: [] }, s)
  eq(r.grid.map((x) => x[0]), ["K", 9, 10, 100, "A", "b", "", "Grand Total"], "numbers numeric first, text by locale, blanks last")
  const d = pv({ rows: [{ colId: "ct" }], values: [{ colId: "cj", fn: "COUNT" }] })
  eq(typeof d.grid[1][0], "string", "date group label shown as a date")
  eq(d.grid.length, 8, "6 distinct dates + header + total")
}

// ── Empty / invalid range, header fallback, too many columns ────────────────────────────────────
{
  eq(P.computePivot(spec({ range: "{zz!r1}:{cs!r8}" }), src).error, "invalid range", "bad range")
  const s = makeSrc([["", "V"], ["x", 1]], ["ca", "cb"], new Map())
  eq(P.computePivot({ source: "s", range: "{ca!r1}:{cb!r2}", rows: [{ colId: "ca" }], cols: [], values: [], filters: [] }, s).grid[0], ["Column ca"], "blank header falls back to headerOf")
  const h = makeSrc([["K", "V"]], ["ca", "cb"], new Map())
  eq(P.computePivot({ source: "s", range: "{ca!r1}:{cb!r1}", rows: [{ colId: "ca" }], cols: [], values: [{ colId: "cb", fn: "SUM" }], filters: [] }, h).grid, [["K", "SUM of V"], ["Grand Total", null]], "header-only range: empty Grand Total like Sheets")
  const wide = makeSrc([["K", "V"], ...Array.from({ length: 60 }, (_, i) => [`k${i}`, i])], ["ca", "cb"], new Map())
  const w = P.computePivot({ source: "s", range: "{ca!r1}:{cb!r61}", rows: [], cols: [{ colId: "ca" }], values: [{ colId: "cb", fn: "SUM" }], filters: [] }, wide)
  eq(w.error, "too many columns", "column cap")
  eq(w.grid.every((r) => r.length === 50), true, "truncated to 50")
}

// ── Distinct values & suggestions ───────────────────────────────────────────────────────────────
{
  eq(P.distinctFieldValues(src, RANGE, "cs"), ["Baru", "Proses", "Selesai"], "distinct statuses")
  eq(P.distinctFieldValues(src, RANGE, "cn").length, 6, "distinct names")
  eq(P.distinctFieldValues(src, RANGE, "zz"), [], "unknown field")
  eq(P.pivotFields(src, RANGE).map((f) => f.label), ["Nama", "Kategori", "Jumlah", "Tanggal", "Status"], "fields")
  const sug = P.pivotSuggestions(src, RANGE)
  eq(sug.length, 4, "four suggestions")
  eq(sug[0].label, "SUM of Jumlah for each Nama", "first suggestion")
  eq(sug[1].template, "SUM of {value} for each {row} by {col}", "template with column")
  eq(sug[1].vars, { value: "Jumlah", row: "Nama", col: "Kategori" }, "vars")
  const applied = P.computePivot({ ...spec({}), ...sug[1].spec }, src)
  eq(applied.grid[1].slice(0, 3), ["Nama", "Buah", "Sayur"], "suggestion spec computes")
  eq(P.pivotSuggestions(src, "{cn!r1}:{cs!r1}"), [], "no data rows, no suggestions")
}

console.log(`sheet-pivot: ${n} assertions passed`)
