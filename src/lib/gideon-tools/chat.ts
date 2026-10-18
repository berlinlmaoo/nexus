import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { canPostInConversation, conversationMemberAccess, visibleConversationIdsOf } from "@/lib/chat-access"
import { chatUnreadForUser } from "@/lib/chat-unread"
import { clip, findPerson, limitOf, str, whenWib, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Chat (owner, 18 Oct 2026): GIDEON reads and summarises the person's OWN conversations — DMs, groups and project
 * rooms they are a member of (a member row, even for a BoD who could read any project room) — and writes a
 * message AS them, always on a card showing the exact text and where it goes. Sending is the Chat page's own
 * POST /api/conversations/:id/messages through the person's session (rate limit, Can comment in a project room,
 * realtime, push, unread), never a copy of it.
 */

const MESSAGE_MAX = 4000

type Convo = { id: string; type: string; name: string | null; projectId: string | null; project: { name: string } | null; members: { user: { id: string; name: string | null } }[] }

function convoName(c: Convo, actorId: string): string {
  if (c.name) return c.name
  if (c.project?.name) return c.project.name
  const others = c.members.filter((m) => m.user.id !== actorId).map((m) => m.user.name).filter(Boolean)
  return others.join(", ") || "Chat"
}

const CONVO_SELECT = {
  id: true, type: true, name: true, projectId: true, updatedAt: true,
  project: { select: { name: true } },
  members: { select: { user: { select: { id: true, name: true } } }, take: 8 },
} as const

/** The person's rooms (member + still visible), newest activity first. */
async function myConversations(actor: User) {
  const ids = await visibleConversationIdsOf(actor.id)
  if (!ids.length) return []
  return prisma.conversation.findMany({ where: { id: { in: ids } }, select: CONVO_SELECT, orderBy: { updatedAt: "desc" } })
}

/**
 * One of the person's conversations from what the model passed: conversationId, a person's name (their DM), or a
 * group / project room name. Never a room they are not a member of.
 */
async function resolveConversation(actor: User, input: Input): Promise<Convo & { updatedAt: Date }> {
  const id = str(input.conversationId)
  const rooms = await myConversations(actor)
  if (id) {
    const hit = rooms.find((r) => r.id === id)
    if (!hit) throw new Error("That conversation is not one of this person's chats (they must be a member).")
    return hit
  }
  const person = str(input.with) ?? str(input.person) ?? str(input.to)
  if (person) {
    const p = await findPerson(person, { exclude: actor.id })
    const dm = rooms.find((r) => r.type === "DM" && r.members.some((m) => m.user.id === p.id))
    if (dm) return dm
    throw Object.assign(new Error(`NO_DM:${p.id}:${p.name ?? ""}`), { person: p })
  }
  const name = str(input.conversation) ?? str(input.room) ?? str(input.name) ?? str(input.project) ?? str(input.query)
  if (!name) throw new Error("Say which chat: conversationId, `with` (a person, for their DM) or `conversation` (a group or project room name).")
  const n = name.toLowerCase()
  const exact = rooms.filter((r) => convoName(r, actor.id).toLowerCase() === n)
  const part = exact.length ? exact : rooms.filter((r) => convoName(r, actor.id).toLowerCase().includes(n))
  if (part.length === 1) return part[0]
  if (!part.length) throw new Error(`None of this person's chats is named like "${name}".`)
  throw new Error(`Several chats match "${name}": ${part.slice(0, 6).map((r) => convoName(r, actor.id)).join(", ")}. Ask which one.`)
}

async function listConversations(actor: User, input: Input) {
  const rooms = await myConversations(actor)
  const unread = await chatUnreadForUser(actor.id, { conversationIds: rooms.map((r) => r.id) }).catch(() => null)
  const q = str(input.query)?.toLowerCase()
  const onlyUnread = input.unread === true || input.unread === "true"
  let rows = rooms.map((r) => ({ r, u: unread?.perConversation.get(r.id) }))
  if (q) rows = rows.filter(({ r }) => convoName(r, actor.id).toLowerCase().includes(q))
  if (onlyUnread) rows = rows.filter(({ u }) => (u?.unread ?? 0) > 0)
  const limit = limitOf(input, 15, 40)
  const shown = rows.slice(0, limit)
  const last = shown.length
    ? await prisma.message.findMany({
        where: { conversationId: { in: shown.map(({ r }) => r.id) }, kind: "USER" },
        distinct: ["conversationId"],
        orderBy: [{ conversationId: "asc" }, { createdAt: "desc" }],
        select: { conversationId: true, content: true, createdAt: true, attachmentName: true, attachmentUrl: true, user: { select: { name: true } } },
      })
    : []
  const lastOf = new Map(last.map((m) => [m.conversationId, m]))
  return {
    total: rows.length,
    items: shown.map(({ r, u }) => {
      const m = lastOf.get(r.id)
      return {
        conversationId: r.id,
        name: convoName(r, actor.id),
        kind: r.type === "DM" ? "Direct message" : r.type === "PROJECT" ? "Project room" : "Group",
        ...(u?.unread ? { unread: u.unread } : {}),
        ...(u?.mentions ? { mentions: u.mentions } : {}),
        ...(m ? { last: `${m.user?.name ?? "?"}: ${clip(m.content, 80) ?? (m.attachmentName || (m.attachmentUrl ? "📎" : ""))}`, lastAt: whenWib(m.createdAt) } : {}),
      }
    }),
    ...(rows.length > shown.length ? { more: `${rows.length - shown.length} more; pass query (part of the name) or unread=true.` } : {}),
  }
}

