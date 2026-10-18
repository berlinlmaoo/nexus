export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ASSISTANT_NAME_MAX, INSTRUCTIONS_MAX, getGideonPreference } from "@/lib/gideon-assistant"

/**
 * Personalize GIDEON (Notion AI "Personalize", 12 Oct 2026): what this person calls it and their standing
 * instructions. Only ever the session user's own; never shown to anyone else.
 *   GET → { assistantName, instructions, updatedAt, reviewNotice }     PUT { assistantName?, instructions?, reviewNoticeSeen? } → same
 *
 * reviewNotice (18 Oct 2026, UU PDP transparency): true while the person has not yet dismissed the one-time
 * notice "GIDEON chats can be reviewed by the Board of Directors for work purposes." PUT
 * { reviewNoticeSeen: true } dismisses it for good, on every device (remembered server-side).
 */
async function withNotice(userId: string) {
  const [pref, seen] = await Promise.all([
    getGideonPreference(userId),
    prisma.gideonPreference.findUnique({ where: { userId }, select: { reviewNoticeSeenAt: true } }),
  ])
  return { ...pref, reviewNotice: !seen?.reviewNoticeSeenAt }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await withNotice(session.user.id))
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { assistantName?: unknown; instructions?: unknown; reviewNoticeSeen?: unknown }
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : v === null ? null : undefined)
  const assistantName = clean(body.assistantName, ASSISTANT_NAME_MAX)
  const instructions = clean(body.instructions, INSTRUCTIONS_MAX)
  const data = {
    ...(assistantName !== undefined ? { assistantName } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(body.reviewNoticeSeen === true ? { reviewNoticeSeenAt: new Date() } : {}),
  }
  await prisma.gideonPreference.upsert({ where: { userId: session.user.id }, create: { userId: session.user.id, ...data }, update: data })
  return NextResponse.json(await withNotice(session.user.id))
}
