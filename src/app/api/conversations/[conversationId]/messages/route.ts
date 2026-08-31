import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { emitMessageCreated } from "@/lib/socket-emitter"
import { createInAppNotification } from "@/lib/notification-service"

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

    const { content, mentionedUserIds, attachmentUrl, attachmentType } = await req.json()
    const text = typeof content === "string" ? content.trim() : ""
    // Only accept an attachment path this server itself handed out. Taking an arbitrary URL here
    // would turn every message into an open redirect and let anyone point the chat at a remote host.
    const attachment = typeof attachmentUrl === "string" && attachmentUrl.startsWith("/api/files/chat/")
      ? attachmentUrl
      : null
    // A picture on its own is a message; text is only required when there is nothing else.
    if (!text && !attachment) return NextResponse.json({ error: "content required" }, { status: 400 })

    const message = await prisma.message.create({
      data: {
        conversationId,
        userId,
        content: text,
        attachmentUrl: attachment,
        attachmentType: attachment && typeof attachmentType === "string" ? attachmentType.slice(0, 64) : null,
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

    emitMessageCreated(conversationId, message as unknown as Record<string, unknown>)

    // Mentions are structured user IDs from the conversation roster, never inferred from display
    // names. That makes @tags unambiguous even when two people share a name.
    const members = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true, user: { select: { name: true } } },
    })
    const memberIds = new Set(members.map((member) => member.userId))
    const mentions = new Set(
      (Array.isArray(mentionedUserIds) ? mentionedUserIds : [])
        .filter((id): id is string => typeof id === "string" && memberIds.has(id)),
    )
    // Compatibility for the web client, which still sends text only. Accept a textual tag only
    // when its no-space display name identifies exactly one room member.
    const textTags = new Set(Array.from(String(content).matchAll(/@([\p{L}\p{N}._-]+)/gu), (match) => match[1].toLocaleLowerCase()))
    const membersByTag = new Map<string, string[]>()
    for (const member of members) {
      const tag = member.user.name.replace(/\s+/g, "").toLocaleLowerCase()
      if (!tag) continue
      membersByTag.set(tag, [...(membersByTag.get(tag) ?? []), member.userId])
    }
    for (const tag of textTags) {
      const matches = membersByTag.get(tag) ?? []
      if (matches.length === 1) mentions.add(matches[0])
    }
    const preview = message.content.length > 80 ? message.content.slice(0, 78) + "…" : message.content
    await Promise.allSettled(members.map((member) => createInAppNotification({
      userId: member.userId,
      type: mentions.has(member.userId) ? "MESSAGE_MENTION" : "MESSAGE",
      title: mentions.has(member.userId)
        ? `${message.user?.name ?? "Someone"} mentioned you`
        : `New message from ${message.user?.name ?? "someone"}`,
      message: preview,
      link: `/messages/${conversationId}`,
      // Every message pushes, not just mentions. A chat app where a plain message reaches you
      // only after you happen to open it is not a chat app; the mention still differs in the
      // title and type so a direct @ is distinguishable on the lock screen.
      push: true,
    })))

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error("messages POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
