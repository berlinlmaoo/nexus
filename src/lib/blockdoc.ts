/**
 * Block documents: the storage format of the block editor (project Docs/Pages and task descriptions).
 *
 * THE FORMAT (also what iOS/Android will render later)
 * ----------------------------------------------------
 * A document is TipTap / ProseMirror JSON:
 *
 *   { "type": "doc", "content": [ <block>, … ] }
 *   block  = { "type": string, "attrs"?: object, "content"?: [ <block | inline>, … ] }
 *   inline = { "type": "text", "text": string, "marks"?: [ { "type": string, "attrs"?: object } ] }
 *          | { "type": "mention" | "dateChip" | "hardBreak", "attrs"?: object }
 *
 * Block types: paragraph, heading {level 1–3}, bulletList > listItem, orderedList {start} > listItem,
 * taskList > taskItem {checked}, blockquote, callout {emoji}, details {open} > detailsSummary +
 * detailsContent (a toggle), codeBlock {language}, horizontalRule, table > tableRow > tableHeader |
 * tableCell, image {src, alt}, fileBlock {url, name, size, mime}, bookmark {url, title, embed}.
 * Every block may carry `blockId` (anchor for "Copy link to block") and `blockColor` (a Notion colour
 * name, `<name>` = text, `<name>_bg` = background).
 * Inline: mention {id, label, kind: "user" | "task" | "doc" | "project"}, dateChip {date YYYY-MM-DD,
 * time HH:mm | null, remind boolean}, hardBreak. Marks: bold, italic, underline, strike, code,
 * link {href}, textStyle {color}, highlight {color}.
 * An unknown type must be rendered by its text content (children), never dropped.
 *
 * TEXT FIELDS FOR OLDER CLIENTS
 * -----------------------------
 * Released apps read `Task.description` and `Doc.contentText` as plain text (and edit the
 * description as plain text). Both stay populated with `docToText(doc)`: light Markdown, one line per
 * paragraph, so a plain-text description round-trips exactly (text → paragraphs → the same text).
 * When the stored text no longer matches the stored document (an older app, GIDEON, an automation
 * or WhatsApp wrote the text), `mergeTextIntoDoc` keeps every block whose text is unchanged and turns
 * the changed or new lines into paragraphs — the text is the truth, formatting survives where it can.
 *
 * Pure: no imports, no I/O. Tested by blockdoc.test.mjs.
 */

export type BlockMark = { type: string; attrs?: Record<string, unknown> }
export type BlockNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: BlockNode[]
  text?: string
  marks?: BlockMark[]
}
export type BlockDoc = { type: "doc"; content: BlockNode[] }

export const EMPTY_DOC: BlockDoc = { type: "doc", content: [{ type: "paragraph" }] }

/** Limits a stored document must respect (enforced by sanitizeDoc). */
export const DOC_LIMITS = { maxBytes: 2_000_000, maxNodes: 40_000, maxDepth: 40 }

// ---------------------------------------------------------------- helpers

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function para(text: string): BlockNode {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }
}

/** Plain text → one paragraph per line (blank line → empty paragraph). Lossless: docToText gives the text back. */
export function plainTextToDoc(text: string | null | undefined): BlockDoc {
  const value = (text ?? "").replace(/\r\n?/g, "\n")
  if (!value) return { type: "doc", content: [{ type: "paragraph" }] }
  return { type: "doc", content: value.split("\n").map(para) }
}

/**
 * A legacy task description: plain text, or the BlockNote-shaped JSON string the web wrote until now
 * (`[{ id, type: "text", content: "line", children: [] }]`). Each block keeps its exact text.
 */
