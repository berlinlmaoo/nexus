export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { TRANSCRIPT_PAGE, chatAggregates, notFound, requireOaa, reviewTarget, transcript } from "@/lib/gideon-review"

/**
 * One GIDEON chat, read-only, for the company One Above All ONLY (403 OAA_ONLY for everyone else).
 *   GET ?before=<ISO createdAt>&limit=
 *     → { person, chat: { id, title, createdAt, updatedAt, deleted, deletedAt, messages, questions, tier, tiers, credits },
 *         messages: [{ id, role, content, tools, attachments, runId, meta, createdAt, tier, credits }],   // oldest first
 *         olderBefore: string | null }                                                                   // pass as ?before= for older turns
 * messages[] is /api/gideon/history's shape plus id/createdAt/tier/credits, so the apps decode it with their
 * existing GIDEON turn model. No notification, no audit entry (owner, 18 Oct 2026).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string; chatId: string }> }) {
  const g = await requireOaa()
  if ("error" in g) return g.error
  const { userId, chatId } = await params
  try {
    const person = await reviewTarget(userId)
    if (!person) return notFound()
    const chat = await prisma.gideonChat.findFirst({
      where: { id: chatId, userId },
      select: { id: true, title: true, createdAt: true, updatedAt: true, deletedAt: true },
    })
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    const sp = req.nextUrl.searchParams
    const rawBefore = sp.get("before")
    const before = rawBefore && !Number.isNaN(Date.parse(rawBefore)) ? new Date(rawBefore) : null
    const limit = Math.max(1, Math.min(500, Number(sp.get("limit")) || TRANSCRIPT_PAGE))
    const [agg, page] = await Promise.all([chatAggregates([chat.id]), transcript(chat.id, before, limit)])
    const a = agg.get(chat.id)
    return NextResponse.json({
      person,
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
        deleted: Boolean(chat.deletedAt),
        deletedAt: chat.deletedAt?.toISOString() ?? null,
        messages: a?.messages ?? 0,
        questions: a?.questions ?? 0,
        tier: a?.tiers[0] ?? null,
        tiers: a?.tiers ?? [],
        credits: a?.credits ?? 0,
      },
      messages: page.messages,
      olderBefore: page.olderBefore,
    })
  } catch (error) {
    console.error("gideon review transcript error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
