/**
 * Formula engine checks. `npx tsx scripts/test-sheet-formula.ts`
 *
 * Each case pins a behaviour that would be a real bug in a spreadsheet: cycles, #REF! after a
 * delete, division by zero, and — the important one — references surviving a row insert / column
 * reorder without ever being rewritten.
 */
import {
  ERR, evaluateCell, isError, toDisplay, toStored,
  type SheetData, type SheetShape,
} from "../src/lib/sheet-formula"

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; console.log(`  FAIL ${name}\n         dapat   ${JSON.stringify(actual)}\n         harusnya ${JSON.stringify(expected)}`) }
}

const shape: SheetShape = { columnIds: ["ca", "cb", "cc"], rowIds: ["r1", "r2", "r3", "r4"] }
const build = (cells: Record<string, Record<string, unknown>>): SheetData => ({
  shape,
  cells: new Map(Object.entries(cells)),
})

console.log("\n— terjemahan A1 <-> id —")
check("A1 -> id", toStored("=A1+B2", shape), "={ca!r1}+{cb!r2}")
check("id -> A1", toDisplay("={ca!r1}+{cb!r2}", shape), "=A1+B2")
check("range", toStored("=SUM(A1:A3)", shape), "=SUM({ca!r1}:{ca!r3})")

console.log("\n— hitungan dasar —")
const d1 = build({
  r1: { ca: 10, cb: 5 },
  r2: { ca: 20, cb: 3 },
  r3: { ca: 30, cb: 0 },
  r4: { ca: { f: "=SUM({ca!r1}:{ca!r3})" }, cb: { f: "={ca!r1}*{cb!r1}" }, cc: { f: "={ca!r1}/{cb!r3}" } },
})
check("SUM range", evaluateCell(d1, "r4", "ca"), 60)
check("perkalian antar sel", evaluateCell(d1, "r4", "cb"), 50)
check("bagi nol", evaluateCell(d1, "r4", "cc"), ERR.div)

console.log("\n— fungsi —")
const d2 = build({
  r1: { ca: 4 }, r2: { ca: 8 }, r3: { ca: 12 },
  r4: {
    ca: { f: "=AVERAGE({ca!r1}:{ca!r3})" },
    cb: { f: "=IF({ca!r1}>5,\"besar\",\"kecil\")" },
    cc: { f: "=ROUND(10/3,2)" },
  },
})
check("AVERAGE", evaluateCell(d2, "r4", "ca"), 8)
check("IF salah -> kecil", evaluateCell(d2, "r4", "cb"), "kecil")
check("ROUND 2 desimal", evaluateCell(d2, "r4", "cc"), 3.33)

console.log("\n— error yang harus ketangkep —")
const cyc = build({ r1: { ca: { f: "={cb!r1}" }, cb: { f: "={ca!r1}" } } })
check("rumus muter", evaluateCell(cyc, "r1", "ca"), ERR.cycle)
const gone = build({ r1: { ca: { f: "={cz!r1}" } } })
check("kolom udah dihapus", evaluateCell(gone, "r1", "ca"), ERR.ref)
const bad = build({ r1: { ca: { f: "=NGAWUR(1)" } } })
check("fungsi nggak dikenal", evaluateCell(bad, "r1", "ca"), ERR.name)

console.log("\n— yang paling penting: referensi selamat pas baris disisip / kolom digeser —")
// The formula was written as "=A1+A2" when the sheet was [ca,cb,cc] x [r1..r4].
const stored = toStored("=A1+A2", shape)
// Now someone inserts a row at the top and swaps the first two columns. NOTHING is rewritten.
const shifted: SheetShape = { columnIds: ["cb", "ca", "cc"], rowIds: ["rNEW", "r1", "r2", "r3", "r4"] }
const d3: SheetData = {
  shape: shifted,
  cells: new Map(Object.entries({ rNEW: { ca: 999 }, r1: { ca: 10 }, r2: { ca: 20 }, r4: { cc: { f: stored } } })),
}
check("nilai tetap 10+20 walau posisi berubah", evaluateCell(d3, "r4", "cc"), 30)
check("tampilannya ikut posisi baru", toDisplay(stored, shifted), "=B2+B3")

