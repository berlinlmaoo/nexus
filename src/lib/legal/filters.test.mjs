// node src/lib/legal/filters.test.mjs
//
// Plain node, no test runner (same loader as ../chat-rules.test.mjs). The Legal template language:
// placeholder tags, filters, field type inference, carrying field settings across versions, terbilang.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

const F = await load("filters.ts")

test("tags: name and filters", () => {
  assert.deepEqual(F.parseTag("TGL | hari | UPPER"), { name: "TGL", filters: ["hari", "upper"] })
  assert.deepEqual(F.parseTag("NAMA"), { name: "NAMA", filters: [] })
  assert.equal(F.parseTag("NAMA LENGKAP"), null)
  assert.equal(F.parseTag("1X"), null)
  assert.deepEqual(F.unknownFilters(["hari", "bogus"]), ["bogus"])
})
test("dates: the forms the templates print", () => {
  const raw = "2026-09-30"
  const v = (filters) => F.renderTagValue({ name: "T", filters }, raw, "date")
  assert.equal(v([]), "30 September 2026")
  assert.equal(v(["hari"]), "Rabu")
  assert.equal(v(["tgl"]), "30")
  assert.equal(v(["bulan"]), "September")
  assert.equal(v(["bulan", "upper"]), "SEPTEMBER")
  assert.equal(v(["bulan_romawi"]), "IX")
  assert.equal(v(["tahun_terbilang"]), "Dua Ribu Dua Puluh Enam")
  assert.equal(v(["dmy"]), "30-09-2026")
  assert.equal(F.parseIsoDate("2026-02-30"), null)
})
test("money: digits and words", () => {
  const v = (filters, raw = "25.000.000") => F.renderTagValue({ name: "H", filters }, raw, "money")
  assert.equal(v([]), "25.000.000")
  assert.equal(v(["rupiah"]), "Rp 25.000.000")
  assert.equal(v(["terbilang_rupiah", "upper"]), "DUA PULUH LIMA JUTA RUPIAH")
  assert.equal(v(["terbilang"], "12"), "dua belas")
  assert.equal(v([], "1250000.5"), "1.250.000,50")
  assert.equal(F.parseAmount("Rp 25.000.000,00"), 25000000)
  assert.equal(F.parseAmount("25,000,000"), 25000000)
  assert.equal(F.parseAmount("abc"), null)
})
test("a wrong filter for the value is an error, an empty value prints empty", () => {
  assert.throws(() => F.renderTagValue({ name: "X", filters: ["hari"] }, "kemarin", "text"), F.FilterError)
  assert.equal(F.renderTagValue({ name: "X", filters: ["hari"] }, "", "date"), "")
})
test("type inference: filters first, then the name", () => {
  assert.equal(F.inferFieldType("X", ["hari"]), "date")
  assert.equal(F.inferFieldType("X", ["terbilang_rupiah"]), "money")
  assert.equal(F.inferFieldType("TANGGAL_MULAI", []), "date")
  assert.equal(F.inferFieldType("HONOR_TALENT", []), "money")
  assert.equal(F.inferFieldType("ALAMAT_PIHAK_KEDUA", []), "longtext")
  assert.equal(F.inferFieldType("NAMA_VENUE", []), "text")
  assert.equal(F.humanizeFieldName("NIK_PIHAK_KEDUA"), "NIK Pihak Kedua")
})
test("a new version keeps what people set on the fields", () => {
  const prev = [{ name: "A", label: "Nama", type: "longtext", required: false }, { name: "L", label: "Barang", type: "list", required: true, columns: [{ name: "N", label: "Nama barang", type: "text", required: true }] }]
  const det = [{ name: "A", label: "A", type: "text", required: true }, { name: "B", label: "B", type: "text", required: true }, { name: "L", label: "L", type: "list", required: true, columns: [{ name: "N", label: "N", type: "text", required: true }, { name: "Q", label: "Q", type: "number", required: true }] }]
  const out = F.carryOverFields(det, prev)
  assert.deepEqual(out[0], { name: "A", label: "Nama", type: "longtext", required: false, help: undefined })
  assert.equal(out[1].label, "B")
  assert.equal(out[2].columns[0].label, "Nama barang")
  assert.equal(out[2].columns[1].label, "Q")
})
test("terbilang", () => {
  assert.equal(F.terbilangWords(12), "dua belas")
  assert.equal(F.terbilangWords(2026), "dua ribu dua puluh enam")
  assert.equal(F.terbilangRupiah(25000000), "Dua Puluh Lima Juta Rupiah")
  assert.equal(F.terbilangRupiah(1250000), "Satu Juta Dua Ratus Lima Puluh Ribu Rupiah")
  assert.equal(F.terbilangWords(0), "nol")
  assert.equal(F.terbilangWords(1000000), "satu juta")
})

