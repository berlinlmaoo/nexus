// node --experimental-strip-types src/lib/sheet-formula.test.mjs   (from apps/nexus-lovable-ui)
//
// The spreadsheet engine: Indonesian number/date parsing, A1 <-> stored translation, reference
// shifting for copy/paste/fill, range shrinking on delete, formula evaluation (own core + formulajs),
// display formats, and the server's computed view. Also checks the two mirrored copies are identical.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const F = await import("./sheet-formula.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`); n++ }

// ── The two copies must not drift ───────────────────────────────────────────────────────────────
{
  const spa = readFileSync(path.join(here, "sheet-formula.ts"), "utf8").split("\n")
  const srvPath = path.join(here, "../../../../src/lib/sheet-formula.ts")
  let srv = null
  try { srv = readFileSync(srvPath, "utf8").split("\n") } catch { /* SPA checked out alone */ }
  if (srv) {
    eq(spa.length, srv.length, "mirrored sheet-formula.ts: same length")
    spa.forEach((line, i) => { if (i !== 2) assert.equal(line, srv[i], `mirrored sheet-formula.ts differs at line ${i + 1}`) })
    n++
  }
}

// ── Numbers as typed in Indonesia ───────────────────────────────────────────────────────────────
const num = (s) => F.parseLocaleNumber(s)?.n ?? null
eq(num("1.500.000"), 1500000, "dots group thousands")
eq(num("1.500"), 1500, "a single dot + 3 digits groups")
eq(num("1.5"), 1.5, "a single dot + not-3 digits is decimal")
eq(num("0.500"), 0.5, "0.xxx is decimal")
eq(num("1,5"), 1.5, "comma is decimal")
eq(num("1.500.000,50"), 1500000.5, "id full form")
eq(num("1,500,000.50"), 1500000.5, "en full form")
eq(num("(250)"), -250, "accounting negative")
eq(num("-1.234"), -1234, "negative grouped")
eq(num("abc"), null, "text is not a number")
eq(num("1.2.3"), null, "version strings are not numbers")
eq(num("1,"), null, "dangling separator")

