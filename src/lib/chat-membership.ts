import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { isDeletedAccountEmail } from "@/lib/account-deletion"
import { groupRoomAllows } from "@/lib/chat-rules"
import { emitConversationMembersRemoved, emitConversationUpdated } from "@/lib/socket-emitter"

/**
 * Keeps ConversationMember in step with who may actually be in a room (CHAT-CONTRACT "Membership").
 *
 * Until 8 Oct 2026 project rooms were provisioned inside GET /api/conversations (two queries per
 * project on every list load) and nothing ever removed a row: someone taken off a project, or out of
 * the company, kept the room in their list, kept getting a push for every message and could keep
 * listening on its socket. Now:
 *
 *   syncProjectRoom(projectId)  after any change to a project's members (add, remove, team link,
 *                               create, duplicate, import): the room has exactly the project members
 *                               who are still in the project's workspace. Creates the room if missing.
 *   syncUserRooms(userId)       after a person joins or leaves a workspace (or a team, or deletes their
 *                               account): every project room and every group/DM of theirs re-checked.
 *
 * Both are idempotent, and scripts/chat-membership-backfill.cjs applies the same rules once to the
 * rows written before this existed. The *Safe wrappers never throw: a membership change must not fail
 * because the chat could not follow it — the backfill can always be re-run.
 */

const log = createLogger("chat-membership")

export type RoomSync = { conversationId: string | null; created: boolean; added: string[]; removed: string[] }

function lastMessageAtOf(updatedAt: Date | null | undefined): string | null {
  return updatedAt ? updatedAt.toISOString() : null
}

/** The project's room has exactly the project members who are in the project's workspace. */
export async function syncProjectRoom(projectId: string): Promise<RoomSync> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, workspaceId: true, members: { select: { userId: true } } },
  })
  if (!project) return { conversationId: null, created: false, added: [], removed: [] }

  const memberIds = Array.from(new Set(project.members.map((m) => m.userId)))
  const inWorkspace = memberIds.length
    ? await prisma.workspaceMember.findMany({
        where: { workspaceId: project.workspaceId, userId: { in: memberIds } },
        select: { userId: true },
      })
    : []
  const entitled = new Set(inWorkspace.map((r) => r.userId))

  const roomSelect = { id: true, workspaceId: true, updatedAt: true, members: { select: { userId: true } } } as const
  let room = await prisma.conversation.findUnique({ where: { projectId }, select: roomSelect })
  if (!room) {
    if (entitled.size === 0) return { conversationId: null, created: false, added: [], removed: [] }
    try {
      room = await prisma.conversation.create({
        data: {
          type: "PROJECT",
          projectId,
          name: project.name,
          workspaceId: project.workspaceId,
          members: { create: Array.from(entitled).map((userId) => ({ userId })) },
        },
        select: roomSelect,
      })
      const added = Array.from(entitled)
      emitConversationUpdated(added, { conversationId: room.id, lastMessageAt: null, reason: "membership" })
      return { conversationId: room.id, created: true, added, removed: [] }
    } catch (error) {
      // Two changes to the same project at once: the other one created it. Carry on with theirs.
      if ((error as { code?: string })?.code !== "P2002") throw error
      room = await prisma.conversation.findUnique({ where: { projectId }, select: roomSelect })
      if (!room) throw error
    }
  }

  const current = new Set(room.members.map((m) => m.userId))
  const toAdd = Array.from(entitled).filter((id) => !current.has(id))
  const toRemove = Array.from(current).filter((id) => !entitled.has(id))

  if (toAdd.length) {
    await prisma.conversationMember.createMany({
      data: toAdd.map((userId) => ({ conversationId: room!.id, userId })),
      skipDuplicates: true,
    })
  }
  if (toRemove.length) {
    await prisma.conversationMember.deleteMany({ where: { conversationId: room.id, userId: { in: toRemove } } })
  }
  if (room.workspaceId !== project.workspaceId) {
    await prisma.conversation.update({ where: { id: room.id }, data: { workspaceId: project.workspaceId } })
  }

  const lastMessageAt = lastMessageAtOf(room.updatedAt)
  if (toRemove.length) emitConversationMembersRemoved(room.id, toRemove)
  if (toAdd.length || toRemove.length) {
    emitConversationUpdated([...toAdd, ...toRemove], { conversationId: room.id, lastMessageAt, reason: "membership" })
    log.info("project room synced", { projectId, conversationId: room.id, added: toAdd.length, removed: toRemove.length })
  }
  return { conversationId: room.id, created: false, added: toAdd, removed: toRemove }
}

