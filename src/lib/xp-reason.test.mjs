// node src/lib/xp-reason.test.mjs
//
// Plain node, no test runner — same loader as permit-reason-guard.test.mjs: imports the .ts directly
// when this node can strip types, otherwise transpiles it with the repo's own `typescript` package.
// The database half (refundXpTransaction, setLatePenalty's guard) is covered by
// src/__tests__/xp-refund.test.ts and the compat fixtures (xp-refund-*).
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "xp-reason.ts")

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

const m = await load()
let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL ${name}\n     ${err.message}`)
  }
}

// ── reason keys → words ────────────────────────────────────────────────────────────────────────
check("late: exact minutes from the record win over the capped amount; the day is the reason's", () => {
  const a = m.describeXpReason("attendance:late:2026-09-14", -120, 185)
  assert.equal(a.kind, "late")
  assert.equal(a.label, "Late check-in · 185 min")
  assert.equal(a.dateKey, "2026-09-14")
  assert.equal(a.attendance, true)
  assert.equal(a.hidden, false)
})
check("late: without the record, |amount| minutes, and 120 reads 120+ (the ledger caps there)", () => {
  assert.equal(m.describeXpReason("attendance:late:2026-09-14", -45).label, "Late check-in · 45 min")
  assert.equal(m.describeXpReason("attendance:late:2026-09-14", -120).label, "Late check-in · 120+ min")
  assert.equal(m.describeXpReason("attendance:late:2026-09-14", 0).label, "Late check-in")
})
check("no check-out and TK carry their day", () => {
  const n = m.describeXpReason("attendance:nocheckout:2026-09-02", -25)
  assert.deepEqual([n.kind, n.label, n.dateKey, n.attendance], ["nocheckout", "No check-out", "2026-09-02", true])
  const t = m.describeXpReason("attendance:alpha:2026-09-03", -150)
  assert.deepEqual([t.kind, t.label, t.dateKey], ["alpha", "Absent without notice (TK)", "2026-09-03"])
})
check("the waiver marker (0 XP) is hidden", () => {
  const w = m.describeXpReason("attendance:waiver:2026-09-20", 0)
  assert.equal(w.kind, "waiver")
  assert.equal(w.hidden, true)
})
check("peer report: penalty vs reward", () => {
  assert.equal(m.describeXpReason("peer:report:cmabc:penalty", -50).kind, "peer_penalty")
  assert.equal(m.describeXpReason("peer:report:cmabc:bounty", 20).kind, "peer_bounty")
})
check("BoD adjustment keeps the note (with the 'oleh' stamp) as detail", () => {
  const a = m.describeXpReason("admin:adjust:Telat meeting klien · oleh Berlin", -30)
  assert.equal(a.kind, "admin_adjust")
  assert.equal(a.detail, "Telat meeting klien · oleh Berlin")
  assert.equal(a.label, "Adjusted by the BoD · Telat meeting klien · oleh Berlin")
  assert.equal(m.describeXpReason("admin:adjust", 10).detail, null)
  // A note with colons stays whole.
  assert.equal(m.describeXpReason("admin:adjust:jam 10:30 · oleh X", -5).detail, "jam 10:30 · oleh X")
})
check("quests, penalty quest, retired kinds, bonus", () => {
  assert.equal(m.describeXpReason("quest", 100).kind, "quest")
  assert.equal(m.describeXpReason("penalty", -50).kind, "quest_penalty")
  assert.equal(m.describeXpReason("task_done", 10).label, "Task completed")
  assert.equal(m.describeXpReason("priority_bonus", 5).kind, "priority_bonus")
  assert.equal(m.describeXpReason("goal_milestone", 5).kind, "goal_milestone")
  assert.equal(m.describeXpReason("streak", 1).kind, "streak")
  const b = m.describeXpReason("bonus:zero-alpha:2026-07", 50)
  assert.deepEqual([b.kind, b.label, b.detail], ["bonus", "No-absence bonus · 2026-07", "2026-07"])
})
check("unknown keys are shown as written, never hidden, never attendance", () => {
  const u = m.describeXpReason("something:new", -3)
  assert.deepEqual([u.kind, u.label, u.hidden, u.attendance], ["other", "something:new", false, false])
  assert.equal(m.describeXpReason("", 1).label, "XP change")
  // An attendance key without a valid date is not tied to a day.
  const bad = m.describeXpReason("attendance:late:yesterday", -5)
  assert.equal(bad.dateKey, null)
})

// ── refund rules ───────────────────────────────────────────────────────────────────────────────
check("a deduction may be removed: the XP handed back is exactly its amount", () => {
  assert.deepEqual(m.xpRefundDecision({ amount: -45, reason: "attendance:late:2026-09-14" }, false), { ok: true, refund: 45 })
  assert.deepEqual(m.xpRefundDecision({ amount: -1, reason: "admin:adjust" }, false), { ok: true, refund: 1 })
})
check("removed before → 409 ALREADY_REFUNDED, even though the row now reads 0", () => {
  const d = m.xpRefundDecision({ amount: 0, reason: "attendance:alpha:2026-09-03" }, true)
  assert.equal(d.ok, false)
  assert.equal(d.status, 409)
  assert.equal(d.code, "ALREADY_REFUNDED")
})
check("a gain or the 0 XP waiver → 400 NOT_A_DEDUCTION", () => {
  for (const row of [{ amount: 100, reason: "quest" }, { amount: 0, reason: "attendance:waiver:2026-09-20" }, { amount: Number.NaN, reason: "x" }]) {
    const d = m.xpRefundDecision(row, false)
    assert.equal(d.ok, false)
    assert.equal(d.status, 400)
    assert.equal(d.code, "NOT_A_DEDUCTION")
  }
})

console.log(failed === 0 ? `all passed (${passed})` : `${failed} FAILED, ${passed} passed`)
process.exit(failed === 0 ? 0 : 1)
