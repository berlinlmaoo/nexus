// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server as HTTPServer } from "http"
import type { AddressInfo } from "net"
import { io as connect, type Socket as ClientSocket } from "socket.io-client"

// "… is typing" (owner, 9 Oct 2026), end to end on a real Socket.IO server (pages/api/socket.ts) with
// real socket.io-client connections; only the database and the session cookie are faked. What it proves:
// a member's typing reaches the other members — in the open thread and in their chat list (their own
// user room) — with the name and photo from the server, and never the sender's own sockets, a
// non-member, or anything a non-member sends; the per-room rate limit holds; leaving the thread or
// disconnecting mid-sentence sends "stopped".

const m = vi.hoisted(() => ({
  users: new Map<string, { name: string; avatar: string | null }>(),
  // conversationId → member ids
  rooms: new Map<string, string[]>(),
  memberQueries: 0,
}))

vi.mock("next-auth/jwt", () => ({
  getToken: async ({ req }: { req: { cookies: Record<string, string> } }) => {
    const id = req.cookies["test-user"]
    const user = id ? m.users.get(id) : undefined
    // The token's name is stale on purpose: the relay must use the database's.
    return user ? { id, name: `${user.name} (token)`, sessionVersion: 1 } : null
  },
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = m.users.get(where.id)
        return u ? { email: `${where.id}@x.test`, sessionVersion: 1, deactivatedAt: null, role: "USER", name: u.name, avatar: u.avatar } : null
      },
    },
    workspaceMember: { findMany: async () => [] },
    conversationMember: {
      findMany: async ({ where }: { where: { conversationId: string } }) => {
        m.memberQueries++
        return (m.rooms.get(where.conversationId) ?? []).map((userId) => ({ userId }))
      },
    },
  },
}))

vi.mock("@/lib/chat-access", () => ({
  conversationMemberAccess: async (userId: string, conversationId: string) =>
    ({ ok: (m.rooms.get(conversationId) ?? []).includes(userId) }),
}))
vi.mock("@/lib/rbac", () => ({ checkProjectAccess: async () => ({ allowed: false }) }))
vi.mock("@/lib/project-sheets", () => ({ resolveSheetAccess: async () => ({ allowed: false }) }))
vi.mock("@/lib/audit-query", () => ({ resolveAuditAccess: async () => ({ ok: false }) }))

type Typing = { conversationId: string; userId: string; name: string; avatar: string | null; typing: boolean }
type Client = { socket: ClientSocket; typing: Typing[]; denied: unknown[] }

let http: HTTPServer
let url = ""
const all: Client[] = []

function connectAs(userId: string): Promise<Client> {
  const socket = connect(url, {
    path: "/api/socket",
    transports: ["websocket"],
    extraHeaders: { cookie: `test-user=${userId}` },
    forceNew: true,
    reconnection: false,
  })
  const client: Client = { socket, typing: [], denied: [] }
  all.push(client)
  socket.on("typing", (p: Typing) => client.typing.push(p))
  socket.on("join-denied", (p: unknown) => client.denied.push(p))
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(client))
    socket.on("connect_error", reject)
  })
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
async function join(c: Client, ...rooms: string[]) {
  for (const room of rooms) c.socket.emit("join-room", { room, userId: "ignored", name: "ignored" })
  await settle(150)
}
const clear = () => { for (const c of all) c.typing.length = 0 }

// c1 and c2: Alice, Bob. Carol is in neither.
let alice: Client, aliceTab2: Client, bob: Client, bobPhone: Client, carol: Client

beforeAll(async () => {
  m.users.set("u-alice", { name: "Alice", avatar: "/api/files/avatars/alice.jpg" })
  m.users.set("u-bob", { name: "Bob", avatar: null })
  m.users.set("u-carol", { name: "Carol", avatar: null })
  m.rooms.set("c1", ["u-alice", "u-bob"])
  m.rooms.set("c2", ["u-alice", "u-bob"])
  m.rooms.set("c3", ["u-alice", "u-bob"])
  m.rooms.set("c4", ["u-alice", "u-bob"])

  http = createServer()
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  const { initializeSocketServer } = await import("../../pages/api/socket")
  initializeSocketServer({} as never, { socket: { server: http }, status: () => ({ end: () => {} }) } as never)

  ;[alice, aliceTab2, bob, bobPhone, carol] = await Promise.all(["u-alice", "u-alice", "u-bob", "u-bob", "u-carol"].map(connectAs))
  // Every app joins its own user room on connect; the thread joins the conversation's room.
  await join(alice, "user:u-alice", "conversation:c1", "conversation:c2", "conversation:c3", "conversation:c4")
  await join(aliceTab2, "user:u-alice")
  await join(bob, "user:u-bob", "conversation:c1", "conversation:c2", "conversation:c3", "conversation:c4")
  await join(bobPhone, "user:u-bob") // Bob's phone is on the chat list, not in the thread
  await join(carol, "user:u-carol", "conversation:c1")
})

