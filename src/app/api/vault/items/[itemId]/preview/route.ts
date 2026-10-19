export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { getVaultActor, canReadItem } from "@/lib/vault"
import { vaultOfficePreview } from "@/lib/vault-preview"

// GET /api/vault/items/<id>/preview[?v=<content version>]
//
// An office file (docx/xlsx/pptx/odt/rtf…) as a PDF the browser can show (UI round 19 Oct 2026, U-5).
// Same access rule as /raw. Web only: the iPhone app previews with Quick Look and Android with the
// system viewer. 415 = no preview for this type, 501 = no converter on this server, 413 = too big.
export async function GET(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId, kind: "FILE", deletedAt: null },
      select: { id: true, name: true, storageKey: true },
    })
    if (!item?.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const preview = await vaultOfficePreview(item)
    if (!preview.ok) return NextResponse.json({ error: preview.error }, { status: preview.status })
    return serveFile(request, preview.path, { filename: preview.filename, contentType: "application/pdf", forceInline: true })
  } catch (error) {
    console.error("[vault] preview failed:", error)
    return NextResponse.json({ error: "Failed to preview" }, { status: 500 })
  }
}
