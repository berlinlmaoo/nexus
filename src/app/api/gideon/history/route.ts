// Gideon chat history for the logged-in user. The panel loads this on open so a conversation
// survives closing the panel, refreshing, and switching devices. Always scoped to the session
// user — history is private and never addressable by userId from the client.
export const dynamic = "force-dynamic"

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { deleteGideonAttachmentFiles, parseGideonAttachments } from '@/lib/gideon-attachments'
import { proposalView, type GideonRunMeta } from '@/lib/gideon-runs'

// Newest N turns are enough to resume a conversation; older ones stay in the table but are not
// shipped to the client (keeps the payload and the prompt context bounded).
const HISTORY_LIMIT = 100

/**
 * ?chatId= — one conversation (12 Oct 2026, chat history). Without it: the person's most recent conversation,
 * which is what released iOS / Android show (they keep one running conversation). Older rows were gathered
 * into one chat per person by prisma/sql/2026-10-12-agents-gideon-ai.sql. The response also names the chat.
 */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    const wanted = new URL(req.url).searchParams.get('chatId')
    const chat = wanted
      ? await prisma.gideonChat.findFirst({ where: { id: wanted, userId: session.user.id }, select: { id: true, title: true, updatedAt: true } })
      : await prisma.gideonChat.findFirst({ where: { userId: session.user.id }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, updatedAt: true } })
    if (wanted && !chat) return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404 })
    const rows = await prisma.gideonMessage.findMany({
      where: chat ? { userId: session.user.id, chatId: chat.id } : { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true, tools: true, attachments: true, runId: true, meta: true },
    })
    // A proposal's status moves after the turn was saved (Apply / Discard), so the stored meta is
    // refreshed from GideonProposal: a reopened panel must not offer to apply something already applied.
    const runIds = rows.map((r) => r.runId).filter((x): x is string => Boolean(x))
    const proposals = runIds.length
      ? await prisma.gideonProposal.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: 'asc' } })
      : []
    const metaOf = (row: { runId: string | null; meta: unknown }) => {
      if (!row.meta || typeof row.meta !== 'object') return null
      const meta = row.meta as GideonRunMeta
      const mine = proposals.filter((p) => p.runId === row.runId).map(proposalView)
      return { ...meta, proposals: mine.length ? mine : (meta.proposals ?? []) }
    }
    // Fetched newest-first to apply the cap, rendered oldest-first.
    //
    // `attachments` is always an ARRAY on the way out, empty where the column is NULL — which is
    // every row written before this feature and most rows written after it. A client that has to
    // tell null from absent from empty in order to draw nothing is a client with three ways to get
    // the common case wrong. It is also parsed rather than passed through: the column is jsonb, so
    // what is in it is whatever was put there, and a chip is only drawn for a file this app wrote.
    return Response.json({
      chat: chat ? { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.toISOString() } : null,
      messages: rows.reverse().map((row) => ({
        role: row.role,
        content: row.content,
        tools: row.tools,
        attachments: parseGideonAttachments(row.attachments),
        // Added 12 Oct 2026; older clients ignore them.
        runId: row.runId,
        meta: metaOf(row),
      })),
    })
  } catch (error) {
    console.error('GIDEON history GET error:', error)
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
  }
}

/** No chatId: every conversation (what "Clear history" has always meant). ?chatId=: just that one. */
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    // Clearing the chat is what deletes a kept attachment; nothing else does, and nothing deletes
    // one on a timer. The owner asked that a file stay openable at any time, which rules out an age
    // rule — so the file's life is the turn's life, and this is where a turn ends.
    //
    // Read before the delete, because after it there is nothing left that names the files. Every
    // row of this user's is read rather than only the ones with a column set: it is one narrow
    // column on an index this query already uses, and a Prisma JSON-null filter is a subtlety not
    // worth buying for the handful of rows involved.
    const only = new URL(req.url).searchParams.get('chatId')
    const scope = only ? { userId: session.user.id, chatId: only } : { userId: session.user.id }
    const owned = await prisma.gideonMessage.findMany({
      where: scope,
      select: { attachments: true },
    })
    const { count } = await prisma.gideonMessage.deleteMany({ where: scope })
    await prisma.gideonChat.deleteMany({ where: only ? { id: only, userId: session.user.id } : { userId: session.user.id } })
    // After the rows, deliberately. A file left behind by a failed unlink is disk nobody can reach;
    // a row left behind by a failed delete is a chip pointing at a file that is already gone. Only
    // one of those two is visible to the person who pressed Clear.
    const removed = await deleteGideonAttachmentFiles(owned.map((row) => row.attachments)).catch((error) => {
      console.error('GIDEON attachment cleanup error:', error)
      return 0
    })
    return Response.json({ ok: true, deleted: count, files: removed })
  } catch (error) {
    console.error('GIDEON history DELETE error:', error)
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
  }
}