const det = (s) => F.detectInput(s)
eq(det("Rp 1.500.000"), { kind: "number", v: 1500000, nf: "idr" }, "Rupiah")
eq(det("Rp1.500.000,-"), { kind: "number", v: 1500000, nf: "idr" }, "Rupiah with ,-")
eq(det("-Rp 5.000"), { kind: "number", v: -5000, nf: "idr" }, "negative Rupiah")
eq(det("IDR 2.500"), { kind: "number", v: 2500, nf: "idr" }, "IDR")
eq(det("15%"), { kind: "number", v: 0.15, nf: "pct" }, "percent")
eq(det("1,5%"), { kind: "number", v: 0.015, nf: "pct" }, "decimal percent")
eq(det("1.500.000"), { kind: "number", v: 1500000, nf: "num" }, "grouped number keeps its format")
eq(det("1500"), { kind: "number", v: 1500, nf: null }, "bare number")
eq(det("1,5"), { kind: "number", v: 1.5, nf: "num" }, "decimal comma")
eq(det("11/10/2026"), { kind: "number", v: F.ymdToSerial(2026, 10, 11), nf: "date" }, "dd/mm/yyyy is day first")
eq(det("11 Okt 2026").v, F.ymdToSerial(2026, 10, 11), "Indonesian month name")
eq(det("2026-10-11").nf, "date", "ISO date")
eq(det("31/02/2026").kind, "text", "impossible date stays text")
eq(det("08123456789").kind, "text", "leading zero stays text (phone)")
eq(det("+6281234567890").kind, "text", "leading + stays text")
eq(det("3201234567890001").kind, "text", "16-digit NIK stays text")
eq(det("abc").kind, "text", "plain text")
eq(det("Q4 2026").kind, "text", "mixed text")
eq(det("  ").kind, "empty", "blank")

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────
eq(F.ymdToSerial(2026, 10, 11), 46306, "serial matches Sheets/Excel")
eq(F.serialToIso(46306), "2026-10-11", "serial back to ISO")
eq(F.formatDateSerial(46306), "11 Okt 2026", "date display")
eq(F.todaySerial(new Date("2026-10-11T17:30:00Z")), F.ymdToSerial(2026, 10, 12), "TODAY is Jakarta: 00:30 WIB is already the 12th")
eq(F.todaySerial(new Date("2026-10-11T16:59:00Z")), F.ymdToSerial(2026, 10, 11), "23:59 WIB is still the 11th")

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────
eq(F.formatValue(1500000, "idr"), "Rp 1.500.000", "Rupiah")
eq(F.formatValue(0.15, "pct"), "15%", "percent")
eq(F.formatValue(1500000, "num"), "1.500.000", "grouped")
eq(F.formatValue(1.5, null), "1,5", "general number uses a decimal comma")
eq(F.editTyped({ v: 1500000, nf: "idr" }), "Rp 1.500.000", "Rupiah edits as typed")
eq(F.detectInput(F.editTyped({ v: 0.125, nf: "pct" })), { kind: "number", v: 0.125, nf: "pct" }, "percent round-trips")
eq(F.detectInput(F.editTyped({ v: 46306, nf: "date" })), { kind: "number", v: 46306, nf: "date" }, "date round-trips")
eq(F.formatScalar("currency", 2500), "Rp 2.500", "currency column")
eq(F.formatScalar("date", "2026-10-11"), "11 Okt 2026", "date column")
eq(F.formatScalar("date", "11/10/2026"), "11 Okt 2026", "date column with a day-first legacy value")
eq(F.formatScalar("text", { v: 1500000, nf: "idr" }), "Rp 1.500.000", "typed cell in a text column")
eq(F.formatScalar("text", { v: 46306, nf: "date" }), "11/10/2026", "a typed date keeps the style it was typed in")
eq(F.detectInput("Rp1.500.000,50"), { kind: "number", v: 1500000.5, nf: "idr" }, "Rp without space, with decimals")
eq(F.detectInput("1.5"), { kind: "number", v: 1.5, nf: "num" }, "1.5 is a decimal, never a date")

// ── A1 <-> stored ───────────────────────────────────────────────────────────────────────────────
const shape = { columnIds: ["ca", "cb", "cc", "cd"], rowIds: ["r1", "r2", "r3", "r4", "r5"] }
eq(F.toStored('=IF(A2="Q4";B2;0)', shape), '=IF({ca!r2}="Q4",{cb!r2},0)', "quoted text is never a reference; stored neutral")
eq(F.toDisplay('=IF({ca!r2}="Q4",{cb!r2}*1.5,0)', shape), '=IF(A2="Q4";B2*1,5;0)', "shown with Indonesian separators")
eq(F.canonicalFormula('=IF(A1>1,"y","n")'), '=IF(A1>1,"y","n")', "',' still separates when it can't be a decimal")
eq(F.canonicalFormula("=SUM(A1,B1)"), "=SUM(A1,B1)", "SUM(A1,B1)")
eq(F.canonicalFormula("=A1*1,5"), "=A1*1.5", "',' between digits is a decimal")
eq(F.canonicalFormula('=IF(A1;"a,b";1,5)'), '=IF(A1,"a,b",1.5)', "';' formula with a decimal comma; commas in strings untouched")
eq(F.canonicalFormula("=IF(A1>1,1,5)"), null, "ambiguous commas are refused")
eq(F.toStored("=IF(A1>1,1,5)", shape), "=?IF({ca!r1}>1,1,5)", "ambiguous formula kept as typed")
eq(F.toDisplay("=?IF({ca!r1}>1,1,5)", shape), "=IF(A1>1,1,5)", "and shown as typed so it can be fixed")
eq(F.localizeFormula("=STDEV.S(A1:A3)+0.5"), "=STDEV.S(A1:A3)+0,5", "dots in function names are not decimals")
eq(F.toStored("=SUM($A$1:A$3)", shape), "=SUM({$ca!$r1}:{ca!$r3})", "$ is kept")
eq(F.toStored("=SUM(B:B)", shape), "=SUM({cb!*}:{cb!*})", "whole column")
eq(F.toStored("=LOG10(A1)", shape), "=LOG10({ca!r1})", "function names with digits are not cells")
eq(F.toStored("=A99", shape), "=A99", "outside the sheet stays A1")
eq(F.toDisplay("=SUM({$ca!$r1}:{ca!$r3})", shape), "=SUM($A$1:A$3)", "display keeps $")
eq(F.toDisplay("=SUM({cb!*}:{cc!*})", shape), "=SUM(B:C)", "whole columns display")
eq(F.toDisplay("={gone!r1}+{ca!gone}", shape), "=#REF!+#REF!", "deleted ids are #REF!")

