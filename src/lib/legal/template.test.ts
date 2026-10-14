import { describe, expect, it } from "vitest"
import PizZip from "pizzip"
import { fillTemplate, inspectTemplate, withManualBreaksUnstretched } from "@/lib/legal/template"

const FLAG = "<w:doNotExpandShiftReturn/>"

describe("withManualBreaksUnstretched", () => {
  it("adds the flag at the start of an existing compat block", () => {
    const xml = `<w:settings><w:compat><w:compatSetting w:name="compatibilityMode" w:val="15"/></w:compat><w:rsids/></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:compat>${FLAG}<w:compatSetting w:name="compatibilityMode" w:val="15"/></w:compat><w:rsids/></w:settings>`)
  })

  it("keeps schema order after the compat options that precede it", () => {
    const xml = `<w:settings><w:compat><w:spaceForUL/><w:ulTrailSpace/><w:doNotUseHTMLParagraphAutoSpacing/></w:compat></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:compat><w:spaceForUL/><w:ulTrailSpace/>${FLAG}<w:doNotUseHTMLParagraphAutoSpacing/></w:compat></w:settings>`)
  })

  it("fills an empty compat element", () => {
    expect(withManualBreaksUnstretched(`<w:settings><w:compat/></w:settings>`)).toBe(`<w:settings><w:compat>${FLAG}</w:compat></w:settings>`)
  })

  it("creates compat before the parts that follow it", () => {
    const xml = `<w:settings><w:zoom w:percent="100"/><w:rsids><w:rsidRoot w:val="1"/></w:rsids><w:themeFontLang w:val="id-ID"/></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(`<w:settings><w:zoom w:percent="100"/><w:compat>${FLAG}</w:compat><w:rsids><w:rsidRoot w:val="1"/></w:rsids><w:themeFontLang w:val="id-ID"/></w:settings>`)
  })

  it("leaves a file that already has the flag alone", () => {
    const xml = `<w:settings><w:compat>${FLAG}</w:compat></w:settings>`
    expect(withManualBreaksUnstretched(xml)).toBe(xml)
  })
})

/** A one-part .docx whose body is the given paragraphs (and table rows, as raw XML). */
function docx(body: string): Buffer {
  const zip = new PizZip()
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generate({ type: "nodebuffer" }) as Buffer
}
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`
const textOf = (buf: Buffer) =>
  new PizZip(buf).file("word/document.xml")!.asText().replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").trim().split("\n")

describe("a section on its own field", () => {
  const tpl = docx(p("PT Contoh{{#NPWP}}, NPWP {{NPWP}}{{/NPWP}}, berkedudukan di Jakarta"))

  it("is an optional field, not a list", () => {
    const fields = inspectTemplate(tpl)
    expect(fields.map((f) => [f.name, f.type, f.required])).toEqual([["TANGGAL_DOKUMEN", "date", true], ["NPWP", "text", false]])
  })

  it("prints only when the field has a value", () => {
    const fields = inspectTemplate(tpl)
    const fill = (NPWP: unknown) => textOf(fillTemplate(tpl, fields, { TANGGAL_DOKUMEN: "2026-10-14", NPWP }))[0]
    expect(fill("01.234.567.8-901.000")).toBe("PT Contoh, NPWP 01.234.567.8-901.000, berkedudukan di Jakarta")
    expect(fill("-")).toBe("PT Contoh, berkedudukan di Jakarta")
    expect(fill(undefined)).toBe("PT Contoh, berkedudukan di Jakarta")
  })
})

describe("computed values", () => {
  const tpl = docx(
    p("Tahap 1 Rp {{HONOR | persen:50}} ({{HONOR | persen:50 | terbilang_rupiah}})") +
      p("Berlaku sampai {{TANGGAL_DOKUMEN | tambah_bulan:DURASI_BULAN}}") +
      `<w:tbl>${row("{{#BARIS}}{{BULAN}}", "{{JUMLAH_EVENT}}", "{{TERMIN | persen_dari:NILAI_LISENSI}}%{{/BARIS}}")}${row("TOTAL", "{{BARIS | jumlah:JUMLAH_EVENT}}", "")}</w:tbl>`,
  )

  it("asks for the fields the filters name, and nothing for the computed values", () => {
    const fields = inspectTemplate(tpl)
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ["TANGGAL_DOKUMEN", "date"], ["HONOR", "money"], ["DURASI_BULAN", "number"], ["BARIS", "list"], ["NILAI_LISENSI", "money"],
    ])
    expect(fields.find((f) => f.name === "BARIS")!.columns!.map((c) => c.name)).toEqual(["BULAN", "JUMLAH_EVENT", "TERMIN"])
  })

  it("fills them from the form", () => {
    const fields = inspectTemplate(tpl)
    const out = textOf(fillTemplate(tpl, fields, {
      TANGGAL_DOKUMEN: "2026-10-14", HONOR: 12500000, DURASI_BULAN: 6, NILAI_LISENSI: 600000000,
      BARIS: [{ BULAN: "Nov", JUMLAH_EVENT: 4, TERMIN: 100000000 }, { BULAN: "Des", JUMLAH_EVENT: 3, TERMIN: 99999998 }],
    }))
    expect(out).toEqual([
      "Tahap 1 Rp 6.250.000 (Enam Juta Dua Ratus Lima Puluh Ribu Rupiah)",
      "Berlaku sampai 14 April 2027",
      "Nov", "4", "16,67%", "Des", "3", "16,67%",
      "TOTAL", "7",
    ])
  })

  it("rejects a computed filter without its argument", () => {
    expect(() => inspectTemplate(docx(p("{{HONOR | persen}}")))).toThrow(/template has errors/)
  })
})
