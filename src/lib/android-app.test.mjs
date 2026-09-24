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

const H = 3600 * 1000
const T0 = Date.parse("2026-10-01T03:00:00Z")

test("store URL: default download page, https override, junk ignored", () => {
  assert.equal(M.ANDROID_DOWNLOAD_URL_DEFAULT, "https://nexus.znetworks.id/download/android")
  assert.equal(M.androidStoreUrl({}), M.ANDROID_DOWNLOAD_URL_DEFAULT)
  assert.equal(M.androidStoreUrl({ NEXUS_ANDROID_STORE_URL: "  " }), M.ANDROID_DOWNLOAD_URL_DEFAULT)
  assert.equal(M.androidStoreUrl({ NEXUS_ANDROID_STORE_URL: M.PLAY_STORE_URL }), M.PLAY_STORE_URL)
  assert.equal(M.androidStoreUrl({ NEXUS_ANDROID_STORE_URL: "http://nexus.znetworks.id/download/android" }), M.ANDROID_DOWNLOAD_URL_DEFAULT)
  assert.equal(M.androidStoreUrl({ NEXUS_ANDROID_STORE_URL: "download page" }), M.ANDROID_DOWNLOAD_URL_DEFAULT)
  assert.equal(M.isPlayStoreUrl(M.PLAY_STORE_URL), true)
  assert.equal(M.isPlayStoreUrl(M.ANDROID_DOWNLOAD_URL_DEFAULT), false)
  assert.equal(M.withVersionParam(M.ANDROID_DOWNLOAD_URL_DEFAULT, "0.2.0"), "https://nexus.znetworks.id/download/android?v=0.2.0")
  assert.equal(M.withVersionParam(M.PLAY_STORE_URL, "0.2.0"), `${M.PLAY_STORE_URL}&v=0.2.0`)
})

test("policy without a release moment: exactly the old env-only policy, no window", () => {
  const env = { NEXUS_ANDROID_MIN_VERSION: "0.1.6", NEXUS_ANDROID_LATEST_VERSION: "0.2.0" }
  assert.deepEqual(M.computeAndroidVersionPolicy(env, T0), { minSupported: "0.1.6", latest: "0.2.0", storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT })
  assert.deepEqual(M.computeAndroidVersionPolicy({}, T0), { minSupported: "0.0.0", latest: null, storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT })
  // unreadable moment → ignored, same as unset
  for (const bad of ["2026-10-01", "yesterday", "2026-10-01T03:00:00"]) {
    assert.deepEqual(M.computeAndroidVersionPolicy({ ...env, NEXUS_ANDROID_LATEST_RELEASED_AT: bad }, T0).minSupported, "0.1.6", bad)
    assert.equal(M.computeAndroidVersionPolicy({ ...env, NEXUS_ANDROID_LATEST_RELEASED_AT: bad }, T0).graceUntil, undefined, bad)
  }
})

test("policy with a release moment: the iOS 3-day rule", () => {
  const env = { NEXUS_ANDROID_MIN_VERSION: "0.1.6", NEXUS_ANDROID_LATEST_VERSION: "0.2.0", NEXUS_ANDROID_LATEST_RELEASED_AT: "2026-10-01T03:00:00Z" }
  assert.equal(M.ANDROID_GRACE_MS, 72 * H)
  const inside = M.computeAndroidVersionPolicy(env, T0 + 71 * H)
  assert.deepEqual(inside, { minSupported: "0.1.6", latest: "0.2.0", storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT, graceUntil: "2026-10-04T03:00:00.000Z", nextMinimum: "0.2.0" })
  // Before the stated moment too (announced early), and a zone offset is honoured.
  assert.equal(M.computeAndroidVersionPolicy({ ...env, NEXUS_ANDROID_LATEST_RELEASED_AT: "2026-10-01T10:00:00+07:00" }, T0 - H).graceUntil, "2026-10-04T03:00:00.000Z")
  // At graceUntil exactly: it IS the minimum (same <= as iOS), window gone.
  assert.deepEqual(M.computeAndroidVersionPolicy(env, T0 + 72 * H), { minSupported: "0.2.0", latest: "0.2.0", storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT })
  // latest not above the floor → nothing to announce, floor unchanged
  assert.deepEqual(M.computeAndroidVersionPolicy({ ...env, NEXUS_ANDROID_MIN_VERSION: "0.2.0" }, T0), { minSupported: "0.2.0", latest: "0.2.0", storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT })
  assert.equal(M.computeAndroidVersionPolicy({ ...env, NEXUS_ANDROID_MIN_VERSION: "0.3.0" }, T0 + 100 * H).minSupported, "0.3.0")
  // no latest → the moment means nothing
  assert.deepEqual(M.computeAndroidVersionPolicy({ NEXUS_ANDROID_LATEST_RELEASED_AT: "2026-10-01T03:00:00Z" }, T0 + 100 * H), { minSupported: "0.0.0", latest: null, storeUrl: M.ANDROID_DOWNLOAD_URL_DEFAULT })
})

const versionPolicySrc = await readFile(path.join(here, "version-policy.ts"), "utf8")
test("grace window equals iOS's GRACE_MS", () => {
  assert.match(versionPolicySrc, /export const GRACE_MS = 3 \* 24 \* 60 \* 60 \* 1000/)
})

console.log(`android-app: ${passed} passed`)