console.log("\n— range antar kolom (rectangle) —")
const d4 = build({
  r1: { ca: 1, cb: 2, cc: 3 },
  r2: { ca: 4, cb: 5, cc: 6 },
  r3: { ca: { f: "=SUM({ca!r1}:{cb!r2})" }, cb: { f: "=COUNT({ca!r1}:{cc!r2})" } },
})
check("SUM kotak A1:B2", evaluateCell(d4, "r3", "ca"), 1 + 2 + 4 + 5)
check("COUNT kotak A1:C2", evaluateCell(d4, "r3", "cb"), 6)
const badRange = build({ r1: { ca: { f: "=SUM({cz!r1}:{ca!r1})" } } })
check("range ke kolom yg udah dihapus", evaluateCell(badRange, "r1", "ca"), ERR.ref)

console.log("\n— fungsi tambahan —")
const d5 = build({
  r1: { ca: 150, cb: "budi" }, r2: { ca: 50, cb: "ANI" }, r3: { ca: 200, cb: "budi" },
  r4: {
    ca: { f: "=SUMIF({ca!r1}:{ca!r3},\">100\")" },
    cb: { f: "=MEDIAN({ca!r1}:{ca!r3})" },
    cc: { f: "=UPPER({cb!r1})" },
  },
})
check("SUMIF >100", evaluateCell(d5, "r4", "ca"), 350)
check("MEDIAN", evaluateCell(d5, "r4", "cb"), 150)
check("UPPER", evaluateCell(d5, "r4", "cc"), "BUDI")
const d6 = build({ r1: { ca: { f: "=PRODUCT(2,3,4)" }, cb: { f: "=SQRT(16)" }, cc: { f: "=LEN(\"halo\")" } } })
check("PRODUCT", evaluateCell(d6, "r1", "ca"), 24)
check("SQRT", evaluateCell(d6, "r1", "cb"), 4)
check("LEN", evaluateCell(d6, "r1", "cc"), 4)

console.log("\n— syarat & lookup —")
// A tiny expense table: A = kategori, B = nominal, C = tanggal
const t = build({
  r1: { ca: "Talent", cb: 5_000_000, cc: "2026-08-01" },
  r2: { ca: "Venue",  cb: 2_000_000, cc: "2026-08-05" },
  r3: { ca: "Talent", cb: 3_000_000, cc: "2026-09-01" },
  r4: {
    ca: { f: "=SUMIF({ca!r1}:{ca!r3},\"Talent\",{cb!r1}:{cb!r3})" },
    cb: { f: "=COUNTIF({ca!r1}:{ca!r3},\"Talent\")" },
    cc: { f: "=SUMIFS({cb!r1}:{cb!r3},{ca!r1}:{ca!r3},\"Talent\",{cb!r1}:{cb!r3},\">4000000\")" },
  },
})
check("SUMIF pakai rentang jumlah terpisah", evaluateCell(t, "r4", "ca"), 8_000_000)
check("COUNTIF", evaluateCell(t, "r4", "cb"), 2)
check("SUMIFS dua syarat", evaluateCell(t, "r4", "cc"), 5_000_000)

const look = build({
  r1: { ca: "Talent", cb: 5_000_000 },
  r2: { ca: "Venue", cb: 2_000_000 },
  r3: { ca: { f: "=VLOOKUP(\"Venue\",{ca!r1}:{cb!r2},2)" }, cb: { f: "=VLOOKUP(\"Katering\",{ca!r1}:{cb!r2},2)" } },
})
check("VLOOKUP ketemu", evaluateCell(look, "r3", "ca"), 2_000_000)
check("VLOOKUP nggak ketemu -> #N/A", evaluateCell(look, "r3", "cb"), ERR.na)

console.log("\n— logika, teks, tanggal —")
const misc = build({ r1: {
  ca: { f: "=IFERROR(1/0,\"aman\")" },
  cb: { f: "=AND(1>0,2>1)" },
  cc: { f: "=LEFT(\"Jakarta\",3)" },
} , r2: {
  ca: { f: "=DATEDIF(\"2026-01-01\",\"2026-08-04\",\"M\")" },
  cb: { f: "=MOD(10,3)" },
  cc: { f: "=SUBSTITUTE(\"PATS X\",\"X\",\"BSD\")" },
} })
check("IFERROR nangkep bagi nol", evaluateCell(misc, "r1", "ca"), "aman")
check("AND", evaluateCell(misc, "r1", "cb"), true)
check("LEFT", evaluateCell(misc, "r1", "cc"), "Jak")
check("DATEDIF bulan", evaluateCell(misc, "r2", "ca"), 7)
check("MOD", evaluateCell(misc, "r2", "cb"), 1)
check("SUBSTITUTE", evaluateCell(misc, "r2", "cc"), "PATS BSD")

console.log(`\n${pass} lolos, ${fail} gagal`)
process.exit(fail ? 1 : 0)
