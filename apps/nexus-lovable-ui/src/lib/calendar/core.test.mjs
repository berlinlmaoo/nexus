// node --experimental-strip-types src/lib/calendar/core.test.mjs      (UPDATE_GOLDEN=1 rewrites the golden files)
//
// The client rules (dots, legend, day tree per division / per person, week rows, overdue, filters) run
// on the SERVER's golden output for 18 Sep and 3 Oct 2026 (~/nexus/src/lib/calendar/fixtures/golden),
// at a fixed "now" (5 Oct 2026 12:00 WIB). The result is compared byte for byte with
// fixtures/golden-client/*.json — the files the iOS (CalendarCore.swift) and Android ports must match.
// The numbers the owner signed off on (plan criteria A2, A3, A5) are asserted on top.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const core = await import(pathToFileURL(path.join(here, "core.ts")).href)
const serverGolden = path.resolve(here, "../../../../../src/lib/calendar/fixtures/golden")
const sg = (f) => JSON.parse(readFileSync(path.join(serverGolden, f), "utf8"))
let passed = 0
const test = (name, fn) => { fn(); passed++ }

const structure = sg("structure.json")
const ix = core.indexStructure(structure.units, structure.people)
const unit = (name) => structure.units.find((u) => u.name === name)
const person = (name) => structure.people.find((p) => p.name === name)
const NOW = Date.parse("2026-10-05T05:00:00.000Z")
const TODAY = "2026-10-05"
const WINDOW = 14
const top = ix.top.id

const brief = (n) => n && ({
  unit: n.unit.name, count: n.count,
  items: n.items.map((i) => i.key), loose: n.loose.map((i) => i.key),
  people: n.people.map((p) => ({ userId: p.userId, items: p.items.map((i) => i.key) })),
  children: n.children.map(brief),
})
const golden = {}
for (const day of ["2026-09-18", "2026-10-03"]) {
  for (const who of ["bod", "staff"]) {
    const items = sg(`items-${day}.${who}.json`)
    for (const [fname, fid] of [["top", top], ["fa", unit("Framework Agency").id], ["pats", unit("PATS").id]]) {
      const shown = core.underFocus(items, ix, fid)
      const tree = core.dayTree(shown, ix, fid, TODAY, NOW, WINDOW)
      golden[`${day}.${who}.${fname}.json`] = {
        cell: core.dayCell(day, shown, ix, fid, TODAY, NOW, WINDOW),
        legend: core.legend(shown, ix, fid),
        tree: { total: tree.total, people: tree.people, unplaced: tree.unplaced.map((p) => ({ userId: p.userId, items: p.items.map((i) => i.key) })), root: brief(tree.root) },
        week: core.weekRows(shown, ix, fid, core.mondayOf(day), TODAY, NOW, WINDOW).map((r) => r.kind === "unit"
          ? { kind: r.kind, unit: r.unit.name, depth: r.depth, count: r.count }
          : r.kind === "unplaced"
            ? { kind: r.kind, depth: r.depth, count: r.count }
            : { kind: r.kind, unitId: r.unitId, userId: r.kind === "person" ? r.userId : null, depth: r.depth, days: r.days.map((d) => d.map((i) => i.key)) }),
        overdue: Object.fromEntries(items.map((i) => [i.key, core.overdueState(i, TODAY, NOW, WINDOW)])),
      }
    }
  }
}
mkdirSync(path.join(here, "fixtures", "golden-client"), { recursive: true })
for (const [file, value] of Object.entries(golden)) {
  const text = `${JSON.stringify(value, null, 1)}\n`
  const at = path.join(here, "fixtures", "golden-client", file)
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(at, text)
  test(`golden ${file}`, () => assert.equal(text, readFileSync(at, "utf8"), `${file} differs (UPDATE_GOLDEN=1 to accept)`))
}

