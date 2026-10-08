// node src/lib/former-member-days.test.mjs
//
// Plain node, no test runner — same loader as day-off-bonus.test.mjs: imports the .ts directly when this
// node can strip types, otherwise transpiles it with the repo's own `typescript` package.
// What it pins: a person who left is never absent after their last working day, never before their
// first, and is on the recap of every period they were still there for (offboarding, 8 Oct 2026).
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "former-member-days.ts")

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

const keys = (from, to) => {
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

check("start: the join day, or an earlier first check-in", () => {
  // The join day itself is never owed (9 Oct 2026): someone added in the evening could not have come in.
  assert.equal(m.attendanceStartKey("2026-10-01", null), "2026-10-02")
  assert.equal(m.attendanceStartKey("2026-10-31", null), "2026-11-01")
  // …unless they did check in that day: then it counts like any other.
  assert.equal(m.attendanceStartKey("2026-10-01", "2026-10-01"), "2026-10-01")
  assert.equal(m.attendanceStartKey("2026-10-01", "2026-09-29"), "2026-09-29")
  assert.equal(m.attendanceStartKey("2026-10-01", "2026-10-03"), "2026-10-02")
})

check("a current member owes every day from their start, with no end", () => {
  assert.equal(m.owesAttendanceOn("2026-09-30", "2026-10-01", null), false)
  assert.equal(m.owesAttendanceOn("2026-10-01", "2026-10-01", null), true)
  assert.equal(m.owesAttendanceOn("2027-05-01", "2026-10-01", null), true)
})

check("someone who left owes nothing after the last working day, which itself still counts", () => {
  assert.equal(m.owesAttendanceOn("2026-10-09", "2026-01-01", "2026-10-10"), true)
  assert.equal(m.owesAttendanceOn("2026-10-10", "2026-01-01", "2026-10-10"), true)
  assert.equal(m.owesAttendanceOn("2026-10-11", "2026-01-01", "2026-10-10"), false)
  assert.equal(m.owesAttendanceOn("2026-12-01", "2026-01-01", "2026-10-10"), false)
})

check("a whole period: a leaver on the 10th owes 28 Sep → 10 Oct only (13 days), the rest is blank", () => {
  const period = keys("2026-09-28", "2026-10-27")
  const owed = period.filter((k) => m.owesAttendanceOn(k, "2025-06-01", "2026-10-10"))
  assert.equal(owed.length, 13)
  assert.equal(owed[0], "2026-09-28")
  assert.equal(owed.at(-1), "2026-10-10")
})

check("joined and left inside one period: only the days in between", () => {
  const owed = keys("2026-09-28", "2026-10-27").filter((k) => m.owesAttendanceOn(k, "2026-10-05", "2026-10-08"))
  assert.deepEqual(owed, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
})

check("left before a period started: owes none of it and is not on its recap", () => {
  const owed = keys("2026-10-28", "2026-11-27").filter((k) => m.owesAttendanceOn(k, "2025-06-01", "2026-10-10"))
  assert.equal(owed.length, 0)
  assert.equal(m.belongsToPeriod("2026-10-10", "2026-10-28"), false)
})

check("on the recap of every period they were there for, including one they left on its first day", () => {
  assert.equal(m.belongsToPeriod(null, "2026-10-28"), true)
  assert.equal(m.belongsToPeriod("2026-10-10", "2026-09-28"), true)
  assert.equal(m.belongsToPeriod("2026-09-28", "2026-09-28"), true)
  assert.equal(m.belongsToPeriod("2026-09-27", "2026-09-28"), false)
})

check("the sheet mark is Indonesian, with the day and a short month", () => {
  assert.equal(m.leftNoteId("2026-10-10"), "keluar 10 Okt")
  assert.equal(m.leftNoteId("2026-05-01"), "keluar 1 Mei")
  assert.equal(m.leftNoteId("2026-08-31T00:00:00.000Z"), "keluar 31 Agu")
  assert.equal(m.leftNoteId("2026-12-27"), "keluar 27 Des")
  assert.equal(m.withLeftNote("BUDI SANTOSO", "2026-10-10"), "BUDI SANTOSO (keluar 10 Okt)")
  assert.equal(m.withLeftNote("BUDI SANTOSO", null), "BUDI SANTOSO")
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
