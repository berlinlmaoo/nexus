export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getVaultActor, canReadItem, canModifyItem } from "@/lib/vault"
import { serializeShare } from "@/lib/vault-share"

// DELETE /api/vault/shares/<id> — revoke.
//
// Sets `revokedAt` rather than deleting the row, so the link's history (who made it, how often it
// was opened) survives the decision to switch it off. Effect is immediate: every public read
// re-resolves the row, so there is no window where an already-sent link still works.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { shareId } = await params
    const share = await prisma.vaultShare.findFirst({
      where: { id: shareId, item: { workspaceId: actor.workspaceId } },
      select: {
        id: true,
        createdById: true,
        revokedAt: true,
        item: { select: { id: true, name: true, uploaderId: true, ownerId: true } },
      },
    })
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, share.item.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    // Whoever made the link may pull it back; so may whoever owns the file, and BoD.
    if (share.createdById !== actor.userId && !canModifyItem(actor, share.item)) {
      return NextResponse.json({ error: "Tidak bisa mencabut tautan orang lain" }, { status: 403 })
    }

    const updated = await prisma.vaultShare.update({
      where: { id: share.id },
      data: { revokedAt: share.revokedAt ?? new Date() },
      include: { createdBy: { select: { id: true, name: true } } },
    })

    logAudit({
      action: "delete",
      entityType: "vault_share",
      entityId: share.id,
      entityName: share.item.name,
      userId: actor.userId,
      request,
      metadata: { itemId: share.item.id },
    }).catch(() => {})

    return NextResponse.json(serializeShare(updated))
  } catch (error) {
    console.error("[vault] revoke share failed:", error)
    return NextResponse.json({ error: "Failed to revoke share" }, { status: 500 })
  }
}
