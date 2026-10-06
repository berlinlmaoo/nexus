// node --experimental-strip-types src/lib/calendar/glance.test.mjs      (UPDATE_GOLDEN=1 rewrites the golden files)
//
// The widget rules (glance.ts) run on fixtures/glance/*.json — /api/calendar/glance snapshots shaped like
// production, one per scope — at four moments around a WIB midnight and a month end. The result is compared
// with fixtures/golden-glance/*.json: the files the iOS (CalendarGlance.swift) and Android ports must match.
// Rules the owner signed off on (plan 4, 5.4; decisions 3, 6, 7) are asserted on top.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const g = await import(pathToFileURL(path.join(here, "glance.ts")).href)
const load = (f) => JSON.parse(readFileSync(path.join(here, "fixtures", "glance", f), "utf8"))
let passed = 0
const test = (name, fn) => { fn(); passed++ }

/** When every fixture was saved by the app. */
const SAVED = Date.parse("2026-10-05T04:00:00.000Z")
/** Mon 5 Oct 12:00 WIB · Mon 23:59 · Tue 6 Oct 00:00 · Sun 1 Nov 00:00 (a month later, past the stale limit). */
const NOWS = {
  "mon-1200": Date.parse("2026-10-05T05:00:00.000Z"),
  "mon-2359": Date.parse("2026-10-05T16:59:00.000Z"),
  "tue-0000": Date.parse("2026-10-05T17:00:00.000Z"),
  "nov-0000": Date.parse("2026-10-31T17:00:00.000Z"),
}
const HORIZON = 36 * 3_600_000

const view = (s, now) => ({
  freshness: g.freshness(s, SAVED, now),
  month: g.monthView(s, now, 2),
  week: g.weekView(s, now, 3),
  upcoming: g.upcoming(s, now, 4),
  quadrants: g.quadrants(s, now),
  ring: g.todayRing(s, now),
  inline: g.inlineLine(s, now),
  year: g.yearProgress(g.wibClock(now).day),
  redraw: g.redrawTimes(s, SAVED, now, HORIZON).map((t) => new Date(t).toISOString()),
})

const golden = {}
for (const file of readdirSync(path.join(here, "fixtures", "glance")).sort()) {
  const s = load(file)
  for (const [name, now] of Object.entries(NOWS)) golden[`${file.replace(/\.json$/, "")}.${name}.json`] = view(s, now)
}
mkdirSync(path.join(here, "fixtures", "golden-glance"), { recursive: true })
for (const [file, value] of Object.entries(golden)) {
  const text = `${JSON.stringify(value, null, 1)}\n`
  const at = path.join(here, "fixtures", "golden-glance", file)
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(at, text)
  test(`golden ${file}`, () => assert.equal(text, readFileSync(at, "utf8"), `${file} differs — run with UPDATE_GOLDEN=1 if the change is intended`))
}

// ── What the owner signed off on ───────────────────────────────────────────────────────────────────

const me = load("me.json")
const mon = NOWS["mon-1200"]
const keys = (bars) => bars.map((b) => b.key)

test("time helpers", () => {
  assert.deepEqual(g.wibClock(mon), { day: "2026-10-05", hm: "12:00" })
  assert.deepEqual(g.wibClock(NOWS["tue-0000"]), { day: "2026-10-06", hm: "00:00" })
  assert.equal(g.wibInstant("2026-10-06", "00:00"), NOWS["tue-0000"])
  assert.deepEqual(g.yearProgress("2026-10-05"), { day: 278, days: 365, percent: 76 })
  assert.deepEqual(g.yearProgress("2026-12-31"), { day: 365, days: 365, percent: 100 })
  assert.deepEqual(g.yearProgress("2028-02-29"), { day: 60, days: 366, percent: 16 })
})

test("month grid: Monday first, 42 days, bars ≤ 2 and +N", () => {
  const m = g.monthView(me, mon, 2)
  assert.equal(m.cells.length, 42)
  assert.equal(m.cells[0].day, "2026-09-28")
  assert.equal(m.month, "2026-10")
  const d8 = m.cells.find((c) => c.day === "2026-10-08")
  assert.equal(d8.count, 4)
  assert.equal(d8.bars.length, 2)
  assert.equal(d8.more, 2)
  // Timed by time first, then date-only; same time → title, lower-cased ("Cek" < "edit" < "Evaluasi").
  assert.deepEqual(keys(g.weekView(me, mon, 9)[3].bars), ["a13", "a14", "a12", "a11"])
  assert.equal(m.cells.find((c) => c.day === "2026-10-04").sunday, true)
  assert.equal(m.cells.find((c) => c.day === "2026-10-28").holiday, "Cuti bersama (uji)")
})

