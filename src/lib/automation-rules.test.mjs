// node --experimental-strip-types src/lib/automation-rules.test.mjs
//
// Plain node, no test runner (same loader as client-version.test.mjs). Covers the trigger-case bug
// (web saved "task_created", engine matched "TASK_CREATED") and the When / If / Do rules.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

const R = await load("automation-rules.ts")

test("the case bug: every lower-case trigger the old web UI saved is normalised to what the engine matches", () => {
  assert.deepEqual(R.normalizeTrigger({ type: "task_created" }), { type: "TASK_CREATED" })
  assert.deepEqual(R.normalizeTrigger({ type: "task_status_changed", value: "done" }), { type: "STATUS_CHANGED", value: "DONE" })
  assert.deepEqual(R.normalizeTrigger({ type: "task_assigned" }), { type: "ASSIGNEE_CHANGED" })
  assert.deepEqual(R.normalizeTrigger({ type: "task_due_approaching" }), { type: "DUE_DATE_APPROACHING" })
  // and the rule then actually matches the event the task routes raise
  const t = R.normalizeTrigger({ type: "task_created" })
  assert.equal(R.triggerMatches(t, { kind: "task_created" }), true)
})

test("suggestion vocabulary (status_change, tag_added, due_date_passed, set_field, assign_user) is canonical", () => {
  assert.deepEqual(R.normalizeTrigger({ type: "status_change", field: "status", value: "IN_REVIEW" }), { type: "STATUS_CHANGED", value: "IN_REVIEW" })
  assert.deepEqual(R.normalizeTrigger({ type: "tag_added", field: "tag", value: "bug" }), { type: "FIELD_CHANGED", value: "bug", field: "tags" })
  assert.deepEqual(R.normalizeTrigger({ type: "due_date_passed" }), { type: "DUE_DATE_REACHED" })
  assert.deepEqual(R.normalizeAction({ type: "set_field", field: "priority", value: "high" }), { type: "SET_PRIORITY", value: "HIGH" })
  assert.deepEqual(R.normalizeAction({ type: "assign_user", field: "assignee", value: "u1" }), { type: "ASSIGN_TO", value: "u1" })
  assert.deepEqual(R.normalizeAction({ type: "CHANGE_STATUS", value: "DONE" }), { type: "SET_STATUS", value: "DONE" })
  assert.equal(R.normalizeTrigger({ type: "nonsense" }), null)
  assert.equal(R.normalizeAction({ type: "" }), null)
})

test("legacy rows: actionsOf falls back to the single action; legacy condition becomes a rule", () => {
  assert.deepEqual(R.actionsOf({ action: { type: "MARK_COMPLETE" } }), [{ type: "MARK_COMPLETE" }])
  assert.deepEqual(R.actionsOf({ action: { type: "x" }, actions: [{ type: "add_tag", value: "a" }, { type: "notify" }] }), [{ type: "ADD_TAG", value: "a" }, { type: "SEND_NOTIFICATION" }])
  assert.deepEqual(R.normalizeConditions(null, { type: "PRIORITY_IS", value: "HIGH" }), { match: "all", rules: [{ field: "priority", op: "is", value: "HIGH" }] })
  assert.equal(R.normalizeConditions(null, null), null)
})

test("TASK_CREATED no longer fires on comments or sprint starts (old piggyback bug)", () => {
  const t = { type: "TASK_CREATED" }
  assert.equal(R.triggerMatches(t, { kind: "comment_added" }), false)
  assert.equal(R.triggerMatches(t, { kind: "task_updated", changes: { status: { from: "TODO", to: "DONE" } } }), false)
  assert.equal(R.triggerMatches({ type: "COMMENT_ADDED" }, { kind: "comment_added" }), true)
})

