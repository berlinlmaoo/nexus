// @vitest-environment node
import { generateKeyPairSync } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// APNs sender for chat (CHAT-CONTRACT 8 Oct 2026) with Apple replaced by a fake HTTP/2 session:
// the body (thread-id, badge, custom keys), the headers, ONE reused session, the per-device badge gate,
// and the batch sender routing each person's own payload. No network.

type Sent = { headers: Record<string, string>; body: Record<string, unknown> }
const h2 = vi.hoisted(() => ({ connects: 0, sent: [] as Array<{ headers: Record<string, string>; body: Record<string, unknown> }>, status: 200 }))

vi.mock("node:http2", async () => {
  const actual = await vi.importActual<typeof import("node:http2")>("node:http2")
  // Imported here, not at the top: vi.mock factories run before the file's own imports.
  const { EventEmitter } = await import("node:events")
  class FakeStream extends EventEmitter {
    rstCode = 0
    constructor(private headers: Record<string, string>) { super() }
    setEncoding() {}
    setTimeout() {}
    close() {}
    end(body: string) {
      h2.sent.push({ headers: this.headers, body: JSON.parse(body) })
      setImmediate(() => {
        this.emit("response", { ":status": String(h2.status) })
        if (h2.status !== 200) this.emit("data", JSON.stringify({ reason: "BadDeviceToken" }))
        this.emit("end")
        this.emit("close")
      })
    }
  }
  class FakeSession extends EventEmitter {
    closed = false
    destroyed = false
    constructor() { super(); setImmediate(() => this.emit("connect")) }
    request(headers: Record<string, string>) { return new FakeStream(headers) }
    setTimeout() {}
    unref() {}
    close() { this.closed = true }
    destroy() { this.destroyed = true }
  }
  const connect = () => { h2.connects++; return new FakeSession() }
  return { ...actual, default: { ...actual, connect }, connect }
})

const db = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ default: { deviceInstallation: { findMany: db.findMany, update: db.update } } }))

const fcm = vi.hoisted(() => ({ sendFcm: vi.fn(async () => ({ ok: true })), configured: true }))
vi.mock("@/lib/fcm", () => ({ fcmConfigured: () => fcm.configured, sendFcm: fcm.sendFcm }))

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })

function device(id: string, userId: string, platform: "ios" | "android", appVersion: string | null) {
  return { id, userId, platform, token: `tok-${id}`, environment: "production", bundleId: "id.znetworks.nexus", appVersion }
}

describe("APNs body", () => {
  it("chat keys: thread-id, badge, custom keys; data never replaces aps/type/link", async () => {
    const { buildApnsBody } = await import("@/lib/apns")
    const body = buildApnsBody({
      title: "Tim Kreatif", body: "Budi: rapat", type: "MESSAGE", link: "/messages?c=conv1", threadId: "conv1", badge: 4,
      data: { conversationId: "conv1", messageId: "m1", conversationName: "Tim Kreatif", senderName: "Budi", isGroup: true, type: "spoof", link: "spoof", aps: "spoof" } as never,
    })
    expect(body.aps).toEqual({ alert: { title: "Tim Kreatif", body: "Budi: rapat" }, sound: "default", "thread-id": "conv1", badge: 4 })
    expect(body).toMatchObject({ type: "MESSAGE", link: "/messages?c=conv1", conversationId: "conv1", messageId: "m1", conversationName: "Tim Kreatif", senderName: "Budi", isGroup: true })
    expect(buildApnsBody({ title: "T", body: "B", type: "MESSAGE", badge: 4 }, { badge: false }).aps).not.toHaveProperty("badge")
    // Every other push is unchanged: no thread-id, no badge.
    expect(buildApnsBody({ title: "T", body: "B", type: "task_assigned" }).aps).toEqual({ alert: { title: "T", body: "B" }, sound: "default" })
  })
})

describe("APNs sender", () => {
  beforeEach(() => {
    vi.resetModules()
    h2.connects = 0
    h2.sent.length = 0
    h2.status = 200
    db.findMany.mockReset()
    db.update.mockReset()
    fcm.sendFcm.mockClear()
    process.env.APNS_TEAM_ID = "TEAM123456"
    process.env.APNS_KEY_ID = "KEY1234567"
    process.env.APNS_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  })
  afterEach(() => {
    delete process.env.APNS_TEAM_ID
    delete process.env.APNS_KEY_ID
    delete process.env.APNS_PRIVATE_KEY
  })

  it("one batch: one device query, one reused HTTP/2 session, each person's own payload, badge only where it is cleared", async () => {
    db.findMany.mockResolvedValue([
      device("d1", "u1", "ios", "0.1.6"),   // never clears its badge → no aps.badge
      device("d2", "u1", "ios", "0.1.7"),
      device("d3", "u2", "ios", "0.1.7"),
      device("d4", "u2", "android", "0.1.0"),
    ])
    const { sendPushToUsers } = await import("@/lib/apns")
    const payload = (badge: number, type: string) => ({ title: "Tim", body: "Budi: hi", type, link: "/messages?c=c1", threadId: "c1", badge })
    await sendPushToUsers([{ userId: "u1", payload: payload(3, "MESSAGE") }, { userId: "u2", payload: payload(9, "MESSAGE_MENTION") }], "chat:GROUP")

    expect(db.findMany).toHaveBeenCalledTimes(1)
    expect(h2.connects).toBe(1)
    expect(h2.sent).toHaveLength(3)
    const byToken = new Map(h2.sent.map((s: Sent) => [s.headers[":path"], s]))
    const d1 = byToken.get("/3/device/tok-d1")!
    const d2 = byToken.get("/3/device/tok-d2")!
    const d3 = byToken.get("/3/device/tok-d3")!
    expect(d1.headers["apns-push-type"]).toBe("alert")
    expect(d1.headers["apns-topic"]).toBe("id.znetworks.nexus")
    expect((d1.body.aps as Record<string, unknown>)["thread-id"]).toBe("c1")
    expect(d1.body.aps).not.toHaveProperty("badge")
    expect((d2.body.aps as Record<string, unknown>).badge).toBe(3)
    expect((d3.body.aps as Record<string, unknown>).badge).toBe(9)
    expect(d3.body.type).toBe("MESSAGE_MENTION")
    expect(fcm.sendFcm).toHaveBeenCalledTimes(1)
    expect(fcm.sendFcm).toHaveBeenCalledWith("tok-d4", expect.objectContaining({ type: "MESSAGE_MENTION", badge: 9 }))

    // A second push reuses the same session.
    db.findMany.mockResolvedValue([device("d2", "u1", "ios", "0.1.7")])
    await sendPushToUsers([{ userId: "u1", payload: payload(1, "MESSAGE") }], "chat:GROUP")
    expect(h2.connects).toBe(1)
    expect(h2.sent).toHaveLength(4)
  })

  it("sendPushToUser (every other caller) still works and still disables dead tokens", async () => {
    db.findMany.mockResolvedValue([device("d9", "u9", "ios", "0.1.6")])
    h2.status = 400
    const { sendPushToUser } = await import("@/lib/apns")
    await sendPushToUser("u9", { title: "Absen", body: "Waktunya absen", type: "attendance_checkin_reminder", link: "/attendance" })
    expect(h2.sent).toHaveLength(1)
    expect(h2.sent[0].body).toEqual({ aps: { alert: { title: "Absen", body: "Waktunya absen" }, sound: "default" }, type: "attendance_checkin_reminder", link: "/attendance" })
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d9" } }))
  })
})