async function readConversation(actor: User, input: Input) {
  let convo
  try { convo = await resolveConversation(actor, input) } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (m.startsWith("NO_DM:")) throw new Error(`There is no chat yet between this person and ${m.split(":").slice(2).join(":") || "them"}.`)
    throw e
  }
  const access = await conversationMemberAccess(actor.id, convo.id)
  if (!access.ok) throw new Error("That conversation is not one of this person's chats.")
  const limit = limitOf(input, 40, 100)
  const sinceDay = str(input.since)
  const since = sinceDay && /^\d{4}-\d{2}-\d{2}$/.test(sinceDay) ? new Date(`${sinceDay}T00:00:00+07:00`) : null
  const onlyUnread = input.unread === true || input.unread === "true"
  const from = onlyUnread && access.member?.lastReadAt ? access.member.lastReadAt : since
  const rows = await prisma.message.findMany({
    where: { conversationId: convo.id, ...(from ? { createdAt: { gt: from } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, content: true, createdAt: true, kind: true, attachmentName: true, attachmentUrl: true, replyToId: true, user: { select: { name: true } } },
  })
  const total = await prisma.message.count({ where: { conversationId: convo.id, ...(from ? { createdAt: { gt: from } } : {}) } })
  const msgs = rows.reverse()
  return {
    conversation: convoName(convo, actor.id),
    conversationId: convo.id,
    kind: convo.type === "DM" ? "Direct message" : convo.type === "PROJECT" ? "Project room" : "Group",
    link: `${PUBLIC_BASE}/messages/${convo.id}`,
    total,
    shown: msgs.length,
    messages: msgs.map((m) => ({
      id: m.id,
      by: m.kind === "SYSTEM" ? "system" : (m.user?.name ?? "?"),
      at: whenWib(m.createdAt),
      text: clip(m.content, 500) ?? (m.attachmentName ? `[file: ${m.attachmentName}]` : m.attachmentUrl ? "[picture]" : ""),
      ...(m.replyToId ? { replyTo: m.replyToId } : {}),
    })),
    ...(total > msgs.length ? { more: `${total - msgs.length} older messages not shown; pass since=YYYY-MM-DD or a bigger limit (max 100).` } : {}),
    note: "Summarise only what these messages say. Never quote a message into another chat without being asked.",
  }
}

/** The card: the exact text and the exact room (or person). Checked now; checked again by the endpoint on Apply. */
async function describeSend(actor: User, input: Input) {
  const text = typeof input.text === "string" ? input.text.trim() : typeof input.content === "string" ? input.content.trim() : typeof input.message === "string" ? input.message.trim() : ""
  if (!text) throw new Error("text is required: the exact message to send.")
  if (text.length > MESSAGE_MAX) throw new Error(`A message is at most ${MESSAGE_MAX} characters.`)
  let target: { conversationId: string | null; dmUserId: string | null; name: string; kind: string }
  try {
    const c = await resolveConversation(actor, input)
    if (!(await canPostInConversation(actor.id, c))) throw new Error(`This person can read ${convoName(c, actor.id)} but not post in it (needs Can comment in that project).`)
    target = { conversationId: c.id, dmUserId: null, name: convoName(c, actor.id), kind: c.type === "DM" ? "Direct message" : c.type === "PROJECT" ? "Project room" : "Group" }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (!m.startsWith("NO_DM:")) throw e
    const [, uid, ...rest] = m.split(":")
    target = { conversationId: null, dmUserId: uid, name: rest.join(":") || "?", kind: "New direct message" }
  }
  let replyToId: string | null = null
  const reply = str(input.replyToId)
  if (reply && target.conversationId) {
    const q = await prisma.message.findFirst({ where: { id: reply, conversationId: target.conversationId }, select: { id: true } })
    if (q) replyToId = q.id
  }
  return {
    summary: `Send a message to ${target.name}`,
    diff: [
      { field: "Recipient", to: target.name },
      { field: "Chat", to: target.kind },
      { field: "Message", to: text },
    ],
    store: { text, target, replyToId },
    preview: text,
    note: "NOT sent yet. It waits on the card below, which shows the exact text and the recipient; the person taps Send. Tell them so in one short sentence and never say it was sent.",
  }
}

export const chatTools: Record<string, ExtraTool> = {
  list_conversations: { read: listConversations, stepArg: (i) => str(i.query) ?? null },
  read_conversation: {
    read: readConversation,
    stepArg: (i) => str(i.with) ?? str(i.conversation) ?? str(i.room) ?? str(i.name) ?? null,
  },
  send_message: {
    describe: describeSend,
    stepArg: (i) => str(i.with) ?? str(i.to) ?? str(i.conversation) ?? str(i.room) ?? null,
    // The Chat page's own endpoints, as the person: a new DM is created (deduplicated by the endpoint) first.
    web: async (input, call) => {
      const target = (input.target ?? {}) as { conversationId?: string | null; dmUserId?: string | null }
      let conversationId = target.conversationId ?? null
      if (!conversationId && target.dmUserId) {
        const r = await call({ method: "POST", path: "/api/conversations", json: { type: "DM", userIds: [target.dmUserId] } })
        conversationId = (r.body?.conversation?.id as string | undefined) ?? null
        if (!r.ok || !conversationId) return { ok: false, message: webError(r, "Couldn't open the chat") }
      }
      if (!conversationId) return { ok: false, message: "No chat to send to." }
      const r = await call({ method: "POST", path: `/api/conversations/${conversationId}/messages`, json: { content: String(input.text ?? ""), ...(input.replyToId ? { replyToId: input.replyToId } : {}) } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't send") }
      const id = (r.body?.message?.id as string | undefined) ?? (r.body?.id as string | undefined) ?? null
      return { ok: true, link: `/messages/${conversationId}`, result: { conversationId, messageId: id } }
    },
  },
}
