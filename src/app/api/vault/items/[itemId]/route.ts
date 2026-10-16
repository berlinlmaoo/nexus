export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { emitVaultChanged } from "@/lib/socket-emitter"
import { restorableDelete, restorableSoftDelete } from "@/lib/deletion-snapshot"
import {
  getVaultActor,
  canReadItem,
  canWriteItem,
  canModifyItem,
  cleanItemName,
  uniqueNameInFolder,
  subtreeIds,
  subtreeIdsTx,
  isAncestorOrSelfTx,
  lockVaultTree,
  withFreeName,
  VaultWriteRefused,
  VAULT_ITEM_INCLUDE,
  serializeVaultItem,
  breadcrumbFor,
  isBodPlus,
  type VaultItemRow,
} from "@/lib/vault"

const ROLE_THRESHOLDS = new Set(["WORKSPACE", "MANAGER_PLUS", "BOD_PLUS"])

// GET /api/vault/items/<id> — one item, with its breadcrumb.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId },
      include: VAULT_ITEM_INCLUDE,
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json({
      item: serializeVaultItem(item as unknown as VaultItemRow, actor),
      breadcrumb: await breadcrumbFor(item.parentId),
    })
  } catch (error) {
    console.error("[vault] get item failed:", error)
    return NextResponse.json({ error: "Failed to load item" }, { status: 500 })
  }
}

// PATCH /api/vault/items/<id> — rename, move, hand over ownership, set access, or restore from trash.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId },
      select: { id: true, kind: true, name: true, parentId: true, uploaderId: true, ownerId: true, deletedAt: true },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!canModifyItem(actor, item)) {
      return NextResponse.json({ error: "Cuma yang mengunggah atau BoD yang bisa mengubah ini" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 })

    // Validation that needs no lock first (access thresholds are BoD-only; their values are checked here).
    const roleData: Record<string, unknown> = {}
    for (const key of ["minReadRole", "minWriteRole"] as const) {
      if (!(key in body)) continue
      if (!isBodPlus(actor.orgRole)) {
        return NextResponse.json({ error: "Cuma BoD yang bisa mengubah akses" }, { status: 403 })
      }
      const v = body[key]
      if (v === null || v === "" || v === "WORKSPACE") {
        // "WORKSPACE" and null mean the same thing at read time; store null so the value keeps
        // inheriting if a parent is locked down later.
        roleData[key] = null
      } else if (typeof v === "string" && ROLE_THRESHOLDS.has(v)) {
        roleData[key] = v
      } else {
        return NextResponse.json({ error: `Nilai ${key} tidak dikenal` }, { status: 400 })
      }
    }
    const moveTo: string | null | undefined = "parentId" in body ? (typeof body.parentId === "string" && body.parentId ? body.parentId : null) : undefined
    // Dropping into a folder needs write access THERE, not where the item came from.
    if (moveTo !== undefined && !(await canWriteItem(actor, moveTo))) {
      return NextResponse.json({ error: "Tidak punya akses tulis di folder tujuan" }, { status: 403 })
    }
    const workspaceId = actor.workspaceId

    // Everything that reads the tree and changes it runs in one transaction under the Vault's EXCLUSIVE tree
    // lock (race audit 16 Oct 2026, M15/M16): "is the target below me?", "is it still a live folder?", the
    // restore of a folder's contents and an Empty trash can no longer interleave — two folders moved into
    // each other at once used to both pass the check and make a cycle that no listing can reach.
    let updated, restoredInside = 0, changedKeys: string[] = []
    try {
      ;({ updated, restoredInside, changedKeys } = await withFreeName(() => prisma.$transaction(async (tx) => {
        await lockVaultTree(tx, workspaceId, "exclusive")
        const cur = (await tx.$queryRaw<{ parentId: string | null; deletedAt: Date | null; name: string }[]>`
          SELECT "parentId", "deletedAt", "name" FROM "VaultItem" WHERE "id" = ${item.id} FOR UPDATE`)[0]
        if (!cur) throw new VaultWriteRefused(404, { error: "Not found", errorEn: "This item was deleted for good.", code: "GONE" })
        const data: Record<string, unknown> = { ...roleData }
        let nextParentId = cur.parentId

        // ── move ──────────────────────────────────────────────────────────────
        if (moveTo !== undefined) {
          if (moveTo) {
            const parent = await tx.vaultItem.findFirst({
              where: { id: moveTo, workspaceId, deletedAt: null },
              select: { id: true, kind: true },
            })
            if (!parent) throw new VaultWriteRefused(404, { error: "Folder tujuan tidak ada" })
            if (parent.kind !== "FOLDER") throw new VaultWriteRefused(400, { error: "Tujuan bukan folder" })
            // A folder cannot be moved into itself or into anything below it. Without this the subtree
            // detaches from the root entirely: it still exists, is still counted against the quota, and
            // is unreachable from every listing — the worst of the three possible outcomes.
            if (item.kind === "FOLDER" && (await isAncestorOrSelfTx(tx, item.id, moveTo))) {
              throw new VaultWriteRefused(400, { error: "Tidak bisa memindahkan folder ke dalam dirinya sendiri", code: "CYCLE" })
            }
          }
          nextParentId = moveTo
          data.parentId = moveTo
        }

        // ── restore from trash ────────────────────────────────────────────────
        const restoring = body.restore === true && !!cur.deletedAt
        if (body.restore === true) {
          data.deletedAt = null
          // A restored item whose folder is still in the trash would be invisible. Send it to the root
          // instead of silently restoring the ancestor chain the person didn't ask about.
          if (nextParentId) {
            const parent = await tx.vaultItem.findUnique({ where: { id: nextParentId }, select: { deletedAt: true } })
            if (!parent || parent.deletedAt) { data.parentId = null; nextParentId = null }
          }
        }

        // ── rename ────────────────────────────────────────────────────────────
        if (typeof body.name === "string") {
          data.name = await uniqueNameInFolder(workspaceId, nextParentId, cleanItemName(body.name, cur.name), item.id, tx)
        } else if (nextParentId !== cur.parentId || restoring) {
          // A move (or a restore: someone may have used the name meanwhile) can collide with a name that
          // already exists in the destination — resolve it here or the two files become indistinguishable.
          const free = await uniqueNameInFolder(workspaceId, nextParentId, cur.name, item.id, tx)
          if (free !== cur.name) data.name = free
        }

        if (typeof body.icon === "string") data.icon = body.icon.slice(0, 40) || null
        if (typeof body.color === "string") data.color = body.color.slice(0, 20) || null

        if (Object.keys(data).length === 0) throw new VaultWriteRefused(400, { error: "Tidak ada yang diubah" })

        const row = await tx.vaultItem.update({ where: { id: item.id }, data, include: VAULT_ITEM_INCLUDE })

        // A folder comes back WITH what went to the trash with it (9 Oct 2026). Trashing a folder marks
        // its whole subtree in one statement, so its contents carry the folder's exact deletedAt; before
        // this, Restore brought back an empty folder and left everything in it behind in the trash.
        // Things trashed on their own before or after keep their own timestamp and stay where they are.
        let inside = 0
        if (restoring && item.kind === "FOLDER" && cur.deletedAt) {
          const ids = (await subtreeIdsTx(tx, item.id)).filter((id) => id !== item.id)
          if (ids.length) {
            inside = (await tx.vaultItem.updateMany({ where: { id: { in: ids }, deletedAt: cur.deletedAt }, data: { deletedAt: null } })).count
          }
        }
        return { updated: row, restoredInside: inside, changedKeys: Object.keys(data) }
      })))
    } catch (e) {
      if (e instanceof VaultWriteRefused) return NextResponse.json(e.body, { status: e.status })
      throw e
    }

    logAudit({
      action: "update",
      entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
      entityId: item.id,
      entityName: updated.name,
      userId: actor.userId,
      request,
      metadata: { changed: changedKeys, ...(restoredInside ? { restoredInside } : {}) },
    }).catch(() => {})
    // A rename, a move (both folders' listings), a restore or an access change: every open vault
    // screen refetches. Ids only; a colleague who may not see the item gets a listing without it.
    emitVaultChanged(actor.workspaceId, actor.userId)

    return NextResponse.json(serializeVaultItem(updated as unknown as VaultItemRow, actor))
  } catch (error) {
    console.error("[vault] patch item failed:", error)
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 })
  }
}

