// node src/lib/attendance-override-evidence.test.mjs
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
const {
  overrideEvidenceKind, resolveOverrideDayState, isSupportedEvidenceFile, evidenceLang,
  OVERRIDE_EVIDENCE_TYPE_MESSAGE, OVERRIDE_EVIDENCE_SIZE_MESSAGE,
} = await load("attendance-override-evidence.ts")

const STATES = ["PRESENT", "PERMIT", "SICK", "LEAVE", "DAY_OFF", "ABSENT", "NONE"]

test("→ SICK always asks for a sick note, from every state", () => {
  for (const s of STATES) assert.equal(overrideEvidenceKind("SICK", s), "SICK_NOTE", s)
})

test("→ PERMIT always asks for evidence, Present included (owner addition 20 Oct 12:45)", () => {
  for (const s of STATES) assert.equal(overrideEvidenceKind("PERMIT", s), "PERMIT_EVIDENCE", s)
})

test("→ PRESENT asks for evidence only from Permit, TK or nothing recorded", () => {
  assert.equal(overrideEvidenceKind("PRESENT", "PERMIT"), "PRESENT_EVIDENCE")
  assert.equal(overrideEvidenceKind("PRESENT", "ABSENT"), "PRESENT_EVIDENCE")
  assert.equal(overrideEvidenceKind("PRESENT", "NONE"), "PRESENT_EVIDENCE")
  for (const s of ["PRESENT", "SICK", "LEAVE", "DAY_OFF"]) assert.equal(overrideEvidenceKind("PRESENT", s), null, s)
})

test("LEAVE, DAY_OFF and CLEAR_PENALTY never ask for evidence (and no action sets TK); action case-insensitive", () => {
  for (const a of ["LEAVE", "DAY_OFF", "CLEAR_PENALTY"]) for (const s of STATES) assert.equal(overrideEvidenceKind(a, s), null, `${a} from ${s}`)
  assert.equal(overrideEvidenceKind("sick", "PRESENT"), "SICK_NOTE")
})

test("day state: approved permit beats a check-in; check-in beats leave types; auto TK = no request", () => {
  assert.equal(resolveOverrideDayState({ hasCheckIn: true, approvedTypes: ["PERMIT"] }), "PERMIT")
  assert.equal(resolveOverrideDayState({ hasCheckIn: true, approvedTypes: [] }), "PRESENT")
  assert.equal(resolveOverrideDayState({ hasCheckIn: false, approvedTypes: ["SICK"] }), "SICK")
  assert.equal(resolveOverrideDayState({ hasCheckIn: false, approvedTypes: ["LEAVE"] }), "LEAVE")
  assert.equal(resolveOverrideDayState({ hasCheckIn: false, approvedTypes: ["RED_DATE"] }), "DAY_OFF")
  assert.equal(resolveOverrideDayState({ hasCheckIn: false, approvedTypes: [], pastWorkday: true }), "ABSENT")
  assert.equal(resolveOverrideDayState({ hasCheckIn: false, approvedTypes: [] }), "NONE")
})

test("evidence file types follow the request route (photo or PDF, octet-stream by extension)", () => {
  assert.equal(isSupportedEvidenceFile("a.jpg", "image/jpeg"), true)
  assert.equal(isSupportedEvidenceFile("a.pdf", "application/pdf"), true)
  assert.equal(isSupportedEvidenceFile("a.HEIC", "application/octet-stream"), true)
  assert.equal(isSupportedEvidenceFile("a.heic", ""), true)
  assert.equal(isSupportedEvidenceFile("a.docx", "application/octet-stream"), false)
  assert.equal(isSupportedEvidenceFile("a.txt", "text/plain"), false)
})

test("messages exist in EN and ID; language from Accept-Language", () => {
  for (const m of [OVERRIDE_EVIDENCE_TYPE_MESSAGE, OVERRIDE_EVIDENCE_SIZE_MESSAGE]) {
    assert.ok(m.en.length > 10 && m.id.length > 10)
  }
  assert.equal(evidenceLang("id"), "id")
  assert.equal(evidenceLang("id-ID,en;q=0.8"), "id")
  assert.equal(evidenceLang("en"), "en")
  assert.equal(evidenceLang(null), "en")
})

console.log(`attendance-override-evidence: ${passed} passed`)
