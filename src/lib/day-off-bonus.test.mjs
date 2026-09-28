// node src/lib/day-off-bonus.test.mjs
//
// Plain node, no test runner — same loader as permit-reason-guard.test.mjs: imports the .ts directly
// when this node can strip types, otherwise transpiles it with the repo's own `typescript` package.
// The database half (effectiveDayOffQuotas) is covered by src/__tests__/day-off-bonus.test.ts.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "day-off-bonus.ts")

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
const day = (d) => d.toISOString().slice(0, 10)

// ── period math ─────────────────────────────────────────────────────────────────────────────────
check("period key: the 28th starts the NEXT month's period; the 27th closes this one", () => {
  assert.equal(m.periodKeyOfDateKey("2026-09-27"), "2026-09")
  assert.equal(m.periodKeyOfDateKey("2026-09-28"), "2026-10")
  assert.equal(m.periodKeyOfDateKey("2026-10-27"), "2026-10")
  assert.equal(m.periodKeyOfDateKey("2026-12-28"), "2027-01")
  assert.equal(m.periodKeyOfDateKey("2026-12-31"), "2027-01")
  assert.equal(m.periodKeyOfDateKey("2027-01-01"), "2027-01")
  assert.equal(m.periodKeyOfDateKey("2027-02-28"), "2027-03")
})

check("period bounds: 28th of the previous month → 27th, across the year boundary too", () => {
  const oct = m.periodBounds("2026-10")
  assert.equal(day(oct.start), "2026-09-28")
  assert.equal(day(oct.end), "2026-10-27")
  const jan = m.periodBounds("2027-01")
  assert.equal(day(jan.start), "2026-12-28")
  assert.equal(day(jan.end), "2027-01-27")
  const mar = m.periodBounds("2028-03") // leap February: 28 Feb 2028 → 27 Mar 2028
  assert.equal(day(mar.start), "2028-02-28")
  assert.equal(day(mar.end), "2028-03-27")
})

check("every date of a period maps back to that period (a whole year)", () => {
  for (let i = 1; i <= 12; i++) {
    const key = `2026-${String(i).padStart(2, "0")}`
    const { start, end } = m.periodBounds(key)
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      assert.equal(m.periodKeyOfDateKey(day(new Date(t))), key, `${day(new Date(t))} should be in ${key}`)
    }
    // and the neighbours are not
    assert.equal(m.periodKeyOfDateKey(day(new Date(start.getTime() - 86_400_000))), m.shiftPeriodKey(key, -1))
    assert.equal(m.periodKeyOfDateKey(day(new Date(end.getTime() + 86_400_000))), m.shiftPeriodKey(key, 1))
  }
})

check("shiftPeriodKey crosses years both ways", () => {
  assert.equal(m.shiftPeriodKey("2026-01", -1), "2025-12")
  assert.equal(m.shiftPeriodKey("2026-12", 1), "2027-01")
  assert.equal(m.shiftPeriodKey("2026-10", 0), "2026-10")
  assert.equal(m.shiftPeriodKey("2026-10", -13), "2025-09")
  assert.throws(() => m.shiftPeriodKey("2026-13", 1))
})

check("grantable periods: previous, current, next", () => {
  assert.deepEqual(m.grantablePeriods("2026-10"), ["2026-09", "2026-10", "2026-11"])
  assert.deepEqual(m.grantablePeriods("2027-01"), ["2026-12", "2027-01", "2027-02"])
})

check("checkGrantPeriod: more than one period back is too old, two ahead too far, junk invalid", () => {
  assert.deepEqual(m.checkGrantPeriod("2026-10", "2026-10"), { ok: true })
  assert.deepEqual(m.checkGrantPeriod("2026-11", "2026-10"), { ok: true })
  assert.deepEqual(m.checkGrantPeriod("2026-09", "2026-10"), { ok: true })
  assert.deepEqual(m.checkGrantPeriod("2026-08", "2026-10"), { ok: false, code: "PERIOD_TOO_OLD" })
  assert.deepEqual(m.checkGrantPeriod("2025-10", "2026-10"), { ok: false, code: "PERIOD_TOO_OLD" })
  assert.deepEqual(m.checkGrantPeriod("2026-12", "2026-10"), { ok: false, code: "PERIOD_TOO_FAR" })
  assert.deepEqual(m.checkGrantPeriod("2027-01", "2026-12"), { ok: true })
  assert.deepEqual(m.checkGrantPeriod("2026-11", "2027-01"), { ok: false, code: "PERIOD_TOO_OLD" })
  assert.deepEqual(m.checkGrantPeriod("2026-00", "2026-10"), { ok: false, code: "PERIOD_INVALID" })
  assert.deepEqual(m.checkGrantPeriod("2026-1", "2026-10"), { ok: false, code: "PERIOD_INVALID" })
  assert.deepEqual(m.checkGrantPeriod(undefined, "2026-10"), { ok: false, code: "PERIOD_INVALID" })
})

