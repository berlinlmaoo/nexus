// node src/lib/folder-aggregate.test.mjs
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

const { normalizeAggregateProjectIds, MAX_AGGREGATE_PROJECT_IDS } = await load("folder-aggregate.ts")

test("what iOS and the web send", () => {
  assert.deepEqual(normalizeAggregateProjectIds([]), [])
  assert.deepEqual(normalizeAggregateProjectIds(["p1", "p2"]), ["p1", "p2"])
})

test("null resets, duplicates and blanks dropped, order kept", () => {
  assert.deepEqual(normalizeAggregateProjectIds(null), [])
  assert.deepEqual(normalizeAggregateProjectIds([" p2", "p1", "p2", "", "  "]), ["p2", "p1"])
})

test("not a list of strings → null (400)", () => {
  for (const v of ["p1", 5, {}, [1], ["p1", null], true, undefined]) {
    assert.equal(normalizeAggregateProjectIds(v), null, JSON.stringify(v))
  }
})

test("capped", () => {
  const many = Array.from({ length: MAX_AGGREGATE_PROJECT_IDS + 50 }, (_, i) => `p${i}`)
  assert.equal(normalizeAggregateProjectIds(many).length, MAX_AGGREGATE_PROJECT_IDS)
})

console.log(`folder-aggregate: ${passed} passed`)
