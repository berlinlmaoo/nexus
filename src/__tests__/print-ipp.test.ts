// @vitest-environment node
import { describe, expect, it } from "vitest"
import { deflateSync } from "node:zlib"
import {
  IPP_OP, JOB_STATE, TAG, VT, attrOf, attrValues, clip, decodeMessage, encodeAttr, encodeGetJobAttributes, encodeMessage,
  encodePrintJob, isIppSuccess, parsePrinterUrl,
} from "@/lib/print/ipp"
import { countPdfPages } from "@/lib/print/pdf-pages"
import { printerConfig, printingStatus } from "@/lib/print/config"

// Print to the office printer (18 Nov 2026): the IPP encoder against the bytes RFC 8010 prescribes, its decoder on
// a response shaped like CUPS's, the printer URL, and the PDF page counter behind the 50-page cap.

describe("IPP encoding (RFC 8010)", () => {
  it("encodes one attribute as tag, name length, name, value length, value", () => {
    const b = encodeAttr({ tag: VT.CHARSET, name: "attributes-charset", values: ["utf-8"] })
    expect(b[0]).toBe(0x47)
    expect(b.readUInt16BE(1)).toBe(18)
    expect(b.toString("utf8", 3, 21)).toBe("attributes-charset")
    expect(b.readUInt16BE(21)).toBe(5)
    expect(b.toString("utf8", 23)).toBe("utf-8")
  })

  it("encodes integers as 4 bytes and extra values of a 1setOf with an empty name", () => {
    expect([...encodeAttr({ tag: VT.INTEGER, name: "copies", values: [3] })]).toEqual([0x21, 0, 6, ...Buffer.from("copies"), 0, 4, 0, 0, 0, 3])
    const multi = encodeAttr({ tag: VT.KEYWORD, name: "a", values: ["x", "yz"] })
    expect([...multi]).toEqual([0x44, 0, 1, 0x61, 0, 1, 0x78, 0x44, 0, 0, 0, 2, 0x79, 0x7a])
  })

  it("builds a Print-Job: header, operation group in order, job group, end tag, then the PDF", () => {
    const pdf = Buffer.from("%PDF-1.4 fake")
    const req = encodePrintJob({
      printerUri: "ipp://192.168.223.114:631/printers/Epson_L3250", userName: "Bagas Putro", jobName: "NEXUS - Memo",
      copies: 2, colorMode: "mono", pdf, requestId: 42,
    })
    expect([...req.subarray(0, 8)]).toEqual([2, 0, 0x00, 0x02, 0, 0, 0, 42])
    expect(req[8]).toBe(TAG.OPERATION)
    expect(req.subarray(req.length - pdf.length).equals(pdf)).toBe(true)
    expect(req[req.length - pdf.length - 1]).toBe(TAG.END)

    const msg = decodeMessage(req)
    expect(msg.code).toBe(IPP_OP.PRINT_JOB)
    expect(msg.requestId).toBe(42)
    const op = msg.groups[0]
    expect(op.tag).toBe(TAG.OPERATION)
    // charset and natural language must come first, in that order (RFC 8011 §4.1.4).
    expect(op.attrs.map((a) => a.name)).toEqual([
      "attributes-charset", "attributes-natural-language", "printer-uri", "requesting-user-name", "job-name", "document-format",
    ])
    expect(attrOf(msg, "requesting-user-name")).toBe("Bagas Putro")
    expect(attrOf(msg, "document-format")).toBe("application/pdf")
    expect(msg.groups[1].tag).toBe(TAG.JOB)
    expect(attrOf(msg, "copies")).toBe(2)
    expect(attrOf(msg, "print-color-mode")).toBe("monochrome")
    expect(msg.data?.equals(pdf)).toBe(true)
  })

  it("asks color as print-color-mode=color", () => {
    const msg = decodeMessage(encodePrintJob({ printerUri: "ipp://h/printers/p", userName: "u", jobName: "j", copies: 1, colorMode: "color", pdf: Buffer.from("%PDF-") }))
    expect(attrOf(msg, "print-color-mode")).toBe("color")
  })

  it("builds Get-Job-Attributes with the job id and the attributes it needs", () => {
    const msg = decodeMessage(encodeGetJobAttributes({ printerUri: "ipp://h:631/printers/p", userName: "nexus", jobId: 77, requestId: 5 }))
    expect(msg.code).toBe(IPP_OP.GET_JOB_ATTRIBUTES)
    expect(attrOf(msg, "job-id")).toBe(77)
    expect(attrValues(msg, "requested-attributes")).toContain("job-state")
    expect(msg.data).toBeUndefined()
  })

  it("clips names to 255 bytes on a character boundary and drops control characters", () => {
    const long = "é".repeat(200)
    const c = clip(long)
    expect(Buffer.byteLength(c)).toBeLessThanOrEqual(255)
    expect(c).toBe("é".repeat(127))
    expect(clip("a\nb\tc")).toBe("a b c")
  })
})