// ── the effective quota ────────────────────────────────────────────────────────────────────────
check("combine: base (default 4 when unset) + bonus", () => {
  assert.deepEqual(m.combineDayOffQuota(null, 0), { base: 4, bonus: 0, quota: 4 })
  assert.deepEqual(m.combineDayOffQuota(undefined, 3), { base: 4, bonus: 3, quota: 7 })
  assert.deepEqual(m.combineDayOffQuota(9, 3), { base: 9, bonus: 3, quota: 12 })
  assert.deepEqual(m.combineDayOffQuota(0, 2), { base: 0, bonus: 2, quota: 2 }, "an explicit 0 is a real quota, not 'unset'")
  assert.deepEqual(m.combineDayOffQuota(4, -5), { base: 4, bonus: 0, quota: 4 }, "a negative bonus can never lower the quota")
  assert.deepEqual(m.combineDayOffQuota(4, Number.NaN), { base: 4, bonus: 0, quota: 4 })
})

check("sumBonusDays: per person AND per period; revoked grants count for nothing", () => {
  const rows = [
    { userId: "a", periodKey: "2026-10", days: 3 },
    { userId: "a", periodKey: "2026-10", days: 1 },
    { userId: "a", periodKey: "2026-10", days: 5, revokedAt: new Date() },
    { userId: "a", periodKey: "2026-11", days: 2 },
    { userId: "b", periodKey: "2026-10", days: 2, revokedAt: null },
    { userId: "b", periodKey: "2026-10", days: 0 },
  ]
  const sum = m.sumBonusDays(rows)
  assert.equal(sum.get("a|2026-10"), 4)
  assert.equal(sum.get("a|2026-11"), 2, "a grant for next period does not leak into this one")
  assert.equal(sum.get("b|2026-10"), 2)
  assert.equal(sum.get("b|2026-11"), undefined)
  assert.equal(sum.size, 3)
})

// ── copy ───────────────────────────────────────────────────────────────────────────────────────
check("period labels (push in Indonesian, UI in English)", () => {
  assert.equal(m.periodLabel("2026-10", "id"), "28 Sep–27 Okt")
  assert.equal(m.periodLabel("2026-10", "en"), "28 Sep–27 Oct")
  assert.equal(m.periodLabel("2027-01", "id"), "28 Des–27 Jan")
  assert.equal(m.periodLabel("2026-06", "id"), "28 Mei–27 Jun")
})

check("grant notice matches the owner's copy; a trailing full stop is not doubled", () => {
  assert.deepEqual(m.bonusGrantNotice(3, "2026-10", "Kerja event 3 hari"), {
    title: "Extra day off",
    message: "Kamu dapat 3 extra day off untuk periode 28 Sep–27 Okt — Kerja event 3 hari. Hangus setelah periode itu.",
  })
  assert.equal(
    m.bonusGrantNotice(1, "2026-10", "  Event   Jakarta. ").message,
    "Kamu dapat 1 extra day off untuk periode 28 Sep–27 Okt — Event Jakarta. Hangus setelah periode itu.",
  )
})

check("isPeriodKey", () => {
  assert.equal(m.isPeriodKey("2026-10"), true)
  assert.equal(m.isPeriodKey("2026-13"), false)
  assert.equal(m.isPeriodKey("2026-10-01"), false)
  assert.equal(m.isPeriodKey(202610), false)
})

console.log(failed ? `${failed} failed, ${passed} passed` : `all passed (${passed})`)
process.exit(failed ? 1 : 0)
