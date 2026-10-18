import prisma from "@/lib/prisma"
import { checkProjectAccess, hasProjectLevel, hasProjectWideAccess } from "@/lib/rbac"
import { canManageGroupMembers, commonWorkspace, groupRoomAllows } from "@/lib/chat-rules"
import { CHAT_FILE_PREFIX, CHAT_STORED_NAME, pickChatFileCarrier, type ChatFileCarrier } from "@/lib/chat-files"

/**
 * Who may read and write a conversation.
 *
 *   PROJECT  the project decides (checkProjectAccess MEMBER) — unchanged: a BoD/Manager can open any
 *            project room of their workspace, staff only the projects they are in.
 *   GROUP/DM a ConversationMember row AND still being in the room's workspace (chat-rules
 *            groupRoomAllows). Until 8 Oct 2026 the row alone was enough, so someone removed from the
 *            company kept reading and writing every DM and group they had ever been in.
 */

/** The member row shape every chat route returns: no email, no other person's mute state. */
export const CHAT_MEMBER_SELECT = {
  id: true,
  conversationId: true,
  userId: true,
  joinedAt: true,
  lastReadAt: true,
  user: { select: { id: true, name: true, avatar: true } },
} as const

/**
 * What every message the chat API hands out carries (list pages, a sent message, socket
 * message-created): the scalars — kind and event included — the author, and just enough of a quoted
 * message to draw its preview.
 */
export const CHAT_MESSAGE_INCLUDE = {
  user: { select: { id: true, name: true, avatar: true } },
  // Just enough of the quoted message to render a preview: its text, the picture's thumbnail
  // (attachmentUrl, 8 Oct 2026 — the quoted message is in the same room) and who wrote it.
  replyTo: {
    select: {
      id: true,
      content: true,
      attachmentUrl: true,
      attachmentType: true,
      // A quoted document reads as its name (18 Oct 2026).
      attachmentName: true,
      attachmentSize: true,
      user: { select: { id: true, name: true } },
    },
  },
} as const

export type ConversationAccess =
  | {
      ok: true
      status: 200
      convo: { id: string; type: "DM" | "GROUP" | "PROJECT"; projectId: string | null; workspaceId: string | null; name: string | null }
      /** The caller's own member row, when there is one (a BoD reading a project room may have none). */
      member: { id: string; lastReadAt: Date | null; mutedUntil: Date | null } | null
    }
  | { ok: false; status: 403 | 404 }

export async function workspaceIdsOf(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(userIds.map((id) => [id, []]))
  if (userIds.length === 0) return out
  const rows = await prisma.workspaceMember.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, workspaceId: true },
  })
  for (const r of rows) out.get(r.userId)?.push(r.workspaceId)
  return out
}

/** GROUP/DM rule for one user, reading what it needs. */
export async function groupRoomAllowsUser(
  conversationId: string,
  roomWorkspaceId: string | null,
  userId: string,
): Promise<boolean> {
  if (roomWorkspaceId) {
    const m = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: roomWorkspaceId } },
      select: { id: true },
    })
    return Boolean(m)
  }
  const others = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  })
  const ws = await workspaceIdsOf([userId, ...others.map((o) => o.userId)])
  return groupRoomAllows({
    roomWorkspaceId: null,
    userWorkspaceIds: ws.get(userId) ?? [],
    otherMembersWorkspaceIds: others.map((o) => ws.get(o.userId) ?? []),
  })
}

export async function conversationAccess(userId: string, conversationId: string): Promise<ConversationAccess> {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, type: true, projectId: true, workspaceId: true, name: true },
  })
  if (!convo) return { ok: false, status: 404 }
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true, lastReadAt: true, mutedUntil: true },
  })
  if (convo.type === "PROJECT" && convo.projectId) {
    // The project's chat room: readable with any access (Notion levels, 13 Oct 2026); POST messages also
    // asks for Can comment (canPostInConversation).
    const allowed = await hasProjectLevel(userId, convo.projectId, "VIEW")
    return allowed ? { ok: true, status: 200, convo, member } : { ok: false, status: 403 }
  }
  if (!member) return { ok: false, status: 403 }
  if (!(await groupRoomAllowsUser(conversationId, convo.workspaceId, userId))) return { ok: false, status: 403 }
  return { ok: true, status: 200, convo, member }
}

