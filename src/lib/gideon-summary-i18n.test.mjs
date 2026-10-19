// node --experimental-strip-types src/lib/gideon-summary-i18n.test.mjs
import assert from "node:assert/strict"
import { localizeGideonSummary as id0, gideonSummaryPair } from "./gideon-summary-i18n.ts"

const id = (s) => id0(s, "id")
const cases = [
  ["Send a message to QA Dev 6", "Kirim pesan ke QA Dev 6"],
  ["Create task “Fix in login” in ZZ Realtime", "Buat task “Fix in login” di ZZ Realtime"],
  ["Create task “Draft”", "Buat task “Draft”"],
  ["Update task “Draft”", "Ubah task “Draft”"],
  ["Delete task “Draft”", "Hapus task “Draft”"],
  ["Comment on “Draft”", "Komentar di “Draft”"],
  ["Write doc “Brief” in PATS", "Tulis dokumen “Brief” di PATS"],
  ["AI Autofill on “Draft”", "AI Autofill di “Draft”"],
  ["Book Studio · Fri 23 Oct 10:00–11:00 for “Review”", "Booking Studio · Jum 23 Okt 10:00–11:00 untuk “Review”"],
  ["Book a room · Fri 23 Oct 10:00–11:00 for “Review”", "Booking ruangan · Jum 23 Okt 10:00–11:00 untuk “Review”"],
  ["Move “Review” · Studio · Fri 23 Oct 10:00–11:00 → VIP · Sat 24 Oct 10:00–11:00", "Pindahkan “Review” · Studio · Jum 23 Okt 10:00–11:00 → VIP · Sab 24 Okt 10:00–11:00"],
  ["Move “Deal A” to Negotiation", "Pindahkan “Deal A” ke Negotiation"],
  ["Move “Task” · To Do → Done", "Pindahkan “Task” · To Do → Done"],
  ["Cancel “Review” · Studio · Fri 23 Oct 10:00–11:00", "Batalkan “Review” · Studio · Jum 23 Okt 10:00–11:00"],
  ["Post “Libur” to everyone", "Umumkan “Libur” ke semua orang"],
  ["Post “Libur” to Creative, Ops", "Umumkan “Libur” ke Creative, Ops"],
  ["Append to the end in “Notes”", "Tambah di akhir “Notes”"],
  ["Replace section “Scope” in “Notes”", "Ganti bagian “Scope” di “Notes”"],
  ["Add a section “Scope” in “Notes”", "Tambah bagian “Scope” di “Notes”"],
  ["Save “Ringkasan Project Legal.docx” to Z Vault › Z Vault", "Simpan “Ringkasan Project Legal.docx” ke Z Vault › Z Vault"],
  ["Annual leave request for Fri 23 Oct – Mon 26 Oct", "Pengajuan cuti untuk Jum 23 Okt – Sen 26 Okt"],
  ["Permission (izin) request for Fri 23 Oct", "Pengajuan izin untuk Jum 23 Okt"],
  ["Approve QA Dev 6's day off (Fri 23 Oct)", "Setujui pengajuan day off QA Dev 6 (Jum 23 Okt)"],
  ["Reject QA Dev 6's annual leave (Fri 23 Oct – Mon 26 Oct)", "Tolak pengajuan cuti QA Dev 6 (Jum 23 Okt – Sen 26 Okt)"],
  ["Create a NDA draft from “NDA Standard” for PT Maju", "Buat draf NDA dari “NDA Standard” untuk PT Maju"],
  ["Fill TES · Mon 12 Oct in Outlet PATS", "Isi TES · Sen 12 Okt di Outlet PATS"],
  ["Add Night in Bali · Mon 12 Oct in Outlet in Bali", "Tambah Night in Bali · Sen 12 Okt di Outlet in Bali"],
  ["Instagram · Mon 12 Oct in Social PATS", "Instagram · Sen 12 Okt di Social PATS"],
  ["Add Termin 1 (Rp 25.000.000) to “Deal A”", "Tambah Termin 1 (Rp 25.000.000) ke “Deal A”"],
  ["Add DP (Rp 5.000.000) to “Deal A”", "Tambah DP (Rp 5.000.000) ke “Deal A”"],
  ["Add 3 subtasks to “Parent”", "Tambah 3 subtask ke “Parent”"],
  ["Clear your status “Away · Meeting”", "Hapus status kamu “Away · Meeting”"],
  ["Set your status “Away · Meeting” today 10:00–tomorrow 11:00 WIB", "Pasang status kamu “Away · Meeting” hari ini 10:00–besok 11:00 WIB"],
  ["Remind you tomorrow 09:00 WIB: call vendor", "Ingatkan kamu besok 09:00 WIB: call vendor"],
  ["Cancel the reminder “call vendor” (Fri 23 Oct 09:00 WIB)", "Batalkan pengingat “call vendor” (Jum 23 Okt 09:00 WIB)"],
  ["Edit RT sheet (ZZ Realtime): 1 cell", "Ubah RT sheet (ZZ Realtime): 1 sel"],
  ["Edit RT sheet (ZZ Realtime): 2 cells + 3 new rows", "Ubah RT sheet (ZZ Realtime): 2 sel + 3 baris baru"],
  ["New spreadsheet “Budget” in PATS: 4 columns × 10 rows", "Spreadsheet baru “Budget” di PATS: 4 kolom × 10 baris"],
  ["Change 5 tasks in PATS", "Ubah 5 task di PATS"],
  ["Change 1 task", "Ubah 1 task"],
  ["Share link for “Logo.png”", "Link berbagi untuk “Logo.png”"],
  // User content inside quotes is never translated.
  ["Comment on “Send a message to Fri 23 Oct today 10:00”", "Komentar di “Send a message to Fri 23 Oct today 10:00”"],
  // Unknown template: unchanged words, dates localised.
  ["Something new on Fri 23 Oct", "Something new on Jum 23 Okt"],
]
for (const [en, want] of cases) assert.equal(id(en), want, en)
assert.equal(id0("Send a message to X", "en"), "Send a message to X")
assert.equal(id0("Send a message to X", null), "Send a message to X")
assert.deepEqual(gideonSummaryPair("Change 1 task"), { summaryEn: "Change 1 task", summaryId: "Ubah 1 task" })
console.log(`gideon-summary-i18n: ${cases.length} cases ok`)
