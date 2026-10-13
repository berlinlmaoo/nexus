// node src/lib/legal/diff.test.mjs
//
// Plain node, no test runner (same loader as ../chat-rules.test.mjs). Legal diffs, word and paragraph level,
// for comparing versions and showing what GIDEON proposes.
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

const D = await load("diff.ts")
const join = (segs) => ({ before: segs.filter((s) => s.type !== "ins").map((s) => s.text).join(""), after: segs.filter((s) => s.type !== "del").map((s) => s.text).join("") })

test("word diff marks only the changed words and rebuilds both texts", () => {
  const before = "Jangka waktu 12 (dua belas) bulan sejak tanggal mulai."
  const after = "Jangka waktu 6 (enam) bulan sejak tanggal mulai."
  const segs = D.diffWords(before, after)
  assert.deepEqual(join(segs), { before, after })
  assert.deepEqual(segs.filter((s) => s.type !== "same").map((s) => [s.type, s.text.trim()]), [["del", "12 (dua belas)"], ["ins", "6 (enam)"]])
})
test("paragraph diff: same, changed, added, removed", () => {
  const a = ["Judul", "Pasal 1", "Isi lama", "Hapus saya", "Penutup"]
  const b = ["Judul", "Pasal 1", "Isi baru", "Penutup", "Tambahan"]
  const d = D.diffParagraphs(a, b)
  assert.deepEqual(d.map((x) => x.type), ["same", "same", "changed", "removed", "same", "added"])
  assert.equal(d[2].before, "Isi lama"); assert.equal(d[2].after, "Isi baru")
  assert.deepEqual(D.diffParagraphs(a, a).every((x) => x.type === "same"), true)
  assert.deepEqual(D.diffParagraphs([], ["x"]).map((x) => x.type), ["added"])
})

console.log(`legal diff: ${passed} passed`)