test("field edits: presentation only, the file decides what exists", () => {
  const cur = [
    { name: "TANGGAL_DOKUMEN", label: "Tanggal Dokumen", type: "date", required: true },
    { name: "A", label: "A", type: "text", required: true },
    { name: "L", label: "L", type: "list", required: true, columns: [{ name: "N", label: "N", type: "text", required: true }] },
  ]
  const out = F.applyFieldEdits(cur, [
    { name: "TANGGAL_DOKUMEN", required: false, type: "text" },
    { name: "A", label: " Jenis ", type: "select", options: ["X", "X", " Y ", 3] , required: false },
    { name: "L", type: "text", columns: [{ name: "N", label: "Nama barang" }] },
    { name: "GHOST", label: "nope" },
  ])
  assert.deepEqual(out[0], cur[0])
  assert.deepEqual(out[1], { name: "A", label: "Jenis", type: "select", required: false, options: ["X", "Y"] })
  assert.equal(out[2].type, "list")
  assert.equal(out[2].columns[0].label, "Nama barang")
  assert.equal(out.length, 3)
})

test("form values: checked and normalized before anything is allocated", () => {
  const fields = [
    { name: "TANGGAL_DOKUMEN", label: "", type: "date", required: true },
    { name: "NAMA", label: "", type: "text", required: true },
    { name: "HONOR", label: "", type: "money", required: true },
    { name: "JENIS", label: "", type: "select", required: false, options: ["A", "B"] },
    { name: "MATERAI", label: "", type: "boolean", required: false },
    { name: "BARANG", label: "", type: "list", required: true, columns: [{ name: "NAMA_BARANG", label: "", type: "text", required: true }, { name: "JUMLAH", label: "", type: "number", required: false }] },
  ]
  const ok = F.validateFormValues(fields, { TANGGAL_DOKUMEN: "2026-10-14", NAMA: "  Budi ", HONOR: "25.000.000", MATERAI: true, BARANG: [{ NAMA_BARANG: "Speaker", JUMLAH: "2" }, { NAMA_BARANG: "", JUMLAH: "" }], EXTRA: "x" })
  assert.deepEqual(ok.errors, {})
  assert.deepEqual(ok.values, { TANGGAL_DOKUMEN: "2026-10-14", NAMA: "Budi", HONOR: 25000000, MATERAI: true, BARANG: [{ NAMA_BARANG: "Speaker", JUMLAH: 2 }] })
  const bad = F.validateFormValues(fields, { TANGGAL_DOKUMEN: "2026-13-01", HONOR: "abc", JENIS: "C", BARANG: [{ JUMLAH: "3" }] })
  assert.deepEqual(bad.errors, { TANGGAL_DOKUMEN: "Not a valid date", NAMA: "Required", HONOR: "Not a number", JENIS: "Pick one of the choices", "BARANG.0.NAMA_BARANG": "Required" })
  assert.equal(F.validateFormValues(fields, { BARANG: [] }).errors.BARANG, "Add at least one row")
})

console.log(`legal filters: ${passed} passed`)
