// node src/lib/legal/rules.test.mjs
//
// Plain node, no test runner (same loader as ../chat-rules.test.mjs). Legal's pure rules: who may invite
// and revoke whom (owner, 14 Oct 2026), and number formats.
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

const R = await load("rules.ts")

// ── access ──
test("root may invite anyone of the company", () => {
  const p = R.invitePowerOf({ isRoot: true, isMember: false, orgRole: null })
  assert.equal(p, "ANY")
  for (const role of ["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"]) assert.equal(R.mayInvite(p, role), true)
  assert.equal(R.mayInvite(p, null), false)
})
test("a BoD / One Above All member the root invited may invite staff only", () => {
  for (const orgRole of ["BOD", "ONE_ABOVE_ALL"]) {
    assert.equal(R.invitePowerOf({ isRoot: false, isMember: true, orgRole, invitedByRoot: false }), "NONE", "invited by a BoD member, then promoted")
    const p = R.invitePowerOf({ isRoot: false, isMember: true, orgRole, invitedByRoot: true })
    assert.equal(p, "STAFF")
    assert.equal(R.mayInvite(p, "STAFF"), true)
    assert.equal(R.mayInvite(p, "MANAGER"), true)
    assert.equal(R.mayInvite(p, "BOD"), false)
    assert.equal(R.mayInvite(p, "ONE_ABOVE_ALL"), false)
  }
})
test("invited staff and managers may not invite", () => {
  for (const orgRole of ["STAFF", "MANAGER"]) {
    const p = R.invitePowerOf({ isRoot: false, isMember: true, orgRole, invitedByRoot: true })
    assert.equal(p, "NONE")
    assert.equal(R.mayInvite(p, "STAFF"), false)
  }
})
test("a BoD member who was never invited has no power", () => {
  assert.equal(R.invitePowerOf({ isRoot: false, isMember: false, orgRole: "BOD" }), "NONE")
})
test("revoke: root anyone, BoD only their own invitees, staff nobody", () => {
  assert.equal(R.mayRevoke({ userId: "root", power: "ANY" }, "someone"), true)
  assert.equal(R.mayRevoke({ userId: "root", power: "ANY" }, null), true)
  assert.equal(R.mayRevoke({ userId: "bod", power: "STAFF" }, "bod"), true)
  assert.equal(R.mayRevoke({ userId: "bod", power: "STAFF" }, "root"), false)
  assert.equal(R.mayRevoke({ userId: "bod", power: "STAFF" }, null), false)
  assert.equal(R.mayRevoke({ userId: "s", power: "NONE" }, "s"), false)
})
test("root emails: env list wins, empty falls back to the owner", () => {
  assert.deepEqual(R.parseRootEmails(""), ["bagasputro.bp@gmail.com"])
  assert.deepEqual(R.parseRootEmails(undefined), ["bagasputro.bp@gmail.com"])
  assert.deepEqual(R.parseRootEmails(" A@x.id , b@y.id "), ["a@x.id", "b@y.id"])
})

