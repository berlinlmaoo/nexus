// GIDEON's ticket replies are read by staff and the BoD on a phone. They must never carry the machinery
// behind them: database ids ("ID usulan: `cmu6d4q1i014c01qtzd97uzbt`"), tool names (`nexus_resolve_ticket`),
// tool field names ("(`hasPenaltyToCancel = false`)", "outage.recordedByNexus=false", "`alreadyWaived: true`")
// or raw enum values (`PENDING`, `DAY_OFF`). The prompt forbids them (lib/gideon-ticket.ts REPLY_FORMAT), but a
// model slips and older replies predate the rule (QA 13 Oct 2026, BoD round 2 B09). This runs on every GIDEON
// reply when it is written AND when a thread is served, so stored historical replies and the released
// iOS/Android apps get the clean text too.
//
// Pure function, no imports: tested by gideon-reply-scrub.test.mjs.

/** A database id: a pre-conversion cuid (25 chars, starts with "c"; a digit is required so ordinary words are
 *  never touched) or a UUID (every id since the UUIDv7 conversion, docs/internal/UUID-MIGRATION.md). */
const CUID = String.raw`(?:c(?=[a-z0-9]*\d)[a-z0-9]{20,30}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`
/** One identifier segment: lowerCamelCase or lower (xpPenalties, outage). */
const SEG = String.raw`[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*`
/** camelCase with a lowercase start of 2+ letters and at least one hump: alreadyWaived, xpPenalties.
 *  Not iPhone / iOS / macOS (one-letter or capital-only starts). */
const CAMEL = String.raw`[a-z]{2,}[a-z0-9]*(?:[A-Z][a-z0-9]+)+`
/** A code name: a dotted path with a capital in it, a camelCase name, or a snake_case tool name. */
const CODE = String.raw`(?:${SEG}(?:\.${SEG})+|${CAMEL}|[a-z]+(?:_[a-z0-9]+)+)`
const VALUE = String.raw`(?:-?\d+(?:\.\d+)?|true|false|null|"[^"\n]*"|'[^'\n]*')`
const CODE_RE = new RegExp(CODE, "g")
/** True when `s` holds a code name (camelCase, a dotted path with a capital, or snake_case). */
const isCode = (s: string) => (s.match(CODE_RE) ?? []).some((m) => /[A-Z]/.test(m) || m.includes("_"))

/** Enum values a reply may quote, in the words a person uses (Indonesian: the replies are Indonesian). */
const ENUM_WORDS: Record<string, string> = {
  PENDING: "menunggu", APPROVED: "disetujui", REJECTED: "ditolak", CANCELED: "dibatalkan", CANCELLED: "dibatalkan",
  DAY_OFF: "day off", RED_DATE: "tanggal merah", SICK: "sakit", PERMIT: "izin", LEAVE: "cuti", PRESENT: "hadir",
  ABSENT: "tidak hadir", LATE: "telat", OPEN: "terbuka", CLOSED: "ditutup", RESOLVED: "selesai", IN_REVIEW: "ditinjau",
}

/** "coveringRequests" → "covering requests". */
const humanize = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()

export function scrubGideonReply(text: string): string {
  if (!text) return text
  let s = text
  // "(ID usulan: `c…`)", "ID proposal: c…", "id tiket c…" — the label and the id together.
  s = s.replace(new RegExp(String.raw`\(?\s*\b(?:ID|id)\s*(?:usulan|proposal|tiket|ticket|koreksi|correction)?\s*[:=]?\s*` + "`?" + CUID + "`?" + String.raw`\s*\)?`, "g"), "")
  // Any other id, in backticks or bare.
  s = s.replace(new RegExp("`" + CUID + "`", "g"), "")
  s = s.replace(new RegExp(String.raw`\b` + CUID + String.raw`\b`, "g"), "")
  // A parenthesis or a backtick span that holds a code name: "(`hasPenaltyToCancel = false`)", "(outage.recordedByNexus=false)".
  s = s.replace(/[ \t]*\(([^()\n]*)\)/g, (m, inner: string) => (isCode(inner) ? "" : m))
  s = s.replace(/[ \t]*`([^`\n]*)`/g, (m, inner: string) => (isCode(inner) ? "" : m))
  // A bare assignment in a sentence, with the comma or "dan"/"and"/"dengan" that joined it:
  // "autoDayOffsDeducted=1, totalPenaltyXp=-120, dan hasPenaltyToCancel=true".
  s = s.replace(new RegExp(String.raw`(?:,?[ \t]*\b(?:dan|and|dengan|with)[ \t]+|,[ \t]*|[ \t]*)(` + CODE + String.raw`)[ \t]*[=:][ \t]*` + VALUE, "g"), (m, code: string) => (/[A-Z_]/.test(code) ? "" : m))
  // Whatever is still in backticks is plain content (a date, `--:--`, an enum): drop the backticks, and say an
  // enum the way a person would.
  s = s.replace(/`([^`\n]*)`/g, (_m, inner: string) => ENUM_WORDS[inner.trim()] ?? inner)
  // A bare tool name (nexus_resolve_ticket) goes; a bare field name reads as words (coveringRequests → covering requests).
  s = s.replace(/[ \t]*\bnexus_[a-z0-9_]+\b/g, "")
  s = s.replace(new RegExp(String.raw`\b(?:${SEG}\.)*(${CAMEL})\b`, "g"), (_m, id: string) => humanize(id))
  // A bare enum value in capitals with an underscore (DAY_OFF) reads as words.
  s = s.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (m) => ENUM_WORDS[m] ?? m.replace(/_/g, " ").toLowerCase())
  // …and so do the request statuses written bare ("status PENDING").
  s = s.replace(/\b(PENDING|APPROVED|REJECTED|CANCELED|CANCELLED)\b/g, (m) => ENUM_WORDS[m])
  // Tidy what the removals leave: list items with nothing left, doubled spaces, a space before punctuation,
  // empty parentheses, a comma right before a full stop.
  s = s.replace(/\(\s*\)/g, "")
  s = s.split("\n").filter((line) => !/^\s*[-*•]\s*[.,;:]?\s*$/.test(line)).join("\n")
  s = s.replace(/[ \t]{2,}/g, " ")
  s = s.replace(/ +([.,;:!?])/g, "$1")
  s = s.replace(/,([.;:!?])/g, "$1")
  s = s.replace(/^[ \t]+|[ \t]+$/gm, "")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}
