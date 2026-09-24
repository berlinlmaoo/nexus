// node src/lib/android-app.test.mjs
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

const M = await load("android-app.ts")

// Real-shaped fingerprint (32 bytes). Expected origin computed independently below.
const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"
const FP_HEX = FP.replace(/:/g, "")

test("floor: unset/unreadable → 0.0.0; x.y.z only", () => {
  assert.equal(M.androidMinVersion({}), "0.0.0")
  assert.equal(M.androidMinVersion({ NEXUS_ANDROID_MIN_VERSION: "" }), "0.0.0")
  assert.equal(M.androidMinVersion({ NEXUS_ANDROID_MIN_VERSION: "0.1" }), "0.0.0")
  assert.equal(M.androidMinVersion({ NEXUS_ANDROID_MIN_VERSION: " 0.1.06 " }), "0.1.6")
  assert.equal(M.androidLatestVersion({}), null)
  assert.equal(M.androidLatestVersion({ NEXUS_ANDROID_LATEST_VERSION: "0.2.0" }), "0.2.0")
  assert.equal(M.androidLatestVersion({ NEXUS_ANDROID_LATEST_VERSION: "latest" }), null)
})

test("fingerprints: both spellings, dedupe, junk dropped", () => {
  assert.deepEqual(M.androidCertFingerprints(""), [])
  assert.deepEqual(M.androidCertFingerprints(undefined), [])
  assert.deepEqual(M.androidCertFingerprints(`${FP}, ${FP_HEX.toLowerCase()}, nope, AB:CD`), [FP])
})

test("apk-key-hash origin = base64url(sha256 bytes), no padding", () => {
  const expected = "android:apk-key-hash:" + Buffer.from(FP_HEX, "hex").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  assert.equal(M.apkKeyHashOrigin(FP), expected)
  assert.ok(!expected.includes("="))
  assert.deepEqual(M.androidPasskeyOrigins(FP), [expected])
  assert.deepEqual(M.androidPasskeyOrigins(""), [])
})

test("assetlinks: [] until a fingerprint exists, then one statement for the package", () => {
  assert.deepEqual(M.assetLinksStatements(""), [])
  const s = M.assetLinksStatements(FP)
  assert.equal(s.length, 1)
  assert.deepEqual(s[0].target, { namespace: "android_app", package_name: "id.znetworks.nexus", sha256_cert_fingerprints: [FP] })
  assert.deepEqual(s[0].relation.sort(), ["delegate_permission/common.get_login_creds", "delegate_permission/common.handle_all_urls"])
  assert.equal(M.PLAY_STORE_URL, "https://play.google.com/store/apps/details?id=id.znetworks.nexus")
})

console.log(`android-app: ${passed} passed`)
