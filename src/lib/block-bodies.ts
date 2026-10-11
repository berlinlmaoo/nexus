import prisma from "@/lib/prisma"
import type { InputJsonValue } from "@prisma/client/runtime/client"
import { checkProjectAccess } from "@/lib/rbac"
import { canReadProjectContent, canReadTask } from "@/lib/read-access"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { emitTaskUpdated } from "@/lib/socket-emitter"
import { notifyDocMention, notifyMention } from "@/lib/notification-service"
import { createLogger } from "@/lib/logger"
import { parseClientTag } from "@/lib/client-version"
import {
  EMPTY_DOC, canonicalDoc, docToBlockNote, collectMentions, collectReminders, descriptionOf, docToText, inlineText,
  resolveTaskBody, sanitizeDoc, type BlockDoc, type BlockNode,
} from "@/lib/blockdoc"

/**
 * The two things the block editor edits — a Doc/Page body and a task body — behind one interface, so
 * the REST routes and the live editing rooms (lib/collab-rooms.ts) read, check and save them the same way.
 *
 *   kind "doc"       Doc.content (JSON) + Doc.contentText (its text)
 *   kind "taskbody"  TaskBody.doc (JSON) + Task.description (its text, what released apps read/edit)
 *
 * A save also notifies people newly @-mentioned, syncs "Remind me" chips, and tells open views
 * (task-updated / doc-changed). It never writes audit rows itself: REST routes log their own, a live
 * room logs once per editing session.
 */

const log = createLogger("block-bodies")

export type BodyKind = "doc" | "taskbody"

export type LoadedBody = {
  kind: BodyKind
  id: string
  json: BlockDoc
  title: string
  projectId: string
  /** Task only: the stored text, the editor's base for conflict checks. */
  text: string
  updatedAt: Date
}

export function parseRoomKey(key: unknown): { kind: BodyKind; id: string } | null {
  if (typeof key !== "string" || key.length > 120) return null
  const m = /^(doc|taskbody):([A-Za-z0-9_-]{6,64})$/.exec(key)
  return m ? { kind: m[1] as BodyKind, id: m[2] } : null
}

export async function loadBody(kind: BodyKind, id: string): Promise<LoadedBody | null> {
  if (kind === "doc") {
    const doc = await prisma.doc.findUnique({ where: { id }, select: { content: true, contentText: true, title: true, projectId: true, updatedAt: true } })
    if (!doc) return null
    const json = sanitizeDoc(doc.content) ?? EMPTY_DOC
    return { kind, id, json, title: doc.title, projectId: doc.projectId, text: doc.contentText ?? "", updatedAt: doc.updatedAt }
  }
  const task = await prisma.task.findUnique({
    where: { id },
    select: { description: true, title: true, updatedAt: true, taskList: { select: { projectId: true } }, body: { select: { doc: true } } },
  })
  if (!task) return null
  return {
    kind, id,
    json: resolveTaskBody(task.description, task.body?.doc ?? null),
    title: task.title,
    projectId: task.taskList.projectId,
    text: task.description ?? "",
    updatedAt: task.updatedAt,
  }
}

/** May read (and, for docs, edit — the doc page's own rule) / may edit. `exists` false = unknown id. */
export async function bodyAccess(userId: string, kind: BodyKind, id: string): Promise<{ exists: boolean; read: boolean; write: boolean; projectId: string | null }> {
  if (kind === "doc") {
    const doc = await prisma.doc.findUnique({ where: { id }, select: { projectId: true } })
    if (!doc) return { exists: false, read: false, write: false, projectId: null }
    const ok = await canReadProjectContent(userId, doc.projectId)
    return { exists: true, read: ok, write: ok, projectId: doc.projectId }
  }
  const verdict = await canReadTask(userId, id)
  if (verdict === "not_found") return { exists: false, read: false, write: false, projectId: null }
  if (verdict !== "ok") return { exists: true, read: false, write: false, projectId: null }
  const task = await prisma.task.findUnique({ where: { id }, select: { taskList: { select: { projectId: true } } } })
  if (!task) return { exists: false, read: false, write: false, projectId: null }
  // The rule of PATCH /api/tasks/{id} (which is what saved the description until now).
  const write = (await checkProjectAccess(userId, task.taskList.projectId, ["MEMBER"])).allowed
  return { exists: true, read: true, write, projectId: task.taskList.projectId }
}

