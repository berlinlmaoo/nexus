export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { role: true } })
  return memberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
}

// Toggle active / edit an announcement (BoD+). Set active:false to stop it popping up.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params
    const { title, body, tone, active } = await req.json()
    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: String(title).trim() }),
        ...(body !== undefined && { body: String(body).trim() }),
        ...(tone !== undefined && ["info", "success", "warning"].includes(tone) && { tone }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    })
    return NextResponse.json({ announcement })
  } catch (error) {
    console.error("announcement patch error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { id } = await params
    await prisma.announcement.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("announcement delete error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