export function legacyDescriptionToDoc(description: string | null | undefined): BlockDoc {
  const raw = description ?? ""
  const s = raw.trim()
  if (s.startsWith("[") || s.startsWith("{")) {
    let data: unknown
    try { data = JSON.parse(s) } catch { return plainTextToDoc(raw) }
    if (isObj(data) && data.type === "doc" && Array.isArray(data.content)) return sanitizeDoc(data) ?? plainTextToDoc(raw)
    const blocks = Array.isArray(data) ? data : [data]
    const out: BlockNode[] = []
    const inline = (c: unknown): string => {
      if (typeof c === "string") return c
      if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : isObj(x) ? (typeof x.text === "string" ? x.text : inline(x.content)) : "")).join("")
      return ""
    }
    const walk = (b: unknown) => {
      if (!isObj(b)) return
      const text = inline(b.content)
      const type = typeof b.type === "string" ? b.type : "text"
      const props = isObj(b.props) ? b.props : {}
      if (text || b.content === "" || type === "text" || type === "paragraph") {
        // Text, line by line, exactly as the old reader showed it.
        for (const line of text.split("\n")) {
          if (type === "heading") out.push({ type: "heading", attrs: { level: clampLevel(props.level) }, ...(line ? { content: [{ type: "text", text: line }] } : {}) })
          else out.push(para(line))
        }
      }
      if (Array.isArray(b.children)) b.children.forEach(walk)
    }
    blocks.forEach(walk)
    // Only the BlockNote shape is converted; any other JSON stays the literal text it was.
    if (out.length) return { type: "doc", content: out }
    return plainTextToDoc(raw)
  }
  return plainTextToDoc(raw)
}

function clampLevel(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return n >= 1 && n <= 3 ? Math.round(n) : n > 3 ? 3 : 1
}

// ---------------------------------------------------------------- sanitize

const URL_ATTRS = new Set(["src", "href", "url"])
const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i

/**
 * A document from a client: right shape, within limits, no script URLs. Returns null when it is not a
 * document at all (the route answers 400). Unknown node types are kept (forward compatibility).
 */
export function sanitizeDoc(input: unknown): BlockDoc | null {
  if (!isObj(input) || input.type !== "doc") return null
  let json: string
  try { json = JSON.stringify(input) } catch { return null }
  if (json.length > DOC_LIMITS.maxBytes) return null
  let count = 0
  const clean = (n: unknown, depth: number): BlockNode | null => {
    if (!isObj(n) || typeof n.type !== "string" || !n.type || n.type.length > 64) return null
    if (++count > DOC_LIMITS.maxNodes || depth > DOC_LIMITS.maxDepth) return null
    const out: BlockNode = { type: n.type }
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) return null
      out.text = n.text
    }
    if (isObj(n.attrs)) {
      const attrs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n.attrs)) {
        if (v === null || v === undefined) continue
        if (URL_ATTRS.has(k) && typeof v === "string" && !SAFE_URL.test(v.trim())) continue
        attrs[k] = v
      }
      if (Object.keys(attrs).length) out.attrs = attrs
    }
    if (Array.isArray(n.marks)) {
      const marks: BlockMark[] = []
      for (const m of n.marks) {
        if (!isObj(m) || typeof m.type !== "string") continue
        const mark: BlockMark = { type: m.type }
        if (isObj(m.attrs)) {
          const attrs: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(m.attrs)) {
            if (v === null || v === undefined) continue
            if (URL_ATTRS.has(k) && typeof v === "string" && !SAFE_URL.test(v.trim())) continue
            attrs[k] = v
          }
          if (m.type === "link" && !attrs.href) continue
          if (Object.keys(attrs).length) mark.attrs = attrs
        }
        marks.push(mark)
      }
      if (marks.length) out.marks = marks
    }
    if (Array.isArray(n.content)) {
      const kids: BlockNode[] = []
      for (const c of n.content) {
        const k = clean(c, depth + 1)
        if (k) kids.push(k)
      }
      if (kids.length) out.content = kids
    }
    return out
  }
  const root = clean(input, 0)
  if (!root) return null
  const content = root.content?.length ? root.content : [{ type: "paragraph" }]
  return { type: "doc", content }
}

/** Stable JSON (sorted keys, null attrs and empty attrs/marks/content dropped) for equality checks. */
export function canonicalDoc(doc: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (!isObj(v)) return v
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const val = v[k]
      if (val === null || val === undefined) continue
      if ((k === "attrs" || k === "marks" || k === "content") && (Array.isArray(val) ? val.length === 0 : isObj(val) && Object.values(val).every((x) => x === null || x === undefined))) continue
      out[k] = norm(val)
    }
    return out
  }
  return JSON.stringify(norm(doc))
}

// ---------------------------------------------------------------- doc → text