// ── Relative references on copy/paste/fill ──────────────────────────────────────────────────────
eq(F.shiftFormula("=A1+$B$2+B$3+$C4", 2, 1), "=B3+$B$2+C$3+$C6", "relative parts move, $ parts stay")
eq(F.shiftFormula("=SUM(A1:A3)", 1, 0), "=SUM(A2:A4)", "ranges move")
eq(F.shiftFormula("=A1", -1, 0), "=#REF!", "off the top is #REF!")
eq(F.shiftFormula('=IF(A1="A1";1;0)', 1, 0), '=IF(A2="A1";1;0)', "strings untouched")
eq(F.shiftFormula("=SUM(A:A)", 5, 1), "=SUM(B:B)", "whole column shifts sideways only")
eq(F.r1c1ToA1("=R[0]C[-1]*2", 4, 2), "=B5*2", "Sheets R1C1 relative")
eq(F.r1c1ToA1("=SUM(R1C1:R[-1]C)", 4, 2), "=SUM($A$1:C4)", "Sheets R1C1 absolute and mixed")

// ── Range shrink on delete ──────────────────────────────────────────────────────────────────────
eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, { rows: new Set(["r1"]) }), "=SUM({ca!r2}:{ca!r3})", "top corner deleted")
eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, { rows: new Set(["r3"]) }), "=SUM({ca!r1}:{ca!r2})", "bottom corner deleted")
eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, { rows: new Set(["r1", "r2", "r3"]) }), "=SUM(#REF!)", "everything deleted")
eq(F.rewriteForDeletion("=SUM({ca!r1}:{cc!r3})", shape, { cols: new Set(["cc"]) }), "=SUM({ca!r1}:{cb!r3})", "corner column deleted")
eq(F.rewriteForDeletion("=SUM({ca!r2}:{ca!r3})", shape, { rows: new Set(["r1"]) }), "=SUM({ca!r2}:{ca!r3})", "untouched range")

// ── Evaluation ──────────────────────────────────────────────────────────────────────────────────
/** Build SheetData from an A1 grid; "=…" strings become formulas. */
function sheet(grid, types) {
  const cols = Array.from({ length: Math.max(...grid.map((l) => l.length)) }, (_, i) => `c${i}`)
  const rows = grid.map((_, i) => `r${i}`)
  const shp = { columnIds: cols, rowIds: rows }
  const cells = new Map(grid.map((line, ri) => [rows[ri], Object.fromEntries(line.map((v, ci) => [cols[ci], v])
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => [k, typeof v === "string" && v.startsWith("=") ? { f: F.toStored(v, shp) } : v]))]))
  const data = { shape: shp, cells, types: types ? new Map(cols.map((c, i) => [c, types[i] ?? "text"])) : undefined }
  const e = new F.SheetEngine(data)
  const at = (a1) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1)
    return e.value(rows[Number(m[2]) - 1], cols[F.letterToIndex(m[1])])
  }
  const fmt = (a1) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1)
    return e.format(rows[Number(m[2]) - 1], cols[F.letterToIndex(m[1])])
  }
  return { at, fmt, e, data }
}

