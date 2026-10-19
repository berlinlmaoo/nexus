// Gideon chat history for the logged-in user. The panel loads this on open so a conversation
// survives closing the panel, refreshing, and switching devices. Always scoped to the session
// user — history is private and never addressable by userId from the client.
export const dynamic = "force-dynamic"

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { parseGideonAttachments } from '@/lib/gideon-attachments'
import { softDeleteGideonChats } from '@/lib/gideon-chat-retention'
import { proposalLang, proposalView, type GideonRunMeta } from '@/lib/gideon-runs'
import { memoryView } from '@/lib/gideon-memory'

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
      ? await prisma.gideonChat.findFirst({ where: { id: wanted, userId: session.user.id, deletedAt: null }, select: { id: true, title: true, updatedAt: true } })
      : await prisma.gideonChat.findFirst({ where: { userId: session.user.id, deletedAt: null }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, updatedAt: true } })
    if (wanted && !chat) return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404 })
    const rows = await prisma.gideonMessage.findMany({
      // No live chat: only turns that never belonged to one (rows older than chats). Never "all of this
      // person's rows", which would bring back conversations they deleted (kept for the OAA review).
      where: chat ? { userId: session.user.id, chatId: chat.id } : { userId: session.user.id, chatId: null },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true, tools: true, attachments: true, runId: true, meta: true },
    })
    // A proposal's status moves after the turn was saved (Apply / Discard), so the stored meta is
    // refreshed from GideonProposal: a reopened panel must not offer to apply something already applied.
    const runIds = rows.map((r) => r.runId).filter((x): x is string => Boolean(x))
    const lang = await proposalLang(session.user.id, req.headers)
    const proposals = runIds.length
      ? await prisma.gideonProposal.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: 'asc' } })
      : []
    // GIDEON Memory chips (19 Oct 2026) likewise: Saved / Not saved since, or edited in Settings.
    const memories = runIds.length
      ? await prisma.gideonMemory.findMany({ where: { userId: session.user.id, sourceRunId: { in: runIds } }, orderBy: { createdAt: 'asc' } })
      : []
    const metaOf = (row: { runId: string | null; meta: unknown }) => {
      if (!row.meta || typeof row.meta !== 'object') return null
      const meta = row.meta as GideonRunMeta
      const mine = proposals.filter((p) => p.runId === row.runId).map((p) => proposalView(p, lang))
      const mems = memories.filter((m) => m.sourceRunId === row.runId).map(memoryView)
      return { ...meta, proposals: mine.length ? mine : (meta.proposals ?? []), ...(mems.length ? { memories: mems } : {}) }
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

/** No chatId: every conversation (what "Clear history" has always meant). ?chatId=: just that one. Soft: see below. */
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    // A soft delete since 18 Oct 2026 (owner): the conversations vanish for the person everywhere and are kept
    // 90 days for the company One Above All's review, then purged with their files (lib/gideon-chat-retention.ts).
    // The confirm dialogs say so. Turns older than chats (no chatId) are first gathered into one chat, so they
    // are hidden and retained the same way instead of lingering or vanishing outright.
    const only = new URL(req.url).searchParams.get('chatId')
    const userId = session.user.id
    const count = await prisma.gideonMessage.count({ where: only ? { userId, chatId: only, chat: { deletedAt: null } } : { userId, OR: [{ chatId: null }, { chat: { deletedAt: null } }] } })
    if (!only) {
      await prisma.$transaction(async (tx) => {
        const loose = await tx.gideonMessage.count({ where: { userId, chatId: null } })
        if (loose === 0) return
        // Born deleted, so a turn racing this Clear can never pick it as "the latest chat".
        const holder = await tx.gideonChat.create({ data: { userId, title: null, deletedAt: new Date() }, select: { id: true } })
        await tx.gideonMessage.updateMany({ where: { userId, chatId: null }, data: { chatId: holder.id } })
      })
    }
    await softDeleteGideonChats(userId, only)
    // `files` stays in the response for released apps; nothing is unlinked now (the purge does that).
    return Response.json({ ok: true, deleted: count, files: 0 })
  } catch (error) {
    console.error('GIDEON history DELETE error:', error)
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
  }
}
