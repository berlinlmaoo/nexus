/** Aturan izin. `npx tsx scripts/test-permit-rules.ts` */
import { describePermitTiming, isBackdated, reportDelayMinutes } from "../src/lib/permit-rules"

let pass = 0, fail = 0
const ck = (n: string, a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b) ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n    dapat=${JSON.stringify(a)}\n    mau  =${JSON.stringify(b)}`))

// Semua waktu WIB (UTC+7). Shift mulai 09:00 => 02:00 UTC.
const hariItu = new Date("2026-08-13T00:00:00Z")
const jam = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 13, h - 7, m)) // h = jam WIB

ck("lapor 08:30 (lebih awal) -> 0, bukan negatif", reportDelayMinutes(jam(8, 30), hariItu, "09:00"), 0)
ck("lapor pas 09:00 -> 0", reportDelayMinutes(jam(9, 0), hariItu, "09:00"), 0)
ck("lapor 09:10 -> telat 10", reportDelayMinutes(jam(9, 10), hariItu, "09:00"), 10)
ck("lapor 17:00 (lupa absen) -> telat 480", reportDelayMinutes(jam(17, 0), hariItu, "09:00"), 480)

// Toleransi telat kantor 15 menit
ck("telat 10 menit, grace 15 -> BUKAN telat lapor", describePermitTiming(10, 15).lateReport, false)
ck("telat 16 menit, grace 15 -> telat lapor", describePermitTiming(16, 15).lateReport, true)
ck("lapor lebih awal -> label aman", describePermitTiming(0, 15).label, "Dilaporin sebelum/pas jam masuk")
ck("label 8 jam", describePermitTiming(480, 15).label, "Telat lapor 8 jam dari jam masuk")
ck("label 1 jam 5 menit", describePermitTiming(65, 15).label, "Telat lapor 1 jam 5 menit dari jam masuk")
ck("label 45 menit", describePermitTiming(45, 15).label, "Telat lapor 45 menit dari jam masuk")

// Backdate dibandingin sebagai TANGGAL di zona absen, bukan sebagai instant
const skrgWIB = new Date("2026-08-13T18:00:00Z") // 14 Agu 01:00 WIB
ck("hari ini -> bukan backdate", isBackdated(new Date("2026-08-14T00:00:00Z"), skrgWIB), false)
ck("kemarin -> backdate", isBackdated(new Date("2026-08-13T00:00:00Z"), skrgWIB), true)
ck("besok -> bukan backdate", isBackdated(new Date("2026-08-15T00:00:00Z"), skrgWIB), false)
// jam 01:00 WIB, UTC masih tanggal sebelumnya — ini yang gampang salah
ck("dini hari WIB, izin hari ini -> bukan backdate", isBackdated(new Date("2026-08-14T00:00:00Z"), new Date("2026-08-13T17:30:00Z")), false)

console.log(`\n${pass} lolos, ${fail} gagal`)
process.exit(fail ? 1 : 0)
