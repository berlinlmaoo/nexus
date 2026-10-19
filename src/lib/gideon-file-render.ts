/**
 * GIDEON file output (18 Oct 2026): a Doc or an answer as DOCX (and, through the Legal module's Gotenberg sidecar,
 * PDF), a table as XLSX. A light generator on purpose: NEXUS has no Markdown → Word path, Legal's docxtemplater
 * needs a template, and the sheet export only knows sheets. What GIDEON writes is headings, paragraphs, **bold**,
 * bullet / numbered lists and pipe tables; that is what this renders.
 *
 * markdownBlocks + docxDocumentXml are pure (no I/O) and tested in gideon-file-render.test.mjs.
 */

export type Run = { text: string; bold?: boolean }
export type Block =
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "para"; runs: Run[] }
  | { kind: "bullet"; runs: Run[]; n?: number }
  | { kind: "table"; rows: string[][] }

/** "**bold** and plain" → runs. Other inline marks (`code`, _em_, links) read as their text. */
export function inlineRuns(text: string): Run[] {
  const clean = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1$2")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2")
  const out: Run[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    if (m.index > last) out.push({ text: clean.slice(last, m.index) })
    out.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < clean.length) out.push({ text: clean.slice(last) })
  return out.filter((r) => r.text.length)
}

const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())

/** Markdown (as GIDEON writes it) → blocks. Plain text without marks becomes paragraphs, one per line group. */
export function markdownBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: "para", runs: inlineRuns(para.join(" ")) }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t) { flush(); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(t)
    if (h) { flush(); out.push({ kind: "heading", level: h[1].length, runs: inlineRuns(h[2]) }); continue }
    if (t.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush()
      const rows = [tableCells(t)]
      i += 1
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) { i += 1; rows.push(tableCells(lines[i])) }
      out.push({ kind: "table", rows })
      continue
    }
    const b = /^[-*•]\s+(.*)$/.exec(t)
    if (b) { flush(); out.push({ kind: "bullet", runs: inlineRuns(b[1]) }); continue }
    const n = /^(\d{1,3})[.)]\s+(.*)$/.exec(t)
    if (n) { flush(); out.push({ kind: "bullet", n: Number(n[1]), runs: inlineRuns(n[2]) }); continue }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); continue }
    para.push(t)
  }
  flush()
  return out
}

/** A plain-text doc (Doc.contentText) → blocks: one paragraph per line. */
export function plainBlocks(text: string): Block[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ kind: "para" as const, runs: [{ text: l }] }))
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")

function runXml(r: Run, size?: number): string {
  const props = [r.bold ? "<w:b/>" : "", size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""].join("")
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`
}

const HEADING_SIZE = [0, 36, 30, 26, 24, 22, 22]

/** The body of word/document.xml for these blocks (title first). */
export function docxDocumentXml(title: string, blocks: Block[]): string {
  const body: string[] = []
  if (title) body.push(`<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${runXml({ text: title, bold: true }, 40)}</w:p>`)
  for (const b of blocks) {
    if (b.kind === "heading") {
      body.push(`<w:p><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>${b.runs.map((r) => runXml({ ...r, bold: true }, HEADING_SIZE[b.level] ?? 22)).join("")}</w:p>`)
    } else if (b.kind === "para") {
      body.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${b.runs.map((r) => runXml(r)).join("")}</w:p>`)
    } else if (b.kind === "bullet") {
      const mark = b.n !== undefined ? `${b.n}.\t` : "•\t"
      body.push(`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr>${runXml({ text: mark })}${b.runs.map((r) => runXml(r)).join("")}</w:p>`)
    } else {
      const border = (s: string) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`
      const width = Math.max(1, ...b.rows.map((r) => r.length))
      const rows = b.rows.map((r, ri) => `<w:tr>${Array.from({ length: width }, (_, ci) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ""}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${inlineRuns(r[ci] ?? "").map((x) => runXml(ri === 0 ? { ...x, bold: true } : x, 20)).join("")}</w:p></w:tc>`).join("")}</w:tr>`).join("")
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${rows}</w:tbl><w:p/>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`

/** A .docx for these blocks. */
export async function renderDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const { default: PizZip } = await import("pizzip")
  const zip = new PizZip()
  zip.file("[Content_Types].xml", CONTENT_TYPES)
  zip.file("_rels/.rels", ROOT_RELS)
  zip.file("word/_rels/document.xml.rels", DOC_RELS)
  zip.file("word/styles.xml", STYLES)
  zip.file("word/document.xml", docxDocumentXml(title, blocks))
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer
}

/** A .xlsx of one table: bold header, numbers as numbers (Indonesian "1.500.000", "Rp 2.000", "15%" too). */
export async function renderXlsx(title: string, header: string[], rows: unknown[][]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs")
  const { detectInput } = await import("@/lib/sheet-formula")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet((title || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1")
  ws.addRow(header)
  ws.getRow(1).font = { bold: true }
  for (const r of rows) {
    ws.addRow(r.map((v) => {
      if (typeof v === "number" || typeof v === "boolean") return v
      const s = v === null || v === undefined ? "" : String(v)
      const d = detectInput(s)
      if (d.kind === "number" && d.nf !== "date") return d.v
      return s
    }))
  }
  ws.columns.forEach((c, i) => { c.width = Math.min(60, Math.max(10, ...[header[i] ?? "", ...rows.map((r) => String(r[i] ?? ""))].map((x) => x.length + 2))) })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** The first pipe table of a Markdown text, if any: [header, rows]. */
export function firstTable(blocks: Block[]): [string[], string[][]] | null {
  const t = blocks.find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table")
  return t && t.rows.length ? [t.rows[0], t.rows.slice(1)] : null
}