test("overdue: date-only after its day, timed from the next minute; > 14 days = grey (decisions 3, 6)", () => {
  const today = g.weekView(me, mon, 9)[0]
  assert.equal(today.day, "2026-10-05")
  assert.equal(today.overdue, true) // a04 09:00, masked
  const a04 = today.bars.find((b) => b.key === "x_m1")
  assert.equal(a04.overdue, "recent")
  assert.equal(a04.id, null)
  assert.equal(a04.title, null)
  // 22 Sep is 13 days back on 5 Oct (red) and 40 days back on 1 Nov (grey, still on its day).
  const e = me.items.find((i) => i.id === "a01")
  assert.equal(g.entryOverdue(e, "2026-10-05", "12:00", 14), "recent")
  assert.equal(g.entryOverdue(e, "2026-11-01", "00:00", 14), "stale")
  const a05 = me.items.find((i) => i.id === "a05")
  assert.equal(g.entryOverdue(a05, "2026-10-05", "19:00", 14), "none")
  assert.equal(g.entryOverdue(a05, "2026-10-05", "19:01", 14), "recent")
  // Status-less and done tasks are never overdue.
  assert.equal(g.entryOverdue(me.items.find((i) => i.id === "a09"), "2026-10-20", "00:00", 14), "none")
  assert.equal(g.entryOverdue(me.items.find((i) => i.id === "a03"), "2026-10-20", "00:00", 14), "none")
})

test("coming up: today's not-yet-due first (date-only counts all day), then the next days", () => {
  const u = g.upcoming(me, mon, 4)
  assert.deepEqual(keys(u.rows), ["a05", "a06", "a08", "a10"])
  const late = g.upcoming(me, NOWS["mon-2359"], 2)
  assert.deepEqual(keys(late.rows), ["a06", "a08"]) // 19:00 is gone, the date-only task stays until midnight
  assert.deepEqual(keys(g.upcoming(me, NOWS["tue-0000"], 1).rows), ["a08"])
})

test("four lists (decision 7): every open task once, in one list", () => {
  const q = Object.fromEntries(g.quadrants(me, mon).map((l) => [l.quadrant, keys(l.rows)]))
  // do: URGENT anywhere, or HIGH due today/tomorrow or overdue ≤ 14 days.
  assert.deepEqual(q.do, ["a01", "a02", "x_m1", "a08", "a11", "x_m2"])
  assert.deepEqual(q.plan, ["a15", "a17", "a20", "u1"])
  assert.deepEqual(q.act, ["a05", "a06"])
  assert.ok(q.later.includes("a10") && q.later.includes("u2"))
  const all = Object.values(q).flat()
  assert.equal(new Set(all).size, all.length)
  const open = [...me.items, ...me.undated].filter(g.entryOpen).length
  assert.equal(all.length, open)
})

test("ring and inline", () => {
  assert.deepEqual(g.todayRing(me, mon), { done: 1, total: 4 })
  assert.deepEqual(g.inlineLine(me, mon), { openToday: 3, next: { day: "2026-10-05", time: "19:00" } })
  assert.deepEqual(g.inlineLine(me, NOWS["tue-0000"]), { openToday: 1, next: { day: "2026-10-06", time: "08:30" } })
})

test("freshness: 2 days, the window, and no-calendar accounts", () => {
  assert.equal(g.freshness(me, SAVED, mon), "fresh")
  assert.equal(g.freshness(me, SAVED, SAVED + g.STALE_AFTER_MS + 1), "stale")
  assert.equal(g.freshness(null, SAVED, mon), "empty")
  assert.equal(g.freshness(load("none.json"), SAVED, mon), "none")
})

test("redraws: midnight, the minute after each open timed task, the stale moment", () => {
  const r = g.redrawTimes(me, SAVED, mon, HORIZON).map((t) => new Date(t).toISOString())
  assert.ok(r.includes("2026-10-05T12:01:00.000Z")) // 19:01 WIB, a05
  assert.ok(r.includes("2026-10-05T17:00:00.000Z")) // WIB midnight
  assert.ok(r.includes("2026-10-06T01:31:00.000Z")) // 08:31 WIB, a08
  assert.ok(!r.includes("2026-10-05T03:01:00.000Z")) // 10:01 WIB a07 is done
})

console.log(`glance: ${passed} checks passed`)
