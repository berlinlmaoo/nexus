// node src/lib/client-version.test.mjs
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

const { parseClientTag, nativeAppPlatformOf, compareVersions } = await load("client-version.ts")

test("android tags with a full x.y.z parse, platform lower-cased, build kept", () => {
  assert.deepEqual(parseClientTag("android/0.1.0/1"), { platform: "android", version: [0, 1, 0], build: "1" })
  assert.deepEqual(parseClientTag("Android/1.12.3/456"), { platform: "android", version: [1, 12, 3], build: "456" })
  assert.deepEqual(parseClientTag("  android/0.1.6  "), { platform: "android", version: [0, 1, 6], build: null })
  // versionName suffixes are swallowed by the prefix match, like iOS
  assert.deepEqual(parseClientTag("android/0.2.0-rc1/7"), { platform: "android", version: [0, 2, 0], build: "7" })
})

test("android tags without three parts are unreadable (null): never gated, looser rules", () => {
  for (const t of ["android/1", "android/0.1", "android/0.1/5", "android/", "android", "android/x.y.z/1"]) {
    assert.equal(parseClientTag(t), null, t)
  }
})

test("iOS and web parsing is unchanged", () => {
  assert.deepEqual(parseClientTag("ios/0.1.6/12"), { platform: "ios", version: [0, 1, 6], build: "12" })
  assert.equal(parseClientTag("ios/1"), null)
  assert.deepEqual(parseClientTag("web/1"), { platform: "web", version: [1, 0, 0], build: null })
  assert.deepEqual(parseClientTag("somethingelse/2.1"), { platform: "somethingelse", version: [2, 1, 0], build: null })
  assert.equal(parseClientTag(null), null)
  assert.equal(parseClientTag(""), null)
})

test("nativeAppPlatformOf labels only readable native tags", () => {
  assert.equal(nativeAppPlatformOf("android/0.1.0/1"), "android")
  assert.equal(nativeAppPlatformOf("ios/0.1.6/12"), "ios")
  for (const t of [null, undefined, "", "web/1", "android/0.1", "ios/1", "NEXUS/11", "windows/1.0.0/1"]) {
    assert.equal(nativeAppPlatformOf(t), null, String(t))
  }
})

test("android versions compare numerically against a floor", () => {
  const v = parseClientTag("android/0.1.10/3").version
  assert.equal(compareVersions(v, "0.1.9"), 1)
  assert.equal(compareVersions(parseClientTag("android/0.0.9/1").version, "0.1.0"), -1)
  assert.equal(compareVersions(parseClientTag("android/0.1.0/1").version, "0.1.0"), 0)
  // the default floor 0.0.0 lets every readable android build through
  assert.ok(compareVersions(parseClientTag("android/0.0.0/1").version, "0.0.0") >= 0)
})

console.log(`client-version: ${passed} passed`)
