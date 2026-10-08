import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { chatUnreadForUser } from "@/lib/chat-unread"
import { visibleConversationIdsOf } from "@/lib/chat-access"

export const dynamic = "force-dynamic"

/**
 * GET /api/conversations/unread → { totalUnread, mentions } — the cheap read behind a Messages badge.
 *
 * totalUnread: messages from others you have not read, summed over your rooms; a muted room adds only
 * its mentions. mentions: @mentions waiting in rooms you have not read (muted ones included).
 * The same numbers GET /api/conversations reports, without the list.
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const conversationIds = await visibleConversationIdsOf(session.user.id)
    const { totalUnread, mentions } = await chatUnreadForUser(session.user.id, { conversationIds })
    return NextResponse.json({ totalUnread, mentions })
  } catch (error) {
    console.error("conversations unread error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
