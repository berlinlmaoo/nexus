export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { getVaultActor, canReadItem, storagePath } from "@/lib/vault"

// GET /api/vault/items/<id>/raw[?download=1]
//
// The signed-in way to read a vault file. The client names an ITEM; the path is resolved here and
// never travels in either direction. `?download=1` is a flag, not a filename — the real name comes
// out of the row, so a download always saves as "Company Deck.pdf" and never as a uuid.
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

    const wantsDownload = request.nextUrl.searchParams.has("download")
    return serveFile(request, storagePath(item.storageKey), {
      filename: item.name,
      forceDownload: wantsDownload,
    })
  } catch (error) {
    console.error("[vault] raw failed:", error)
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 })
  }
}
