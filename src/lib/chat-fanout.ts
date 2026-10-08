import { after } from "next/server"
import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { sendPushToUsers, type PushPayload } from "@/lib/apns"
import { createInAppNotification } from "@/lib/notification-service"
import { badgeCountsFor } from "@/lib/chat-unread"
import {
  buildChatPush,
  buildSystemPush,
  chatPushDecision,
  groupRoomAllows,
  parseSystemEvent,
  systemPushDecision,
  systemPushRecipients,
  type SystemPushDecision,
} from "@/lib/chat-rules"

/**
 * Telling the other members of a room about a new message (CHAT-CONTRACT "Push").
 *
 * Runs AFTER the sender has their 201 (runAfterResponse): the reply used to wait for every push to
 * every member's every phone, so one slow connection to Apple made sending feel broken.
 *
 * Per member: a mention always pushes and lands in the Inbox; otherwise a muted room or Do Not Disturb
 * means no push at all, and a plain message never writes an Inbox row any more — the chat itself is
 * where it lives (it used to write one bell row per message per member).
 */

const log = createLogger("chat-push")

/** Run work once the response is on its way. Outside a request (tests, scripts) it simply runs now. */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task()
    } catch (error) {
      log.error(`${label} failed`, { error: String(error) })
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Structured ids from the roster, plus — for the web, which sends text only — an unambiguous @Name. */
export function resolveMentions(
  members: Array<{ userId: string; name: string }>,
  mentionedUserIds: unknown,
  content: unknown,
): Set<string> {
  const memberIds = new Set(members.map((m) => m.userId))
  const mentions = new Set(
    (Array.isArray(mentionedUserIds) ? mentionedUserIds : [])
      .filter((id): id is string => typeof id === "string" && memberIds.has(id)),
  )
  // Accept a textual tag only when its no-space display name identifies exactly one room member.
  const textTags = new Set(Array.from(String(content ?? "").matchAll(/@([\p{L}\p{N}._-]+)/gu), (match) => match[1].toLocaleLowerCase()))
  const membersByTag = new Map<string, string[]>()
  for (const member of members) {
    const tag = member.name.replace(/\s+/g, "").toLocaleLowerCase()
    if (!tag) continue
    membersByTag.set(tag, [...(membersByTag.get(tag) ?? []), member.userId])
  }
  for (const tag of textTags) {
    const matches = membersByTag.get(tag) ?? []
    if (matches.length === 1) mentions.add(matches[0])
  }
  return mentions
}

export type FanOutInput = {
  conversationId: string
  message: {
    id: string
    content: string
    attachmentUrl: string | null
    attachmentType: string | null
    user?: { name?: string | null } | null
  }
  senderId: string
  mentionedUserIds: unknown
  /** The raw `content` the client sent (text tags are read from it, as before). */
  rawContent: unknown
}

/**
 * Belt and braces for rows the membership sync has not caught up with: of a room's members, the ones
 * still in the room's workspace (project rooms: the project's). Only they are told anything.
 * `memberIds` is the WHOLE roster: a room without a workspace asks whether you share one with another
 * member (chat-rules groupRoomAllows).
 */
export async function membersStillInRoom(
  convo: { type: string; workspaceId: string | null; project?: { workspaceId: string } | null },
  memberIds: string[],
): Promise<Set<string>> {
  const ws = await prisma.workspaceMember.findMany({
    where: { userId: { in: memberIds } },
    select: { userId: true, workspaceId: true },
  })
  const wsOf = new Map<string, string[]>()
  for (const w of ws) wsOf.set(w.userId, [...(wsOf.get(w.userId) ?? []), w.workspaceId])
  const out = new Set<string>()
  for (const userId of memberIds) {
    const mine = wsOf.get(userId) ?? []
    const ok = convo.type === "PROJECT"
      ? (convo.project ? mine.includes(convo.project.workspaceId) : false)
      : groupRoomAllows({
          roomWorkspaceId: convo.workspaceId,
          userWorkspaceIds: mine,
          otherMembersWorkspaceIds: memberIds.filter((id) => id !== userId).map((id) => wsOf.get(id) ?? []),
        })
    if (ok) out.add(userId)
  }
  return out
}

export async function fanOutChatMessage(input: FanOutInput): Promise<void> {
  const { conversationId, senderId } = input
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, name: true, workspaceId: true, project: { select: { name: true, workspaceId: true } } },
  })
  if (!convo) return

  // Read now, not at send time: whoever left in between is not told.
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, mutedUntil: true, user: { select: { name: true, dndUntil: true } } },
  })
  const recipients = rows.filter((r) => r.userId !== senderId)
  if (recipients.length === 0) return

  const inRoom = await membersStillInRoom(convo, rows.map((r) => r.userId))
  const eligible = recipients.filter((r) => inRoom.has(r.userId))

  const mentions = resolveMentions(
    eligible.map((r) => ({ userId: r.userId, name: r.user.name })),
    input.mentionedUserIds,
    input.rawContent,
  )
  const senderName = input.message.user?.name ?? "Seseorang"
  const roomName = convo.type === "PROJECT" ? (convo.project?.name ?? convo.name) : convo.name
  const now = new Date()

  const toPush: Array<{ userId: string; isMention: boolean; notificationId: string | null }> = []
  let quiet = 0
  for (const r of eligible) {
    const isMention = mentions.has(r.userId)
    const decision = chatPushDecision({ isMention, mutedUntil: r.mutedUntil, dndUntil: r.user.dndUntil, now })
    let notificationId: string | null = null
    if (decision.inbox) {
      const content = buildChatPush({
        conversationId, messageId: input.message.id, kind: convo.type, conversationName: roomName, senderName,
        content: input.message.content, attachmentUrl: input.message.attachmentUrl, attachmentType: input.message.attachmentType,
        isMention: true,
      })
      const row = await createInAppNotification({
        userId: r.userId,
        type: "MESSAGE_MENTION",
        title: convo.type === "DM" ? `${senderName} mentioned you` : `${senderName} mentioned you in ${content.data.conversationName}`,
        message: content.data.text,
        link: content.link,
        push: false,
      }).catch((error) => {
        log.error("mention inbox row failed", { userId: r.userId, conversationId, error: String(error) })
        return null
      })
      notificationId = row?.id ?? null
    }
    if (decision.push) toPush.push({ userId: r.userId, isMention, notificationId })
    else quiet++
  }
  if (toPush.length === 0) {
    if (quiet) log.info("chat push: everyone muted or in DND", { conversationId, quiet })
    return
  }

  const badges = await badgeCountsFor(toPush.map((p) => p.userId), now).catch((error) => {
    log.warn("chat push: badge counts failed, sending without a badge", { conversationId, error: String(error) })
    return new Map<string, number>()
  })

  const items = toPush.map((p) => {
    const content = buildChatPush({
      conversationId, messageId: input.message.id, kind: convo.type, conversationName: roomName, senderName,
      content: input.message.content, attachmentUrl: input.message.attachmentUrl, attachmentType: input.message.attachmentType,
      isMention: p.isMention,
    })
    const payload: PushPayload = {
      title: content.title,
      body: content.body,
      type: content.type,
      link: content.link,
      threadId: content.threadId,
      data: content.data,
      notificationId: p.notificationId,
      badge: badges.get(p.userId) ?? null,
    }
    return { userId: p.userId, payload }
  })
  await sendPushToUsers(items, `chat:${convo.type}`)
  if (quiet) log.info("chat push: some members muted or in DND", { conversationId, quiet, pushed: items.length })
}

