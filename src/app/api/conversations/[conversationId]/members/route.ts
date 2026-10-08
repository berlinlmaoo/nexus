import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { CHAT_MEMBER_SELECT, canManageMembersIn, groupRoomAllowsUser, memberManagerContext } from "@/lib/chat-access"
import { MANAGER_REQUIRED, MANAGER_REQUIRED_MESSAGE } from "@/lib/chat-rules"
import { announceSystemMessage, systemPeople, writeSystemMessage } from "@/lib/chat-system"
import { emitConversationMembersRemoved } from "@/lib/socket-emitter"

const memberInclude = {
  members: { select: CHAT_MEMBER_SELECT },
}

/**
 * Add and remove people in a GROUP conversation.
 *
 * Only GROUP. A DM is two people by definition — growing one would silently turn a private
 * conversation into a room its two participants never agreed to. A PROJECT room derives its
 * membership from the project, so the way to add someone there is to add them to the project;
 * writing a member row here would be undone the next time the room is provisioned.
 *
 * Who (owner decision, 8 Oct 2026): adding anyone, or removing anyone other than yourself, takes
 * Manager, BoD or One Above All in the group's workspace, or a system admin (chat-rules
 * canManageGroupMembers); everyone else gets 403 MANAGER_REQUIRED. Leaving — DELETE with your own
 * userId — stays open to every member. Until then any member could add or remove anyone. Creating a
 * group with its first members (POST /api/conversations) is unchanged.
 *
 * Each change leaves a log line in the group, in the same transaction (chat-system.ts): "Bagas added
 * Mey and Yuza" (only the people really added), "Bagas removed Mey", "Mey left". The people added get
 * one push each from that line — it replaces the "X added you to Y" Inbox notification written here
 * until then.
 */
async function loadGroup(conversationId: string, userId: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, type: true, name: true, workspaceId: true, updatedAt: true, members: { select: { userId: true } } },
  })
  if (!convo) return { error: "Not found", status: 404 as const }
  if (convo.type !== "GROUP") {
    return { error: "Only group chats can change members", status: 400 as const }
  }
  if (!convo.members.some((m) => m.userId === userId)) {
    return { error: "Forbidden", status: 403 as const }
  }
  // A member who has since left the group's workspace has no say over it either.
  if (!(await groupRoomAllowsUser(conversationId, convo.workspaceId, userId))) {
    return { error: "Forbidden", status: 403 as const }
  }
  return { convo }
}

function managerRequired() {
  return NextResponse.json({ error: MANAGER_REQUIRED_MESSAGE, code: MANAGER_REQUIRED }, { status: 403 })
}

/**
 * Who may be added: people in the group's own workspace when it has one; otherwise (groups from before
 * 8 Oct 2026) anyone the caller shares a workspace with.
 */
async function reachableUserIds(userId: string, groupWorkspaceId: string | null) {
  const mine = groupWorkspaceId
    ? [{ workspaceId: groupWorkspaceId }]
    : await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
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
    // Adding people is a Manager-and-above act (owner, 8 Oct 2026).
    const manages = canManageMembersIn(await memberManagerContext(userId), convo)
    if (!manages) return managerRequired()

    const body = await req.json().catch(() => null)
    const requested: string[] = Array.isArray(body?.userIds)
      ? body.userIds.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
    if (requested.length === 0) return NextResponse.json({ error: "userIds required" }, { status: 400 })

    const reachable = await reachableUserIds(userId, convo.workspaceId)
    const already = new Set(convo.members.map((m) => m.userId))
    const toAdd = Array.from(new Set(requested)).filter((id) => reachable.has(id) && !already.has(id))

    let added: string[] = []
    if (toAdd.length > 0) {
      // Only the rows this call really inserted: someone added a moment ago by another request is
      // skipped here and is not named twice in the log.
      const system = await prisma.$transaction(async (tx) => {
        const rows = await tx.conversationMember.createManyAndReturn({
          data: toAdd.map((uid) => ({ conversationId, userId: uid })),
          skipDuplicates: true,
          select: { userId: true },
        })
        const inserted = new Set(rows.map((r) => r.userId))
        added = toAdd.filter((id) => inserted.has(id))
        if (added.length === 0) return null
        const [actor, ...targets] = await systemPeople(tx, [userId, ...added])
        return writeSystemMessage(tx, { conversationId, actorId: userId, event: { type: "members_added", actor, targets } })
      })
      if (system) {
        announceSystemMessage({
          conversationId,
          message: system,
          memberIds: Array.from(new Set([...convo.members.map((m) => m.userId), ...added])),
        })
      }
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: memberInclude,
    })
    return NextResponse.json({
      conversation: conversation ? { ...conversation, canManageMembers: manages } : conversation,
      added: added.length,
    })
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

    // Removing someone else is a Manager-and-above act (owner, 8 Oct 2026); leaving is anyone's.
    const manages = canManageMembersIn(await memberManagerContext(userId), convo)
    if (target !== userId && !manages) return managerRequired()

    // A group that loses its last member becomes a room nobody can reach but that still holds every
    // message ever sent in it. Refuse rather than orphan it.
    if (convo.members.length <= 1) {
      return NextResponse.json({ error: "A group needs at least one member" }, { status: 400 })
    }

    // The removal and its log line ("Bagas removed Mey" / "Mey left") together, or neither.
    const system = await prisma.$transaction(async (tx) => {
      const { count } = await tx.conversationMember.deleteMany({ where: { conversationId, userId: target } })
      if (count === 0) return null
      const leaving = target === userId
      const [actor, removed] = await systemPeople(tx, leaving ? [userId] : [userId, target])
      return writeSystemMessage(tx, {
        conversationId,
        actorId: userId,
        event: leaving
          ? { type: "member_left", actor, targets: [actor] }
          : { type: "member_removed", actor, targets: [removed] },
      })
    })
    if (system) {
      // Out of the room's socket at once; the line reaches who is still in it, and every member's
      // list (the one who left included) refreshes.
      emitConversationMembersRemoved(conversationId, [target])
      announceSystemMessage({
        conversationId,
        message: system,
        memberIds: convo.members.map((m) => m.userId).filter((id) => id !== target),
        alsoUserIds: [target],
      })
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: memberInclude,
    })
    return NextResponse.json({ conversation: conversation ? { ...conversation, canManageMembers: manages } : conversation })
  } catch (error) {
    console.error("conversation members DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