/**
 * Like conversationAccess, but the caller must ALSO hold a member row — for what only a member has
 * (read position, mute). A BoD looking into a project room they are not in has nothing to mark.
 */
export async function conversationMemberAccess(userId: string, conversationId: string): Promise<ConversationAccess> {
  const access = await conversationAccess(userId, conversationId)
  if (access.ok && !access.member) return { ok: false, status: 403 }
  return access
}

/**
 * What decides whether someone may add or remove people in a group: their role in every workspace
 * they are in. One query, so the conversation list answers `canManageMembers` for
 * every row from it instead of a lookup per row.
 */
export type MemberManagerContext = { roleIn: Map<string, string> }

export async function memberManagerContext(userId: string): Promise<MemberManagerContext> {
  const members = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true } })
  return { roleIn: new Map(members.map((m) => [m.workspaceId, m.role] as const)) }
}

/**
 * chat-rules canManageGroupMembers for one room, with the caller's role in THAT room's workspace.
 * `targetIsSelf`: the caller is taking themselves out (leaving), which anyone may.
 */
export function canManageMembersIn(
  ctx: MemberManagerContext,
  room: { type: string; workspaceId: string | null },
  targetIsSelf = false,
): boolean {
  return canManageGroupMembers({
    kind: room.type,
    callerWorkspaceRole: room.workspaceId ? (ctx.roleIn.get(room.workspaceId) ?? null) : null,
    targetIsSelf,
  })
}

/** Same, for a single room: no query at all unless the room is a GROUP. */
export async function canManageMembersOf(userId: string, room: { type: string; workspaceId: string | null }): Promise<boolean> {
  if (room.type !== "GROUP") return false
  return canManageMembersIn(await memberManagerContext(userId), room)
}

/** The workspace a new GROUP/DM between these people belongs to (chat-rules commonWorkspace). */
export async function workspaceForNewRoom(creatorId: string, participantIds: string[]): Promise<string | null> {
  const everyone = Array.from(new Set([creatorId, ...participantIds]))
  const ws = await workspaceIdsOf(everyone)
  const creatorOrder = await prisma.workspaceMember.findMany({
    where: { userId: creatorId },
    orderBy: { joinedAt: "asc" },
    select: { workspaceId: true },
  })
  return commonWorkspace(everyone.map((id) => ws.get(id) ?? []), creatorOrder.map((m) => m.workspaceId))
}

export type RoomForVisibility = {
  id: string
  type: "DM" | "GROUP" | "PROJECT"
  workspaceId: string | null
  /** The project's workspace, for PROJECT rooms. */
  projectWorkspaceId: string | null
  memberIds: string[]
}

/**
 * Which of a member's rooms they may still see, in two queries for the whole list. The list must hide
 * what the room itself would refuse: its name and last message are content too.
 *
 * PROJECT: the project's workspace must be one of yours (checkProjectAccess says no otherwise).
 * GROUP/DM: chat-rules groupRoomAllows.
 */
export async function visibleRoomIds(userId: string, rooms: RoomForVisibility[]): Promise<Set<string>> {
  const visible = new Set<string>()
  if (rooms.length === 0) return visible
  const mine = (await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })).map((m) => m.workspaceId)
  const mineSet = new Set(mine)
  // Only rooms without a workspace of their own need the other members' workspaces.
  const needOthers = Array.from(new Set(
    rooms.filter((r) => r.type !== "PROJECT" && !r.workspaceId).flatMap((r) => r.memberIds.filter((id) => id !== userId)),
  ))
  const othersWs = await workspaceIdsOf(needOthers)
  for (const r of rooms) {
    if (r.type === "PROJECT") {
      if (r.projectWorkspaceId && mineSet.has(r.projectWorkspaceId)) visible.add(r.id)
      continue
    }
    const ok = groupRoomAllows({
      roomWorkspaceId: r.workspaceId,
      userWorkspaceIds: mine,
      otherMembersWorkspaceIds: r.memberIds.filter((id) => id !== userId).map((id) => othersWs.get(id) ?? []),
    })
    if (ok) visible.add(r.id)
  }
  return visible
}

