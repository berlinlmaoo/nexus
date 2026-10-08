import type { Prisma } from "@/generated/prisma"
import { CHAT_MESSAGE_INCLUDE } from "@/lib/chat-access"
import { fanOutSystemMessage, runAfterResponse } from "@/lib/chat-fanout"
import {
  MESSAGE_KIND_SYSTEM,
  systemMessageFallback,
  systemPushRecipients,
  type SystemEvent,
  type SystemPerson,
} from "@/lib/chat-rules"
import { emitConversationUpdated, emitMessageCreated } from "@/lib/socket-emitter"

/**
 * System messages: the log lines a GROUP keeps of its own changes, like WhatsApp's "Najmi added
 * ~Yuza" (SYSTEM-MESSAGES contract, owner 8 Oct 2026). Written at exactly four points, each in the
 * same transaction as the change it records:
 *
 *   POST   /api/conversations                 type GROUP   → group_created
 *   POST   /api/conversations/:id/members     somebody new → members_added (only those really added)
 *   DELETE /api/conversations/:id/members     a member out → member_removed / member_left (yourself)
 *   PATCH  /api/conversations/:id             a new name   → group_renamed
 *
 * DMs never get one; project rooms neither (their members follow the project).
 *
 * A SYSTEM row is a Message with kind "SYSTEM": userId = the actor (the column is required), content =
 * an Indonesian sentence for clients that don't know `kind` yet, event = what happened. It never counts
 * as unread (chat-unread.ts), never pushes to the room — only the people it adds get one push each
 * (chat-fanout.ts fanOutSystemMessage) — and cannot be replied to (messages route).
 */

type Tx = Prisma.TransactionClient

/** Names of these people, in the order given (a missing account keeps its id and an empty name). */
export async function systemPeople(tx: Tx, ids: string[]): Promise<SystemPerson[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const rows = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  const nameOf = new Map(rows.map((r) => [r.id, r.name]))
  return unique.map((id) => ({ id, name: nameOf.get(id) ?? "" }))
}

/**
 * Write one SYSTEM row inside the caller's transaction and move the room to the top of everyone's
 * list (updatedAt), as a new message does. Returns the row in the shape the messages API sends.
 */
export async function writeSystemMessage(tx: Tx, input: { conversationId: string; actorId: string; event: SystemEvent }) {
  const message = await tx.message.create({
    data: {
      conversationId: input.conversationId,
      userId: input.actorId,
      kind: MESSAGE_KIND_SYSTEM,
      content: systemMessageFallback(input.event),
      event: input.event as unknown as Prisma.InputJsonValue,
    },
    include: CHAT_MESSAGE_INCLUDE,
  })
  await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: message.createdAt } })
  return message
}

export type WrittenSystemMessage = Awaited<ReturnType<typeof writeSystemMessage>>

/**
 * After the transaction committed: the line appears in every open thread of the room (message-created
 * to `memberIds`, the roster AFTER the change) and every list moves (conversation-updated, reason
 * "membership", to the roster plus `alsoUserIds` — someone who just left or was removed still needs
 * their list to drop the room). Then, after the response, one push to each person it added.
 */
export function announceSystemMessage(input: {
  conversationId: string
  message: WrittenSystemMessage
  memberIds: string[]
  alsoUserIds?: string[]
}): void {
  const { conversationId, message } = input
  emitMessageCreated(conversationId, message as unknown as Record<string, unknown>, input.memberIds)
  emitConversationUpdated([...input.memberIds, ...(input.alsoUserIds ?? [])], {
    conversationId,
    lastMessageAt: message.createdAt.toISOString(),
    reason: "membership",
  })
  if (systemPushRecipients(message.event as unknown as SystemEvent).length > 0) {
    runAfterResponse("chat system push", () => fanOutSystemMessage({ conversationId, message }))
  }
}
