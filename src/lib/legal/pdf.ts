import { DOCX_MIME, looksLikePdf } from "@/lib/legal/storage"

// DOCX → PDF through a Gotenberg sidecar (MIT; LibreOffice headless behind an HTTP API — owner, 14 Oct 2026).
// The app image stays node:alpine; GOTENBERG_URL points at the sidecar on the internal network, e.g.
// http://nexus-gotenberg:3000. Unset = no PDFs: documents are still made as DOCX and the PDF can be made
// later from the document screen.

export const GOTENBERG_URL = process.env.GOTENBERG_URL?.trim().replace(/\/+$/, "") || ""

export const pdfConfigured = () => !!GOTENBERG_URL

export class PdfError extends Error {}

export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  if (!GOTENBERG_URL) throw new PdfError("PDF conversion is not set up on this server (GOTENBERG_URL)")
  const form = new FormData()
  form.append("files", new Blob([new Uint8Array(docx)], { type: DOCX_MIME }), "document.docx")
  let res: Response
  try {
    res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) })
  } catch (error) {
    throw new PdfError(`PDF service unreachable: ${(error as Error).message}`)
  }
  if (!res.ok) throw new PdfError(`PDF conversion failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`)
  const pdf = Buffer.from(await res.arrayBuffer())
  if (!looksLikePdf(pdf)) throw new PdfError("PDF service returned something that is not a PDF")
  return pdf
}
