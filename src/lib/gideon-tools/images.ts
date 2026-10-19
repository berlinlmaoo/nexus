import { readFile, stat } from "fs/promises"
import path from "path"
import sharp from "sharp"
import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import { conversationMemberAccess } from "@/lib/chat-access"
import { CHAT_FILE_PREFIX } from "@/lib/chat-files"
import { canReadItem, getVaultActor, storagePath } from "@/lib/vault"
import { clip, str } from "./util"
import type { ExtraTool, Input } from "./types"

/**
 * Pictures that live in NEXUS, for GIDEON to look at (owner, 18 Oct 2026): a task's attachments, pictures sent in a
 * chat the person is a MEMBER of, and Z Vault images the person may read. Access is the page's own: the task's
 * project at Can view (checkProjectAccess), the conversation through conversationMemberAccess, the Vault item through
 * canReadItem (its shelf's read threshold).
 *
 * The bytes travel exactly like a picture attached in the GIDEON chat: downscaled here to the JPEG the chat route
 * makes (1568 px, quality 80 — what a vision model can use), handed to the Hermes plugin, which writes it into the
 * shim's work dir and tells the model to open it with the vision tool (integrations/gideon/plugin images.py). The
 * base64 never reaches the model as text.
 */

const SOURCE_MAX_BYTES = 25 * 1024 * 1024
const UPLOADS = path.join(process.cwd(), "public", "uploads")
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i

class ImageRefusal extends Error {}

type Found = { file: string; name: string; from: string }

function underUploads(url: string, prefix: string): string | null {
  if (!url.startsWith(prefix)) return null
  const rel = url.slice("/api/files/".length).split("?")[0]
  const full = path.resolve(UPLOADS, ...rel.split("/"))
  return full.startsWith(UPLOADS + path.sep) ? full : null
}

async function fromTask(actor: User, input: Input): Promise<Found> {
  const taskId = str(input.taskId)!
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { projectId: true } } } })
  if (!task || !(await checkProjectAccess(actor.id, task.taskList.projectId, ["VIEWER"])).allowed) throw new ImageRefusal("That task does not exist or this person cannot open it.")
  const want = str(input.attachmentId) ?? str(input.attachment) ?? str(input.name)
  const atts = await prisma.attachment.findMany({ where: { taskId, mimeType: { startsWith: "image/" } }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, url: true } })
  if (!atts.length) throw new ImageRefusal(`“${task.title}” has no picture attached.`)
  const pick = want ? atts.filter((a) => a.id === want || a.filename.toLowerCase().includes(want.toLowerCase())) : atts
  if (!pick.length) throw new ImageRefusal(`No picture named like "${want}" on “${task.title}”. Its pictures: ${atts.slice(0, 8).map((a) => a.filename).join(", ")}.`)
  // Several and none named: the newest (or `index`), and the model is told which others exist.
  if (want && pick.length > 1) throw new ImageRefusal(`Several pictures match: ${pick.slice(0, 8).map((a) => a.filename).join(", ")}. Ask which one.`)
  const a = pick[Math.max(0, Math.min(pick.length - 1, Number(input.index ?? 0) || 0))]
  const file = underUploads(a.url, "/api/files/attachments/")
  if (!file) throw new ImageRefusal("That attachment is not stored on this server.")
  return { file, name: a.filename, from: `task “${task.title}”${atts.length > 1 ? ` (picture ${atts.indexOf(a) + 1} of ${atts.length}: ${atts.map((x) => x.filename).slice(0, 6).join(", ")})` : ""}` }
}

async function fromMessage(actor: User, input: Input): Promise<Found> {
  const messageId = str(input.messageId)!
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, attachmentUrl: true, attachmentName: true, attachmentType: true, user: { select: { name: true } } } })
  if (!m) throw new ImageRefusal("That message does not exist.")
  const access = await conversationMemberAccess(actor.id, m.conversationId)
  if (!access.ok) throw new ImageRefusal("That message is in a chat this person is not a member of.")
  const url = m.attachmentUrl ?? ""
  const file = underUploads(url, CHAT_FILE_PREFIX)
  if (!file || !(IMAGE_EXT.test(url) || (m.attachmentType ?? "").startsWith("image/"))) throw new ImageRefusal("That message carries no picture.")
  return { file, name: m.attachmentName || path.basename(url), from: `a picture ${m.user?.name ?? ""} sent in chat`.trim() }
}

