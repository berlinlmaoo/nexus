export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import {
  getVaultActor,
  canReadItem,
  canWriteItem,
  canModifyItem,
  cleanItemName,
  uniqueNameInFolder,
  deleteStoredFile,
  subtreeIds,
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

    const data: Record<string, unknown> = {}
    let nextParentId = item.parentId

    // ── move ──────────────────────────────────────────────────────────────────
    if ("parentId" in body) {
      const target: string | null = typeof body.parentId === "string" && body.parentId ? body.parentId : null
      if (target) {
        const parent = await prisma.vaultItem.findFirst({
          where: { id: target, workspaceId: actor.workspaceId, deletedAt: null },
          select: { id: true, kind: true },
        })
        if (!parent) return NextResponse.json({ error: "Folder tujuan tidak ada" }, { status: 404 })
        if (parent.kind !== "FOLDER") return NextResponse.json({ error: "Tujuan bukan folder" }, { status: 400 })
        // A folder cannot be moved into itself or into anything below it. Without this the subtree
        // detaches from the root entirely: it still exists, is still counted against the quota, and
        // is unreachable from every listing — the worst of the three possible outcomes.
        if (item.kind === "FOLDER" && (await subtreeIds(item.id)).includes(target)) {
          return NextResponse.json({ error: "Tidak bisa memindahkan folder ke dalam dirinya sendiri" }, { status: 400 })
        }
      }
      // Dropping into a folder needs write access THERE, not where the item came from.
      if (!(await canWriteItem(actor, target))) {
        return NextResponse.json({ error: "Tidak punya akses tulis di folder tujuan" }, { status: 403 })
      }
      nextParentId = target
      data.parentId = target
    }

    // ── rename ────────────────────────────────────────────────────────────────
    if (typeof body.name === "string") {
      data.name = await uniqueNameInFolder(
        actor.workspaceId,
        nextParentId,
        cleanItemName(body.name, item.name),
        item.id,
      )
    } else if (nextParentId !== item.parentId) {
      // A move can collide with a name that already exists in the destination even when nothing was
      // renamed — resolve it here or the two files become indistinguishable in the list.
      data.name = await uniqueNameInFolder(actor.workspaceId, nextParentId, item.name, item.id)
    }

    if (typeof body.icon === "string") data.icon = body.icon.slice(0, 40) || null
    if (typeof body.color === "string") data.color = body.color.slice(0, 20) || null

    // ── restore from trash ────────────────────────────────────────────────────
    if (body.restore === true) {
      data.deletedAt = null
      // A restored item whose folder is still in the trash would be invisible. Send it to the root
      // instead of silently restoring the ancestor chain the person didn't ask about.
      if (item.parentId) {
        const parent = await prisma.vaultItem.findUnique({
          where: { id: item.parentId },
          select: { deletedAt: true },
        })
        if (!parent || parent.deletedAt) data.parentId = null
      }
    }

    // ── access thresholds (BoD only) ──────────────────────────────────────────
    for (const key of ["minReadRole", "minWriteRole"] as const) {
      if (!(key in body)) continue
      if (!isBodPlus(actor.orgRole)) {
        return NextResponse.json({ error: "Cuma BoD yang bisa mengubah akses" }, { status: 403 })
      }
      const v = body[key]
      if (v === null || v === "" || v === "WORKSPACE") {
        // "WORKSPACE" and null mean the same thing at read time; store null so the value keeps
        // inheriting if a parent is locked down later.
        data[key] = null
      } else if (typeof v === "string" && ROLE_THRESHOLDS.has(v)) {
        data[key] = v
      } else {
        return NextResponse.json({ error: `Nilai ${key} tidak dikenal` }, { status: 400 })
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada yang diubah" }, { status: 400 })
    }

    const updated = await prisma.vaultItem.update({
      where: { id: item.id },
      data,
      include: VAULT_ITEM_INCLUDE,
    })

    logAudit({
      action: "update",
      entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
      entityId: item.id,
      entityName: updated.name,
      userId: actor.userId,
      request,
      metadata: { changed: Object.keys(data) },
    }).catch(() => {})

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
      await prisma.vaultItem.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      logAudit({
        action: "delete",
        entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
        entityId: item.id,
        entityName: item.name,
        userId: actor.userId,
        request,
        metadata: { trashed: ids.length },
      }).catch(() => {})
      return NextResponse.json({ trashed: ids.length })
    }

    // Read the storage keys BEFORE the rows go away — the Cascade on parentId takes the children
    // with the parent, and after that there is nothing left to tell us which files to unlink.
    const files = await prisma.vaultItem.findMany({
      where: { id: { in: ids }, kind: "FILE" },
      select: { storageKey: true },
    })

    await prisma.vaultItem.delete({ where: { id: item.id } })
    let freedFiles = 0
    for (const f of files) {
      if (!f.storageKey) continue
      await deleteStoredFile(f.storageKey)
      freedFiles++
    }

    logAudit({
      action: "delete",
      entityType: item.kind === "FOLDER" ? "vault_folder" : "vault_file",
      entityId: item.id,
      entityName: item.name,
      userId: actor.userId,
      request,
      metadata: { purged: ids.length, filesUnlinked: freedFiles },
    }).catch(() => {})

    return NextResponse.json({ purged: ids.length, filesUnlinked: freedFiles })
  } catch (error) {
    console.error("[vault] delete item failed:", error)
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 })
  }
}
