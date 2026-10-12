// GIDEON's ticket replies are read by staff and the BoD on a phone. They must never carry the machinery
// behind them: database ids ("ID usulan: `cmu6d4q1i014c01qtzd97uzbt`") or tool field names
// ("(`hasPenaltyToCancel = false`)"). The prompt forbids both (lib/gideon-ticket.ts REPLY_FORMAT), but a
// model slips and older replies predate the rule (QA 13 Oct 2026). This runs on every GIDEON reply when it
// is written AND when a thread is served, so the released iOS/Android apps get the clean text too.
//
// Pure function, no imports: tested by gideon-reply-scrub.test.mjs.

/** A Prisma cuid (25 chars, starts with "c"). Requires a digit so ordinary words are never touched. */
const CUID = String.raw`c(?=[a-z0-9]*\d)[a-z0-9]{20,30}`
/** A code identifier: lowerCamelCase with at least two humps (hasPenaltyToCancel, recordedByNexus). */
const IDENT = String.raw`[a-z]+(?:[A-Z][a-z0-9]+){2,}(?:\.[a-z]+(?:[A-Z][a-z0-9]+)*)*`

export function scrubGideonReply(text: string): string {
  if (!text) return text
  let s = text
  // "(ID usulan: `c…`)", "ID proposal: c…", "id tiket c…" — the label and the id together.
  s = s.replace(new RegExp(String.raw`\(?\s*\b(?:ID|id)\s*(?:usulan|proposal|tiket|ticket|koreksi|correction)?\s*[:=]?\s*` + "`?" + CUID + "`?" + String.raw`\s*\)?`, "g"), "")
  // Any other id left in backticks or bare.
  s = s.replace(new RegExp("`" + CUID + "`", "g"), "")
  s = s.replace(new RegExp(String.raw`\b` + CUID + String.raw`\b`, "g"), "")
  // "(`hasPenaltyToCancel = false`)" / "(hasPenaltyToCancel = false)" — a parenthesis that only holds code.
  s = s.replace(new RegExp(String.raw`\s*\(\s*` + "`?" + IDENT + String.raw`(?:\s*(?:=|:)\s*[\w.-]+)?` + "`?" + String.raw`\s*\)`, "g"), "")
  // A backticked identifier or assignment inside a sentence.
  s = s.replace(new RegExp("`" + IDENT + String.raw`(?:\s*(?:=|:)\s*[\w.-]+)?` + "`", "g"), "")
  // Tidy what the removals leave: doubled spaces, a space before punctuation, empty parentheses.
  s = s.replace(/\(\s*\)/g, "")
  s = s.replace(/[ \t]{2,}/g, " ")
  s = s.replace(/ +([.,;:!?])/g, "$1")
  s = s.replace(/^[ \t]+|[ \t]+$/gm, "")
  return s.trim()
}
