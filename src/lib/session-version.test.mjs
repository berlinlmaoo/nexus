// node src/lib/session-version.test.mjs
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

const { sessionVersionRejects, isWebClientTag } = await load("session-version.ts")

test("tokens without the field stay valid, whatever the DB says", () => {
  for (const db of [0, 1, 7]) {
    assert.equal(sessionVersionRejects(undefined, db), false)
    assert.equal(sessionVersionRejects(null, db), false)
  }
})

test("current version passes", () => {
  assert.equal(sessionVersionRejects(0, 0), false)
  assert.equal(sessionVersionRejects(3, 3), false)
  assert.equal(sessionVersionRejects("3", 3), false) // defensively tolerant of a stringified claim
})

test("older (or otherwise different) version is refused", () => {
  assert.equal(sessionVersionRejects(0, 1), true)
  assert.equal(sessionVersionRejects(2, 3), true)
  assert.equal(sessionVersionRejects(4, 3), true)
  assert.equal(sessionVersionRejects("x", 0), true)
})

test("web client tag", () => {
  assert.equal(isWebClientTag("web/1"), true)
  assert.equal(isWebClientTag(" WEB/2 "), true)
  for (const t of ["ios/0.1.6/42", "", null, undefined, "android/1.0.0/1", "webby", "NEXUS/41"]) {
    assert.equal(isWebClientTag(t), false, String(t))
  }
})

console.log(`session-version: ${passed} passed`)
