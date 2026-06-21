export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { WorkspaceRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { isPrimaryWorkspace } from "@/lib/primary-team"

const WORKSPACE_ROLES: WorkspaceRole[] = ["BOD", "MANAGER", "STAFF"]

async function getTargetMembership(userId: string, membershipId: string) {
  return prisma.workspaceMember.findUnique({
    where: { id: membershipId },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true },
      },
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  }).then((membership) => {
    if (!membership || membership.userId !== userId) {
      return null
    }

    return membership
  })
}

async function isLastWorkspaceOwner(workspaceId: string, membershipId: string) {
  const ownerCount = await prisma.workspaceMember.count({
    where: {
      workspaceId,
      role: "BOD",
    },
  })

  if (ownerCount > 1) {
    return false
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { id: membershipId },
    select: { role: true },
  })

  return membership?.role === "BOD"
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; membershipId: string }> }
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
    const role = body.role as WorkspaceRole | undefined

    if (!role || !WORKSPACE_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid workspace role" }, { status: 400 })
    }

    const target = await getTargetMembership((await params).userId, (await params).membershipId)

    if (!target) {
      return NextResponse.json({ error: "Workspace membership not found" }, { status: 404 })
    }

    if (isPrimaryWorkspace(target.workspace)) {
      return NextResponse.json({ error: "PATS Group workspace role is managed automatically" }, { status: 400 })
    }

    if (target.role === "BOD" && role !== "BOD" && await isLastWorkspaceOwner(target.workspaceId, target.id)) {
      return NextResponse.json({ error: "Cannot demote the last owner of a workspace" }, { status: 400 })
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true },
        },
      },
    })

    await logAudit({
      action: "update",
      entityType: "admin_workspace_member",
      entityId: updated.id,
      entityName: `${target.user.email} -> ${target.workspace.name}`,
      userId: session.user.id,
      request,
      metadata: {
        previousRole: target.role,
        role,
        workspaceId: target.workspaceId,
      },
    })

    return NextResponse.json({
      membership: {
        id: updated.id,
        role: updated.role,
        joinedAt: updated.joinedAt,
        workspace: updated.workspace,
      },
    })
  } catch (error) {
    console.error("Error updating admin workspace membership:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; membershipId: string }> }
) {
  try {
    const { session, context } = await getAdminSessionContext()

    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const target = await getTargetMembership((await params).userId, (await params).membershipId)

    if (!target) {
      return NextResponse.json({ error: "Workspace membership not found" }, { status: 404 })
    }

    if (isPrimaryWorkspace(target.workspace)) {
      return NextResponse.json({ error: "PATS Group membership is required for all users" }, { status: 400 })
    }

    if (await isLastWorkspaceOwner(target.workspaceId, target.id)) {
      return NextResponse.json({ error: "Cannot remove the last owner of a workspace" }, { status: 400 })
    }

    await prisma.workspaceMember.delete({
      where: { id: target.id },
    })

    await logAudit({
      action: "delete",
      entityType: "admin_workspace_member",
      entityId: target.id,
      entityName: `${target.user.email} -> ${target.workspace.name}`,
      userId: session.user.id,
      request,
      metadata: {
        role: target.role,
        workspaceId: target.workspaceId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting admin workspace membership:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
