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
import { isOrgBodPlus, ORG_WORKSPACE_ID } from "@/lib/org"
import { createCalendarPinger } from "@/lib/calendar-realtime"
import { TypingGate, parseTypingEvent, type TypingRelay } from "@/lib/chat-typing"
import { attachCollabSocket } from "@/lib/collab-rooms"
import { onSlotDemoted } from "@/lib/bluegreen"
import { cleanCursorMove, stripPrivatePeople } from "@/lib/realtime-payload"
import type { Socket } from "socket.io"
import { canonicalRoom, normalizeTokenUserId, roomMayBeLegacy } from "@/lib/legacy-ids"

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
 *   audit           users who pass resolveAuditAccess, i.e. may open Control Room → Audit
 */
const AUDIT_ROOM = "audit"
/** A burst of audit writes (a bulk action, a reorder) reaches the audit room as one ping. */
const AUDIT_PING_COALESCE_MS = 250
/** `attendance-board-changed`: at most one per viewer per this long; the first of a burst waits this short a moment. */
const BOARD_PING_INTERVAL_MS = 1_000
const BOARD_PING_MIN_DELAY_MS = 150
/** How long a conversation's member list is reused for `typing` before it is read again. */
const TYPING_MEMBERS_TTL_MS = 60_000
/**
 * How long a "may this user see this project" answer is trusted for a broadcast before it is read again
 * (realtime bug 2, 13 Oct 2026). Membership changes don't wait for it: they re-check at once (ACCESS_CHANGED).
 * This is the safety net for a path that changed access without saying so: at most this long, and only for
 * the events sent while the re-check runs.
 */