afterAll(async () => {
  for (const c of all) c.socket.disconnect()
  ;(http as unknown as { io?: { close: () => void } }).io?.close()
  await new Promise((r) => http.close(() => r(undefined)))
})

beforeEach(clear)

describe("typing", () => {
  it("a non-member cannot even join the room", () => {
    expect(carol.denied).toEqual([{ room: "conversation:c1" }])
  })

  it("a member's typing reaches the other member's thread and chat list once each, with the server's name and photo", async () => {
    alice.socket.emit("typing", { conversationId: "c1", typing: true, name: "Mallory", avatar: "https://evil.test/x.png", userId: "u-carol" })
    await settle()
    const expected = { conversationId: "c1", userId: "u-alice", name: "Alice", avatar: "/api/files/avatars/alice.jpg", typing: true }
    expect(bob.typing).toEqual([expected])      // in the thread (and its user room): once
    expect(bobPhone.typing).toEqual([expected]) // the chat list on another device
    expect(alice.typing).toEqual([])            // never the sender
    expect(aliceTab2.typing).toEqual([])        // nor the sender's other tabs
    expect(carol.typing).toEqual([])            // nor someone outside the group
  })

  it("a non-member's typing is refused: nobody hears it", async () => {
    carol.socket.emit("typing", { conversationId: "c1", typing: true })
    carol.socket.emit("typing", { conversationId: "c2", typing: true })
    await settle()
    for (const c of all) expect(c.typing).toEqual([])
  })

  it("rejects malformed events", async () => {
    alice.socket.emit("typing", { conversationId: "c2", typing: "yes" })
    alice.socket.emit("typing", { conversationId: 42, typing: true })
    alice.socket.emit("typing", null)
    alice.socket.emit("typing", { conversationId: "x".repeat(65), typing: true })
    await settle()
    expect(bob.typing).toEqual([])
  })

  it("rate limit: one 'typing' per second per room; 'stopped' after it always goes; repeats are dropped", { timeout: 15_000 }, async () => {
    for (let i = 0; i < 6; i++) alice.socket.emit("typing", { conversationId: "c2", typing: true })
    await settle()
    expect(bob.typing.map((t) => t.typing)).toEqual([true])
    alice.socket.emit("typing", { conversationId: "c2", typing: false })
    alice.socket.emit("typing", { conversationId: "c2", typing: false })
    await settle()
    expect(bob.typing.map((t) => t.typing)).toEqual([true, false])
    alice.socket.emit("typing", { conversationId: "c2", typing: true }) // within a second of the last
    await settle()
    expect(bob.typing.map((t) => t.typing)).toEqual([true, false])
    await settle(1000)
    alice.socket.emit("typing", { conversationId: "c2", typing: true })
    await settle()
    expect(bob.typing.map((t) => t.typing)).toEqual([true, false, true])
    alice.socket.emit("typing", { conversationId: "c2", typing: false })
    await settle()
  })

  it("the member list is read once, not per keystroke", { timeout: 15_000 }, async () => {
    const before = m.memberQueries
    for (let i = 0; i < 4; i++) {
      alice.socket.emit("typing", { conversationId: "c1", typing: i % 2 === 0 })
      await settle(1050)
    }
    expect(m.memberQueries).toBe(before) // c1 was read by the first test and is still cached
  })

  it("leaving the thread mid-sentence sends 'stopped'", async () => {
    alice.socket.emit("typing", { conversationId: "c3", typing: true })
    await settle()
    alice.socket.emit("leave-room", "conversation:c3")
    await settle()
    expect(bob.typing.filter((t) => t.conversationId === "c3").map((t) => t.typing)).toEqual([true, false])
    // Out of the room: no more typing from that socket there.
    alice.socket.emit("typing", { conversationId: "c3", typing: true })
    await settle()
    expect(bob.typing.filter((t) => t.conversationId === "c3")).toHaveLength(2)
  })

  it("disconnecting mid-sentence sends 'stopped'", async () => {
    alice.socket.emit("typing", { conversationId: "c4", typing: true })
    await settle()
    alice.socket.disconnect()
    await settle()
    expect(bob.typing.filter((t) => t.conversationId === "c4").map((t) => [t.userId, t.typing])).toEqual([["u-alice", true], ["u-alice", false]])
    expect(bobPhone.typing.filter((t) => t.conversationId === "c4").map((t) => t.typing)).toEqual([true, false])
  })
})
