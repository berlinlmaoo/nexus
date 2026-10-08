export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getVaultActor, canModifyItem, isBodPlus } from "@/lib/vault"
import { restorableDelete } from "@/lib/deletion-snapshot"

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

    // The rows go (the quota is freed now); they are kept first, files included, so Control Room →
    // Audit can bring the whole trash back as it was. The files leave the disk with the 90-day purge
    // of copies (lib/deletion-snapshot.ts), once nothing points at them.
    const ids = mine.map((t) => t.id)
    await restorableDelete({
      entityType: "vault_trash", entityId: actor.workspaceId, rootIds: ids,
      entityName: `Vault trash · ${ids.length} ${ids.length === 1 ? "item" : "items"}`,
      workspaceId: actor.workspaceId, userId: actor.userId, request,
      metadata: { purged: ids.length, scope: isBodPlus(actor.orgRole) ? "all" : "own" },
      meta: { open: { type: "vault", id: actor.workspaceId } },
      remove: (tx) => tx.vaultItem.deleteMany({ where: { id: { in: ids } } }),
    })

    // `filesUnlinked` stays for older clients: nothing leaves the disk at this point any more.
    return NextResponse.json({ purged: ids.length, filesUnlinked: 0 })
  } catch (error) {
    console.error("[vault] empty trash failed:", error)
    return NextResponse.json({ error: "Failed to empty trash" }, { status: 500 })
  }
}
