import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { createInAppNotification } from "@/lib/notification-service"

const memberInclude = {
  members: { include: { user: { select: { id: true, name: true, avatar: true, email: true } } } },
}

/**
 * Add and remove people in a GROUP conversation.
 *
 * Only GROUP. A DM is two people by definition — growing one would silently turn a private
 * conversation into a room its two participants never agreed to. A PROJECT room derives its
 * membership from the project, so the way to add someone there is to add them to the project;
 * writing a member row here would be undone the next time the room is provisioned.
 *
 * Any member may add or remove, because a Conversation has no owner column to appeal to. That is a
 * deliberate reading of an internal tool rather than an oversight: everyone in the room is a
 * colleague, and the alternative — inventing an owner now — would leave every group created before
 * today without one.
 */
async function loadGroup(conversationId: string, userId: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, type: true, name: true, members: { select: { userId: true } } },
  })
  if (!convo) return { error: "Not found", status: 404 as const }
  if (convo.type !== "GROUP") {
    return { error: "Only group chats can change members", status: 400 as const }
  }
  if (!convo.members.some((m) => m.userId === userId)) {
    return { error: "Forbidden", status: 403 as const }
  }
  return { convo }
}

/** The set of users the caller shares a workspace with — nobody else may be added. */
async function reachableUserIds(userId: string) {
  const mine = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
  if (mine.length === 0) return new Set<string>()
  const peers = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: mine.map((m) => m.workspaceId) } },
    select: { userId: true },
  })
  return new Set(peers.map((p) => p.userId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params

    const loaded = await loadGroup(conversationId, userId)
    if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const convo = loaded.convo!

    const body = await req.json().catch(() => null)
    const requested: string[] = Array.isArray(body?.userIds)
      ? body.userIds.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
    if (requested.length === 0) return NextResponse.json({ error: "userIds required" }, { status: 400 })

    const reachable = await reachableUserIds(userId)
    const already = new Set(convo.members.map((m) => m.userId))
    const toAdd = Array.from(new Set(requested)).filter((id) => reachable.has(id) && !already.has(id))

    if (toAdd.length > 0) {
      await prisma.conversationMember.createMany({
        data: toAdd.map((uid) => ({ conversationId, userId: uid })),
        skipDuplicates: true,
      })
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      const label = convo.name?.trim() || "a group chat"
      await Promise.allSettled(
        toAdd.map((uid) =>
          createInAppNotification({
            userId: uid,
            type: "MESSAGE",
            title: `${actor?.name ?? "Someone"} added you to ${label}`,
            message: "Open Messages to see the conversation.",
            link: `/messages/${conversationId}`,
            push: true,
          }),
        ),
      )
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: memberInclude,
    })
    return NextResponse.json({ conversation, added: toAdd.length })
  } catch (error) {
    console.error("conversation members POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params

    const loaded = await loadGroup(conversationId, userId)
    if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const convo = loaded.convo!

    const body = await req.json().catch(() => null)
    const target = typeof body?.userId === "string" ? body.userId : null
    if (!target) return NextResponse.json({ error: "userId required" }, { status: 400 })

    // A group that loses its last member becomes a room nobody can reach but that still holds every
    // message ever sent in it. Refuse rather than orphan it.
    if (convo.members.length <= 1) {
      return NextResponse.json({ error: "A group needs at least one member" }, { status: 400 })
    }

    await prisma.conversationMember.deleteMany({ where: { conversationId, userId: target } })

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: memberInclude,
    })
    return NextResponse.json({ conversation })
  } catch (error) {
    console.error("conversation members DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
