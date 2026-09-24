// node src/lib/fcm-payload.test.mjs
//
// Plain node, no test runner (same loader as permit-reason-guard.test.mjs).
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

const { buildFcmMessage, androidChannelFor, classifyFcmError, ANDROID_CHANNELS } = await load("fcm-payload.ts")

// SERVER-REQUESTS R1: every type the table names, one by one, plus the families and the fallback.
const R1 = {
  attendance_reminders: ["attendance_checkin_reminder", "attendance_checkout_reminder", "attendance_absent_recorded", "dayoff_quota_low", "red_date_quota_low", "attendance_override"],
  attendance_location: ["attendance_outside_reminder", "attendance_outside_warning", "attendance_auto_offsite_checkout"],
  approvals: ["attendance_request_pending", "attendance_request_reviewed", "attendance_request_escalated", "offsite_checkout_pending", "offsite_checkout_reviewed"],
  messages: ["MESSAGE", "MESSAGE_MENTION", "feed_mention", "feed_comment"],
  tasks: ["task_assigned", "task_completed", "task_due_now", "task_status_changed", "comment_added", "comment_mention", "project_invite", "status_update", "automation", "submission_status", "streak_at_risk", "quest_claimable", "booking_soon", "booking_changed", "booking_confirmed"],
  tickets: ["complaint_filed", "complaint_reply", "complaint_status", "system_gideon", "peer_report_filed", "peer_report_decided", "peer_report_rebuttal", "violation_announcement"],
  announcements: ["announcement"],
  system: ["app_update", "system_disk", "google_workspace_created", "google_workspace_linked", "test_notification"],
}

test("channel per type: the R1 table", () => {
  assert.deepEqual([...ANDROID_CHANNELS].sort(), Object.keys(R1).sort())
  for (const [channel, types] of Object.entries(R1)) {
    for (const t of types) {
      assert.equal(androidChannelFor(t), channel, t)
      assert.equal(androidChannelFor(t.toUpperCase()), channel, t.toUpperCase())
      // …and on the wire, with every other field intact.
      assert.equal(buildFcmMessage("t", { title: "T", body: "B", type: t }).message.data.channel, channel, `wire ${t}`)
    }
  }
})

test("outside-office category wins; unknown and empty → system", () => {
  assert.equal(androidChannelFor("attendance_outside_reminder", "NEXUS_OUTSIDE_OFFICE"), "attendance_location")
  assert.equal(androidChannelFor("some_future_outside_type", "NEXUS_OUTSIDE_OFFICE"), "attendance_location")
  assert.equal(androidChannelFor("task_assigned", "SOMETHING_ELSE"), "tasks")
  for (const t of ["", null, undefined, "attendance", "attendance_something_new", "message_digest", "messages", "status_change", "work_session", "whatever"]) {
    assert.equal(androidChannelFor(t), "system", String(t))
  }
})

test("data-only: same fields as the APNs payload, all strings, + channel; android = HIGH only", () => {
  const m = buildFcmMessage("TOKEN:abc", {
    title: "Budi mentioned you", body: "lihat ini", type: "MESSAGE_MENTION",
    link: "/messages?c=c1", taskId: null, projectId: "p1", category: null, notificationId: "n1",
    data: { recordId: "r1", count: 3, flag: true, gone: null },
  }).message
  assert.equal(m.token, "TOKEN:abc")
  assert.ok(!("notification" in m), "no top-level notification block")
  assert.deepEqual(m.android, { priority: "HIGH" })
  assert.deepEqual(Object.keys(m).sort(), ["android", "data", "token"])
  assert.deepEqual(m.data, {
    recordId: "r1", count: "3", flag: "true",
    title: "Budi mentioned you", body: "lihat ini", type: "MESSAGE_MENTION",
    projectId: "p1", link: "/messages?c=c1", notificationId: "n1", channel: "messages",
  })
  for (const v of Object.values(m.data)) assert.equal(typeof v, "string")
})

test("extra data can never replace the fixed keys (channel included), and FCM-reserved keys are dropped", () => {
  const m = buildFcmMessage("t", {
    title: "T", body: "B", type: "attendance_outside_reminder", category: "NEXUS_OUTSIDE_OFFICE", link: "/attendance?permit=today",
    data: { type: "evil", link: "https://x", title: "x", channel: "messages", from: "x", "google.foo": "x", "gcm.bar": "x", message_type: "x", notification: "x", collapse_key: "x", recordId: "r" },
  }).message
  assert.equal(m.data.type, "attendance_outside_reminder")
  assert.equal(m.data.link, "/attendance?permit=today")
  assert.equal(m.data.title, "T")
  assert.equal(m.data.category, "NEXUS_OUTSIDE_OFFICE")
  assert.equal(m.data.channel, "attendance_location")
  assert.equal(m.data.recordId, "r")
  for (const k of ["from", "google.foo", "gcm.bar", "message_type", "notification", "collapse_key"]) assert.ok(!(k in m.data), k)
})

test("optional keys are absent, not empty", () => {
  const m = buildFcmMessage("t", { title: "T", body: "B", type: "app_update" }).message
  assert.deepEqual(Object.keys(m.data).sort(), ["body", "channel", "title", "type"])
  assert.equal(m.data.channel, "system")
})

test("token errors disable the device; payload/config/transient errors do not", () => {
  const fcm = (errorCode, status, message) => ({ error: { code: status, status: errorCode, message, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] } })
  assert.equal(classifyFcmError(404, fcm("UNREGISTERED", 404, "Requested entity was not found.")).invalidToken, true)
  assert.equal(classifyFcmError(400, fcm("INVALID_ARGUMENT", 400, "The registration token is not a valid FCM registration token")).invalidToken, true)
  const badPayload = classifyFcmError(400, fcm("INVALID_ARGUMENT", 400, "Invalid value at 'message.data[0].value'"))
  assert.equal(badPayload.invalidToken, false)
  assert.equal(badPayload.transient, false)
  assert.equal(classifyFcmError(403, fcm("SENDER_ID_MISMATCH", 403, "SenderId mismatch")).invalidToken, false)
  assert.equal(classifyFcmError(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "x" } }).invalidToken, false)
  const quota = classifyFcmError(429, fcm("QUOTA_EXCEEDED", 429, "quota"))
  assert.equal(quota.invalidToken, false)
  assert.equal(quota.transient, true)
  assert.equal(classifyFcmError(503, null).transient, true)
  assert.equal(classifyFcmError(503, null).errorCode, null)
  // google.rpc status only (no FcmError detail)
  assert.equal(classifyFcmError(404, { error: { status: "UNREGISTERED" } }).invalidToken, true)
})

console.log(`fcm-payload: ${passed} passed`)
