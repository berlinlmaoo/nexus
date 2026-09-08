export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { writeFile, rename, unlink } from "fs/promises"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { resolveMime } from "@/lib/mime"
import {
  getVaultActor,
  canWriteItem,
  cleanItemName,
  uniqueNameInFolder,
  newStorageKey,
  ensureStorageDir,
  assertQuota,
  VAULT_ITEM_INCLUDE,
  serializeVaultItem,
  type VaultItemRow,
} from "@/lib/vault"

// Cloudflare drops a request body somewhere around 100 MB with a 413 the app never sees. 95 MB is
// measured-good and 120 MB is measured-bad, so single-shot stops well short and anything larger is
// told, in the response, to use the chunked route instead of failing at the edge with no explanation.
const SINGLE_SHOT_MAX = 90 * 1024 * 1024

// POST /api/vault/upload  (multipart: file, parentId?, width?, height?)
//
// Bytes and row in one operation. There is deliberately no "create the row now, upload later" path:
// that split is how a vault accumulates rows pointing at files that never arrived.
export async function POST(request: NextRequest) {
  let finalPath: string | null = null
  let committed = false
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const form = await request.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (file.size <= 0) return NextResponse.json({ error: "File kosong" }, { status: 400 })
    if (file.size > SINGLE_SHOT_MAX) {
      return NextResponse.json(
        { error: "File terlalu besar untuk upload sekali jalan. Pakai upload berbongkah.", useChunked: true },
        { status: 413 },
      )
    }

    const parentRaw = form.get("parentId")
    const parentId = typeof parentRaw === "string" && parentRaw ? parentRaw : null
    if (parentId) {
      const parent = await prisma.vaultItem.findFirst({
        where: { id: parentId, workspaceId: actor.workspaceId, deletedAt: null },
        select: { kind: true },
      })
      if (!parent) return NextResponse.json({ error: "Folder tidak ada" }, { status: 404 })
      if (parent.kind !== "FOLDER") return NextResponse.json({ error: "Tujuan bukan folder" }, { status: 400 })
    }
    if (!(await canWriteItem(actor, parentId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const quotaError = await assertQuota(actor.workspaceId, file.size)
    if (quotaError) return NextResponse.json({ error: quotaError }, { status: 507 })

    const name = await uniqueNameInFolder(
      actor.workspaceId,
      parentId,
      cleanItemName(file.name, "Berkas"),
    )

    const storageKey = newStorageKey(file.name || name)
    finalPath = await ensureStorageDir(storageKey)

    // Write to a temp name and rename into place: a reader (or the backup timer, which walks this
    // tree nightly) never sees a half-written file under its final name.
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(`${finalPath}.partial`, buffer)
    await rename(`${finalPath}.partial`, finalPath)

    const num = (v: FormDataEntryValue | null) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null
    }

    const created = await prisma.vaultItem.create({
      data: {
        kind: "FILE",
        name,
        parentId,
        workspaceId: actor.workspaceId,
        uploaderId: actor.userId,
        ownerId: actor.userId,
        storageKey,
        mimeType: resolveMime(file.type, file.name),
        size: buffer.byteLength,
        // Sent by the client because the server has no image library. Used only to reserve the right
        // aspect box so the grid doesn't jump when a thumbnail loads.
        width: num(form.get("width")),
        height: num(form.get("height")),
      },
      include: VAULT_ITEM_INCLUDE,
    })
    committed = true

    logAudit({
      action: "create",
      entityType: "vault_file",
      entityId: created.id,
      entityName: name,
      userId: actor.userId,
      request,
      metadata: { parentId, size: buffer.byteLength },
    }).catch(() => {})

    return NextResponse.json(serializeVaultItem(created as unknown as VaultItemRow, actor), { status: 201 })
  } catch (error) {
    console.error("[vault] upload failed:", error)
    return NextResponse.json({ error: "Failed to upload" }, { status: 500 })
  } finally {
    // The row is what makes the bytes reachable. If we wrote the file and then failed to create the
    // row, the file is unreferenced forever AND counts against nothing — reclaim it here rather than
    // leaving it for a cleanup script that doesn't exist yet.
    if (finalPath && !committed) {
      await unlink(finalPath).catch(() => {})
      await unlink(`${finalPath}.partial`).catch(() => {})
    }
  }
}
