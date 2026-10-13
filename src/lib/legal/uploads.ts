import PizZip from "pizzip"
import { DOCX_MAX_UNZIPPED_BYTES, zipUnpackedSize, DOCX_MIME, LEGAL_MAX_UPLOAD_BYTES, looksLikePdf, looksLikeZip, PDF_MIME, safeFileName, storeLegalFile } from "@/lib/legal/storage"

// A file someone uploads into the archive: a signed contract (PDF scan), a Word file, or a photo of a
// signed page. The type is decided from the bytes, never from the name or the browser's word.

export class LegalUploadError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

/** A zip named .docx is not yet a Word file: it needs word/document.xml, at a size we're willing to unpack. */
function isWordFile(bytes: Buffer): boolean {
  try {
    const zip = new PizZip(bytes)
    return zipUnpackedSize(zip) <= DOCX_MAX_UNZIPPED_BYTES && !!zip.file("word/document.xml")
  } catch {
    return false
  }
}

export type StoredUpload = { docxKey: string | null; pdfKey: string | null; fileKey: string | null; fileName: string; mimeType: string; size: number; docx: Buffer | null }

export async function storeUpload(file: FormDataEntryValue | null): Promise<StoredUpload> {
  if (!file || typeof file === "string") throw new LegalUploadError("Choose a file", 400)
  if (file.size > LEGAL_MAX_UPLOAD_BYTES) throw new LegalUploadError("The file is larger than 50 MB", 413)
  const bytes = Buffer.from(await file.arrayBuffer())
  const fileName = safeFileName(file.name || "document", "document")
  if (looksLikePdf(bytes)) {
    const key = await storeLegalFile(fileName, bytes)
    return { docxKey: null, pdfKey: key, fileKey: null, fileName, mimeType: PDF_MIME, size: bytes.length, docx: null }
  }
  if (looksLikeZip(bytes) && /\.docx$/i.test(fileName)) {
    if (!isWordFile(bytes)) throw new LegalUploadError("This .docx is not a Word file Legal can read", 415)
    const key = await storeLegalFile(fileName, bytes)
    return { docxKey: key, pdfKey: null, fileKey: null, fileName, mimeType: DOCX_MIME, size: bytes.length, docx: bytes }
  }
  if (isJpeg(bytes) || isPng(bytes)) {
    const key = await storeLegalFile(fileName, bytes)
    return { docxKey: null, pdfKey: null, fileKey: key, fileName, mimeType: isPng(bytes) ? "image/png" : "image/jpeg", size: bytes.length, docx: null }
  }
  throw new LegalUploadError("Upload a PDF, a Word (.docx) file or a photo (JPG/PNG)", 415)
}

/** Room for the multipart framing and the text fields around the file. */
const FORM_OVERHEAD_BYTES = 1024 * 1024

/**
 * A multipart body, read with a byte budget. `request.formData()` buffers the whole body before any size
 * check can run, and the proxy in front accepts up to 1 GB (it serves chunked attachment uploads), so a
 * large upload would sit in memory in full only to be refused afterwards. This stops reading as soon as
 * the body is over `maxFileBytes` (plus the form's own overhead). Null = not a readable form.
 */
export async function readLegalForm(request: Request, maxFileBytes: number): Promise<FormData | null> {
  const limit = maxFileBytes + FORM_OVERHEAD_BYTES
  const tooLarge = () => new LegalUploadError(`The file is larger than ${Math.round(maxFileBytes / (1024 * 1024))} MB`, 413)
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) throw tooLarge()
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) return null
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData()
  } catch {
    return null
  }
}
