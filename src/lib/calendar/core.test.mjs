// node --experimental-strip-types src/lib/calendar/core.test.mjs        (UPDATE_GOLDEN=1 rewrites the golden files)
//
// Plain node, no test runner (like client-version.test.mjs). Two kinds of checks:
//  1. GOLDEN — the Bagan and the tasks of 18 Sep and 3 Oct 2026, exported read-only from production
//     (titles replaced by "Task <md5>", emails and avatars dropped), through the same rules the
//     endpoints use. The output is compared byte for byte with fixtures/golden/*.json; the iOS and
//     Android ports are checked against the same files. The numbers the owner signed off on (plan,
//     criteria A2/A3) are asserted on top, so a regenerated golden cannot quietly change them.
//  2. EDGE CASES — WIB days and times, overdue, loops in the Bagan, private projects, settings.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const core = await import(pathToFileURL(path.join(here, "core.ts")).href)
const fx = (f) => JSON.parse(readFileSync(path.join(here, "fixtures", f), "utf8"))
let passed = 0
const test = (name, fn) => { fn(); passed++; }

// ── Golden ──────────────────────────────────────────────────────────────────────────────────────────
const units = fx("units.json"), people = fx("people.json"), links = fx("links.json")
const s = core.buildStructure(units, people, links)
// The two folders set by hand in production (AppSetting "calendar", 5 Oct 2026); the rest follows names.
const SETTINGS = { ...core.CALENDAR_SETTINGS_DEFAULTS, folderUnits: { cm_jagain_folder: "ou47f297a5be7b0f6fbbae754", cmqpiuy72011901pcc89h8uu1: "oub7186507c81bf7f984bb416" } }
const division = core.projectUnits(fx("projects.json"), fx("folders.json"), s.units, SETTINGS)
const unitByName = (n) => s.units.find((u) => u.name === n)
const personByName = (n) => s.people.find((p) => p.name === n)
const ctxFor = (viewer) => ({
  viewer, settings: SETTINGS,
  homeUnitsOf: new Map(s.people.map((p) => [p.userId, p.homeUnitIds])),
  unitRank: new Map(s.units.map((u) => [u.id, u.rank])),
  projectUnitOf: new Map([...division].map(([id, v]) => [id, v.unitId])),
  maskKey: (id) => `x_${Buffer.from(id).toString("base64url").slice(-12)}`,
})
const BOD = { userId: "golden-bod", full: true, memberProjectIds: new Set() }
const STAFF = { userId: "golden-staff", full: false, memberProjectIds: new Set() }
const rows = (day) => fx(`tasks-${day}.json`).map((t) => ({ ...t, dueDate: new Date(t.dueDate) }))

