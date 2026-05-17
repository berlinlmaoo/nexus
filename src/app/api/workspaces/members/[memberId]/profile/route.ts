export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

async function getWorkspaceAndRole(userId: string, workspaceId?: string) {
  return prisma.workspaceMember.findFirst({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { memberId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const name = String(body.name ?? "").trim()

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: params.memberId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    })

    if (!targetMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const currentMember = await getWorkspaceAndRole(session.user.id, targetMember.workspaceId)
    if (!currentMember) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 })
    }

    if (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owners and admins can edit operatives" }, { status: 403 })
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetMember.user.id },
      data: { name },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    })

    await logAudit({
      action: "update",
      entityType: "workspace_member_profile",
      entityId: params.memberId,
      entityName: updatedUser.email,
      userId: session.user.id,
      request,
      metadata: {
        previousName: targetMember.user.name,
        updatedName: updatedUser.name,
        workspaceId: targetMember.workspaceId,
      },
    })

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    console.error("Error updating workspace member profile:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
