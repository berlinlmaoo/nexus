// node src/lib/chat-rules.test.mjs
//
// Plain node, no test runner (same loader as fcm-payload.test.mjs). The pure half of the chat contract
// (CHAT-CONTRACT 8 Oct 2026): push decision, push text, cursors, read position, unread sums, mute, and
// who may stay in a group/DM.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

const R = await load("chat-rules.ts")
const NOW = Date.parse("2026-10-08T10:00:00.000Z")
const future = new Date(NOW + 3600e3).toISOString()
const past = new Date(NOW - 60e3).toISOString()

// ── push decision ──
test("plain message: push, no Inbox row", () => {
  assert.deepEqual(R.chatPushDecision({ isMention: false, now: NOW }), { push: true, inbox: false, reason: "ok" })
  assert.deepEqual(R.chatPushDecision({ isMention: false, mutedUntil: null, dndUntil: null, now: NOW }), { push: true, inbox: false, reason: "ok" })
})
test("muted room: no push for plain messages; an expired mute is no mute", () => {
  assert.deepEqual(R.chatPushDecision({ isMention: false, mutedUntil: future, now: NOW }), { push: false, inbox: false, reason: "muted" })
  assert.deepEqual(R.chatPushDecision({ isMention: false, mutedUntil: new Date(NOW + 1), now: new Date(NOW) }).push, false)
  assert.equal(R.chatPushDecision({ isMention: false, mutedUntil: past, now: NOW }).push, true)
  assert.equal(R.chatPushDecision({ isMention: false, mutedUntil: R.MUTE_FOREVER_ISO, now: NOW }).push, false)
})
test("DND: no push for plain messages; expired DND is no DND", () => {
  assert.deepEqual(R.chatPushDecision({ isMention: false, dndUntil: future, now: NOW }), { push: false, inbox: false, reason: "dnd" })
  assert.equal(R.chatPushDecision({ isMention: false, dndUntil: past, now: NOW }).push, true)
})
test("a mention breaks through mute AND DND, and lands in the Inbox", () => {
  for (const extra of [{}, { mutedUntil: future }, { dndUntil: future }, { mutedUntil: R.MUTE_FOREVER_ISO, dndUntil: future }]) {
    assert.deepEqual(R.chatPushDecision({ isMention: true, now: NOW, ...extra }), { push: true, inbox: true, reason: "mention" }, JSON.stringify(extra))
  }
})

// ── push text ──
const base = { conversationId: "conv1", messageId: "msg1", senderName: "Budi Santoso", isMention: false }
test("group: title = room, body = 'Sender: text', thread-id = conversation", () => {
  const p = R.buildChatPush({ ...base, kind: "GROUP", conversationName: "Tim Kreatif", content: "rapat jam 3" })
  assert.equal(p.title, "Tim Kreatif")
  assert.equal(p.body, "Budi Santoso: rapat jam 3")
  assert.equal(p.threadId, "conv1")
  assert.equal(p.type, "MESSAGE")
  assert.equal(p.link, "/messages?c=conv1")
  assert.deepEqual(p.data, { conversationId: "conv1", messageId: "msg1", conversationName: "Tim Kreatif", senderName: "Budi Santoso", isGroup: true, text: "rapat jam 3" })
})
test("project room behaves like a group; nameless rooms get a fallback", () => {
  const p = R.buildChatPush({ ...base, kind: "PROJECT", conversationName: "Step Up Festival", content: "ok" })
  assert.equal(p.title, "Step Up Festival")
  assert.equal(p.body, "Budi Santoso: ok")
  assert.equal(R.buildChatPush({ ...base, kind: "PROJECT", conversationName: null, content: "x" }).title, "Project chat")
  assert.equal(R.buildChatPush({ ...base, kind: "GROUP", conversationName: "  ", content: "x" }).title, "Group")
})
test("DM: title = sender, body = text alone, isGroup false, conversationName = sender", () => {
  const p = R.buildChatPush({ ...base, kind: "DM", conversationName: null, content: "halo" })
  assert.equal(p.title, "Budi Santoso")
  assert.equal(p.body, "halo")
  assert.equal(p.data.isGroup, false)
  assert.equal(p.data.conversationName, "Budi Santoso")
})
test("image only → '📷 Foto'; with a caption → the caption", () => {
  const img = { attachmentUrl: "/api/files/chat/a.jpg", attachmentType: "image/jpeg" }
  assert.equal(R.buildChatPush({ ...base, kind: "DM", content: "", ...img }).body, "📷 Foto")
  assert.equal(R.buildChatPush({ ...base, kind: "GROUP", conversationName: "G", content: "  ", ...img }).body, "Budi Santoso: 📷 Foto")
  assert.equal(R.buildChatPush({ ...base, kind: "DM", content: "lihat ini", ...img }).body, "lihat ini")
  assert.equal(R.chatPreviewText({ content: "", attachmentUrl: "/api/files/chat/a", attachmentType: null }), "📷 Foto")
  assert.equal(R.chatPreviewText({ content: "", attachmentUrl: "/api/files/chat/a.pdf", attachmentType: "application/pdf" }), "📎 Lampiran")
})
test("mention: same text, type MESSAGE_MENTION", () => {
  const p = R.buildChatPush({ ...base, kind: "GROUP", conversationName: "G", content: "@Ani cek", isMention: true })
  assert.equal(p.type, "MESSAGE_MENTION")
  assert.equal(p.body, "Budi Santoso: @Ani cek")
})
test("preview folds whitespace and truncates long text with an ellipsis", () => {
  assert.equal(R.chatPreviewText({ content: "a\n\n  b\tc" }), "a b c")
  const long = "x".repeat(500)
  const out = R.chatPreviewText({ content: long })
  assert.equal(out.length, 160)
  assert.ok(out.endsWith("…"))
  assert.equal(R.buildChatPush({ ...base, kind: "DM", senderName: "  ", content: "hi" }).title, "Seseorang")
})
test("badge only for iOS builds that clear it (0.1.7+) and for Android", () => {
  assert.equal(R.badgeAllowedFor("ios", "0.1.6"), false)
  assert.equal(R.badgeAllowedFor("ios", "0.1.7"), true)
  assert.equal(R.badgeAllowedFor("ios", "0.2"), true)
  assert.equal(R.badgeAllowedFor("ios", "1.0.0"), true)
  assert.equal(R.badgeAllowedFor("ios", null), false)
  assert.equal(R.badgeAllowedFor("ios", "beta"), false)
  assert.equal(R.badgeAllowedFor("android", null), true)
  assert.equal(R.appVersionAtLeast("0.1.10", "0.1.7"), true)
  assert.equal(R.appVersionAtLeast("0.1.6.9", "0.1.7"), false)
})
test("link ↔ conversation id", () => {
  assert.equal(R.chatLink("abc"), "/messages?c=abc")
  assert.equal(R.conversationIdFromLink("/messages?c=abc"), "abc")
  assert.equal(R.conversationIdFromLink("/messages?c=abc&x=1"), "abc")
  assert.equal(R.conversationIdFromLink("/tasks?c=abc"), null)
  assert.equal(R.conversationIdFromLink(null), null)
})

