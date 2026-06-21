import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { emitMessageCreated, emitNotification } from "@/lib/socket-emitter"

async function assertAccess(userId: string, conversationId: string) {
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true, type: true, projectId: true } })
  if (!convo) return { ok: false, status: 404 }
  if (convo.type === "PROJECT" && convo.projectId) {
    const { allowed } = await checkProjectAccess(userId, convo.projectId, ["MEMBER"])
    return { ok: allowed, status: allowed ? 200 : 403, convo }
  }
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } })
  return { ok: !!member, status: member ? 200 : 403, convo }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    const access = await assertAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status })

    const before = req.nextUrl.searchParams.get("before")
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10), 100)
    const rows = await prisma.message.findMany({
      where: { conversationId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
    return NextResponse.json({ messages: rows.reverse(), hasMore: rows.length === limit })
  } catch (error) {
    console.error("messages GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params
    const access = await assertAccess(userId, conversationId)
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status })

    const { content } = await req.json()
    if (!content || !String(content).trim()) return NextResponse.json({ error: "content required" }, { status: 400 })

    const message = await prisma.message.create({
      data: { conversationId, userId, content: String(content).trim() },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

    emitMessageCreated(conversationId, message as unknown as Record<string, unknown>)

    // Notify other members (in-app + user room).
    const members = await prisma.conversationMember.findMany({ where: { conversationId, userId: { not: userId } }, select: { userId: true } })
    const preview = message.content.length > 80 ? message.content.slice(0, 78) + "…" : message.content
    await Promise.all(members.map(async (m) => {
      const notif = await prisma.notification.create({
        data: { userId: m.userId, type: "MESSAGE", title: `New message from ${message.user?.name ?? "someone"}`, message: preview, link: `/messages/${conversationId}` },
      }).catch(() => null)
      if (notif) emitNotification(m.userId, notif as unknown as Record<string, unknown>)
    }))

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error("messages POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
