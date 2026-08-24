// Gideon chat history for the logged-in user. The panel loads this on open so a conversation
// survives closing the panel, refreshing, and switching devices. Always scoped to the session
// user — history is private and never addressable by userId from the client.
export const dynamic = "force-dynamic"

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

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
      select: { role: true, content: true, tools: true },
    })
    // Fetched newest-first to apply the cap, rendered oldest-first.
    return Response.json({ messages: rows.reverse() })
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
    const { count } = await prisma.gideonMessage.deleteMany({ where: { userId: session.user.id } })
    return Response.json({ ok: true, deleted: count })
  } catch (error) {
    console.error('GIDEON history DELETE error:', error)
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
  }
}