test("status change: to X, from Y, completed; unchanged values do not fire", () => {
  const ev = { kind: "task_updated", changes: { status: { from: "TODO", to: "DONE" } } }
  assert.equal(R.triggerMatches({ type: "STATUS_CHANGED" }, ev), true)
  assert.equal(R.triggerMatches({ type: "STATUS_CHANGED", value: "DONE" }, ev), true)
  assert.equal(R.triggerMatches({ type: "STATUS_CHANGED", value: "IN_REVIEW" }, ev), false)
  assert.equal(R.triggerMatches({ type: "STATUS_CHANGED", value: "DONE", config: { from: "IN_PROGRESS" } }, ev), false)
  assert.equal(R.triggerMatches({ type: "TASK_COMPLETED" }, ev), true)
  assert.equal(R.triggerMatches({ type: "STATUS_CHANGED" }, { kind: "task_updated", changes: { status: { from: "DONE", to: "DONE" } } }), false)
  assert.equal(R.triggerMatches({ type: "TASK_UPDATED" }, { kind: "task_updated", changes: { title: { from: "a", to: "a" } } }), false)
  assert.equal(R.triggerMatches({ type: "TASK_UPDATED" }, { kind: "task_updated", changes: { title: { from: "a", to: "b" } } }), true)
})

test("assignee and field changes", () => {
  const ev = { kind: "task_updated", changes: { assignee: { added: ["u2"], removed: [] } } }
  assert.equal(R.triggerMatches({ type: "ASSIGNEE_CHANGED" }, ev), true)
  assert.equal(R.triggerMatches({ type: "ASSIGNEE_CHANGED", value: "u2" }, ev), true)
  assert.equal(R.triggerMatches({ type: "ASSIGNEE_CHANGED", value: "u3" }, ev), false)
  assert.equal(R.triggerMatches({ type: "ASSIGNEE_CHANGED" }, { kind: "task_updated", changes: { assignee: { added: [], removed: [] } } }), false)
  const pri = { kind: "task_updated", changes: { priority: { from: "LOW", to: "HIGH" } } }
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "priority", value: "HIGH" }, pri), true)
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "priority", value: "URGENT" }, pri), false)
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "dueDate" }, pri), false)
  const tags = { kind: "task_updated", changes: { tags: { from: ["a"], to: ["a", "Bug"] } } }
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "tags", value: "bug" }, tags), true)
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "tags", value: "a" }, tags), false)
  const cf = { kind: "task_updated", changes: { "cf:f1": { from: ["x"], to: ["x", "y"] } } }
  assert.equal(R.triggerMatches({ type: "FIELD_CHANGED", field: "cf:f1", value: "y" }, cf), true)
  assert.equal(R.triggerMatches({ type: "FORM_SUBMITTED", value: "form1" }, { kind: "form_submitted", formId: "form1" }), true)
  assert.equal(R.triggerMatches({ type: "FORM_SUBMITTED", value: "form1" }, { kind: "form_submitted", formId: "form2" }), false)
})

const facts = {
  status: "IN_PROGRESS", priority: "HIGH", assigneeIds: ["u1", "u2"], sectionId: "s1", tags: ["Bug", "web"],
  title: "Fix login", description: null, dueDate: new Date("2026-10-10T00:00:00Z"), startDate: null, creatorId: "u9",
  custom: { "cf:budget": "1500000", "cf:channels": ["IG", "TikTok"], "cf:empty": "" },
}
const now = new Date("2026-10-12T05:00:00Z")

test("conditions: all / any, every op", () => {
  const c = (field, op, value) => R.conditionHolds({ field, op, value }, facts, now)
  assert.equal(c("priority", "is", "high"), true)
  assert.equal(c("status", "is_not", "DONE"), true)
  assert.equal(c("assignee", "is", "u2"), true)
  assert.equal(c("assignee", "is_not", "u3"), true)
  assert.equal(c("tags", "contains", "bug"), true)
  assert.equal(c("title", "contains", "login"), true)
  assert.equal(c("title", "not_contains", "logout"), true)
  assert.equal(c("description", "is_empty"), true)
  assert.equal(c("dueDate", "is_not_empty"), true)
  assert.equal(c("dueDate", "overdue"), true)
  assert.equal(c("dueDate", "within_days", "3"), false)
  assert.equal(c("cf:budget", "gt", "1000000"), true)
  assert.equal(c("cf:budget", "lt", "1000000"), false)
  assert.equal(c("cf:channels", "contains", "tiktok"), true)
  assert.equal(c("cf:empty", "is_empty"), true)
  assert.equal(c("section", "is", "s1"), true)
  assert.equal(R.conditionsHold({ match: "all", rules: [{ field: "priority", op: "is", value: "HIGH" }, { field: "status", op: "is", value: "DONE" }] }, facts, now), false)
  assert.equal(R.conditionsHold({ match: "any", rules: [{ field: "priority", op: "is", value: "HIGH" }, { field: "status", op: "is", value: "DONE" }] }, facts, now), true)
  assert.equal(R.conditionsHold(null, facts, now), true)
})

