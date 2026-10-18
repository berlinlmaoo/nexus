// node src/lib/presence-core.test.mjs   (node ≥ 22.6 strips the types of the .ts it imports)
import assert from "node:assert/strict"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const m = await import(pathToFileURL(path.join(here, "presence-core.ts")).href)
const { decidePresence, checkManualStatus, parseWibTime, samePresence, nextClockEdge } = m

const now = new Date("2026-10-20T05:00:00Z") // 12:00 WIB
const base = { userId: "u1", now, manual: null, open: null, checkedOutAt: null, request: null, notExpected: null, windows: [] }
const win = { start: new Date("2026-10-20T02:00:00Z"), end: new Date("2026-10-20T11:00:00Z") } // 09:00–18:00 WIB
let n = 0
const t = (name, fn) => { fn(); n++; }

t("checked in, inside → Online · In the office", () => {
  const s = decidePresence({ ...base, open: { checkInAt: new Date("2026-10-20T02:05:00Z"), outsideSince: null, checkInAway: false } })
  assert.equal(s.state, "online"); assert.equal(s.tone, "green"); assert.equal(s.label.id, "Online · Di kantor"); assert.equal(s.label.en, "Online · In the office")
})
t("outside episode → Away · Out of the office", () => {
  const s = decidePresence({ ...base, open: { checkInAt: new Date("2026-10-20T02:05:00Z"), outsideSince: new Date("2026-10-20T04:00:00Z"), checkInAway: false } })
  assert.equal(s.state, "away"); assert.equal(s.reason, "out_of_office"); assert.equal(s.label.id, "Away · Di luar kantor"); assert.equal(s.since, "2026-10-20T04:00:00.000Z")
})
t("location-free check-in away from the office → Away", () => {
  const s = decidePresence({ ...base, open: { checkInAt: now, outsideSince: null, checkInAway: true } })
  assert.equal(s.reason, "out_of_office")
})
t("manual running wins over everything", () => {
  const manual = { id: "m1", text: "Potong rambut", startsAt: new Date("2026-10-20T04:00:00Z"), endsAt: new Date("2026-10-20T06:00:00Z") }
  const s = decidePresence({ ...base, manual, open: { checkInAt: now, outsideSince: null, checkInAway: false }, request: { type: "SICK", endDay: "2026-10-20" } })
  assert.equal(s.state, "away"); assert.equal(s.reason, "custom"); assert.equal(s.label.en, "Away · Potong rambut"); assert.equal(s.until, "2026-10-20T06:00:00.000Z")
})
t("manual later today: not yet, but reported", () => {
  const manual = { id: "m1", text: "Potong rambut", startsAt: new Date("2026-10-20T11:00:00Z"), endsAt: new Date("2026-10-20T13:00:00Z") }
  const s = decidePresence({ ...base, manual, open: { checkInAt: now, outsideSince: null, checkInAway: false } })
  assert.equal(s.state, "online"); assert.equal(s.manual.text, "Potong rambut")
  assert.equal(nextClockEdge({ ...base, manual, windows: [win] }), new Date("2026-10-20T11:00:00Z").getTime())
})
t("manual ended → ignored", () => {
  const manual = { id: "m1", text: "x", startsAt: new Date("2026-10-20T01:00:00Z"), endsAt: new Date("2026-10-20T05:00:00Z") }
  const s = decidePresence({ ...base, manual, windows: [win] })
  assert.equal(s.state, "not_checked_in"); assert.equal(s.manual, null)
})
t("approved sick → Sick leave (red)", () => {
  const s = decidePresence({ ...base, request: { type: "SICK", endDay: "2026-10-21" }, windows: [win] })
  assert.equal(s.state, "sick"); assert.equal(s.tone, "red"); assert.equal(s.label.id, "Sakit"); assert.equal(s.until, "2026-10-21")
})
t("leave / day off / red date", () => {
  assert.equal(decidePresence({ ...base, request: { type: "LEAVE", endDay: "2026-10-20" } }).label.id, "Cuti")
  assert.equal(decidePresence({ ...base, request: { type: "DAY_OFF", endDay: "2026-10-20" } }).label.en, "Day off")
  assert.equal(decidePresence({ ...base, request: { type: "RED_DATE", endDay: "2026-10-20" } }).tone, "grey")
  assert.equal(decidePresence({ ...base, request: { type: "PERMIT", endDay: "2026-10-20" } }).label.id, "Away · Izin")
})
t("checked-in beats an approved request (they are working)", () => {
  assert.equal(decidePresence({ ...base, open: { checkInAt: now, outsideSince: null, checkInAway: false }, request: { type: "LEAVE", endDay: "2026-10-20" } }).state, "online")
})
t("in shift window, no check-in → Not checked in yet", () => {
  const s = decidePresence({ ...base, windows: [win] })
  assert.equal(s.state, "not_checked_in"); assert.equal(s.label.id, "Belum check-in")
})
t("before shift / after shift → Offline", () => {
  assert.equal(decidePresence({ ...base, now: new Date("2026-10-20T01:00:00Z"), windows: [win] }).state, "offline")
  assert.equal(decidePresence({ ...base, now: new Date("2026-10-20T12:00:00Z"), windows: [win] }).state, "offline")
})
t("checked out → Offline · Checked out", () => {
  const s = decidePresence({ ...base, checkedOutAt: new Date("2026-10-20T04:00:00Z"), windows: [win] })
  assert.equal(s.label.en, "Offline · Checked out"); assert.equal(s.tone, "black")
})
t("BoD without check-in → Offline (never 'not checked in')", () => {
  assert.equal(decidePresence({ ...base, notExpected: "exempt", windows: [win] }).state, "offline")
})
t("rest day → Offline · Not a workday", () => {
  assert.equal(decidePresence({ ...base, notExpected: "not_a_workday" }).label.id, "Offline · Bukan hari kerja")
})
t("manual checks", () => {
  const ok = checkManualStatus({ text: "  Potong   rambut ", startsAt: new Date("2026-10-20T11:00:00Z"), endsAt: new Date("2026-10-20T13:00:00Z") }, now)
  assert.equal(ok.text, "Potong rambut")
  assert.throws(() => checkManualStatus({ text: "", startsAt: null, endsAt: new Date("2026-10-20T13:00:00Z") }, now), /status/)
  assert.throws(() => checkManualStatus({ text: "x", startsAt: null, endsAt: new Date("2026-10-20T04:00:00Z") }, now), (e) => e.code === "END_PAST")
  assert.throws(() => checkManualStatus({ text: "x", startsAt: new Date("2026-10-20T13:00:00Z"), endsAt: new Date("2026-10-20T12:00:00Z") }, now), (e) => e.code === "END_BEFORE_START")
  assert.throws(() => checkManualStatus({ text: "x".repeat(81), startsAt: null, endsAt: new Date("2026-10-20T13:00:00Z") }, now), (e) => e.code === "TEXT")
  assert.throws(() => checkManualStatus({ text: "x", startsAt: null, endsAt: new Date("2026-11-20T13:00:00Z") }, now), (e) => e.code === "TOO_LONG")
  // a start already passed = from now
  assert.equal(checkManualStatus({ text: "x", startsAt: new Date("2026-10-20T01:00:00Z"), endsAt: new Date("2026-10-20T13:00:00Z") }, now).startsAt.getTime(), now.getTime())
})
t("WIB parsing", () => {
  assert.equal(parseWibTime("2026-10-20 18:00").toISOString(), "2026-10-20T11:00:00.000Z")
  assert.equal(parseWibTime("2026-10-20T18:00").toISOString(), "2026-10-20T11:00:00.000Z")
  assert.equal(parseWibTime("20:00", "2026-10-20").toISOString(), "2026-10-20T13:00:00.000Z")
  assert.equal(parseWibTime("18.30", null, now).toISOString(), "2026-10-20T11:30:00.000Z")
  assert.equal(parseWibTime("2026-10-20T11:00:00.000Z").toISOString(), "2026-10-20T11:00:00.000Z")
  assert.equal(parseWibTime("besok jam 6"), null)
  assert.equal(parseWibTime("25:00", "2026-10-20"), null)
})
t("samePresence", () => {
  const a = decidePresence({ ...base, windows: [win] })
  assert.ok(samePresence(a, decidePresence({ ...base, windows: [win] })))
  assert.ok(!samePresence(a, decidePresence({ ...base, notExpected: "exempt" })))
})
console.log(`presence-core: ${n} passed`)
