export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@/generated/prisma"
import prisma from "@/lib/prisma"
import { chatAggregates, decodeCursor, encodeCursor, notFound, requireOaa, reviewTarget, type ReviewChatRow } from "@/lib/gideon-review"

/**
 * Control Room › GIDEON › People › person › Chats (18 Oct 2026). The company One Above All ONLY (403 for
 * everyone else, code OAA_ONLY). Every GIDEON chat of the person, including the ones they deleted (marked;
 * kept 90 days). Read-only; no notification, no audit entry (owner's decision, see lib/gideon-review.ts).
 *
 *   GET ?q=&from=YYYY-MM-DD&to=YYYY-MM-DD&deleted=all|only|none&cursor=&limit=
 *     → { chats: ReviewChatRow[], nextCursor: string | null, total: number }
 *   Newest activity first; keyset pagination (cursor is opaque). from/to are Asia/Jakarta days and match a chat
 *   active at any time in the range. q searches titles and everything said in the chat.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const g = await requireOaa()
  if ("error" in g) return g.error
  const { userId } = await params
  try {
    const person = await reviewTarget(userId)
    if (!person) return notFound()

    const sp = req.nextUrl.searchParams
    const q = (sp.get("q") || "").trim().slice(0, 120)
    const limit = Math.max(1, Math.min(100, Number(sp.get("limit")) || 30))
    const cursor = decodeCursor(sp.get("cursor"))
    const from = sp.get("from")
    const to = sp.get("to")
    const deleted = sp.get("deleted")

    const where: Prisma.GideonChatWhereInput = {
      userId,
      messages: { some: {} },
      ...(deleted === "only" ? { deletedAt: { not: null } } : deleted === "none" ? { deletedAt: null } : {}),
      ...(from && DAY.test(from) ? { updatedAt: { gte: new Date(`${from}T00:00:00+07:00`) } } : {}),
      ...(to && DAY.test(to) ? { createdAt: { lt: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000) } } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { messages: { some: { content: { contains: q, mode: "insensitive" } } } }] }
        : {}),
    }
    const page: Prisma.GideonChatWhereInput = cursor
      ? { AND: [where, { OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] }] }
      : where

    const [rows, total] = await Promise.all([
      prisma.gideonChat.findMany({
        where: page,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: { id: true, title: true, createdAt: true, updatedAt: true, deletedAt: true },
      }),
      cursor ? Promise.resolve(-1) : prisma.gideonChat.count({ where }),
    ])
    const more = rows.length > limit
    const list = rows.slice(0, limit)
    const agg = await chatAggregates(list.map((r) => r.id))

    const matches = new Map<string, string>()
    if (q && list.length) {
      const hits = await prisma.gideonMessage.findMany({
        where: { chatId: { in: list.map((r) => r.id) }, content: { contains: q, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { chatId: true, content: true },
        take: 300,
      })
      for (const h of hits) {
        if (!h.chatId || matches.has(h.chatId)) continue
        const flat = h.content.replace(/\s+/g, " ")
        const at = flat.toLowerCase().indexOf(q.toLowerCase())
        const start = Math.max(0, at - 40)
        matches.set(h.chatId, `${start > 0 ? "…" : ""}${flat.slice(start, start + 140)}`)
      }
    }

    const chats: ReviewChatRow[] = list.map((r) => {
      const a = agg.get(r.id)
      return {
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        messages: a?.messages ?? 0,
        questions: a?.questions ?? 0,
        tier: a?.tiers[0] ?? null,
        tiers: a?.tiers ?? [],
        credits: a?.credits ?? 0,
        deleted: Boolean(r.deletedAt),
        deletedAt: r.deletedAt?.toISOString() ?? null,
        match: matches.get(r.id) ?? null,
      }
    })
    const lastRow = list[list.length - 1]
    return NextResponse.json({
      chats,
      nextCursor: more && lastRow ? encodeCursor(lastRow.updatedAt, lastRow.id) : null,
      // Only on the first page (-1 on later ones: the client keeps the first page's number).
      total,
    })
  } catch (error) {
    console.error("gideon review chats error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