// ── cursors and pages ──
test("cursor round-trips (createdAt, id) and is opaque", () => {
  const c = R.encodeCursor(new Date("2026-10-08T01:02:03.456Z"), "cmabc123")
  assert.ok(c.startsWith("c1."))
  assert.ok(!c.includes("cmabc123"))
  assert.deepEqual(R.decodeCursor(c), { createdAt: new Date("2026-10-08T01:02:03.456Z"), id: "cmabc123" })
  assert.equal(R.decodeCursor("c1.!!!"), null)
  assert.equal(R.decodeCursor("garbage"), null)
  assert.equal(R.decodeCursor("c1." + Buffer.from("not-a-date|x").toString("base64url")), null)
})
test("before: none / ISO date (old clients) / cursor / invalid", () => {
  assert.deepEqual(R.parseBefore(null), { kind: "none" })
  assert.deepEqual(R.parseBefore(""), { kind: "none" })
  assert.deepEqual(R.parseBefore("2026-10-08T01:02:03.000Z"), { kind: "date", date: new Date("2026-10-08T01:02:03.000Z") })
  const c = R.encodeCursor("2026-10-08T01:02:03.000Z", "m9")
  assert.deepEqual(R.parseBefore(c), { kind: "cursor", createdAt: new Date("2026-10-08T01:02:03.000Z"), id: "m9" })
  assert.deepEqual(R.parseBefore("yesterday-ish"), { kind: "invalid" })
  assert.deepEqual(R.parseBefore("c1.%%%"), { kind: "invalid" })
})
test("limit: default 50, max 100, junk → default", () => {
  assert.equal(R.parseLimit(null), 50)
  assert.equal(R.parseLimit("20"), 20)
  assert.equal(R.parseLimit("500"), 100)
  assert.equal(R.parseLimit("0"), 50)
  assert.equal(R.parseLimit("-3"), 50)
  assert.equal(R.parseLimit("abc"), 50)
})
test("olderThan / newerThan break createdAt ties on id", () => {
  const t = new Date("2026-10-08T00:00:00.000Z")
  assert.deepEqual(R.olderThan(t, "m5"), { OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: "m5" } }] })
  assert.deepEqual(R.newerThan(t, "m5"), { OR: [{ createdAt: { gt: t } }, { createdAt: t, id: { gt: "m5" } }] })
})

