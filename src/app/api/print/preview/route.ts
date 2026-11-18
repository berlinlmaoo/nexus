export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { PdfError } from "@/lib/legal/pdf"
import { isPrintKind } from "@/lib/print/access"
import { PRINT_NOT_CONFIGURED, printerConfig } from "@/lib/print/config"
import { PrintError, printAccess, renderPrintable } from "@/lib/print/service"

/**
 * GET /api/print/preview?kind=legal|doc|upload&id=…&version=… — the exact PDF a print of this item sends (owner,
 * 18 Nov 2026: "no page preview before printing"), for the dialog's page thumbnails. Same access rule as POST
 * /api/print (printAccess). A preview is not a print: no PrintJob row, no audit row, not counted in the hourly cap.
 *   200 application/pdf (inline, no-store) · 400 · 401 · 403 / 404 (incl. UPLOAD_GONE) · 422 NOT_PRINTABLE
 *   502 CONVERSION_FAILED · 503 PRINT_NOT_CONFIGURED / PDF_NOT_CONFIGURED   — errors as JSON { error, code }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!printerConfig()) return NextResponse.json({ error: PRINT_NOT_CONFIGURED, code: "PRINT_NOT_CONFIGURED" }, { status: 503 })
    const sp = req.nextUrl.searchParams
    const kind = sp.get("kind")
    const id = sp.get("id") ?? ""
    if (!isPrintKind(kind)) return NextResponse.json({ error: "kind must be \"legal\", \"doc\" or \"upload\"" }, { status: 400 })
    if (!id || id.length > 64) return NextResponse.json({ error: "id is required" }, { status: 400 })
    let version: number | null = null
    if (sp.get("version")) {
      version = Number(sp.get("version"))
      if (kind !== "legal" || !Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Not a valid version" }, { status: 400 })
    }
    const verdict = await printAccess(session.user.id, kind, id)
    if (!verdict.ok) return NextResponse.json({ error: verdict.error, ...(verdict.code ? { code: verdict.code } : {}) }, { status: verdict.status })
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } })
    const lang = (req.headers.get("accept-language") ?? "").trim().toLowerCase() === "id" ? "id" : "en"
    const { pdf } = await renderPrintable(kind, id, { userId: session.user.id, userName: user?.name ?? "", version, lang })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"preview.pdf\"",
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof PrintError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    if (error instanceof PdfError) return NextResponse.json({ error: "This file couldn't be converted for printing. Try saving it as PDF first.", code: "CONVERSION_FAILED" }, { status: 502 })
    console.error("Error making a print preview:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