/** The caller's rooms they may still see (ids only) — for counts that must match the list. */
export async function visibleConversationIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    select: {
      conversation: {
        select: { id: true, type: true, workspaceId: true, project: { select: { workspaceId: true } }, members: { select: { userId: true } } },
      },
    },
  })
  const rooms: RoomForVisibility[] = rows.map(({ conversation: c }) => ({
    id: c.id,
    type: c.type,
    workspaceId: c.workspaceId,
    projectWorkspaceId: c.project?.workspaceId ?? null,
    memberIds: c.members.map((m) => m.userId),
  }))
  return Array.from(await visibleRoomIds(userId, rooms))
}

/** Posting in a room: a project room needs Can comment or more (Can view reads only). Other rooms: as access. */
export async function canPostInConversation(userId: string, convo: { type: string; projectId: string | null }): Promise<boolean> {
  if (convo.type === "PROJECT" && convo.projectId) return hasProjectLevel(userId, convo.projectId, "COMMENT")
  return true
}

/** How many messages carrying one file are looked at (a picture forwarded into many rooms). */
const CHAT_FILE_CARRIER_CAP = 25

/**
 * Who may load a chat file (/api/files/chat/…, pictures and documents alike): someone who can read
 * the conversation of a message that carries it — conversationAccess, for every room kind.
 *
 * Pictures are drawn many times per screen (thread, list preview, quotes, the info screen's grid), so
 * the common case is ONE query: the carriers found through the partial index Message_attachmentUrl_idx,
 * each with the caller's member row, workspace membership and project membership beside it (all
 * unique-index lookups), judged by chat-files chatCarrierVerdict. Only a group/DM without a workspace
 * of its own (rooms from before 8 Oct 2026 spanning workspaces) asks conversationAccess itself.
 *
 * Returns the carrier that lets the caller in, or null: no message carries the file (not sent yet,
 * or its message / group deleted), or none of their rooms are the caller's to read.
 */
export async function chatFileCarrierFor(userId: string, url: string): Promise<ChatFileCarrier | null> {
  const rows = await prisma.$queryRaw<ChatFileCarrier[]>`
    SELECT m."conversationId" AS "conversationId",
           m."attachmentName" AS "attachmentName",
           c."type"::text AS "type",
           c."projectId" AS "projectId",
           c."workspaceId" AS "roomWorkspaceId",
           EXISTS (SELECT 1 FROM "ConversationMember" cm WHERE cm."conversationId" = c."id" AND cm."userId" = ${userId}) AS "isMember",
           (c."workspaceId" IS NOT NULL AND EXISTS (
             SELECT 1 FROM "WorkspaceMember" wm WHERE wm."workspaceId" = c."workspaceId" AND wm."userId" = ${userId})) AS "inRoomWorkspace",
           (SELECT pw."role"::text FROM "Project" p JOIN "WorkspaceMember" pw ON pw."workspaceId" = p."workspaceId" AND pw."userId" = ${userId}
             WHERE p."id" = c."projectId") AS "projectWorkspaceRole",
           (c."projectId" IS NOT NULL AND EXISTS (
             SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = c."projectId" AND pm."userId" = ${userId})) AS "isProjectMember"
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
     WHERE m."attachmentUrl" = ${url}
     ORDER BY m."createdAt" ASC
     LIMIT ${CHAT_FILE_CARRIER_CAP}`
  const { carrier, ask } = pickChatFileCarrier(rows, hasProjectWideAccess)
  if (carrier) return carrier
  for (const r of ask) {
    if ((await conversationAccess(userId, r.conversationId)).ok) return r
  }
  return null
}

/**
 * Whether this person uploaded this chat file (`/api/files/chat/<name>`): the upload route's audit row
 * (entityType "chat_attachment", entityId = the stored name) is the record of who wrote it. `sinceMs`
 * limits it to recent uploads. Found through the AuditLog userId index; asked only when no message
 * carries the file.
 */
export async function uploadedChatFile(userId: string, url: string, sinceMs?: number): Promise<boolean> {
  if (!url.startsWith(CHAT_FILE_PREFIX)) return false
  const name = url.slice(CHAT_FILE_PREFIX.length)
  if (!CHAT_STORED_NAME.test(name)) return false
  const row = await prisma.auditLog.findFirst({
    where: {
      userId,
      entityType: "chat_attachment",
      action: "create",
      entityId: name,
      ...(sinceMs ? { createdAt: { gte: new Date(Date.now() - sinceMs) } } : {}),
    },
    select: { id: true },
  })
  return Boolean(row)
}
