// node --experimental-strip-types src/lib/device-label.test.mjs
import assert from "node:assert/strict"
import { describeDevice } from "./device-label.ts"

const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
assert.deepEqual(describeDevice(mac, "web/1"), { type: "browser", browser: "Chrome", os: "macOS", kind: "desktop" })
assert.deepEqual(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", null), { type: "browser", browser: "Safari", os: "iOS", kind: "phone" })
assert.deepEqual(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "web/1"), { type: "browser", browser: "Edge", os: "Windows", kind: "desktop" })
assert.deepEqual(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", null), { type: "browser", browser: "Samsung Internet", os: "Android", kind: "phone" })
assert.deepEqual(describeDevice("NEXUS/31 CFNetwork/1568.100.1 Darwin/24.0.0", "ios/0.1.6/31"), { type: "app", platform: "ios", version: "0.1.6", build: "31", kind: "phone" })
assert.deepEqual(describeDevice("NEXUS/12 CFNetwork/1568.100.1 Darwin/24.0.0", null), { type: "app", platform: "ios", version: null, build: "12", kind: "phone" })
assert.deepEqual(describeDevice("okhttp/4.12.0", "android/0.1.0/1"), { type: "app", platform: "android", version: "0.1.0", build: "1", kind: "phone" })
assert.deepEqual(describeDevice("curl/8.0", null), { type: "unknown", kind: "unknown" })
assert.deepEqual(describeDevice(null, null), { type: "unknown", kind: "unknown" })
console.log("device-label: ok")
