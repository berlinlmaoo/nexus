/**
 * Recursively extract plain text from TipTap JSON content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTextFromTipTap(node: any): string {
  if (!node) return ""
  if (typeof node === "string") return node

  const parts: string[] = []

  if (node.text) {
    parts.push(node.text)
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      parts.push(extractTextFromTipTap(child))
    }
  }

  // Handle arrays (e.g. when content is an array at top level)
  if (Array.isArray(node)) {
    for (const item of node) {
      parts.push(extractTextFromTipTap(item))
    }
  }

  return parts.filter(Boolean).join(" ")
}

/**
 * Markdown → TipTap document JSON.
 *
 * Written because GIDEON writes prose and the Knowledge Library stores ProseMirror nodes: handing
 * it a plain string produces a doc that saves without complaint and then renders as nothing.
 *
 * Deliberately small. Headings, lists, quotes, rules, and bold/italic/code inline — the shapes a
 * written document actually uses. Anything unrecognised stays as its own literal text rather than
 * being dropped, because silently losing a line of somebody's document is worse than showing them
 * a stray asterisk.
 */
export function markdownToTipTap(markdown: string): { type: "doc"; content: unknown[] } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const content: unknown[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    content.push({ type: "paragraph", content: inline(paragraph.join(" ")) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    content.push({
      type: list.ordered ? "orderedList" : "bulletList",
      content: list.items.map((item) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inline(item) }],
      })),
    })
    list = null
  }
  const flushAll = () => { flushParagraph(); flushList() }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) { flushAll(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushAll(); content.push({ type: "horizontalRule" }); continue }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushAll()
      content.push({ type: "blockquote", content: [{ type: "paragraph", content: inline(quote[1]) }] })
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      const text = (bullet ?? ordered)![1]
      // A change of list kind starts a new list rather than mixing markers in one.
      if (list && list.ordered !== isOrdered) flushList()
      list = list ?? { ordered: isOrdered, items: [] }
      list.items.push(text)
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }
  flushAll()

  // An empty document still needs one node, or the editor opens with nothing to type into.
  if (!content.length) content.push({ type: "paragraph" })
  return { type: "doc", content }
}

/** Inline marks: **bold**, *italic*, `code`. Nested marks are not attempted. */
function inline(text: string): unknown[] {
  const nodes: unknown[] = []
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) })
    if (match[2] !== undefined) nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] })
    else if (match[4] !== undefined) nodes.push({ type: "text", text: match[4], marks: [{ type: "italic" }] })
    else if (match[5] !== undefined) nodes.push({ type: "text", text: match[5], marks: [{ type: "code" }] })
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) })
  return nodes.length ? nodes : [{ type: "text", text }]
}
