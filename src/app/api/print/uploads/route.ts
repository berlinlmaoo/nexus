export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isOrgMember } from "@/lib/org"
import { LegalUploadError, readLegalForm } from "@/lib/legal/uploads"
import { PdfError } from "@/lib/legal/pdf"
import { PRINT_NOT_CONFIGURED, printerConfig } from "@/lib/print/config"
import { PrintUploadError, UPLOAD_MAX_BYTES, createPrintUpload } from "@/lib/print/uploads"

/**
 * POST /api/print/uploads — multipart `file`: a file to print from the Print menu (owner, 18 Nov 2026). PDF, Word,
 * Excel, PowerPoint, JPG or PNG, at most 25 MB. The server converts it to PDF and counts its pages; the PDF waits
 * (privately, at most 1 hour) for POST /api/print { kind: "upload", id }.
 *   201 { upload: { id, fileName, pages, size, createdAt, expiresAt } }
 *   400 no file / EMPTY · 403 NOT_A_MEMBER · 413 TOO_LARGE · 415 UNSUPPORTED_TYPE (HEIC included) · 422 PAGES_UNKNOWN
 *   502 CONVERSION_FAILED · 503 PRINT_NOT_CONFIGURED / PDF_NOT_CONFIGURED
 * DELETE /api/print/uploads/{id} removes it (Cancel).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!printerConfig()) return NextResponse.json({ error: PRINT_NOT_CONFIGURED, code: "PRINT_NOT_CONFIGURED" }, { status: 503 })
    if (!(await isOrgMember(session.user.id))) {
      return NextResponse.json({ error: "Printing is for members of the company workspace", code: "NOT_A_MEMBER" }, { status: 403 })
    }
    const form = await readLegalForm(req, UPLOAD_MAX_BYTES).catch((e) => {
      if (e instanceof LegalUploadError) throw new PrintUploadError("The file is larger than 25 MB", 413, "TOO_LARGE")
      throw e
    })
    const file = form?.get("file")
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a file", code: "NO_FILE" }, { status: 400 })
    const meta = await createPrintUpload(session.user.id, file.name, Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({
      upload: { id: meta.id, fileName: meta.fileName, pages: meta.pages, size: meta.size, createdAt: meta.createdAt, expiresAt: new Date(Date.parse(meta.createdAt) + 3_600_000).toISOString() },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof PrintUploadError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    if (error instanceof PdfError) {
      console.warn("Print upload conversion failed:", error.message)
      return NextResponse.json({ error: "This file couldn't be converted for printing. Try saving it as PDF first.", code: "CONVERSION_FAILED" }, { status: 502 })
    }
    console.error("Error uploading a file to print:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