{
  const s = sheet([
    [10, "Rp 1.500.000", { v: 2500, nf: "idr" }, "=A1*2"],
    [20, "1.500", "abc", "=SUM(A1:A3)"],
    [30, null, "2026-10-11", "=SUM(A:A)"],
  ])
  eq(s.at("D1"), 20, "arithmetic")
  eq(s.at("D2"), 60, "SUM range")
  eq(s.at("D3"), 60, "A:A whole column")
}
{
  const s = sheet([
    ["Q4", 5, '=IF(A1="Q4";B1*2;0)', '=IF(A1="Q4","y","n")'],
    ["1.500.000", "Rp 2.000", "=SUM(A2:B2)", "=A2+B2"],
    [{ v: 0.1, nf: "pct" }, 200, "=B3*A3", "=50%*B3"],
    ["x", "=1,5*2", "=ROUND(1,005;2)", "=2^3^2", "=IF(A1>1,1,5)"],
  ])
  eq(s.at("C1"), 10, "';' separators and quoted text")
  eq(s.at("D1"), "y", "',' separators still work")
  eq(s.at("C2"), 1502000, "numeric text in a SUM range counts (legacy text columns)")
  eq(s.at("D2"), 1502000, "numeric text in arithmetic")
  near(s.at("C3"), 20, "typed percent")
  eq(s.at("D3"), 100, "% operator")
  eq(s.at("B4"), 3, "'1,5' between digits is a decimal")
  eq(s.at("E4"), F.ERR.error, "ambiguous commas evaluate to #ERROR!")
  eq(s.at("C4"), 1.01, "'1,005' is a decimal in a ';' formula; ROUND is not fooled by float error")
  eq(s.at("D4"), 64, "^ is left-associative like Excel")
}
{
  // C1 = IFERROR(A1;7): A1 is circular but C1 is not part of the loop -> 7.
  const s = sheet([["=B1", "=A1", "=IFERROR(A1;7)"]])
  eq(s.at("C1"), 7, "a cell that only READS a loop can catch its error")
  eq(s.at("A1"), F.ERR.cycle, "the loop itself stays circular in any order")
}
{
  const s = sheet([["=1/0", "=A1+1", "=XYZ(1)", '="a"+1', "=A9"]])
  eq(s.at("A1"), F.ERR.div, "#DIV/0!")
  eq(s.at("B1"), F.ERR.div, "errors propagate")
  eq(s.at("C1"), F.ERR.name, "#NAME?")
  eq(s.at("D1"), F.ERR.value, "#VALUE!")
  eq(s.at("E1"), F.ERR.ref, "reference outside the sheet")
}
{
  // Dates: date column ISO strings are serials; arithmetic and formats follow.
  const s = sheet([
    ["2026-10-01", "2026-10-11", "=B1-A1", "=A1+30", "=TODAY()"],
    ["=EOMONTH(A1;0)", "=NETWORKDAYS(A1;B1)", "=DATE(2026;12;31)", "=YEAR(B1)", '=TEXT(B1;"dd/mm/yyyy")'],
    ["=EDATE(A1;1)", "=WORKDAY(A1;5)", '=TEXT(1500000;"#,##0")', '=TEXT(0,256;"0,0%")', "=DATEDIF(A1;B1;\"D\")"],
  ], ["date", "date", "text", "text", "text"])
  eq(s.at("C1"), 10, "date difference in days")
  eq(s.fmt("C1"), null, "a date difference is a number")
  eq(s.at("D1"), F.ymdToSerial(2026, 10, 31), "date + days")
  eq(s.fmt("D1"), "date", "date + days is a date")
  eq(s.fmt("E1"), "date", "TODAY is a date")
  eq(s.at("A2"), F.ymdToSerial(2026, 10, 31), "EOMONTH via formulajs")
  eq(s.at("B2"), 7, "NETWORKDAYS via formulajs (Thu 1 – Sun 11 Oct 2026)")
  eq(s.at("C2"), F.ymdToSerial(2026, 12, 31), "DATE")
  eq(s.at("D2"), 2026, "YEAR")
  eq(s.at("E2"), "11/10/2026", "TEXT date")
  eq(s.at("A3"), F.ymdToSerial(2026, 11, 1), "EDATE")
  eq(s.at("B3"), F.ymdToSerial(2026, 10, 8), "WORKDAY")
  eq(s.at("C3"), "1.500.000", "TEXT number in Indonesian")
  eq(s.at("D3"), "25,6%", "TEXT percent with ';' formula decimals")
  eq(s.at("E3"), 10, "DATEDIF")
}
{
  // Lookups
  const s = sheet([
    ["apel", 100, '=XLOOKUP("jeruk";A1:A3;B1:B3)', '=INDEX(B1:B3;MATCH("mangga";A1:A3;0))'],
    ["jeruk", 200, '=VLOOKUP("JERUK";A1:B3;2;FALSE)', '=XLOOKUP("x";A1:A3;B1:B3;"-")'],
    ["mangga", 300, "=SUMPRODUCT(B1:B3;B1:B3)", '=COUNTIFS(A1:A3;"*a*";B1:B3;">=200")'],
  ])
  eq(s.at("C1"), 200, "XLOOKUP")
  eq(s.at("D1"), 300, "INDEX/MATCH via formulajs")
  eq(s.at("C2"), 200, "VLOOKUP is case-insensitive")
  eq(s.at("D2"), "-", "XLOOKUP not found")
  eq(s.at("C3"), 140000, "SUMPRODUCT")
  eq(s.at("D3"), 1, "COUNTIFS with wildcard + number criteria")
}
{
  // Formats follow the data: Rupiah stays Rupiah through arithmetic.
  const s = sheet([[{ v: 1500000, nf: "idr" }, "=A1*2", "=SUM(A1:A1)", "=A1/A1"]])
  eq(s.fmt("B1"), "idr", "Rupiah * 2 is Rupiah")
  eq(s.fmt("C1"), "idr", "SUM of Rupiah is Rupiah")
  eq(s.fmt("D1"), null, "Rupiah / Rupiah is a ratio")
}
{
  // derive(): an edit recomputes its dependents, everything else is carried over.
  const s = sheet([[1, "=A1*2", 5, "=C1+1"]])
  eq(s.at("B1"), 2, "before")
  eq(s.at("D1"), 6, "before")
  const cells = new Map(s.data.cells)
  cells.set("r0", { ...cells.get("r0"), c0: 10 })
  const next = { ...s.data, cells }
  const e2 = s.e.derive(next)
  eq(e2.values.has("r0\u0001c3"), true, "unrelated formula result carried over")
  eq(e2.values.has("r0\u0001c1"), false, "dependent invalidated")
  eq(e2.value("r0", "c1"), 20, "dependent recomputed")
}

// ── Server computed view ────────────────────────────────────────────────────────────────────────
{
  const columns = [{ id: "a", type: "currency" }, { id: "b", type: "text" }, { id: "c", type: "date" }]
  const shp = { columnIds: ["a", "b", "c"], rowIds: ["x", "y"] }
  const rows = [
    { id: "x", cells: { a: 1500000, b: { f: F.toStored("=A1*2", shp) }, c: "2026-10-11" } },
    { id: "y", cells: { b: { f: F.toStored("=C1+1", shp) } } },
  ]
  const out = F.computeSheet(columns, rows)
  eq(out.x.a, { v: 1500000, d: "Rp 1.500.000", nf: "idr" }, "currency cell")
  eq(out.x.b, { v: 3000000, d: "Rp 3.000.000", nf: "idr", formula: true }, "formula takes the Rupiah format")
  eq(out.x.c, { v: 46306, d: "11 Okt 2026", nf: "date" }, "date column as serial + text")
  eq(out.y.b.d, "12/10/2026", "date arithmetic in a text column displays day-first")
}

console.log(`sheet-formula: ${n} checks passed`)
