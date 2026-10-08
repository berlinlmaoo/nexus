import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { CHAT_MEMBER_SELECT, canManageMembersIn, memberManagerContext, visibleRoomIds, workspaceForNewRoom } from "@/lib/chat-access"
import { chatUnreadForUser } from "@/lib/chat-unread"
import { announceSystemMessage, systemPeople, writeSystemMessage } from "@/lib/chat-system"
import { emitConversationUpdated } from "@/lib/socket-emitter"

const memberInclude = { members: { select: CHAT_MEMBER_SELECT } }

/**
 * The caller's conversations, most recently active first.
 *
 * Each item: id, type, name, projectId, members (the roster: the iOS @mention picker reads it from
 * here, so it stays — without email), memberCount, lastMessage (a SYSTEM line too, with its `kind` and
 * `event`: clients show the localized sentence — chat-system.ts), unreadCount, mutedUntil (null when not
 * muted), canManageMembers (the caller may add/remove people: GROUP only, Manager and above —
 * chat-rules canManageGroupMembers). The response adds totalUnread (muted rooms count their mentions
 * only — chat-unread.ts).
 *
 * No longer provisions project rooms: that ran two queries per project on every load, and was the
 * only way a project room came to exist. Rooms now follow project/workspace membership changes
 * (lib/chat-membership.ts) and scripts/chat-membership-backfill.cjs covers the rows from before.
 * Rooms the caller can no longer open (they left the project's or the room's workspace) are left out.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true, mutedUntil: true },
    })
    if (memberships.length === 0) return NextResponse.json({ conversations: [], totalUnread: 0 })
    const muteOf = new Map(memberships.map((m) => [m.conversationId, m.mutedUntil]))

    const convos = await prisma.conversation.findMany({
      where: { id: { in: memberships.map((m) => m.conversationId) } },
      select: {
        id: true, type: true, name: true, projectId: true, workspaceId: true,
        project: { select: { name: true, workspaceId: true } },
        ...memberInclude,
      },
      orderBy: { updatedAt: "desc" },
    })
    const visible = await visibleRoomIds(userId, convos.map((c) => ({
      id: c.id,
      type: c.type,
      workspaceId: c.workspaceId,
      projectWorkspaceId: c.project?.workspaceId ?? null,
      memberIds: c.members.map((m) => m.userId),
    })))
    const shown = convos.filter((c) => visible.has(c.id))
    const ids = shown.map((c) => c.id)
    if (ids.length === 0) return NextResponse.json({ conversations: [], totalUnread: 0 })

    // The newest message of each room: one index probe per room (LATERAL), not every message of
    // every room — a nested `take: 1` is not pushed down per parent.
    const lastIds = await prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM "Conversation" c
      CROSS JOIN LATERAL (
        SELECT "Message".id FROM "Message"
         WHERE "Message"."conversationId" = c.id
         ORDER BY "Message"."createdAt" DESC, "Message".id DESC
         LIMIT 1
      ) m
      WHERE c.id IN (${Prisma.join(ids)})`
    const lastMessages = lastIds.length
      ? await prisma.message.findMany({
          where: { id: { in: lastIds.map((r) => r.id) } },
          include: { user: { select: { id: true, name: true } } },
        })
      : []
    const lastOf = new Map(lastMessages.map((m) => [m.conversationId, m]))

    const unread = await chatUnreadForUser(userId, { conversationIds: ids })
    // One lookup for the whole list, and none when there is no group in it.
    const managerCtx = shown.some((c) => c.type === "GROUP") ? await memberManagerContext(userId) : null

    const conversations = shown.map((c) => {
      const mutedUntil = muteOf.get(c.id) ?? null
      return {
        id: c.id,
        type: c.type,
        // A project room is called what its project is called NOW, not what it was called when the
        // room was created.
        name: c.type === "PROJECT" ? (c.project?.name ?? c.name) : c.name,
        projectId: c.projectId,
        members: c.members,
        memberCount: c.members.length,
        lastMessage: lastOf.get(c.id) ?? null,
        unreadCount: unread.perConversation.get(c.id)?.unread ?? 0,
        mutedUntil: mutedUntil && mutedUntil.getTime() > Date.now() ? mutedUntil.toISOString() : null,
        canManageMembers: managerCtx ? canManageMembersIn(managerCtx, c) : false,
      }
    })

    return NextResponse.json({ conversations, totalUnread: unread.totalUnread })
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

    // Only people the caller shares at least one workspace with. Otherwise anyone who signs up could
    // open a chat with (and push notifications to) any account whose id they learn.
    const myWorkspaceIds = (
      await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
    ).map((m) => m.workspaceId)
    const reachable = await prisma.workspaceMember.findMany({
      where: { userId: { in: others }, workspaceId: { in: myWorkspaceIds } },
      select: { userId: true },
    })
    const reachableIds = new Set(reachable.map((m) => m.userId))
    if (others.some((u) => !reachableIds.has(u))) {
      return NextResponse.json({ error: "Kamu cuma bisa ngobrol dengan orang yang satu workspace denganmu." }, { status: 403 })
    }

    // DM dedupe: find an existing 1:1 between exactly these two users.
    if (type === "DM" && others.length === 1) {
      const existing = await prisma.conversation.findFirst({
        where: { type: "DM", members: { every: { userId: { in: [userId, others[0]] } } }, AND: [{ members: { some: { userId } } }, { members: { some: { userId: others[0] } } }] },
        include: memberInclude,
      })
      if (existing && (existing.members?.length ?? 0) === 2) return NextResponse.json({ conversation: existing })
    }

    const allMembers = Array.from(new Set([userId, ...others]))
    // The workspace this room belongs to (every participant is in it): leaving that workspace later
    // takes a person out of the room (lib/chat-membership.ts). Null when it spans workspaces.
    const workspaceId = await workspaceForNewRoom(userId, others)
    const isGroup = type === "GROUP"
    // A new group opens with its own log line, "Bagas created the group “QA”", written with it: the
    // people put in it get one push each from that line (chat-system.ts). A DM has none.
    const { conversation, system } = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          type: isGroup ? "GROUP" : "DM",
          name: isGroup ? (name?.trim() || null) : null,
          workspaceId,
          members: { create: allMembers.map((uid) => ({ userId: uid })) },
        },
        include: memberInclude,
      })
      if (!isGroup) return { conversation: created, system: null }
      const [actor, ...targets] = await systemPeople(tx, allMembers)
      const system = await writeSystemMessage(tx, {
        conversationId: created.id,
        actorId: userId,
        event: { type: "group_created", actor, targets, ...(created.name ? { name: created.name } : {}) },
      })
      return { conversation: created, system }
    })
    if (system) {
      announceSystemMessage({ conversationId: conversation.id, message: system, memberIds: allMembers })
    } else {
      emitConversationUpdated(allMembers, { conversationId: conversation.id, lastMessageAt: null, reason: "membership" })
    }
    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    console.error("conversations POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
