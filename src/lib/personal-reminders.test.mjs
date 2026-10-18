// node --experimental-strip-types src/lib/personal-reminders.test.mjs
import assert from "node:assert/strict"
import { checkReminder, parseRemindAt, ReminderRefusal } from "./personal-reminders-core.ts"
import { EXTRA_TOOL_META, EXTRA_WRITE_ACTIONS, extraNeedsApproval, extraStepLabel, isExtraAction } from "./gideon-tools/meta.ts"

// Times without a zone are WIB.
assert.equal(parseRemindAt("2026-10-19T09:00").toISOString(), "2026-10-19T02:00:00.000Z")
assert.equal(parseRemindAt("2026-10-19 9.30").toISOString(), "2026-10-19T02:30:00.000Z")
assert.equal(parseRemindAt("2026-10-19").toISOString(), "2026-10-19T02:00:00.000Z") // bare date = 09:00 WIB
assert.equal(parseRemindAt(undefined, "2026-10-19", "14:15").toISOString(), "2026-10-19T07:15:00.000Z")
assert.equal(parseRemindAt("2026-10-19T09:00:00+07:00").toISOString(), "2026-10-19T02:00:00.000Z")
assert.equal(parseRemindAt("2026-10-19T25:00"), null)
assert.equal(parseRemindAt("besok jam 9"), null)
assert.equal(parseRemindAt(""), null)

const now = new Date("2026-10-18T10:00:00Z")
const ok = checkReminder("  follow up   vendor ", new Date("2026-10-19T02:00:00Z"), now)
assert.equal(ok.text, "follow up vendor")
const code = (fn) => { try { fn(); return null } catch (e) { assert.ok(e instanceof ReminderRefusal); return e.code } }
assert.equal(code(() => checkReminder("", new Date("2026-10-19T02:00:00Z"), now)), "TEXT")
assert.equal(code(() => checkReminder("x".repeat(281), new Date("2026-10-19T02:00:00Z"), now)), "TEXT")
assert.equal(code(() => checkReminder("x", null, now)), "TIME_BAD")
assert.equal(code(() => checkReminder("x", new Date("2026-10-18T10:00:30Z"), now)), "TIME_PAST")
assert.equal(code(() => checkReminder("x", new Date("2027-11-01T00:00:00Z"), now)), "TIME_FAR")

// Approval rules: outward-facing / attendance / web-session writes are a card in every mode; reminders follow modes.
for (const a of ["send_message", "submit_leave_request", "decide_attendance_request", "create_vault_share_link", "draft_announcement"]) {
  assert.equal(extraNeedsApproval(a, "dont_ask"), true, a)
}
assert.equal(extraNeedsApproval("create_reminder", "dont_ask"), false)
assert.equal(extraNeedsApproval("create_reminder", "review"), true)
assert.equal(extraNeedsApproval("get_my_inbox", "always_ask"), false)
assert.ok(EXTRA_WRITE_ACTIONS.includes("send_message") && !EXTRA_WRITE_ACTIONS.includes("get_my_inbox"))
assert.ok(isExtraAction("read_conversation") && !isExtraAction("create_task") && !isExtraAction("toString"))
assert.equal(extraStepLabel("send_message", "Rina"), "Writing a message to Rina")
assert.equal(extraStepLabel("get_my_inbox", ""), "Checking what needs you")
for (const [k, m] of Object.entries(EXTRA_TOOL_META)) assert.ok(!m.write || m.approval, `${k} has an approval rule`)
console.log("personal-reminders + gideon-tools meta: ok")