/** Inline content → one string (mentions as @Name / the title, dates as YYYY-MM-DD, hard breaks as \n). */
export function inlineText(nodes: BlockNode[] | undefined): string {
  if (!nodes) return ""
  let out = ""
  for (const n of nodes) {
    if (n.type === "text") {
      const text = n.text ?? ""
      const link = n.marks?.find((m) => m.type === "link")
      const href = typeof link?.attrs?.href === "string" ? link.attrs.href : ""
      out += href && href !== text ? `${text} (${href})` : text
    } else if (n.type === "hardBreak") out += "\n"
    else if (n.type === "mention") {
      const a = n.attrs ?? {}
      const label = String(a.label ?? a.id ?? "")
      out += (a.kind ?? "user") === "user" ? `@${label}` : label
    } else if (n.type === "dateChip") {
      const a = n.attrs ?? {}
      const when = [a.date, a.time].filter(Boolean).join(" ")
      out += a.remind ? `⏰ ${when}` : String(when)
    } else out += inlineText(n.content)
  }
  return out
}

function indent(lines: string[], by: string): string[] {
  return lines.map((l) => (l ? by + l : l))
}

/** Lines of one list item (first paragraph after the marker, the rest indented). */
function itemLines(item: BlockNode, marker: string): string[] {
  const kids = item.content ?? []
  const first = kids[0]
  const head = first && (first.type === "paragraph" || first.type === "heading") ? inlineText(first.content) : ""
  const rest = first && (first.type === "paragraph" || first.type === "heading") ? kids.slice(1) : kids
  const headLines = head.split("\n")
  const out = [marker + headLines[0], ...indent(headLines.slice(1), " ".repeat(marker.length))]
  for (const k of rest) out.push(...indent(blockLines(k), "  "))
  return out
}

