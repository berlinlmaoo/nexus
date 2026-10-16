import type PizZip from "pizzip"
import { DOMParser, type Element as XElement } from "@xmldom/xmldom"

// How a body paragraph looks on the page, so Review & edit can show the document as it prints instead of a
// plain list of lines (owner, 16 Oct 2026: "review and edit langsung di view kaya PDF-nya"). Read from the
// paragraph's own properties, its style chain and the document defaults; numbering is counted the way Word
// counts it (per list, deeper levels restart when a shallower one moves on). An approximation of Word's
// layout, not a renderer: enough for alignment, indents, numbers, spacing, size and bold/italic/underline.

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

export type RunStyle = { text: string; b?: true; i?: true; u?: true }

export type ParagraphLayout = {
  align?: "left" | "center" | "right" | "justify"
  /** points */
  indentLeft?: number
  hanging?: number
  firstLine?: number
  spaceBefore?: number
  spaceAfter?: number
  /** line height as a multiple (w:spacing line, auto rule) */
  lineHeight?: number
  /** font size in points */
  size?: number
  bold?: true
  /** the list number or bullet Word prints before the text ("1.", "A.", "•") */
  marker?: string
  /** the text in runs that differ in bold / italic / underline, joined they equal the paragraph's text */
  runs?: RunStyle[]
  /** a paragraph inside a table cell: which table, row and cell (0-based, in body order) */
  cell?: { table: number; row: number; col: number }
}

const kids = (el: XElement | null | undefined): XElement[] => {
  const out: XElement[] = []
  if (!el) return out
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XElement)
  return out
}
const kid = (el: XElement | null | undefined, name: string) => kids(el).find((c) => c.localName === name)
const val = (el: XElement | null | undefined, attr = "val") => el?.getAttributeNS(W, attr) ?? el?.getAttribute(`w:${attr}`) ?? null
const num = (s: string | null) => (s == null || s === "" || Number.isNaN(Number(s)) ? undefined : Number(s))
const on = (el: XElement | undefined) => {
  if (!el) return undefined
  const v = val(el)
  return !(v === "0" || v === "false" || v === "none" || v === "off")
}

type PProps = Omit<ParagraphLayout, "marker" | "runs" | "cell"> & { numId?: string; ilvl?: number; italic?: boolean; underline?: boolean }

function readPPr(pPr: XElement | undefined, out: PProps) {
  if (!pPr) return
  const jc = val(kid(pPr, "jc"))
  if (jc) out.align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : "left"
  const ind = kid(pPr, "ind")
  if (ind) {
    const left = num(val(ind, "left") ?? val(ind, "start"))
    if (left !== undefined) out.indentLeft = left / 20
    const hanging = num(val(ind, "hanging"))
    const first = num(val(ind, "firstLine"))
    if (hanging !== undefined) { out.hanging = hanging / 20; out.firstLine = undefined }
    if (first !== undefined) { out.firstLine = first / 20; out.hanging = undefined }
  }
  const sp = kid(pPr, "spacing")
  if (sp) {
    const before = num(val(sp, "before")); if (before !== undefined) out.spaceBefore = before / 20
    const after = num(val(sp, "after")); if (after !== undefined) out.spaceAfter = after / 20
    const line = num(val(sp, "line")); const rule = val(sp, "lineRule")
    if (line !== undefined && (!rule || rule === "auto")) out.lineHeight = line / 240
  }
  const np = kid(pPr, "numPr")
  if (np) {
    const id = val(kid(np, "numId")); if (id) out.numId = id
    const lvl = num(val(kid(np, "ilvl"))); if (lvl !== undefined) out.ilvl = lvl
  }
  readRPr(kid(pPr, "rPr"), out, false)
}

function readRPr(rPr: XElement | undefined, out: PProps, sizeToo = true) {
  if (!rPr) return
  const b = on(kid(rPr, "b")); if (b !== undefined) out.bold = b ? true : undefined
  const i = on(kid(rPr, "i")); if (i !== undefined) out.italic = i
  const u = kid(rPr, "u"); if (u) out.underline = val(u) !== "none"
  if (sizeToo) { const sz = num(val(kid(rPr, "sz"))); if (sz !== undefined) out.size = sz / 2 }
}

type StyleDef = { basedOn?: string; pPr?: XElement; rPr?: XElement }

function styleProps(styles: Map<string, StyleDef>, id: string | undefined, out: PProps, depth = 0) {
  if (!id || depth > 10) return
  const st = styles.get(id)
  if (!st) return
  styleProps(styles, st.basedOn, out, depth + 1)
  readPPr(st.pPr, out)
  readRPr(st.rPr, out)
}

type Level = { start: number; fmt: string; text: string; pPr?: XElement; rPr?: XElement }

