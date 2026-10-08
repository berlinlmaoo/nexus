import { Server as IOServer } from "socket.io"
import type { NextApiRequest, NextApiResponse } from "next"
import type { Server as HTTPServer } from "http"
import type { Socket as NetSocket } from "net"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { getToken } from "next-auth/jwt"
import { getSessionCookieName, shouldUseSecureAuthCookies } from "@/lib/session-cookie"
import { createLogger } from "@/lib/logger"
import { resolveSheetAccess } from "@/lib/project-sheets"
import { checkProjectAccess } from "@/lib/rbac"
import prisma from "@/lib/prisma"
import { isDeletedAccountEmail } from "@/lib/account-deletion"
import { sessionVersionRejects } from "@/lib/session-version"
import { conversationMemberAccess } from "@/lib/chat-access"
import { resolveAuditAccess } from "@/lib/audit-query"
import { TypingGate, parseTypingEvent, type TypingRelay } from "@/lib/chat-typing"

const log = createLogger("socket")

interface SocketServer extends HTTPServer {
  io?: IOServer
}

interface SocketWithIO extends NetSocket {
  server: SocketServer
}

export interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO
}

/**
 * Rooms the SERVER puts a socket in on connect, worked out from the database (serverAssignedRooms).
 * A client can never `join-room` any of them: canJoinRoom has no case for `workspace:` and refuses a
 * name without a `<kind>:` prefix.
 *
 *   workspace:<id>  every workspace the user is a WorkspaceMember of
 *   workspace-all   system admins (User.role ADMIN), whose project and folder lists span every workspace
 *   audit           users who pass resolveAuditAccess, i.e. may open Control Room → Audit
 */
const ALL_WORKSPACES_ROOM = "workspace-all"
const AUDIT_ROOM = "audit"
/** A burst of audit writes (a bulk action, a reorder) reaches the audit room as one ping. */
const AUDIT_PING_COALESCE_MS = 250
/** How long a conversation's member list is reused for `typing` before it is read again. */
const TYPING_MEMBERS_TTL_MS = 60_000

