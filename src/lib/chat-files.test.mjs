// node src/lib/chat-files.test.mjs
//
// Plain node, no test runner (same loader as image-sniff.test.mjs). What chat accepts as a document,
// how a disguised file is refused, and what an app that only knows pictures is sent instead.
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

const f = await load("chat-files.ts")
const bytes = (...xs) => new Uint8Array(xs)
const ascii = (s) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)))
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}

const PDF = ascii("%PDF-1.7\n%âãÏÓ\n")
const MZ = concat(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03), new Uint8Array(40))
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0)
const ZIP = concat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00), ascii("[Content_Types].xml"))
const DOCX = concat(ZIP, ascii("word/document.xml"))
const XLSX = concat(ZIP, ascii("xl/workbook.xml"))

test("extension allowlist", () => {
  assert.equal(f.extensionOfName("Laporan Q3.PDF"), "pdf")
  assert.equal(f.extensionOfName(".bashrc"), "")
  assert.equal(f.extensionOfName("a/b\\c.tar.zip"), "zip")
  assert.deepEqual(f.classifyChatUpload("x.pdf", null), { ok: true, kind: "file", type: "application/pdf", ext: "pdf", maxBytes: 25 * 1024 * 1024 })
  assert.equal(f.classifyChatUpload("x.exe", null).ok, false)
  assert.equal(f.classifyChatUpload("x.html", null).ok, false)
  assert.equal(f.classifyChatUpload("x.svg", null).ok, false)
  assert.equal(f.classifyChatUpload("noext", null).ok, false)
  const img = f.classifyChatUpload("whatever.pdf", "image/jpeg")
  assert.equal(img.kind, "image")
  assert.equal(img.ext, "jpg")
  assert.equal(img.maxBytes, 8 * 1024 * 1024)
})

test("magic bytes", () => {
  assert.equal(f.bytesMatchDoc("pdf", PDF), true)
  assert.equal(f.bytesMatchDoc("pdf", MZ), false, "a program renamed .pdf")
  assert.equal(f.bytesMatchDoc("doc", OLE), true)
  assert.equal(f.bytesMatchDoc("doc", PDF), false)
  assert.equal(f.bytesMatchDoc("zip", ZIP), true)
  assert.equal(f.bytesMatchDoc("zip", MZ), false)
  assert.equal(f.bytesMatchDoc("docx", DOCX, DOCX), true)
  assert.equal(f.bytesMatchDoc("docx", XLSX, XLSX), false, "a workbook renamed .docx")
  assert.equal(f.bytesMatchDoc("xlsx", XLSX, XLSX), true)
  assert.equal(f.bytesMatchDoc("csv", ascii("a,b\n1,2\n")), true)
  assert.equal(f.bytesMatchDoc("txt", MZ), false)
  assert.equal(f.bytesMatchDoc("txt", bytes(0x68, 0x00, 0x69)), false, "NUL = binary")
  assert.equal(f.bytesMatchDoc("exe", MZ), false)
})

test("file names", () => {
  assert.equal(f.cleanFileName("../../etc/passwd", "txt"), "passwd.txt")
  assert.equal(f.cleanFileName('Lap"oran\r\n Q3.pdf', "pdf"), "Laporan Q3.pdf")
  assert.equal(f.cleanFileName("", "pdf"), "file.pdf")
  assert.equal(f.cleanFileName("Report", "docx"), "Report.docx")
  const long = f.cleanFileName("a".repeat(400) + ".pdf", "pdf")
  assert.equal(long.length, 180)
  assert.ok(long.endsWith(".pdf"))
})

