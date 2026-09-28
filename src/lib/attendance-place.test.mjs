// node src/lib/attendance-place.test.mjs
//
// Plain node, no test runner — same loader as permit-reason-guard.test.mjs: imports the .ts directly
// when this node can strip types, otherwise transpiles it with the repo's own `typescript` package.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "attendance-place.ts")

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

const { isCheckInAway, shortAddress, placeLabel } = await load()

const office = { name: "PATS Group HQ", radiusMeters: 150 }
const addr = "Jalan Kemang Raya, Bangka, Mampang Prapatan, Jakarta Selatan, DKI Jakarta, 12730, Indonesia"
let n = 0
const t = (name, fn) => { fn(); n++; console.log("ok", name) }

t("inside the radius → office name", () => {
  const r = { checkInDistanceMeters: 12, checkInAddress: addr, officeLocation: office }
  assert.equal(isCheckInAway(r), false)
  assert.equal(placeLabel(r), "PATS Group HQ")
})
t("exactly on the radius is inside (the check-in route refuses only > radius)", () => {
  const r = { checkInDistanceMeters: 150, checkInAddress: addr, officeLocation: office }
  assert.equal(isCheckInAway(r), false)
  assert.equal(placeLabel(r), "PATS Group HQ")
})
t("away → first two parts of the address", () => {
  const r = { checkInDistanceMeters: 3400.5, checkInAddress: addr, officeLocation: office }
  assert.equal(isCheckInAway(r), true)
  assert.equal(placeLabel(r), "Jalan Kemang Raya, Bangka")
})
t("away, one-part address", () => {
  assert.equal(placeLabel({ checkInDistanceMeters: 900, checkInAddress: "  Bandung ", officeLocation: office }), "Bandung")
})
t("away, no address → coordinates, never the office", () => {
  const r = { checkInDistanceMeters: 900, checkInAddress: null, checkInLat: -6.2253, checkInLng: 106.829, officeLocation: office }
  assert.equal(placeLabel(r), "-6.22530, 106.82900")
})
t("away, nothing at all → generic text", () => {
  assert.equal(placeLabel({ checkInDistanceMeters: 900, officeLocation: office }), "Di luar kantor")
})
t("unknown distance (override / synthetic row) → null + office name", () => {
  const r = { checkInDistanceMeters: null, checkInAddress: addr, officeLocation: office }
  assert.equal(isCheckInAway(r), null)
  assert.equal(placeLabel(r), "PATS Group HQ")
})
t("no office → null, empty label", () => {
  assert.equal(isCheckInAway({ checkInDistanceMeters: 10, officeLocation: null }), null)
  assert.equal(placeLabel({ checkInDistanceMeters: 10, officeLocation: null }), "")
})
t("shortAddress edge cases", () => {
  assert.equal(shortAddress(null), null)
  assert.equal(shortAddress(""), null)
  assert.equal(shortAddress(" , ,"), null)
  assert.equal(shortAddress("12, Jalan Sudirman, Senayan"), "12, Jalan Sudirman")
})
console.log(`${n} passed`)
