// GIDEON's ticket replies are read by staff and the BoD on a phone. They must never carry the machinery
// behind them: database ids ("ID usulan: `cmu6d4q1i014c01qtzd97uzbt`") or tool field names
// ("(`hasPenaltyToCancel = false`)", "outage.recordedByNexus=false", "- `xpPenalties.autoDayOffsDeducted = 1`").
// The prompt forbids both (lib/gideon-ticket.ts REPLY_FORMAT), but a model slips and older replies predate
// the rule (QA 13 Oct 2026). This runs on every GIDEON reply when it is written AND when a thread is served,
// so the released iOS/Android apps get the clean text too.
//
// Pure function, no imports: tested by gideon-reply-scrub.test.mjs.

/** A Prisma cuid (25 chars, starts with "c"). Requires a digit so ordinary words are never touched. */
const CUID = String.raw`c(?=[a-z0-9]*\d)[a-z0-9]{20,30}`
/** One identifier segment: lowerCamelCase or lower (xpPenalties, outage). */
const SEG = String.raw`[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*`
/** A code name: a dotted path (outage.recordedByNexus) or camelCase with two humps or more (hasPenaltyToCancel).
 *  A match must contain a capital, so "e.g." or a domain name is never one (checked in isCode). */
const CODE = String.raw`(?:${SEG}(?:\.${SEG})+|[a-z]+(?:[A-Z][a-z0-9]+){2,})`
const VALUE = String.raw`(?:-?\d+(?:\.\d+)?|true|false|null|"[^"\n]*"|'[^'\n]*')`
const CODE_RE = new RegExp(CODE, "g")
/** True when `s` holds a code name (a match with a capital in it). */
const isCode = (s: string) => (s.match(CODE_RE) ?? []).some((m) => /[A-Z]/.test(m))

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
  s = s.replace(new RegExp(String.raw`(?:,?[ \t]*\b(?:dan|and|dengan|with)[ \t]+|,[ \t]*|[ \t]*)(` + CODE + String.raw`)[ \t]*[=:][ \t]*` + VALUE, "g"), (m, code: string) => (/[A-Z]/.test(code) ? "" : m))
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
