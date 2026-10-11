export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { deleteGideonAttachmentFiles } from "@/lib/gideon-attachments"

/** Rename (PATCH { title }) or delete (DELETE) one of the person's own GIDEON conversations. */
async function own(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const chat = await prisma.gideonChat.findFirst({ where: { id, userId: session.user.id }, select: { id: true } })
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
  const chat = await prisma.gideonChat.update({ where: { id }, data: { title }, select: { id: true, title: true, updatedAt: true } })
  return NextResponse.json({ chat: { ...chat, updatedAt: chat.updatedAt.toISOString() } })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ("error" in r) return r.error
  const owned = await prisma.gideonMessage.findMany({ where: { chatId: id, userId: r.userId }, select: { attachments: true } })
  await prisma.gideonChat.delete({ where: { id } })
  await deleteGideonAttachmentFiles(owned.map((m) => m.attachments)).catch(() => 0)
  return NextResponse.json({ ok: true })
}