describe("IPP decoding", () => {
  it("reads a CUPS-like Print-Job response", () => {
    const res = encodeMessage({
      version: [2, 0], code: 0x0000, requestId: 1,
      groups: [
        { tag: TAG.OPERATION, attrs: [
          { tag: VT.CHARSET, name: "attributes-charset", values: ["utf-8"] },
          { tag: VT.NATURAL_LANGUAGE, name: "attributes-natural-language", values: ["en"] },
          { tag: VT.TEXT, name: "status-message", values: ["successful-ok"] },
        ] },
        { tag: TAG.JOB, attrs: [
          { tag: VT.URI, name: "job-uri", values: ["ipp://h:631/jobs/12"] },
          { tag: VT.INTEGER, name: "job-id", values: [12] },
          { tag: VT.ENUM, name: "job-state", values: [JOB_STATE.PENDING] },
          { tag: VT.KEYWORD, name: "job-state-reasons", values: ["none"] },
        ] },
      ],
    })
    const msg = decodeMessage(res)
    expect(isIppSuccess(msg.code)).toBe(true)
    expect(attrOf(msg, "job-id")).toBe(12)
    expect(attrOf(msg, "job-state")).toBe(3)
    expect(attrOf(msg, "status-message")).toBe("successful-ok")
  })

  it("treats client and server errors as failures and rejects a cut-off answer", () => {
    expect(isIppSuccess(0x0406)).toBe(false)
    expect(isIppSuccess(0x0500)).toBe(false)
    expect(isIppSuccess(0x0001)).toBe(true)
    const ok = encodeMessage({ version: [2, 0], code: 0, requestId: 1, groups: [{ tag: TAG.OPERATION, attrs: [{ tag: VT.TEXT, name: "status-message", values: ["hello"] }] }] })
    expect(() => decodeMessage(ok.subarray(0, ok.length - 4))).toThrow()
  })
})

describe("printer URL and config", () => {
  it("maps ipp:// to http on port 631 and keeps the ipp form for printer-uri", () => {
    expect(parsePrinterUrl("ipp://192.168.223.114:631/printers/Epson_L3250")).toEqual({
      http: "http://192.168.223.114:631/printers/Epson_L3250", printerUri: "ipp://192.168.223.114:631/printers/Epson_L3250", queue: "Epson_L3250",
    })
    expect(parsePrinterUrl("ipp://printer.local/printers/X")?.http).toBe("http://printer.local:631/printers/X")
    expect(parsePrinterUrl("ipps://h/ipp/print")?.http).toBe("https://h:631/ipp/print")
    expect(parsePrinterUrl("")).toBeNull()
    expect(parsePrinterUrl("ftp://h/x")).toBeNull()
    expect(parsePrinterUrl("not a url")).toBeNull()
  })

  it("is off without PRINT_IPP_URL and names the printer after its queue", () => {
    expect(printerConfig({})).toBeNull()
    expect(printingStatus({})).toMatchObject({ enabled: false, printerName: null })
    expect(printingStatus({ PRINT_IPP_URL: "ipp://192.168.223.114:631/printers/Epson_L3250" })).toMatchObject({ enabled: true, printerName: "Epson L3250", maxCopies: 5, maxPages: 50 })
    expect(printerConfig({ PRINT_IPP_URL: "ipp://h/printers/Q", PRINT_PRINTER_NAME: "Office" })?.name).toBe("Office")
  })
})

describe("PDF page count", () => {
  const pdfOf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`, "latin1")

  it("reads the root /Pages /Count, not an outline's /Count", () => {
    const pdf = pdfOf([
      "1 0 obj << /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 7 /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      "3 0 obj << /Type /Pages /Parent 2 0 R /Count 4 /Kids [] >> endobj",
      "9 0 obj << /Type /Outlines /Count 99 >> endobj",
    ].join("\n"))
    expect(countPdfPages(pdf)).toBe(7)
  })

  it("ignores binary content streams", () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 /Kids [] >> endobj\n5 0 obj << /Length 12 >> stream\n", "latin1"),
      Buffer.from("<</Count 900>>", "latin1"),
      Buffer.from("\nendstream endobj\n%%EOF", "latin1"),
    ])
    expect(countPdfPages(pdf)).toBe(2)
  })

  it("finds the page tree inside a compressed object stream", () => {
    const inner = Buffer.from("2 0 3 60 << /Type /Pages /Kids [3 0 R] /Count 3 >> << /Type /Page /Parent 2 0 R >>", "latin1")
    const z = deflateSync(inner)
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.7\n7 0 obj << /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, "latin1"),
      z,
      Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
    ])
    expect(countPdfPages(pdf)).toBe(3)
  })

  it("falls back to counting /Type /Page leaves, and refuses what is not a PDF", () => {
    expect(countPdfPages(pdfOf("3 0 obj << /Type /Page >> endobj 4 0 obj << /Type /Page >> endobj"))).toBe(2)
    expect(countPdfPages(Buffer.from("hello"))).toBeNull()
    expect(countPdfPages(pdfOf("nothing here"))).toBeNull()
  })
})