test("stored names and paths", () => {
  assert.ok(f.CHAT_STORED_NAME.test("0b0f7c3e-1d2a-4f8e-9a1b-2c3d4e5f6a7b.pdf"))
  assert.ok(!f.CHAT_STORED_NAME.test("../x.pdf"))
  assert.equal(f.docSpecOfPath("/api/files/chat/0b0f7c3e-1d2a-4f8e-9a1b-2c3d4e5f6a7b.pdf")?.mime, "application/pdf")
  assert.equal(f.docSpecOfPath("/api/files/chat/0b0f7c3e-1d2a-4f8e-9a1b-2c3d4e5f6a7b.jpg"), null)
  assert.equal(f.docSpecOfPath("/api/files/other/x.pdf"), null)
})

test("sizes", () => {
  assert.equal(f.formatBytes(12), "12 B")
  assert.equal(f.formatBytes(2048), "2 KB")
  assert.equal(f.formatBytes(1258291), "1,2 MB")
})

test("who draws files", () => {
  assert.equal(f.clientDrawsChatFiles("web/1", null), true)
  assert.equal(f.clientDrawsChatFiles("ios/0.1.6/12", null), false)
  assert.equal(f.clientDrawsChatFiles(null, null), false)
  assert.equal(f.clientDrawsChatFiles("android/0.1.6/7", null), false)
  assert.equal(f.clientDrawsChatFiles("ios/0.1.8/20", "chat-files"), true)
  assert.equal(f.clientDrawsChatFiles("ios/0.1.8/20", "foo, chat-files"), true)
})

test("old apps get a text line, not a broken photo", () => {
  const url = "/api/files/chat/0b0f7c3e-1d2a-4f8e-9a1b-2c3d4e5f6a7b.pdf"
  const doc = { id: "m1", content: "", attachmentUrl: url, attachmentType: "application/pdf", attachmentName: "Laporan.pdf", attachmentSize: 1258291 }
  const shaped = f.shapeForOldApp(doc)
  assert.equal(shaped.attachmentUrl, null)
  assert.equal(shaped.content, "📎 Laporan.pdf · 1,2 MB")
  assert.equal(doc.attachmentUrl, url, "the original is not mutated")
  assert.equal(f.shapeForOldApp({ ...doc, content: "cek ya" }).content, "cek ya\n📎 Laporan.pdf · 1,2 MB")
  const pic = { id: "m2", content: "", attachmentUrl: "/api/files/chat/0b0f7c3e-1d2a-4f8e-9a1b-2c3d4e5f6a7b.jpg", attachmentType: "image/jpeg" }
  assert.equal(f.shapeForOldApp(pic), pic)
  const reply = f.shapeMessageForOldApp({ id: "m3", content: "ok", attachmentUrl: null, replyTo: doc })
  assert.equal(reply.replyTo.attachmentUrl, null)
  assert.equal(reply.replyTo.content, "📎 Laporan.pdf · 1,2 MB")
})

// Who may load a chat file: conversationAccess's rule, judged from one query's row.
const wide = (role) => role === "ONE_ABOVE_ALL" || role === "BOD"
const row = (o) => ({
  conversationId: "c1", attachmentName: null, type: "GROUP", projectId: null, roomWorkspaceId: "w1",
  isMember: true, inRoomWorkspace: true, projectWorkspaceRole: null, isProjectMember: false, ...o,
})

test("group/DM: member row AND in the room's workspace", () => {
  assert.equal(f.chatCarrierVerdict(row({}), wide), "allow")
  assert.equal(f.chatCarrierVerdict(row({ type: "DM" }), wide), "allow")
  assert.equal(f.chatCarrierVerdict(row({ isMember: false }), wide), "deny", "not in the group")
  assert.equal(f.chatCarrierVerdict(row({ inRoomWorkspace: false }), wide), "deny", "offboarded: left the workspace")
  assert.equal(f.chatCarrierVerdict(row({ isMember: false, inRoomWorkspace: false }), wide), "deny")
})

test("group/DM without a workspace: only the full check can tell", () => {
  assert.equal(f.chatCarrierVerdict(row({ roomWorkspaceId: null, inRoomWorkspace: false }), wide), "ask")
  assert.equal(f.chatCarrierVerdict(row({ roomWorkspaceId: null, isMember: false }), wide), "deny", "no member row is never asked")
})

