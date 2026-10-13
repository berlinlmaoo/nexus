// node src/lib/legal/gideon-edit-core.test.mjs
//
// Plain node, no test runner (same loader as ../chat-rules.test.mjs). GIDEON's precise edit of a legal
// document: the prompt marks what may change, and a proposal that wanders is refused.
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

const G = await load("gideon-edit-core.ts")
const paras = [
  { index: 0, text: "Nomor: 001/SPK/PATS/X/2026", editable: false },
  { index: 1, text: "Pasal 1. Jangka waktu 12 (dua belas) bulan.", editable: true },
  { index: 2, text: "Pasal 2. Honor Rp 1.250.000.", editable: true },
  { index: 3, text: "", editable: true },
  { index: 4, text: "Direktur / Pemilik", editable: true },
]

test("prompt: targets, locked, open", () => {
  const withTargets = G.buildEditPrompt({ title: "SPK", paragraphs: paras, targets: [1], instruction: "ubah jadi 6 bulan" })
  assert.match(withTargets, /\[0\] \(LOCKED\) Nomor/)
  assert.match(withTargets, /\[1\] \(TARGET\) Pasal 1/)
  assert.match(withTargets, /\[2\] \(LOCKED\) Pasal 2/)
  assert.doesNotMatch(withTargets, /\[3\]/, "empty paragraphs are left out")
  const open = G.buildEditPrompt({ title: "SPK", paragraphs: paras, targets: [], instruction: "x", thread: [{ instruction: "a", question: "b?", answer: "c" }] })
  assert.match(open, /\[2\] \(OPEN\) Pasal 2/)
  assert.match(open, /You asked: b\?\nThey answered: c/)
})
test("reply parsing", () => {
  assert.deepEqual(G.parseEditReply('```json\n{"action":"clarify","question":"Pasal yang mana?"}\n```'), { kind: "clarify", question: "Pasal yang mana?" })
  const p = G.parseEditReply('Here: {"action":"propose","summary":"6 bulan","changes":[{"index":1,"after":"Pasal 1. Jangka waktu 6 (enam) bulan."}]}')
  assert.equal(p.kind, "propose"); assert.equal(p.changes[0].index, 1)
  assert.equal(G.parseEditReply("sorry").kind, "invalid")
})
test("a proposal is checked: only allowed, editable, real changes", () => {
  const ok = G.checkProposal(paras, [1], [{ index: 1, after: "Pasal 1. Jangka waktu 6 (enam) bulan." }])
  assert.deepEqual(ok, { ok: true, changes: [{ index: 1, before: paras[1].text, after: "Pasal 1. Jangka waktu 6 (enam) bulan." }] })
  assert.match(G.checkProposal(paras, [1], [{ index: 2, after: "x" }]).reason, /didn't select/)
  assert.match(G.checkProposal(paras, [], [{ index: 0, after: "Nomor: 2" }]).reason, /locked/)
  assert.match(G.checkProposal(paras, [], [{ index: 9, after: "x" }]).reason, /doesn't exist/)
  assert.match(G.checkProposal(paras, [], [{ index: 1, after: paras[1].text }]).reason, /no change/)
  assert.match(G.checkProposal(paras, [], [{ index: 1, after: "Honor {{HONOR}}" }]).reason, /placeholder/)
  assert.match(G.checkProposal(paras, [], [{ index: 1, after: "a" }, { index: 1, after: "b" }]).reason, /twice/)
  const slash = G.checkProposal(paras, [], [{ index: 4, after: "Direktur / Pemilik / Kuasa" }])
  assert.equal(slash.changes[0].after, "Direktur / Pemilik / Kuasa", "a slash in the text is not a line break")
  assert.equal(G.checkProposal(paras, [], [{ index: 4, after: "Direktur ⏎ Pemilik" }]).changes[0].after, "Direktur\nPemilik")
})

console.log(`legal gideon edit: ${passed} passed`)