const rowsAt = (n, startMs) => Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}`, createdAt: new Date(startMs + i * 1000) }))
test("page of older messages: oldest first, hasMore from the extra row, nextCursor past the oldest shown", () => {
  // Newest first, as the route fetches with take = limit + 1.
  const all = rowsAt(10, NOW).reverse()
  const page = R.shapePage(all.slice(0, 4), 3, "older")
  assert.deepEqual(page.messages.map((m) => m.id), ["m007", "m008", "m009"])
  assert.equal(page.hasMore, true)
  assert.deepEqual(R.decodeCursor(page.nextCursor), { createdAt: all[2].createdAt, id: "m007" })
  const last = R.shapePage(all.slice(7, 10), 3, "older")
  assert.deepEqual(last.messages.map((m) => m.id), ["m000", "m001", "m002"])
  assert.equal(last.hasMore, false)
  assert.equal(last.nextCursor, null, "nextCursor key present and null when nothing older")
  assert.deepEqual(R.shapePage([], 50, "older"), { messages: [], hasMore: false, nextCursor: null })
})
test("page of newer messages (after=): oldest first as fetched, nextCursor always null", () => {
  const asc = rowsAt(5, NOW)
  const p = R.shapePage(asc.slice(0, 3), 2, "newer")
  assert.deepEqual(p.messages.map((m) => m.id), ["m000", "m001"])
  assert.equal(p.hasMore, true)
  assert.ok("nextCursor" in p)
  assert.equal(p.nextCursor, null)
  assert.deepEqual(R.shapePage([], 50, "newer"), { messages: [], hasMore: false, nextCursor: null })
})

// ── read up to ──
test("lastReadAt never moves backwards", () => {
  const a = new Date(NOW)
  const earlier = new Date(NOW - 5000)
  const later = new Date(NOW + 5000)
  assert.equal(R.nextLastReadAt(null, a).getTime(), NOW)
  assert.equal(R.nextLastReadAt(a, later).getTime(), NOW + 5000)
  assert.equal(R.nextLastReadAt(a, earlier).getTime(), NOW, "a late report of an older message changes nothing")
  assert.equal(R.nextLastReadAt(a.toISOString(), earlier).getTime(), NOW)
})

// ── unread ──
test("totalUnread: unmuted rooms count everything, muted rooms only their mentions (capped at unread)", () => {
  const s = R.summarizeUnread([
    { conversationId: "a", unread: 5, mutedUntil: null, mentions: 0 },
    { conversationId: "b", unread: 7, mutedUntil: future, mentions: 2 },
    { conversationId: "c", unread: 0, mutedUntil: future, mentions: 3 },
    { conversationId: "d", unread: 4, mutedUntil: past, mentions: 1 },
  ], NOW)
  assert.equal(s.totalUnread, 5 + 2 + 0 + 4)
  assert.equal(s.mentions, 0 + 2 + 0 + 1)
  assert.deepEqual([...s.muted].sort(), ["b", "c"])
  assert.deepEqual(R.summarizeUnread([], NOW), { totalUnread: 0, mentions: 0, muted: new Set() })
})

// ── mute ──
test("mute value: ISO / forever / null / past / junk", () => {
  assert.deepEqual(R.parseMutedUntil(null, NOW), { ok: true, value: null })
  assert.deepEqual(R.parseMutedUntil("forever", NOW), { ok: true, value: new Date(R.MUTE_FOREVER_ISO) })
  assert.deepEqual(R.parseMutedUntil(future, NOW), { ok: true, value: new Date(future) })
  assert.deepEqual(R.parseMutedUntil(past, NOW), { ok: true, value: null }, "a past instant unmutes")
  assert.equal(R.parseMutedUntil("tomorrow", NOW).ok, false)
  assert.equal(R.parseMutedUntil(123, NOW).ok, false)
  assert.equal(R.parseMutedUntil(undefined, NOW).ok, false)
  assert.equal(R.parseMutedUntil("", NOW).ok, false)
})

// ── who may stay in a group/DM ──
test("room with a workspace: you stay while you are in it", () => {
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: "W", userWorkspaceIds: ["W", "P"], otherMembersWorkspaceIds: [] }), true)
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: "W", userWorkspaceIds: ["P"], otherMembersWorkspaceIds: [["W"]] }), false)
})
test("room without one: share a workspace with someone in it", () => {
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: ["W"], otherMembersWorkspaceIds: [["W"]] }), true)
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: ["P"], otherMembersWorkspaceIds: [["W"], ["W", "Q"]] }), false, "left the company")
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: ["Q"], otherMembersWorkspaceIds: [["W"], ["W", "Q"]] }), true)
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: [], otherMembersWorkspaceIds: [["W"]] }), false)
  // The others deleted their accounts (no workspace left): whoever is left keeps the history.
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: ["W"], otherMembersWorkspaceIds: [[]] }), true)
  assert.equal(R.groupRoomAllows({ roomWorkspaceId: null, userWorkspaceIds: ["W"], otherMembersWorkspaceIds: [] }), true)
})
test("new room's workspace: one everybody is in, the creator's oldest first; none → null", () => {
  assert.equal(R.commonWorkspace([["W", "P"], ["W"]], ["P", "W"]), "W")
  assert.equal(R.commonWorkspace([["W", "P"], ["W", "P"]], ["P", "W"]), "P", "creator's oldest wins")
  assert.equal(R.commonWorkspace([["W"], ["Q"]], ["W"]), null)
  assert.equal(R.commonWorkspace([], ["W"]), null)
})

console.log(`chat-rules: ${passed} passed`)
