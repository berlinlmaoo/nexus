// node --experimental-strip-types src/lib/gideon-compact.test.mjs
import assert from "node:assert/strict"
import { compactTask, compactProject, fieldText, page, urgencyOrder, wibDayKey } from "./gideon-compact.ts"

const row = {
  id: "t1", title: "Monthly Schedule Z NET", description: "  Jadwal  bulanan\n untuk Z NET ".repeat(20), status: "TODO", priority: "HIGH",
  dueDate: "2026-09-12T17:00:00.000Z", // 13 Sep 00:00 WIB
  taskList: { name: "To Do", projectId: "p1", project: { id: "p1", name: "FRAMEWORKZ : Z Creative Task" } },
  assignees: [{ user: { name: "Irvandes Hasri Ilham Maulana" } }],
  customFieldValues: [
    { value: "LIVESET", customField: { name: "CONTENT TYPE", type: "SELECT" } },
    { value: "[]", customField: { name: "Tipe", type: "MULTI_SELECT" } },
    { value: '["A","B"]', customField: { name: "Tags", type: "MULTI_SELECT" } },
    { value: '{"label":"","mapUrl":""}', customField: { name: "Lokasi", type: "PLACE" } },
    { value: "x.pdf", customField: { name: "Bukti", type: "FILE" } },
  ],
}
const c = compactTask(row, "2026-10-18")
assert.equal(c.status, "To Do")
assert.equal(c.progress, "To do")
assert.equal(c.priority, "High")
assert.equal(c.due, "2026-09-13")
assert.equal(c.overdue, true)
assert.deepEqual(c.assignees, ["Irvandes Hasri Ilham Maulana"])
assert.equal(c.project, "FRAMEWORKZ : Z Creative Task")
assert.equal(c.projectId, "p1")
assert.deepEqual(c.fields, { "CONTENT TYPE": "LIVESET", Tags: "A, B" })
assert.ok(c.desc.length <= 140 && c.desc.startsWith("Jadwal bulanan untuk"))
// No emails / avatars / option lists leak through.
assert.ok(!JSON.stringify(c).includes("avatar") && !JSON.stringify(c).includes("options"))
// Done tasks are never overdue; a project-scoped list leaves the project out.
assert.equal(compactTask({ ...row, status: "DONE" }, "2026-10-18").overdue, undefined)
assert.equal(compactTask(row, "2026-10-18", false).project, undefined)
// A column with the same name as the state adds no `progress`.
assert.equal(compactTask({ ...row, taskList: { ...row.taskList, name: "" } }, "2026-10-18").progress, undefined)

assert.equal(wibDayKey("2026-10-18T17:30:00.000Z"), "2026-10-19")
assert.equal(fieldText("TEXT", "  "), null)
assert.equal(fieldText("NUMBER", 1500000), "1500000")

const p = page([1, 2, 3], 10, 0, 3)
assert.equal(p.total, 10)
assert.match(p.more, /7 more not shown — call again with offset=3/)
assert.equal(page([1], 1, 0, 25).more, undefined)

assert.deepEqual(compactProject({ id: "p", name: "Legal", status: "ACTIVE", type: "TASK", _count: { members: 17 }, taskLists: [{ _count: { tasks: 50 } }, { _count: { tasks: 22 } }] }, 19),
  { id: "p", name: "Legal", status: "ACTIVE", tasks: 72, open: 19, members: 17 })

const sorted = [{ priority: "LOW", dueDate: "2026-01-01" }, { priority: "URGENT", dueDate: null }, { priority: "HIGH", dueDate: "2026-02-01" }, { priority: "HIGH", dueDate: "2026-01-15" }].sort(urgencyOrder)
assert.deepEqual(sorted.map((t) => t.priority + (t.dueDate || "")), ["URGENT", "HIGH2026-01-15", "HIGH2026-02-01", "LOW2026-01-01"])
console.log("gideon-compact ok")
