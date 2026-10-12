// node --experimental-strip-types src/lib/gideon-reply-scrub.test.mjs
import assert from "node:assert/strict"
import { scrubGideonReply as s } from "./gideon-reply-scrub.ts"

// The two leaks QA found on ticket "Tgl 4-8 itu permit" (13 Oct 2026).
assert.equal(s("Usulan pembatalan sudah dibuat (ID usulan: `cmu6d4q1i014c01qtzd97uzbt`). Nunggu approve BoD."), "Usulan pembatalan sudah dibuat. Nunggu approve BoD.")
assert.equal(s("Tidak ada potongan yang bisa dibatalkan (`hasPenaltyToCancel = false`)."), "Tidak ada potongan yang bisa dibatalkan.")
assert.equal(s("Catatan: recordedByNexus `recordedByNexus = true` jadi aman."), "Catatan: recordedByNexus jadi aman.")
assert.equal(s("ID usulan: cmu6d4q1i014c01qtzd97uzbt"), "")
// Ordinary text is untouched: words starting with c, times, numbers, plain parentheses.
const plain = "15 Sep: kamu masuk 12:14 (telat 14 menit), lalu nggak bisa check-out karena NEXUS mati 18:09–23:54.\nNunggu approve BoD."
assert.equal(s(plain), plain)
assert.equal(s("Cek catatan cuti (izin sakit)."), "Cek catatan cuti (izin sakit).")
assert.equal(s("Pakai iPhone (iOS 18)."), "Pakai iPhone (iOS 18).")
assert.equal(s("Buka app-nya (iPhone)."), "Buka app-nya (iPhone).")
console.log("gideon-reply-scrub: ok")
assert.equal(s("Pakai app (iOS)."), "Pakai app (iOS).")
