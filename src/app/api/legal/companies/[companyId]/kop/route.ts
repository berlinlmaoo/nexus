export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { serveFile } from "@/lib/file-response"
import { legalGate, settingsForbidden } from "@/lib/legal/access"
import { companyInclude, serializeCompany } from "@/lib/legal/companies"
import { checkKop, KopError } from "@/lib/legal/kop"
import {
  deleteLegalFile, DOCX_MIME, LEGAL_MAX_TEMPLATE_BYTES, legalStoragePath, looksLikeZip, safeFileName, storeLegalFile,
} from "@/lib/legal/storage"

type Ctx = { params: Promise<{ companyId: string }> }

/** Download the company's kop .docx. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const { companyId } = await params
    const c = await prisma.legalCompany.findUnique({ where: { id: companyId }, select: { kopStorageKey: true, kopFileName: true } })
    if (!c?.kopStorageKey) return NextResponse.json({ error: "No kop uploaded" }, { status: 404 })
    return serveFile(request, legalStoragePath(c.kopStorageKey), { filename: c.kopFileName ?? "kop.docx", mimeType: DOCX_MIME, forceDownload: true })
  } catch (error) {
    console.error("Error downloading a Legal kop:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Upload (replace) the kop: a .docx whose page header is the letterhead. Documents already made keep theirs. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const gate = await legalGate()
    if (!gate.ok) return gate.response
    const forbidden = settingsForbidden(gate.actor)
    if (forbidden) return forbidden
    const { companyId } = await params
    const company = await prisma.legalCompany.findUnique({ where: { id: companyId } })
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    const form = await request.formData().catch(() => null)
    const file = form?.get("file")
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a .docx file" }, { status: 400 })
    if (file.size > LEGAL_MAX_TEMPLATE_BYTES) return NextResponse.json({ error: "The kop is larger than 20 MB" }, { status: 413 })
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!looksLikeZip(bytes)) return NextResponse.json({ error: "The kop must be a Word (.docx) file" }, { status: 415 })
    try {
      checkKop(bytes)
    } catch (error) {
      if (error instanceof KopError) return NextResponse.json({ error: error.message }, { status: 422 })
      throw error
    }
    const fileName = safeFileName(file.name || "kop.docx", "kop.docx")
    const key = await storeLegalFile(fileName, bytes)
    const updated = await prisma.legalCompany.update({
      where: { id: companyId },
      data: { kopStorageKey: key, kopFileName: fileName, kopUpdatedAt: new Date() },
      include: companyInclude,
    })
    await deleteLegalFile(company.kopStorageKey)
    await logAudit({ action: "upload", entityType: "legal_company", entityId: companyId, entityName: `${updated.name} kop`, userId: gate.actor.userId, request })
    return NextResponse.json({ company: serializeCompany(updated) })
  } catch (error) {
    console.error("Error uploading a Legal kop:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
