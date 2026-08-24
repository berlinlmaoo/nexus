import { Server as IOServer } from "socket.io"
import type { NextApiRequest, NextApiResponse } from "next"
import type { Server as HTTPServer } from "http"
import type { Socket as NetSocket } from "net"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { getToken } from "next-auth/jwt"
import { createLogger } from "@/lib/logger"
import { resolveSheetAccess } from "@/lib/project-sheets"
import { checkProjectAccess } from "@/lib/rbac"
import prisma from "@/lib/prisma"

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
      case "conversation":
        return Boolean(
          await prisma.conversationMember.findUnique({
            where: { conversationId_userId: { conversationId: id, userId } },
            select: { id: true },
          }),
        )
      case "sheet":
        return (await resolveSheetAccess(userId, id, ["VIEWER"])).allowed
      default:
        return false
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

      const token = await getToken({
        req: fakeReq as unknown as Parameters<typeof getToken>[0]["req"],
        secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
      })

      if (!token?.id) return next(new Error("Invalid session"))

      socket.data.userId = token.id as string
      socket.data.userName = token.name as string
      next()
    } catch {
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", (socket) => {
    let currentRoom: string | null = null
    let currentUser: { userId: string; name: string; avatar: string | null } | null = null

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

  eventBus.on(BUS_EVENTS.MESSAGE_CREATED, (data: { conversationId: string; message: unknown }) => {
    io.to(`conversation:${data.conversationId}`).emit("message-created", data.message)
  })

  eventBus.on(BUS_EVENTS.SHEET_CELLS, (data: { sheetId: string; rows: unknown; actorId: string }) => {
    io.to(`sheet:${data.sheetId}`).emit("sheet-cells", { rows: data.rows, actorId: data.actorId })
  })

  eventBus.on(BUS_EVENTS.SHEET_STRUCTURE, (data: { sheetId: string; actorId: string }) => {
    io.to(`sheet:${data.sheetId}`).emit("sheet-structure", { actorId: data.actorId })
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