const golden = {
  "structure.json": s,
  "project-divisions.json": Object.fromEntries([...division].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  "items-2026-09-18.bod.json": core.buildItems(rows("2026-09-18"), ctxFor(BOD)),
  "items-2026-09-18.staff.json": core.buildItems(rows("2026-09-18"), ctxFor(STAFF)),
  "items-2026-10-03.bod.json": core.buildItems(rows("2026-10-03"), ctxFor(BOD)),
  "items-2026-10-03.staff.json": core.buildItems(rows("2026-10-03"), ctxFor(STAFF)),
}
mkdirSync(path.join(here, "fixtures", "golden"), { recursive: true })
for (const [file, value] of Object.entries(golden)) {
  const text = `${JSON.stringify(value, null, 1)}\n`
  const at = path.join(here, "fixtures", "golden", file)
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(at, text)
  test(`golden ${file}`, () => assert.equal(text, readFileSync(at, "utf8"), `${file} differs from the golden file (UPDATE_GOLDEN=1 to accept)`))
}

test("structure: the order of the Bagan under the top", () => {
  const top = s.units.find((u) => u.parentId === null)
  const row = s.units.filter((u) => u.parentId === top.id).map((u) => u.name)
  assert.deepEqual(row, ["Finance & Tech", "Framework Agency", "Geneziz", "Z Foundation", "PATS", "INTOO", "Suwara"])
})
test("structure: Creative is a group in Framework Agency; FA's eight cards differ from each other and from FA", () => {
  const fa = unitByName("Framework Agency"), cr = unitByName("Creative")
  assert.equal(cr.kind, "GROUP"); assert.equal(cr.sectionId, fa.id); assert.equal(unitByName("Event").parentId, cr.id)
  const under = s.units.filter((u) => u.sectionId === fa.id && u.kind !== "GROUP" && u.id !== fa.id)
  assert.equal(under.length, 8)
  assert.equal(new Set([...under.map((u) => u.color), fa.color]).size, 9)
  assert.ok(unitByName("KOL Management"), "an empty unit is still in the structure")
})
test("structure: no card has the colour of its own section", () => {
  for (const u of s.units) {
    if (u.kind === "GROUP" || u.depth < 2) continue
    assert.notEqual(u.color, s.units.find((x) => x.id === u.sectionId).color, u.name)
  }
})
test("structure: home units (deepest card)", () => {
  const homes = (n) => personByName(n).homeUnitIds.map((id) => s.units.find((u) => u.id === id).name)
  assert.deepEqual(homes("Henryca Aprillyana"), ["Framework Agency", "PATS", "INTOO", "Suwara"])
  assert.deepEqual(homes("Geraldo Valentino"), ["Finance & Tech"])
  assert.deepEqual(homes("Queen Lourdes Purba Tambak"), ["PATS X", "PATS BSD"])
  assert.deepEqual(homes("Fortunatus Narendra"), [])
})
test("structure: no email, no canvas position, no job titles", () => {
  const text = JSON.stringify(s)
  for (const k of ['"email"', '"layoutX"', '"layoutY"', '"boxLayout"', '"titles"', '"title"']) assert.ok(!text.includes(k), k)
})
test("project divisions: folders mirror the Bagan", () => {
  const projects = fx("projects.json")
  const at = (name) => s.units.find((u) => u.id === division.get(projects.find((p) => p.name === name).id).unitId).name
  const why = (name) => division.get(projects.find((p) => p.name === name).id).why
  assert.equal(at("PATS Archive: Master Calendar"), "PATS Archive")
  assert.equal(at("PATS Entertainment: Master Calendar"), "PATS Entertainment")
  assert.equal(at("PATS X: Master Calendar"), "PATS X")
  assert.equal(at("PATS BSD: Master Calendar"), "PATS BSD")
  assert.equal(at("Rosi Senopati: Master Calendar"), "PATS", "PATS Nightlife › Rosi Senopati → PATS")
  assert.equal(at("PATS Socials: Content Pipeline"), "PATS")
  assert.equal(at("SPECIAL BUSINESS UNIT"), "PATS")
  assert.equal(at("FRAMEWORKZ : Z Creative Task"), "Framework Agency")
  assert.equal(at("PRIMARIA: General Task"), "Framework Agency", "THE Z CREATIVE, set by hand"); assert.equal(why("PRIMARIA: General Task"), "folder")
  assert.equal(at("Finance PATS Entertainment"), "Finance & Tech")
  assert.equal(at("Legal"), "Finance & Tech", "Z MANAGEMENT, set by hand")
  assert.equal(at("SUWARA MASTER CALENDAR"), "Suwara")
  assert.equal(at("INTOO GEN Z"), "INTOO")
  assert.equal(at("GENEZIZ - DIGITAL"), "Geneziz")
  assert.equal(at("PATS UNIVERSITY"), "PATS University"); assert.equal(why("PATS UNIVERSITY"), "project-name")
  assert.equal(at("INTOO Master Schedule"), "INTOO")
  assert.equal(why("PESTA DARI SELATAN"), "top")
  const bare = core.projectUnits(projects, fx("folders.json"), s.units, core.CALENDAR_SETTINGS_DEFAULTS)
  assert.equal(bare.get(projects.find((p) => p.name === "Legal").id).why, "top", "without the hand-set folder")
})
test("18 Sep (A2, decision 4 revised): 8 tasks; FA 4 (PM 1, Event 1, Multimedia 3), PATS 4 (3 without PIC → PATS Entertainment), Suwara 1", () => {
  const items = golden["items-2026-09-18.bod.json"]
  assert.equal(items.length, 8)
  const inUnit = (n) => items.filter((i) => i.placements.some((p) => p.unitId === unitByName(n).id)).length
  const inSection = (n) => items.filter((i) => i.placements.some((p) => s.units.find((u) => u.id === p.unitId).sectionId === unitByName(n).id)).length
  assert.equal(inSection("Framework Agency"), 4)
  assert.equal(inUnit("Project Management"), 1)
  assert.equal(inUnit("Event"), 1)
  assert.equal(inUnit("Multimedia"), 3)
  assert.equal(inSection("PATS"), 4)
  assert.equal(inUnit("PATS Entertainment"), 3)
  assert.equal(inSection("Suwara"), 1)
  const noPic = items.filter((i) => i.assigneeIds.length === 0)
  assert.equal(noPic.length, 3)
  for (const i of noPic) { assert.equal(i.placedBy, "project"); assert.deepEqual(i.placements[0].userIds, []) }
  assert.equal(items.filter((i) => i.placements.length === 0).length, 0, "every task has a division")
  assert.equal(items.filter((i) => i.unplacedIds.length > 0).length, 1, "Fortunatus, beside placed PICs")
})
test("3 Oct (A3): sections Finance & Tech, Framework Agency, PATS, Suwara", () => {
  const items = golden["items-2026-10-03.bod.json"]
  const secs = new Set(items.flatMap((i) => i.placements.map((p) => s.units.find((u) => u.id === p.unitId).sectionId)))
  const order = s.units.filter((u) => secs.has(u.id)).map((u) => u.name)
  assert.deepEqual(order, ["Finance & Tech", "Framework Agency", "PATS", "Suwara"])
})
test("3 Oct: staff outside Finance see those tasks masked — no id, title or project", () => {
  const items = golden["items-2026-10-03.staff.json"]
  const masked = items.filter((i) => i.masked)
  assert.equal(masked.length, 4)
  for (const m of masked) {
    assert.equal(m.id, null); assert.equal(m.title, null); assert.equal(m.project, null); assert.equal(m.priority, null)
    assert.equal(m.canEdit, false); assert.ok(m.key.startsWith("x_"))
    assert.ok(m.placements.length > 0, "who and when stays (decision 1)")
  }
  assert.ok(!JSON.stringify(masked).includes("Finance"))
})

// ── Edge cases ──────────────────────────────────────────────────────────────────────────────────────
test("WIB day and time", () => {
  const d = (iso) => new Date(iso)
  assert.equal(core.wibDay(d("2026-09-17T17:00:00.000Z")), "2026-09-18"); assert.equal(core.wibTime(d("2026-09-17T17:00:00.000Z")), null)
  assert.equal(core.wibDay(d("2026-09-18T16:59:00.000Z")), "2026-09-18"); assert.equal(core.wibTime(d("2026-09-18T16:59:00.000Z")), "23:59")
  assert.equal(core.wibDay(d("2026-09-18T00:00:00.000Z")), "2026-09-18"); assert.equal(core.wibTime(d("2026-09-18T00:00:00.000Z")), null)
  assert.equal(core.wibTime(d("2026-09-18T12:00:00.000Z")), "19:00")
  assert.equal(core.dayStartUtc("2026-09-18").toISOString(), "2026-09-17T17:00:00.000Z")
  assert.ok(core.isDayKey("2026-02-28")); assert.ok(!core.isDayKey("2026-02-30")); assert.ok(!core.isDayKey("2026-9-1")); assert.ok(!core.isDayKey(null))
  assert.equal(core.addDays("2026-12-31", 1), "2027-01-01"); assert.equal(core.dayDiff("2026-09-01", "2026-10-31"), 60)
})
test("overdue: date-only at the end of the WIB day, timed at its moment", () => {
  const now = new Date("2026-10-05T05:00:00.000Z") // 12:00 WIB
  assert.equal(core.isOverdueAt(new Date("2026-10-05T00:00:00.000Z"), false, now), false, "date-only due today")
  assert.equal(core.isOverdueAt(new Date("2026-10-04T00:00:00.000Z"), false, now), true, "date-only due yesterday")
  assert.equal(core.isOverdueAt(new Date("2026-10-05T03:00:00.000Z"), false, now), true, "10:00 WIB today has passed")
  assert.equal(core.isOverdueAt(new Date("2026-10-05T09:00:00.000Z"), false, now), false, "16:00 WIB today has not")
  assert.equal(core.isOverdueAt(new Date("2026-10-01T00:00:00.000Z"), true, now), false, "done is never overdue")
})
test("Bagan with a missing parent and a loop still orders every unit once", () => {
  const u = (id, parentId, position = 0, kind = "DIVISION") => ({ id, name: id, kind, logoUrl: null, parentId, position, leadUserId: null })
  const st = core.buildStructure([u("top", null), u("a", "top", 1), u("orphan", "gone"), u("x", "y"), u("y", "x")], [], [])
  assert.deepEqual(st.units.map((x) => x.id).sort(), ["a", "orphan", "top", "x", "y"])
  assert.deepEqual(st.units.map((x) => x.rank), [0, 1, 2, 3, 4])
  assert.equal(st.units.find((x) => x.id === "orphan").parentId, null)
})
test("visibility: private projects, linked projects, own tasks, modes", () => {
  const row = (over) => ({ id: "t1", title: "Invoice", status: "TODO", priority: "HIGH", dueDate: new Date("2026-10-03T00:00:00.000Z"), creatorId: "c", parent: null,
    project: { id: "p1", name: "Ops", color: "#000" }, noStatus: false, linkedProjects: [], assigneeIds: [], ...over })
  const staff = (member = []) => ({ userId: "s", full: false, memberProjectIds: new Set(member) })
  const ctx = (viewer, settings = core.CALENDAR_SETTINGS_DEFAULTS) => ({ ...ctxFor(viewer), settings })
  const fin = { id: "pf", name: "Finance PATS", color: "#111" }
  assert.equal(core.visibilityOf(row({}), ctx(staff())), "full", "a normal project is open to everyone")
  assert.equal(core.visibilityOf(row({ project: fin }), ctx(staff())), "masked")
  assert.equal(core.visibilityOf(row({ linkedProjects: [{ id: "pl", name: "Legal" }] }), ctx(staff())), "masked", "linked into a private project")
  assert.equal(core.visibilityOf(row({ project: fin }), ctx(staff(["pf"]))), "full", "member of the private project")
  assert.equal(core.visibilityOf(row({ project: fin, linkedProjects: [{ id: "pl", name: "Ops 2" }] }), ctx(staff(["pl"]))), "full", "member of a linked project")
  assert.equal(core.visibilityOf(row({ project: fin, assigneeIds: ["s"] }), ctx(staff())), "full", "own task")
  assert.equal(core.visibilityOf(row({ project: fin, creatorId: "s" }), ctx(staff())), "full", "created it")
  assert.equal(core.visibilityOf(row({ project: fin }), ctx({ userId: "b", full: true, memberProjectIds: new Set() })), "full", "BoD/Manager")
  const off = { ...core.CALENDAR_SETTINGS_DEFAULTS, notPrivateProjectIds: ["pf"] }
  assert.equal(core.visibilityOf(row({ project: fin }), ctx(staff(), off)), "full", "toggled off in Control Room")
  const listed = { ...core.CALENDAR_SETTINGS_DEFAULTS, privateProjectIds: ["p1"] }
  assert.equal(core.visibilityOf(row({}), ctx(staff(), listed)), "masked", "toggled on in Control Room")
  assert.equal(core.visibilityOf(row({}), ctx(staff(), { ...core.CALENDAR_SETTINGS_DEFAULTS, visibility: "masked_foreign" })), "masked")
  assert.equal(core.visibilityOf(row({}), ctx(staff(), { ...core.CALENDAR_SETTINGS_DEFAULTS, visibility: "projects" })), "hidden")
  assert.equal(core.buildItem(row({}), ctx(staff(), { ...core.CALENDAR_SETTINGS_DEFAULTS, visibility: "projects" })), null)
  const empty = { ...core.CALENDAR_SETTINGS_DEFAULTS, privateNamePrefixes: [], privateProjectIds: [] }
  assert.equal(core.effectiveVisibility(empty), "masked_foreign", "no private project defined → hide foreign titles")
  const it = core.buildItem(row({ project: fin, assigneeIds: ["nobody"] }), ctx(staff()))
  assert.equal(it.id, null); assert.equal(it.title, null); assert.deepEqual(it.linkedProjectIds, []); assert.equal(it.unplacedIds[0], "nobody")
  const viaProject = core.buildItem(row({ assigneeIds: ["nobody"] }), { ...ctx(staff()), projectUnitOf: new Map([["p1", "u-ops"]]) })
  assert.equal(viaProject.placedBy, "project"); assert.deepEqual(viaProject.placements, [{ unitId: "u-ops", userIds: ["nobody"] }])
  assert.equal(core.buildItem(row({}), ctx(staff())).canEdit, false, "staff outside the project cannot edit")
  assert.equal(core.buildItem(row({}), ctx(staff(["p1"]))).canEdit, true)
})
test("a subtask never reveals a parent the viewer may not see; editProjectId; status-less projects", () => {
  const staff = (member = []) => ({ userId: "s", full: false, memberProjectIds: new Set(member) })
  const ctx = (viewer) => ({ ...ctxFor(viewer), settings: core.CALENDAR_SETTINGS_DEFAULTS })
  const row = (over) => ({ id: "child", title: "Kirim berkas", status: "TODO", priority: "MEDIUM", dueDate: new Date("2026-10-07T00:00:00.000Z"), creatorId: "c",
    project: { id: "sbu", name: "Special Business Unit", color: "#000" }, noStatus: false, linkedProjects: [], assigneeIds: [], parent: null, ...over })
  const finParent = { id: "parent", title: "Bayar pajak", creatorId: "c", projects: [{ id: "sbu", name: "Special Business Unit" }, { id: "fin", name: "Finance PATS" }], assigneeIds: ["p1"] }
  assert.equal(core.buildItem(row({ parent: finParent }), ctx(staff())).parent, null, "parent linked into Finance")
  assert.deepEqual(core.buildItem(row({ parent: finParent }), ctx(staff(["fin"]))).parent, { id: "parent", title: "Bayar pajak" })
  assert.deepEqual(core.buildItem(row({ parent: { ...finParent, assigneeIds: ["s"] } }), ctx(staff())).parent, { id: "parent", title: "Bayar pajak" }, "assigned to the parent")
  assert.deepEqual(core.buildItem(row({ parent: finParent }), ctx({ userId: "b", full: true, memberProjectIds: new Set() })).parent, { id: "parent", title: "Bayar pajak" })
  const linked = core.buildItem(row({ linkedProjects: [{ id: "ops2", name: "Ops 2" }] }), ctx(staff(["ops2"])))
  assert.equal(linked.canEdit, true); assert.equal(linked.editProjectId, "ops2")
  assert.equal(core.buildItem(row({}), ctx(staff(["sbu"]))).editProjectId, "sbu")
  assert.equal(core.buildItem(row({}), ctx(staff())).editProjectId, null)
  assert.equal(core.buildItem(row({ noStatus: true }), ctx(staff())).noStatus, true)
})
test("glance colours: project for me, my own card for division, the section for all", () => {
  const items = golden["items-2026-09-18.bod.json"]
  const anker = items.find((i) => i.placements.length === 3)
  const colors = (division) => ({ unitColor: new Map(s.units.map((u) => [u.id, u.color])), sectionColor: new Map(s.units.map((u) => [u.id, s.units.find((x) => x.id === u.sectionId).color])), division })
  const pats = core.subtreeOf(s.units, [unitByName("PATS").id])
  assert.equal(core.glanceEntry(anker, "division", colors(pats)).c, unitByName("PATS Archive").color)
  assert.equal(core.glanceEntry(anker, "all", colors(pats)).c, unitByName("Framework Agency").color)
  assert.equal(core.glanceEntry(anker, "me", colors(pats)).c, anker.project.color)
  assert.equal(core.glanceEntry({ ...anker, noStatus: true }, "me", colors(pats)).ns, true)
  assert.equal("ns" in core.glanceEntry(anker, "me", colors(pats)), false)
})
test("settings: bad values fall back, audience", () => {
  const n = core.normalizeCalendarSettings({ audience: "everyone", visibility: 3, overdueWindowDays: 0, urgentDays: 2, privateNamePrefixes: [" Finance ", "", 7], privateProjectIds: "x", folderUnits: { f1: "u1", f2: 5 } })
  assert.equal(n.audience, "all", "decision 14: everyone"); assert.deepEqual(n.folderUnits, { f1: "u1" }); assert.equal(n.visibility, "all_except_private"); assert.equal(n.overdueWindowDays, 14)
  assert.deepEqual(n.privateNamePrefixes, ["finance"]); assert.deepEqual(n.privateProjectIds, [])
  const a = (aud, orgRole, extra = {}) => core.inAudience({ ...core.CALENDAR_SETTINGS_DEFAULTS, audience: aud, ...extra }, { userId: "u", orgRole, isAdmin: false })
  assert.equal(a("bod", "BOD"), true); assert.equal(a("bod", "ONE_ABOVE_ALL"), true); assert.equal(a("bod", "MANAGER"), false)
  assert.equal(a("managers", "MANAGER"), true); assert.equal(a("managers", "STAFF"), false); assert.equal(a("all", "STAFF"), true)
  assert.equal(a("bod", "STAFF", { audienceUserIds: ["u"] }), true, "a tester")
})
test("glance window and cap", () => {
  assert.deepEqual(core.glanceWindow("2026-10-05", 14), { from: "2026-09-21", to: "2026-12-06" })
  assert.deepEqual(core.glanceWindow("2026-12-20", 14), { from: "2026-11-30", to: "2027-01-31" })
  const e = (day, done) => ({ id: day + done, t: "x", day, time: null, c: "#000", p: null, prio: "MEDIUM", done, m: false })
  const list = [e("2026-10-01", true), e("2026-10-02", false), e("2026-10-06", false), e("2026-10-30", false)]
  const r = core.capGlance(list, "2026-10-05", 3)
  assert.equal(r.truncated, true); assert.deepEqual(r.entries.map((x) => x.day), ["2026-10-02", "2026-10-06", "2026-10-30"])
  assert.deepEqual(core.capGlance(list, "2026-10-05", 2).entries.map((x) => x.day), ["2026-10-02", "2026-10-06"])
})

console.log(`calendar core: ${passed} checks passed`)
