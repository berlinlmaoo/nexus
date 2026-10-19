/**
 * GIDEON action-card summaries in Indonesian (QA final 19 Oct 2026, E-6 / D-10).
 *
 * Every write tool builds its card summary as one English line ("Send a message to QA Dev 6", "Add Termin 1
 * (Rp 25.000.000) to “Deal”"); that line is stored on the proposal and also handed back to the model, so it stays
 * English in the database. The card shows it under the title, and in the Indonesian UI it read as English on web,
 * iOS and Android. Rather than giving ~30 builders a second template each, this maps the fixed English templates
 * to Indonesian at the edge (proposalView): user content — anything inside “…”, names, numbers — is never
 * touched; only the words of the template, weekday/month abbreviations and "today/tomorrow HH:MM" are.
 * A summary that matches no template keeps its words (dates still localised) — wrong-language at worst, never
 * a wrong fact. Keep the rules in step with the summaries in lib/gideon-tools/*, gideon-book-room.ts and the
 * tools/proposals routes; gideon-summary-i18n.test.mjs covers each one.
 */

export type SummaryLang = "en" | "id"

const WEEKDAY: Record<string, string> = { Mon: "Sen", Tue: "Sel", Wed: "Rab", Thu: "Kam", Fri: "Jum", Sat: "Sab", Sun: "Min" }
const MONTH: Record<string, string> = {
  Jan: "Jan", Feb: "Feb", Mar: "Mar", Apr: "Apr", May: "Mei", Jun: "Jun", Jul: "Jul", Aug: "Agu", Sep: "Sep", Sept: "Sep", Oct: "Okt", Nov: "Nov", Dec: "Des",
}
const LEAVE_TYPE: Record<string, string> = {
  "annual leave": "cuti", sick: "sakit", "permission (izin)": "izin", "day off": "day off", "public holiday": "tanggal merah", request: "pengajuan",
}

/** A card day after localisation ("Sen 12 Okt", "Sen 12 Okt 2027"). */
const DAY = String.raw`(?:Sen|Sel|Rab|Kam|Jum|Sab|Min) \d{1,2} \S+(?: \d{4})?`

type Rule = [RegExp, (...m: string[]) => string]

