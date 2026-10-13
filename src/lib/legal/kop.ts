import path from "path"
import PizZip from "pizzip"
import { DOCX_MAX_UNZIPPED_BYTES, zipUnpackedSize } from "@/lib/legal/storage"

// The kop (letterhead): each company's kop is a .docx whose FIRST-PAGE header (logo + address) is copied
// into every document the company issues (owner, 14 Oct 2026). The template's own headers stay for the
// following pages ("CONFIDENTIAL | …"), and its default footer is reused on page 1 so the page number and
// paraf boxes don't vanish there.

const REL_HEADER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
const HEADER_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"
const KOP_PART = "legal-kop-header.xml"
const KOP_REL_ID = "rIdLegalKop"

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".emf": "image/x-emf",
  ".wmf": "image/x-wmf",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
}

export class KopError extends Error {}

type Rel = { id: string; type: string; target: string; external: boolean; raw: string }

function readRels(xml: string | undefined): Rel[] {
  if (!xml) return []
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => {
    const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[0])?.[1] ?? ""
    return { id: attr("Id"), type: attr("Type"), target: attr("Target"), external: attr("TargetMode") === "External", raw: m[0] }
  })
}

function openKop(buf: Buffer): PizZip {
  let kop: PizZip
  try {
    kop = new PizZip(buf)
  } catch {
    throw new KopError("The kop is not a Word (.docx) file")
  }
  if (zipUnpackedSize(kop) > DOCX_MAX_UNZIPPED_BYTES) throw new KopError("The kop file is too large once unpacked")
  return kop
}

function text(zip: PizZip, name: string): string | undefined {
  return zip.file(name)?.asText()
}

/** The first `<w:sectPr …>…</w:sectPr>` of a document: the first section's properties. */
function firstSectPr(xml: string): { start: number; end: number; body: string } | null {
  const start = xml.search(/<w:sectPr[\s>/]/)
  if (start < 0) return null
  const close = xml.indexOf("</w:sectPr>", start)
  const selfClose = xml.slice(start, xml.indexOf(">", start) + 1).endsWith("/>")
  const end = selfClose ? xml.indexOf(">", start) + 1 : close + "</w:sectPr>".length
  return { start, end, body: xml.slice(start, end) }
}

/** Which header part a kop .docx shows on its first page. Throws when it has none. */
function kopHeaderPart(kop: PizZip): string {
  const doc = text(kop, "word/document.xml")
  if (!doc) throw new KopError("The kop is not a Word (.docx) file")
  const sect = firstSectPr(doc)
  const refs = sect ? [...sect.body.matchAll(/<w:headerReference\b[^>]*\/>/g)].map((m) => m[0]) : []
  const typed = (type: string) => refs.find((r) => r.includes(`w:type="${type}"`))
  const titlePg = !!sect && /<w:titlePg(\s*\/>|\s+w:val="(1|true|on)"\s*\/>)/.test(sect.body)
  const ref = (titlePg && typed("first")) || typed("default") || typed("first")
  const rId = ref ? /r:id="([^"]+)"/.exec(ref)?.[1] : undefined
  const rel = readRels(text(kop, "word/_rels/document.xml.rels")).find((r) => r.id === rId && r.type === REL_HEADER)
  if (!rel) throw new KopError("The kop file has no header: put the logo and address in the page header")
  const part = `word/${rel.target.replace(/^\/?word\//, "")}`
  if (!kop.file(part)) throw new KopError("The kop file names a header that isn't in it; save it again from Word")
  return part
}

/** Check a kop file on upload. Returns nothing; throws KopError. */
export function checkKop(buf: Buffer) {
  kopHeaderPart(openKop(buf))
}

const SECT_AFTER_TITLEPG = ["w:textDirection", "w:bidi", "w:rtlGutter", "w:docGrid", "w:printerSettings", "w:sectPrChange"]

/** Put `<w:titlePg/>` where the schema wants it (Word refuses an out-of-order sectPr). */
function ensureTitlePg(sect: string): string {
  if (/<w:titlePg[\s/>]/.test(sect)) return sect.replace(/<w:titlePg\b[^>]*\/>/, "<w:titlePg/>")
  for (const tag of SECT_AFTER_TITLEPG) {
    const i = sect.search(new RegExp(`<${tag}[\\s/>]`))
    if (i >= 0) return `${sect.slice(0, i)}<w:titlePg/>${sect.slice(i)}`
  }
  return sect.replace("</w:sectPr>", "<w:titlePg/></w:sectPr>")
}

