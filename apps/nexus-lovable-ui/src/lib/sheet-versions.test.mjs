// node --experimental-strip-types src/lib/sheet-versions.test.mjs   (from apps/nexus-lovable-ui)
//
// Version history: bursts of edits → versions grouped by day, named versions, the sheet at a version.
import assert from "node:assert/strict"

const V = await import("./sheet-versions.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const ann = { id: "u1", name: "Ann" }
const bob = { id: "u2", name: "Bob" }
const rev = (createdAt, rowId, columnId, oldValue, newValue, author = ann) => ({ rowId, columnId, oldValue, newValue, createdAt, author })

// Times in UTC; Jakarta is +7, so 2026-10-12T16:30Z is already 13 Oct there.
const revs = [
  rev("2026-10-12T03:00:00Z", "r1", "a", null, 1),
  rev("2026-10-12T03:10:00Z", "r1", "b", null, "x", bob),
  rev("2026-10-12T03:20:00Z", "r1", "a", 1, 2),
  rev("2026-10-12T05:00:00Z", "r2", "a", null, 7),
  rev("2026-10-12T16:30:00Z", "r1", "a", 2, 3, bob),
]

{
  const days = V.groupVersions(revs, [])
  eq(days[0].day, "2026-10-12", "16:30Z is 23:30 WIB on the 12th")
  const all = days.flatMap((d) => d.versions)
  eq(all.length, 3, "three bursts: 03:00–03:20, 05:00, 16:30")
  eq(all[0].current, true, "newest is current")
  eq(all[1].current, undefined, "only one current")
  eq(all[2].count, 3, "first burst has 3 edits")
  eq(all[2].at, "2026-10-12T03:20:00Z", "version at = its last edit")
  eq(all[2].from, "2026-10-12T03:00:00Z", "version from = its first edit")
  eq(all[2].authors.map((a) => a.id), ["u1", "u2"], "authors, newest editor first")
  eq(V.groupVersions(revs, [], { gapMinutes: 5 }).flatMap((d) => d.versions).length, 5, "a 5-minute gap splits every edit")
  eq(V.groupVersions([], []), [], "no revisions, no versions")
}
{
  // Day boundary in Jakarta time.
  const d = V.groupVersions([rev("2026-10-12T16:50:00Z", "r1", "a", 1, 2), rev("2026-10-12T17:05:00Z", "r1", "a", 2, 3)], [])
  eq(d.map((x) => x.day), ["2026-10-13", "2026-10-12"], "midnight WIB splits the burst")
  eq(V.dayKey("2026-10-12T17:00:00Z"), "2026-10-13", "dayKey uses +7")
  eq(V.dayKey("2026-10-12T17:00:00Z", 0), "2026-10-12", "dayKey with offset 0")
}
{
  // Naming splits a burst and labels the version.
  const named = [{ name: "Before cleanup", at: "2026-10-12T03:10:00Z" }]
  const all = V.groupVersions(revs, named).flatMap((d) => d.versions)
  eq(all.length, 4, "a named version cuts the 03:00–03:20 burst")
  eq(all[3].name, "Before cleanup", "named version labelled")
  eq(all[3].at, "2026-10-12T03:10:00Z", "named version ends at its time")
  eq(all[2].name, undefined, "later version unnamed")
  const renamed = V.groupVersions(revs, [...named, { name: "Renamed", at: "2026-10-12T03:10:00Z" }]).flatMap((d) => d.versions)
  eq(renamed[3].name, "Renamed", "latest naming wins")
}
{
  const rows = [{ id: "r1", cells: { a: 3, b: "x" } }, { id: "r2", cells: { a: 7 } }]
  const s = V.stateAt(rows, revs, "2026-10-12T03:00:00Z")
  eq(s.rows[0].cells, { a: 1 }, "r1 as of 03:00: a=1, b not yet written")
  eq(s.rows[1].cells, {}, "r2 empty at 03:00")
  eq([...s.changed].sort(), ["r1:a", "r1:b", "r2:a"], "changed cells")
  eq(rows[0].cells, { a: 3, b: "x" }, "input rows untouched")
  const now = V.stateAt(rows, revs, "2026-10-12T16:30:00Z")
  eq(now.rows, rows, "at the newest edit = current")
  eq(now.changed.size, 0, "nothing changed")
  const ghost = V.stateAt(rows, [rev("2026-10-12T20:00:00Z", "gone", "a", 1, 2)], "2026-10-12T00:00:00Z")
  eq(ghost.rows, rows, "revisions of deleted rows skipped")
  const back = V.stateAt([{ id: "r1", cells: { a: 5 } }], [rev("2026-10-12T04:00:00Z", "r1", "a", 5, 6), rev("2026-10-12T05:00:00Z", "r1", "a", 6, 5)], "2026-10-12T03:00:00Z")
  eq(back.changed.size, 0, "edited and put back = not changed")
}
{
  eq([...V.changedSince(revs, "2026-10-12T05:00:00Z")], [["r1:a", "u2"]], "changedSince is exclusive")
  const m = V.changedBetween(revs, "2026-10-12T02:00:00Z", "2026-10-12T03:20:00Z")
  eq([...m.keys()].sort(), ["r1:a", "r1:b"], "changedBetween window")
  eq(m.get("r1:a"), "u1", "latest editor in the window")
  const days = V.groupVersions(revs, [])
  eq(V.previousVersionAt(days, "2026-10-12T05:00:00Z"), "2026-10-12T03:20:00Z", "previous version")
  eq(V.previousVersionAt(days, "2026-10-12T03:20:00Z"), null, "oldest has no previous")
}

console.log(`sheet-versions: ${n} checks passed`)
