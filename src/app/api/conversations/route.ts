import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { resolveLegacyIds } from "@/lib/legacy-ids"
import { CHAT_MEMBER_SELECT, canManageMembersIn, memberManagerContext, visibleRoomIds, workspaceForNewRoom } from "@/lib/chat-access"
import { chatUnreadForUser } from "@/lib/chat-unread"
import { announceSystemMessage, systemPeople, writeSystemMessage } from "@/lib/chat-system"
import { emitConversationUpdated } from "@/lib/socket-emitter"
import { hasProjectWideAccess, memberAccessLevel } from "@/lib/rbac"
import { clientDrawsChatFiles, shapeForOldApp } from "@/lib/chat-files"

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
export async function GET(req: NextRequest) {
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
    const visibleConvos = convos.filter((c) => visible.has(c.id))
    // DMs left with only the caller (UI round 19 Oct 2026, U-8). The other person's membership row went
    // when their account was deleted (FK cascade) or when they left the room's workspace
    // (chat-membership syncUserRooms). The list titled such a room "Direct message" with initials "DM".
    // Who it was with is read back from who wrote in it; an empty one with nobody to name is left out.
    const loneDmIds = visibleConvos
      .filter((c) => c.type === "DM" && !c.members.some((m) => m.userId !== userId))
      .map((c) => c.id)
    const formerPeer = new Map<string, { id: string; name: string | null; avatar: string | null }>()
    const loneWithMessages = new Set<string>()
    if (loneDmIds.length) {
      const authors = await prisma.$queryRaw<{ conversationId: string; userId: string | null }[]>`
        SELECT DISTINCT ON (m."conversationId") m."conversationId", m."userId"
          FROM "Message" m
         WHERE m."conversationId" IN (${Prisma.join(loneDmIds)})
           AND m."userId" IS DISTINCT FROM ${userId}
         ORDER BY m."conversationId", m."createdAt" DESC`
      const people = await prisma.user.findMany({
        where: { id: { in: authors.map((a) => a.userId).filter((u): u is string => !!u) } },
        select: { id: true, name: true, avatar: true },
      })
      const byId = new Map(people.map((u) => [u.id, u]))
      for (const a of authors) {
        const u = a.userId ? byId.get(a.userId) : null
        if (u) formerPeer.set(a.conversationId, u)
      }
      const anyMessage = await prisma.message.groupBy({ by: ["conversationId"], where: { conversationId: { in: loneDmIds } }, _count: { _all: true } })
      for (const g of anyMessage) loneWithMessages.add(g.conversationId)
    }
    const shown = visibleConvos.filter(
      (c) => !loneDmIds.includes(c.id) || loneWithMessages.has(c.id) || !!c.name?.trim() || formerPeer.has(c.id),
    )
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
    // An app that only knows pictures reads a document as its name (chat-files.ts, 18 Oct 2026).
    const drawsFiles = clientDrawsChatFiles(req.headers.get("x-nexus-client"), req.headers.get("x-nexus-caps"))
    const lastOf = new Map(lastMessages.map((m) => [m.conversationId, drawsFiles ? m : shapeForOldApp(m)]))

    const unread = await chatUnreadForUser(userId, { conversationIds: ids })
    // One lookup for the whole list, and none when there is no group in it.
    const managerCtx = shown.some((c) => c.type === "GROUP") ? await memberManagerContext(userId) : null

    // Project rooms the viewer may only READ (Can view, Notion levels 13 Oct 2026): the composer says
    // "View only" instead of failing on send. One query for the whole list.
    const projectRoomIds = shown.filter((c) => c.type === "PROJECT" && c.projectId).map((c) => c.projectId as string)
    const viewOnly = new Set<string>()
    if (projectRoomIds.length) {
      const [mine, me] = await Promise.all([
        prisma.projectMember.findMany({ where: { userId, projectId: { in: projectRoomIds } }, select: { projectId: true, role: true, accessLevel: true } }),
        prisma.workspaceMember.findMany({ where: { userId }, select: { role: true } }),
      ])
      const wide = me.some((m) => hasProjectWideAccess(m.role))
      if (!wide) for (const m of mine) if (memberAccessLevel(m) === "VIEW") viewOnly.add(m.projectId)
    }

    const conversations = shown.map((c) => {
      const mutedUntil = muteOf.get(c.id) ?? null
      const other = c.type === "DM" ? c.members.find((m) => m.userId !== userId) : undefined
      const former = c.type === "DM" && !other ? formerPeer.get(c.id) ?? null : null
      return {
        id: c.id,
        type: c.type,
        // A project room is called what its project is called NOW, not what it was called when the
        // room was created. A DM whose other member is gone is called after them (U-8, 19 Oct 2026):
        // every client falls back to `name` when it finds no other member.
        name: c.type === "PROJECT" ? (c.project?.name ?? c.name) : c.name?.trim() ? c.name : former?.name ?? c.name,
        projectId: c.projectId,
        members: c.members,
        memberCount: c.members.length,
        lastMessage: lastOf.get(c.id) ?? null,
        unreadCount: unread.perConversation.get(c.id)?.unread ?? 0,
        mutedUntil: mutedUntil && mutedUntil.getTime() > Date.now() ? mutedUntil.toISOString() : null,
        canManageMembers: managerCtx ? canManageMembersIn(managerCtx, c) : false,
        // false = a project room this person can read but not post in (Can view).
        canPost: !(c.projectId && viewOnly.has(c.projectId)),
        // DM only (since 19 Oct 2026): the other person, or — when they are no longer in it — the last
        // one who wrote in it, with left: true. null when there is nobody to name.
        ...(c.type === "DM"
          ? {
              peer: other?.user
                ? { id: other.userId, name: other.user.name ?? null, avatar: other.user.avatar ?? null, left: false }
                : former
                ? { id: former.id, name: former.name, avatar: former.avatar, left: true }
                : null,
            }
          : {}),
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
    const { type, userIds, name } = ((await req.json().catch(() => null)) ?? {}) as Record<string, any>
    // Released apps may still hold ids from before the UUIDv7 conversion (cached people lists, old links):
    // resolve them here, because the reachability check below compares the ids in JS, not in Prisma.
    const asked: string[] = Array.isArray(userIds) ? userIds.filter((u: unknown): u is string => typeof u === "string" && !!u) : []
    const legacy = await resolveLegacyIds(asked)
    const others: string[] = Array.from(new Set(asked.map((u) => legacy.get(u) ?? u))).filter((u) => u !== userId)
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
    const isDm = type === "DM" && others.length === 1
    const findDm = (db: Prisma.TransactionClient | typeof prisma) =>
      db.conversation.findFirst({
        where: { type: "DM", members: { every: { userId: { in: [userId, others[0]] } } }, AND: [{ members: { some: { userId } } }, { members: { some: { userId: others[0] } } }] },
        include: memberInclude,
        orderBy: { createdAt: "asc" },
      })
    if (isDm) {
      const existing = await findDm(prisma)
      if (existing && (existing.members?.length ?? 0) === 2) return NextResponse.json({ conversation: existing })
    }

    const allMembers = Array.from(new Set([userId, ...others]))
    // The workspace this room belongs to (every participant is in it): leaving that workspace later
    // takes a person out of the room (lib/chat-membership.ts). Null when it spans workspaces.
    const workspaceId = await workspaceForNewRoom(userId, others)
    const isGroup = type === "GROUP"
    // A new group opens with its own log line, "Budi created the group “QA”", written with it: the
    // people put in it get one push each from that line (chat-system.ts). A DM has none.
    const { conversation, system, reused, rejoined } = await prisma.$transaction(async (tx): Promise<{
      conversation: Prisma.ConversationGetPayload<{ include: typeof memberInclude }>
      system: Awaited<ReturnType<typeof writeSystemMessage>> | null
      reused: boolean
      rejoined?: boolean
    }> => {
      // Two taps on "Message", or both people opening a DM to each other at the same moment, used to make
      // two DMs (QA final 19 Oct 2026: 10 parallel requests -> 8 rooms). One lock per pair, then look again.
      if (isDm) {
        const pair = [userId, others[0]].sort().join("|")
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dm|${pair}`})::int8)`
        const existing = await findDm(tx)
        if (existing && (existing.members?.length ?? 0) === 2) return { conversation: existing, system: null, reused: true }
        // The DM these two had before one of them left the workspace (chat-membership syncUserRooms takes
        // them out and names the room after them) or was otherwise taken out: it holds both people's
        // messages. Bring the missing one back into it instead of opening a second, empty DM next to it
        // (UI round 19 Oct 2026, U-8: two "Bagas Z" DMs). Found by who wrote in it, since no other row
        // remembers the pair. Only a room where exactly one of the two is still the only member.
        const [former] = await tx.$queryRaw<{ id: string; present: string }[]>`
          SELECT c.id, cm."userId" AS present
            FROM "Conversation" c
            JOIN "ConversationMember" cm ON cm."conversationId" = c.id
           WHERE c.type = 'DM'
             AND cm."userId" IN (${userId}, ${others[0]})
             AND (SELECT count(*) FROM "ConversationMember" x WHERE x."conversationId" = c.id) = 1
             AND EXISTS (
               SELECT 1 FROM "Message" m
                WHERE m."conversationId" = c.id
                  AND m."userId" = CASE WHEN cm."userId" = ${userId} THEN ${others[0]} ELSE ${userId} END
             )
           ORDER BY c."updatedAt" DESC
           LIMIT 1`
        if (former) {
          const missing = former.present === userId ? others[0] : userId
          await tx.$executeRaw`SELECT 1 FROM "Conversation" WHERE id = ${former.id} FOR UPDATE`
          await tx.conversationMember.createMany({ data: [{ conversationId: former.id, userId: missing }], skipDuplicates: true })
          // The name was only ever the absent person's, kept so the one left behind saw who it was with.
          const back = await tx.conversation.update({ where: { id: former.id }, data: { name: null }, include: memberInclude })
          return { conversation: back, system: null, reused: false, rejoined: true }
        }
      }
      const created = await tx.conversation.create({
        data: {
          type: isGroup ? "GROUP" : "DM",
          name: isGroup ? (name?.trim() || null) : null,
          workspaceId,
          members: { create: allMembers.map((uid) => ({ userId: uid })) },
        },
        include: memberInclude,
      })
      if (!isGroup) return { conversation: created, system: null, reused: false, rejoined: false }
      const [actor, ...targets] = await systemPeople(tx, allMembers)
      const system = await writeSystemMessage(tx, {
        conversationId: created.id,
        actorId: userId,
        event: { type: "group_created", actor, targets, ...(created.name ? { name: created.name } : {}) },
      })
      return { conversation: created, system, reused: false, rejoined: false }
    })
    if (reused) return NextResponse.json({ conversation })
    if (rejoined) {
      emitConversationUpdated(allMembers, { conversationId: conversation.id, lastMessageAt: null, reason: "membership" })
      return NextResponse.json({ conversation })
    }
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