function formatNumber(n: number, fmt: string): string {
  const letters = (k: number) => { let s = ""; while (k > 0) { k--; s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26) } return s }
  const roman = (k: number) => {
    const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]
    let s = ""; for (const [v, r] of map) while (k >= v) { s += r; k -= v } return s
  }
  switch (fmt) {
    case "upperLetter": return letters(n)
    case "lowerLetter": return letters(n).toLowerCase()
    case "upperRoman": return roman(n)
    case "lowerRoman": return roman(n).toLowerCase()
    case "none": return ""
    default: return String(n)
  }
}

/** Layout for each of `paragraphs` (the body paragraphs in order, as paragraphs.ts lists them). */
export function paragraphLayouts(zip: PizZip, paragraphs: { el: XElement; runs: { r: XElement; text: string }[] }[]): ParagraphLayout[] {
  const parse = (name: string) => {
    const xml = zip.file(name)?.asText()
    return xml ? new DOMParser().parseFromString(xml, "text/xml") : null
  }
  const stylesDoc = parse("word/styles.xml")
  const styles = new Map<string, StyleDef>()
  const defaults: PProps = {}
  let defaultParaStyle: string | undefined
  if (stylesDoc) {
    const dd = Array.from(stylesDoc.getElementsByTagNameNS(W, "docDefaults"))[0] as unknown as XElement | undefined
    readPPr(kid(kid(dd, "pPrDefault"), "pPr"), defaults)
    readRPr(kid(kid(dd, "rPrDefault"), "rPr"), defaults)
    for (const st of Array.from(stylesDoc.getElementsByTagNameNS(W, "style")) as unknown as XElement[]) {
      if (val(st, "type") !== "paragraph") continue
      const id = val(st, "styleId")
      if (!id) continue
      styles.set(id, { basedOn: val(kid(st, "basedOn")) ?? undefined, pPr: kid(st, "pPr"), rPr: kid(st, "rPr") })
      if (val(st, "default") === "1" || val(st, "default") === "true") defaultParaStyle = id
    }
  }

  const numberingDoc = parse("word/numbering.xml")
  const abstracts = new Map<string, Map<number, Level>>()
  const nums = new Map<string, { abstract: string; starts: Map<number, number> }>()
  if (numberingDoc) {
    for (const an of Array.from(numberingDoc.getElementsByTagNameNS(W, "abstractNum")) as unknown as XElement[]) {
      const levels = new Map<number, Level>()
      for (const lvl of kids(an).filter((c) => c.localName === "lvl")) {
        levels.set(num(val(lvl, "ilvl")) ?? 0, {
          start: num(val(kid(lvl, "start"))) ?? 1,
          fmt: val(kid(lvl, "numFmt")) ?? "decimal",
          text: val(kid(lvl, "lvlText")) ?? "",
          pPr: kid(lvl, "pPr"),
          rPr: kid(lvl, "rPr"),
        })
      }
      abstracts.set(val(an, "abstractNumId") ?? "", levels)
    }
    for (const n of Array.from(numberingDoc.getElementsByTagNameNS(W, "num")) as unknown as XElement[]) {
      const starts = new Map<number, number>()
      for (const o of kids(n).filter((c) => c.localName === "lvlOverride")) {
        const s = num(val(kid(o, "startOverride")))
        if (s !== undefined) starts.set(num(val(o, "ilvl")) ?? 0, s)
      }
      nums.set(val(n, "numId") ?? "", { abstract: val(kid(n, "abstractNumId")) ?? "", starts })
    }
  }
  const counters = new Map<string, number[]>()

  // Tables: number them in body order; a paragraph's cell is found from its ancestors.
  const tableIds = new Map<XElement, number>()
  const cellOf = (p: XElement): ParagraphLayout["cell"] => {
    let tc: XElement | undefined
    for (let a = p.parentNode as XElement | null; a; a = a.parentNode as XElement | null) {
      if (a.nodeType !== 1) continue
      if (a.localName === "tc" && !tc) tc = a
      if (a.localName === "tbl" && tc) {
        // only the outermost table counts; nested tables are flattened into their cell
        let outer = a
        for (let b = a.parentNode as XElement | null; b; b = b.parentNode as XElement | null) if (b.nodeType === 1 && b.localName === "tbl") outer = b
        if (!tableIds.has(outer)) tableIds.set(outer, tableIds.size)
        let cell = tc
        for (let c = tc.parentNode as XElement | null; c && c !== outer; c = c.parentNode as XElement | null) if (c.nodeType === 1 && c.localName === "tc") cell = c
        const tr = cell.parentNode as XElement
        const rows = kids(outer).filter((x) => x.localName === "tr")
        const cols = kids(tr).filter((x) => x.localName === "tc")
        return { table: tableIds.get(outer)!, row: rows.indexOf(tr), col: cols.indexOf(cell) }
      }
    }
    return undefined
  }

  return paragraphs.map(({ el, runs }) => {
    const pPr = kid(el, "pPr")
    const own: PProps = {}
    readPPr(pPr, own)
    const styleId = val(kid(pPr, "pStyle")) ?? defaultParaStyle
    const viaStyle: PProps = {}
    styleProps(styles, styleId, viaStyle)
    const numId = own.numId ?? viaStyle.numId
    const ilvl = own.ilvl ?? viaStyle.ilvl ?? 0
    const out: PProps = { ...defaults }

    let marker: string | undefined
    const list = numId && numId !== "0" ? nums.get(numId) : undefined
    const levels = list ? abstracts.get(list.abstract) : undefined
    const level = levels?.get(ilvl)
    if (list && level && levels) {
      const c = counters.get(numId!) ?? []
      for (let k = 0; k <= ilvl; k++) if (c[k] === undefined) c[k] = (list.starts.get(k) ?? levels.get(k)?.start ?? 1) - (k === ilvl ? 1 : 0)
      c[ilvl] += 1
      c.length = ilvl + 1
      counters.set(numId!, c)
      marker = level.fmt === "bullet"
        ? "•"
        : level.text.replace(/%(\d)/g, (_, d) => { const k = Number(d) - 1; return formatNumber(c[k] ?? 1, levels.get(k)?.fmt ?? "decimal") })
      readPPr(level.pPr, out)
    }
    Object.assign(out, Object.fromEntries(Object.entries(viaStyle).filter(([, v]) => v !== undefined)))
    if (level) readPPr(level.pPr, out) // the list's indent wins over the style's
    for (const [k, v] of Object.entries(own)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
    if (own.hanging !== undefined) out.firstLine = undefined
    if (own.firstLine !== undefined) out.hanging = undefined

    // Runs: bold / italic / underline as the paragraph's base plus each run's own rPr.
    const styled: RunStyle[] = []
    let firstSize: number | undefined
    for (const { r, text } of runs) {
      if (!text) continue
      const rp: PProps = { bold: out.bold, italic: out.italic, underline: out.underline }
      readRPr(kid(r, "rPr"), rp)
      if (firstSize === undefined && rp.size !== undefined && text.trim()) firstSize = rp.size
      const seg: RunStyle = { text, ...(rp.bold ? { b: true as const } : {}), ...(rp.italic ? { i: true as const } : {}), ...(rp.underline ? { u: true as const } : {}) }
      const last = styled[styled.length - 1]
      if (last && !!last.b === !!seg.b && !!last.i === !!seg.i && !!last.u === !!seg.u) last.text += text
      else styled.push(seg)
    }

    const layout: ParagraphLayout = {}
    if (out.align && out.align !== "left") layout.align = out.align
    if (out.indentLeft) layout.indentLeft = out.indentLeft
    if (out.hanging) layout.hanging = out.hanging
    if (out.firstLine) layout.firstLine = out.firstLine
    if (out.spaceBefore !== undefined) layout.spaceBefore = out.spaceBefore
    if (out.spaceAfter !== undefined) layout.spaceAfter = out.spaceAfter
    if (out.lineHeight) layout.lineHeight = Math.round(out.lineHeight * 100) / 100
    const size = firstSize ?? out.size
    if (size) layout.size = size
    if (marker) layout.marker = marker
    if (styled.some((s) => s.b || s.i || s.u)) layout.runs = styled
    const cell = cellOf(el)
    if (cell) layout.cell = cell
    return layout
  })
}

export type PageSetup = { width: number; marginLeft: number; marginRight: number; marginTop: number; font?: string; size?: number }

/** The body's page (the last section's size and margins, points) and the default font, for drawing it to scale. */
export function pageSetup(zip: PizZip): PageSetup {
  const out: PageSetup = { width: 595.3, marginLeft: 72, marginRight: 72, marginTop: 72 }
  const xml = zip.file("word/document.xml")?.asText()
  if (xml) {
    const dom = new DOMParser().parseFromString(xml, "text/xml")
    const sects = Array.from(dom.getElementsByTagNameNS(W, "sectPr")) as unknown as XElement[]
    const sect = sects[sects.length - 1]
    const w = num(val(kid(sect, "pgSz"), "w")); if (w) out.width = w / 20
    const mar = kid(sect, "pgMar")
    const l = num(val(mar, "left")); if (l !== undefined) out.marginLeft = l / 20
    const r = num(val(mar, "right")); if (r !== undefined) out.marginRight = r / 20
    const t = num(val(mar, "top")); if (t !== undefined) out.marginTop = t / 20
  }
  const styles = zip.file("word/styles.xml")?.asText()
  if (styles) {
    const dom = new DOMParser().parseFromString(styles, "text/xml")
    const dd = Array.from(dom.getElementsByTagNameNS(W, "docDefaults"))[0] as unknown as XElement | undefined
    const rPr = kid(kid(dd, "rPrDefault"), "rPr")
    const fonts = kid(rPr, "rFonts")
    const font = val(fonts, "ascii") ?? val(fonts, "hAnsi"); if (font) out.font = font
    const sz = num(val(kid(rPr, "sz"))); if (sz) out.size = sz / 2
  }
  return out
}
