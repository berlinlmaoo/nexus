import { checkLeaveEligibility, leaveDaysInYear, leaveYearRange, eligibleFrom, ANNUAL_LEAVE_DAYS } from "../src/lib/annual-leave"
let pass = 0, fail = 0
const ck = (n: string, a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b) ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n    dapat=${JSON.stringify(a)}\n    mau  =${JSON.stringify(b)}`))

const now = new Date("2026-08-13T00:00:00Z")
ck("belum diisi -> nggak berhak", checkLeaveEligibility(null, now).eligible, false)
ck("baru 6 bulan -> nggak berhak", checkLeaveEligibility(new Date("2026-02-01T00:00:00Z"), now).eligible, false)
ck("pas 12 bulan -> berhak", checkLeaveEligibility(new Date("2025-08-13T00:00:00Z"), now).eligible, true)
ck("kurang sehari dari 12 bln -> nggak berhak", checkLeaveEligibility(new Date("2025-08-14T00:00:00Z"), now).eligible, false)
ck("3 tahun -> berhak", checkLeaveEligibility(new Date("2023-01-05T00:00:00Z"), now).eligible, true)
ck("berhak mulai = +12 bulan", eligibleFrom(new Date("2025-11-20T00:00:00Z")).toISOString().slice(0,10), "2026-11-20")

ck("1 hari = 1", leaveDaysInYear(new Date("2026-03-02T00:00:00Z"), new Date("2026-03-02T00:00:00Z"), 2026), 1)
ck("3 hari = 3", leaveDaysInYear(new Date("2026-03-02T00:00:00Z"), new Date("2026-03-04T00:00:00Z"), 2026), 3)
ck("lintas tahun -> sisi 2026", leaveDaysInYear(new Date("2026-12-30T00:00:00Z"), new Date("2027-01-02T00:00:00Z"), 2026), 2)
ck("lintas tahun -> sisi 2027", leaveDaysInYear(new Date("2026-12-30T00:00:00Z"), new Date("2027-01-02T00:00:00Z"), 2027), 2)
ck("tahun lain -> 0", leaveDaysInYear(new Date("2026-03-02T00:00:00Z"), new Date("2026-03-04T00:00:00Z"), 2025), 0)
ck("reset per 1 Januari", [leaveYearRange(now).start.toISOString().slice(0,10), leaveYearRange(now).end.toISOString().slice(0,10)], ["2026-01-01","2026-12-31"])
ck("jatah 12", ANNUAL_LEAVE_DAYS, 12)
console.log(`\n${pass} lolos, ${fail} gagal`)
process.exit(fail ? 1 : 0)
