// node --experimental-strip-types src/lib/custom-field-number.test.mjs
//
// Plain node, no test runner — same loader as xp-reason.test.mjs: imports the .ts directly when this
// node can strip types, otherwise transpiles it with the repo's own `typescript` package.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "custom-field-number.ts")
const webPath = path.join(here, "..", "..", "apps", "web", "src", "lib", "custom-field-number.ts")

async function load() {
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

const m = await load()
let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL ${name}\n     ${err.message}`)
  }
}

const IDR = { format: "currency-idr" }
const idr = (v) => m.normalizeNumberFieldValue(v, IDR)
const plain = (v) => m.normalizeNumberFieldValue(v, null)

check("format detection", () => {
  assert.equal(m.numberFieldFormat(IDR), "currency-idr")
  assert.equal(m.numberFieldFormat("rupiah"), "currency-idr")
  assert.equal(m.numberFieldFormat({ format: "IDR" }), "currency-idr")
  assert.equal(m.numberFieldFormat(null), "plain")
  assert.equal(m.numberFieldFormat({ options: ["a"] }), "plain")
})

check("the 13 prod values (Rupiah, thousands grouping mistaken for decimals)", () => {
  const cases = {
    "369.000": "369000", "72.000": "72000", "500.000": "500000", "823.000": "823000", "95.000": "95000",
    "243.351": "243351", "101.250": "101250", "13.600000": "13600000", "900.000": "900000",
    "153.134": "153134", "935.600": "935600", "118.000": "118000", "300.000": "300000", "280,000": "280000",
  }
  for (const [input, want] of Object.entries(cases)) assert.equal(idr(input), want, input)
})

check("Rupiah as typed", () => {
  assert.equal(idr("Rp 369.000"), "369000")
  assert.equal(idr("Rp369.000"), "369000")
  assert.equal(idr("IDR 1.500.000"), "1500000")
  assert.equal(idr("1.500.000"), "1500000")
  assert.equal(idr("1,500,000"), "1500000")
  assert.equal(idr("Rp 50.000,-"), "50000")
  assert.equal(idr("1.500.000,00"), "1500000")
  assert.equal(idr("150.000,49"), "150000")
  assert.equal(idr("150.000,50"), "150001")
  assert.equal(idr("1,500,000.75"), "1500001")
  assert.equal(idr("999,99"), "1000")
  assert.equal(idr("17jt"), "17000000")
  assert.equal(idr("1,5 jt"), "1500000")
  assert.equal(idr("50rb"), "50000")
  assert.equal(idr("Rp 9 240 943"), "9240943")
  assert.equal(idr("-Rp 25.000"), "-25000")
  assert.equal(idr("(25.000)"), "-25000")
  assert.equal(idr("0"), "0")
  assert.equal(idr("007"), "7")
  assert.equal(idr("369000"), "369000")
  assert.equal(idr(""), "")
  assert.equal(idr("   "), "")
  assert.equal(idr(null), "")
  assert.equal(idr(undefined), "")
  assert.equal(idr("abc"), "")
  assert.equal(idr("sekitar 20 ribu"), "20") // not a number: keeps its digits (old web behaviour)
  assert.equal(idr("12345678901234567890"), "12345678901234567890")
})

check("Rupiah sent as a JSON number", () => {
  assert.equal(idr(369000), "369000")
  assert.equal(idr(243.351), "243351")
  assert.equal(idr(101.25), "101") // two decimals = cents
  assert.equal(idr(1500000.5), "1500001")
  assert.equal(idr(-5000), "-5000")
  assert.equal(idr(NaN), "")
})

check("plain numbers (id-ID rules from Sheets)", () => {
  assert.equal(plain("1.500.000"), "1500000")
  assert.equal(plain("1.500"), "1500")
  assert.equal(plain("1.5"), "1.5")
  assert.equal(plain("0.500"), "0.5")
  assert.equal(plain("2,5"), "2.5")
  assert.equal(plain("1.234,56"), "1234.56")
  assert.equal(plain("1,234.56"), "1234.56")
  assert.equal(plain("13.600000"), "13.6")
  assert.equal(plain("42"), "42")
  assert.equal(plain(42), "42")
  assert.equal(plain(3.25), "3.25")
  assert.equal(plain("-7"), "-7")
  assert.equal(plain("5k"), "5000")
  assert.equal(plain(""), "")
  assert.equal(plain("n/a"), "n/a") // unparseable text is kept as is
  assert.equal(plain("1.50.0"), "1.50.0")
})

check("idempotent: normalising a stored value changes nothing", () => {
  for (const v of ["369000", "0", "-25000", "13600000"]) assert.equal(idr(idr(v)), v)
  for (const v of ["1500", "1.5", "-7", "1234.56"]) assert.equal(plain(plain(v)), v)
})

check("display helpers", () => {
  assert.equal(m.groupIdrDigits("369000"), "369.000")
  assert.equal(m.groupIdrDigits("1500000"), "1.500.000")
  assert.equal(m.groupIdrDigits("0"), "0")
  assert.equal(m.groupIdrDigits(""), "")
  assert.equal(m.formatIdr("369.000"), "Rp 369.000")
  assert.equal(m.formatIdr("369000"), "Rp 369.000")
  assert.equal(m.formatIdr("-25000"), "\u2212Rp 25.000")
  assert.equal(m.formatIdr(""), "")
})

// Owner bug 27 Oct 2026: "Harga" (Rupiah) edited in a form-made task went back to the old amount. The editors now
// read what was typed in the UI language and send a JSON number, which the server keeps as it is.
const typed = (v, opts, lang) => m.typedNumberFieldValue(v, opts, lang)
check("typed in a Rupiah box, both languages", () => {
  for (const lang of ["id", "en"]) {
    for (const v of ["10500000", "10.500.000", "10,500,000", "Rp 10.500.000", "Rp10.500.000", "IDR 10.500.000", " 10.500.000 "]) assert.equal(typed(v, IDR, lang), 10500000, `${lang} ${v}`)
    assert.equal(typed("-10.500.000", IDR, lang), -10500000)
    assert.equal(typed("−Rp 1.501", IDR, lang), -1501) // the amount as this app shows it, pasted back
    assert.equal(typed("", IDR, lang), "")
    assert.equal(typed("   ", IDR, lang), "")
  }
  assert.equal(typed("1.500.000,50", IDR, "id"), 1500001) // whole rupiah: cents round
  assert.equal(typed("1,500,000.50", IDR, "en"), 1500001)
})

check("typed in a plain number box: the decimal mark follows the UI language", () => {
  assert.equal(typed("2,5", null, "id"), 2.5)
  assert.equal(typed("2.5", null, "en"), 2.5)
  assert.equal(typed("1.234", null, "id"), 1234) // Indonesian: the dot groups
  assert.equal(typed("1.234", null, "en"), 1.234) // English: the dot is the decimal mark
  assert.equal(typed("1,234", null, "en"), 1234)
  assert.equal(typed("1,234", null, "id"), 1.234)
  assert.equal(typed("1.234.567,89", null, "id"), 1234567.89)
  assert.equal(typed("1,234,567.89", null, "en"), 1234567.89)
  assert.equal(typed("10500000", null, "en"), 10500000)
  assert.equal(typed("-3,75", null, "id"), -3.75)
  assert.equal(typed("-3.75", null, "en"), -3.75)
  assert.equal(typed("42,5%", { numberFormat: "percent" }, "id"), 0.425)
  assert.equal(typed("42.5%", { numberFormat: "percent" }, "en"), 0.425)
  assert.equal(typed("$1,234.50", { numberFormat: "USD" }, "en"), 1234.5)
  assert.equal(typed("", null, "en"), "")
  assert.equal(typed("n/a", null, "en"), "n/a")
})

check("a JSON number is stored as it is (no Indonesian re-reading)", () => {
  assert.equal(plain(1.234), "1.234")
  assert.equal(plain(1.5), "1.5")
  assert.equal(plain(-0.25), "-0.25")
  assert.equal(plain(0.1 + 0.2), "0.3")
  assert.equal(plain(10500000), "10500000")
  assert.equal(plain(-0), "0")
  assert.equal(m.normalizeNumberFieldValue(1234.567, { numberFormat: "IDR", decimals: 3 }), "1234.567")
  assert.equal(m.normalizeNumberFieldValue(1234.5678, { numberFormat: "IDR", decimals: 2 }), "1234.57")
  // whole Rupiah keeps its old reading of a JSON number (released apps): 243.351 was a grouping mistake
  assert.equal(idr(243.351), "243351")
  // what an editor sends round-trips through the server unchanged
  for (const [v, lang] of [["1.234", "en"], ["1,234", "id"], ["2,5", "id"], ["-3.75", "en"]]) {
    const sent = typed(v, null, lang)
    assert.equal(Number(plain(sent)), sent, `${lang} ${v}`)
  }
  for (const v of ["10.500.000", "-10.500.000", "10,500,000"]) assert.equal(idr(typed(v, IDR, "en")), String(typed(v, IDR, "en")))
})

check("the box opens with the stored value in the UI language", () => {
  assert.equal(m.numberEditText("2.5", null, "id"), "2,5")
  assert.equal(m.numberEditText("2.5", null, "en"), "2.5")
  assert.equal(m.numberEditText("1500000", null, "id"), "1500000")
  assert.equal(m.numberEditText("0.42", { numberFormat: "percent" }, "id"), "42%")
  assert.equal(m.numberEditText("0.425", { numberFormat: "percent" }, "en"), "42.5%")
  assert.equal(m.numberEditText("", null, "en"), "")
  assert.equal(m.numberEditText("n/a", null, "en"), "n/a")
  // opening and leaving the box changes nothing: what it opens with reads back as the stored number
  for (const lang of ["id", "en"]) for (const v of ["2.5", "1234.56", "-7", "1500000", "1.234"]) assert.equal(typed(m.numberEditText(v, null, lang), null, lang), Number(v), `${lang} ${v}`)
})

const [a, b] = await Promise.all([readFile(tsPath, "utf8"), readFile(webPath, "utf8").catch(() => null)])
if (b === null) console.log("skip web copy check (apps/web not present)")
else check("web copy matches", () => assert.equal(b, a, "apps/web/src/lib/custom-field-number.ts differs from src/lib/custom-field-number.ts"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
