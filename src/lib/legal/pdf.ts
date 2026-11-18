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

/**
 * HTML → PDF through the same sidecar's Chromium route (print to the office printer, 18 Nov 2026: a Doc page). The
 * page sets its own A4 size and margins in CSS (@page), so preferCssPageSize is on; it must name no outside
 * resource (lib/print/doc-html.ts), since Chromium would fetch it from inside the server network.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  if (!GOTENBERG_URL) throw new PdfError("PDF conversion is not set up on this server (GOTENBERG_URL)")
  const form = new FormData()
  form.append("files", new Blob([html], { type: "text/html" }), "index.html")
  form.append("paperWidth", "8.27")
  form.append("paperHeight", "11.7")
  form.append("preferCssPageSize", "true")
  form.append("printBackground", "true")
  let res: Response
  try {
    res = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) })
  } catch (error) {
    throw new PdfError(`PDF service unreachable: ${(error as Error).message}`)
  }
  if (!res.ok) throw new PdfError(`PDF conversion failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`)
  const pdf = Buffer.from(await res.arrayBuffer())
  if (!looksLikePdf(pdf)) throw new PdfError("PDF service returned something that is not a PDF")
  return pdf
}

/**
 * Any office file → PDF through the sidecar's LibreOffice route (print an uploaded file, 18 Nov 2026): Word, Excel,
 * PowerPoint. LibreOffice picks the importer from the extension, so `fileName` must keep the real one (".xlsx").
 */
export async function officeToPdf(bytes: Buffer, fileName: string, mimeType = "application/octet-stream"): Promise<Buffer> {
  if (!GOTENBERG_URL) throw new PdfError("PDF conversion is not set up on this server (GOTENBERG_URL)")
  const form = new FormData()
  form.append("files", new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
  let res: Response
  try {
    res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) })
  } catch (error) {
    throw new PdfError(`PDF service unreachable: ${(error as Error).message}`)
  }
  if (!res.ok) throw new PdfError(`PDF conversion failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`)
  const pdf = Buffer.from(await res.arrayBuffer())
  if (!looksLikePdf(pdf)) throw new PdfError("PDF service returned something that is not a PDF")
  return pdf
}