/**
 * Return `docx` with `kopDocx`'s first-page header as its first page's header. Idempotent: a document that
 * already carries a kop (an edited version) gets it replaced, not doubled.
 */
export function applyKop(docx: Buffer, kopDocx: Buffer): Buffer {
  const zip = new PizZip(docx)
  const kop = openKop(kopDocx)
  const headerPath = kopHeaderPart(kop)
  const headerXml = text(kop, headerPath)!
  const headerRelsPath = `${path.posix.dirname(headerPath)}/_rels/${path.posix.basename(headerPath)}.rels`

  // 1. The header part and whatever it embeds (the logo), under names that can't clash with the template's.
  let n = 0
  const mediaExts = new Set<string>()
  const rels = readRels(text(kop, headerRelsPath)).map((r) => {
    if (r.external) return r.raw
    const source = path.posix.normalize(`${path.posix.dirname(headerPath)}/${r.target}`)
    const file = kop.file(source)
    if (!file) return null
    const ext = path.posix.extname(source).toLowerCase()
    const name = `media/legal-kop-${++n}${ext}`
    zip.file(`word/${name}`, file.asUint8Array())
    if (ext) mediaExts.add(ext)
    return r.raw.replace(/\bTarget="[^"]*"/, `Target="${name}"`)
  }).filter(Boolean)
  zip.file(`word/${KOP_PART}`, headerXml)
  zip.file(`word/_rels/${KOP_PART}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`)

  // 2. Content types: the header part, and the image extensions it uses.
  let ct = text(zip, "[Content_Types].xml") ?? ""
  if (!ct.includes(`PartName="/word/${KOP_PART}"`)) {
    ct = ct.replace("</Types>", `<Override PartName="/word/${KOP_PART}" ContentType="${HEADER_CT}"/></Types>`)
  }
  for (const ext of mediaExts) {
    const bare = ext.slice(1)
    if (!new RegExp(`<Default\\b[^>]*Extension="${bare}"`, "i").test(ct) && MEDIA_TYPES[ext]) {
      ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${bare}" ContentType="${MEDIA_TYPES[ext]}"/>`)
    }
  }
  zip.file("[Content_Types].xml", ct)

  // 3. The document's relationship to it.
  const docRelsPath = "word/_rels/document.xml.rels"
  let docRels = text(zip, docRelsPath) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  if (!docRels.includes(`Id="${KOP_REL_ID}"`)) {
    docRels = docRels.replace("</Relationships>", `<Relationship Id="${KOP_REL_ID}" Type="${REL_HEADER}" Target="${KOP_PART}"/></Relationships>`)
  }
  zip.file(docRelsPath, docRels)

  // 4. The first section: first-page header = the kop; first-page footer = the template's default footer.
  let doc = text(zip, "word/document.xml")!
  if (!/xmlns:r="/.test(doc.slice(0, doc.indexOf(">", doc.indexOf("<w:document")) + 1))) {
    doc = doc.replace("<w:document", `<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`)
  }
  let sect = firstSectPr(doc)
  if (!sect) {
    doc = doc.replace("</w:body>", "<w:sectPr/></w:body>")
    sect = firstSectPr(doc)!
  }
  let body = sect.body.endsWith("/>") ? sect.body.replace(/\s*\/>$/, "></w:sectPr>") : sect.body
  body = body.replace(/<w:headerReference\b[^>]*w:type="first"[^>]*\/>/g, "")
  const openEnd = body.indexOf(">") + 1
  const kopRef = `<w:headerReference w:type="first" r:id="${KOP_REL_ID}"/>`
  const footers = [...body.matchAll(/<w:footerReference\b[^>]*\/>/g)].map((m) => m[0])
  const defaultFooter = footers.find((f) => f.includes('w:type="default"'))
  if (defaultFooter && !footers.some((f) => f.includes('w:type="first"'))) {
    const id = /r:id="([^"]+)"/.exec(defaultFooter)?.[1]
    if (id) {
      // After the header references (schema order), so put it right after the last headerReference.
      const lastHeader = [...body.matchAll(/<w:headerReference\b[^>]*\/>/g)].pop()
      const at = lastHeader ? lastHeader.index! + lastHeader[0].length : openEnd
      body = `${body.slice(0, at)}<w:footerReference w:type="first" r:id="${id}"/>${body.slice(at)}`
    }
  }
  body = `${body.slice(0, openEnd)}${kopRef}${body.slice(openEnd)}`
  body = ensureTitlePg(body)
  doc = `${doc.slice(0, sect.start)}${body}${doc.slice(sect.end)}`
  zip.file("word/document.xml", doc)

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer
}
