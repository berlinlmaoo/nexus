export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { emitVaultChanged } from "@/lib/socket-emitter"
import {
  getVaultActor,
  canReadItem,
  canWriteItem,
  cleanItemName,
  uniqueNameInFolder,
  vaultUsedBytes,
  VAULT_QUOTA_BYTES,
  VAULT_ITEM_INCLUDE,
  serializeVaultItem,
  breadcrumbFor,
  isBodPlus,
  type VaultItemRow,
} from "@/lib/vault"

// GET /api/vault/items?parentId=<id>&trash=1&q=<search>
//
// One folder at a time, plus the breadcrumb and the quota. Not a whole-tree dump: a shared drive
// grows without anyone deciding to, and a route that returns everything is fine on day one and a
// problem nobody connects back to this decision on day two hundred.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const sp = request.nextUrl.searchParams
    const parentId = sp.get("parentId") || null
    const trash = sp.get("trash") === "1"
    const q = (sp.get("q") || "").trim().slice(0, 100)

    // The folder itself must be readable before its contents are listed — otherwise a locked shelf
    // would still enumerate its children to anyone who guessed its id.
    if (parentId) {
      const parent = await prisma.vaultItem.findFirst({
        where: { id: parentId, workspaceId: actor.workspaceId },
        select: { id: true, kind: true },
      })
      if (!parent) return NextResponse.json({ error: "Folder not found" }, { status: 404 })
      if (parent.kind !== "FOLDER") return NextResponse.json({ error: "Not a folder" }, { status: 400 })
      if (!(await canReadItem(actor, parentId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Search spans the whole vault; browsing is scoped to one folder. Trash is its own view and is
    // always flat — a trashed folder's children are trashed with it, and showing that nesting again
    // would invite restoring a child into a parent that no longer exists.
    const where = trash
      ? { workspaceId: actor.workspaceId, deletedAt: { not: null } }
      : q
        ? { workspaceId: actor.workspaceId, deletedAt: null, name: { contains: q, mode: "insensitive" as const } }
        : { workspaceId: actor.workspaceId, deletedAt: null, parentId }

    const rows = await prisma.vaultItem.findMany({
      where,
      include: VAULT_ITEM_INCLUDE,
      // Folders above files, then the manual order, then alphabetical. `kind` sorts "FILE" before
      // "FOLDER" ascending, so descending is what puts folders on top.
      orderBy: [{ kind: "desc" }, { position: "asc" }, { name: "asc" }],
      take: q || trash ? 200 : 500,
    })

    // Drop rows the caller may not read. Done per row rather than in the query because the threshold
    // can live on any ancestor; the climb is cached hard by Postgres and the page size is bounded.
    const visible: typeof rows = []
    for (const row of rows) {
      if (await canReadItem(actor, row.id)) visible.push(row)
    }

    const usedBytes = await vaultUsedBytes(actor.workspaceId)

    // Search results come from anywhere in the vault, so each says where it lives (9 Oct 2026):
    // `path` is its folders from the top, without the item. One query for every folder of the vault
    // (a few hundred rows at most), joined here — not a climb per result. A result the caller may
    // read sits under folders they may read too: a lock only ever tightens on the way down.
    let pathOf: ((parentId: string | null) => { id: string; name: string }[]) | null = null
    if (q && !trash && visible.length) {
      const folders = await prisma.vaultItem.findMany({
        where: { workspaceId: actor.workspaceId, kind: "FOLDER", deletedAt: null },
        select: { id: true, name: true, parentId: true },
      })
      const byId = new Map(folders.map((f) => [f.id, f]))
      pathOf = (parentId) => {
        const trail: { id: string; name: string }[] = []
        let cursor = parentId ? byId.get(parentId) : undefined
        for (let depth = 0; cursor && depth < 32; depth++) {
          trail.unshift({ id: cursor.id, name: cursor.name })
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
        }
        return trail
      }
    }

    return NextResponse.json({
      items: visible.map((r) => {
        const item = serializeVaultItem(r as unknown as VaultItemRow, actor)
        return pathOf ? { ...item, path: pathOf(r.parentId) } : item
      }),
      breadcrumb: await breadcrumbFor(parentId),
      parentId,
      canWrite: await canWriteItem(actor, parentId),
      canManageAccess: isBodPlus(actor.orgRole),
      quota: { usedBytes, totalBytes: VAULT_QUOTA_BYTES },
    })
  } catch (error) {
    console.error("[vault] list failed:", error)
    return NextResponse.json({ error: "Failed to list vault" }, { status: 500 })
  }
}

// POST /api/vault/items — create a folder.
//
// Files are NOT created here. They arrive through /api/vault/upload (or the chunked route), which is
// the only place that can put bytes on disk and the row in the database in the same operation. A
// "create the row, upload later" split is how a vault fills with rows pointing at nothing.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 })

    const parentId: string | null = typeof body.parentId === "string" && body.parentId ? body.parentId : null
    if (parentId) {
      const parent = await prisma.vaultItem.findFirst({
        where: { id: parentId, workspaceId: actor.workspaceId, deletedAt: null },
        select: { kind: true },
      })
      if (!parent) return NextResponse.json({ error: "Folder not found" }, { status: 404 })
      if (parent.kind !== "FOLDER") return NextResponse.json({ error: "Parent is not a folder" }, { status: 400 })
    }
    if (!(await canWriteItem(actor, parentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const name = await uniqueNameInFolder(actor.workspaceId, parentId, cleanItemName(body.name, "Folder baru"))

    const last = await prisma.vaultItem.findFirst({
      where: { workspaceId: actor.workspaceId, parentId, deletedAt: null },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    const created = await prisma.vaultItem.create({
      data: {
        kind: "FOLDER",
        name,
        parentId,
        workspaceId: actor.workspaceId,
        uploaderId: actor.userId,
        ownerId: actor.userId,
        position: (last?.position ?? 0) + 1,
        icon: typeof body.icon === "string" ? body.icon.slice(0, 40) : null,
        color: typeof body.color === "string" ? body.color.slice(0, 20) : null,
      },
      include: VAULT_ITEM_INCLUDE,
    })

    logAudit({
      action: "create",
      entityType: "vault_folder",
      entityId: created.id,
      entityName: name,
      userId: actor.userId,
      request,
      metadata: { parentId },
    }).catch(() => {})
    // Every open vault screen of the company refetches (ids only; see emitVaultChanged).
    emitVaultChanged(actor.workspaceId, actor.userId)

    return NextResponse.json(serializeVaultItem(created as unknown as VaultItemRow, actor), { status: 201 })
  } catch (error) {
    console.error("[vault] create folder failed:", error)
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 })
  }
}
