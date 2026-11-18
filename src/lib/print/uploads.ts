import { rmSync } from "node:fs"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { htmlToPdf, officeToPdf, pdfConfigured } from "@/lib/legal/pdf"
import { looksLikePdf } from "@/lib/legal/storage"
import { sniffImageType } from "@/lib/image-sniff"
import { uuidv7 } from "@/lib/uuid7"
import { countPdfPages } from "@/lib/print/pdf-pages"
import { escapeHtml } from "@/lib/print/doc-html"

/**
 * Print an uploaded file (owner, 18 Nov 2026: a "Print" menu where anyone signed in sends any file to the office
 * printer). The file is converted to PDF in memory (Word / Excel / PowerPoint through Gotenberg's LibreOffice route,
 * JPG / PNG on one A4 page through its Chromium route) and ONLY the PDF is kept, in a private temp folder of the app
 * container — never in Drive, attachments or the uploads volume. It is deleted as soon as its print job is done or
 * failed, when the person cancels, and in any case one hour after the upload (the sweep below). The print log
 * keeps the file name, pages, who and when; nothing of the content.
 */

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const UPLOAD_TTL_MS = 60 * 60_000
const DIR = process.env.NEXUS_PRINT_TMP_DIR?.trim() || path.join(os.tmpdir(), "nexus-print")
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class PrintUploadError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message)
  }
}

export type PrintUploadMeta = { id: string; userId: string; fileName: string; pages: number; size: number; createdAt: string }

type Kind = "pdf" | "office" | "image"
const OFFICE_EXT = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"])
const IMAGE_EXT = new Set(["jpg", "jpeg", "png"])
const ZIP = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const OLE = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))

/** What the file is, from its extension AND its first bytes (a renamed file is refused, not guessed). */
export function classifyUpload(fileName: string, bytes: Buffer): { kind: Kind; ext: string } {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1] ?? "").toLowerCase()
  if (ext === "heic" || ext === "heif") {
    throw new PrintUploadError("HEIC photos can't be printed. Save the photo as JPG or PNG first.", 415, "UNSUPPORTED_TYPE")
  }
  if (ext === "pdf" && looksLikePdf(bytes)) return { kind: "pdf", ext }
  if (OFFICE_EXT.has(ext) && (ext.endsWith("x") ? ZIP(bytes) : OLE(bytes))) return { kind: "office", ext }
  if (IMAGE_EXT.has(ext)) {
    const t = sniffImageType(bytes.subarray(0, 16))
    if ((t === "image/jpeg" && ext !== "png") || (t === "image/png" && ext === "png")) return { kind: "image", ext }
  }
  if (!ext || ![...OFFICE_EXT, ...IMAGE_EXT, "pdf"].includes(ext)) {
    throw new PrintUploadError("This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG.", 415, "UNSUPPORTED_TYPE")
  }
  throw new PrintUploadError("The file doesn't match its name (it may be damaged or renamed).", 415, "UNSUPPORTED_TYPE")
}

/** One picture on one A4 page, as large as fits. The image is inlined (data URI): Chromium fetches nothing. */
export function imagePageHtml(bytes: Buffer, mime: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4; margin: 10mm; }
html, body { margin: 0; padding: 0; }
.page { width: 190mm; height: 276mm; display: flex; align-items: center; justify-content: center; overflow: hidden; }
img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body><div class="page"><img alt="" src="data:${mime};base64,${bytes.toString("base64")}"></div></body></html>`
}

async function toPdf(fileName: string, bytes: Buffer): Promise<Buffer> {
  const { kind, ext } = classifyUpload(fileName, bytes)
  if (kind === "pdf") return bytes
  if (!pdfConfigured()) throw new PrintUploadError("PDF conversion isn't set up on this server", 503, "PDF_NOT_CONFIGURED")
  if (kind === "office") return officeToPdf(bytes, `document.${ext}`)
  return htmlToPdf(imagePageHtml(bytes, ext === "png" ? "image/png" : "image/jpeg", fileName))
}

const pdfPath = (id: string) => path.join(DIR, `${id}.pdf`)
const metaPath = (id: string) => path.join(DIR, `${id}.json`)

export function cleanFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  return (base || "file").slice(0, 200)
}

/** Convert, count, keep the PDF for at most an hour. */
export async function createPrintUpload(userId: string, fileName: string, bytes: Buffer): Promise<PrintUploadMeta> {
  startSweeper()
  if (bytes.length === 0) throw new PrintUploadError("The file is empty", 400, "EMPTY")
  if (bytes.length > UPLOAD_MAX_BYTES) throw new PrintUploadError("The file is larger than 25 MB", 413, "TOO_LARGE")
  const name = cleanFileName(fileName)
  const pdf = await toPdf(name, bytes)
  const pages = countPdfPages(pdf)
  if (!pages) throw new PrintUploadError("Couldn't read the number of pages of this file", 422, "PAGES_UNKNOWN")
  const meta: PrintUploadMeta = { id: uuidv7(), userId, fileName: name, pages, size: bytes.length, createdAt: new Date().toISOString() }
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  await writeFile(pdfPath(meta.id), pdf, { mode: 0o600 })
  await writeFile(metaPath(meta.id), JSON.stringify(meta), { mode: 0o600 })
  return meta
}

/** The upload, when it exists, is not expired and belongs to `userId` (anyone else's reads as missing). */
export async function getPrintUpload(id: string, userId: string): Promise<{ meta: PrintUploadMeta; pdf: () => Promise<Buffer> } | null> {
  if (!ID.test(id)) return null
  const meta = await readFile(metaPath(id), "utf8").then((s) => JSON.parse(s) as PrintUploadMeta, () => null)
  if (!meta || meta.userId !== userId) return null
  if (Date.now() - Date.parse(meta.createdAt) > UPLOAD_TTL_MS) {
    await removePrintUpload(id)
    return null
  }
  return { meta, pdf: () => readFile(pdfPath(id)) }
}

export async function removePrintUpload(id: string): Promise<void> {
  if (!ID.test(id)) return
  await Promise.all([rm(pdfPath(id), { force: true }), rm(metaPath(id), { force: true })])
}

/** Delete every upload older than the TTL (and any stray file in the folder). */
export async function sweepPrintUploads(now = Date.now()): Promise<number> {
  const names = await readdir(DIR).catch(() => [] as string[])
  let removed = 0
  for (const n of names) {
    const st = await stat(path.join(DIR, n)).catch(() => null)
    if (st && now - st.mtimeMs > UPLOAD_TTL_MS) {
      await rm(path.join(DIR, n), { force: true })
      removed++
    }
  }
  return removed
}

let sweeper: ReturnType<typeof setInterval> | null = null
/**
 * Every 5 minutes in this process (instrumentation.ts starts it at boot in every blue-green slot: each slot has its
 * own temp folder); also sweeps right away. When the process ends (a slot stopped after a deploy) the whole folder
 * goes with it, so nothing waits inside a stopped container.
 */
export function startSweeper() {
  void sweepPrintUploads()
  if (sweeper) return
  sweeper = setInterval(() => void sweepPrintUploads(), 5 * 60_000)
  sweeper.unref?.()
  process.once("exit", () => {
    try { rmSync(DIR, { recursive: true, force: true }) } catch { /* nothing to clean */ }
  })
}
