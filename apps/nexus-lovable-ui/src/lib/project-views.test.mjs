// node --experimental-strip-types src/lib/project-views.test.mjs   (from apps/nexus-lovable-ui)
//
// Saved views: filter (simple + advanced AND/OR), sort, group, header calculations, URL round trip,
// the Overview drill, colours, config defaults.
import assert from "node:assert/strict"

const V = await import("./project-views.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const now = new Date(2026, 9, 12, 10, 0, 0) // Mon 12 Oct 2026, local
const day = (offset) => { const d = new Date(2026, 9, 12 + offset, 9, 0, 0); return d.toISOString() }

const ctx = {
  sections: [{ id: "s2", name: "Doing", position: 1 }, { id: "s1", name: "To do", position: 0 }],
  fields: [
    { id: "f1", name: "Channel", type: "SELECT", options: ["IG", "TikTok", "YouTube"], position: 0 },
    { id: "f2", name: "Budget", type: "NUMBER", options: { format: "currency-idr" }, position: 1 },
    { id: "f3", name: "Talent", type: "MULTI_SELECT", options: { options: ["Ana", "Budi"] }, position: 2 },
  ],
  people: [{ id: "u1", name: "Berlin" }, { id: "u2", name: "Ayu" }],
  meId: "u1",
  now,
}
const cf = (id, type, value) => ({ customFieldId: id, value, customField: { type } })
const T = [
  { id: "a", title: "Brief klien", status: "TODO", priority: "HIGH", dueDate: day(-2), taskListId: "s1", assignees: [{ user: { id: "u1", name: "Berlin" } }], tags: ["urgent"], customFieldValues: [cf("f1", "SELECT", "IG"), cf("f2", "NUMBER", "1500000")] },
  { id: "b", title: "Rundown acara", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: day(0), taskListId: "s2", assignees: [{ user: { id: "u2", name: "Ayu" } }], customFieldValues: [cf("f1", "SELECT", "TikTok"), cf("f2", "NUMBER", "500000"), cf("f3", "MULTI_SELECT", "[\"Ana\",\"Budi\"]")] },
  { id: "c", title: "Laporan pasca acara", status: "DONE", priority: "LOW", dueDate: day(3), taskListId: "s2", assignees: [], customFieldValues: [] },
  { id: "d", title: "Cari venue", status: "TODO", priority: "NONE", dueDate: null, taskListId: "s1", assignees: [{ user: { id: "u1", name: "Berlin" } }, { user: { id: "u2", name: "Ayu" } }], customFieldValues: [cf("f3", "MULTI_SELECT", "[\"Budi\"]")] },
]
const defs = V.propDefs(ctx)
const ids = (list) => list.map((t) => t.id)
const run = (filter, q = "") => ids(T.filter((t) => V.taskMatches(t, filter, q, defs, ctx)))
const rule = (prop, op, value) => ({ id: Math.random().toString(36).slice(2, 8), prop, op, ...(value === undefined ? {} : { value }) })

// properties
eq(defs.find((d) => d.key === "section").options.map((o) => o.label), ["To do", "Doing"], "sections in position order")
eq(defs.find((d) => d.key === "cf:f1").kind, "select")
eq(defs.find((d) => d.key === "cf:f3").options.map((o) => o.value), ["Ana", "Budi"], "options under {options}")

// simple filters
eq(run({ simple: [rule("status", "none_of", ["DONE"])], advanced: null }), ["a", "b", "d"], "hide done")
eq(run({ simple: [rule("assignee", "any_of", [V.ME])], advanced: null }), ["a", "d"], "assignee = me")
eq(run({ simple: [rule("assignee", "empty")], advanced: null }), ["c"], "unassigned")
eq(run({ simple: [rule("due", "overdue")], advanced: null }), ["a"], "overdue (done ones excluded)")
eq(run({ simple: [rule("due", "next_days", 7)], advanced: null }), ["b", "c"], "next 7 days = today … +6")
eq(run({ simple: [rule("due", "today")], advanced: null }), ["b"])
eq(run({ simple: [rule("due", "empty")], advanced: null }), ["d"])
eq(run({ simple: [rule("cf:f1", "any_of", ["IG", "YouTube"])], advanced: null }), ["a"])
eq(run({ simple: [rule("cf:f3", "any_of", ["budi"])], advanced: null }), ["b", "d"], "multi-select, case-insensitive")
eq(run({ simple: [rule("cf:f2", "gt", 1000000)], advanced: null }), ["a"], "number")
eq(run({ simple: [rule("title", "contains", "acara")], advanced: null }), ["b", "c"])
eq(run({ simple: [rule("title", "not_contains", "acara")], advanced: null }), ["a", "d"])
eq(run({ simple: [rule("priority", "any_of", [])], advanced: null }), ["a", "b", "c", "d"], "incomplete rule = no filter")
eq(run({ simple: [rule("tags", "any_of", ["urgent"])], advanced: null }), ["a"])
eq(run({ simple: [rule("due", "this_week")], advanced: null }), ["b", "c"], "Mon..Sun of now")
eq(run(V.EMPTY_FILTER, "pasca"), ["c"], "search")
eq(run(V.EMPTY_FILTER, "doing"), ["b", "c"], "search reads the section name")

// advanced: (priority HIGH OR (channel TikTok AND assignee Ayu)) AND status not done
const adv = { id: "g", mode: "or", rules: [rule("priority", "any_of", ["HIGH"]), { id: "g2", mode: "and", rules: [rule("cf:f1", "any_of", ["TikTok"]), rule("assignee", "any_of", ["u2"])] }] }
eq(run({ simple: [], advanced: adv }), ["a", "b"], "OR with nested AND")
eq(run({ simple: [rule("status", "none_of", ["IN_PROGRESS"])], advanced: adv }), ["a"], "simple AND advanced")
eq(V.activeFilterCount({ simple: [rule("status", "none_of", ["DONE"]), rule("priority", "any_of", [])], advanced: adv }, defs), 4)

// sort
eq(ids(V.sortTasks(T, [{ prop: "due", dir: "asc" }], defs, ctx)), ["a", "b", "c", "d"], "dates, empty last")
eq(ids(V.sortTasks(T, [{ prop: "due", dir: "desc" }], defs, ctx)), ["c", "b", "a", "d"], "empty last in desc too")
eq(ids(V.sortTasks(T, [{ prop: "priority", dir: "asc" }], defs, ctx)), ["a", "b", "c", "d"], "priority order")
eq(ids(V.sortTasks(T, [{ prop: "section", dir: "asc" }, { prop: "title", dir: "asc" }], defs, ctx)), ["a", "d", "c", "b"], "two levels")
eq(ids(V.sortTasks(T, [{ prop: "cf:f2", dir: "desc" }], defs, ctx)), ["a", "b", "c", "d"], "number desc")
eq(ids(V.sortTasks(T, [], defs, ctx)), ["a", "b", "c", "d"], "no sort = manual order")

// group
const byStatus = V.groupTasks(T, "status", defs, ctx)
eq(byStatus.map((g) => [g.key, ids(g.tasks)]), [["TODO", ["a", "d"]], ["IN_PROGRESS", ["b"]], ["IN_REVIEW", []], ["DONE", ["c"]], ["CANCELLED", []]], "status groups incl. empty")
const byAssignee = V.groupTasks(T, "assignee", defs, ctx)
eq(byAssignee.map((g) => [g.label, ids(g.tasks)]), [["Berlin", ["a", "d"]], ["Ayu", ["b", "d"]], ["No assignee", ["c"]]], "a task with two people is in both")
const byDue = V.groupTasks(T, "due", defs, ctx).filter((g) => !g.empty)
eq(byDue.map((g) => [g.key, ids(g.tasks)]), [["overdue", ["a"]], ["today", ["b"]], ["next7", ["c"]], [V.EMPTY_GROUP, ["d"]]])
const byChannel = V.groupTasks(T, "cf:f1", defs, ctx)
eq(byChannel.map((g) => g.key), ["IG", "TikTok", "YouTube", V.EMPTY_GROUP])
const bySection = V.groupTasks(T, "section", defs, ctx)
eq(bySection.map((g) => [g.label, ids(g.tasks)]), [["To do", ["a", "d"]], ["Doing", ["b", "c"]]])

// group header calculations
eq(V.groupCalcValue(T, { kind: "count" }, defs).value, "4")
eq(V.groupCalcValue(T, { kind: "done" }, defs).value, "1/4")
eq(V.groupCalcValue(T, { kind: "percent_done" }, defs).value, "25%")
eq(V.groupCalcValue(T, { kind: "sum", prop: "cf:f2" }, defs).value, "2.000.000")

// URL round trip
const f = { simple: [rule("status", "none_of", ["DONE"])], advanced: adv }
eq(V.decodeFilter(V.encodeFilter(f)), f, "filter JSON round trip")
eq(V.decodeSort(V.encodeSort([{ prop: "due", dir: "desc" }, { prop: "cf:f2", dir: "asc" }])), [{ prop: "due", dir: "desc" }, { prop: "cf:f2", dir: "asc" }])
eq(V.decodeSort("none"), [], "explicit no sort")
eq(V.decodeSort("evil:asc,due:desc"), [{ prop: "due", dir: "desc" }], "unknown props dropped")
eq(V.decodeFilter("{not json"), undefined)

// Overview drill → filter
const drill = V.filterFromDrill({ hideDone: true, due: "NEXT7", assigneeId: "u2" })
eq(ids(T.filter((t) => V.taskMatches(t, drill, "", defs, ctx))), ["b"])

// config defaults + visible props
const board = V.resolveConfig({ layout: "board", config: {} })
eq([board.groupBy, board.showSubtasks, board.cardSize], ["section", true, "medium"])
const cal = V.resolveConfig({ layout: "calendar", config: { dateProp: "cf:f9" } })
eq([cal.groupBy, cal.dateProp], [null, "cf:f9"])
eq(V.visibleProps({ ...board, visibleProps: ["due", "cf:gone", "title", "cf:f1"] }, "board", defs), ["due", "cf:f1"], "deleted field and title dropped")
eq(V.viewName({ name: null, layout: "board", builtin: "board" }, (s) => `[${s}]`), "[Board]")

// colours
eq(V.taskColor(T[0], { colorRules: [{ id: "r", prop: "assignee", value: V.ME, color: "violet" }], colorBy: null }, defs, ctx), "purple", "old colour keys still read")
eq(V.taskColor(T[0], { colorRules: [], colorBy: "priority" }, defs, ctx), "orange")
eq(V.taskColor(T[2], { colorRules: [], colorBy: null }, defs, ctx), null)

console.log(`project-views: ${n} checks passed`)

// status options (sections that stand for a status)
{
  const O = await import("./status-options.ts")
  const opts = [{ id: "d", name: "Done", position: 0, taskStatus: "DONE" }, { id: "t", name: "To do", position: 2, taskStatus: "TODO" }, { id: "p", name: "Doing", position: 1, taskStatus: "IN_PROGRESS" }, { id: "b", name: "Backlog", position: 3, taskStatus: "TODO" }]
  assert.deepEqual(O.orderedOptions(opts).map((o) => o.id), ["t", "b", "p", "d"], "group order, then position")
  assert.equal(O.defaultOption(opts).id, "t")
  assert.equal(O.statusForNewOption("in_progress", "Client review"), "IN_REVIEW")
  assert.equal(O.statusForNewOption("complete", "Batal"), "CANCELLED")
  const c2 = { ...ctx, sections: opts }
  const d2 = V.propDefs(c2)
  assert.equal(d2.find((d) => d.key === "section").label, "Status")
  assert.equal(d2.find((d) => d.key === "status").hidden, true)
  assert.deepEqual(V.visibleProps({ ...V.resolveConfig({ layout: "table", config: {} }) }, "table", d2), ["assignee", "due", "priority", "section", "tags"], "status column = the option")
  assert.equal(V.optionColor("section", "p", d2), "blue", "group colour when the option has none")
  console.log("status options: ok")
}