/**
 * Every room of one person re-checked: project rooms against their project memberships and
 * workspaces, groups and DMs against chat-rules groupRoomAllows.
 *
 * A deleted account keeps its group/DM rows on purpose (the history stays readable with its name, and
 * the account cannot sign in any more); it still leaves project rooms, as it left the projects.
 *
 * A DM whose counterpart is removed keeps their name as its own: every client titles a DM after "the
 * other member" and falls back to `name`, so the person left behind still sees who it was with.
 */
export async function syncUserRooms(userId: string): Promise<{ added: string[]; removed: string[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  if (!user) return { added: [], removed: [] }

  const myWorkspaces = new Set(
    (await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })).map((m) => m.workspaceId),
  )
  const projectMemberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true, project: { select: { workspaceId: true } } },
  })
  const entitledProjects = new Set(
    projectMemberships.filter((pm) => myWorkspaces.has(pm.project.workspaceId)).map((pm) => pm.projectId),
  )

  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    select: {
      conversationId: true,
      conversation: {
        select: {
          id: true, type: true, name: true, projectId: true, workspaceId: true, updatedAt: true,
          members: { where: { userId: { not: userId } }, select: { userId: true } },
        },
      },
    },
  })

  const removed: string[] = []
  const added: string[] = []

  // Project rooms: leave the ones no longer entitled to; join (or create) the ones missing.
  const inProjectRooms = new Set<string>()
  for (const r of rows) {
    const c = r.conversation
    if (c.type !== "PROJECT") continue
    if (c.projectId && entitledProjects.has(c.projectId)) {
      inProjectRooms.add(c.projectId)
      continue
    }
    await prisma.conversationMember.deleteMany({ where: { conversationId: c.id, userId } })
    removed.push(c.id)
  }
  for (const projectId of entitledProjects) {
    if (inProjectRooms.has(projectId)) continue
    const room = await prisma.conversation.findUnique({ where: { projectId }, select: { id: true } })
    if (!room) {
      const created = await syncProjectRoom(projectId)
      if (created.conversationId && created.added.includes(userId)) added.push(created.conversationId)
      continue
    }
    await prisma.conversationMember.createMany({ data: [{ conversationId: room.id, userId }], skipDuplicates: true })
    added.push(room.id)
  }

  // Groups and DMs.
  if (!isDeletedAccountEmail(user.email)) {
    const groupRows = rows.filter((r) => r.conversation.type !== "PROJECT")
    const others = Array.from(new Set(groupRows.flatMap((r) => r.conversation.members.map((m) => m.userId))))
    const othersWs = new Map<string, string[]>(others.map((id) => [id, []]))
    if (others.length) {
      const ws = await prisma.workspaceMember.findMany({ where: { userId: { in: others } }, select: { userId: true, workspaceId: true } })
      for (const w of ws) othersWs.get(w.userId)?.push(w.workspaceId)
    }
    for (const r of groupRows) {
      const c = r.conversation
      const allowed = groupRoomAllows({
        roomWorkspaceId: c.workspaceId,
        userWorkspaceIds: myWorkspaces,
        otherMembersWorkspaceIds: c.members.map((m) => othersWs.get(m.userId) ?? []),
      })
      if (allowed) continue
      await prisma.conversationMember.deleteMany({ where: { conversationId: c.id, userId } })
      if (c.type === "DM" && !c.name?.trim()) {
        await prisma.conversation.update({ where: { id: c.id }, data: { name: user.name } })
      }
      removed.push(c.id)
    }
  }

  const byId = new Map(rows.map((r) => [r.conversationId, r.conversation]))
  for (const id of removed) {
    emitConversationMembersRemoved(id, [userId])
    emitConversationUpdated([userId], { conversationId: id, lastMessageAt: lastMessageAtOf(byId.get(id)?.updatedAt), reason: "membership" })
  }
  for (const id of added) {
    emitConversationUpdated([userId], { conversationId: id, lastMessageAt: null, reason: "membership" })
  }
  if (removed.length || added.length) log.info("user rooms synced", { userId, added: added.length, removed: removed.length })
  return { added, removed }
}

export async function syncProjectRoomSafe(projectId: string, why: string): Promise<void> {
  try {
    await syncProjectRoom(projectId)
  } catch (error) {
    log.error("project room sync failed — run scripts/chat-membership-backfill.cjs", { projectId, why, error: String(error) })
  }
}

export async function syncUserRoomsSafe(userId: string, why: string): Promise<void> {
  try {
    await syncUserRooms(userId)
  } catch (error) {
    log.error("user rooms sync failed — run scripts/chat-membership-backfill.cjs", { userId, why, error: String(error) })
  }
}