/** Text of the block a mention sits in, for the notification. */
function mentionSnippet(doc: BlockDoc, userId: string): string {
  let found = ""
  const walk = (n: BlockNode): boolean => {
    if (n.content?.some((c) => c.type === "mention" && c.attrs?.id === userId)) {
      found = inlineText(n.content)
      return true
    }
    return (n.content ?? []).some(walk)
  }
  doc.content.some(walk)
  return found.trim()
}

function remindAtOf(date: string, time: string | null): Date {
  // Asia/Jakarta has no DST: +07:00 all year.
  return new Date(`${date}T${time ?? "09:00"}:00+07:00`)
}

async function canSee(kind: BodyKind, id: string, projectId: string, userId: string): Promise<boolean> {
  return kind === "doc" ? canReadProjectContent(userId, projectId) : (await canReadTask(userId, id)) === "ok"
}

/** Mentions added by this save (not the ones already there), each to a person who can open the thing. */
async function notifyNewMentions(body: LoadedBody, prev: BlockDoc, next: BlockDoc, actorId: string | null) {
  const before = collectMentions(prev).users
  const added = [...collectMentions(next).users].filter((u) => !before.has(u) && u !== actorId)
  if (!added.length) return
  const actor = actorId ? await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null
  const byName = actor?.name || "Someone"
  const users = await prisma.user.findMany({ where: { id: { in: added.slice(0, 50) } }, select: { id: true } })
  for (const u of users) {
    if (!(await canSee(body.kind, body.id, body.projectId, u.id))) continue
    const snippet = mentionSnippet(next, u.id)
    const send = body.kind === "doc"
      ? notifyDocMention({ mentionedUserId: u.id, mentionedByName: byName, docId: body.id, docTitle: body.title, snippet, projectId: body.projectId })
      : notifyMention({ mentionedUserId: u.id, mentionedByName: byName, taskId: body.id, taskTitle: body.title, commentSnippet: snippet, projectId: body.projectId })
    send.catch((error) => log.warn("mention notification failed", { error: String(error) }))
  }
}

/** BlockReminder rows = the "Remind me" chips now in the body (for people who can open it). */
async function syncReminders(body: LoadedBody, next: BlockDoc) {
  const kind = body.kind === "doc" ? "doc" : "task"
  const wanted = collectReminders(next).filter((r) => r.userId)
  const keep: string[] = []
  for (const r of wanted.slice(0, 100)) {
    const userId = r.userId!
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!exists || !(await canSee(body.kind, body.id, body.projectId, userId))) continue
    const remindAt = remindAtOf(r.date, r.time)
    if (Number.isNaN(remindAt.getTime())) continue
    const row = await prisma.blockReminder.upsert({
      where: { sourceKind_sourceId_userId_key: { sourceKind: kind, sourceId: body.id, userId, key: r.key } },
      create: { sourceKind: kind, sourceId: body.id, userId, key: r.key, remindAt, text: r.text },
      update: { text: r.text },
      select: { id: true },
    })
    keep.push(row.id)
  }
  await prisma.blockReminder.deleteMany({ where: { sourceKind: kind, sourceId: body.id, id: { notIn: keep } } })
}

/**
 * Lists elsewhere only need to hear about a body edited live now and then, not on every autosave
 * (every second or two while someone types): a live room's saves announce at most every 8 s per body,
 * the last one always (trailing).
 */
