// node src/lib/audit-describe.test.mjs            (add --print to dump every sample's output)
//
// Plain node, no test runner — same loader as permit-reason-guard.test.mjs: imports the .ts directly
// when this node can strip types, otherwise transpiles it with the repo's own `typescript` package.
//
// The metadata samples are the shapes production actually holds (volumes are the last 30 days as of
// 24 Sep 2026) plus the new shapes the writers produce from this change on. Every sample must
// describe without throwing; the specific assertions pin the behaviour the audit UI relies on.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "audit-describe.ts")

async function load() {
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

const { describeAuditEntry, auditSummary, collectAuditIds, auditDiff, redactAuditMetadata } = await load()
const PRINT = process.argv.includes("--print")

const bagas = { id: "cmbagas0000000000000001", name: "Bagas Putro", email: "bagas@example.com", avatar: null }
const rina = { id: "cmrina00000000000000001", name: "Rina Kartika", email: "rina@example.com", avatar: null }
const names = {
  user: { [bagas.id]: bagas.name, [rina.id]: rina.name, cmmanager000000000000001: "Gerro" },
  task: { cmtask00000000000000001: "Design poster" },
  project: { cmproj00000000000000001: "Intoo Campaign" },
  customField: { cmfield0000000000000001: "Budget" },
  office: { cmoffice000000000000001: "Kantor Kemang" },
  form: { cmform00000000000000001: "Pengajuan Dana" },
  taskList: { cmlist00000000000000001: "In progress", cmlist00000000000000002: "Review" },
  workspace: { cmws0000000000000000001: "Znetworks" },
  team: {},
}

let failed = 0
const results = {}
function check(name, row, fn) {
  let out
  try {
    out = describeAuditEntry(row, names)
    const summary = auditSummary(row)
    assert.equal(typeof summary, "string")
    assert.ok(summary.length > 0)
    collectAuditIds(row)
    fn?.(out, summary)
    results[name] = { summary, ...out }
    if (PRINT) console.log(`\n# ${name}\n` + JSON.stringify({ summary, ...out }, null, 2))
    console.log(`ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
    if (out) console.log("     got: " + JSON.stringify(out))
  }
}

// ── real shapes already in the table ─────────────────────────────────────────────────────────────

check("update task, OLD shape {changes:{title:new}} (1361/30d)", {
  action: "update", entityType: "task", entityId: "cmtask00000000000000001", entityName: "Design poster",
  userId: bagas.id, user: bagas, metadata: { changes: { title: "Design poster" } },
}, (o, s) => {
  assert.equal(o.title, "Bagas Putro changed the task “Design poster”")
  assert.equal(s, o.title)
  assert.deepEqual(o.changes, [{ field: "title", label: "Title", from: null, to: "Design poster" }])
  assert.deepEqual(o.details, [])
})

check("update task, OLD shape with status + dueDate + position", {
  action: "update", entityType: "task", entityName: "Design poster", userId: bagas.id, user: bagas,
  metadata: { changes: { status: "IN_PROGRESS", dueDate: "2026-09-30T10:00:00.000Z", position: 3 } },
}, (o) => {
  assert.equal(o.changes.find((c) => c.field === "status").to, "In progress")
  assert.equal(o.changes.find((c) => c.field === "dueDate").to, "30 Sep 2026, 17:00 WIB")
  assert.equal(o.changes.find((c) => c.field === "position").to, "3")
})

check("update custom_field_value, OLD shape {taskId, fieldId} (387/30d)", {
  action: "update", entityType: "custom_field_value", entityId: "cmcfv000000000000000001", entityName: "Budget",
  userId: bagas.id, user: bagas, metadata: { taskId: "cmtask00000000000000001", fieldId: "cmfield0000000000000001" },
}, (o) => {
  assert.equal(o.title, "Bagas Putro changed “Budget” on the task “Design poster”")
  assert.deepEqual(o.changes, [])
  assert.deepEqual(o.details, [
    { label: "Task", value: "Design poster", link: { type: "task", id: "cmtask00000000000000001" } },
    { label: "Custom field", value: "Budget" },
  ])
})

check("update attendance_request, OLD shape {status, xpRefunded, approvalSource} (175/30d)", {
  action: "update", entityType: "attendance_request", entityName: "DAY_OFF:Rina Kartika",
  userId: bagas.id, user: bagas, metadata: { status: "APPROVED", xpRefunded: 15, approvalSource: "MANAGER" },
}, (o) => {
  assert.equal(o.title, "Bagas Putro approved Rina Kartika’s day-off request")
  assert.deepEqual(o.changes, [{ field: "status", label: "Status", from: null, to: "Approved" }])
  assert.deepEqual(o.details, [
    { label: "XP refunded", value: "15" },
    { label: "Reviewed as", value: "Manager" },
  ])
})

check("update workspace_member, OLD shape {} (144/30d)", {
  action: "update", entityType: "workspace_member", entityId: "cmmember000000000000001",
  userId: bagas.id, user: bagas, metadata: {},
}, (o) => {
  assert.equal(o.title, "Bagas Putro changed a member")
  assert.deepEqual(o.changes, [])
  assert.deepEqual(o.details, [])
})

check("delete task, OLD shape (no metadata) (102/30d)", {
  action: "delete", entityType: "task", entityName: "Old brief", userId: bagas.id, user: bagas, metadata: null,
}, (o) => {
  assert.equal(o.title, "Bagas Putro deleted the task “Old brief”")
  assert.deepEqual(o.changes, [])
  assert.deepEqual(o.details, [])
})

check("update user_profile, OLD shape (none) (27/30d)", {
  action: "update", entityType: "user_profile", entityId: rina.id, userId: rina.id, user: rina, metadata: null,
}, (o) => assert.equal(o.title, "Rina Kartika updated their profile"))

check("create attendance_request (582/30d)", {
  action: "create", entityType: "attendance_request", entityName: "SICK:Rina Kartika", userId: rina.id, user: rina,
  metadata: { type: "SICK", startDate: "2026-09-25T00:00:00.000Z", endDate: "2026-09-25T00:00:00.000Z", teamId: null, granted: false, targetUserId: rina.id },
}, (o) => {
  assert.equal(o.title, "Rina Kartika filed a sick-leave request")
  const d = Object.fromEntries(o.details.map((x) => [x.label, x.value]))
  assert.equal(d["Type"], "Sick")
  assert.equal(d["Start date"], "25 Sep 2026")
  assert.equal(d["Granted by admin"], "No")
  assert.equal(d["Team"], "None")
  assert.equal(d["Person"], "Rina Kartika")
})

check("grant attendance_request", {
  action: "grant", entityType: "attendance_request", entityName: "LEAVE:Rina Kartika", userId: bagas.id, user: bagas,
  metadata: { type: "LEAVE", startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-01T00:00:00.000Z", granted: true, targetUserId: rina.id },
}, (o) => assert.equal(o.title, "Bagas Putro granted Rina Kartika an annual-leave request"))

check("create attendance_record = check-in (490/30d)", {
  action: "create", entityType: "attendance_record", entityName: "Rina Kartika check-in", userId: rina.id, user: rina,
  metadata: { officeLocationId: "cmoffice000000000000001", distanceMeters: 23.6 },
}, (o) => {
  assert.equal(o.title, "Rina Kartika checked in")
  assert.deepEqual(o.details, [
    { label: "Office", value: "Kantor Kemang" },
    { label: "Distance from office", value: "24 m" },
  ])
})

check("update attendance_record = check-out (500/30d)", {
  action: "update", entityType: "attendance_record", entityName: "Rina Kartika check-out", userId: rina.id, user: rina,
  metadata: { officeLocationId: "cmoffice000000000000001", distanceMeters: 5, offsite: false },
}, (o) => assert.equal(o.title, "Rina Kartika checked out"))

check("update attendance_record = remove check-out (must NOT read as a check-out)", {
  action: "update", entityType: "attendance_record", entityName: "Rina Kartika — hapus check-out", userId: bagas.id, user: bagas,
  metadata: { part: "checkout", reason: "salah tap" },
}, (o) => assert.equal(o.title, "Bagas Putro changed the attendance record “Rina Kartika — hapus check-out”"))

check("update attendance_record, complaint correction with nested before{}", {
  action: "update", entityType: "attendance_record", entityName: "Rina Kartika — koreksi absen via tiket", userId: bagas.id, user: bagas,
  metadata: { complaintId: "cmcomplaint0000000001", date: "2026-09-22", before: { checkInAt: "2026-09-22T02:10:00.000Z", checkOutAt: null, status: "LATE" }, penaltiesReversed: 1 },
}, (o) => {
  const before = o.details.find((d) => d.label === "Before")
  assert.equal(before.value, "Check in at: 22 Sep 2026, 09:10 WIB; Check out at: None; Status: Late")
  assert.equal(o.details.find((d) => d.label === "Date").value, "22 Sep 2026")
})

check("update notification markAllRead (218/30d)", {
  action: "update", entityType: "notification", userId: rina.id, user: rina, metadata: { markAllRead: true },
}, (o) => assert.equal(o.title, "Rina Kartika marked all notifications as read"))

check("create task (209/30d)", {
  action: "create", entityType: "task", entityName: "Design poster", userId: bagas.id, user: bagas, metadata: null,
}, (o) => assert.equal(o.title, "Bagas Putro created the task “Design poster”"))

check("login (208/30d) — a password-named boolean is kept, not redacted", {
  action: "login", entityType: "user", entityName: "Rina Kartika", userId: rina.id, user: rina,
  metadata: { provider: "credentials", directSession: true, usedMobileNormalizedPassword: false },
}, (o) => {
  assert.equal(o.title, "Rina Kartika signed in")
  assert.equal(o.details.find((d) => d.label === "Used mobile normalized password").value, "No")
})

check("create formSubmission (162/30d)", {
  action: "create", entityType: "formSubmission", entityName: "Pengajuan Dana", userId: rina.id, user: rina,
  metadata: { formId: "cmform00000000000000001", taskId: "cmtask00000000000000001" },
}, (o) => {
  assert.equal(o.title, "Rina Kartika submitted the form “Pengajuan Dana”")
  assert.deepEqual(o.details[0], { label: "Form", value: "Pengajuan Dana", link: { type: "form", id: "cmform00000000000000001" } })
})

check("create attachment (153/30d)", {
  action: "create", entityType: "attachment", entityName: "invoice.pdf", userId: rina.id, user: rina,
  metadata: { taskId: "cmtask00000000000000001", mimeType: "application/pdf", size: 245760 },
}, (o) => {
  assert.equal(o.title, "Rina Kartika uploaded “invoice.pdf” to the task “Design poster”")
  assert.equal(o.details.find((d) => d.label === "Size").value, "240.0 KB")
})

check("create task_assignee (95/30d)", {
  action: "create", entityType: "task_assignee", entityName: "Design poster", userId: bagas.id, user: bagas,
  metadata: { assigneeUserId: rina.id },
}, (o, s) => {
  assert.equal(o.title, "Bagas Putro assigned Rina Kartika to the task “Design poster”")
  assert.equal(s, "Bagas Putro added an assignee to the task “Design poster”") // list: no lookups
})

check("attendance_status_override (68/30d)", {
  action: "attendance_status_override", entityType: "attendance_day", entityName: "override:waive:2026-09-20", userId: bagas.id, user: bagas,
  metadata: { workspaceId: "cmws0000000000000000001", targetUserId: rina.id, date: "2026-09-20", override: "waive" },
}, (o) => assert.equal(o.title, "Bagas Putro overrode Rina Kartika’s attendance on 20 Sep 2026 (waive)"))

check("changes as a list of field names (forms/goals/docs)", {
  action: "update", entityType: "doc", entityName: "SOP", userId: bagas.id, user: bagas, metadata: { changes: ["title", "content"] },
}, (o) => assert.deepEqual(o.changes.map((c) => [c.field, c.from, c.to]), [["title", null, null], ["content", null, null]]))

check("old webhook row holding a secret in changes is shown redacted", {
  action: "update", entityType: "webhook", userId: bagas.id, user: bagas, metadata: { changes: { url: "https://x.test/h", secret: "s3cr3t" } },
}, (o) => {
  assert.equal(o.changes.find((c) => c.field === "secret").to, "[redacted]")
  assert.ok(!JSON.stringify(o).includes("s3cr3t"))
})

check("auto day-off deduction", {
  action: "create", entityType: "attendance_request", entityName: "auto-dayoff:Rina Kartika", userId: rina.id, user: rina,
  metadata: { reason: "auto_absence_deduction", date: "2026-09-19" },
}, (o) => {
  assert.equal(o.title, "An automatic day off was charged to Rina Kartika for an unexcused absence")
  assert.equal(o.details.find((d) => d.label === "Reason").value, "Auto absence deduction")
})

// ── unknown / hostile shapes: degrade, never throw ───────────────────────────────────────────────

check("metadata is an array", { action: "update", entityType: "thing", userId: "x", user: null, metadata: [1, 2, 3] },
  (o) => { assert.equal(o.title, "Someone changed a thing"); assert.deepEqual(o.details, [{ label: "Metadata", value: "1, 2, 3" }]) })
check("metadata is a string", { action: "weird_action", entityType: "someEntity", entityName: "X", user: null, metadata: "hello" },
  (o) => assert.equal(o.title, "Someone did “weird action” on the some entity “X”"))
check("deeply nested + unknown keys", {
  action: "update", entityType: "automation", entityName: "Auto", user: bagas,
  metadata: { a: { b: { c: { d: { e: 1 } } } }, someFlag: true, list: [{ x: 1 }], nothing: null, changes: { enabled: false, name: undefined } },
}, (o) => {
  assert.equal(o.details.find((d) => d.label === "Some flag").value, "Yes")
  assert.equal(o.changes.find((c) => c.field === "enabled").to, "No")
})
check("changes is a string", { action: "update", entityType: "task", entityName: "T", user: bagas, metadata: { changes: "oops" } },
  (o) => assert.deepEqual(o.changes, []))
check("unresolvable ids fall back to the id", {
  action: "create", entityType: "task_dependency", user: bagas, metadata: { taskId: "cmdeleted00000000000001", dependsOnTaskId: "cmdeleted00000000000002" },
}, (o) => assert.deepEqual(o.details[0], { label: "Task", value: "cmdeleted00000000000001" }))

// ── new shapes written from this change on ───────────────────────────────────────────────────────

const newTaskUpdate = {
  id: "cmaudit0000000000000001", action: "update", entityType: "task", entityId: "cmtask00000000000000001", entityName: "Design poster v2",
  userId: bagas.id, user: bagas, createdAt: new Date("2026-09-24T03:15:00Z"), ipAddress: "100.64.0.7", userAgent: "NEXUS/12 CFNetwork",
  metadata: {
    projectId: "cmproj00000000000000001",
    changes: {
      title: { from: "Design poster", to: "Design poster v2" },
      status: { from: "TODO", to: "IN_REVIEW" },
      taskListId: { from: "cmlist00000000000000001", to: "cmlist00000000000000002" },
      assigneeIds: { from: [bagas.id], to: [bagas.id, rina.id] },
      dueDate: { from: null, to: "2026-09-30T10:00:00.000Z" },
    },
  },
}
check("update task, NEW shape {from,to}", newTaskUpdate, (o) => {
  assert.equal(o.title, "Bagas Putro changed the task “Design poster v2”")
  assert.deepEqual(o.changes, [
    { field: "title", label: "Title", from: "Design poster", to: "Design poster v2" },
    { field: "status", label: "Status", from: "To do", to: "In review" },
    { field: "taskListId", label: "List", from: "In progress", to: "Review" },
    { field: "assigneeIds", label: "Assignees", from: "Bagas Putro", to: "Bagas Putro, Rina Kartika" },
    { field: "dueDate", label: "Due date", from: null, to: "30 Sep 2026, 17:00 WIB" },
  ])
  assert.deepEqual(o.details, [{ label: "Project", value: "Intoo Campaign", link: { type: "project", id: "cmproj00000000000000001" } }])
})

const newCustomField = {
  id: "cmaudit0000000000000002", action: "update", entityType: "custom_field_value", entityId: "cmcfv000000000000000001", entityName: "Budget",
  userId: bagas.id, user: bagas, createdAt: new Date("2026-09-24T04:00:00Z"), ipAddress: null, userAgent: null,
  metadata: { taskId: "cmtask00000000000000001", fieldId: "cmfield0000000000000001", fieldName: "Budget", taskTitle: "Design poster", from: "Rp 1.500.000", to: "Rp 2.000.000" },
}
check("update custom_field_value, NEW shape", newCustomField, (o, s) => {
  assert.equal(o.title, "Bagas Putro changed “Budget” on the task “Design poster”")
  assert.equal(s, o.title) // list summary gets the task title from metadata, no lookup
  assert.deepEqual(o.changes, [{ field: "value", label: "Budget", from: "Rp 1.500.000", to: "Rp 2.000.000" }])
  assert.deepEqual(o.details, [
    { label: "Task", value: "Design poster", link: { type: "task", id: "cmtask00000000000000001" } },
    { label: "Custom field", value: "Budget" },
  ])
})

const newRequestReview = {
  id: "cmaudit0000000000000003", action: "update", entityType: "attendance_request", entityId: "cmreq000000000000000001", entityName: "DAY_OFF:Rina Kartika",
  userId: bagas.id, user: bagas, createdAt: new Date("2026-09-24T05:30:00Z"), ipAddress: "100.64.0.9", userAgent: "Mozilla/5.0",
  metadata: { status: "REJECTED", previousStatus: "PENDING", approvalSource: "ADMIN", xpRefunded: 0, targetUserId: rina.id, type: "DAY_OFF", startDate: "2026-09-26T00:00:00.000Z", endDate: "2026-09-26T00:00:00.000Z" },
}
check("update attendance_request, NEW shape with previousStatus", newRequestReview, (o) => {
  assert.equal(o.title, "Bagas Putro rejected Rina Kartika’s day-off request")
  assert.deepEqual(o.changes, [{ field: "status", label: "Status", from: "Pending", to: "Rejected" }])
  assert.deepEqual(o.details.find((d) => d.label === "Person"), { label: "Person", value: "Rina Kartika", link: { type: "user", id: rina.id } })
})

check("update workspace_member, NEW shape (legacy keys hidden behind changes)", {
  action: "update", entityType: "workspace_member", entityName: "Rina Kartika", userId: bagas.id, user: bagas,
  metadata: {
    newRole: "MANAGER", attendanceRole: "SUPERVISOR", approverId: "cmmanager000000000000001", targetUserId: rina.id,
    changes: { role: { from: "STAFF", to: "MANAGER" }, approverId: { from: null, to: "cmmanager000000000000001" }, phoneNumber: { redacted: true } },
  },
}, (o) => {
  assert.equal(o.title, "Bagas Putro changed the member “Rina Kartika”")
  assert.deepEqual(o.changes, [
    { field: "role", label: "Role", from: "Staff", to: "Manager" },
    { field: "approverId", label: "Approver", from: null, to: "Gerro" },
    { field: "phoneNumber", label: "Phone number", from: null, to: null },
  ])
  // attendanceRole was not in changes (unchanged) → still a detail; newRole/approverId are not repeated.
  assert.deepEqual(o.details.map((d) => d.label), ["Attendance role", "Person"])
})

check("day-off quota change names the member", {
  action: "update", entityType: "workspace_member", entityName: `dayoff-quota:${rina.id}`, userId: bagas.id, user: bagas,
  metadata: { reason: "admin_dayoff_quota", quota: 6, targetUserId: rina.id, changes: { dayOffQuota: { from: 4, to: 6 } } },
}, (o) => {
  assert.equal(o.title, "Bagas Putro changed Rina Kartika’s day-off quota")
  assert.deepEqual(o.changes, [{ field: "dayOffQuota", label: "Day-off quota", from: "4", to: "6" }])
})

check("extra day off grant: people, days and period in the title; the people resolve", {
  action: "grant", entityType: "dayoff_bonus", entityId: "cmbonus000000000000000001", entityName: "dayoff-bonus:2026-10", userId: bagas.id, user: bagas,
  metadata: { reason: "dayoff_bonus_grant", periodKey: "2026-10", days: 3, note: "Event 3 hari", people: 2, targetUserIds: [rina.id, "cmmanager000000000000001"], grantIds: ["cmbonus000000000000000001", "cmbonus000000000000000002"] },
}, (o) => {
  assert.equal(o.title, "Bagas Putro gave 2 people 3 extra days off for the 2026-10 period")
  assert.ok(JSON.stringify(o.details).includes("Rina Kartika"), "targetUserIds resolve to names")
})

check("extra day off revoke names the person", {
  action: "revoke", entityType: "dayoff_bonus", entityId: "cmbonus000000000000000001", entityName: "dayoff-bonus:2026-10", userId: bagas.id, user: bagas,
  metadata: { reason: "dayoff_bonus_revoke", periodKey: "2026-10", days: 1, note: "Event", targetUserId: rina.id },
}, (o) => assert.equal(o.title, "Bagas Putro revoked Rina Kartika’s 1 extra day off for the 2026-10 period"))

check("update user_profile, NEW shape", {
  action: "update", entityType: "user_profile", entityId: rina.id, entityName: "Rina K.", userId: rina.id, user: rina,
  metadata: { fields: ["name", "phoneNumber"], changes: { name: { from: "Rina Kartika", to: "Rina K." } } },
}, (o) => assert.deepEqual(o.changes, [
  { field: "name", label: "Name", from: "Rina Kartika", to: "Rina K." },
  { field: "phoneNumber", label: "Phone number", from: null, to: null },
]))

check("delete task, NEW shape", {
  action: "delete", entityType: "task", entityName: "Old brief", userId: bagas.id, user: bagas,
  metadata: { title: "Old brief", projectId: "cmprojdeleted000000001", projectName: "Archived Campaign" },
}, (o) => {
  assert.equal(o.title, "Bagas Putro deleted the task “Old brief” from “Archived Campaign”")
  // projectId no longer resolves → the stored name stands in, in ONE row, without a dead link.
  assert.deepEqual(o.details, [{ label: "Title", value: "Old brief" }, { label: "Project", value: "Archived Campaign" }])
})

// ── writer helpers ───────────────────────────────────────────────────────────────────────────────

{
  const d = auditDiff(
    { title: "a", status: "TODO", dueDate: new Date("2026-09-30T10:00:00Z"), tags: ["x"], description: "same" },
    { title: "b", status: undefined, dueDate: new Date("2026-09-30T10:00:00Z"), tags: ["x", "y"], description: "same", password: "p" },
  )
  assert.deepEqual(d, { title: { from: "a", to: "b" }, tags: { from: ["x"], to: ["x", "y"] } })
  const long = auditDiff({ description: "" }, { description: "z".repeat(900) })
  assert.equal(long.description.to.length, 501)
  const r = redactAuditMetadata({ changes: { secret: "abc", url: "u" }, apiKey: "k", nested: [{ token: "t" }], usedMobileNormalizedPassword: true })
  assert.deepEqual(r, { changes: { secret: "[redacted]", url: "u" }, apiKey: "[redacted]", nested: [{ token: "[redacted]" }], usedMobileNormalizedPassword: true })
  const ids = collectAuditIds(newTaskUpdate)
  assert.deepEqual(ids.user.sort(), [bagas.id, rina.id].sort())
  assert.deepEqual(ids.taskList.sort(), ["cmlist00000000000000001", "cmlist00000000000000002"])
  assert.deepEqual(ids.project, ["cmproj00000000000000001"])
  console.log("ok   auditDiff / redactAuditMetadata / collectAuditIds")
}

// ── the /api/audit/[id] response for three sample rows (what the route returns, minus the lookup) ─
if (PRINT) {
  for (const row of [newTaskUpdate, newCustomField, newRequestReview]) {
    const { title, changes, details } = describeAuditEntry(row, names)
    const entry = {
      id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId ?? null, entityName: row.entityName ?? null,
      createdAt: row.createdAt.toISOString(), ipAddress: row.ipAddress, userAgent: row.userAgent,
      user: { id: row.user.id, name: row.user.name, email: row.user.email, avatar: row.user.avatar }, metadata: row.metadata,
    }
    console.log(`\n# GET /api/audit/${row.id}\n` + JSON.stringify({ entry, title, changes, details }, null, 2))
  }
}

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nall passed")
