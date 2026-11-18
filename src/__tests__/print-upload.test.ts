// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parsePageRanges } from "@/lib/print/page-ranges"
import { classifyUpload, cleanFileName, imagePageHtml } from "@/lib/print/uploads"
import { attrValues, decodeMessage, encodePrintJob } from "@/lib/print/ipp"

// Print an uploaded file (owner, 18 Nov 2026): which files are taken, the page-range field, and page-ranges on the wire.

const PDF = Buffer.from("%PDF-1.7\n")
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0])
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

describe("accepted files", () => {
  it("takes PDF, Office (new and old) and JPG/PNG when the bytes match the name", () => {
    expect(classifyUpload("a.pdf", PDF).kind).toBe("pdf")
    for (const n of ["a.docx", "a.xlsx", "a.pptx"]) expect(classifyUpload(n, ZIP).kind).toBe("office")
    for (const n of ["a.doc", "a.xls", "a.ppt"]) expect(classifyUpload(n, OLE).kind).toBe("office")
    expect(classifyUpload("photo.JPG", JPG)).toEqual({ kind: "image", ext: "jpg" })
    expect(classifyUpload("scan.png", PNG).kind).toBe("image")
  })

  it("refuses HEIC, other types and renamed files with a clear reason", () => {
    expect(() => classifyUpload("IMG_1.HEIC", JPG)).toThrow(/HEIC/)
    expect(() => classifyUpload("run.exe", ZIP)).toThrow(/can't be printed/)
    expect(() => classifyUpload("noext", PDF)).toThrow(/can't be printed/)
    expect(() => classifyUpload("fake.pdf", ZIP)).toThrow(/doesn't match/)
    expect(() => classifyUpload("fake.docx", OLE)).toThrow(/doesn't match/)
    expect(() => classifyUpload("fake.png", JPG)).toThrow(/doesn't match/)
  })

  it("keeps only the base name", () => {
    expect(cleanFileName("C:\\Users\\x\\Laporan Q3.xlsx")).toBe("Laporan Q3.xlsx")
    expect(cleanFileName("../../etc/passwd")).toBe("passwd")
    expect(cleanFileName("")).toBe("file")
  })

  it("puts an image on one A4 page without any outside URL", () => {
    const html = imagePageHtml(JPG, "image/jpeg", "<b>x</b>.jpg")
    expect(html).toContain("size: A4")
    expect(html).toContain("src=\"data:image/jpeg;base64,")
    expect(html).not.toMatch(/src="http|url\(/)
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.jpg")
  })
})

describe("page ranges", () => {
  it("empty means every page", () => {
    expect(parsePageRanges("", 7)).toEqual({ ok: true, ranges: [[1, 7]], count: 7, all: true })
    expect(parsePageRanges(null, 1)).toMatchObject({ ok: true, count: 1, all: true })
  })
  it("reads '1-3,5', sorts and merges", () => {
    expect(parsePageRanges("1-3,5", 10)).toEqual({ ok: true, ranges: [[1, 3], [5, 5]], count: 4, all: false })
    expect(parsePageRanges(" 5, 1-3 ,2-4", 10)).toEqual({ ok: true, ranges: [[1, 5]], count: 5, all: false })
    expect(parsePageRanges("1-2,3", 3)).toMatchObject({ ok: true, ranges: [[1, 3]], all: true })
  })
  it("refuses nonsense and pages past the end", () => {
    for (const bad of ["abc", "3-1", "0", "1--2", "-2", "1,,2", "1-2-3"]) expect(parsePageRanges(bad, 10)).toMatchObject({ ok: false, code: "BAD_RANGE" })
    expect(parsePageRanges("4-12", 10)).toMatchObject({ ok: false, code: "OUT_OF_RANGE" })
  })
  it("sends them as IPP page-ranges (rangeOfInteger, 1setOf)", () => {
    const req = encodePrintJob({ printerUri: "ipp://h/printers/p", userName: "u", jobName: "j", copies: 1, colorMode: "mono", pdf: PDF, pageRanges: [[1, 3], [5, 5]] })
    expect(attrValues(decodeMessage(req), "page-ranges")).toEqual([[1, 3], [5, 5]])
    const none = encodePrintJob({ printerUri: "ipp://h/printers/p", userName: "u", jobName: "j", copies: 1, colorMode: "mono", pdf: PDF })
    expect(attrValues(decodeMessage(none), "page-ranges")).toEqual([])
  })
})
