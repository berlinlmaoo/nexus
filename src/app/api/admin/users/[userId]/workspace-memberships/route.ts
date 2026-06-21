export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { WorkspaceRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { ensureUserInPrimaryWorkspaceTeam, isPrimaryWorkspace } from "@/lib/primary-team"
import { syncTeamMemberAccess } from "@/lib/team-sync"

const WORKSPACE_ROLES: WorkspaceRole[] = ["BOD", "MANAGER", "STAFF"]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { session, context } = await getAdminSessionContext()

    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
    const role = body.role as WorkspaceRole | undefined

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
    }

    if (!role || !WORKSPACE_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid workspace role" }, { status: 400 })
    }

    const [user, workspace, existing] = await prisma.$transaction([
      prisma.user.findUnique({
        where: { id: (await params).userId },
        select: { id: true, email: true, name: true },
      }),
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, slug: true },
      }),
      prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: (await params).userId,
            workspaceId,
          },
        },
        select: { id: true },
      }),
    ])

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
    }

    if (existing) {
      return NextResponse.json({ error: "User is already a member of this workspace" }, { status: 409 })
    }

    const membership = await prisma.workspaceMember.create({
      data: {
        userId: (await params).userId,
        workspaceId,
        role,
      },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true },
        },
      },
    })

    let autoJoinedPrimaryTeam = false
    if (isPrimaryWorkspace(workspace)) {
      const { team } = await ensureUserInPrimaryWorkspaceTeam(prisma, (await params).userId)
      await syncTeamMemberAccess(team.id, (await params).userId)
      autoJoinedPrimaryTeam = true
    }

    await logAudit({
      action: "create",
      entityType: "admin_workspace_member",
      entityId: membership.id,
      entityName: `${user.email} -> ${workspace.name}`,
      userId: session.user.id,
      request,
      metadata: {
        workspaceId,
        role,
      },
    })

    return NextResponse.json({
      membership: {
        id: membership.id,
        role: membership.role,
        joinedAt: membership.joinedAt,
        workspace: membership.workspace,
      },
      autoJoinedPrimaryTeam,
    }, { status: 201 })
  } catch (error) {
    console.error("Error creating admin workspace membership:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
