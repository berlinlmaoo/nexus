import { Server as IOServer } from "socket.io"
import type { NextApiRequest, NextApiResponse } from "next"
import type { Server as HTTPServer } from "http"
import type { Socket as NetSocket } from "net"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { getToken } from "next-auth/jwt"
import { createLogger } from "@/lib/logger"

const log = createLogger("socket")

interface SocketServer extends HTTPServer {
  io?: IOServer
}

interface SocketWithIO extends NetSocket {
  server: SocketServer
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO
}

const ALLOWED_ORIGINS = [
  process.env.NEXTAUTH_URL || "http://localhost:3000",
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[]

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponseWithSocket
) {
  if (res.socket.server.io) {
    res.end()
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

    socket.on("join-room", (data: { room: string; userId: string; name: string; avatar?: string | null }) => {
      currentRoom = data.room
      currentUser = { userId: data.userId, name: data.name, avatar: data.avatar || null }

      socket.join(data.room)

      // Track presence
      if (!roomPresence.has(data.room)) {
        roomPresence.set(data.room, new Map())
      }
      const members = roomPresence.get(data.room)!
      const color = getColor(members.size)
      members.set(socket.id, {
        userId: data.userId,
        name: data.name,
        avatar: data.avatar || null,
        color,
        lastSeen: Date.now(),
      })

      // Broadcast presence update
      io.to(data.room).emit("presence-update", Array.from(members.values()))
      socket.to(data.room).emit("presence-join", {
        userId: data.userId,
        name: data.name,
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

  res.socket.server.io = io
  res.end()
}
