// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Who is told about a new chat message, and how (CHAT-CONTRACT 8 Oct 2026, "Push"): mute and DND keep
// plain messages quiet, a mention breaks through both and is the only thing that writes an Inbox row,
// someone no longer in the room's workspace is never told, and every push carries the room's thread id
// and the recipient's own badge.

const m = vi.hoisted(() => ({
  conversationFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  workspaceFindMany: vi.fn(),
  sendPushToUsers: vi.fn(async () => {}),
  createInAppNotification: vi.fn(async (d: { userId: string }) => ({ id: `notif-${d.userId}` })),
  badgeCountsFor: vi.fn(async (ids: string[]) => new Map(ids.map((id, i) => [id, 10 + i]))),
}))

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }))
vi.mock("@/lib/prisma", () => ({
  default: {
    conversation: { findUnique: m.conversationFindUnique },
    conversationMember: { findMany: m.memberFindMany },
    workspaceMember: { findMany: m.workspaceFindMany },
  },
}))
vi.mock("@/lib/apns", () => ({ sendPushToUsers: m.sendPushToUsers }))
vi.mock("@/lib/notification-service", () => ({ createInAppNotification: m.createInAppNotification }))
vi.mock("@/lib/chat-unread", () => ({ badgeCountsFor: m.badgeCountsFor }))

import { fanOutChatMessage, resolveMentions } from "@/lib/chat-fanout"

const HOUR = 3600e3
const later = () => new Date(Date.now() + HOUR)
const earlier = () => new Date(Date.now() - HOUR)

function member(userId: string, name: string, extra: { mutedUntil?: Date | null; dndUntil?: Date | null } = {}) {
  return { userId, mutedUntil: extra.mutedUntil ?? null, user: { name, dndUntil: extra.dndUntil ?? null } }
}

