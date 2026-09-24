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

const { buildFcmMessage, androidChannelFor, classifyFcmError } = await load("fcm-payload.ts")

test("channel per type", () => {
  for (const t of ["attendance_checkin_reminder", "attendance_outside_warning", "attendance_auto_offsite_checkout", "attendance", "offsite_checkout_pending", "ATTENDANCE_request_pending"]) {
    assert.equal(androidChannelFor(t), "attendance", t)
  }
  for (const t of ["MESSAGE", "MESSAGE_MENTION", "message"]) assert.equal(androidChannelFor(t), "messages", t)
  for (const t of ["task_assigned", "announcement", "app_update", "complaint_reply", "messages_digest_x", "", null, undefined]) {
    assert.equal(androidChannelFor(t), "general", String(t))
  }
})

test("same fields as the APNs payload, all strings, notification + data + android", () => {
  const m = buildFcmMessage("TOKEN:abc", {
    title: "Budi mentioned you", body: "lihat ini", type: "MESSAGE_MENTION",
    link: "/messages?c=c1", taskId: null, projectId: "p1", category: null, notificationId: "n1",
    data: { recordId: "r1", count: 3, flag: true, gone: null },
  }).message
  assert.equal(m.token, "TOKEN:abc")
  assert.deepEqual(m.notification, { title: "Budi mentioned you", body: "lihat ini" })
  assert.deepEqual(m.data, {
    recordId: "r1", count: "3", flag: "true",
    title: "Budi mentioned you", body: "lihat ini", type: "MESSAGE_MENTION",
    projectId: "p1", link: "/messages?c=c1", notificationId: "n1",
  })
  assert.equal(m.android.priority, "HIGH")
  assert.equal(m.android.notification.channel_id, "messages")
  for (const v of Object.values(m.data)) assert.equal(typeof v, "string")
})

test("extra data can never replace the fixed keys, and FCM-reserved keys are dropped", () => {
  const m = buildFcmMessage("t", {
    title: "T", body: "B", type: "attendance_outside_reminder", category: "NEXUS_OUTSIDE_OFFICE", link: "/attendance?permit=today",
    data: { type: "evil", link: "https://x", title: "x", from: "x", "google.foo": "x", "gcm.bar": "x", message_type: "x", notification: "x", collapse_key: "x", recordId: "r" },
  }).message
  assert.equal(m.data.type, "attendance_outside_reminder")
  assert.equal(m.data.link, "/attendance?permit=today")
  assert.equal(m.data.title, "T")
  assert.equal(m.data.category, "NEXUS_OUTSIDE_OFFICE")
  assert.equal(m.data.recordId, "r")
  for (const k of ["from", "google.foo", "gcm.bar", "message_type", "notification", "collapse_key"]) assert.ok(!(k in m.data), k)
  assert.equal(m.android.notification.channel_id, "attendance")
})

test("optional keys are absent, not empty", () => {
  const m = buildFcmMessage("t", { title: "T", body: "B", type: "app_update" }).message
  assert.deepEqual(Object.keys(m.data).sort(), ["body", "title", "type"])
  assert.equal(m.android.notification.channel_id, "general")
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
