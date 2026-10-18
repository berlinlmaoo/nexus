import prisma from "@/lib/prisma"
import { deleteGideonAttachmentFiles } from "@/lib/gideon-attachments"

/**
 * Deleting a GIDEON chat (owner, 18 Oct 2026). It used to be a hard delete of the chat, its messages and its
 * attached files. Now:
 *   - the person's delete stamps GideonChat.deletedAt: from that moment the chat is gone for them everywhere
 *     (chat list and search, /api/gideon/history, the "latest chat" a released app resumes, the chat a new
 *     question lands in), and the dialog tells them it is kept 90 days for review by the Board of Directors;
 *   - the company One Above All can still read it in Control Room › GIDEON › People › Chats, marked
 *     "Deleted by user" (src/lib/gideon-review.ts);
 *   - after GIDEON_CHAT_RETENTION_DAYS the nightly purge (cron/purge-sheet-revisions) deletes the chat, its
 *     messages (FK cascade) and the files those messages carried.
 * Account deletion still removes everything at once (api/user/account/delete).
 */
export const GIDEON_CHAT_RETENTION_DAYS = 90

/**
 * Soft-deletes one of the person's chats (chatId) or all of them (null). Conditional on deletedAt IS NULL, so
 * two devices racing stamp it once and the first time wins. Raw SQL so @updatedAt is not bumped: the review
 * list orders by the chat's real last activity. Returns how many chats were removed.
 */
export async function softDeleteGideonChats(userId: string, chatId: string | null): Promise<number> {
  return chatId
    ? prisma.$executeRaw`UPDATE "GideonChat" SET "deletedAt" = now() WHERE "id" = ${chatId} AND "userId" = ${userId} AND "deletedAt" IS NULL`
    : prisma.$executeRaw`UPDATE "GideonChat" SET "deletedAt" = now() WHERE "userId" = ${userId} AND "deletedAt" IS NULL`
}

/**
 * Removes chats deleted before `cutoff`, their messages and their attached files. In batches, so a large
 * backlog never holds one long transaction; files go after the rows (a stray file is invisible, a row pointing
 * at a missing file is not).
 */
export async function purgeDeletedGideonChats(cutoff: Date): Promise<{ chats: number; files: number }> {
  let chats = 0
  let files = 0
  for (let round = 0; round < 50; round++) {
    const batch = await prisma.gideonChat.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { deletedAt: "asc" },
      take: 200,
    })
    if (batch.length === 0) break
    const ids = batch.map((c) => c.id)
    const carried = await prisma.gideonMessage.findMany({ where: { chatId: { in: ids } }, select: { attachments: true } })
    // Re-checked inside the delete: a chat is only ever purged while it is still deleted and still past the cutoff.
    const { count } = await prisma.gideonChat.deleteMany({ where: { id: { in: ids }, deletedAt: { lt: cutoff } } })
    chats += count
    files += await deleteGideonAttachmentFiles(carried.map((m) => m.attachments)).catch(() => 0)
    if (batch.length < 200) break
  }
  return { chats, files }
}
