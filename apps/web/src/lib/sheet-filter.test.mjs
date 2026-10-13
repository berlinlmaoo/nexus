// node --experimental-strip-types src/lib/sheet-filter.test.mjs   (from apps/web)
//
// Basic filter: header row stays, values / condition / colour criteria, slicers AND-ed, sorting.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const X = await import("./sheet-filter.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const shape = { columnIds: ["nama", "kat", "jml"], rowIds: ["h", "r1", "r2", "r3", "r4", "r5", "x"] }
const cells = new Map([
  ["h", { nama: "Nama", kat: "Kategori", jml: "Jumlah" }],
  ["r1", { nama: "Apel", kat: "Buah", jml: 12 }],
  ["r2", { nama: "Bayam", kat: "Sayur", jml: 5 }],
  ["r3", { nama: "Ceri", kat: "Buah", jml: 30 }],
  ["r4", { nama: "Durian", kat: "", jml: 2 }],
  ["r5", { nama: "edamame", kat: "Sayur", jml: 18 }],
  ["x", { nama: "outside" }],
])
const engine = new F.SheetEngine({ shape, cells })
const display = (r, c) => { const v = engine.value(r, c); return v === null ? "" : String(v) }
const styles = { r1: { kat: { bg: "#B7E1CD" } }, r3: { kat: { bg: "#b7e1cd", fc: "#ff0000" } } }
const styleOf = (r, c) => styles[r]?.[c]
const range = "{nama!h}:{jml!r5}"
const opts = { shape, engine, display, styleOf }
const hidden = (criteria, extra = {}) => [...X.applyFilter({ range, criteria }, { ...opts, ...extra }).hidden].sort()

{
  const res = X.applyFilter({ range }, opts)
  eq(res.headerRow, 0, "header row is the range's first row")
  eq(res.rect, { top: 0, bottom: 5, left: 0, right: 2 }, "range rect")
  eq(res.hidden.size, 0, "no criteria hides nothing")
}
eq(hidden({ kat: { hidden: ["Sayur"] } }), ["r2", "r5"], "hide a value")
eq(hidden({ kat: { hidden: [""] } }), ["r4"], "hide (Blanks)")
eq(hidden({ kat: { hidden: ["Kategori"] } }), [], "the header is never hidden")
eq(hidden({ jml: { cond: { kind: "gt", values: ["10"] } } }), ["r2", "r4"], "filter by condition")
eq(hidden({ jml: { cond: { kind: "between", values: ["5", "18"] } } }), ["r3", "r4"], "between")
eq(hidden({ nama: { cond: { kind: "textStarts", values: ["e"] } } }), ["r1", "r2", "r3", "r4"], "text starts with, case-insensitive")
eq(hidden({ kat: { fill: "#b7e1cd" } }), ["r2", "r4", "r5"], "filter by fill colour (case-insensitive hex)")
eq(hidden({ kat: { text: "#ff0000" } }), ["r1", "r2", "r4", "r5"], "filter by text colour")
eq(hidden({ kat: { hidden: ["Sayur"] }, jml: { cond: { kind: "lt", values: ["20"] } } }), ["r2", "r3", "r5"], "two columns AND")
eq(hidden({}, { slicers: [{ colId: "kat", crit: { hidden: ["Buah"] } }] }), ["r1", "r3"], "slicer criteria")
eq(hidden({ jml: { cond: { kind: "gt", values: ["10"] } } }, { slicers: [{ colId: "kat", crit: { hidden: ["Buah"] } }] }), ["r1", "r2", "r3", "r4"], "slicers AND with the filter")
eq(hidden({ jml: { cond: { kind: "formula", formula: F.toStored("=C2>10", shape) } } }), ["r2", "r4"], "custom formula relative to the first data row")
eq(X.applyFilter({ range: "{zz!h}:{jml!r5}" }, opts).rect, null, "unreadable range")
eq(X.critActive({ hidden: [] }), false, "empty hidden list isn't a filter")
eq(X.critActive({ cond: { kind: "notEmpty" } }), true, "a condition is a filter")

// ── Sorting ─────────────────────────────────────────────────────────────────────────────────────
const body = ["r1", "r2", "r3", "r4", "r5"]
const val = (r, c) => engine.value(r, c)
eq(X.sortedRowIds(body, { colId: "jml", dir: "asc" }, val), ["r4", "r2", "r1", "r5", "r3"], "numbers ascending")
eq(X.sortedRowIds(body, { colId: "jml", dir: "desc" }, val), ["r3", "r5", "r1", "r2", "r4"], "numbers descending")
eq(X.sortedRowIds(body, { colId: "kat", dir: "asc" }, val), ["r1", "r3", "r2", "r5", "r4"], "text ascending, blank last, stable")
eq(X.sortedRowIds(body, { colId: "kat", dir: "desc" }, val), ["r2", "r5", "r1", "r3", "r4"], "descending keeps blanks last")
eq(X.sortedRowIds(body, [{ colId: "kat", dir: "asc" }, { colId: "jml", dir: "desc" }], val), ["r3", "r1", "r5", "r2", "r4"], "two sort keys")
eq(X.sortedRowIds(body, { colId: "nama", dir: "asc" }, val), ["r1", "r2", "r3", "r4", "r5"], "case-insensitive text order")

// ── Distinct values & colours ───────────────────────────────────────────────────────────────────
eq(X.distinctValues(body, "kat", display), [{ text: "", count: 1 }, { text: "Buah", count: 2 }, { text: "Sayur", count: 2 }], "distinct values with (Blanks) first")
eq(X.distinctValues(body, "jml", display).map((x) => x.text), ["2", "5", "12", "18", "30"], "numeric text sorts naturally")
eq(X.colorsInColumn(body, "kat", styleOf), { fills: ["#b7e1cd"], texts: ["#ff0000"] }, "colours present in a column")
eq(X.sortByColor(body, "kat", "#ff0000", "text", styleOf), ["r3", "r1", "r2", "r4", "r5"], "sort by text colour")

console.log(`sheet-filter: ${n} checks passed`)