test("A2 18 Sep, company: 8 tasks; dots FA 4, PATS 4, Suwara 1 in Bagan order", () => {
  const g = golden["2026-09-18.bod.top.json"]
  assert.equal(g.cell.count, 8)
  assert.deepEqual(g.cell.dots.map((d) => [ix.byId.get(d.unitId).name, d.count]), [["Framework Agency", 4], ["PATS", 4], ["Suwara", 1]])
  assert.equal(g.tree.total, 8)
})
test("A2 18 Sep, zoomed into FA: Project Management 1, Creative (group) 1, Multimedia 3", () => {
  const g = golden["2026-09-18.bod.fa.json"]
  assert.deepEqual(g.cell.dots.map((d) => [ix.byId.get(d.unitId).name, d.count]), [["Project Management", 1], ["Creative", 1], ["Multimedia", 3]])
  const creative = g.tree.root.children.find((c) => c.unit === "Creative")
  assert.equal(creative.children[0].unit, "Event")
})
test("A3 3 Oct: sections Finance & Tech, Framework Agency, PATS, Suwara", () => {
  const g = golden["2026-10-03.bod.top.json"]
  assert.deepEqual(g.tree.root.children.map((c) => c.unit), ["Finance & Tech", "Framework Agency", "PATS", "Suwara"])
})
test("A5 by person: Dava under Project Management, Hary with 2 tasks under Multimedia", () => {
  const g = golden["2026-09-18.bod.fa.json"]
  const pm = g.tree.root.children.find((c) => c.unit === "Project Management")
  assert.deepEqual(pm.people.map((p) => p.userId), [person("Dava Erlangga").userId])
  const mm = g.tree.root.children.find((c) => c.unit === "Multimedia")
  assert.equal(mm.people.find((p) => p.userId === person("Hary Ade Saputra").userId).items.length, 2)
})
test("People week: a PIC outside the chart beside charted PICs gets a row at the end", () => {
  const g = golden["2026-09-18.bod.top.json"]
  const at = g.week.findIndex((r) => r.kind === "unplaced")
  assert.ok(at > 0); assert.equal(g.week[at].count, g.tree.unplaced.length)
  assert.deepEqual(g.week.slice(at + 1).map((r) => r.userId), g.tree.unplaced.map((p) => p.userId))
})
test("no PIC → its project's division, listed without a person", () => {
  const g = golden["2026-09-18.bod.pats.json"]
  const ent = g.tree.root.children.find((c) => c.unit === "PATS Entertainment")
  assert.equal(ent.loose.length, 3); assert.equal(ent.people.length, 0)
})
test("overdue: within the window red, older grey, done never", () => {
  const sep18 = sg("items-2026-09-18.bod.json")
  const open = sep18.find((i) => !i.done && !i.noStatus)
  assert.equal(core.overdueState(open, TODAY, NOW, WINDOW), "stale", "17 days ago")
  assert.equal(core.overdueState(open, "2026-09-25", Date.parse("2026-09-25T05:00:00Z"), WINDOW), "recent")
  assert.equal(core.overdueState({ ...open, done: true }, TODAY, NOW, WINDOW), "none")
  assert.equal(core.overdueState({ ...open, noStatus: true }, TODAY, NOW, WINDOW), "none")
  const timed = { ...open, day: TODAY, time: "10:00", due: "2026-10-05T03:00:00.000Z" }
  assert.equal(core.overdueState(timed, TODAY, NOW, WINDOW), "recent", "10:00 WIB passed at 12:00")
  assert.equal(core.overdueState({ ...timed, time: null, due: "2026-10-05T00:00:00.000Z" }, TODAY, NOW, WINDOW), "none", "date-only due today")
})
test("filters: mine, my division, people, projects, priority, hide done", () => {
  const items = sg("items-2026-09-18.bod.json")
  const hary = person("Hary Ade Saputra").userId
  const ctx = { ix, meId: hary, myHomes: person("Hary Ade Saputra").homeUnitIds, today: TODAY, nowMs: NOW, windowDays: WINDOW }
  const f = (patch) => core.filterItems(items, { ...core.NO_FILTERS, ...patch }, ctx).length
  assert.equal(f({}), 8)
  assert.equal(f({ scope: "me" }), 2)
  assert.equal(f({ scope: "division" }), 3, "Multimedia")
  assert.equal(f({ units: [unit("PATS").id] }), 4)
  assert.equal(f({ hideDone: true }), items.filter((i) => !i.done).length)
  assert.equal(core.activeFilterCount({ ...core.NO_FILTERS, scope: "me", units: ["x"], hideDone: true }), 3)
})
test("month grid: Monday first, 42 days; month shift clamps the day", () => {
  const g = core.monthGrid("2026-10-18")
  assert.equal(g.length, 42); assert.equal(g[0], "2026-09-28"); assert.equal(g[41], "2026-11-08")
  assert.equal(core.shiftMonth("2026-01-31", 1), "2026-02-28")
  assert.equal(core.shiftMonth("2026-12-15", 1), "2027-01-15")
})

console.log(`calendar client core: ${passed} checks passed`)
