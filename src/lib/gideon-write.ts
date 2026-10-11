/**
 * Prompts for "Ask AI" in the editor (/api/gideon/write) and the parser for extracted action items.
 * Pure (no I/O) so it can be unit-tested.
 */
export const WRITE_ACTIONS = [
  "improve", "fix", "shorter", "longer", "tone", "summarize", "translate", "continue", "explain", "action_items", "custom",
] as const
export type WriteAction = (typeof WRITE_ACTIONS)[number]

const TONES: Record<string, string> = {
  professional: "professional", casual: "casual", friendly: "friendly", confident: "confident", straightforward: "straightforward",
}

export function writePrompt(input: {
  action: WriteAction
  text: string
  context?: string
  docTitle?: string
  tone?: string
  language?: "en" | "id" | null
  prompt?: string
  person?: string
}): string {
  const same = "Write in the same language as the text (Indonesian stays Indonesian, English stays English)."
  const task: Record<WriteAction, string> = {
    improve: `Improve the writing of the TEXT: clearer, tighter, better flow. Keep its meaning, facts, names and numbers. ${same}`,
    fix: `Fix spelling, grammar and punctuation in the TEXT only. Change nothing else — no rewording, no new content. ${same}`,
    shorter: `Make the TEXT shorter (about half), keeping every important point. ${same}`,
    longer: `Make the TEXT longer and more complete (about 1.5–2×), adding useful detail without inventing facts, names or numbers. ${same}`,
    tone: `Rewrite the TEXT in a ${TONES[input.tone || ""] ?? "professional"} tone. Keep the meaning. ${same}`,
    summarize: `Summarise the TEXT in a few short bullet points (at most 6). ${same}`,
    translate: input.language === "en" ? "Translate the TEXT into natural English." : "Terjemahkan TEXT ke Bahasa Indonesia yang wajar dan rapi.",
    continue: `Continue writing from where the TEXT ends: one or two paragraphs that follow naturally. Do not repeat the TEXT. ${same}`,
    explain: `Explain the TEXT simply, in a short paragraph or a few bullets, for a teammate who is new to it. ${same}`,
    action_items: "Extract the concrete action items from the TEXT. Output ONLY a Markdown checklist, one item per line, exactly like: `- [ ] Task title (due: YYYY-MM-DD, owner: Name)` — leave out `due:` / `owner:` when the text does not say. No intro, no other text. If there are none, output exactly: `- [ ] (none)`.",
    custom: `Do this with the TEXT: ${input.prompt || ""}. ${same}`,
  }
  return [
    "You are GIDEON, the writing assistant inside the NEXUS editor. Do NOT call any tools. Do not mention models, providers or yourself.",
    "Output ONLY the result, as Markdown (paragraphs, bullet/numbered lists, **bold**, headings if the text has them). No preamble like \"Here is\", no closing remarks, no code fences around the answer.",
    input.docTitle ? `The page is titled "${input.docTitle}".` : "",
    input.context ? `Surrounding text on the page (for context only, do not rewrite it):\n"""\n${input.context}\n"""` : "",
    `TASK: ${task[input.action]}`,
    input.text ? `TEXT:\n"""\n${input.text}\n"""` : "TEXT: (empty — start from the page context)",
  ].filter(Boolean).join("\n\n")
}

export type ActionItem = { title: string; due?: string | null; owner?: string | null }

/** `- [ ] Title (due: 2026-10-20, owner: Rina)` lines → items. Anything else is ignored. */
export function parseActionItems(markdown: string): ActionItem[] {
  const out: ActionItem[] = []
  for (const raw of (markdown || "").split("\n")) {
    const m = /^\s*[-*]\s*\[[ xX]?\]\s*(.+?)\s*$/.exec(raw) ?? /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/.exec(raw)
    if (!m) continue
    let title = m[1].replace(/\*\*/g, "").trim()
    let due: string | null = null
    let owner: string | null = null
    const meta = /\(([^()]*(?:due|owner|tenggat|pic)\s*:[^()]*)\)\s*$/i.exec(title)
    if (meta) {
      title = title.slice(0, meta.index).trim()
      for (const part of meta[1].split(",")) {
        const [k, ...rest] = part.split(":")
        const v = rest.join(":").trim()
        if (/due|tenggat/i.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(v)) due = v
        if (/owner|pic/i.test(k) && v) owner = v.slice(0, 80)
      }
    }
    if (!title || /^\(none\)$/i.test(title)) continue
    out.push({ title: title.slice(0, 200), due, owner })
    if (out.length >= 25) break
  }
  return out
}
