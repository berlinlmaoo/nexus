export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { notifyProjectInvite } from "@/lib/notification-service"
import { logAudit } from "@/lib/audit"
import { syncProjectLinkedTeamAccess } from "@/lib/team-sync"
import { checkProjectAccess } from "@/lib/rbac"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await syncProjectLinkedTeamAccess((await params).projectId)

    const members = await prisma.projectMember.findMany({
      where: { projectId: (await params).projectId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    })

    return NextResponse.json(members)
  } catch (error) {
    console.error("Error fetching project members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId, role } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    // Only project managers (BoD / Manager-member / system admin) may add members.
    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: manage access required to add members" }, { status: 403 })
    }

    const existing = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId: (await params).projectId,
        },
      },
    })

    if (existing) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: (await params).projectId },
      select: { name: true },
    })

    const member = await prisma.projectMember.create({
      data: {
        userId,
        projectId: (await params).projectId,
        role: role || "MEMBER",
      },
      include: { user: true },
    })

    // Notify the invited user
    if (userId !== session.user.id) {
      notifyProjectInvite({
        userId,
        projectId: (await params).projectId,
        projectName: project?.name || "Unknown Project",
        invitedByName: session.user.name || "Someone",
        role: role || "MEMBER",
      }).catch((err) => console.error("Project invite notification error:", err))
    }

    logAudit({ action: "create", entityType: "project_member", entityId: member.id, entityName: member.user?.name || userId, userId: session.user.id!, request, metadata: { projectId: (await params).projectId, role: role || "MEMBER" } })

    return NextResponse.json(member, { status: 201 })
  } catch (error) {
    console.error("Error adding project member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    // Only project managers (BoD / Manager-member / system admin) may remove members.
    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: manage access required to remove members" }, { status: 403 })
    }

    const existing = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId: (await params).projectId,
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    await prisma.projectMember.delete({
      where: {
        userId_projectId: {
          userId,
          projectId: (await params).projectId,
        },
      },
    })

    logAudit({ action: "delete", entityType: "project_member", entityId: existing.userId, entityName: userId, userId: session.user.id!, request, metadata: { projectId: (await params).projectId } })

    return NextResponse.json({ message: "Member removed" })
  } catch (error) {
    console.error("Error removing project member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
