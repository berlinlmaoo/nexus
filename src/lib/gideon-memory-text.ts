/**
 * GIDEON Memory text rules (19 Oct 2026), pure (no database) so they can be tested with plain node
 * (gideon-memory-text.test.mjs). Used by lib/gideon-memory.ts.
 */

export const MEMORY_KINDS = ["PREFERENCE", "FACT", "PERSON", "DATE"] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]
export const MEMORY_TEXT_MAX = 200

// ── Text rules ────────────────────────────────────────────────────────────────────────────────────────

export function cleanMemoryText(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_MAX) : ""
}

/** The dedupe key: lowercase, punctuation and spacing folded. "Pakai aku-kamu." == "pakai aku kamu". */
export function memoryKey(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200)
}

export function parseKind(raw: unknown): MemoryKind {
  const k = typeof raw === "string" ? raw.trim().toUpperCase() : ""
  if ((MEMORY_KINDS as readonly string[]).includes(k)) return k as MemoryKind
  if (k === "STYLE" || k === "LANGUAGE" || k === "TONE") return "PREFERENCE"
  if (k === "BIRTHDAY" || k === "ANNIVERSARY") return "DATE"
  return "FACT"
}

/** "MM-DD" from "MM-DD", "YYYY-MM-DD", "DD/MM" or "DD-MM-YYYY"; null when it is not a real day. */
export function parseMonthDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  let m: RegExpMatchArray | null
  let mm = 0
  let dd = 0
  if ((m = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/))) { mm = +m[1]; dd = +m[2] }
  else if ((m = s.match(/^(\d{1,2})-(\d{1,2})$/))) { mm = +m[1]; dd = +m[2] }
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?$/))) { dd = +m[1]; mm = +m[2] }
  else return null
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (mm < 1 || mm > 12 || dd < 1 || dd > days[mm - 1]) return null
  return `${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
}

/** Never kept, even when asked: credentials and numbers that open accounts. */
const SECRET_RE = /\b(password|passwd|passcode|kata ?sandi|sandi|pin|otp|kode verifikasi|verification code|token|api ?key|secret key|private key|seed phrase|cvv|cvc|nomor kartu|card number|no\.? ?rek(ening)?|nomor rekening|account number|nomor ktp|no\.? ?ktp|npwp)\b|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b|\b\d{10,}\b/i
/** Kept only when the person explicitly asked GIDEON to remember it. */
const SENSITIVE_RE = /\b(sakit|penyakit|diagnos\w*|obat|terapi|hamil|keguguran|mental|depresi|anxiety|cemas|kanker|diabetes|hiv|disabilitas|health|illness|medication|pregnan\w*|therapy|agama|religion|religious|islam|muslim|kristen|katolik|christian|catholic|hindu|buddha|budha|konghucu|ateis|atheist|sholat|salat|ibadah|politik|politic\w*|partai|pemilu|pilpres|capres|election|vote|voting|orientasi seksual|sexual orientation|gay|lesbian|lgbt|gaji|salary|utang|hutang|debt|cerai|divorce)\b/i

export function memoryRisk(text: string): "secret" | "sensitive" | null {
  if (SECRET_RE.test(text)) return "secret"
  if (SENSITIVE_RE.test(text)) return "sensitive"
  return null
}

/** The question asks GIDEON to remember something ("inget ya…", "remember that…", "catat ya…"). */
const EXPLICIT_RE = /\b(inget(in)?|ingat(kan)?|ingetin|remember|catat|dicatat|simpan|disimpan|jangan lupa|don'?t forget|note that|keep in mind|save (this|that))\b/i
export function asksToRemember(question: string): boolean {
  return EXPLICIT_RE.test(question || "")
}

/** A short yes to GIDEON's "Aku ingat ya: …?" typed as a reply (clients without the chip, or people who just type). */
const AFFIRM_RE = /^\s*(iya+|iy+a|ya+|yap|yup|yes|yess+|boleh|bole|oke+|ok|okay|sip|siap|betul|bener|benar|simpan( aja)?|save( it)?|sure|please|tolong)\b[\s\S]{0,40}$/i
export function isAffirmation(question: string): boolean {
  return AFFIRM_RE.test(question || "")
}


const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
}

/** A day named inside a sentence: "ultah aku 14 Maret", "birthday March 14", "lahir 14/3". Null when none. */
export function monthDayInText(text: string): string | null {
  const s = (text || "").toLowerCase()
  let m = s.match(/\b(\d{1,2})\s+([a-z]{3,9})\b/)
  if (m && MONTHS[m[2]]) return parseMonthDay(`${MONTHS[m[2]]}-${m[1]}`)
  m = s.match(/\b([a-z]{3,9})\s+(\d{1,2})\b/)
  if (m && MONTHS[m[1]]) return parseMonthDay(`${MONTHS[m[1]]}-${m[2]}`)
  m = s.match(/\b(\d{1,2})[/.](\d{1,2})\b/)
  if (m) return parseMonthDay(`${m[1]}/${m[2]}`)
  return null
}

/** The question states how they want GIDEON to talk to them (address style, language, answer length). */
const PREF_RE = /\b(panggil (aku|gue|gw|gua|saya)|(pakai|pake|gunakan) (aku[- ]?kamu|gue[- ]?lo|gw[- ]?lo|saya[- ]?anda|bahasa (inggris|indonesia)|english|formal|santai)|call me|speak (english|indonesian)|(answer|reply|talk to me) in (english|indonesian)|jawab(an)?( yang| pakai| dengan)? (singkat|pendek|detail|panjang|poin)|lebih suka jawaban|keep (answers|it) (short|brief)|formal aja|santai aja)\b/i
export function statesPreference(question: string): boolean {
  return PREF_RE.test(question || "")
}

/** The memory a question carries, in the person's own words: "inget ya: X" → "X". Null when it is too long. */
export function memoryTextFromQuestion(question: string): string | null {
  const s = (question || "").replace(/\s+/g, " ").trim()
    .replace(/^(tolong\s+|please\s+|btw[,\s]+)?(inget(in)?|ingat(kan)?|remember( that)?|catat|jangan lupa|don'?t forget|note( that)?)(\s+(ya|yah|yaa|dong|deh))?[\s,:!.-]*/i, "")
    .trim()
  if (!s || s.length > MEMORY_TEXT_MAX) return null
  return s.charAt(0).toUpperCase() + s.slice(1)
}
