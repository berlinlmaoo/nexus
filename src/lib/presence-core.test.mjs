// node src/lib/presence-core.test.mjs   (node ≥ 22.6 strips the types of the .ts it imports)
import assert from "node:assert/strict"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const m = await import(pathToFileURL(path.join(here, "presence-core.ts")).href)
const { decidePresence, checkManualStatus, parseWibTime, samePresence, nextClockEdge, parseAvailability, availabilityFromDb, availabilityToDb } = m

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
t("N-1 availability: default Away (old clients send nothing; old rows carry none)", () => {
  for (const v of [undefined, null, ""]) assert.equal(parseAvailability(v), "away")
  const end = new Date("2026-10-20T13:00:00Z")
  assert.equal(checkManualStatus({ text: "x", startsAt: null, endsAt: end }, now).availability, "away")
  // a manual without availability (row/facts from before the column) → exactly the old Away status
  const manual = { id: "m1", text: "Meeting", startsAt: new Date("2026-10-20T04:00:00Z"), endsAt: new Date("2026-10-20T06:00:00Z") }
  const s = decidePresence({ ...base, manual })
  assert.equal(s.state, "away"); assert.equal(s.tone, "yellow"); assert.equal(s.label.en, "Away · Meeting"); assert.equal(s.availability, "away"); assert.equal(s.manual.availability, "away")
  assert.equal(availabilityFromDb(null), "away"); assert.equal(availabilityFromDb("weird"), "away")
})
t("N-1 availability: validation (any case accepted, anything else refused)", () => {
  assert.equal(parseAvailability("ONLINE"), "online"); assert.equal(parseAvailability(" Dnd "), "dnd"); assert.equal(parseAvailability("away"), "away")
  for (const bad of ["busy", "do not disturb", 1, true, {}, ["dnd"]]) assert.throws(() => parseAvailability(bad), (e) => e.code === "AVAILABILITY")
  assert.throws(() => checkManualStatus({ text: "x", startsAt: null, endsAt: new Date("2026-10-20T13:00:00Z"), availability: "offline" }, now), (e) => e.code === "AVAILABILITY")
  assert.equal(availabilityToDb("dnd"), "DND"); assert.equal(availabilityToDb("online"), "ONLINE"); assert.equal(availabilityToDb("away"), "AWAY")
  for (const a of ["online", "away", "dnd"]) assert.equal(availabilityFromDb(availabilityToDb(a)), a)
})
t("N-1 availability: Online / Do not disturb manual statuses", () => {
  const at = (availability) => ({ id: "m1", text: "Meeting", startsAt: new Date("2026-10-20T04:00:00Z"), endsAt: new Date("2026-10-20T06:00:00Z"), availability })
  const on = decidePresence({ ...base, manual: at("online") })
  assert.equal(on.state, "online"); assert.equal(on.tone, "green"); assert.equal(on.reason, "custom"); assert.equal(on.label.en, "Online · Meeting"); assert.equal(on.availability, "online")
  const dnd = decidePresence({ ...base, manual: at("dnd"), open: { checkInAt: now, outsideSince: null, checkInAway: false } })
  assert.equal(dnd.state, "dnd"); assert.equal(dnd.tone, "red"); assert.equal(dnd.label.en, "Do not disturb · Meeting"); assert.equal(dnd.label.id, "Jangan diganggu · Meeting")
  assert.equal(dnd.until, "2026-10-20T06:00:00.000Z"); assert.equal(dnd.manual.availability, "dnd")
  // no manual running → availability null; a scheduled one still reports its availability
  const later = { ...at("dnd"), startsAt: new Date("2026-10-20T11:00:00Z"), endsAt: new Date("2026-10-20T13:00:00Z") }
  const sched = decidePresence({ ...base, manual: later, windows: [win] })
  assert.equal(sched.state, "not_checked_in"); assert.equal(sched.availability, null); assert.equal(sched.manual.availability, "dnd")
  // changing only the availability is a change everyone must see
  assert.ok(!samePresence(decidePresence({ ...base, manual: at("away") }), decidePresence({ ...base, manual: at("dnd") })))
  assert.ok(!samePresence(decidePresence({ ...base, manual: later, windows: [win] }), decidePresence({ ...base, manual: { ...later, availability: "online" }, windows: [win] })))
})
console.log(`presence-core: ${n} passed`)
