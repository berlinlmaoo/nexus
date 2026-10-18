export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { softDeleteGideonChats } from "@/lib/gideon-chat-retention"

/**
 * Rename (PATCH { title }) or delete (DELETE) one of the person's own GIDEON conversations.
 *
 * DELETE is a soft delete (owner, 18 Oct 2026): the chat disappears from the person's list, search, history
 * and GIDEON's context at once, and is kept 90 days for the company One Above All (Control Room › GIDEON ›
 * People › Chats, shown as "Deleted by user"), then purged with its messages and files
 * (lib/gideon-chat-retention.ts). The dialog says exactly that.
 */
async function own(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const chat = await prisma.gideonChat.findFirst({ where: { id, userId: session.user.id, deletedAt: null }, select: { id: true } })
  if (!chat) return { error: NextResponse.json({ error: "Chat not found" }, { status: 404 }) }
  return { userId: session.user.id, chat }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ("error" in r) return r.error
  const body = (await req.json().catch(() => ({}))) as { title?: unknown }
  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 80) : ""
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
  const { count } = await prisma.gideonChat.updateMany({ where: { id, userId: r.userId, deletedAt: null }, data: { title } })
  if (count === 0) return NextResponse.json({ error: "Chat not found" }, { status: 404 })
  const chat = await prisma.gideonChat.findUniqueOrThrow({ where: { id }, select: { id: true, title: true, updatedAt: true } })
  return NextResponse.json({ chat: { ...chat, updatedAt: chat.updatedAt.toISOString() } })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ("error" in r) return r.error
  // Conditional on deletedAt IS NULL: two taps (or two devices) racing stamp it once, and the second gets ok
  // too. Raw so updatedAt (@updatedAt) keeps the chat's real last activity for the review list.
  await softDeleteGideonChats(r.userId, id)
  return NextResponse.json({ ok: true })
}
