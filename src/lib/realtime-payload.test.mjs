// node --experimental-strip-types src/lib/realtime-payload.test.mjs
// Broadcast payloads carry people as id/name/avatar only (realtime bug 2, 13 Oct 2026).
import assert from "node:assert/strict"
import { stripPrivatePeople, cleanCursorMove } from "./realtime-payload.ts"

const user = { id: "u1", name: "Ana", email: "ana@x.id", phoneNumber: "0812", googleWorkspaceEmail: "a@z.id", sessionVersion: 3, avatar: "/a.png", role: "MEMBER", createdAt: "2026-01-01" }
const task = {
  id: "t1", title: "Hello", status: "TODO", taskListId: "l1", dueDate: null, tags: ["a"],
  assignees: [{ id: "ta1", userId: "u1", user }],
  creator: user,
  taskList: { id: "l1", name: "To do", projectId: "p1" },
  _count: { subtasks: 0, comments: 2 },
}
const out = stripPrivatePeople(task)
assert.equal(out.title, "Hello")
assert.deepEqual(out.tags, ["a"])
assert.deepEqual(out.taskList, task.taskList, "non-person objects stay")
assert.deepEqual(out._count, task._count)
assert.deepEqual(out.assignees[0].user, { id: "u1", name: "Ana", avatar: "/a.png", role: "MEMBER" })
assert.deepEqual(out.creator, { id: "u1", name: "Ana", avatar: "/a.png", role: "MEMBER" })
assert.equal(out.assignees[0].userId, "u1")
assert.ok(!JSON.stringify(out).includes("ana@x.id"), "no email anywhere")
assert.ok(!JSON.stringify(out).includes("0812"), "no phone anywhere")
assert.equal(task.creator.email, "ana@x.id", "input untouched")

// A comment with its author.
const comment = { id: "c1", content: "hi", user: { ...user }, taskId: "t1" }
assert.deepEqual(stripPrivatePeople(comment).user, { id: "u1", name: "Ana", avatar: "/a.png", role: "MEMBER" })
// A task (id + name-less) is never mistaken for a person; neither is a list with a name.
assert.deepEqual(stripPrivatePeople({ id: "l1", name: "List" }), { id: "l1", name: "List" })
// Primitives and null pass through.
assert.equal(stripPrivatePeople(null), null)
assert.equal(stripPrivatePeople("x"), "x")

assert.deepEqual(cleanCursorMove({ x: 1.6, y: 2, blockId: "b", content: "<script>" }), { x: 2, y: 2, blockId: "b" })
assert.equal(cleanCursorMove({ x: "1", y: 2 }), null)
assert.equal(cleanCursorMove(null), null)
assert.deepEqual(cleanCursorMove({ x: 1, y: 2, blockId: "x".repeat(200) }), { x: 1, y: 2 })
console.log("realtime-payload: ok")