/** The text lines of one block. */
export function blockLines(node: BlockNode): string[] {
  const a = node.attrs ?? {}
  switch (node.type) {
    case "paragraph":
      return inlineText(node.content).split("\n")
    case "heading": {
      const level = clampLevel(a.level)
      const [first, ...rest] = inlineText(node.content).split("\n")
      return ["#".repeat(level) + " " + first, ...rest]
    }
    case "bulletList":
      return (node.content ?? []).flatMap((it) => itemLines(it, "- "))
    case "orderedList": {
      let n = typeof a.start === "number" ? a.start : 1
      return (node.content ?? []).flatMap((it) => itemLines(it, `${n++}. `))
    }
    case "taskList":
      return (node.content ?? []).flatMap((it) => itemLines(it, it.attrs?.checked ? "- [x] " : "- [ ] "))
    case "listItem":
      return itemLines(node, "- ")
    case "taskItem":
      return itemLines(node, a.checked ? "- [x] " : "- [ ] ")
    case "blockquote":
      return (node.content ?? []).flatMap(blockLines).map((l) => "> " + l)
    case "callout": {
      const lines = (node.content ?? []).flatMap(blockLines)
      const emoji = typeof a.emoji === "string" && a.emoji ? a.emoji + " " : ""
      return lines.map((l, i) => "> " + (i === 0 ? emoji : "") + l)
    }
    case "details": {
      const kids = node.content ?? []
      const summary = kids.find((k) => k.type === "detailsSummary")
      const body = kids.find((k) => k.type === "detailsContent")
      return ["▸ " + inlineText(summary?.content), ...indent((body?.content ?? []).flatMap(blockLines), "  ")]
    }
    case "detailsSummary":
      return [inlineText(node.content)]
    case "detailsContent":
      return (node.content ?? []).flatMap(blockLines)
    case "codeBlock":
      return ["```" + (typeof a.language === "string" ? a.language : ""), ...inlineText(node.content).split("\n"), "```"]
    case "horizontalRule":
      return ["---"]
    case "table": {
      const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inlineText(p.content)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")))
      if (!rows.length) return []
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |"
      return [line(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |", ...rows.slice(1).map(line)]
    }
    case "image":
      return [`![${String(a.alt ?? "")}](${String(a.src ?? "")})`]
    case "fileBlock":
      return [`📎 ${String(a.name ?? "file")} (${String(a.url ?? "")})`]
    case "bookmark":
      return [a.title ? `🔗 ${String(a.title)} (${String(a.url ?? "")})` : `🔗 ${String(a.url ?? "")}`]
    default:
      // Unknown block: its text, never nothing.
      if (node.content?.some((c) => c.type === "text")) return inlineText(node.content).split("\n")
      return (node.content ?? []).flatMap(blockLines)
  }
}

/** The text form of a document: one line per paragraph, light Markdown for the rest. "" for an empty doc. */
export function docToText(doc: unknown): string {
  if (!isObj(doc) || !Array.isArray(doc.content)) return ""
  const lines = (doc.content as BlockNode[]).flatMap(blockLines)
  const text = lines.join("\n")
  // An empty document (one empty paragraph, or only blank lines) is no text at all.
  return text.trim() ? text : ""
}

// ---------------------------------------------------------------- text → doc (merge)

type Unit = { lines: string[]; node: BlockNode; list?: { type: string; attrs?: Record<string, unknown>; ref: number } }

/** Top-level blocks as matchable units; a list contributes one unit per item, so editing one item keeps the rest. */
function unitsOf(doc: BlockDoc): Unit[] {
  const units: Unit[] = []
  doc.content.forEach((node, ref) => {
    if ((node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") && node.content?.length) {
      let n = typeof node.attrs?.start === "number" ? (node.attrs.start as number) : 1
      for (const item of node.content) {
        const marker = node.type === "orderedList" ? `${n++}. ` : node.type === "taskList" ? (item.attrs?.checked ? "- [x] " : "- [ ] ") : "- "
        units.push({ lines: itemLines(item, marker), node: item, list: { type: node.type, attrs: node.attrs, ref } })
      }
    } else units.push({ lines: blockLines(node), node })
  })
  return units
}

function findRun(hay: string[], needle: string[], from: number): number {
  if (!needle.length) return -1
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * The text changed outside the editor: rebuild the document from the text, keeping every block whose
 * lines are still there (in order) and turning other lines into paragraphs. Ordered-list numbering
 * may shift; a renumbered item counts as changed text and becomes a paragraph, which is the safe side.
 */
export function mergeTextIntoDoc(text: string | null | undefined, doc: BlockDoc | null | undefined): BlockDoc {
  const value = (text ?? "").replace(/\r\n?/g, "\n")
  if (!doc || !value) return plainTextToDoc(value)
  const lines = value.split("\n")
  const units = unitsOf(doc)
  type Piece = { node: BlockNode; list?: Unit["list"] }
  const pieces: Piece[] = []
  let p = 0
  for (const u of units) {
    const at = findRun(lines, u.lines, p)
    if (at < 0) continue // removed or edited
    for (let i = p; i < at; i++) pieces.push({ node: para(lines[i]) })
    pieces.push({ node: u.node, list: u.list })
    p = at + u.lines.length
  }
  for (let i = p; i < lines.length; i++) pieces.push({ node: para(lines[i]) })
  // Regroup kept list items: adjacent items of the same original list form one list again.
  const content: BlockNode[] = []
  let open: { node: BlockNode; ref: number } | null = null
  for (const piece of pieces) {
    if (piece.list) {
      if (open && open.ref === piece.list.ref) {
        open.node.content!.push(piece.node)
        continue
      }
      const node: BlockNode = { type: piece.list.type, ...(piece.list.attrs ? { attrs: piece.list.attrs } : {}), content: [piece.node] }
      content.push(node)
      open = { node, ref: piece.list.ref }
    } else {
      content.push(piece.node)
      open = null
    }
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

/**
 * The document to show for a task: the stored one when the description still says what it says,
 * otherwise rebuilt from the description (see mergeTextIntoDoc), or converted from the legacy text.
 */
export function resolveTaskBody(description: string | null | undefined, stored: unknown): BlockDoc {
  const doc = stored ? sanitizeDoc(stored) : null
  if (doc && docToText(doc) === (description ?? "")) return doc
  if (doc) {
    const s = (description ?? "").trim()
    // Legacy JSON written by an old web build after the document existed: convert it, don't merge it as text.
    if (s.startsWith("[")) return legacyDescriptionToDoc(description)
    return mergeTextIntoDoc(description, doc)
  }
  return legacyDescriptionToDoc(description)
}

/** The description to store for a document: its text, or null when empty (as an empty textarea saved). */
export function descriptionOf(doc: BlockDoc): string | null {
  const text = docToText(doc)
  return text ? text : null
}

// ---------------------------------------------------------------- mentions & reminders

export type DocRefs = { users: Set<string>; tasks: Set<string>; docs: Set<string>; projects: Set<string> }

export function collectMentions(doc: unknown): DocRefs {
  const refs: DocRefs = { users: new Set(), tasks: new Set(), docs: new Set(), projects: new Set() }
  const walk = (n: unknown) => {
    if (!isObj(n)) return
    if (n.type === "mention" && isObj(n.attrs) && typeof n.attrs.id === "string") {
      const kind = n.attrs.kind ?? "user"
      if (kind === "user") refs.users.add(n.attrs.id)
      else if (kind === "task") refs.tasks.add(n.attrs.id)
      else if (kind === "doc") refs.docs.add(n.attrs.id)
      else if (kind === "project") refs.projects.add(n.attrs.id)
    }
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(doc)
  return refs
}

export type DocReminder = { key: string; date: string; time: string | null; text: string; userId: string | null }

/**
 * Every `dateChip` with remind=true: when, for whom (`remindUserId`, the person who set it), and the
 * text of the block it sits in (for the notification). The time is Asia/Jakarta; no time = 09:00.
 */
export function collectReminders(doc: unknown): DocReminder[] {
  const out: DocReminder[] = []
  const walk = (n: unknown, blockText: string) => {
    if (!isObj(n)) return
    const own = Array.isArray(n.content) && n.content.some((c) => isObj(c) && (c.type === "text" || c.type === "dateChip")) ? inlineText(n.content as BlockNode[]) : blockText
    if (n.type === "dateChip" && isObj(n.attrs) && n.attrs.remind && typeof n.attrs.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(n.attrs.date)) {
      const time = typeof n.attrs.time === "string" && /^\d{2}:\d{2}$/.test(n.attrs.time) ? n.attrs.time : null
      const userId = typeof n.attrs.remindUserId === "string" && n.attrs.remindUserId ? n.attrs.remindUserId : null
      out.push({ key: `${n.attrs.date}T${time ?? "09:00"}`, date: n.attrs.date, time, text: blockText.slice(0, 200), userId })
    }
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c, own))
  }
  walk(doc, "")
  return out
}

// ---------------------------------------------------------------- legacy reader shape (Android ≤ current)

/**
 * The released Android app reads `Doc.content` as BlockNote blocks (`[{ type, props, content, children }]`
 * with types heading / bulletListItem / numberedListItem / checkListItem / quote / codeBlock / paragraph).
 * Given TipTap JSON it shows one run-on paragraph. This is the same document in the shape it reads.
 */
export function docToBlockNote(doc: unknown): unknown[] {
  if (!isObj(doc) || !Array.isArray(doc.content)) return []
  const out: unknown[] = []
  const block = (type: string, text: string, props: Record<string, unknown> = {}) => ({ type, props, content: text ? [{ type: "text", text, styles: {} }] : [], children: [] })
  const walk = (n: BlockNode, listType?: string) => {
    switch (n.type) {
      case "heading": out.push(block("heading", inlineText(n.content), { level: clampLevel(n.attrs?.level) })); return
      case "paragraph": out.push(block("paragraph", inlineText(n.content))); return
      case "bulletList": case "orderedList": case "taskList":
        for (const it of n.content ?? []) walk(it, n.type); return
      case "listItem": case "taskItem": {
        const [first, ...rest] = n.content ?? []
        const text = first ? inlineText(first.content) : ""
        if (listType === "taskList" || n.type === "taskItem") out.push(block("checkListItem", text, { checked: !!n.attrs?.checked }))
        else out.push(block(listType === "orderedList" ? "numberedListItem" : "bulletListItem", text))
        rest.forEach((r) => walk(r)); return
      }
      case "codeBlock": out.push(block("codeBlock", inlineText(n.content))); return
      case "blockquote": case "callout": case "details":
        out.push(block("quote", blockLines(n).map((l) => l.replace(/^> ?/, "")).join("\n"))); return
      default: {
        const lines = blockLines(n)
        if (lines.some((l) => l.trim())) out.push(block("paragraph", lines.join("\n")))
      }
    }
  }
  for (const n of doc.content as BlockNode[]) walk(n)
  return out
}
