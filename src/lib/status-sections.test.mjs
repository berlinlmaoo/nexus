// node --experimental-strip-types src/lib/status-sections.test.mjs
// Sections are the status options: where a task goes when its status changes (owner, 12 Oct 2026).
import assert from "node:assert/strict"

const S = await import("./status-sections.ts")
let n = 0
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++ }
const secs = [
  { id: "todo", taskStatus: "TODO", position: 0 },
  { id: "backlog", taskStatus: "TODO", position: 1 },
  { id: "doing", taskStatus: "IN_PROGRESS", position: 2 },
  { id: "done", taskStatus: "DONE", position: 3 },
  { id: "plain", taskStatus: null, position: 4 },
]
eq(S.pickStatusSection(secs, "todo", "DONE"), "done", "checked done → Done column")
eq(S.pickStatusSection(secs, "done", "TODO"), "todo", "back to the FIRST To-do option")
eq(S.pickStatusSection(secs, "backlog", "TODO"), null, "already a To-do option: stays")
eq(S.pickStatusSection(secs, "doing", "IN_REVIEW"), null, "no review column, same group: stays")
eq(S.pickStatusSection(secs, "todo", "IN_REVIEW"), "doing", "no exact column: first of the group")
eq(S.pickStatusSection(secs, "doing", "CANCELLED"), "done", "cancelled with no Cancelled column → Complete group")
eq(S.pickStatusSection(secs, "plain", "DONE"), null, "plain section: old behaviour")
eq(S.pickStatusSection([...secs, { id: "review", taskStatus: "IN_REVIEW", position: 5 }], "doing", "IN_REVIEW"), "review", "exact wins")
eq(S.statusGroup("IN_REVIEW"), "in_progress")
console.log(`status-sections: ${n} checks passed`)
