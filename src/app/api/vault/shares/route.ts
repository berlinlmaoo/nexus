export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { emitVaultChanged } from "@/lib/socket-emitter"
import { getVaultActor, canReadItem, canModifyItem, newShareSlug } from "@/lib/vault"
import { EXPIRY_PRESETS, serializeShare } from "@/lib/vault-share"

// GET /api/vault/shares?itemId=<id> — every link ever made for one item (a file or, since
// 9 Oct 2026, a folder). Each carries `canRevoke` for the person asking.
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const itemId = request.nextUrl.searchParams.get("itemId")
    if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 })

    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId },
      select: { id: true, uploaderId: true, ownerId: true },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const shares = await prisma.vaultShare.findMany({
      where: { itemId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    // The same rule DELETE /api/vault/shares/<id> applies: its maker, the item's owner, or BoD.
    const owns = canModifyItem(actor, item)
    return NextResponse.json({
      shares: shares.map((s) => serializeShare(s, { canRevoke: owns || s.createdById === actor.userId })),
      // Whether this person may make an EXTERNAL link for this item (see POST below), so a client can
      // say so before anybody picks it rather than after the server refuses.
      canShareExternally: owns,
    })
  } catch (error) {
    console.error("[vault] list shares failed:", error)
    return NextResponse.json({ error: "Failed to list shares" }, { status: 500 })
  }
}

// POST /api/vault/shares — mint a link to a file or a folder.
//
// A folder link (9 Oct 2026) opens that folder's subtree and nothing else: lib/vault-share.ts
// itemInShare is the boundary, checked on every request behind the link.
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body?.itemId || typeof body.itemId !== "string") {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 })
    }

    const item = await prisma.vaultItem.findFirst({
      where: { id: body.itemId, workspaceId: actor.workspaceId, deletedAt: null },
      select: { id: true, kind: true, name: true, uploaderId: true, ownerId: true },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (item.kind !== "FILE" && item.kind !== "FOLDER") {
      return NextResponse.json({ error: "This can't be shared" }, { status: 400 })
    }
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const requireAuth = body.requireAuth !== false
    // Handing a file to someone with no NEXUS account is a bigger act than reading it. Anyone may
    // make an internal link for anything they can already open; an EXTERNAL link needs the same
    // standing as deleting the file.
    if (!requireAuth && !canModifyItem(actor, item)) {
      return NextResponse.json(
        { error: "Tautan eksternal cuma bisa dibuat oleh yang mengunggah atau BoD", code: "EXTERNAL_NOT_ALLOWED" },
        { status: 403 },
      )
    }

    const preset = typeof body.expires === "string" ? body.expires : "permanent"
    if (!(preset in EXPIRY_PRESETS)) {
      return NextResponse.json({ error: "Masa berlaku tidak dikenal" }, { status: 400 })
    }
    const days = EXPIRY_PRESETS[preset]
    const expiresAt = days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    const share = await prisma.vaultShare.create({
      data: {
        slug: newShareSlug(),
        itemId: item.id,
        requireAuth,
        allowDownload: body.allowDownload !== false,
        expiresAt,
        createdById: actor.userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    })

    logAudit({
      action: "create",
      entityType: "vault_share",
      entityId: share.id,
      entityName: item.name,
      userId: actor.userId,
      request,
      // The slug is the key. It is not written to the audit log, which is readable by more people
      // than the link is meant for.
      metadata: { itemId: item.id, kind: item.kind, requireAuth, allowDownload: share.allowDownload, expires: preset },
    }).catch(() => {})
    // The item's "· 1 link" in every open listing.
    emitVaultChanged(actor.workspaceId, actor.userId)

    return NextResponse.json(serializeShare(share, { canRevoke: true }), { status: 201 })
  } catch (error) {
    console.error("[vault] create share failed:", error)
    return NextResponse.json({ error: "Failed to create share" }, { status: 500 })
  }
}
