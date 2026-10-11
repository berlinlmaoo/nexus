import * as Y from "yjs"
import type { BlockDoc, BlockMark, BlockNode } from "@/lib/blockdoc"

/**
 * TipTap JSON ⇄ Yjs, without a ProseMirror schema, in exactly the layout @tiptap/y-tiptap (the
 * y-prosemirror fork the web editor's Collaboration extension uses) reads and writes:
 *
 *   the document       = ydoc.getXmlFragment("default")
 *   a node             = Y.XmlElement(node.type) with one attribute per non-null attr
 *   a run of text      = one Y.XmlText; each mark is a formatting attribute { [mark.type]: mark.attrs ?? {} }
 *
 * The server seeds a collaboration room from the stored JSON with this (so two people opening an
 * un-collaborated page at once never both seed it), and turns the live Yjs state back into JSON to
 * persist it — no browser has to be the one that saves. collab-ydoc.test.mjs checks both directions
 * against y-tiptap itself.
 */

export const FRAGMENT = "default"

function setAttrs(el: Y.XmlElement, attrs: Record<string, unknown> | undefined) {
  if (!attrs) return
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || k === "ychange") continue
    // Y.XmlElement attributes are typed as strings but store any JSON value, which is what y-tiptap does.
    el.setAttribute(k, v as string)
  }
}

function marksToAttributes(marks: BlockMark[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of marks ?? []) out[m.type] = m.attrs ?? {}
  return out
}

function toYContent(nodes: BlockNode[] | undefined): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = []
  let run: BlockNode[] = []
  const flush = () => {
    if (!run.length) return
    const t = new Y.XmlText()
    t.applyDelta(run.map((n) => ({ insert: n.text ?? "", attributes: marksToAttributes(n.marks) })))
    out.push(t)
    run = []
  }
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      if (n.text) run.push(n)
      continue
    }
    flush()
    const el = new Y.XmlElement(n.type)
    setAttrs(el, n.attrs)
    const kids = toYContent(n.content)
    if (kids.length) el.insert(0, kids)
    out.push(el)
  }
  flush()
  return out
}

/** Fill an EMPTY fragment with a document. */
export function writeDocToFragment(doc: BlockDoc, fragment: Y.XmlFragment) {
  const kids = toYContent(doc.content)
  if (kids.length) fragment.insert(0, kids)
}

/** A new Y.Doc holding `doc`. */
export function ydocFromJson(doc: BlockDoc): Y.Doc {
  const ydoc = new Y.Doc()
  ydoc.transact(() => writeDocToFragment(doc, ydoc.getXmlFragment(FRAGMENT)))
  return ydoc
}

function fromYContent(items: Array<Y.XmlElement | Y.XmlText | Y.XmlHook>): BlockNode[] {
  const out: BlockNode[] = []
  for (const item of items) {
    if (item instanceof Y.XmlText) {
      for (const d of item.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>) {
        if (typeof d.insert !== "string" || !d.insert) continue
        const node: BlockNode = { type: "text", text: d.insert }
        const marks: BlockMark[] = []
        for (const [k, v] of Object.entries(d.attributes ?? {})) {
          if (k === "ychange") continue
          // y-prosemirror names overlapping marks "<type>--<hash>"; the type is before the "--".
          const type = k.includes("--") ? k.slice(0, k.indexOf("--")) : k
          const attrs = v && typeof v === "object" && Object.keys(v as object).length ? (v as Record<string, unknown>) : undefined
          marks.push(attrs ? { type, attrs } : { type })
        }
        if (marks.length) node.marks = marks
        out.push(node)
      }
    } else if (item instanceof Y.XmlElement) {
      const node: BlockNode = { type: item.nodeName }
      const attrs = item.getAttributes() as Record<string, unknown>
      const clean: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && k !== "ychange") clean[k] = v
      if (Object.keys(clean).length) node.attrs = clean
      const kids = fromYContent(item.toArray() as Array<Y.XmlElement | Y.XmlText>)
      if (kids.length) node.content = kids
      out.push(node)
    }
  }
  return out
}

/** The document a fragment holds, as TipTap JSON. */
export function fragmentToJson(fragment: Y.XmlFragment): BlockDoc {
  const content = fromYContent(fragment.toArray() as Array<Y.XmlElement | Y.XmlText>)
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

export function ydocToJson(ydoc: Y.Doc): BlockDoc {
  return fragmentToJson(ydoc.getXmlFragment(FRAGMENT))
}
