import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { conversationAccess } from "@/lib/chat-access"
import { decodeCursor, encodeCursor, MESSAGE_KIND_USER, olderThan, parseLimit, parseSearchQuery, searchSnippet } from "@/lib/chat-rules"

/**
 * Search inside one conversation (SYSTEM-MESSAGES contract, Part 2, 8 Oct 2026).
 *
 * GET /api/conversations/:id/search?q=&cursor=&limit=
 *   → { results: [{ messageId, createdAt, sender: {id,name}, snippet }], nextCursor }
 *
 * People's messages only (no SYSTEM lines), case-insensitive substring of the text, newest first,
 * `q` at least 2 characters (400 QUERY_TOO_SHORT). `limit` default 20, max 50. A result opens the thread
 * at that message with GET …/messages?around=<messageId>. Same access as the messages route.
 *
 * Cost: ILIKE on `content`, scoped to this conversation, so Postgres walks the existing
 * ("conversationId", "createdAt") index newest first and stops after limit + 1 hits. A room with tens of
 * thousands of messages and a rare word reads the whole room; a pg_trgm GIN index on content would be
 * the next step if that ever shows up in the slow log, not needed at today's sizes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    const access = await conversationAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })

    const sp = req.nextUrl.searchParams
    const parsed = parseSearchQuery(sp.get("q"))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 })
    const rawCursor = sp.get("cursor")
    const cursor = rawCursor ? decodeCursor(rawCursor) : null
    if (rawCursor && !cursor) return NextResponse.json({ error: "cursor is not one this server handed out", code: "BAD_CURSOR" }, { status: 400 })
    const limit = parseLimit(sp.get("limit"), 20, 50)

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        kind: MESSAGE_KIND_USER,
        content: { contains: parsed.q, mode: "insensitive" },
        ...(cursor ? olderThan(cursor.createdAt, cursor.id) : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, createdAt: true, content: true, user: { select: { id: true, name: true } } },
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    return NextResponse.json({
      results: page.map((m) => ({
        messageId: m.id,
        createdAt: m.createdAt,
        sender: { id: m.user.id, name: m.user.name },
        snippet: searchSnippet(m.content, parsed.q),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    })
  } catch (error) {
    console.error("conversation search GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
