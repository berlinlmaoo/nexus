export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { createLegalRequest, LegalRequestError, linkByUrlId, requestForm, type RequestInput } from "@/lib/legal/requests"
import { tokenFromLinkId } from "@/lib/legal/request-rules"
import { LegalUploadError, readLegalForm } from "@/lib/legal/uploads"

type Ctx = { params: Promise<{ linkId: string }> }

/** All attachments of one request together (each one is also held to the Legal 50 MB per file). */
const MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024

const unknownLink = () => NextResponse.json({ error: "This link doesn't work any more. Ask Legal for the current one.", code: "LEGAL_LINK_UNKNOWN" }, { status: 404 })

/**
 * The Legal request form behind a link (/f/legal-<token>), owner 14 Oct 2026. Anyone may open the link; the
 * form itself (document types and their fields) is only for someone signed in to NEXUS. A regenerated token
 * answers 404 LEGAL_LINK_UNKNOWN; a closed link `accepting: false`.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { linkId } = await params
    const token = tokenFromLinkId(linkId)
    if (!token) return unknownLink()
    const link = await linkByUrlId(token)
    if (!link) return unknownLink()
    const session = await auth().catch(() => null)
    const signedIn = !!session?.user?.id
    const accepting = link.accepting && (!link.company || link.company.active)
    const head = {
      link: { company: link.company ? { id: link.company.id, name: link.company.name } : null, accepting },
      signedIn,
    }
    if (!signedIn || !accepting) return NextResponse.json(head)
    return NextResponse.json({ ...head, ...(await requestForm(link)) })
  } catch (error) {
    console.error("Error opening a Legal request link:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Send a request: JSON `{ templateId, companyId?, values, purpose?, deadline?, projectId?, dealId?, parentNumber? }`,
 * or multipart with that JSON in `data` and up to five `file` parts. `Idempotency-Key` makes a retry safe.
 * 201 `{ ok: true, id }` — the same answer for an addendum whatever parent number was typed.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in to NEXUS to send this request.", code: "LOGIN_REQUIRED" }, { status: 401 })
    const { linkId } = await params
    const token = tokenFromLinkId(linkId)
    if (!token) return unknownLink()
    const link = await linkByUrlId(token)
    if (!link) return unknownLink()
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, deactivatedAt: true } })
    if (!user || user.deactivatedAt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let input: RequestInput | null = null
    const files: File[] = []
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await readLegalForm(request, MAX_REQUEST_BODY_BYTES)
      if (!form) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
      try {
        input = JSON.parse(String(form.get("data") ?? "{}"))
      } catch {
        input = null
      }
      for (const f of form.getAll("file")) if (typeof f !== "string" && f.size > 0) files.push(f)
    } else {
      input = await request.json().catch(() => null)
    }
    if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    const key = request.headers.get("idempotency-key")?.trim().slice(0, 100) || null

    const made = await createLegalRequest({ id: user.id, name: user.name }, link, input, files, key)
    if (!made.duplicate) {
      await logAudit({
        action: "create",
        entityType: "legal_request",
        entityId: made.id,
        entityName: "Legal request",
        userId: user.id,
        metadata: { linkScope: link.scope, templateId: typeof input.templateId === "string" ? input.templateId : null },
        request,
      })
    }
    return NextResponse.json({ ok: true, id: made.id }, { status: made.duplicate ? 200 : 201 })
  } catch (error) {
    if (error instanceof LegalRequestError) {
      return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}), fieldErrors: error.fieldErrors }, { status: error.status })
    }
    if (error instanceof LegalUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Error sending a Legal request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