test("schedules in WIB: daily, weekly days, weekdays, grace, not before the rule existed", () => {
  // 2026-10-12 is a Monday. 09:00 WIB = 02:00 UTC.
  const daily = R.scheduleOf({ config: { frequency: "daily", time: "09:00" } })
  assert.ok(daily)
  const at = new Date("2026-10-12T02:05:00Z")
  const made = new Date("2026-10-01T00:00:00Z")
  assert.deepEqual(R.dueSlot(daily, at, made)?.key, "sched:2026-10-12T09:00")
  assert.equal(R.dueSlot(daily, new Date("2026-10-12T01:59:00Z"), made), null) // 08:59 WIB: not yet
  assert.equal(R.dueSlot(daily, at, new Date("2026-10-12T02:01:00Z")), null) // rule saved after today's slot
  assert.equal(R.dueSlot(daily, new Date("2026-10-12T09:00:00Z"), made), null) // 16:00 WIB: past the 6 h grace
  const weekly = R.scheduleOf({ config: { frequency: "weekly", time: "09:00", days: [2, 4] } })
  assert.equal(R.dueSlot(weekly, at, made), null) // Monday is not Tue/Thu
  assert.equal(R.nextSlot(weekly, at).toISOString(), "2026-10-13T02:00:00.000Z")
  const weekdays = R.scheduleOf({ config: { frequency: "weekdays", time: "17:30" } })
  assert.equal(R.nextSlot(weekdays, new Date("2026-10-16T11:00:00Z")).toISOString(), "2026-10-19T10:30:00.000Z") // Fri 18:00 → Mon 17:30
  assert.equal(R.scheduleOf({ config: { frequency: "weekly", time: "09:00", days: [] } }), null)
  assert.equal(R.scheduleOf({ config: { frequency: "daily", time: "9am" } }), null)
  // WIB midnight boundary: 23:30 WIB Monday = 16:30 UTC Monday
  const late = R.scheduleOf({ config: { frequency: "weekly", time: "23:30", days: [1] } })
  assert.equal(R.dueSlot(late, new Date("2026-10-12T16:31:00Z"), made)?.key, "sched:2026-10-12T23:30")
})

test("validation, templates and date values", () => {
  assert.equal(R.triggerError({ type: "FIELD_CHANGED" }), "Pick the field to watch")
  assert.equal(R.triggerError({ type: "SCHEDULED", config: { frequency: "daily", time: "09:00" } }), null)
  assert.equal(R.actionError({ type: "SET_STATUS", value: "DONE" }), null)
  assert.equal(R.actionError({ type: "SET_STATUS", value: "LATER" }), "Pick a status")
  assert.equal(R.actionError({ type: "CALL_WEBHOOK", value: "http://x.test" }), "Webhook URL must use https")
  assert.equal(R.fillTemplate("{task} in {project} by {payload.user.name} {unknown}", { task: "T", project: "P" }, { user: { name: "Ana" } }), "T in P by Ana {unknown}")
  assert.equal(R.resolveDateValue("+3", now).toISOString(), "2026-10-15T00:00:00.000Z")
  assert.equal(R.resolveDateValue("", now), null)
  assert.equal(R.resolveDateValue("nope", now), "invalid")
})

console.log(`automation-rules: ${passed} tests passed`)