// ── number formats ──
const base = { seq: 4, year: 2026, month: 10, companyCode: "PATS" }
test("the owner's formats render as in the templates, plus the running number", () => {
  assert.equal(R.renderNumber({ ...base, format: "{SEQ:3}/SPK-TALENT/PATS/{ROMAWI}/{YYYY}" }), "004/SPK-TALENT/PATS/X/2026")
  assert.equal(
    R.renderNumber({ ...base, month: 9, seq: 1, format: "NDA/CH/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}", fields: { KOTA: "Jakarta" } }),
    "NDA/CH/PATS-UNIV/JAKARTA/SEP/2026/001",
  )
  assert.equal(R.renderNumber({ ...base, seq: 12, format: "PATS/INV/{ROMAWI}/{YYYY}-{SEQ:3}" }), "PATS/INV/X/2026-012")
  assert.equal(R.renderNumber({ ...base, format: "{SEQ}/SP-{TINGKAT}/HRD/{CO}/{MM}/{YY}", fields: { tingkat: "I" } }), "004/SP-I/HRD/PATS/10/26")
})
test("field values are cleaned for the slashes", () => {
  assert.equal(R.numberSegment(" Daerah Istimewa  Yogyakarta "), "DAERAH-ISTIMEWA-YOGYAKARTA")
  assert.equal(R.numberSegment("Bandung/Cimahi"), "BANDUNGCIMAHI")
  assert.equal(R.numberSegment("Café"), "CAFE")
})
test("a missing field fails the number, or prints ____ in a preview", () => {
  const format = "SPK/CC/PATS-UNIV/{KOTA}/{BLN}/{YYYY}/{SEQ:3}"
  assert.throws(() => R.renderNumber({ ...base, format }), (e) => e instanceof R.NumberFormatError && e.missing[0] === "KOTA")
  assert.equal(R.renderNumber({ ...base, format, preview: true }), "SPK/CC/PATS-UNIV/____/OKT/2026/004")
  assert.deepEqual(R.formatFieldNames(format), ["KOTA"])
})
test("format validation: {SEQ} required, braces must close", () => {
  assert.equal(R.formatProblem("PKS/{CO}/{YYYY}"), "Format must contain {SEQ}")
  assert.equal(R.formatProblem("{SEQ}/{CO"), "Format has an unclosed or invalid {token}")
  assert.equal(R.formatProblem("{SEQ:3}/{CO}/{ROMAWI}/{YYYY}"), null)
  assert.equal(R.formatProblem(""), "Format is empty")
})
test("series: the counter's reset period must be visible in the number", () => {
  assert.equal(R.seriesProblem("{SEQ}/X/{YYYY}", "YEAR"), null)
  assert.equal(R.seriesProblem("{SEQ}/X/{ROMAWI}", "YEAR"), "Format must contain the year ({YYYY} or {YY})")
  assert.match(R.seriesProblem("{SEQ}/X/{YYYY}", "MONTH"), /monthly counter/)
  assert.equal(R.seriesProblem("INV/{CO}/{BLN}/{YY}/{SEQ}", "MONTH"), null)
  assert.equal(R.seriesProblem("{SEQ}/{YYYY}", "WEEK"), "Reset must be YEAR or MONTH")
})
test("Jakarta month: 31 Oct 20:00 UTC is already November", () => {
  assert.deepEqual(R.jakartaYearMonth(new Date("2026-10-31T20:00:00Z")), { year: 2026, month: 11 })
  assert.deepEqual(R.jakartaYearMonth(new Date("2026-12-31T16:59:00Z")), { year: 2026, month: 12 })
  assert.deepEqual(R.jakartaYearMonth(new Date("2026-12-31T17:00:00Z")), { year: 2027, month: 1 })
})
test("status: VOID is one-way, SIGNED only by the signed copy and then locked", () => {
  for (const to of ["DRAFT", "FINAL", "SENT", "SIGNED"]) assert.match(R.statusChangeProblem("VOID", to), /Void is final/)
  assert.equal(R.statusChangeProblem("VOID", "VOID"), null)
  for (const from of ["DRAFT", "FINAL", "SENT", "SIGNED"]) assert.equal(R.statusChangeProblem(from, "VOID"), null)
  for (const to of ["DRAFT", "FINAL", "SENT"]) assert.match(R.statusChangeProblem("SIGNED", to), /locked/)
  assert.match(R.statusChangeProblem("FINAL", "SIGNED", { source: "GENERATED" }), /Upload the signed copy/)
  assert.equal(R.statusChangeProblem("FINAL", "SIGNED", { source: "UPLOADED" }), null)
  assert.equal(R.statusChangeProblem("FINAL", "SIGNED", { viaSignedUpload: true }), null)
  assert.equal(R.statusChangeProblem("SENT", "SIGNED", { viaSignedUpload: true }), null)
  assert.match(R.statusChangeProblem("DRAFT", "SIGNED", { viaSignedUpload: true }), /final or sent/)
  assert.equal(R.statusChangeProblem("DRAFT", "FINAL"), null)
  assert.match(R.lockProblem("SIGNED"), /locked/)
  assert.equal(R.lockProblem("FINAL"), null)
})
test("void releases the number only when it was never signed", () => {
  assert.equal(R.releasesNumberOnVoid({ documentNumberId: "n1", signedAt: null, status: "FINAL" }), true)
  assert.equal(R.releasesNumberOnVoid({ documentNumberId: "n1", signedAt: "2026-10-14", status: "SIGNED" }), false)
  assert.equal(R.releasesNumberOnVoid({ documentNumberId: "n1", signedAt: null, status: "SIGNED" }), false)
  assert.equal(R.releasesNumberOnVoid({ documentNumberId: null, signedAt: null, status: "DRAFT" }), false)
})
test("numbers: the lowest released first, then max + 1", () => {
  assert.deepEqual(R.pickSeq([]), { seq: 1, reuse: false })
  const rows = [1, 2, 3, 4, 5].map((seq) => ({ seq, released: false }))
  assert.deepEqual(R.pickSeq(rows), { seq: 6, reuse: false })
  rows[3].released = true
  rows[1].released = true
  assert.deepEqual(R.pickSeq(rows), { seq: 2, reuse: true })
  rows[1].released = false // 2 reused
  assert.deepEqual(R.pickSeq(rows), { seq: 4, reuse: true })
  rows[3].released = false // 4 reused
  assert.deepEqual(R.pickSeq(rows), { seq: 6, reuse: false })
})
test("addenda: number and ordinal", () => {
  assert.equal(R.addendumNumber("PKS/PATS-UNIV/YOGYAKARTA/OKT/2026/001", 2), "PKS/PATS-UNIV/YOGYAKARTA/OKT/2026/001/ADD-2")
  assert.deepEqual([1, 2, 3, 4, 10, 11, 12, 20, 21].map(R.ordinalWord), ["Pertama", "Kedua", "Ketiga", "Keempat", "Kesepuluh", "Kesebelas", "Kedua Belas", "Kedua Puluh", "Kedua Puluh Satu"])
  assert.ok(R.isLegalDocType("ADD"))
})
test("file names carry the revision", () => {
  const d = (status, extra = {}) => ({ status, currentVersion: 3, finalVersion: null, signedVersion: null, ...extra })
  assert.deepEqual([1, 2, 3].map((v) => R.revisionLabel(d("DRAFT"), v)), ["REV 1", "REV 2", "REV 3"])
  assert.deepEqual([1, 2, 3].map((v) => R.revisionLabel(d("FINAL"), v)), ["REV 1", "REV 2", "FINAL"])
  assert.deepEqual([1, 2, 3].map((v) => R.revisionLabel(d("SENT", { finalVersion: 2 }), v)), ["REV 1", "FINAL", "REV 3"])
  assert.deepEqual([1, 2, 3, 4].map((v) => R.revisionLabel(d("SIGNED", { currentVersion: 4, signedVersion: 4 }), v)), ["REV 1", "REV 2", "FINAL", "SIGNED"])
  assert.deepEqual([1, 2, 3].map((v) => R.revisionLabel(d("VOID"), v)), ["REV 1", "REV 2", "REV 3"])
  assert.equal(R.downloadBaseName("PKS/PATS/2026/001", "Kontrak: Venue", "REV 2"), "PKS-PATS-2026-001 - Kontrak- Venue REV 2")
  assert.equal(R.downloadBaseName("", "Surat", "FINAL"), "Surat FINAL")
})

console.log(`legal rules: ${passed} passed`)
