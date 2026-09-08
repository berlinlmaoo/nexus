export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getVaultActor, canModifyItem, deleteStoredFile, isBodPlus } from "@/lib/vault"

// POST /api/vault/trash/empty — permanently destroy trashed items.
//
// The one operation in Z Vault with no undo, and the one that has to actually reach the disk. A
// trash that only hides rows leaves the quota measuring something unrelated to the disk it exists
// to protect, and the vault fills up while the UI insists it is half empty.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const trashed = await prisma.vaultItem.findMany({
      where: { workspaceId: actor.workspaceId, deletedAt: { not: null } },
      select: { id: true, name: true, kind: true, storageKey: true, uploaderId: true, ownerId: true },
    })

    // Everyone empties their own trash; BoD empties all of it. Without this split, one person
    // clearing space would destroy work belonging to 45 others who never agreed to it.
    const mine = trashed.filter((t) => canModifyItem(actor, t))
    if (mine.length === 0) {
      return NextResponse.json({ purged: 0, filesUnlinked: 0, bytesFreed: 0 })
    }

    // Delete the rows first. If unlinking then fails halfway, what remains is an orphan file on disk
    // — wasteful but harmless. The reverse order would leave rows pointing at files that are gone,
    // which is a download that 500s and a quota that overstates. Prefer the harmless failure.
    const ids = mine.map((t) => t.id)
    await prisma.vaultItem.deleteMany({ where: { id: { in: ids } } })

    let filesUnlinked = 0
    for (const item of mine) {
      if (item.kind !== "FILE" || !item.storageKey) continue
      await deleteStoredFile(item.storageKey)
      filesUnlinked++
    }

    logAudit({
      action: "delete",
      entityType: "vault_trash",
      entityId: actor.workspaceId,
      entityName: "Vault trash",
      userId: actor.userId,
      request,
      metadata: { purged: ids.length, filesUnlinked, scope: isBodPlus(actor.orgRole) ? "all" : "own" },
    }).catch(() => {})

    return NextResponse.json({ purged: ids.length, filesUnlinked })
  } catch (error) {
    console.error("[vault] empty trash failed:", error)
    return NextResponse.json({ error: "Failed to empty trash" }, { status: 500 })
  }
}
