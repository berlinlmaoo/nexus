// node --experimental-strip-types src/lib/gideon-reply-scrub.test.mjs
import assert from "node:assert/strict"
import { scrubGideonReply as s } from "./gideon-reply-scrub.ts"

// The two leaks QA found on ticket "Tgl 4-8 itu permit" (13 Oct 2026).
assert.equal(s("Usulan pembatalan sudah dibuat (ID usulan: `cmu6d4q1i014c01qtzd97uzbt`). Nunggu approve BoD."), "Usulan pembatalan sudah dibuat. Nunggu approve BoD.")
assert.equal(s("Tidak ada potongan yang bisa dibatalkan (`hasPenaltyToCancel = false`)."), "Tidak ada potongan yang bisa dibatalkan.")
assert.equal(s("Catatan: recordedByNexus `recordedByNexus = true` jadi aman."), "Catatan: recorded by nexus jadi aman.")
assert.equal(s("ID usulan: cmu6d4q1i014c01qtzd97uzbt"), "")
// Ids since the UUIDv7 conversion (18 Oct 2026).
assert.equal(s("Usulan pembatalan sudah dibuat (ID usulan: `019cf14d-ebd8-7000-b947-67d4138beaf3`). Nunggu approve BoD."), "Usulan pembatalan sudah dibuat. Nunggu approve BoD.")
assert.equal(s("Tiket 019cf14d-ebd8-7000-b947-67d4138beaf3 sudah ditutup."), "Tiket sudah ditutup.")
// Ordinary text is untouched: words starting with c, times, numbers, plain parentheses.
const plain = "15 Sep: kamu masuk 12:14 (telat 14 menit), lalu nggak bisa check-out karena NEXUS mati 18:09–23:54.\nNunggu approve BoD."
assert.equal(s(plain), plain)
assert.equal(s("Cek catatan cuti (izin sakit)."), "Cek catatan cuti (izin sakit).")
assert.equal(s("Pakai iPhone (iOS 18)."), "Pakai iPhone (iOS 18).")
assert.equal(s("Buka app-nya (iPhone)."), "Buka app-nya (iPhone).")
console.log("gideon-reply-scrub: ok")
assert.equal(s("Pakai app (iOS)."), "Pakai app (iOS).")
// Shapes found in dev data after the first pass (13 Oct 2026).
assert.equal(s("Tanggal 2026-09-16 belum tercatat sebagai hari NEXUS down (outage.recordedByNexus=false), sehingga klaim gagal."), "Tanggal 2026-09-16 belum tercatat sebagai hari NEXUS down, sehingga klaim gagal.")
assert.equal(s("Data menunjukkan autoDayOffsDeducted=1, totalPenaltyXp=-120, dan hasPenaltyToCancel=true. Catatan absensi aman."), "Data menunjukkan. Catatan absensi aman.")
assert.equal(s("Temuan:\n- `xpPenalties.autoDayOffsDeducted = 1`.\n- `xpPenalties.hasPenaltyToCancel = true`.\n- Izin sakit tercatat."), "Temuan:\n- Izin sakit tercatat.")
assert.equal(s("penalti Alpha XP -150, dengan hasPenaltyToCancel=true. Tidak ada catatan."), "penalti Alpha XP -150. Tidak ada catatan.")
assert.equal(s("Contoh: e.g. buka nexus.patsgroup.id lalu cek (lihat menu Absensi)."), "Contoh: e.g. buka nexus.patsgroup.id lalu cek (lihat menu Absensi).")
console.log("gideon-reply-scrub: all ok")
// BoD round 2 (B09): one-hump field names, tool names, enum values, plain content in backticks.
assert.equal(s("Potongan sudah dihapus (`alreadyWaived: true`). Status `PENDING`."), "Potongan sudah dihapus. Status menunggu.")
assert.equal(s("Saya pakai `nexus_resolve_ticket` untuk menutup."), "Saya pakai untuk menutup.")
assert.equal(s("Pengajuan `DAY_OFF` sudah `APPROVED`."), "Pengajuan day off sudah disetujui.")
assert.equal(s("Data coveringRequests kosong, xpPenalties nol."), "Data covering requests kosong, xp penalties nol.")
assert.equal(s("Tanggal acuan: 4 Agustus 2026 (`2026-08-04`), jam `--:--`."), "Tanggal acuan: 4 Agustus 2026 (2026-08-04), jam --:--.")
assert.equal(s("Buka nexus.znetworks.id di iPhone (iOS)."), "Buka nexus.znetworks.id di iPhone (iOS).")
console.log("gideon-reply-scrub: round 2 ok")
assert.equal(s("Pengajuan izin masih PENDING, yang lain APPROVED."), "Pengajuan izin masih menunggu, yang lain disetujui.")
console.log("gideon-reply-scrub: bare statuses ok")
