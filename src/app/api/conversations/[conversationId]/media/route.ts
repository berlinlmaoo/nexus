import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { conversationAccess } from "@/lib/chat-access"
import { mediaPage } from "@/lib/chat-media"
import { decodeCursor, parseLimit, parseMediaType } from "@/lib/chat-rules"

/**
 * Media, links and docs of one conversation (SYSTEM-MESSAGES contract, Part 2, 8 Oct 2026).
 *
 * GET /api/conversations/:id/media?type=photos|links|docs&cursor=&limit=
 *   → { items: [{ messageId, createdAt, sender: {id,name}, url, attachmentType?, title? }], nextCursor }
 *
 * Newest first. photos = image attachments, docs = any other attachment (title = its caption or file
 * name), links = every http(s) address found in message text, one item per address (title = its host).
 * `cursor` = the previous page's nextCursor (null when there is no more). `limit` counts messages
 * (default 30, max 100), so a links page can hold more items than that. People's messages only.
 * Same access as the messages route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    const access = await conversationAccess(session.user.id, conversationId)
    if (!access.ok) return NextResponse.json({ error: access.status === 404 ? "Not found" : "Forbidden" }, { status: access.status })

    const sp = req.nextUrl.searchParams
    const type = parseMediaType(sp.get("type"))
    if (!type) return NextResponse.json({ error: "type must be photos, links or docs", code: "BAD_TYPE" }, { status: 400 })
    const rawCursor = sp.get("cursor")
    const cursor = rawCursor ? decodeCursor(rawCursor) : null
    if (rawCursor && !cursor) return NextResponse.json({ error: "cursor is not one this server handed out", code: "BAD_CURSOR" }, { status: 400 })

    const page = await mediaPage(conversationId, type, cursor, parseLimit(sp.get("limit"), 30, 100))
    return NextResponse.json(page)
  } catch (error) {
    console.error("conversation media GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