const ALLOWED_ORIGINS = [
  process.env.NEXTAUTH_URL || "http://localhost:3000",
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[]

export function initializeSocketServer(
  _req: NextApiRequest,
  res: NextApiResponseWithSocket
) {
  if (res.socket.server.io) {
    res.status(204).end()
    return
  }

  const io = new IOServer(res.socket.server as unknown as HTTPServer, {
    path: "/api/socket",
    addTrailingSlash: false,
    cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true },
    transports: ["polling", "websocket"],
  })

  // Redis adapter for horizontal scaling (optional)
  if (process.env.REDIS_URL) {
    import("@socket.io/redis-adapter").then(({ createAdapter }) => {
      import("ioredis").then(({ default: Redis }) => {
        const pubClient = new Redis(process.env.REDIS_URL!)
        const subClient = pubClient.duplicate()
        io.adapter(createAdapter(pubClient, subClient))
        log.info("Redis adapter enabled for Socket.IO")
      })
    }).catch((err) => {
      log.warn("Redis adapter failed to initialize, using in-memory", { error: String(err) })
    })
  }

  // ── Room & presence management ──────────────────────────────
  const roomPresence = new Map<string, Map<string, { userId: string; name: string; avatar: string | null; color: string; lastSeen: number }>>()

  const COLORS = [
    "#ef4444", "#f97316", "#eab308", "#22c55e",
    "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  ]

  function getColor(idx: number) {
    return COLORS[idx % COLORS.length]
  }

  /**
   * Whether this socket is allowed into a room.
   *
   * Room names come FROM THE CLIENT. The handshake authenticates who you are; nothing before this
   * checked what you may listen to, so any signed-in user could `join-room` on another person's
   * `user:` stream or any `project:` / `conversation:` they have no access to and receive every
   * event broadcast there.
   *
   * Deny-by-default: an unrecognised prefix is refused rather than guessed at. The four below are
   * the only rooms either app actually joins (grep `useRealtimeRoom` / `join-room`).
   */
  async function canJoinRoom(userId: string, room: string): Promise<boolean> {
    // `workspace:<id>`, `workspace-all` and `audit` are not joinable here on purpose: membership in
    // those comes from the database at connect time (serverAssignedRooms), never from a client request.
    const sep = room.indexOf(":")
    if (sep < 1) return false
    const kind = room.slice(0, sep)
    const id = room.slice(sep + 1)
    if (!id) return false

    switch (kind) {
      // Your own notification stream, and nobody else's.
      case "user":
        return id === userId
      case "project":
        return (await checkProjectAccess(userId, id, ["VIEWER"])).allowed
      // A member row, and for a group/DM still being in its workspace (lib/chat-access.ts) — the
      // row alone outlived a removal from the company until 8 Oct 2026.
      case "conversation":
        return (await conversationMemberAccess(userId, id)).ok
      case "sheet":
        return (await resolveSheetAccess(userId, id, ["VIEWER"])).allowed
      default:
        return false
    }
  }

  /**
   * The rooms this user belongs in by who they are, not by what they asked for: one per workspace
   * they are a member of (for `workspace-changed`), every workspace for a system admin (their project
   * list spans them all), and `audit` when they may read the audit log (for `audit-changed`).
   *
   * Best effort: if the lookup fails the socket still connects, just without these rooms, and the
   * views fall back to refetching on their own (focus, navigation, the reconnect catch-up).
   */
  async function serverAssignedRooms(userId: string, isSystemAdmin: boolean): Promise<string[]> {
    try {
      const [memberships, audit] = await Promise.all([
        prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
        resolveAuditAccess(userId),
      ])
      const rooms = memberships.map((m) => `workspace:${m.workspaceId}`)
      if (isSystemAdmin) rooms.push(ALL_WORKSPACES_ROOM)
      if (audit.ok) rooms.push(AUDIT_ROOM)
      return rooms
    } catch (error) {
      log.warn("could not work out workspace/audit rooms; connected without them", { userId, error: String(error) })
      return []
    }
  }

  /**
   * Presence for spreadsheet rooms, as its OWN event.
   *
   * `presence-update` can't be reused: its payload is a bare member array with no room in it, so a
   * client sitting in both `user:<id>` and `sheet:<id>` cannot tell which room an update belongs to
   * — and the 60s sweep emits for every room, so the sheet's peer list would be wiped by the user
   * room's every minute. Adding the room to `presence-update` would change a shape the OLD NEXUS app
   * still consumes (src/hooks/use-presence.ts), so this is a separate, additive event instead.
   */
  /**
   * Who is in a conversation, for `typing` (lib/chat-typing.ts): read once and reused for a minute, and
   * forgotten as soon as its membership changes (the bus events below), so a keystroke never costs a
   * query. Only decides whose chat LIST also hears it; who may SEND is the socket's own room membership.
   */
  const typingMembers = new Map<string, { ids: string[]; at: number }>()
  async function typingMembersOf(conversationId: string): Promise<string[]> {
    const hit = typingMembers.get(conversationId)
    if (hit && Date.now() - hit.at < TYPING_MEMBERS_TTL_MS) return hit.ids
    const rows = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })
    const ids = rows.map((r) => r.userId)
    typingMembers.set(conversationId, { ids, at: Date.now() })
    return ids
  }

  /**
   * "… is typing" to the room's other people: the open thread (`conversation:<id>`) and every member's
   * own room (`user:<id>`), where their chat list shows "typing…" for it. One emit to the union, so a
   * socket in both gets it once; never to the sender's own sockets.
   */
  function relayTyping(payload: TypingRelay) {
    const room = `conversation:${payload.conversationId}`
    typingMembersOf(payload.conversationId)
      .catch((error) => {
        log.warn("typing: could not read the members; the open thread only", { room, error: String(error) })
        return [] as string[]
      })
      .then((ids) => {
        const rooms = [room, ...ids.filter((id) => id !== payload.userId).map((id) => `user:${id}`)]
        io.to(rooms).except(`user:${payload.userId}`).emit("typing", payload)
      })
  }

  function broadcastSheetPresence(room: string) {
    if (!room.startsWith("sheet:")) return
    io.to(room).emit("sheet-presence", {
      sheetId: room.slice(6),
      members: Array.from(roomPresence.get(room)?.values() ?? []),
    })
  }

  // Authenticate socket connections via JWT
  io.use(async (socket, next) => {
    try {
      const cookies = socket.handshake.headers.cookie
      if (!cookies) return next(new Error("Authentication required"))

      // Parse cookie header into a fake request for getToken
      const fakeReq = {
        headers: { cookie: cookies },
        cookies: Object.fromEntries(
          cookies.split("; ").map((c) => {
            const [key, ...rest] = c.split("=")
            return [key, rest.join("=")]
          })
        ),
      }

      // The cookie name is also the JWT salt, and in production it is "__Secure-authjs.session-token".
      // getToken's own default is the unprefixed name, so without these three lines every browser
      // and app session was refused here as "Invalid session" — realtime was dead in production
      // while every test (which faked the session) passed (8 Oct 2026). lib/session-cookie is the one
      // rule every place that reads or mints a session must use.
      const cookieName = getSessionCookieName()
      const token = await getToken({
        req: fakeReq as unknown as Parameters<typeof getToken>[0]["req"],
        secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
        cookieName,
        salt: cookieName,
        secureCookie: shouldUseSecureAuthCookies(),
      })

      if (!token?.id) return next(new Error("Invalid session"))
      // A deleted account keeps its conversation memberships (chat history stays), so its
      // leftover JWT must not be allowed back into those rooms.
      const owner = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { email: true, sessionVersion: true, deactivatedAt: true, role: true, name: true, avatar: true },
      })
      if (!owner || isDeletedAccountEmail(owner.email)) return next(new Error("Invalid session"))
      // Offboarded (lib/offboarding.ts): out of the company, so out of its chat rooms too.
      if (owner.deactivatedAt) return next(new Error("Invalid session"))
      // Revoked (password reset, a password set by a BoD, a change from the web): the same rule as the
      // jwt callback in lib/auth.ts. A token without the field — issued before revocation existed — stays valid.
      if (sessionVersionRejects(token.sessionVersion, owner.sessionVersion)) return next(new Error("Invalid session"))

      socket.data.userId = token.id as string
      // The database's name over the token's (a rename shows at once), and the photo, which the token
      // does not carry: what `typing` shows of the sender, read once per connection.
      socket.data.userName = (owner.name as string | null | undefined) || (token.name as string)
      socket.data.userAvatar = (owner.avatar as string | null | undefined) ?? null
      // Only now, after every refusal above: a deleted, offboarded or revoked session never gets here.
      // Joined synchronously on "connection" below, so the rooms are in place before the client's
      // connect event fires and nothing emitted after that can miss it.
      socket.data.serverRooms = await serverAssignedRooms(token.id as string, owner.role === "ADMIN")
      next()
    } catch {
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", (socket) => {
    const serverRooms = socket.data.serverRooms as string[] | undefined
    if (serverRooms?.length) socket.join(serverRooms)

    let currentRoom: string | null = null
    let currentUser: { userId: string; name: string; avatar: string | null } | null = null
    const typingGate = new TypingGate()
    const typingFrom = (conversationId: string, typing: boolean): TypingRelay => ({
      conversationId,
      userId: socket.data.userId as string,
      name: (socket.data.userName as string) || "",
      avatar: (socket.data.userAvatar as string | null) ?? null,
      typing,
    })

    socket.on("join-room", async (data: { room: string; userId: string; name: string; avatar?: string | null }) => {
      const me = socket.data.userId as string
      if (!data?.room || !(await canJoinRoom(me, data.room))) {
        // Told, not ignored: a silent no-op looks identical to a working join from the client side,
        // which turns a permissions bug into an unexplained dead feature.
        socket.emit("join-denied", { room: data?.room ?? null })
        log.warn("join-room denied", { userId: me, room: data?.room })
        return
      }
      // Identity comes from the SESSION TOKEN, not from the payload. The client used to supply its
      // own userId and name here, which meant anyone could show up in a presence list under someone
      // else's name. Only the avatar (cosmetic, not in the token) still comes from the client.
      const name = (socket.data.userName as string) || data.name || "Seseorang"
      currentRoom = data.room
      currentUser = { userId: me, name, avatar: data.avatar || null }

      socket.join(data.room)

      // Track presence
      if (!roomPresence.has(data.room)) {
        roomPresence.set(data.room, new Map())
      }
      const members = roomPresence.get(data.room)!
      const color = getColor(members.size)
      members.set(socket.id, {
        userId: me,
        name,
        avatar: data.avatar || null,
        color,
        lastSeen: Date.now(),
      })

      // Broadcast presence update
      io.to(data.room).emit("presence-update", Array.from(members.values()))
      broadcastSheetPresence(data.room)
      socket.to(data.room).emit("presence-join", {
        userId: me,
        name,
        avatar: data.avatar || null,
        color,
      })
    })

    socket.on("leave-room", (room: string) => {
      socket.leave(room)
      // Left the thread while typing in it: the others' dots go now, not when they time out.
      if (typeof room === "string" && room.startsWith("conversation:") && typingGate.stop(room)) {
        relayTyping(typingFrom(room.slice("conversation:".length), false))
      }
      if (roomPresence.has(room)) {
        const members = roomPresence.get(room)!
        const member = members.get(socket.id)
        members.delete(socket.id)
        if (members.size === 0) {
          roomPresence.delete(room)
        } else {
          io.to(room).emit("presence-update", Array.from(members.values()))
        }
        if (member) {
          socket.to(room).emit("presence-leave", { userId: member.userId })
        }
        broadcastSheetPresence(room)
      }
      currentRoom = null
    })

    socket.on("cursor-move", (data: { x: number; y: number; blockId?: string }) => {
      if (!currentRoom || !currentUser) return
      socket.to(currentRoom).emit("cursor-move", {
        socketId: socket.id,
        userId: currentUser.userId,
        name: currentUser.name,
        color: roomPresence.get(currentRoom)?.get(socket.id)?.color || "#3b82f6",
        ...data,
      })
    })

    socket.on("content-change", (data: { blockId: string; content: string; type?: string }) => {
      if (!currentRoom || !currentUser) return
      socket.to(currentRoom).emit("content-change", {
        userId: currentUser.userId,
        ...data,
      })
    })

    // Which cell each person is parked on. Relayed client-to-client because it's ephemeral and
    // worthless to forge, but still only into a room this socket has actually been admitted to —
    // `socket.to(room)` would otherwise happily broadcast into a room the sender never joined.
    socket.on("sheet-cursor", (data: { sheetId?: string; rowId?: string | null; columnId?: string | null }) => {
      const room = `sheet:${data?.sheetId ?? ""}`
      if (!data?.sheetId || !socket.rooms.has(room)) return
      socket.to(room).emit("sheet-cursor", {
        socketId: socket.id,
        userId: socket.data.userId,
        name: socket.data.userName,
        color: roomPresence.get(room)?.get(socket.id)?.color || "#3b82f6",
        rowId: data.rowId ?? null,
        columnId: data.columnId ?? null,
      })
    })

    // "… is typing" (lib/chat-typing.ts). Only from a socket in the conversation's room: join-room let it
    // in after conversationMemberAccess, and a removal takes it out (CONVERSATION_MEMBERSHIP, and the
    // roster check on every message) — so no database lookup per keystroke. Rate-limited per room by
    // TypingGate. Content-free: who, and whether; nothing stored, nothing pushed.
    socket.on("typing", (raw: unknown) => {
      const event = parseTypingEvent(raw)
      if (!event) return
      const room = `conversation:${event.conversationId}`
      if (!socket.rooms.has(room)) return
      if (!typingGate.accept(room, event.typing)) return
      relayTyping(typingFrom(event.conversationId, event.typing))
    })

    socket.on("task-update", (data: Record<string, unknown>) => {
      if (!currentRoom) return
      socket.to(currentRoom).emit("task-update", data)
    })

    socket.on("heartbeat", () => {
      if (!currentRoom) return
      const members = roomPresence.get(currentRoom)
      if (members?.has(socket.id)) {
        members.get(socket.id)!.lastSeen = Date.now()
      }
    })

    socket.on("disconnect", () => {
      // Gone mid-sentence (tab closed, app backgrounded, link dropped): stop the dots everywhere.
      for (const room of typingGate.stopAll()) relayTyping(typingFrom(room.slice("conversation:".length), false))
      if (currentRoom && roomPresence.has(currentRoom)) {
        const members = roomPresence.get(currentRoom)!
        const member = members.get(socket.id)
        members.delete(socket.id)
        if (members.size === 0) {
          roomPresence.delete(currentRoom)
        } else {
          io.to(currentRoom).emit("presence-update", Array.from(members.values()))
        }
        if (member) {
          io.to(currentRoom).emit("presence-leave", { userId: member.userId })
        }
        broadcastSheetPresence(currentRoom)
      }
    })
  })

  // Cleanup stale connections every 60s
  setInterval(() => {
    const staleThreshold = Date.now() - 90000 // 90s
    const rooms = Array.from(roomPresence.entries())
    for (const [room, members] of rooms) {
      const entries = Array.from(members.entries())
      for (const [socketId, member] of entries) {
        if (member.lastSeen < staleThreshold) {
          members.delete(socketId)
          io.to(room).emit("presence-leave", { userId: member.userId })
        }
      }
      if (members.size === 0) roomPresence.delete(room)
      else io.to(room).emit("presence-update", Array.from(members.values()))
      broadcastSheetPresence(room)
    }
  }, 60000)

  // ── Event bus → Socket.IO bridge ───────────────────────────
  // API routes publish to the event bus; we relay to Socket.IO rooms.
  eventBus.on(BUS_EVENTS.TASK_CREATED, (data: { projectId: string; task: unknown }) => {
    io.to(`project:${data.projectId}`).emit("task-created", data.task)
  })

  eventBus.on(BUS_EVENTS.TASK_UPDATED, (data: { projectId: string; task: unknown }) => {
    io.to(`project:${data.projectId}`).emit("task-updated", data.task)
  })

  eventBus.on(BUS_EVENTS.TASK_DELETED, (data: { projectId: string; taskId: string }) => {
    io.to(`project:${data.projectId}`).emit("task-deleted", { taskId: data.taskId })
  })

  eventBus.on(BUS_EVENTS.COMMENT_ADDED, (data: { projectId: string; taskId: string; comment: unknown }) => {
    io.to(`project:${data.projectId}`).emit("comment-added", { taskId: data.taskId, comment: data.comment })
  })

  eventBus.on(BUS_EVENTS.NOTIFICATION, (data: { userId: string; notification: unknown }) => {
    io.to(`user:${data.userId}`).emit("new-notification", data.notification)
  })

  eventBus.on(BUS_EVENTS.SPRINT_UPDATED, (data: { projectId: string; sprint: unknown }) => {
    io.to(`project:${data.projectId}`).emit("sprint-updated", data.sprint)
  })

  // Re-checked per socket against the roster the route sent along: a socket that joined while its user
  // was a member keeps sitting in the room after a removal, and would otherwise keep receiving every
  // message. Anyone not on the roster is taken out of the room instead of being sent the message.
  eventBus.on(BUS_EVENTS.MESSAGE_CREATED, (data: { conversationId: string; message: unknown; memberIds?: string[] }) => {
    const room = `conversation:${data.conversationId}`
    if (!Array.isArray(data.memberIds)) {
      io.to(room).emit("message-created", data.message)
      return
    }
    const allowed = new Set(data.memberIds)
    io.in(room).fetchSockets()
      .then((sockets) => {
        for (const s of sockets) {
          if (allowed.has(s.data?.userId as string)) s.emit("message-created", data.message)
          else s.leave(room)
        }
      })
      .catch((error) => {
        log.warn("message-created: could not list the room, sent to it as is", { room, error: String(error) })
        io.to(room).emit("message-created", data.message)
      })
  })

  // The chat list of every member, wherever it is open: `conversation-updated` to each user's own room.
  eventBus.on(BUS_EVENTS.CONVERSATION_UPDATED, (data: { userIds: string[]; payload: unknown }) => {
    for (const userId of data.userIds ?? []) io.to(`user:${userId}`).emit("conversation-updated", data.payload)
    // Someone added, removed, left, or the group deleted: `typing` reads the members again.
    const p = (data.payload ?? {}) as { conversationId?: unknown; reason?: unknown }
    if (typeof p.conversationId === "string" && (p.reason === "membership" || p.reason === "deleted")) typingMembers.delete(p.conversationId)
  })

  // Removed from a conversation (project/workspace/group change): out of its room immediately.
  eventBus.on(BUS_EVENTS.CONVERSATION_MEMBERSHIP, (data: { conversationId: string; removedUserIds: string[] }) => {
    typingMembers.delete(data.conversationId)
    const room = `conversation:${data.conversationId}`
    const removed = new Set(data.removedUserIds ?? [])
    if (removed.size === 0) return
    io.in(room).fetchSockets()
      .then((sockets) => {
        for (const s of sockets) if (removed.has(s.data?.userId as string)) s.leave(room)
      })
      .catch((error) => log.warn("conversation-membership: could not list the room", { room, error: String(error) }))
  })

  eventBus.on(BUS_EVENTS.SHEET_CELLS, (data: { sheetId: string; rows: unknown; actorId: string }) => {
    io.to(`sheet:${data.sheetId}`).emit("sheet-cells", { rows: data.rows, actorId: data.actorId })
  })

  eventBus.on(BUS_EVENTS.SHEET_STRUCTURE, (data: { sheetId: string; actorId: string }) => {
    io.to(`sheet:${data.sheetId}`).emit("sheet-structure", { actorId: data.actorId })
  })

  // Projects/folders of a workspace changed (lib/socket-emitter.ts emitWorkspaceChanged). The payload is
  // ids only and already stripped to its four fields there. One emit to the union of rooms, so a socket
  // in several of them (its workspace and its own user room) gets it once.
  eventBus.on(BUS_EVENTS.WORKSPACE_CHANGED, (data: { workspaceId: string | null; userIds?: string[]; payload: unknown }) => {
    const rooms = (data.userIds ?? []).map((id) => `user:${id}`)
    if (data.workspaceId) rooms.push(`workspace:${data.workspaceId}`, ALL_WORKSPACES_ROOM)
    if (rooms.length > 0) io.to(rooms).emit("workspace-changed", data.payload)
  })

  // Some audit row was written. Folded: the first write of a burst starts the clock and the ping goes
  // out once, after the last write in the window has committed. Nothing is looked up per write.
  let auditPing: ReturnType<typeof setTimeout> | null = null
  eventBus.on(BUS_EVENTS.AUDIT_CHANGED, () => {
    if (auditPing) return
    auditPing = setTimeout(() => {
      auditPing = null
      io.to(AUDIT_ROOM).emit("audit-changed", { kind: "audit" })
    }, AUDIT_PING_COALESCE_MS)
  })

  res.socket.server.io = io
  res.status(204).end()
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponseWithSocket
) {
  initializeSocketServer(req, res)
}
