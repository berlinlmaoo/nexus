// node --experimental-strip-types src/lib/number-format.test.mjs   (from apps/web)
// Numbers on screen: Indonesian dot grouping in both languages, "Rp 6.000.000" with a space, a true minus.
import assert from "node:assert/strict"
import { formatCount, formatRupiah, formatSigned, MINUS } from "./number-format.ts"

assert.equal(formatRupiah(6000000), "Rp 6.000.000")
assert.equal(formatRupiah(150000000), "Rp 150.000.000")
assert.equal(formatRupiah(4838709.68), "Rp 4.838.710")
assert.equal(formatRupiah(0), "Rp 0")
assert.equal(formatRupiah(-5000), `${MINUS}Rp 5.000`)
assert.equal(formatCount(2597), "2.597")
assert.equal(formatCount(1000), "1.000")
assert.equal(formatCount(35000), "35.000")
assert.equal(formatCount(999), "999")
assert.equal(formatCount(-32), "−32")
assert.equal(formatCount(-0.2), "0")
assert.equal(formatCount(2.5, 1), "2,5")
assert.equal(formatCount(1020.04, 1), "1.020")
assert.equal(formatSigned(12), "+12")
assert.equal(formatSigned(-32), "−32")
assert.equal(formatSigned(0), "0")
const commaFree = [formatRupiah(123456789), formatCount(1234567)]
for (const s of commaFree) assert.ok(!s.includes(","), s)
console.log("number-format: ok")
