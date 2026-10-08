export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { orgRoleOf } from "@/lib/org"
import { restorableDelete } from "@/lib/deletion-snapshot"

async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  // Company workspace only: every sign-up is One Above All of their own personal workspace.
  const role = await orgRoleOf(userId)
  return role === "BOD" || role === "ONE_ABOVE_ALL"
}

// One announcement, for whoever it was addressed to. This is what a tapped push resolves against:
// `/api/announcements/active` hides anything already dismissed, and a person who tapped the
// notification an hour after closing the pop-up would otherwise be shown nothing at all.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const a = await prisma.announcement.findUnique({
      where: { id },
      select: {
        id: true, title: true, body: true, tone: true, imageUrl: true, active: true, createdAt: true, targetUserIds: true, createdById: true,
        kind: true, attachmentUrl: true, attachmentName: true,
      },
    })
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const me = session.user.id
    if (a.targetUserIds.length && !a.targetUserIds.includes(me) && !(await isBoD(me))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const author = a.createdById ? await prisma.user.findUnique({ where: { id: a.createdById }, select: { name: true } }) : null
    const { targetUserIds: _t, createdById: _c, ...rest } = a
    return NextResponse.json({ announcement: { ...rest, targeted: a.targetUserIds.length > 0, authorName: author?.name ?? null } })
  } catch (error) {
    console.error("announcement get error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// Toggle active / edit an announcement (BoD+). Set active:false to stop it popping up.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params
    const { title, body, tone, active } = await req.json()
    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: String(title).trim() }),
        ...(body !== undefined && { body: String(body).trim() }),
        ...(tone !== undefined && ["info", "success", "warning"].includes(tone) && { tone }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    })
    return NextResponse.json({ announcement })
  } catch (error) {
    // Prisma P2025 = no row with this id: the caller asked for something that does not exist.
    if ((error as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("announcement patch error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params
    const existing = await prisma.announcement.findUnique({ where: { id }, select: { title: true, kind: true } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // In the audit, and kept with who has seen it first, so Control Room → Audit can restore it.
    await restorableDelete({
      entityType: "announcement", entityId: id, entityName: existing.title, workspaceId: null,
      userId: session.user.id, request: _req, metadata: { kind: existing.kind },
      meta: { open: { type: "announcement", id } },
      remove: (tx) => tx.announcement.delete({ where: { id } }),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    // Prisma P2025 = no row with this id: the caller asked for something that does not exist.
    if ((error as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error("announcement delete error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