// ── system messages: only the people ADDED are pushed (SYSTEM-MESSAGES contract, 8 Oct 2026) ─────

export type SystemPushPlan = {
  /** Gets a push. */
  push: string[]
  /** Everyone else in the room and why not: not added (the room in general), muted, DND, left the workspace. */
  quiet: Array<{ userId: string; reason: SystemPushDecision["reason"] | "left_workspace" }>
}

/**
 * Who is pushed for one SYSTEM row, read now: the people it added who are still members and still in
 * the room's workspace, unless they are in Do Not Disturb (chat-rules systemPushDecision). Nobody else
 * in the room — a SYSTEM row never pushes to the room in general. No I/O beyond reading.
 */
export async function planSystemPush(conversationId: string, rawEvent: unknown, now: Date = new Date()): Promise<SystemPushPlan> {
  const event = parseSystemEvent(rawEvent)
  const plan: SystemPushPlan = { push: [], quiet: [] }
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, workspaceId: true, project: { select: { workspaceId: true } } },
  })
  if (!convo) return plan
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, mutedUntil: true, user: { select: { dndUntil: true } } },
  })
  const added = new Set(systemPushRecipients(event))
  const inRoom = added.size ? await membersStillInRoom(convo, rows.map((r) => r.userId)) : new Set<string>()
  for (const r of rows) {
    const decision = systemPushDecision({ event, userId: r.userId, mutedUntil: r.mutedUntil, dndUntil: r.user.dndUntil, now })
    if (decision.push && !inRoom.has(r.userId)) plan.quiet.push({ userId: r.userId, reason: "left_workspace" })
    else if (decision.push) plan.push.push(r.userId)
    else plan.quiet.push({ userId: r.userId, reason: decision.reason })
  }
  return plan
}

/** Send the "{actor} menambahkan kamu ke grup" push to the people a SYSTEM row added. */
export async function fanOutSystemMessage(input: {
  conversationId: string
  message: { id: string; event: unknown; user?: { name?: string | null } | null }
}): Promise<void> {
  const { conversationId, message } = input
  const event = parseSystemEvent(message.event)
  if (systemPushRecipients(event).length === 0) return
  const now = new Date()
  const plan = await planSystemPush(conversationId, event, now)
  if (plan.push.length === 0) return
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { name: true } })
  const badges = await badgeCountsFor(plan.push, now).catch((error) => {
    log.warn("system push: badge counts failed, sending without a badge", { conversationId, error: String(error) })
    return new Map<string, number>()
  })
  const content = buildSystemPush({
    conversationId,
    messageId: message.id,
    conversationName: convo?.name ?? event?.name ?? null,
    actorName: event?.actor.name ?? message.user?.name ?? null,
  })
  const items = plan.push.map((userId) => {
    const payload: PushPayload = {
      title: content.title,
      body: content.body,
      type: content.type,
      link: content.link,
      threadId: content.threadId,
      data: content.data,
      badge: badges.get(userId) ?? null,
    }
    return { userId, payload }
  })
  await sendPushToUsers(items, "chat:SYSTEM")
}