const ANNOUNCE_EVERY_MS = 8000
const g = globalThis as unknown as { __nexusBodyAnnounce?: Map<string, { at: number; timer: ReturnType<typeof setTimeout> | null; fn: (() => void) | null }> }
const announces = g.__nexusBodyAnnounce ?? (g.__nexusBodyAnnounce = new Map())
function announce(key: string, throttle: boolean, fn: () => void) {
  if (!throttle) { fn(); return }
  const now = Date.now()
  const a = announces.get(key) ?? { at: 0, timer: null, fn: null }
  announces.set(key, a)
  if (now - a.at >= ANNOUNCE_EVERY_MS && !a.timer) {
    a.at = now
    fn()
    return
  }
  a.fn = fn
  if (!a.timer) {
    a.timer = setTimeout(() => {
      a.timer = null
      a.at = Date.now()
      const f = a.fn
      a.fn = null
      f?.()
      if (!a.timer) announces.delete(key)
    }, Math.max(500, ANNOUNCE_EVERY_MS - (now - a.at)))
  }
}

/**
 * Store a body. `prev` is what the saver started from (mentions already there are not notified again).
 * Returns the stored JSON and text.
 */
export async function saveBody(
  body: LoadedBody,
  next: BlockDoc,
  opts: { actorId: string | null; prev?: BlockDoc; fromRoom?: boolean },
): Promise<{ json: BlockDoc; text: string | null; updatedAt: Date }> {
  const text = descriptionOf(next)
  let updatedAt: Date
  if (body.kind === "doc") {
    const row = await prisma.doc.update({ where: { id: body.id }, data: { content: next as unknown as InputJsonValue, contentText: text }, select: { updatedAt: true, projectId: true } })
    updatedAt = row.updatedAt
    announce(`doc:${body.id}`, !!opts.fromRoom, () => eventBus.emit(BUS_EVENTS.DOC_CHANGED, { projectId: row.projectId, docId: body.id, actorId: opts.actorId }))
  } else {
    const [task] = await prisma.$transaction([
      prisma.task.update({ where: { id: body.id }, data: { description: text }, select: { id: true, parentId: true, updatedAt: true, taskList: { select: { projectId: true } } } }),
      prisma.taskBody.upsert({ where: { taskId: body.id }, create: { taskId: body.id, doc: next as unknown as InputJsonValue, updatedById: opts.actorId }, update: { doc: next as unknown as InputJsonValue, updatedById: opts.actorId } }),
    ])
    updatedAt = task.updatedAt
    // Ids (and the new text) only: lists refetch; iOS reads id/parentId.
    announce(`task:${body.id}`, !!opts.fromRoom, () => emitTaskUpdated(task.taskList.projectId, { id: task.id, parentId: task.parentId, description: text, updatedAt: task.updatedAt.toISOString() }))
  }
  // A REST save while a live room has the body open: the room reloads from what was just stored.
  if (!opts.fromRoom) eventBus.emit(BUS_EVENTS.COLLAB_EXTERNAL_WRITE, { key: `${body.kind}:${body.id}` })
  await notifyNewMentions(body, opts.prev ?? body.json, next, opts.actorId).catch((error) => log.warn("mentions failed", { error: String(error) }))
  await syncReminders(body, next).catch((error) => log.warn("reminders failed", { error: String(error) }))
  return { json: next, text, updatedAt }
}

/** True when two documents are the same content (ignoring key order and null attrs). */
export function sameDoc(a: unknown, b: unknown): boolean {
  return canonicalDoc(a) === canonicalDoc(b)
}

export { docToText }

/**
 * The released Android app reads `Doc.content` as BlockNote blocks and shows TipTap JSON as one run-on
 * paragraph (feature/docs/Docs.kt DocBlocks). It gets the same document in the shape it reads; every
 * other client gets the stored TipTap JSON (format: lib/blockdoc.ts).
 */
export function contentForClient<T extends { content?: unknown }>(req: Request, doc: T): T {
  if (parseClientTag(req.headers.get("x-nexus-client"))?.platform !== "android") return doc
  const c = doc.content as { type?: unknown } | null | undefined
  return c && typeof c === "object" && c.type === "doc" ? { ...doc, content: docToBlockNote(c) } : doc
}
