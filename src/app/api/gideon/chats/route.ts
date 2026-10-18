export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

/**
 * GIDEON chat history (12 Oct 2026, Notion AI parity): the person's conversations, newest first, with
 * search over titles and what was said. Private: always the session user's own. Chats the person deleted
 * (deletedAt, kept 90 days for the One Above All's review) never appear here.
 *   GET ?q=&limit=&before=  → { chats: [{ id, title, createdAt, updatedAt, messages, match? }] }
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const sp = req.nextUrl.searchParams
  const q = (sp.get("q") || "").trim().slice(0, 120)
  const limit = Math.max(1, Math.min(100, Number(sp.get("limit")) || 50))
  const before = sp.get("before")
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null

  const rows = await prisma.gideonChat.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(beforeDate ? { updatedAt: { lt: beforeDate } } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { messages: { some: { content: { contains: q, mode: "insensitive" } } } }] }
        : { messages: { some: {} } }),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
  })
  // For a search: the line that matched, so the list can show why a chat is there.
  const matches = new Map<string, string>()
  if (q && rows.length) {
    const hits = await prisma.gideonMessage.findMany({
      where: { userId, chatId: { in: rows.map((r) => r.id) }, content: { contains: q, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { chatId: true, content: true },
      take: 200,
    })
    for (const h of hits) {
      if (!h.chatId || matches.has(h.chatId)) continue
      const flat = h.content.replace(/\s+/g, " ")
      const at = flat.toLowerCase().indexOf(q.toLowerCase())
      const start = Math.max(0, at - 40)
      matches.set(h.chatId, `${start > 0 ? "…" : ""}${flat.slice(start, start + 140)}`)
    }
  }
  return NextResponse.json({
    chats: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messages: r._count.messages,
      match: matches.get(r.id) ?? null,
    })),
  })
}
