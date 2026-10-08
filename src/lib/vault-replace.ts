import path from "path"
import type { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import { restorableSoftDelete } from "@/lib/deletion-snapshot"
import { emitVaultChanged } from "@/lib/socket-emitter"
import {
  canReadItem,
  canWriteItem,
  canModifyItem,
  uniqueNameInFolder,
  vaultUsedBytes,
  VAULT_QUOTA_BYTES,
  VAULT_ITEM_INCLUDE,
  type VaultActor,
} from "@/lib/vault"

// ─────────────────────────────────────────────────────────────────────────────
// "Replace file…" (owner, 9 Oct 2026 — promised in the original design: "mengganti logo memperbarui
// berkas di item yang sama, jadi tautan yang sudah terkirim tidak putus").
//
// The item keeps its id, so every link already sent, every share row and every place that points at
// it keeps working and now serves the new bytes. The new bytes get a NEW storage key; the item's
// content version (lib/vault.ts fileVersion) follows it, so every URL a client caches by changes.
//
// The previous bytes are not deleted here. The change is kept as a restorable copy (entity
// `vault_file_version`, Control Room → Audit → Restore puts the previous version back), and the old
// file leaves the disk with that copy, through the 90-day purge (lib/deletion-snapshot.ts).
//
// Used by POST /api/vault/items/<id>/replace (one request) and by /api/attachments/chunk with
// `target=vault&replaceItemId=<id>` (large files), which is why it lives here.
// ─────────────────────────────────────────────────────────────────────────────

export type ReplaceTarget = {
  id: string
  name: string
  parentId: string | null
  workspaceId: string
  size: number | null
  uploaderId: string
  ownerId: string | null
}

export type ReplaceCheck =
  | { ok: true; item: ReplaceTarget }
  | { ok: false; status: number; error: string; code: string }

/**
 * May `actor` put `incomingBytes` in place of this file's bytes? The same standing as renaming it
 * (whoever uploaded or owns it, or BoD), plus write access where it lives — replacing is writing into
 * that folder — and room in the quota for the difference.
 *
 * Asked on every chunk of a chunked replace, like every other chunk check.
 */
export async function replaceTargetFor(actor: VaultActor, itemId: string, incomingBytes: number): Promise<ReplaceCheck> {
  if (!actor.workspaceId) return { ok: false, status: 403, error: "No workspace", code: "NO_WORKSPACE" }
  const item = await prisma.vaultItem.findFirst({
    where: { id: itemId, workspaceId: actor.workspaceId },
    select: { id: true, kind: true, name: true, parentId: true, workspaceId: true, size: true, uploaderId: true, ownerId: true, deletedAt: true },
  })
  if (!item) return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" }
  if (item.kind !== "FILE") return { ok: false, status: 400, error: "Hanya berkas yang bisa diganti", code: "NOT_A_FILE" }
  if (item.deletedAt) {
    return { ok: false, status: 409, error: "Berkas ini ada di sampah. Pulihkan dulu.", code: "TRASHED" }
  }
  if (!(await canReadItem(actor, item.id))) return { ok: false, status: 403, error: "Forbidden", code: "FORBIDDEN" }
  if (!canModifyItem(actor, item)) {
    return { ok: false, status: 403, error: "Cuma yang mengunggah atau BoD yang bisa mengganti berkas ini", code: "NOT_YOURS" }
  }
  if (!(await canWriteItem(actor, item.parentId))) {
    return { ok: false, status: 403, error: "Tidak punya akses tulis di folder ini", code: "FORBIDDEN" }
  }
  // The old bytes stop counting once replaced (the quota sums live rows), so only the difference
  // has to fit.
  const used = await vaultUsedBytes(actor.workspaceId)
  if (used - (item.size ?? 0) + incomingBytes > VAULT_QUOTA_BYTES) {
    const freeGb = Math.max(0, (VAULT_QUOTA_BYTES - used) / 1024 ** 3)
    return {
      ok: false,
      status: 507,
      error: `Vault penuh. Sisa ${freeGb.toFixed(1)} GB dari ${(VAULT_QUOTA_BYTES / 1024 ** 3).toFixed(0)} GB.`,
      code: "QUOTA",
    }
  }
  return { ok: true, item }
}

/**
 * The name after a replace: the same name — unless the new file is another type, in which case the
 * stem stays and the extension follows the new file ("Logo.png" replaced by a .svg is "Logo.svg").
 * Clients decide how to open a file partly from its extension; a PDF called ".pptx" would open wrong.
 */
export function replacedName(oldName: string, newFileName: string): string {
  const oldExtRaw = path.extname(oldName)
  const newExtRaw = path.extname(newFileName).toLowerCase()
  const newExt = /^\.[a-z0-9]{1,8}$/.test(newExtRaw) ? newExtRaw : ""
  if (!newExt || newExt === oldExtRaw.toLowerCase()) return oldName
  const stem = /^\.[a-z0-9]{1,8}$/i.test(oldExtRaw) ? oldName.slice(0, -oldExtRaw.length) : oldName
  return `${stem}${newExt}`
}

/**
 * Point the item at the new bytes, keeping a restorable copy of what it pointed at before. The new
 * file is already on disk under `storageKey`. When this returns, the row points at it (the caller
 * must not reclaim the new file any more); load the row afterwards with `replacedRow`.
 */
export async function applyReplace(input: {
  actor: VaultActor
  item: ReplaceTarget
  storageKey: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  fileName: string
  request?: NextRequest | Request
  chunked?: boolean
}) {
  const { actor, item } = input
  const workspaceId = actor.workspaceId as string
  const desired = replacedName(item.name, input.fileName)
  const name = desired === item.name ? item.name : await uniqueNameInFolder(workspaceId, item.parentId, desired, item.id)

  await restorableSoftDelete({
    entityType: "vault_file_version",
    action: "replace",
    entityId: item.id,
    entityName: item.name,
    workspaceId,
    userId: actor.userId,
    request: input.request,
    metadata: {
      size: input.size,
      previousSize: item.size,
      ...(name !== item.name ? { renamedTo: name } : {}),
      ...(input.chunked ? { chunked: true } : {}),
    },
    meta: { open: { type: "vault", id: item.id } },
    apply: (tx) =>
      tx.vaultItem.update({
        where: { id: item.id },
        data: {
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          size: input.size,
          width: input.width,
          height: input.height,
          name,
        },
      }),
  })
  emitVaultChanged(workspaceId, actor.userId)
}

/** The replaced item, read back with everything the vault serializes. */
export function replacedRow(itemId: string) {
  return prisma.vaultItem.findUniqueOrThrow({ where: { id: itemId }, include: VAULT_ITEM_INCLUDE })
}