async function fromVault(actor: User, input: Input): Promise<Found> {
  const va = await getVaultActor(actor.id)
  if (!va.workspaceId) throw new ImageRefusal("This person has no Z Vault.")
  const id = str(input.vaultItemId)
  const name = str(input.vaultName) ?? str(input.file)
  const items = await prisma.vaultItem.findMany({
    where: { workspaceId: va.workspaceId, deletedAt: null, kind: "FILE", mimeType: { startsWith: "image/" }, ...(id ? { id } : { name: { contains: name ?? "", mode: "insensitive" } }) },
    select: { id: true, name: true, storageKey: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  })
  const readable = []
  for (const it of items) if (await canReadItem(va, it.id)) readable.push(it)
  if (!readable.length) throw new ImageRefusal(id ? "That Z Vault item is not an image this person can read." : `No Z Vault image this person can read is named like "${name}".`)
  const exact = name ? readable.filter((r) => r.name.toLowerCase() === name.toLowerCase()) : readable
  const pick = exact.length ? exact : readable
  if (pick.length > 1) throw new ImageRefusal(`Several Z Vault images match: ${pick.map((p) => p.name).join(", ")}. Ask which one.`)
  if (!pick[0].storageKey) throw new ImageRefusal("That Z Vault item has no file.")
  return { file: storagePath(pick[0].storageKey), name: pick[0].name, from: "Z Vault" }
}

/** A NEXUS file link (as a task, a chat or a Vault page shows it) → the same checks as above. */
async function fromUrl(actor: User, input: Input): Promise<Found> {
  const raw = str(input.url)!
  let p = raw
  try { p = new URL(raw, "https://x.invalid").pathname } catch { /* a bare path */ }
  if (p.startsWith(CHAT_FILE_PREFIX)) {
    // Any message carrying it that the person can read (a picture forwarded to a room they are in).
    const carriers = await prisma.message.findMany({ where: { attachmentUrl: p }, select: { id: true, conversationId: true }, take: 25 })
    if (!carriers.length) throw new ImageRefusal("No chat message carries that picture.")
    for (const c of carriers) if ((await conversationMemberAccess(actor.id, c.conversationId)).ok) return fromMessage(actor, { messageId: c.id })
    throw new ImageRefusal("That picture is in a chat this person is not a member of.")
  }
  if (p.startsWith("/api/files/attachments/")) {
    const a = await prisma.attachment.findFirst({ where: { url: p }, select: { id: true, taskId: true } })
    if (!a) throw new ImageRefusal("That file is not a task attachment.")
    return fromTask(actor, { taskId: a.taskId, attachmentId: a.id })
  }
  const v = /^\/api\/vault\/items\/([^/]+)\/(raw|thumb)/.exec(p)
  if (v) return fromVault(actor, { vaultItemId: v[1] })
  throw new ImageRefusal("That link is not a NEXUS picture GIDEON can open (task attachment, chat picture or Z Vault image).")
}

async function readNexusImage(actor: User, input: Input) {
  let found: Found
  try {
    if (str(input.messageId)) found = await fromMessage(actor, input)
    else if (str(input.taskId)) found = await fromTask(actor, input)
    else if (str(input.vaultItemId) || str(input.vaultName) || str(input.file)) found = await fromVault(actor, input)
    else if (str(input.url)) found = await fromUrl(actor, input)
    else throw new ImageRefusal("Say which picture: taskId (+ attachment name), messageId (from nexus_read_conversation), vaultItemId / vaultName, or its NEXUS url.")
  } catch (e) {
    if (e instanceof ImageRefusal) return { image: null, error: e.message }
    throw e
  }
  let st
  try { st = await stat(found.file) } catch { return { image: null, error: "The picture's file is missing on the server." } }
  if (!st.isFile()) return { image: null, error: "The picture's file is missing on the server." }
  if (st.size > SOURCE_MAX_BYTES) return { image: null, error: `That picture is too big to look at (${Math.round(st.size / 1048576)} MB; the limit is 25 MB).` }
  let out: Buffer, meta: { width?: number; height?: number }
  try {
    const img = sharp(await readFile(found.file), { failOn: "none" }).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 })
    out = await img.toBuffer()
    meta = await sharp(out).metadata()
  } catch {
    return { image: null, error: "That file could not be opened as a picture." }
  }
  return {
    image: { base64: out.toString("base64"), mime: "image/jpeg", bytes: out.length, width: meta.width ?? null, height: meta.height ?? null },
    name: clip(found.name, 120),
    from: found.from,
    note: "Look at the picture with the vision tool (the path the plugin gives), then answer. Describe only what is in it.",
  }
}

export const imageTools: Record<string, ExtraTool> = {
  read_nexus_image: {
    read: readNexusImage,
    stepArg: (i) => str(i.attachment) ?? str(i.vaultName) ?? str(i.name) ?? null,
  },
}
