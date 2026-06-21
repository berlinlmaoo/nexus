import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

const memberInclude = { members: { include: { user: { select: { id: true, name: true, avatar: true, email: true } } } } }

/** Ensure a PROJECT chat room exists for every project the user belongs to. */
async function provisionProjectRooms(userId: string) {
  const memberships = await prisma.projectMember.findMany({ where: { userId }, select: { projectId: true } })
  for (const { projectId } of memberships) {
    const existing = await prisma.conversation.findUnique({ where: { projectId }, select: { id: true } })
    if (existing) {
      // make sure this user is a member
      await prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: existing.id, userId } },
        create: { conversationId: existing.id, userId },
        update: {},
      })
      continue
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, members: { select: { userId: true } } } })
    if (!project) continue
    await prisma.conversation.create({
      data: {
        type: "PROJECT",
        projectId,
        name: project.name,
        members: { create: project.members.map((m) => ({ userId: m.userId })) },
      },
    })
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    await provisionProjectRooms(userId)

    const memberships = await prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true, lastReadAt: true } })
    const ids = memberships.map((m) => m.conversationId)
    const readMap = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]))
    if (ids.length === 0) return NextResponse.json({ conversations: [] })

    const convos = await prisma.conversation.findMany({
      where: { id: { in: ids } },
      include: { ...memberInclude, messages: { orderBy: { createdAt: "desc" }, take: 1, include: { user: { select: { id: true, name: true } } } } },
      orderBy: { updatedAt: "desc" },
    })

    const conversations = await Promise.all(convos.map(async (c) => {
      const lastReadAt = readMap.get(c.id) ?? null
      const unreadCount = await prisma.message.count({ where: { conversationId: c.id, userId: { not: userId }, ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}) } })
      return { id: c.id, type: c.type, name: c.name, projectId: c.projectId, members: c.members, lastMessage: c.messages[0] ?? null, unreadCount }
    }))

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error("conversations GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { type, userIds, name } = await req.json()
    const others: string[] = Array.isArray(userIds) ? userIds.filter((u: string) => u && u !== userId) : []
    if (others.length === 0) return NextResponse.json({ error: "userIds required" }, { status: 400 })

    // DM dedupe: find an existing 1:1 between exactly these two users.
    if (type === "DM" && others.length === 1) {
      const existing = await prisma.conversation.findFirst({
        where: { type: "DM", members: { every: { userId: { in: [userId, others[0]] } } }, AND: [{ members: { some: { userId } } }, { members: { some: { userId: others[0] } } }] },
        include: memberInclude,
      })
      if (existing && (existing.members?.length ?? 0) === 2) return NextResponse.json({ conversation: existing })
    }

    const allMembers = Array.from(new Set([userId, ...others]))
    const conversation = await prisma.conversation.create({
      data: {
        type: type === "GROUP" ? "GROUP" : "DM",
        name: type === "GROUP" ? (name?.trim() || null) : null,
        members: { create: allMembers.map((uid) => ({ userId: uid })) },
      },
      include: memberInclude,
    })
    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    console.error("conversations POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