/** Applied to the summary with every “quoted” part replaced by a placeholder; first match wins. */
const RULES: Rule[] = [
  [/^Send a message to (.+)$/, (_, who) => `Kirim pesan ke ${who}`],
  [/^Create task (\x00\d+\x00) in (.+)$/, (_, q, p) => `Buat task ${q} di ${p}`],
  [/^Create task (\x00\d+\x00)$/, (_, q) => `Buat task ${q}`],
  [/^Update task (\x00\d+\x00)$/, (_, q) => `Ubah task ${q}`],
  [/^Delete task (\x00\d+\x00)$/, (_, q) => `Hapus task ${q}`],
  [/^Comment on (\x00\d+\x00)$/, (_, q) => `Komentar di ${q}`],
  [/^Write doc (\x00\d+\x00) in (.+)$/, (_, q, p) => `Tulis dokumen ${q} di ${p}`],
  [/^AI Autofill on (\x00\d+\x00)$/, (_, q) => `AI Autofill di ${q}`],
  [/^Book (.+) for (\x00\d+\x00)$/, (_, slot, q) => `Booking ${slot} untuk ${q}`],
  [/^Move (\x00\d+\x00) to (.+)$/, (_, q, stage) => `Pindahkan ${q} ke ${stage}`],
  [/^Move (\x00\d+\x00)(.*)$/, (_, q, rest) => `Pindahkan ${q}${rest}`],
  [/^Cancel the reminder (\x00\d+\x00)(.*)$/, (_, q, rest) => `Batalkan pengingat ${q}${rest}`],
  [/^Cancel (\x00\d+\x00)(.*)$/, (_, q, rest) => `Batalkan ${q}${rest}`],
  [/^Post (\x00\d+\x00) to everyone$/, (_, q) => `Umumkan ${q} ke semua orang`],
  [/^Post (\x00\d+\x00) to (.+)$/, (_, q, to) => `Umumkan ${q} ke ${to}`],
  [/^Append to the end in (\x00\d+\x00)$/, (_, q) => `Tambah di akhir ${q}`],
  [/^Append under section (\x00\d+\x00) in (\x00\d+\x00)$/, (_, s, q) => `Tambah di bawah bagian ${s} di ${q}`],
  [/^Append under section in (\x00\d+\x00)$/, (_, q) => `Tambah di bawah bagian di ${q}`],
  [/^Replace section (\x00\d+\x00) in (\x00\d+\x00)$/, (_, s, q) => `Ganti bagian ${s} di ${q}`],
  [/^Replace section in (\x00\d+\x00)$/, (_, q) => `Ganti bagian di ${q}`],
  [/^Add a section (\x00\d+\x00) in (\x00\d+\x00)$/, (_, s, q) => `Tambah bagian ${s} di ${q}`],
  [/^Add a section in (\x00\d+\x00)$/, (_, q) => `Tambah bagian di ${q}`],
  [/^Save (\x00\d+\x00) to Z Vault › (.+)$/, (_, q, f) => `Simpan ${q} ke Z Vault › ${f}`],
  [/^(Annual leave|Sick|Permission \(izin\)|Day off|Public holiday) request for (.+)$/, (_, t, d) => `Pengajuan ${LEAVE_TYPE[t.toLowerCase()]} untuk ${d}`],
  [/^(Approve|Reject) (.+)'s (annual leave|sick|permission \(izin\)|day off|public holiday|request) \((.+)\)$/,
    (_, v, who, t, d) => `${v === "Approve" ? "Setujui" : "Tolak"} ${t === "request" ? "pengajuan" : `pengajuan ${LEAVE_TYPE[t]}`} ${who} (${d})`],
  [/^Create a (.+?) draft from (\x00\d+\x00) for (.+)$/, (_, t, q, who) => `Buat draf ${t} dari ${q} untuk ${who}`],
  [/^Create a (.+?) draft from (\x00\d+\x00)$/, (_, t, q) => `Buat draf ${t} dari ${q}`],
  [new RegExp(`^Fill (.+? · ${DAY}) in (.+)$`), (_, what, p) => `Isi ${what} di ${p}`],
  [/^Add (Termin .+|.+ \(Rp [\d.]+\)) to (\x00\d+\x00)$/, (_, term, q) => `Tambah ${term} ke ${q}`],
  [/^Add (\d+) subtasks? to (\x00\d+\x00)$/, (_, n, q) => `Tambah ${n} subtask ke ${q}`],
  [new RegExp(`^Add (.+? · ${DAY}) in (.+)$`), (_, what, p) => `Tambah ${what} di ${p}`],
  [/^Clear your status (\x00\d+\x00)$/, (_, q) => `Hapus status kamu ${q}`],
  [/^Set your status (\x00\d+\x00)(.*)$/, (_, q, rest) => `Pasang status kamu ${q}${rest}`],
  [/^Remind you (.+)$/, (_, rest) => `Ingatkan kamu ${rest}`],
  [/^Edit (.+) \((.+?)\): (.*)$/, (_, s, p, what) => `Ubah ${s} (${p}): ${what.replace(/\b(\d+) cells?\b/, "$1 sel").replace(/\b(\d+) new rows?\b/, "$1 baris baru")}`],
  [/^New spreadsheet (\x00\d+\x00) in (.+): (\d+) columns? × (\d+) rows?$/, (_, q, p, c, r) => `Spreadsheet baru ${q} di ${p}: ${c} kolom × ${r} baris`],
  [/^Change (\d+) tasks? in (.+)$/, (_, n, p) => `Ubah ${n} task di ${p}`],
  [/^Change (\d+) tasks?$/, (_, n) => `Ubah ${n} task`],
  [/^Share link for (\x00\d+\x00)$/, (_, q) => `Link berbagi untuk ${q}`],
  // Outlet / social: "<platform> · <day> in <project>" (no verb).
  [new RegExp(`^(.+? · ${DAY}) in (.+)$`), (_, what, p) => `${what} di ${p}`],
]

const DATE_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/g
const RELATIVE_RE = /\b(today|tomorrow|yesterday) (\d{2}:\d{2})\b/g
const RELATIVE: Record<string, string> = { today: "hari ini", tomorrow: "besok", yesterday: "kemarin" }

/** The summary in the given language (summaries are built in English; "en" returns it unchanged). */
export function localizeGideonSummary(summary: string, lang: SummaryLang | string | null | undefined): string {
  if (lang !== "id" || !summary) return summary
  const quoted: string[] = []
  let s = summary.replace(/“[^”]*”/g, (q) => `\x00${quoted.push(q) - 1}\x00`)
  // Dates and times first (outside quotes), so the outlet/social rule can see the Indonesian day.
  s = s.replace(DATE_RE, (_, w, d, m) => `${WEEKDAY[w]} ${d} ${MONTH[m]}`).replace(RELATIVE_RE, (_, r, hm) => `${RELATIVE[r]} ${hm}`)
  s = s.replace(/ · a room\b/g, " · ruangan").replace(/^Book a room\b/, "Book ruangan")
  for (const [re, fn] of RULES) {
    const m = s.match(re)
    if (m) { s = fn(...(m as unknown as string[])); break }
  }
  return s.replace(/\x00(\d+)\x00/g, (_, i) => quoted[Number(i)] ?? "")
}

/** Both languages, for clients that pick by their own UI language (web follows its language switch at once). */
export function gideonSummaryPair(summary: string): { summaryEn: string; summaryId: string } {
  return { summaryEn: summary, summaryId: localizeGideonSummary(summary, "id") }
}
