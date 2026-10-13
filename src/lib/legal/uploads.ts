import { DOCX_MIME, LEGAL_MAX_UPLOAD_BYTES, looksLikePdf, looksLikeZip, PDF_MIME, safeFileName, storeLegalFile } from "@/lib/legal/storage"

// A file someone uploads into the archive: a signed contract (PDF scan), a Word file, or a photo of a
// signed page. The type is decided from the bytes, never from the name or the browser's word.

export class LegalUploadError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

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
    const key = await storeLegalFile(fileName, bytes)
    return { docxKey: key, pdfKey: null, fileKey: null, fileName, mimeType: DOCX_MIME, size: bytes.length, docx: bytes }
  }
  if (isJpeg(bytes) || isPng(bytes)) {
    const key = await storeLegalFile(fileName, bytes)
    return { docxKey: null, pdfKey: null, fileKey: key, fileName, mimeType: isPng(bytes) ? "image/png" : "image/jpeg", size: bytes.length, docx: null }
  }
  throw new LegalUploadError("Upload a PDF, a Word (.docx) file or a photo (JPG/PNG)", 415)
}
