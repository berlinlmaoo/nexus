import { inflateSync } from "node:zlib"

/**
 * Page count of a PDF without a PDF library (print cap: 50 pages a job, owner 18 Nov 2026).
 *
 * The page tree's root is the /Type /Pages dictionary with no /Parent; its /Count is the number of pages. Every
 * /Pages node has a /Count, and the root's is the largest, so the largest /Count of a /Pages dictionary is the
 * answer. Newer PDFs keep dictionaries in compressed object streams (/Type /ObjStm, FlateDecode): those are
 * inflated and searched too. Failing that, the leaf /Type /Page dictionaries are counted. Null = not readable.
 */

const LEAF_PAGE = /\/Type\s*\/Page(?![A-Za-z])/g

/** Every top-level "<< … >>" dictionary in the text, with its nested dictionaries cut out (their keys are not its keys). */
function dictionaries(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let parts: string[] = []
  let from = 0
  for (let i = text.indexOf("<<"); i >= 0 && i < text.length - 1; ) {
    const open = text.indexOf("<<", i)
    const close = depth > 0 ? text.indexOf(">>", i) : -1
    if (open < 0 && close < 0) break
    if (open >= 0 && (close < 0 || open < close)) {
      if (depth === 1) parts.push(text.slice(from, open))
      depth++
      if (depth === 1) parts = []
      i = open + 2
      if (depth === 1) from = i
    } else {
      if (depth === 1) parts.push(text.slice(from, close))
      depth--
      i = close + 2
      if (depth === 0) out.push(parts.join(" "))
      else if (depth === 1) from = i
    }
  }
  return out
}

/** /Count of every /Type /Pages dictionary. */
function pagesCounts(text: string): number[] {
  const out: number[] = []
  for (const d of dictionaries(text)) {
    if (!/\/Type\s*\/Pages\b/.test(d)) continue
    const m = /\/Count\s+(\d+)/.exec(d)
    if (m) out.push(Number(m[1]))
  }
  return out
}

/** The inflated contents of every FlateDecode object stream (found by its /ObjStm key; linear, no backtracking). */
function objectStreams(pdf: Buffer): string[] {
  const out: string[] = []
  const latin = pdf.toString("latin1")
  let at = 0
  for (let hit = latin.indexOf("/ObjStm", at); hit >= 0; hit = latin.indexOf("/ObjStm", at)) {
    const objStart = latin.lastIndexOf(" obj", hit)
    const kw = latin.indexOf("stream", hit)
    if (objStart < 0 || kw < 0) break
    const dict = latin.slice(objStart, kw)
    let start = kw + "stream".length
    if (latin[start] === "\r") start++
    if (latin[start] === "\n") start++
    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)
    let end = lenMatch ? start + Number(lenMatch[1]) : -1
    if (end <= start || end > pdf.length) end = latin.indexOf("endstream", start)
    at = Math.max(end, kw + 6)
    if (end <= start || !/\/FlateDecode\b/.test(dict)) continue
    try {
      out.push(inflateSync(pdf.subarray(start, end)).toString("latin1"))
    } catch {
      /* a damaged stream: skip it */
    }
  }
  return out
}

export function countPdfPages(pdf: Buffer): number | null {
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return null
  // Content and image streams are binary and may hold "<<" / ">>" by chance: never scan inside them.
  const plain = pdf.toString("latin1").replace(/stream\r?\n[^]*?endstream/g, " ")
  const streams = objectStreams(pdf)
  const counts = [...pagesCounts(plain), ...streams.flatMap(pagesCounts)]
  if (counts.length) return Math.max(...counts)
  const leaves = [plain, ...streams].reduce((n, text) => n + (text.match(LEAF_PAGE)?.length ?? 0), 0)
  return leaves > 0 ? leaves : null
}
