export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { SystemRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"

const SYSTEM_ROLES: SystemRole[] = ["ADMIN", "MEMBER"]

export async function GET(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const { context } = await getAdminSessionContext()

    if (!context?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [user, workspaceMemberships, teamMemberships, projectMemberships, availableWorkspaces] =
      await prisma.$transaction([
        prisma.user.findUnique({
          where: { id: params.userId },
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.workspaceMember.findMany({
          where: { userId: params.userId },
          include: {
            workspace: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: [
            { workspace: { name: "asc" } },
            { joinedAt: "asc" },
          ],
        }),
        prisma.teamMember.findMany({
          where: { userId: params.userId },
          include: {
            team: {
              select: {
                id: true,
                name: true,
                color: true,
                workspaceId: true,
              },
            },
          },
          orderBy: { team: { name: "asc" } },
        }),
        prisma.projectMember.findMany({
          where: { userId: params.userId },
          include: {
            project: {
              select: {
                id: true,
                name: true,
                color: true,
                icon: true,
                status: true,
                workspaceId: true,
              },
            },
          },
          orderBy: { project: { name: "asc" } },
        }),
        prisma.workspace.findMany({
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
        }),
      ])

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const memberships = workspaceMemberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      joinedAt: membership.joinedAt,
      workspace: membership.workspace,
      teams: teamMemberships
        .filter((teamMembership) => teamMembership.team.workspaceId === membership.workspaceId)
        .map((teamMembership) => ({
          id: teamMembership.team.id,
          name: teamMembership.team.name,
          color: teamMembership.team.color,
          role: teamMembership.role,
        })),
      projects: projectMemberships
        .filter((projectMembership) => projectMembership.project.workspaceId === membership.workspaceId)
        .map((projectMembership) => ({
          id: projectMembership.project.id,
          name: projectMembership.project.name,
          color: projectMembership.project.color,
          icon: projectMembership.project.icon,
          status: projectMembership.project.status,
          role: projectMembership.role,
          source: projectMembership.source,
        })),
    }))

    return NextResponse.json({
      user: {
        ...user,
        workspaceMemberships: memberships,
      },
      availableWorkspaces,
    })
  } catch (error) {
    console.error("Error fetching admin user detail:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
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
    const role = body.role as SystemRole | undefined

    if (!role || !SYSTEM_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid system role" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, name: true, role: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const updated = await prisma.user.update({
      where: { id: params.userId },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    await logAudit({
      action: "update",
      entityType: "admin_user_role",
      entityId: params.userId,
      entityName: updated.email,
      userId: session.user.id,
      request,
      metadata: {
        previousRole: existing.role,
        role,
      },
    })

    return NextResponse.json({ user: updated })
  } catch (error) {
    console.error("Error updating admin user role:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