test("project room: project access at any level, BoD/OAA everywhere in their workspace", () => {
  const p = (o) => row({ type: "PROJECT", projectId: "p1", roomWorkspaceId: "w1", isMember: false, projectWorkspaceRole: "STAFF", ...o })
  assert.equal(f.chatCarrierVerdict(p({ isProjectMember: true }), wide), "allow", "Can view member")
  assert.equal(f.chatCarrierVerdict(p({}), wide), "deny", "staff not in the project")
  assert.equal(f.chatCarrierVerdict(p({ isMember: true }), wide), "deny", "a stale room member row is not project access")
  assert.equal(f.chatCarrierVerdict(p({ projectWorkspaceRole: "MANAGER" }), wide), "deny", "Manager must be invited")
  assert.equal(f.chatCarrierVerdict(p({ projectWorkspaceRole: "BOD" }), wide), "allow")
  assert.equal(f.chatCarrierVerdict(p({ projectWorkspaceRole: "ONE_ABOVE_ALL" }), wide), "allow")
  assert.equal(f.chatCarrierVerdict(p({ projectWorkspaceRole: null, isProjectMember: true }), wide), "deny", "offboarded project member")
  // A PROJECT row without a project falls back to the group rule, as conversationAccess does.
  assert.equal(f.chatCarrierVerdict(row({ type: "PROJECT", projectId: null }), wide), "allow")
})

test("pickChatFileCarrier: any carrier is enough, first allow wins, asks only when nothing allows", () => {
  const deny = row({ conversationId: "a", isMember: false })
  const ask = row({ conversationId: "b", roomWorkspaceId: null, inRoomWorkspace: false })
  const allow = row({ conversationId: "c", attachmentName: "x.pdf" })
  assert.deepEqual(f.pickChatFileCarrier([], wide), { carrier: null, ask: [] }, "unsent / deleted: nothing carries it")
  assert.deepEqual(f.pickChatFileCarrier([deny], wide), { carrier: null, ask: [] })
  assert.equal(f.pickChatFileCarrier([deny, ask, allow], wide).carrier.conversationId, "c")
  assert.deepEqual(f.pickChatFileCarrier([deny, ask, allow], wide).ask, [])
  assert.deepEqual(f.pickChatFileCarrier([deny, ask], wide).ask.map((r) => r.conversationId), ["b"])
})

test("chat file validators: ETag from size+mtime, 304 rules", () => {
  const mtime = new Date("2026-10-18T05:06:07.890Z")
  const etag = f.chatFileEtag(12345, mtime.getTime())
  assert.match(etag, /^W\/"[0-9a-z]+-[0-9a-z]+"$/)
  assert.notEqual(etag, f.chatFileEtag(12346, mtime.getTime()))
  assert.equal(f.chatNotModified(etag, null, etag, mtime), true)
  assert.equal(f.chatNotModified(etag.slice(2), null, etag, mtime), true, "weak comparison")
  assert.equal(f.chatNotModified(`"zzz", ${etag}`, null, etag, mtime), true, "list")
  assert.equal(f.chatNotModified("*", null, etag, mtime), true)
  assert.equal(f.chatNotModified('"other"', mtime.toUTCString(), etag, mtime), false, "If-None-Match decides over If-Modified-Since")
  assert.equal(f.chatNotModified(null, mtime.toUTCString(), etag, mtime), true, "second precision")
  assert.equal(f.chatNotModified(null, new Date(mtime.getTime() - 2000).toUTCString(), etag, mtime), false)
  assert.equal(f.chatNotModified(null, "garbage", etag, mtime), false)
  assert.equal(f.chatNotModified(null, null, etag, mtime), false)
})

console.log(`chat-files: ${passed} passed`)
