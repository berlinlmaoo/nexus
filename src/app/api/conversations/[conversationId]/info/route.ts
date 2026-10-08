import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { canManageMembersOf, conversationAccess } from "@/lib/chat-access"
import { mediaCounts } from "@/lib/chat-media"
import { canDeleteGroup, isRoomAdmin, MESSAGE_KIND_SYSTEM, orderInfoMembers } from "@/lib/chat-rules"

/**
 * The group info screen, like WhatsApp's (SYSTEM-MESSAGES contract, Part 2, owner 8 Oct 2026).
 *
 * GET /api/conversations/:id/info →
 *   { conversation: { id, type, name, description, projectId, createdAt, createdBy: {id,name} | null,
 *                     memberCount, mutedUntil, canManageMembers, canEdit, canDelete },
 *     members: [{ userId, name, avatar, isMe, isAdmin, deactivatedAt }],   // admins first, then A–Z
 *     counts: { photos, links, docs } }                                    // each capped at 999
 *
 * Same access as the messages route (conversationAccess): a project room by the project's rules, a
 * group/DM by a member row while still in the room's workspace.
 *
 *   isAdmin    MANAGER, BOD or ONE_ABOVE_ALL in the room's workspace, or a system admin — the people who
 *              may add and remove members (owner, 8 Oct 2026). A room without a workspace: admins only.
 *   canEdit    may change the name and the description: any member of a GROUP. Project rooms and DMs: no.
 *   canDelete  may delete the group (DELETE /api/conversations/:id, 9 Oct 2026): canManageMembers, or
 *              being its only remaining member — who can no longer leave it (LAST_MEMBER). GROUP only.
 *   createdBy  the author of the group's "created the group" line; null for groups from before those
 *              lines existed, and for DMs and project rooms.
 *   name       a project room is called what its project is called now (as in the list).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const { conversationId } = await params
    const access = await conversationAccess(userId, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })

    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, type: true, name: true, description: true, projectId: true, workspaceId: true, createdAt: true,
        project: { select: { name: true } },
        members: { select: { userId: true, user: { select: { id: true, name: true, avatar: true, deactivatedAt: true, role: true } } } },
      },
    })
    if (!convo) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const memberIds = convo.members.map((m) => m.userId)
    const [roles, created, counts, canManageMembers] = await Promise.all([
      convo.workspaceId && memberIds.length
        ? prisma.workspaceMember.findMany({
            where: { workspaceId: convo.workspaceId, userId: { in: memberIds } },
            select: { userId: true, role: true },
          })
        : Promise.resolve([] as Array<{ userId: string; role: string }>),
      convo.type === "GROUP"
        ? prisma.message.findFirst({
            where: { conversationId, kind: MESSAGE_KIND_SYSTEM, event: { path: ["type"], equals: "group_created" } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { user: { select: { id: true, name: true } } },
          })
        : Promise.resolve(null),
      mediaCounts(conversationId),
      canManageMembersOf(userId, convo),
    ])
    const roleOf = new Map(roles.map((r) => [r.userId, r.role as string]))

    const members = orderInfoMembers(
      convo.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        avatar: m.user.avatar,
        isMe: m.userId === userId,
        isAdmin: isRoomAdmin({ workspaceRole: roleOf.get(m.userId) ?? null, systemRole: m.user.role }),
        deactivatedAt: m.user.deactivatedAt,
      })),
    )

    const mutedUntil = access.member?.mutedUntil && access.member.mutedUntil.getTime() > Date.now()
      ? access.member.mutedUntil.toISOString()
      : null

    return NextResponse.json({
      conversation: {
        id: convo.id,
        type: convo.type,
        name: convo.type === "PROJECT" ? (convo.project?.name ?? convo.name) : convo.name,
        description: convo.description,
        projectId: convo.projectId,
        createdAt: convo.createdAt,
        createdBy: created?.user ? { id: created.user.id, name: created.user.name } : null,
        memberCount: members.length,
        mutedUntil,
        canManageMembers,
        canEdit: convo.type === "GROUP" && !!access.member,
        canDelete: canDeleteGroup({ kind: convo.type, canManageMembers, isMember: !!access.member, memberCount: members.length }),
      },
      members,
      counts,
    })
  } catch (error) {
    console.error("conversation info GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
