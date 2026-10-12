// node --experimental-strip-types src/lib/gideon-cite.test.mjs   (from apps/nexus-lovable-ui)
//
// GIDEON reply safety net: ids → links or nothing, enums → labels, Sources = only what the answer names.
import assert from "node:assert/strict"

const C = await import("./gideon-cite.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const refs = [
  { kind: "project", id: "cmv4p5aaa001a01o0zzzzqa01", title: "ZZ Audit QA", url: "/projects/cmv4p5aaa001a01o0zzzzqa01" },
  { kind: "task", id: "cmv4p6vfj002g01o02kk6air3", title: "Rundown draft", url: "/tasks/cmv4p6vfj002g01o02kk6air3" },
  { kind: "task", id: "cmv4p6rjv001u01o0x93abehd", title: "Brief for the October launch", url: "/tasks/cmv4p6rjv001u01o0x93abehd" },
  { kind: "task", id: "cmv4p0000001u01o0x93zzzzz", title: "TAKE PHOTO @ PATS X", url: "/tasks/cmv4p0000001u01o0x93zzzzz" },
]
const labels = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled", URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "None" }

// The screenshot's lines.
eq(C.tidyGideonText("**Rundown draft** — IN_PROGRESS, due 11 Oktober 2026 → overdue. (`cmv4p6vfj002g01o02kk6air3`)", refs, labels),
  "**[Rundown draft](/tasks/cmv4p6vfj002g01o02kk6air3)** — In progress, due 11 Oktober 2026 → overdue.")
eq(C.tidyGideonText("Brief — TODO, due 14 Oktober 2026. (`cmv4p6rjv001u01o0x93abehd`)", refs, labels),
  "Brief — To do, due 14 Oktober 2026. ([Brief for the October launch](/tasks/cmv4p6rjv001u01o0x93abehd))")
// Unknown id: dropped, with its brackets.
eq(C.tidyGideonText("Post-event report — DONE. (`cmv4p6xnc002s01o0jb7pkj7e`)", refs, labels), "Post-event report — Done.")
eq(C.tidyGideonText("Venue shortlist (id: cmv4p6tv6002601o0flevy0mk, due Friday)", refs, labels), "Venue shortlist (due Friday)")
eq(C.tidyGideonText("Task id `3f2b6c1e-9a7d-4b1e-8c2f-0a1b2c3d4e5f` selesai", refs, labels), "Task selesai")
// An id inside a link URL stays; the label is untouched.
eq(C.tidyGideonText("[Rundown draft](/tasks/cmv4p6vfj002g01o02kk6air3) HIGH", refs, labels), "[Rundown draft](/tasks/cmv4p6vfj002g01o02kk6air3) High")
// Ordinary words, lowercase enums and long words are left alone.
eq(C.tidyGideonText("Status done, priority high; communicationsdepartment", refs, labels), "Status done, priority high; communicationsdepartment")
eq(C.tidyGideonText("Totalnya 4 task: 2 TODO, 1 IN_PROGRESS, dan 1 DONE", refs, { ...labels, TODO: "Belum dikerjakan", IN_PROGRESS: "Sedang dikerjakan", DONE: "Selesai" }),
  "Totalnya 4 task: 2 Belum dikerjakan, 1 Sedang dikerjakan, dan 1 Selesai")
eq(C.looksLikeId("cmv4p6vfj002g01o02kk6air3"), true)
eq(C.looksLikeId("ccccccccccccccccccccccc"), false)

// Sources: only what the answer names.
const reply = "Ringkasan **ZZ Audit QA**: Rundown draft telat; brief for the  october launch belum."
eq(C.citedSources(reply, refs).map((r) => r.title), ["ZZ Audit QA", "Rundown draft", "Brief for the October launch"])
eq(C.citedSources("see cmv4p0000001u01o0x93zzzzz", refs).map((r) => r.title), ["TAKE PHOTO @ PATS X"])
eq(C.citedSources("", refs), [])

console.log(`gideon-cite: ${n} checks passed`)
