// node src/lib/prisma-errors.test.mjs
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
const { isUniqueViolation, isRecordNotFound } = await load("prisma-errors.ts")

test("P2002 is a unique violation, nothing else is", () => {
  assert.equal(isUniqueViolation({ code: "P2002", meta: { target: ["taskId", "dependsOnTaskId"] } }), true)
  const err = new Error("Unique constraint failed")
  err.code = "P2002"
  assert.equal(isUniqueViolation(err), true)
  for (const other of [{ code: "P2003" }, { code: "P2025" }, { code: 2002 }, new Error("x"), null, undefined, "P2002", 42]) {
    assert.equal(isUniqueViolation(other), false)
  }
})

test("P2025 is a missing record, nothing else is", () => {
  assert.equal(isRecordNotFound({ code: "P2025" }), true)
  for (const other of [{ code: "P2002" }, {}, null, "P2025"]) {
    assert.equal(isRecordNotFound(other), false)
  }
})

console.log(`prisma-errors: ${passed} passed`)
