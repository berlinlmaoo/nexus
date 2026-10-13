// node --experimental-strip-types src/lib/qr.test.mjs
// The encoder was checked module for module by decoding its output with jsQR (versions 1–19, UTF-8,
// multi-block) on 12 Oct 2026; this pins that output and the structure so a refactor can't drift.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { qrMatrix, qrSvgPath } from "./qr.ts"

const url = "https://nexus.znetworks.id/f/pengajuan-finance-management"
const m = qrMatrix(url)
assert.equal(m.length, 33) // version 4
const hash = createHash("sha1").update(m.map((r) => r.map((b) => (b ? 1 : 0)).join("")).join("\n")).digest("hex")
assert.equal(hash, "f72fd92449716de4991c8a0f177ccea462f7e227")
// Finder pattern corners: dark ring, light ring, dark 3×3 core.
for (const [ox, oy] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const d = Math.max(Math.abs(x - 3), Math.abs(y - 3))
    assert.equal(m[oy + y][ox + x], d !== 2, `finder at ${ox},${oy}`)
  }
}
assert.equal(qrMatrix("a").length, 21)
assert.equal(qrMatrix("x".repeat(120)).length, 45) // version 7: carries version info blocks
assert.ok(qrSvgPath(qrMatrix("a")).startsWith("M"))
console.log("qr: ok")
