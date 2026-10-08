export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { writeFile, rename, unlink } from "fs/promises"
import { auth } from "@/lib/auth"
import { resolveMime } from "@/lib/mime"
import { getVaultActor, newStorageKey, ensureStorageDir, serializeVaultItem, type VaultItemRow } from "@/lib/vault"
import { replaceTargetFor, applyReplace, replacedRow } from "@/lib/vault-replace"

// Same ceiling as /api/vault/upload: past this, Cloudflare drops the body before the app sees it.
const SINGLE_SHOT_MAX = 90 * 1024 * 1024

// POST /api/vault/items/<id>/replace  (multipart: file, width?, height?)
//
// New bytes for an existing file, keeping its id, its links and its place (lib/vault-replace.ts).
// Larger files go through /api/attachments/chunk with `target=vault&replaceItemId=<id>`; this route
// says so with 413 + useChunked, like the upload route.
//
// 200: the item as the vault serializes it — same id, new `fileVersion`, new `url`/`thumbUrl`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  let finalPath: string | null = null
  let committed = false
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
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

    const check = await replaceTargetFor(actor, itemId, file.size)
    if (!check.ok) return NextResponse.json({ error: check.error, code: check.code }, { status: check.status })

    const storageKey = newStorageKey(file.name || check.item.name)
    finalPath = await ensureStorageDir(storageKey)
    // Temp name, then rename: the nightly backup never sees half a file under its final name.
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(`${finalPath}.partial`, buffer)
    await rename(`${finalPath}.partial`, finalPath)

    const num = (v: FormDataEntryValue | null) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null
    }

    await applyReplace({
      actor,
      item: check.item,
      storageKey,
      mimeType: resolveMime(file.type, file.name),
      size: buffer.byteLength,
      width: num(form.get("width")),
      height: num(form.get("height")),
      fileName: file.name || check.item.name,
      request,
    })
    committed = true
    const updated = await replacedRow(check.item.id)
    return NextResponse.json(serializeVaultItem(updated as unknown as VaultItemRow, actor))
  } catch (error) {
    console.error("[vault] replace failed:", error)
    return NextResponse.json({ error: "Failed to replace the file" }, { status: 500 })
  } finally {
    // The new bytes are only reachable once the row points at them. If that never happened, they
    // are nobody's — reclaim them now. The OLD bytes are never touched here.
    if (finalPath && !committed) {
      await unlink(finalPath).catch(() => {})
      await unlink(`${finalPath}.partial`).catch(() => {})
    }
  }
}
