export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { isPrintKind } from "@/lib/print/access"
import { PRINT_LIMITS, PRINT_NOT_CONFIGURED, printerConfig } from "@/lib/print/config"
import { PrintError, printAccess, serializeJob, submitPrint } from "@/lib/print/service"

/**
 * POST /api/print — print a Legal document or a Doc page on the office printer (owner, 18 Nov 2026).
 *   body { kind: "legal" | "doc", id, copies 1–5, colorMode: "color" | "mono", version?: number (legal only) }
 *   201 { job }   job.status "printing" (sent; GET /api/print/jobs/{id} follows it to "done") or "failed" (job.error)
 *   400 bad body · 401 · 403 / 404 the item's own access rule · 422 TOO_MANY_PAGES / NOT_PRINTABLE / PAGES_UNKNOWN
 *   429 PRINT_RATE_LIMIT (20 an hour) · 503 PRINT_NOT_CONFIGURED (no PRINT_IPP_URL on this server)
 * Who may print = who may open the item (lib/print/access.ts). Every job is logged (PrintJob + AuditLog "print").
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!printerConfig()) return NextResponse.json({ error: PRINT_NOT_CONFIGURED, code: "PRINT_NOT_CONFIGURED" }, { status: 503 })

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const { kind, id } = body
    if (!isPrintKind(kind)) return NextResponse.json({ error: "kind must be \"legal\" or \"doc\"" }, { status: 400 })
    if (typeof id !== "string" || !id || id.length > 64) return NextResponse.json({ error: "id is required" }, { status: 400 })
    const copies = body.copies === undefined ? 1 : Number(body.copies)
    if (!Number.isInteger(copies) || copies < 1 || copies > PRINT_LIMITS.maxCopies) {
      return NextResponse.json({ error: `Copies must be between 1 and ${PRINT_LIMITS.maxCopies}`, code: "BAD_COPIES" }, { status: 400 })
    }
    const colorMode = body.colorMode === undefined ? "mono" : body.colorMode
    if (colorMode !== "color" && colorMode !== "mono") return NextResponse.json({ error: "colorMode must be \"color\" or \"mono\"" }, { status: 400 })
    let version: number | null = null
    if (body.version !== undefined && body.version !== null) {
      version = Number(body.version)
      if (kind !== "legal" || !Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Not a valid version" }, { status: 400 })
    }

    const verdict = await printAccess(session.user.id, kind, id)
    if (!verdict.ok) return NextResponse.json({ error: verdict.error, ...(verdict.code ? { code: verdict.code } : {}) }, { status: verdict.status })

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true } })
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const lang = (req.headers.get("accept-language") ?? "").trim().toLowerCase() === "id" ? "id" : "en"
    const job = await submitPrint({ user, kind, refId: id, copies, colorMode, version, lang, request: req })
    return NextResponse.json({ job: serializeJob(job) }, { status: 201 })
  } catch (error) {
    if (error instanceof PrintError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    console.error("Error printing:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
