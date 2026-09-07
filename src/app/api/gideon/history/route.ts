// Gideon chat history for the logged-in user. The panel loads this on open so a conversation
// survives closing the panel, refreshing, and switching devices. Always scoped to the session
// user — history is private and never addressable by userId from the client.
export const dynamic = "force-dynamic"

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { deleteGideonAttachmentFiles, parseGideonAttachments } from '@/lib/gideon-attachments'

// Newest N turns are enough to resume a conversation; older ones stay in the table but are not
// shipped to the client (keeps the payload and the prompt context bounded).
const HISTORY_LIMIT = 100

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    const rows = await prisma.gideonMessage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true, tools: true, attachments: true },
    })
    // Fetched newest-first to apply the cap, rendered oldest-first.
    //
    // `attachments` is always an ARRAY on the way out, empty where the column is NULL — which is
    // every row written before this feature and most rows written after it. A client that has to
    // tell null from absent from empty in order to draw nothing is a client with three ways to get
    // the common case wrong. It is also parsed rather than passed through: the column is jsonb, so
    // what is in it is whatever was put there, and a chip is only drawn for a file this app wrote.
    return Response.json({
      messages: rows.reverse().map((row) => ({
        role: row.role,
        content: row.content,
        tools: row.tools,
        attachments: parseGideonAttachments(row.attachments),
      })),
    })
  } catch (error) {
    console.error('GIDEON history GET error:', error)
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
  }
}

export async function DELETE() {
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
    const owned = await prisma.gideonMessage.findMany({
      where: { userId: session.user.id },
      select: { attachments: true },
    })
    const { count } = await prisma.gideonMessage.deleteMany({ where: { userId: session.user.id } })
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
