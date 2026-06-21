import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { conversationId } = await params
    // Only an existing member may mark a conversation read — never auto-join (the old upsert-create let
    // any user add themselves to, and read, any conversation by id).
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: session.user.id } },
      select: { id: true },
    })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: session.user.id } },
      data: { lastReadAt: new Date() },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("conversation read error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
