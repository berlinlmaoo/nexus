import { inlineText, sanitizeDoc, type BlockDoc, type BlockNode } from "@/lib/blockdoc"
import { markdownToTipTap } from "@/lib/tiptap-utils"

/**
 * GIDEON's doc edits (18 Oct 2026), the pure part: where a section is in a block document and what the document
 * looks like after "append", "append to a section", "replace a section" or "add a section". The edit itself is
 * applied by POST /api/collab/edit (the iOS app's path), which merges `base → mine` block by block into the LIVE
 * Yjs room, so nobody typing in the page loses anything (lib/collab-rooms.ts applyBlockEdit).
 */

export type DocEditMode = "append" | "append_section" | "replace_section" | "add_section"

export type SectionSpan = { headingIndex: number; level: number; title: string; start: number; end: number }

const headingLevel = (b: BlockNode) => (b.type === "heading" ? Number(b.attrs?.level ?? 1) || 1 : 0)

/** Top-level headings, each with the blocks under it (up to the next heading of the same or a higher level). */
export function sections(doc: BlockDoc): SectionSpan[] {
  const out: SectionSpan[] = []
  const blocks = doc.content
  blocks.forEach((b, i) => {
    const level = headingLevel(b)
    if (!level) return
    let end = blocks.length
    for (let j = i + 1; j < blocks.length; j++) {
      const l = headingLevel(blocks[j])
      if (l && l <= level) { end = j; break }
    }
    out.push({ headingIndex: i, level, title: inlineText(b.content).trim(), start: i + 1, end })
  })
  return out
}

/** The one section whose heading matches `name` (exact, else the only one that contains it), or an error text. */
export function findSection(doc: BlockDoc, name: string): SectionSpan | string {
  const all = sections(doc)
  if (!all.length) return "This page has no headings, so it has no sections. Use mode append (to the end) or add_section."
  const n = name.trim().toLowerCase()
  const exact = all.filter((s) => s.title.toLowerCase() === n)
  if (exact.length === 1) return exact[0]
  const part = all.filter((s) => s.title.toLowerCase().includes(n))
  if (part.length === 1) return part[0]
  const list = all.slice(0, 15).map((s) => `“${s.title}”`).join(", ")
  return part.length ? `Several sections match “${name}”: ${part.map((s) => `“${s.title}”`).join(", ")}. Ask which one.` : `No section is called like “${name}”. The sections are: ${list}.`
}

/** Markdown → blocks (headings, lists, quotes, bold/italic), sanitised. */
export function markdownBlocks(markdown: string): BlockNode[] {
  const doc = sanitizeDoc(markdownToTipTap(markdown))
  return (doc?.content ?? []).filter((b) => !(b.type === "paragraph" && !b.content?.length))
}

/** The document after the edit; throws a refusal text the model can relay. */
export function editedDoc(base: BlockDoc, mode: DocEditMode, section: string | null, markdown: string): { doc: BlockDoc; before: BlockNode[]; after: BlockNode[]; sectionTitle: string | null } {
  const add = markdownBlocks(markdown)
  if (!add.length) throw new Error("The new text is empty.")
  const blocks = [...base.content]
  // A trailing empty paragraph (what an empty editor leaves) is kept last.
  const tailEmpty = blocks.length > 0 && blocks[blocks.length - 1].type === "paragraph" && !blocks[blocks.length - 1].content?.length
  if (mode === "append") {
    const at = tailEmpty ? blocks.length - 1 : blocks.length
    blocks.splice(at, 0, ...add)
    return { doc: { type: "doc", content: blocks }, before: [], after: add, sectionTitle: null }
  }
  if (mode === "add_section") {
    if (!section) throw new Error("add_section needs the new section's heading (section).")
    const found = findSection(base, section)
    if (typeof found !== "string" && found.title.toLowerCase() === section.trim().toLowerCase()) throw new Error(`A section “${found.title}” already exists. Use append_section or replace_section.`)
    const heading: BlockNode = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.trim() }] }
    const at = tailEmpty ? blocks.length - 1 : blocks.length
    blocks.splice(at, 0, heading, ...add)
    return { doc: { type: "doc", content: blocks }, before: [], after: [heading, ...add], sectionTitle: section.trim() }
  }
  if (!section) throw new Error(`${mode} needs the section's heading (section).`)
  const found = findSection(base, section)
  if (typeof found === "string") throw new Error(found)
  const before = blocks.slice(found.start, found.end)
  if (mode === "append_section") {
    blocks.splice(found.end, 0, ...add)
    return { doc: { type: "doc", content: blocks }, before: [], after: add, sectionTitle: found.title }
  }
  blocks.splice(found.start, found.end - found.start, ...add)
  return { doc: { type: "doc", content: blocks }, before, after: add, sectionTitle: found.title }
}
