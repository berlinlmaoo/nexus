// GIDEON's precise edit of a legal document (owner, 14 Oct 2026): it only PROPOSES a change to the part that
// was asked for, as before → after; the change is applied only after someone approves it. The kop, the number
// and every paragraph not asked for are locked; an ambiguous request makes GIDEON ask back instead of guess.
// This is the pure half — the prompt, reading the reply, and the checks every proposal must pass. No imports
// (node src/lib/legal/gideon-edit-core.test.mjs). The I/O is gideon-edit.ts.

export type PromptParagraph = { index: number; text: string; editable: boolean }
export type ProposedChange = { index: number; before: string; after: string }
export type ThreadTurn = { instruction: string; question: string; answer: string }

export const MAX_CHANGES = 12
const MAX_PROMPT_CHARS = 60_000
const MAX_PARAGRAPH = 20_000
/** A line break inside a paragraph, as GIDEON reads and writes it (a real newline would break the list). */
const LINE_BREAK = " ⏎ "

/** The prompt. `targets` = the paragraphs the person ticked (empty = GIDEON picks the smallest set). */
export function buildEditPrompt(input: {
  title: string
  paragraphs: PromptParagraph[]
  targets: number[]
  instruction: string
  thread?: ThreadTurn[]
}): string {
  const targets = new Set(input.targets)
  const total = input.paragraphs.reduce((n, p) => n + p.text.length, 0)
  // A long contract: keep the asked-for paragraphs whole, shorten the rest (they are context only).
  const clip = total > MAX_PROMPT_CHARS
  const lines = input.paragraphs
    .filter((p) => p.text.trim())
    .map((p) => {
      const tag = !p.editable ? "LOCKED" : targets.size ? (targets.has(p.index) ? "TARGET" : "LOCKED") : "OPEN"
      const text = clip && !targets.has(p.index) && p.text.length > 300 ? `${p.text.slice(0, 300)}…` : p.text
      return `[${p.index}] (${tag}) ${text.replace(/\n/g, LINE_BREAK)}`
    })
  const thread = (input.thread ?? [])
    .map((t, i) => `Earlier request ${i + 1}: ${t.instruction}\nYou asked: ${t.question}\nThey answered: ${t.answer}`)
    .join("\n\n")
  return [
    "You are GIDEON, editing an Indonesian legal document precisely. You PROPOSE changes; a person approves them.",
    `Document: ${input.title}`,
    "",
    "Paragraphs, numbered. (LOCKED) paragraphs must not change at all. " +
      (targets.size
        ? "Change ONLY the paragraphs marked (TARGET)."
        : "(OPEN) paragraphs may change, but change only the fewest paragraphs the request needs."),
    "",
    lines.join("\n"),
    "",
    thread ? `${thread}\n` : "",
    `Request: ${input.instruction}`,
    "",
    "Rules:",
    "- Change only what the request asks for. Copy every other word, number, capitalisation, punctuation and defined term (PIHAK PERTAMA, Perjanjian…) exactly.",
    "- Keep the document's language and legal register. Keep clause numbering such as (1), a., Pasal 3.",
    "- Never touch a LOCKED paragraph, the document number, the parties' identity data, or the letterhead.",
    `- At most ${MAX_CHANGES} paragraphs. Return each changed paragraph's FULL new text; write a line break inside a paragraph as ⏎.`,
    "- If the request is ambiguous (which clause? what value?), needs a LOCKED paragraph, or needs more than the allowed paragraphs: do not guess — ask one short question back, in the language of the request.",
    "",
    "Answer with JSON only, one of:",
    '{"action":"propose","summary":"<one sentence, language of the request>","changes":[{"index":<n>,"after":"<full new paragraph text>"}]}',
    '{"action":"clarify","question":"<one short question>"}',
  ].join("\n")
}

function firstJsonObject(reply: string): Record<string, unknown> | null {
  const text = (reply || "").replace(/```(?:json)?/gi, "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export type ParsedReply =
  | { kind: "clarify"; question: string }
  | { kind: "propose"; summary: string; changes: { index: number; after: string }[] }
  | { kind: "invalid"; reason: string }

export function parseEditReply(reply: string): ParsedReply {
  const obj = firstJsonObject(reply)
  if (!obj) return { kind: "invalid", reason: "GIDEON's answer was not in the expected form" }
  if (obj.action === "clarify") {
    const q = typeof obj.question === "string" ? obj.question.trim() : ""
    return q ? { kind: "clarify", question: q.slice(0, 1000) } : { kind: "invalid", reason: "GIDEON asked back without a question" }
  }
  if (obj.action === "propose" && Array.isArray(obj.changes)) {
    const changes = obj.changes
      .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
      .map((c) => ({ index: Number(c.index), after: typeof c.after === "string" ? c.after : "" }))
    return { kind: "propose", summary: typeof obj.summary === "string" ? obj.summary.trim().slice(0, 500) : "", changes }
  }
  return { kind: "invalid", reason: "GIDEON's answer was not in the expected form" }
}

/**
 * The checks a proposal must pass before anyone sees it. Anything GIDEON changed outside what it was allowed
 * to change makes the whole proposal fail (a precise editor that wandered is not precise), as does a
 * proposal that changes nothing.
 */
export function checkProposal(paragraphs: PromptParagraph[], targets: number[], changes: { index: number; after: string }[]): { ok: true; changes: ProposedChange[] } | { ok: false; reason: string } {
  const byIndex = new Map(paragraphs.map((p) => [p.index, p]))
  const allowed = new Set(targets)
  const seen = new Set<number>()
  const out: ProposedChange[] = []
  if (changes.length > MAX_CHANGES) return { ok: false, reason: `GIDEON proposed more than ${MAX_CHANGES} paragraphs; narrow the request` }
  for (const c of changes) {
    const p = byIndex.get(c.index)
    if (!Number.isInteger(c.index) || !p) return { ok: false, reason: "GIDEON pointed at a paragraph that doesn't exist" }
    if (seen.has(c.index)) return { ok: false, reason: "GIDEON changed one paragraph twice" }
    seen.add(c.index)
    if (!p.editable) return { ok: false, reason: `GIDEON tried to change a locked paragraph (${c.index + 1})` }
    if (allowed.size && !allowed.has(c.index)) return { ok: false, reason: `GIDEON tried to change paragraph ${c.index + 1}, which you didn't select` }
    const after = c.after.replace(/\r\n?/g, "\n").replace(/\s*⏎\s*/g, "\n").trim()
    if (!after) return { ok: false, reason: "GIDEON proposed an empty paragraph" }
    if (after.length > MAX_PARAGRAPH) return { ok: false, reason: "GIDEON proposed a paragraph that is too long" }
    if (/\{\{|\}\}/.test(after)) return { ok: false, reason: "GIDEON left a {{placeholder}} in its text" }
    if (after === p.text.trim()) continue
    out.push({ index: c.index, before: p.text, after })
  }
  if (!out.length) return { ok: false, reason: "GIDEON proposed no change" }
  return { ok: true, changes: out.sort((a, b) => a.index - b.index) }
}