const ROOM_ACCESS_TTL_MS = 30_000
/** Re-checks after an ACCESS_CHANGED besides the immediate one: in case the change had not committed yet. */
const ACCESS_RECHECK_DELAYS_MS = [300, 2_500]

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

  // Blue-green (lib/bluegreen.ts): events live in this process only, so when the deploy script switches
  // nginx to the other slot, every socket still attached here would stop hearing about writes made on the
  // new slot. On demotion, close the TRANSPORT of each one (not socket.disconnect(), which tells the client
  // "server kicked you, do not reconnect"): clients see "transport close", reconnect through nginx to the
  // live slot, re-run their join-room calls and catch up (web refetches on reconnect, apps the same).
  onSlotDemoted(() => {
    let n = 0
    for (const socket of io.sockets.sockets.values()) {
      try { socket.conn.close(); n++ } catch { /* already gone */ }
    }
    log.info("slot demoted: realtime connections handed over to the live slot", { closed: n })
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
  async function canJoinRoom(userId: string, room: string): Promise<{ ok: boolean; projectId?: string }> {
    // `workspace:<id>`, `workspace-all` and `audit` are not joinable here on purpose: membership in
    // those comes from the database at connect time (serverAssignedRooms), never from a client request.
    const sep = room.indexOf(":")
    if (sep < 1) return { ok: false }
    const kind = room.slice(0, sep)
    const id = room.slice(sep + 1)
    if (!id) return { ok: false }

    switch (kind) {
      // Your own notification stream, and nobody else's.
      case "user":
        return { ok: id === userId }
      case "project": {
        const ok = (await checkProjectAccess(userId, id, ["VIEWER"])).allowed
        rememberAccess(userId, id, ok)
        return { ok, projectId: id }
      }
      // A member row, and for a group/DM still being in its workspace (lib/chat-access.ts) — the
      // row alone outlived a removal from the company until 8 Oct 2026.
      case "conversation":
        return { ok: (await conversationMemberAccess(userId, id)).ok }
      // Control Room › GIDEON › Performance (18 Oct 2026): BoD / One Above All of the company workspace only.
      case "gideon":
        return { ok: id === "perf" && (await isOrgBodPlus(userId).catch(() => false)) }
      // A form's live builder (co-editing, 19 Oct 2026): Can edit and up only. Viewers see the form's Preview and
      // Responses, never the editors' room (QA A-18), so they neither hear ops nor show up as editing.
      case "form": {
        const form = await prisma.form.findUnique({ where: { id }, select: { projectId: true } })
        if (!form) return { ok: false }
        const ok = (await checkProjectAccess(userId, form.projectId, ["MEMBER"])).allowed
        if (!ok) return { ok: false }
        rememberAccess(userId, form.projectId, true)
        return { ok: true, projectId: form.projectId }
      }
      case "sheet": {
        const access = await resolveSheetAccess(userId, id, ["VIEWER"])
        if (!access.allowed) return { ok: false }
        rememberAccess(userId, access.sheet.projectId, true)
        return { ok: true, projectId: access.sheet.projectId }
      }
      default:
        return { ok: false }
    }
  }

  // ── Project access of the sockets in project / sheet rooms (realtime bugs 1-2, 13 Oct 2026) ──
  //
  // A socket was checked once, at join-room, and then heard everything said in the room until it
  // reconnected, even after its user was removed from the project. Now:
  //  - every project:/sheet: room a socket is in remembers its project (socket.data.roomProjects);
  //  - ACCESS_CHANGED (member removed / level changed / out of the workspace / offboarded) re-checks those
  //    users' rooms at once and takes the socket out ("join-denied" { room, reason: "revoked" } tells it);
  //  - every broadcast into such a room skips a socket whose user is known to have lost access, and
  //    re-reads an answer older than ROOM_ACCESS_TTL_MS in the background (safety net for any other path).
  type AccessEntry = { ok: boolean; at: number; pending: Promise<boolean> | null }
  const roomAccess = new Map<string, AccessEntry>()
  const accessKey = (userId: string, projectId: string) => `${userId}|${projectId}`
  function rememberAccess(userId: string, projectId: string, ok: boolean) {
    roomAccess.set(accessKey(userId, projectId), { ok, at: Date.now(), pending: null })
  }
  function roomProjectsOf(socket: Socket): Map<string, string> {
    let m = socket.data.roomProjects as Map<string, string> | undefined
    if (!m) { m = new Map(); socket.data.roomProjects = m }
    return m
  }
  /** Read the user's access to the project again; evict their sockets from its rooms if it is gone. */
  function recheckAccess(userId: string, projectId: string): Promise<boolean> {
    const key = accessKey(userId, projectId)
    const hit = roomAccess.get(key)
    if (hit?.pending) return hit.pending
    const pending = checkProjectAccess(userId, projectId, ["VIEWER"])
      .then((r) => r.allowed)
      .catch((error) => {
        log.warn("room access re-check failed; kept as it was", { userId, projectId, error: String(error) })
        return hit?.ok ?? true
      })
      .then((ok) => {
        roomAccess.set(key, { ok, at: Date.now(), pending: null })
        if (!ok) evictFromProject(userId, projectId)
        return ok
      })
    roomAccess.set(key, { ok: hit?.ok ?? true, at: hit?.at ?? 0, pending })
    return pending
  }
  /** Every local socket of this user leaves every room of this project (project:<id> and its sheets). */
  function evictFromProject(userId: string, projectId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId !== userId) continue
      for (const [room, pid] of [...roomProjectsOf(socket)]) {
        if (pid !== projectId) continue
        roomProjectsOf(socket).delete(room)
        presenceLeave(socket, room)
        socket.leave(room)
        socket.emit("join-denied", { room, reason: "revoked" })
        log.info("access revoked: socket taken out of the room", { userId, room })
      }
    }
  }
  /**
   * Emit into a project:/sheet: room, skipping sockets whose user is known to have lost access to the
   * room's project. A stale answer is re-read in the background (the socket is evicted if it fails).
   */
  function emitGuarded(room: string, event: string, payload: unknown) {
    const ids = io.sockets.adapter.rooms.get(room)
    if (!ids || ids.size === 0) return
    const now = Date.now()
    const skip: string[] = []
    for (const sid of ids) {
      const socket = io.sockets.sockets.get(sid)
      const userId = socket?.data.userId as string | undefined
      const projectId = socket ? roomProjectsOf(socket).get(room) : undefined
      if (!socket || !userId || !projectId) continue
      let hit = roomAccess.get(accessKey(userId, projectId))
      if (!hit?.pending && (!hit || now - hit.at > ROOM_ACCESS_TTL_MS)) {
        void recheckAccess(userId, projectId)
        hit = roomAccess.get(accessKey(userId, projectId))
      }
      if (hit?.pending) {
        // Being re-read (an access change, or an answer past its TTL): this socket gets the event once the
        // answer says yes — a few ms later, in order (the callbacks run in the order they were added).
        skip.push(sid)
        const target = socket
        void hit.pending.then((ok) => { if (ok && target.connected && target.rooms.has(room)) target.emit(event, payload) })
        continue
      }
      if (hit && !hit.ok) skip.push(sid)
    }
    ;(skip.length ? io.to(room).except(skip) : io.to(room)).emit(event, payload)
  }
  /** ACCESS_CHANGED: forget the cached answers and re-check the rooms of the users (or project) named. */
  function onAccessChanged(projectId: string | null, userIds: string[] | null) {
    const users = userIds ? new Set(userIds) : null
    for (const key of [...roomAccess.keys()]) {
      const [u, p] = key.split("|")
      if ((users === null || users.has(u)) && (projectId === null || p === projectId)) roomAccess.delete(key)
    }
    const pairs = new Set<string>()
    for (const socket of io.sockets.sockets.values()) {
      const userId = socket.data.userId as string | undefined
      if (!userId || (users && !users.has(userId))) continue
      for (const pid of roomProjectsOf(socket).values()) if (projectId === null || pid === projectId) pairs.add(accessKey(userId, pid))
    }
    if (pairs.size === 0) return
    // At once (events for them wait for the answer, see emitGuarded), then again after the delays in case
    // the change was announced inside a transaction that had not committed yet.
    for (const key of pairs) { const [u, p] = key.split("|"); void recheckAccess(u, p) }
    // Form builder rooms need Can edit, not just access: someone moved down to Can view leaves them now.
    for (const key of pairs) { const [u, p] = key.split("|"); void recheckFormRooms(u, p) }
    for (const delay of ACCESS_RECHECK_DELAYS_MS) {
      setTimeout(() => {
        for (const key of pairs) {
          const [u, p] = key.split("|")
          roomAccess.delete(key)
          void recheckAccess(u, p)
        }
      }, delay).unref?.()
    }
  }

  /** Takes this user's sockets out of the `form:` rooms of the project when they can no longer edit it. */
  async function recheckFormRooms(userId: string, projectId: string) {
    const holders = [...io.sockets.sockets.values()].filter((s) => s.data.userId === userId && [...roomProjectsOf(s)].some(([room, pid]) => pid === projectId && room.startsWith("form:")))
    if (holders.length === 0) return
    const canEdit = await checkProjectAccess(userId, projectId, ["MEMBER"]).then((r) => r.allowed).catch(() => true)
    if (canEdit) return
    for (const socket of holders) {
      for (const [room, pid] of [...roomProjectsOf(socket)]) {
        if (pid !== projectId || !room.startsWith("form:")) continue
        roomProjectsOf(socket).delete(room)
        presenceLeave(socket, room)
        socket.leave(room)
        socket.emit("join-denied", { room, reason: "revoked" })
      }
    }
  }

  /**
   * The rooms this user belongs in by who they are, not by what they asked for: one per workspace
   * they are a member of (for `workspace-changed`), and `audit` when they may read the audit log (for
   * `audit-changed`).
   *
   * Best effort: if the lookup fails the socket still connects, just without these rooms, and the
   * views fall back to refetching on their own (focus, navigation, the reconnect catch-up).
   */
  async function serverAssignedRooms(userId: string): Promise<string[]> {
    try {
      const [memberships, audit] = await Promise.all([
        prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
        resolveAuditAccess(userId),
      ])
      const rooms = memberships.map((m) => `workspace:${m.workspaceId}`)
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

  /**
   * Who is in a form's builder and which question each one is on (live co-editing, 19 Oct 2026), as its own
   * event for the same reason as `sheet-presence`. One entry per person (several tabs fold into one; the
   * question is the one they focused last). `questionId` null = in the builder, on no question.
   */
  const formFocus = new Map<string, { questionId: string | null; at: number }>() // `${room}|${socketId}`
  function broadcastFormPresence(room: string) {
    if (!room.startsWith("form:")) return
    const people = new Map<string, { userId: string; name: string; avatar: string | null; color: string; questionId: string | null; at: number }>()
    for (const [sid, m] of roomPresence.get(room) ?? []) {
      const focus = formFocus.get(`${room}|${sid}`) ?? { questionId: null, at: 0 }
      const prev = people.get(m.userId)
      if (!prev || focus.at > prev.at) people.set(m.userId, { userId: m.userId, name: m.name, avatar: m.avatar, color: m.color, questionId: focus.questionId, at: focus.at })
    }
    io.to(room).emit("form-presence", {
      formId: room.slice(5),
      members: [...people.values()].map(({ at: _at, ...m }) => m),
    })
  }

  function broadcastSheetPresence(room: string) {
    broadcastFormPresence(room)
    if (!room.startsWith("sheet:")) return
    io.to(room).emit("sheet-presence", {
      sheetId: room.slice(6),
      members: Array.from(roomPresence.get(room)?.values() ?? []),
    })
  }

  /**
   * Take a socket out of a room's legacy presence (`presence-update` / `presence-leave` / `sheet-presence`).
   * `presence-leave` only when that user has no other socket left in the room: one of two open tabs closing
   * used to announce the person as gone (realtime bug 8, 13 Oct 2026).
   */
  function presenceLeave(socket: Socket, room: string) {
    ;(socket.data.presenceRooms as Set<string> | undefined)?.delete(room)
    const members = roomPresence.get(room)
    if (!members) return
    const member = members.get(socket.id)
    formFocus.delete(`${room}|${socket.id}`)
    if (!members.delete(socket.id)) return
    if (members.size === 0) roomPresence.delete(room)
    else io.to(room).emit("presence-update", Array.from(members.values()))
    if (member && ![...members.values()].some((m) => m.userId === member.userId)) {
      io.to(room).except(socket.id).emit("presence-leave", { userId: member.userId })
    }
    broadcastSheetPresence(room)
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
      // Old (pre-UUIDv7) user id in a JWT minted before the conversion (lib/legacy-ids.ts).
      await normalizeTokenUserId(token as Record<string, unknown>)
      // A deleted account keeps its conversation memberships (chat history stays), so its
      // leftover JWT must not be allowed back into those rooms.
      const owner = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { email: true, sessionVersion: true, deactivatedAt: true, name: true, avatar: true },
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
      socket.data.serverRooms = await serverAssignedRooms(token.id as string)
      next()
    } catch {
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", (socket) => {
    const serverRooms = socket.data.serverRooms as string[] | undefined
    if (serverRooms?.length) socket.join(serverRooms)
    // Block editor live rooms (Yjs): their own events and access checks, lib/collab-rooms.ts.
    attachCollabSocket(io, socket)

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
      // A client holding a pre-UUIDv7 id joins the room the server actually broadcasts to (lib/legacy-ids.ts).
      // Awaited only for such a room: an extra await on every join would reorder a client's joins.
      if (data && typeof data.room === "string" && data.room.length <= 200 && roomMayBeLegacy(data.room)) {
        data.room = await canonicalRoom(data.room)
      }
      const verdict = typeof data?.room === "string" && data.room.length <= 200 ? await canJoinRoom(me, data.room) : { ok: false }
      if (!data?.room || !verdict.ok) {
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
      const avatar = typeof data.avatar === "string" && data.avatar.length <= 500 ? data.avatar : null
      currentRoom = data.room
      currentUser = { userId: me, name, avatar }
      if (verdict.projectId) roomProjectsOf(socket).set(data.room, verdict.projectId)

      socket.join(data.room)

      // Track presence
      if (!roomPresence.has(data.room)) {
        roomPresence.set(data.room, new Map())
      }
      const members = roomPresence.get(data.room)!
      const already = members.get(socket.id)
      const otherTab = [...members.entries()].some(([sid, m]) => sid !== socket.id && m.userId === me)
      const color = already?.color ?? getColor(members.size)
      members.set(socket.id, { userId: me, name, avatar, color, lastSeen: Date.now() })
      ;((socket.data.presenceRooms as Set<string> | undefined) ?? (socket.data.presenceRooms = new Set<string>())).add(data.room)

      // Broadcast presence update
      io.to(data.room).emit("presence-update", Array.from(members.values()))
      broadcastSheetPresence(data.room)
      // A rejoin (reconnect, a second tab of the same person) is not a new arrival.
      if (!already && !otherTab) socket.to(data.room).emit("presence-join", { userId: me, name, avatar, color })
    })

    socket.on("leave-room", async (rawRoom: string) => {
      if (typeof rawRoom !== "string") return
      const room = rawRoom.length <= 200 && roomMayBeLegacy(rawRoom) ? await canonicalRoom(rawRoom) : rawRoom
      socket.leave(room)
      roomProjectsOf(socket).delete(room)
      // Left the thread while typing in it: the others' dots go now, not when they time out.
      if (room.startsWith("conversation:") && typingGate.stop(room)) {
        relayTyping(typingFrom(room.slice("conversation:".length), false))
      }
      presenceLeave(socket, room)
      if (currentRoom === room) currentRoom = null
    })

    // Legacy live cursors (the old Next.js pages): a position only, and only into a room this socket is in.
    socket.on("cursor-move", (raw: unknown) => {
      const data = cleanCursorMove(raw)
      if (!data || !currentRoom || !currentUser || !socket.rooms.has(currentRoom)) return
      socket.to(currentRoom).emit("cursor-move", {
        socketId: socket.id,
        userId: currentUser.userId,
        name: currentUser.name,
        color: roomPresence.get(currentRoom)?.get(socket.id)?.color || "#3b82f6",
        ...data,
      })
    })

    // `content-change` and `task-update` used to be relayed from one client to the room as they came —
    // anything a client sent, under its own name, to everyone in the room. No released client sends either
    // (web: none since the Phaethon SPA; iOS/Android: never — checked 13 Oct 2026), and every real change
    // already travels from the server after it is saved (task-updated, doc-changed, ydoc:update). Dropped.

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

    // Which question of a form's builder this person is on (live co-editing): only into a form room this socket
    // was admitted to (Can edit). Ephemeral, like sheet-cursor; nothing stored. Sent on change only.
    socket.on("form-focus", (data: { formId?: unknown; questionId?: unknown }) => {
      const formId = typeof data?.formId === "string" ? data.formId : ""
      const room = `form:${formId}`
      if (!formId || !socket.rooms.has(room)) return
      const questionId = typeof data.questionId === "string" && data.questionId.length <= 100 ? data.questionId : null
      const key = `${room}|${socket.id}`
      if (formFocus.get(key)?.questionId === questionId && formFocus.has(key)) return
      formFocus.set(key, { questionId, at: Date.now() })
      broadcastFormPresence(room)
    })

    socket.on("heartbeat", () => {
      const now = Date.now()
      for (const room of (socket.data.presenceRooms as Set<string> | undefined) ?? []) {
        const member = roomPresence.get(room)?.get(socket.id)
        if (member) member.lastSeen = now
      }
    })

    socket.on("disconnect", () => {
      // Gone mid-sentence (tab closed, app backgrounded, link dropped): stop the dots everywhere.
      for (const room of typingGate.stopAll()) relayTyping(typingFrom(room.slice("conversation:".length), false))
      // Every room it was present in, not only the last one joined (the others used to linger for 90 s and
      // then be announced as "left" by the sweep, realtime bug 8).
      for (const room of [...((socket.data.presenceRooms as Set<string> | undefined) ?? [])]) presenceLeave(socket, room)
    })
  })

  // Presence of sockets that are gone without a disconnect event (should not happen; belt and braces). A
  // CONNECTED socket stays present however long it has been quiet: the old 90 s heartbeat rule announced
  // people as "left" from every room but the last one they joined (only that one got heartbeats).
  setInterval(() => {
    for (const [room, members] of Array.from(roomPresence.entries())) {
      for (const socketId of Array.from(members.keys())) {
        if (io.sockets.sockets.has(socketId)) continue
        const member = members.get(socketId)!
        members.delete(socketId)
        if (![...members.values()].some((m) => m.userId === member.userId)) io.to(room).emit("presence-leave", { userId: member.userId })
        if (members.size === 0) roomPresence.delete(room)
        else io.to(room).emit("presence-update", Array.from(members.values()))
        broadcastSheetPresence(room)
      }
    }
  }, 60000).unref?.()

  // ── Event bus → Socket.IO bridge ───────────────────────────
  // API routes publish to the event bus; we relay to Socket.IO rooms.
  // Project rooms: emitGuarded (above) skips a socket whose user lost access; people in the payload are cut
  // down to id/name/avatar (lib/realtime-payload.ts) — the task routes load full user rows.
  // Calendar (B-12, 19 Oct 2026): every task change in a company project, and the company's room bookings
  // and projects, also reach every open Calendar as one folded `calendar-changed` ping (lib/calendar-realtime.ts).
  const calendarPing = createCalendarPinger({
    companyWorkspaceId: ORG_WORKSPACE_ID,
    emit: (payload) => { io.to(`workspace:${ORG_WORKSPACE_ID}`).emit("calendar-changed", payload) },
    workspaceOf: async (projectId) => (await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } }))?.workspaceId ?? null,
  })

  eventBus.on(BUS_EVENTS.TASK_CREATED, (data: { projectId: string; task: unknown }) => {
    emitGuarded(`project:${data.projectId}`, "task-created", stripPrivatePeople(data.task))
    void calendarPing.task(data.projectId)
  })

  eventBus.on(BUS_EVENTS.TASK_UPDATED, (data: { projectId: string; task: unknown }) => {
    emitGuarded(`project:${data.projectId}`, "task-updated", stripPrivatePeople(data.task))
    void calendarPing.task(data.projectId)
  })

  eventBus.on(BUS_EVENTS.TASK_DELETED, (data: { projectId: string; taskId: string }) => {
    emitGuarded(`project:${data.projectId}`, "task-deleted", { taskId: data.taskId })
    void calendarPing.task(data.projectId)
  })

  eventBus.on(BUS_EVENTS.COMMENT_ADDED, (data: { projectId: string; taskId: string; comment: unknown }) => {
    emitGuarded(`project:${data.projectId}`, "comment-added", { taskId: data.taskId, comment: stripPrivatePeople(data.comment) })
  })

  eventBus.on(BUS_EVENTS.ACCESS_CHANGED, (data: { projectId: string | null; userIds: string[] | null }) => {
    onAccessChanged(data?.projectId ?? null, Array.isArray(data?.userIds) ? data.userIds : null)
  })

  // A form's builder content changed (live co-editing, lib/form-coedit-server.ts): to its editors' room.
  eventBus.on(BUS_EVENTS.FORM_OPS, (data: { projectId: string; formId: string; payload: unknown }) => {
    if (typeof data?.formId === "string" && data.formId) emitGuarded(`form:${data.formId}`, "form-ops", data.payload)
  })

  // A form got a response: its owner's open Responses tab refetches (realtime bug 6). Ids only.
  eventBus.on(BUS_EVENTS.FORM_RESPONSES_CHANGED, (data: { projectId: string; formId: string }) => {
    emitGuarded(`project:${data.projectId}`, "form-responses-changed", { projectId: data.projectId, formId: data.formId })
  })

  eventBus.on(BUS_EVENTS.NOTIFICATION, (data: { userId: string; notification: unknown }) => {
    io.to(`user:${data.userId}`).emit("new-notification", data.notification)
  })

  eventBus.on(BUS_EVENTS.GIDEON_CREDITS, (data: { userId: string; summary: unknown }) => {
    if (typeof data?.userId === "string" && data.userId) io.to(`user:${data.userId}`).emit("gideon-credits", { summary: data.summary ?? null })
  })

  // C-17 (19 Oct 2026): the actor's own other devices drop decisions they already made. Ids only.
  eventBus.on(BUS_EVENTS.ATTENDANCE_CHANGED, (data: { userIds?: string[]; kind?: string; id?: string | null; userId?: string; date?: string }) => {
    const rooms = (Array.isArray(data?.userIds) ? data.userIds : []).filter((u) => typeof u === "string" && u).map((u) => `user:${u}`)
    if (!rooms.length) return
    // userId/date: additive since 19 Oct 2026 (check-in/out and every write that changes the person's attendance).
    const payload: Record<string, unknown> = { kind: data.kind ?? null, id: data.id ?? null }
    if (typeof data.userId === "string" && data.userId) payload.userId = data.userId
    if (typeof data.date === "string" && data.date) payload.date = data.date
    io.to(rooms).emit("attendance-changed", payload)
  })

  // Attendance board (19 Oct 2026): whoever may see these people's attendance refetches their monitor / board /
  // team list / Reports per crew. The viewer list was worked out by lib/attendance-broadcast.ts from the database;
  // here it is only folded per viewer to at most one ping a second (a cron closing 40 records = one refetch).
  const boardPending = new Map<string, { userIds: Set<string>; dates: Set<string>; timer: ReturnType<typeof setTimeout> | null; lastAt: number }>()
  const flushBoard = (viewer: string) => {
    const entry = boardPending.get(viewer)
    if (!entry) return
    entry.timer = null
    if (!entry.userIds.size) return
    io.to(`user:${viewer}`).emit("attendance-board-changed", { userIds: [...entry.userIds], dates: [...entry.dates] })
    entry.userIds.clear()
    entry.dates.clear()
    entry.lastAt = Date.now()
  }
  eventBus.on(BUS_EVENTS.ATTENDANCE_BOARD_CHANGED, (data: { viewerIds?: string[]; userId?: string; date?: string | null }) => {
    if (typeof data?.userId !== "string" || !data.userId || !Array.isArray(data.viewerIds)) return
    const now = Date.now()
    for (const viewer of data.viewerIds) {
      if (typeof viewer !== "string" || !viewer) continue
      let entry = boardPending.get(viewer)
      if (!entry) { entry = { userIds: new Set(), dates: new Set(), timer: null, lastAt: 0 }; boardPending.set(viewer, entry) }
      entry.userIds.add(data.userId)
      if (typeof data.date === "string" && data.date) entry.dates.add(data.date)
      if (entry.timer) continue
      const wait = Math.max(BOARD_PING_MIN_DELAY_MS, entry.lastAt + BOARD_PING_INTERVAL_MS - now)
      const v = viewer
      entry.timer = setTimeout(() => flushBoard(v), wait)
    }
    // Forget idle viewers so the map never grows with everyone who was ever pinged.
    if (boardPending.size > 500) for (const [v, e] of boardPending) if (!e.timer && now - e.lastAt > 60_000) boardPending.delete(v)
  })

  // C-D2 (19 Oct 2026): XP moved for these people — open leaderboards in their workspaces refetch. Ids only.
  eventBus.on(BUS_EVENTS.XP_CHANGED, (data: { workspaceIds?: string[]; userIds?: string[] }) => {
    const rooms = (Array.isArray(data?.workspaceIds) ? data.workspaceIds : []).filter((w) => typeof w === "string" && w).map((w) => `workspace:${w}`)
    if (rooms.length) io.to(rooms).emit("xp-changed", { userIds: Array.isArray(data.userIds) ? data.userIds : [] })
  })

  eventBus.on(BUS_EVENTS.REMINDERS_CHANGED, (data: { userId: string; id: string }) => {
    if (typeof data?.userId === "string" && data.userId) io.to(`user:${data.userId}`).emit("reminders-changed", { id: data.id ?? null })
  })

  // Presence status (lib/presence.ts, 19 Oct 2026): the status itself travels, because everyone in a workspace may
  // see it and its reason (owner). To each workspace room the person is in, plus their own user room (other tabs).
  eventBus.on(BUS_EVENTS.PRESENCE_CHANGED, (data: { userId?: string; workspaceIds?: string[]; status?: unknown }) => {
    if (typeof data?.userId !== "string" || !data.userId || !data.status) return
    const rooms = [`user:${data.userId}`, ...(data.workspaceIds ?? []).filter((w) => typeof w === "string" && w).map((w) => `workspace:${w}`)]
    io.to(rooms).emit("presence-changed", { userId: data.userId, status: data.status })
  })

  // GIDEON tier availability (18 Oct 2026): the same public fact for everyone, so it goes to every socket.
  eventBus.on(BUS_EVENTS.GIDEON_TIERS, (data: { tiers: unknown }) => {
    io.emit("gideon-tiers", { tiers: data?.tiers ?? null })
  })

  // GIDEON performance panel (lib/gideon-perf.ts, 18 Oct 2026). GPU samples go out as they come (≤ every 5 s, and
  // only while someone watches); "runs" pings (an answer started/ended) are folded into one per 2 s.
  ;(globalThis as unknown as { __gideonPerfWatchers?: () => number }).__gideonPerfWatchers = () => io.sockets.adapter.rooms.get("gideon:perf")?.size ?? 0
  let perfRunsTimer: ReturnType<typeof setTimeout> | null = null
  eventBus.on(BUS_EVENTS.GIDEON_PERF, (data: { kind?: string; live?: unknown }) => {
    if (!io.sockets.adapter.rooms.get("gideon:perf")?.size) return
    if (data?.kind === "runs") {
      if (perfRunsTimer) return
      perfRunsTimer = setTimeout(() => { perfRunsTimer = null; io.to("gideon:perf").emit("gideon-perf", { kind: "runs" }) }, 2000)
      perfRunsTimer.unref?.()
      return
    }
    io.to("gideon:perf").emit("gideon-perf", { kind: data?.kind ?? "gpu", live: data?.live ?? null })
  })

  // A meeting recording moved (lib/meeting-notes.ts): ids + status only, to its uploader and its project's room
  // (VIEWER access to join, the same bar as reading the meeting). Clients refetch through the API.
  eventBus.on(BUS_EVENTS.MEETING_CHANGED, (data: { userId: string; projectId: string | null; payload: unknown }) => {
    if (typeof data?.userId === "string" && data.userId) io.to(`user:${data.userId}`).emit("meeting-changed", data.payload)
    if (typeof data?.projectId === "string" && data.projectId) emitGuarded(`project:${data.projectId}`, "meeting-changed", data.payload)
  })

  eventBus.on(BUS_EVENTS.SPRINT_UPDATED, (data: { projectId: string; sprint: unknown }) => {
    emitGuarded(`project:${data.projectId}`, "sprint-updated", stripPrivatePeople(data.sprint))
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

  // originTab (additive): the browser tab that wrote it, so only that tab skips the echo.
  eventBus.on(BUS_EVENTS.SHEET_CELLS, (data: { sheetId: string; rows: unknown; actorId: string; originTab?: string | null }) => {
    emitGuarded(`sheet:${data.sheetId}`, "sheet-cells", { rows: data.rows, actorId: data.actorId, originTab: data.originTab ?? null })
  })

  eventBus.on(BUS_EVENTS.SHEET_STRUCTURE, (data: { sheetId: string; actorId: string; originTab?: string | null }) => {
    emitGuarded(`sheet:${data.sheetId}`, "sheet-structure", { actorId: data.actorId, originTab: data.originTab ?? null })
  })

  // Projects/folders of a workspace changed (lib/socket-emitter.ts emitWorkspaceChanged). The payload is
  // ids only (plus a changed project icon) and already stripped to its allowed fields there. One emit to the union of rooms, so a socket
  // in several of them (its workspace and its own user room) gets it once.
  eventBus.on(BUS_EVENTS.WORKSPACE_CHANGED, (data: { workspaceId: string | null; userIds?: string[]; payload: unknown }) => {
    const rooms = (data.userIds ?? []).map((id) => `user:${id}`)
    if (data.workspaceId) rooms.push(`workspace:${data.workspaceId}`)
    if (rooms.length > 0) io.to(rooms).emit("workspace-changed", data.payload)
    const ping = (data.payload && typeof data.payload === "object" ? data.payload : {}) as { kind?: unknown; actorId?: unknown }
    calendarPing.workspace(data.workspaceId, ping.kind, ping.actorId)
  })

  // A deal of a Pipeline Dashboard project changed (lib/socket-emitter.ts emitPipelineChanged): ids only,
  // to the project's room, which a socket joins only with VIEWER access to the project.
  eventBus.on(BUS_EVENTS.PIPELINE_CHANGED, (data: { projectId: string; dealId: string | null; actorId: string | null }) => {
    emitGuarded(`project:${data.projectId}`, "pipeline-changed", { projectId: data.projectId, dealId: data.dealId, actorId: data.actorId })
  })

  // An event or target of an Outlet Sales Dashboard project changed (lib/socket-emitter.ts
  // emitOutletSalesChanged): ids only, to the project's room (VIEWER access to join, as for the pipeline).
  eventBus.on(BUS_EVENTS.OUTLET_SALES_CHANGED, (data: { projectId: string; eventId: string | null; month: string | null; actorId: string | null }) => {
    emitGuarded(`project:${data.projectId}`, "outlet-sales-changed", { projectId: data.projectId, eventId: data.eventId, month: data.month, actorId: data.actorId })
  })

  // A day, target or the platforms of a Social Media Report project changed (lib/socket-emitter.ts
  // emitSocialMediaChanged): ids only, to the project's room (VIEWER access to join, as for the outlet).
  eventBus.on(BUS_EVENTS.SOCIAL_MEDIA_CHANGED, (data: { projectId: string; date: string | null; month: string | null; actorId: string | null }) => {
    emitGuarded(`project:${data.projectId}`, "social-media-changed", { projectId: data.projectId, date: data.date, month: data.month, actorId: data.actorId })
  })

  // A project's automations changed or ran (lib/socket-emitter.ts emitAutomationsChanged): ids only, to the
  // project's room (VIEWER access to join). The Automations tab refetches its list and run log.
  eventBus.on(BUS_EVENTS.AUTOMATIONS_CHANGED, (data: { projectId: string; automationId: string | null; actorId: string | null }) => {
    emitGuarded(`project:${data.projectId}`, "automations-changed", { projectId: data.projectId, automationId: data.automationId, actorId: data.actorId })
  })

  // A doc's body or header changed (block editor, lib/block-bodies.ts / docs routes): ids only, to the
  // project's room, so its Pages list and any open copy of the page refetch.
  eventBus.on(BUS_EVENTS.DOC_CHANGED, (data: { projectId: string; docId: string; actorId: string | null }) => {
    emitGuarded(`project:${data.projectId}`, "doc-changed", { projectId: data.projectId, docId: data.docId, actorId: data.actorId })
  })

  // Something inside a project changed that no other event covers (lib/project-realtime.ts, 19 Oct 2026): ids
  // only, to the project's room (VIEWER access to join). Folded per (project, kind, id): a form builder autosaving
  // or a tab drag is one ping per 300 ms window, sent after the last write of the window.
  const projectPings = new Map<string, ReturnType<typeof setTimeout>>()
  eventBus.on(BUS_EVENTS.PROJECT_CHANGED, (data: { projectId?: unknown; kind?: unknown; id?: unknown; actorId?: unknown }) => {
    if (typeof data?.projectId !== "string" || !data.projectId || typeof data.kind !== "string") return
    const payload = {
      projectId: data.projectId,
      kind: data.kind,
      id: typeof data.id === "string" ? data.id : null,
      actorId: typeof data.actorId === "string" ? data.actorId : null,
    }
    const key = `${payload.projectId}|${payload.kind}|${payload.id ?? ""}`
    const prev = projectPings.get(key)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      projectPings.delete(key)
      emitGuarded(`project:${payload.projectId}`, "project-changed", payload)
    }, 300)
    timer.unref?.()
    projectPings.set(key, timer)
  })

  // A support ticket changed (lib/complaint-realtime.ts, 19 Oct 2026): to the user rooms the route resolved — the
  // reporter and the workspace's BoD/OAA — and nowhere else. Ids only.
  eventBus.on(BUS_EVENTS.COMPLAINT_CHANGED, (data: { userIds?: unknown; payload?: { id?: unknown; kind?: unknown } }) => {
    const rooms = (Array.isArray(data?.userIds) ? data.userIds : []).filter((u): u is string => typeof u === "string" && !!u).map((u) => `user:${u}`)
    const id = data?.payload?.id
    if (!rooms.length || typeof id !== "string") return
    io.to(rooms).emit("complaint-changed", { id, kind: typeof data.payload?.kind === "string" ? data.payload.kind : null })
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
