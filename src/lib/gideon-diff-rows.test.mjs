// node --experimental-strip-types src/lib/gideon-diff-rows.test.mjs
import assert from "node:assert/strict"
import { changedDiffRows } from "./gideon-diff-rows.ts"

// The D-10 card: sales and pax unchanged.
const outlet = [
  { field: "Project", to: "Outlet PATS" },
  { field: "Date", to: "Mon 12 Oct", toDay: "2026-10-12" },
  { field: "Event", to: "TES" },
  { field: "Sales", from: "Rp 120.000.000", to: "Rp 120.000.000" },
  { field: "Pax", from: "750", to: " 750" },
]
let r = changedDiffRows(outlet)
assert.deepEqual(r.rows.map((x) => x.field), ["Project", "Date", "Event"])
assert.equal(r.noChange, true)

// One real change: only the equal row goes.
r = changedDiffRows([...outlet.slice(0, 3), { field: "Sales", from: "Rp 120.000.000", to: "Rp 125.000.000" }, outlet[4]])
assert.deepEqual(r.rows.map((x) => x.field), ["Project", "Date", "Event", "Sales"])
assert.equal(r.noChange, false)

// Equal figures but a new note: not "no change".
r = changedDiffRows([{ field: "Platform", to: "IG" }, { field: "Views", from: "10", to: "10" }, { field: "What worked", to: "Reels" }])
assert.equal(r.noChange, false)
assert.deepEqual(r.rows.map((x) => x.field), ["Platform", "What worked"])

// No before → after rows at all (a create card): untouched.
r = changedDiffRows([{ field: "Title", to: "A" }])
assert.equal(r.noChange, false)
assert.equal(r.rows.length, 1)

// "—" and empty are the same nothing; a different day behind the same label is a change.
assert.equal(changedDiffRows([{ field: "Due", from: "—", to: "" }]).noChange, true)
assert.equal(changedDiffRows([{ field: "Due", from: "Fri 23 Oct", to: "Fri 23 Oct", fromDay: "2026-10-23", toDay: "2027-10-23" }]).rows.length, 1)
console.log("gideon-diff-rows ok")
