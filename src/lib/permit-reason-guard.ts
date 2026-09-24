/**
 * Is this izin (PERMIT) really a day off, or a forgotten check-in, wearing an izin's clothes?
 *
 * The owner's rule (24 Sep 2026, final): day off has a quota — `WorkspaceMember.dayOffQuota`,
 * default 4 per 28→27 period, and the cron's own cuts for "tidak check-in" and "telat >120 menit"
 * are taken from it. When the quota is gone there is no more day off. An izin must never be the way
 * round that, and never the way to paper over a day nobody checked in ("absen itu kewajiban").
 *
 * What an izin IS for stays untouched: shooting, events, rehearsals, venue surveys, client visits,
 * "masuk siang karena …". Those are most of the 348 izin filed up to 24 Sep 2026, and the patterns
 * below were tuned against every one of them — see permit-reason-guard.test.mjs for the cases that
 * must keep passing (pespor, pestapora, doain, dokumentasi, dorong motor, downtown, lupa permit…).
 *
 * Deliberately NOT here:
 *   - Sickness. "istirahat karena sakit" belongs to SICK and its doctor's note; this guard does not
 *     judge it.
 *   - "lupa permit" — a permit filed late is a different rule (reportDelayMinutes shows the reviewer).
 *   - Bare "do". Indonesian is full of it: doain, dokumentasi, dong, dorong, downtown. "DO" counts as
 *     the day-off abbreviation only next to a word that makes it one ("tuker do", "do tgl 24").
 *
 * Pure: no I/O, no imports, so the route, a test and a one-off script over old data all ask the
 * identical question.
 */

export type PermitReasonKind = "dayoff" | "forgot_checkin"

export interface PermitReasonVerdict {
  kind: PermitReasonKind | null
  /** The normalised phrase that decided it, for logs and the audit trail. */
  matched?: string
}

/**
 * Lowercase; "d.o" → "do"; every run of 3+ of the same letter → one ("pesporrrrr" → "pespor",
 * "lupaaa" → "lupa"); anything that is not a letter or a digit (emoji, punctuation, dashes) → space;
 * whitespace collapsed. A run of exactly two is kept on purpose: Indonesian spells real words with
 * double letters ("saat", "maaf"), and "dayy off" is handled by the pattern, not by guessing.
 */
export function normalizePermitReason(reason: string): string {
  return String(reason ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\bd\s*\.\s*o\b\.?/g, "do")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// "day off", "dayoff", "day-off" (the dash is a space by now), "dayy off".
const DAY_OFF = String.raw`da+y+\s*of+`
// DO as the abbreviation — only when a neighbouring word makes it one.
const DO_ABBREV_BEFORE = String.raw`(?:tuker|tukar|tukeran|ganti|gantiin|ambil|ngambil|request|req|ajuin|ajukan|ngajuin|minta|seharusnya|harusnya|jatah|pake|pakai)`
const DO_ABBREV_AFTER = String.raw`(?:tgl|tanggal|hari)`

/**
 * Phrases that NAME day off only as the consequence somebody is trying to avoid by coming in late —
 * "ke kantor jam 3 (kalo absen nanti keitung day off)", "biar ga di do-in sm nexus". That person is
 * filing exactly the "masuk siang karena …" izin the owner wants kept. Cut out before matching.
 */
const CONSEQUENCE = new RegExp(
  String.raw`\b(?:(?:ke|di|ter|ke\s)?h?itung(?:nya)?|kena|dianggap|dicatat)\s+(?:jadi\s+|sebagai\s+)?(?:${DAY_OFF}|do)\b` +
    String.raw`|\b(?:biar|supaya|agar)\s+(?:ga|gak|nggak|ngga|gk|tidak|tak|nggk)\s+(?:di\s+)?(?:${DAY_OFF}|do)(?:\s+in)?\b` +
    String.raw`|\bdi\s+do\s+in\b`,
  "g",
)

const SICK = /\b(?:sakit|demam|drop|pusing|muntah|mual|flu|pilek|batuk|meriang|diare|tipes|gerd|migrain|maag|dokter|rs|klinik|puskesmas|opname|dirawat)\b/

// Checked in order: the first hit wins. Explicit day-off language first, soft words last.
const DAYOFF_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b${DAY_OFF}\b`),
  new RegExp(String.raw`\b${DO_ABBREV_BEFORE}\s+do\b`),
  new RegExp(String.raw`\bdo\s+${DO_ABBREV_AFTER}\b`),
  /\blibur(?:an)?\b/,
  /\bcuti\b/,
  /\b(?:off\s+dulu|(?:izin|ijin|minta)\s+off)\b/,
  // "jatah … habis": the quota is gone, so the izin is the way round it. Up to four words in
  // between ("jatah day off aku udah abis"), none of them a negation ("biar jatah ga kepotong" is
  // somebody coming in late precisely so it does NOT happen).
  /\bjatah(?:\s+(?!ga\b|gak\b|nggak\b|ngga\b|gk\b|tidak\b|tak\b|biar\b|supaya\b|jangan\b)\S+){0,4}?\s+(?:habis|abis|kepotong|terpotong)\b/,
]

// Only without a sickness word in the same reason — "istirahat karena sakit" is SICK's business.
const REST_AT_HOME = /\b(?:mau\s+)?istirahat\s+(?:di\s+)?(?:rumah|kos|kosan)\b/

const FORGOT_PATTERNS: RegExp[] = [
  /\blupa\s+(?:absen|absensi|ngabsen|presensi|check\s*in|checkin|cek\s*in|clock\s*in|clockin|ci)\b/,
  /\b(?:gak|ga|nggak|ngga|gk|tidak|tak|belum|blm|g)\s+semp[ae]t\s+(?:absen|ngabsen|presensi|check\s*in|checkin|clock\s*in)\b/,
]

export function classifyPermitReason(reason: string): PermitReasonVerdict {
  const text = normalizePermitReason(reason)
  if (!text) return { kind: null }

  // Forgot first: "lupa absen, tuker do aja" is, before anything else, a missed check-in.
  for (const re of FORGOT_PATTERNS) {
    const m = text.match(re)
    if (m) return { kind: "forgot_checkin", matched: m[0] }
  }

  const stripped = text.replace(CONSEQUENCE, " ").replace(/\s+/g, " ").trim()
  for (const re of DAYOFF_PATTERNS) {
    const m = stripped.match(re)
    if (m) return { kind: "dayoff", matched: m[0] }
  }
  if (!SICK.test(stripped)) {
    const m = stripped.match(REST_AT_HOME)
    if (m) return { kind: "dayoff", matched: m[0] }
  }
  return { kind: null }
}
