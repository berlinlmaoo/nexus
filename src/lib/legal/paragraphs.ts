import PizZip from "pizzip"
import { DOMParser, XMLSerializer, type Element as XElement, type Document as XDocument } from "@xmldom/xmldom"
import { diffWords } from "@/lib/legal/diff"
import { DOCX_MAX_UNZIPPED_BYTES, zipUnpackedSize } from "@/lib/legal/storage"
import { keepManualBreaksUnstretched } from "@/lib/legal/template"

// A generated document, paragraph by paragraph, for review (owner, 14 Oct 2026: "edit lines/paragraphs
// manually; GIDEON can edit precisely"). Only the body is listed — the kop and the headers/footers are not
// editable here — and a paragraph is editable only when it is plain text runs: a paragraph with a field (page
// number), an image, a text box, a hyperlink or tracked changes is locked ("edit it in Word and upload").
// The paragraph that carries the document number is locked too.
//
// An edit keeps the formatting of the text it doesn't touch (see rewrite).

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

/** number: prints the document number; complex: a field, image, text box, link or tracked change; empty: a
 *  blank line (nothing to edit — clients hide it). */
export type LockReason = "number" | "complex" | "empty"

export type DocParagraph = {
  index: number
  text: string
  editable: boolean
  lockReason?: LockReason
  /** pStyle, when the paragraph has one (Heading1, ListParagraph …) */
  style?: string
  inTable: boolean
}

export class ParagraphEditError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const IGNORED = new Set(["pPr", "bookmarkStart", "bookmarkEnd", "proofErr", "permStart", "permEnd", "commentRangeStart", "commentRangeEnd"])

function children(el: XElement): XElement[] {
  const out: XElement[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XElement)
  return out
}

/** A run's text ("\t" for a tab, "\n" for a line break), or null when the run holds anything else. */
function runText(r: XElement): string | null {
  let text = ""
  for (const c of children(r)) {
    if (c.namespaceURI !== W) return null
    switch (c.localName) {
      case "rPr":
      case "lastRenderedPageBreak":
        break
      case "t":
        text += c.textContent ?? ""
        break
      case "tab":
        text += "\t"
        break
      case "br":
      case "cr":
        if (c.getAttributeNS(W, "type") === "page") return null
        text += "\n"
        break
      case "noBreakHyphen":
        text += "‑"
        break
      default:
        return null
    }
  }
  return text
}

type Analyzed = { el: XElement; runs: { r: XElement; text: string }[]; text: string; simple: boolean; blank: boolean; style?: string; inTable: boolean }

function hasAncestor(el: XElement, localName: string): boolean {
  for (let p = el.parentNode; p; p = p.parentNode) {
    if (p.nodeType === 1 && (p as XElement).namespaceURI === W && (p as XElement).localName === localName) return true
  }
  return false
}

function analyze(p: XElement): Analyzed {
  const runs: { r: XElement; text: string }[] = []
  let simple = true
  let other = false
  let style: string | undefined
  for (const c of children(p)) {
    if (c.namespaceURI === W && c.localName === "pPr") {
      const ps = children(c).find((x) => x.localName === "pStyle")
      style = ps?.getAttributeNS(W, "val") || undefined
      continue
    }
    if (c.namespaceURI === W && IGNORED.has(c.localName ?? "")) continue
    if (c.namespaceURI === W && c.localName === "r") {
      const t = runText(c)
      if (t === null) { simple = false; other = true }
      else runs.push({ r: c, text: t })
      continue
    }
    simple = false
    other = true
  }
  const text = runs.map((r) => r.text).join("")
  return { el: p, runs, text, simple: simple && runs.length > 0, blank: !other && !text.trim(), style, inTable: hasAncestor(p, "tc") }
}

function load(docx: Buffer): { zip: PizZip; dom: XDocument; paragraphs: Analyzed[] } {
  let zip: PizZip
  try {
    zip = new PizZip(docx)
  } catch {
    throw new ParagraphEditError("This version is not a Word file")
  }
  if (zipUnpackedSize(zip) > DOCX_MAX_UNZIPPED_BYTES) throw new ParagraphEditError("This Word file is too large once unpacked")
  const xml = zip.file("word/document.xml")?.asText()
  if (!xml) throw new ParagraphEditError("This version is not a Word file")
  const dom = new DOMParser().parseFromString(xml, "text/xml")
  const all = Array.from(dom.getElementsByTagNameNS(W, "p")) as unknown as XElement[]
  // A text box's paragraphs live inside another paragraph; the outer one is locked (it holds a drawing),
  // the inner ones are not listed.
  const paragraphs = all.filter((p) => !hasAncestor(p, "p")).map(analyze)
  return { zip, dom, paragraphs }
}

const locked = (a: Analyzed, lockedTexts: string[]): LockReason | undefined => {
  // Case-insensitive: a template may print the number through | upper or | lower.
  const lower = a.text.toLowerCase()
  if (lockedTexts.some((t) => t && lower.includes(t.toLowerCase()))) return "number"
  if (a.blank) return "empty"
  if (!a.simple) return "complex"
  return undefined
}