describe("fanOutChatMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.conversationFindUnique.mockResolvedValue({ type: "GROUP", name: "Tim Kreatif", workspaceId: "W", project: null })
    m.memberFindMany.mockResolvedValue([
      member("S", "Sender Satu"),
      member("A", "Ani"),                                   // plain → push
      member("B", "Bayu", { mutedUntil: later() }),           // muted → nothing
      member("C", "Citra", { dndUntil: later() }),            // DND → nothing
      member("D", "Dewi", { mutedUntil: later() }),           // muted but mentioned → push + Inbox
      member("E", "Eko"),                                   // left the workspace → nothing at all
      member("F", "Fajar", { mutedUntil: earlier(), dndUntil: earlier() }), // both expired → push
    ])
    m.workspaceFindMany.mockResolvedValue(
      ["S", "A", "B", "C", "D", "F"].map((userId) => ({ userId, workspaceId: "W" })).concat([{ userId: "E", workspaceId: "P" }]),
    )
  })

  it("mute/DND/mention/workspace decide who is pushed; only the mention gets an Inbox row", async () => {
    await fanOutChatMessage({
      conversationId: "conv1",
      message: { id: "msg1", content: "@Dewi rapat jam 3", attachmentUrl: null, attachmentType: null, user: { name: "Sender Satu" } },
      senderId: "S",
      mentionedUserIds: ["D", "E", "nobody"],
      rawContent: "@Dewi rapat jam 3",
    })

    expect(m.createInAppNotification).toHaveBeenCalledTimes(1)
    expect(m.createInAppNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: "D", type: "MESSAGE_MENTION", link: "/messages?c=conv1", push: false,
      title: "Sender Satu mentioned you in Tim Kreatif", message: "@Dewi rapat jam 3",
    }))

    expect(m.sendPushToUsers).toHaveBeenCalledTimes(1)
    const [items, label] = m.sendPushToUsers.mock.calls[0] as unknown as [Array<{ userId: string; payload: Record<string, unknown> }>, string]
    expect(label).toBe("chat:GROUP")
    expect(items.map((i) => i.userId).sort()).toEqual(["A", "D", "F"])
    expect(m.badgeCountsFor).toHaveBeenCalledWith(expect.arrayContaining(["A", "D", "F"]), expect.any(Date))

    const a = items.find((i) => i.userId === "A")!.payload
    expect(a).toMatchObject({
      title: "Tim Kreatif", body: "Sender Satu: @Dewi rapat jam 3", type: "MESSAGE", link: "/messages?c=conv1", threadId: "conv1",
      notificationId: null,
      data: { conversationId: "conv1", messageId: "msg1", conversationName: "Tim Kreatif", senderName: "Sender Satu", isGroup: true, text: "@Dewi rapat jam 3" },
    })
    expect(typeof a.badge).toBe("number")
    const d = items.find((i) => i.userId === "D")!.payload
    expect(d).toMatchObject({ type: "MESSAGE_MENTION", notificationId: "notif-D" })
  })

  it("DM, image only: title is the sender, body '📷 Foto'", async () => {
    m.conversationFindUnique.mockResolvedValue({ type: "DM", name: null, workspaceId: "W", project: null })
    m.memberFindMany.mockResolvedValue([member("S", "Sender Satu"), member("A", "Ani")])
    m.workspaceFindMany.mockResolvedValue([{ userId: "S", workspaceId: "W" }, { userId: "A", workspaceId: "W" }])
    await fanOutChatMessage({
      conversationId: "dm1",
      message: { id: "msg2", content: "", attachmentUrl: "/api/files/chat/x.jpg", attachmentType: "image/jpeg", user: { name: "Sender Satu" } },
      senderId: "S", mentionedUserIds: [], rawContent: "",
    })
    const [items] = m.sendPushToUsers.mock.calls[0] as unknown as [Array<{ userId: string; payload: Record<string, unknown> }>]
    expect(items).toHaveLength(1)
    expect(items[0].payload).toMatchObject({ title: "Sender Satu", body: "📷 Foto", threadId: "dm1", data: { isGroup: false, conversationName: "Sender Satu" } })
    expect(m.createInAppNotification).not.toHaveBeenCalled()
  })

  it("project room: only people in the project's workspace; the project's current name", async () => {
    m.conversationFindUnique.mockResolvedValue({ type: "PROJECT", name: "Old name", workspaceId: "W", project: { name: "Step Up Festival", workspaceId: "W" } })
    m.memberFindMany.mockResolvedValue([member("S", "Sender Satu"), member("A", "Ani"), member("E", "Eko")])
    m.workspaceFindMany.mockResolvedValue([{ userId: "S", workspaceId: "W" }, { userId: "A", workspaceId: "W" }, { userId: "E", workspaceId: "P" }])
    await fanOutChatMessage({
      conversationId: "p1",
      message: { id: "msg3", content: "ok", attachmentUrl: null, attachmentType: null, user: { name: "Sender Satu" } },
      senderId: "S", mentionedUserIds: [], rawContent: "ok",
    })
    const [items] = m.sendPushToUsers.mock.calls[0] as unknown as [Array<{ userId: string; payload: Record<string, unknown> }>]
    expect(items.map((i) => i.userId)).toEqual(["A"])
    expect(items[0].payload).toMatchObject({ title: "Step Up Festival", body: "Sender Satu: ok" })
  })

  it("everyone muted or in DND: no push call at all", async () => {
    m.memberFindMany.mockResolvedValue([member("S", "Sender Satu"), member("B", "Bayu", { mutedUntil: later() }), member("C", "Citra", { dndUntil: later() })])
    await fanOutChatMessage({
      conversationId: "conv1",
      message: { id: "msg4", content: "halo", attachmentUrl: null, attachmentType: null, user: { name: "Sender Satu" } },
      senderId: "S", mentionedUserIds: [], rawContent: "halo",
    })
    expect(m.sendPushToUsers).not.toHaveBeenCalled()
    expect(m.badgeCountsFor).not.toHaveBeenCalled()
  })
})

describe("resolveMentions", () => {
  const roster = [{ userId: "a", name: "Ani Wijaya" }, { userId: "b", name: "Budi" }, { userId: "c", name: "Budi" }]
  it("structured ids from the roster only; a text tag only when it names exactly one member", () => {
    expect([...resolveMentions(roster, ["a", "zzz"], "")]).toEqual(["a"])
    expect([...resolveMentions(roster, [], "halo @AniWijaya")]).toEqual(["a"])
    expect([...resolveMentions(roster, [], "halo @Budi")]).toEqual([])
  })
})