// DELETE /api/vault/items/<id>[?purge=1]
//
// Default is the trash. `purge=1` is the irreversible one and it MUST unlink the bytes: a trash that
// only hides rows leaves the quota measuring a number with no relationship to the disk it protects.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId },
      select: { id: true, kind: true, name: true, uploaderId: true, ownerId: true, deletedAt: true },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!canModifyItem(actor, item)) {
      return NextResponse.json({ error: "Cuma yang mengunggah atau BoD yang bisa menghapus ini" }, { status: 403 })
    }

    const purge = request.nextUrl.searchParams.get("purge") === "1"
    const ids = item.kind === "FOLDER" ? await subtreeIds(item.id) : [item.id]

    if (!purge) {
      // Trash the whole subtree, not just the folder row. Marking only the folder would leave its
      // children live in every query that filters `deletedAt: null` without also climbing.
      // The Vault has its own Restore for the trash; the copy of each row's flag makes the same delete
      // undoable from Control Room → Audit too.
      // The subtree is collected again under the Vault's exclusive tree lock (race audit 16 Oct 2026, M16): a
      // file uploaded into the folder a moment ago is in the trash with it, not left live inside a trashed
      // folder where no listing shows it.
      const workspaceId = actor.workspaceId
      let trashIds = ids
      await restorableSoftDelete({
        entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
        entityId: item.id, entityName: item.name, workspaceId, userId: actor.userId, request,
        metadata: { trashed: ids.length }, ids,
        meta: { open: { type: "vault", id: item.id } },
        prepare: async (tx) => {
          await lockVaultTree(tx, workspaceId, "exclusive")
          trashIds = item.kind === "FOLDER" ? await subtreeIdsTx(tx, item.id) : [item.id]
          return trashIds
        },
        apply: (tx) => tx.vaultItem.updateMany({ where: { id: { in: trashIds }, deletedAt: null }, data: { deletedAt: new Date() } }),
      })
      emitVaultChanged(actor.workspaceId, actor.userId)
      return NextResponse.json({ trashed: trashIds.length })
    }

    // Deleted for good — but kept first (rows and files), so Control Room → Audit can restore it: it
    // comes back to the trash, as it was. The files leave the disk with the 90-day purge of copies.
    await restorableDelete({
      entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
      entityId: item.id, entityName: item.name, workspaceId: actor.workspaceId, userId: actor.userId, request,
      metadata: { purged: ids.length },
      meta: { open: { type: "vault", id: item.id } },
      remove: (tx) => tx.vaultItem.delete({ where: { id: item.id } }),
    })
    emitVaultChanged(actor.workspaceId, actor.userId)

    // `filesUnlinked` stays for older clients: nothing leaves the disk at this point any more.
    return NextResponse.json({ purged: ids.length, filesUnlinked: 0 })
  } catch (error) {
    console.error("[vault] delete item failed:", error)
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 })
  }
}