/** The body's paragraphs, in order. `lockedTexts`: text whose paragraph may not change (the number). */
export function readParagraphs(docx: Buffer, lockedTexts: string[] = []): DocParagraph[] {
  return load(docx).paragraphs.map((a, index) => {
    const lockReason = locked(a, lockedTexts)
    return { index, text: a.text, editable: !lockReason, ...(lockReason ? { lockReason } : {}), ...(a.style ? { style: a.style } : {}), inTable: a.inTable }
  })
}

export function paragraphTexts(docx: Buffer): string[] {
  return load(docx).paragraphs.map((a) => a.text)
}

function setRunText(dom: XDocument, r: XElement, text: string) {
  for (const c of children(r)) if (!(c.namespaceURI === W && c.localName === "rPr")) r.removeChild(c)
  for (const part of text.split(/(\t|\n)/)) {
    if (!part) continue
    if (part === "\t") r.appendChild(dom.createElementNS(W, "w:tab"))
    else if (part === "\n") r.appendChild(dom.createElementNS(W, "w:br"))
    else {
      const t = dom.createElementNS(W, "w:t")
      t.setAttribute("xml:space", "preserve")
      t.appendChild(dom.createTextNode(part))
      r.appendChild(t)
    }
  }
}

/**
 * Rewrite one paragraph's runs from `before` to `after`, word hunk by word hunk (diffWords): every character
 * that survives keeps its run, so text between two edits keeps its formatting. Replaced text takes the run
 * of the first character it replaces; inserted text the run of the character before it (as Word does).
 */
function rewrite(dom: XDocument, a: Analyzed, after: string) {
  const chars: { ch: string; run: number }[] = []
  a.runs.forEach((run, i) => { for (const ch of run.text) chars.push({ ch, run: i }) })
  const out: { ch: string; run: number }[] = []
  let pos = 0
  let replacedRun: number | null = null
  for (const seg of diffWords(a.text, after)) {
    const len = [...seg.text].length
    if (seg.type === "same") {
      for (let k = 0; k < len; k++) out.push(chars[pos + k])
      pos += len
      replacedRun = null
    } else if (seg.type === "del") {
      replacedRun = chars[pos]?.run ?? null
      pos += len
    } else {
      const run = replacedRun ?? out[out.length - 1]?.run ?? chars[pos]?.run ?? 0
      for (const ch of seg.text) out.push({ ch, run })
      replacedRun = null
    }
  }
  a.runs.forEach((run, i) => {
    const text = out.filter((c) => c.run === i).map((c) => c.ch).join("")
    if (text === run.text) return
    if (text) setRunText(dom, run.r, text)
    else a.el.removeChild(run.r)
  })
}

export type ParagraphChange = { index: number; before: string; after: string }

/** Line endings normalised, and the control characters XML 1.0 forbids (pasted from PDFs) dropped. */
export function cleanParagraphText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
}

/**
 * Apply `{ index, text }` edits to a DOCX. Refuses a locked paragraph or an unknown index; an edit that
 * changes nothing is dropped. Returns the new file and what changed.
 */
export function applyParagraphEdits(docx: Buffer, edits: { index: number; text: string }[], lockedTexts: string[] = []): { docx: Buffer; changes: ParagraphChange[] } {
  const { zip, dom, paragraphs } = load(docx)
  const changes: ParagraphChange[] = []
  const seen = new Set<number>()
  for (const e of edits) {
    if (!Number.isInteger(e.index) || seen.has(e.index)) throw new ParagraphEditError("Each paragraph can be edited once per change")
    seen.add(e.index)
    const a = paragraphs[e.index]
    if (!a) throw new ParagraphEditError(`Paragraph ${e.index + 1} doesn't exist`)
    const reason = locked(a, lockedTexts)
    if (reason === "number") throw new ParagraphEditError(`Paragraph ${e.index + 1} carries the document number and can't be changed`)
    if (reason === "empty") throw new ParagraphEditError(`Paragraph ${e.index + 1} is a blank line; add text in Word and upload the file`)
    if (reason) throw new ParagraphEditError(`Paragraph ${e.index + 1} has a field, image or link; change it in Word and upload the file`)
    const after = cleanParagraphText(String(e.text ?? "")).slice(0, 20000)
    if (!after.trim()) throw new ParagraphEditError(`Paragraph ${e.index + 1} can't be emptied here`)
    if (after === a.text) continue
    rewrite(dom, a, after)
    changes.push({ index: e.index, before: a.text, after })
  }
  if (!changes.length) return { docx, changes }
  zip.file("word/document.xml", new XMLSerializer().serializeToString(dom))
  if (changes.some((c) => c.after.includes("\n"))) keepManualBreaksUnstretched(zip)
  return { docx: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer, changes }
}
